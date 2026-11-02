import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { CODE } from '../common/codes';
import { PrismaService } from '../common/prisma.service';
import { mindmapOut } from '../common/shape';
import { nowStr } from '../common/time';
import { emptyTree, normalizeTree } from '../common/tree';
import { env } from './ai.service';
import { TextLinkItem, extractTextLinks } from './link-guard';
import { MdNode, SnapItem, buildTreeFromMarkdown, finalizeTree, parseJsonTree } from './mindmap-md';
import { MINDMAP_JSON_PROMPT, mindmapPrompt } from './prompt.mindmap';

/**
 * ★★ 280 轮 ·「语义转脑图」的受理与后台任务。
 *
 * ── 与 278「提示词增强」最大的结构差异 ────────────────────────────────
 *   278 是"文本进、文本出"，**零副作用**；
 *   本功能要**写库**，而且要写两次（受理时建占位卡、完成后回写树），
 *   中间还隔着一个几十秒的模型调用 ⇒ 于是有了这条链上最难的三件事：
 *     ① **事务**：占位卡与"胶囊被消费"必须同生同死（否则胶囊没了、卡也没了）；
 *     ② **条件更新**：回写只认 `aiState='pending'`。用户在生成中删了卡、或点重试
 *        又起了一个任务，旧任务回来时**必须命中 0 行**，不能把别人的结果盖掉；
 *     ③ **清扫**：单实例 pm2 部署，`pm2 reload` 会杀掉后台任务 ⇒
 *        下次启动要把"卡住的 pending"转 failed 并**还原胶囊**。
 *
 * ── 为什么"不 await 模型" ──────────────────────────────────────────────
 *   模型要跑十几到几十秒，而小程序端的 `wx.request` 默认 60s 且用户会切走。
 *   接口只做"受理"，返回后 `setImmediate` 再跑 —— 用户立刻看到占位卡，
 *   而任务本身不依赖任何客户端连接。
 *   ⚠️ 代价：进程被杀就丢任务。这就是 ③ 存在的理由。
 */

/** 一次最多选多少条胶囊（方案 §7.4 Q1 定案）—— 再多模型也读不过来，成本还翻倍 */
const MAX_CAPSULES = 20;
/** 合并后文本上限（字）—— 超出**直接提示少选几条，不静默截断**（本工程铁律：不许静默丢内容） */
const MAX_CHARS = 6000;
/** 单次模型调用的硬超时（比 278 的 50s 长：这是归纳任务，输出也更长） */
const TIMEOUT_MS = 90_000;
/** 后台任务"卡住"的判定线：超过它还没回写 ⇒ 认定进程被重启过，转 failed */
const STUCK_MS = 10 * 60_000;

/** 占位卡的名字与失败后的名字（方案 §11.3 文案表） */
export const MM_AI_NAME_PENDING = '语义转脑中';
export const MM_AI_NAME_FAILED = '语义转脑图失败';

/** `ai_input` 里的那个 JSON —— 图的真源就在这里（后台**不能**回查胶囊，那时已被消费） */
interface AiInputSnapshot {
  text: string;
  images: SnapItem[];
  links: TextLinkItem[];
  capsuleIds: string[];
  startedAt: string;
}

function cut(s: string, n: number): string {
  const arr = Array.from(String(s || ''));
  return arr.length <= n ? String(s || '') : arr.slice(0, n).join('');
}

@Injectable()
export class MindmapAiService implements OnModuleInit {
  private readonly logger = new Logger('MindmapAi');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 启动清扫。
   * ⚠️ 用 `void` 起、不阻塞启动：清扫失败（比如库连不上）不该让进程起不来，
   *    而那批 pending 会在下一次启动再被扫一次（它们的时间戳不会变）。
   */
  onModuleInit(): void {
    setImmediate(() => {
      void this.sweep().catch((e) => this.logger.error('清扫失败：' + (e && e.message)));
    });
  }

  /* ══════════════════════════════════════════════════════════════════
   * 受理
   * ══════════════════════════════════════════════════════════════════ */

  async accept(userId: string, dto: { id?: string; capsuleIds: string[] }) {
    const ids = Array.from(new Set((dto.capsuleIds || []).map(String).filter(Boolean)));
    if (!ids.length) throw ApiException.badParam('请至少选择一条胶囊');
    if (ids.length > MAX_CAPSULES) {
      throw ApiException.badParam(`一次最多 ${MAX_CAPSULES} 条，请少选几条`);
    }

    /* ★ 幂等：连点两次时前端会带着同一个 `id` 再打一次。
       查到了就直接把那张卡还回去 —— **不重新生成、不重复消费胶囊、不再计费**。
       （前端是乐观更新，本地已经拿这个 id 渲染了一张卡，服务端必须认同一个 id。） */
    if (dto.id) {
      const exist = await this.prisma.mindmap.findFirst({ where: { id: String(dto.id), userId } });
      if (exist) {
        return {
          mindmap: mindmapOut(exist, false),
          capsuleIds: ids,
          reused: true,
        };
      }
    }

    /* ★ 节流：**每用户同时只允许一个 pending**。
       278 那种"距上次多久"（GAP_MS）在这里不够用 —— 一次生成可能跑 30 秒，
       用户在 3 秒后再点一次就会变成两个任务写同一批胶囊。
       ⚠️ 单实例 + 前端连点已被上面的 `id` 幂等挡住，这里挡的是"换一批胶囊再点一次"。
          真并发（同一瞬间两个请求）不在这一层的防线内 —— 那需要唯一索引，一期不做。 */
    const pending = await this.prisma.mindmap.count({ where: { userId, aiState: 'pending' } });
    if (pending > 0) throw ApiException.rejected('上一张脑图还在生成，请稍等');

    const caps = await this.prisma.capsule.findMany({
      where: {
        id: { in: ids },
        userId,
        deletedAt: null,   // 已删除的不参与
        consumedAt: null,  // 已被消费过的不再二次消费（与 promoteToMindmap 同一条口径）
      },
      orderBy: { createdAt: 'asc' },   // ★ 正序：与胶囊列表的显示顺序一致（§7.4 Q1）
    });
    if (!caps.length) throw ApiException.badParam('这几条胶囊已经不在列表里了');

    /* ── 合并文本：图号与链接号**各自**一条编号空间 ────────────────────
       ⚠️ 图号 = **图片序号**，不是胶囊序号。第 2 段没图时，第 3 段的图号就是 2。
          混用会"张冠李戴且不报错"（`CapsuleSeed` 的注释专门警告过）。
       ⚠️ 纯图胶囊（识别未回，`text` 为空）**不进模型** —— 没有语义线索，模型只能瞎放。
          它的图仍然占一个编号，但文本里不出现 ⇒ 回填时走"没出现过的编号 → 附图分支"
          自动补位，不需要在提示词里给它留位置。 */
    const images: SnapItem[] = [];
    const segs: { text: string; imgNo: number }[] = [];
    const seenText = new Set<string>();
    let imgNo = 0;

    for (const c of caps) {
      const hasImg = !!(c.imageUri && String(c.imageUri).trim());
      if (hasImg) {
        imgNo += 1;
        images.push({ i: imgNo, text: String(c.text || ''), imageUri: String(c.imageUri) });
      }
      const raw = String(c.text || '').trim();
      if (!raw) continue;
      /* 完全相同的两段只留一段（唯一允许的本地压缩，§6.2-D）——
         去重放在"分图号之后"：图号仍按胶囊顺序发，只是文本不再重复出现。 */
      if (seenText.has(raw)) continue;
      seenText.add(raw);
      segs.push({ text: raw, imgNo: hasImg ? imgNo : 0 });
    }

    const links: TextLinkItem[] = [];
    const parts: string[] = [];
    for (const seg of segs) {
      const g = extractTextLinks(seg.text, links.length + 1);
      links.push(...g.map);
      let t = String(g.text || '').trim();
      if (seg.imgNo) {
        /* 段末、同一行、前面一个空格（§6.9.2 的形态）：
           独立成行容易被模型当噪音删掉；同一行才跟得住"这段文字"。 */
        t = t ? `${t} [[图${seg.imgNo}]]` : `[[图${seg.imgNo}]]`;
      }
      if (t) parts.push(t);
    }
    const merged = parts.join('\n\n').trim();
    if (!merged) throw ApiException.badParam('这几条胶囊还没有识别出文字，暂时没法转成脑图');
    if (Array.from(merged).length > MAX_CHARS) {
      throw ApiException.badParam(`内容太长了（超过 ${MAX_CHARS} 字），请少选几条再试`);
    }
    /* 只剩占位符、几乎没有文字（比如选的全是纯图胶囊）⇒ **不调模型**。
       这种输入模型只会回一句"请查看 [[图1]]"，用户白等十几秒、我们白付一次钱。 */
    const plain = merged.replace(/\[\[[^\]]*\]\]/g, '').trim();
    if (Array.from(plain).length < 8) {
      throw ApiException.badParam('这几条胶囊的文字太少，暂时没法整理成脑图');
    }

    const now = nowStr();
    const snapshot: AiInputSnapshot = {
      text: merged,
      images,
      links,
      capsuleIds: caps.map((c) => c.id),
      startedAt: now,
    };

    /* ── 事务：占位卡与"胶囊被消费"**同生同死** ────────────────────── */
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.mindmap.create({
        data: {
          id: dto.id || undefined,
          userId,
          /* ★ 三个"真空值"（§9.1 E8）：不写 `mindmap` 默认格式假装已设置、
             不继承项目、不猜 agent。这三条是"未完善"这个状态能成立的前提。 */
          projectId: null,
          agentId: null,
          name: MM_AI_NAME_PENDING,
          format: '',
          treeJson: emptyTree(MM_AI_NAME_PENDING) as any,
          nodeCount: 1,
          depth: 1,
          createdAt: now,
          updatedAt: now,
          aiState: 'pending',
          aiStartedAt: now,
          aiInput: JSON.stringify(snapshot),
        },
      });
      const eaten = await tx.capsule.updateMany({
        where: { id: { in: snapshot.capsuleIds }, userId, consumedAt: null },
        data: { consumedAt: now },
      });
      /* ⚠️ 少消费了一条就整体回滚：那说明并发里有人先动手了（另一个任务/另一台设备）。
         半截状态是这一层最糟的结果 —— 胶囊没了、卡还在等一个不存在的内容。 */
      if (eaten.count !== snapshot.capsuleIds.length) {
        throw new Error(`胶囊消费数不一致：期望 ${snapshot.capsuleIds.length}，实际 ${eaten.count}`);
      }
      return created;
    });

    this.logger.log(
      `受理：胶囊 ${caps.length} 条 → 脑图 ${row.id}（图 ${images.length} 张 · 链接 ${links.length} 条 · 文本 ${merged.length} 字）`,
    );

    /* ★ 不 await —— 后台跑，接口立刻返回（见文件头"为什么不 await"） */
    setImmediate(() => {
      void this.run(userId, row.id).catch((e) => this.logger.error('后台任务异常：' + (e && e.stack)));
    });

    return { mindmap: mindmapOut(row, false), capsuleIds: snapshot.capsuleIds, reused: false };
  }

  /**
   * ★「语义转脑图」的**轻量轮询口**（`GET /mindmaps/ai-pending`）。
   *
   * 只回"还需要前端看一眼"的那几条，别的都不回：
   *   · `pending` —— 卡上要一直写"生成中"；
   *   · `failed`  —— 卡上写"生成失败"，并且要提示胶囊已还原；
   *   · `flashAt` 非空 —— **刚完成**、用户还没打开过 ⇒ 前端据此亮一次底色，
   *     并趁这次把整张卡（名称/节点数）换掉。
   *
   * ⚠️ **`done` 本身不在条件里**：它是终态，会一直留着（表示"这张图是 AI 生成的"），
   *    若按 `aiState is not null` 查，这辈子每次轮询都会把这张图回一遍 ——
   *    用户打开过一次（`/seen` 清掉 `flashAt`）之后就不该再出现在这个接口里。
   *
   * 为什么不复用 `GET /sync`：sync 是**全量**快照（几百 KB），为了看一张卡的状态
   * 每 3 秒拉一次全量，等于把"启动一次"的成本按轮询频率重复付。
   */
  async pending(userId: string) {
    const rows = await this.prisma.mindmap.findMany({
      where: {
        userId,
        OR: [{ aiState: 'pending' }, { aiState: 'failed' }, { flashAt: { not: null } }],
      },
      select: {
        id: true, projectId: true, name: true, format: true,
        agentId: true, aiState: true, aiError: true, flashAt: true,
        nodeCount: true, depth: true, createdAt: true, updatedAt: true,
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    return {
      items: rows.map((r: any) => Object.assign(mindmapOut(r, false), {
        /* ⚠️ `aiError` 只在这个接口里给（`/sync` 不给）：它是"这一张卡为什么失败"的一句话，
           只在用户正盯着这张卡时有意义。**不含堆栈、不含错误码**（错误码只进 console）。 */
        aiError: r.aiError || '',
      })),
    };
  }

  /**
   * 失败重试。
   * 只认 `ai_state='failed'` —— `pending` 不能重试（会变成两个任务写同一行）。
   */
  async retry(userId: string, id: string) {
    const m = await this.prisma.owned<any>(this.prisma.mindmap, id, userId, '脑图');
    if (m.aiState !== 'failed') throw ApiException.rejected('这张脑图现在不需要重试');

    const now = nowStr();
    const r = await this.prisma.mindmap.updateMany({
      where: { id: m.id, userId, aiState: 'failed' },
      data: {
        aiState: 'pending',
        aiStartedAt: now,
        aiError: null,
        name: MM_AI_NAME_PENDING,
        treeJson: emptyTree(MM_AI_NAME_PENDING) as any,
        nodeCount: 1,
        depth: 1,
        updatedAt: now,
      },
    });
    if (!r.count) throw ApiException.rejected('这张脑图现在不需要重试');

    setImmediate(() => {
      void this.run(userId, m.id).catch((e) => this.logger.error('重试任务异常：' + (e && e.stack)));
    });
    return { mindmapId: m.id, aiState: 'pending' };
  }

  /* ══════════════════════════════════════════════════════════════════
   * 后台任务
   * ══════════════════════════════════════════════════════════════════ */

  private async run(userId: string, mindmapId: string): Promise<void> {
    const m = await this.prisma.mindmap.findFirst({ where: { id: mindmapId, userId } });
    /* 用户在受理与启动之间删掉了它 —— 直接收工（行没了，什么都不用改） */
    if (!m || m.aiState !== 'pending') return;

    let snap: AiInputSnapshot;
    try {
      snap = JSON.parse(String(m.aiInput || '{}'));
    } catch {
      return this.fail(userId, mindmapId, null, '生成信息读取失败，请重试');
    }
    if (!snap || !snap.text) return this.fail(userId, mindmapId, snap, '生成信息读取失败，请重试');

    const fallbackName = defaultName();
    const hasImages = !!(snap.images && snap.images.length);
    const t0 = Date.now();

    try {
      let built: { tree: MdNode; name: string; counts: any } | null = null;
      let via = 'markdown';

      try {
        const md = await this.callModel(mindmapPrompt(hasImages), snap.text, 4096);
        built = buildTreeFromMarkdown(md, {
          fallbackName,
          images: snap.images,
          links: snap.links,
        });
      } catch (e: any) {
        /* ★ 降级：**改要 JSON**，不是把同一份 Markdown 再要一遍。
           Markdown 的失败几乎都出在"层级怎么表达"，同一个失败重发同一份指令
           只会得到同一个失败 —— 只是再付一次钱。换一种没有层级歧义的格式才有意义。 */
        this.logger.warn(`Markdown 解析失败，改要 JSON：${e && e.message}`);
        const raw = await this.callModel(MINDMAP_JSON_PROMPT, snap.text, 6144);
        const tree = parseJsonTree(raw);
        if (!tree) throw new Error('模型返回的内容无法解析成脑图');
        built = finalizeTree(tree, { fallbackName, images: snap.images, links: snap.links });
        via = 'json';
      }

      /* ★ 落库前必须过 `normalizeTree()` —— 树的合法性**只由它一个人负责**
         （`Mindmap.treeJson` 是唯一真源，一条带环的树会让前端排版死循环）。
         ⚠️ 这里**不传 `ownPrefix`**：节点图来自胶囊，写进胶囊那一刻 `ownImage()` 已验过归属；
            与 `promoteToMindmap` 同一条口径（树本来就来自库）。传了反而会把
            "历史遗留的外链 uri"整棵树打回。 */
      const { tree, nodeCount, depth } = normalizeTree(built.tree);
      const now = nowStr();

      /* ★★ 条件更新：只认 `pending`。命中 0 行 ⇒ 用户在生成中删了它、或已重试出另一个任务。
         **不覆盖** —— 这是并发、已删、重试三处唯一的防线。 */
      const r = await this.prisma.mindmap.updateMany({
        where: { id: mindmapId, userId, aiState: 'pending' },
        data: {
          treeJson: tree as any,
          nodeCount,
          depth,
          name: built.name,
          aiState: 'done',
          aiError: null,
          aiStartedAt: null,
          /* ★ 成功后**必须清空** `aiInput`：它不仅占字节，还含用户原文与图路径 */
          aiInput: null,
          /* ★ 刚生成完亮一次底色（与待办卡 `flashAt` 同一套读法），
             用户打开它（画布或完善抽屉）时由 `POST /mindmaps/:id/seen` 清掉 */
          flashAt: now,
          updatedAt: now,
        },
      });
      if (!r.count) {
        this.logger.warn(`脑图 ${mindmapId} 回写命中 0 行（已被删除或已重试），丢弃本次结果`);
        return;
      }

      const c = built.counts || {};
      this.logger.log(
        `完成：${mindmapId} · ${via} · ${nodeCount} 节点 / ${depth} 层 · 名称「${built.name}」 · ` +
        `图 ${c.images || 0} 张（挂 ${c.placed || 0} / 子 ${c.child || 0} / 补位 ${c.missing || 0} / ` +
        `下移 ${c.rootMoved || 0} / 坏 ${c.badUri || 0} / 幽灵 ${c.ghost || 0}）· ` +
        `链接 ${c.linkPlaced || 0} 条 · 墙钟 ${Date.now() - t0}ms`,
      );
    } catch (e: any) {
      const msg = String((e && e.message) || '生成失败');
      this.logger.error(`失败：${mindmapId} · ${msg} · 墙钟 ${Date.now() - t0}ms`);
      await this.fail(userId, mindmapId, snap, msg);
    }
  }

  /**
   * 转失败 + **还原胶囊**。
   *
   * ★ 还原是这一步的重点：胶囊在受理时就被 `consumedAt` 消费掉、从列表消失了。
   *   如果只把卡标失败、不还胶囊，用户的内容就**彻底没了**（卡是空的、胶囊也不回来）。
   *
   * ⚠️ 条件 `consumedAt: snap.startedAt` —— 只还原"我们自己消费的那一批"。
   *   用户如果在失败之前手动把某条胶囊删了（`deletedAt`），`consumedAt` 仍是我们写的值，
   *   还原后它会进「已删除」列表，仍然找得回来（这是对的：他删的是"已消费"的那条）。
   */
  private async fail(
    userId: string,
    mindmapId: string,
    snap: AiInputSnapshot | null,
    reason: string,
  ): Promise<void> {
    const now = nowStr();
    const short = cut(String(reason || '生成失败').replace(/\s+/g, ' '), 200);

    const r = await this.prisma.mindmap.updateMany({
      where: { id: mindmapId, userId, aiState: 'pending' },
      data: {
        aiState: 'failed',
        aiError: short,
        aiStartedAt: null,
        /* ★ 卡名也改掉，并把原点文本同步 —— "名称 == 原点文本"这条规则在失败态同样成立
           （否则打开完善抽屉时，卡上写"失败"、原点写"生成中"）。 */
        name: MM_AI_NAME_FAILED,
        treeJson: emptyTree(MM_AI_NAME_FAILED) as any,
        updatedAt: now,
      },
    });
    if (!r.count) return;

    const ids = (snap && snap.capsuleIds) || [];
    const startedAt = (snap && snap.startedAt) || '';
    if (ids.length && startedAt) {
      const back = await this.prisma.capsule.updateMany({
        where: { id: { in: ids }, userId, consumedAt: startedAt },
        data: { consumedAt: null },
      });
      this.logger.warn(`失败 ${mindmapId}：${short} → 还原胶囊 ${back.count}/${ids.length} 条`);
    }
  }

  /**
   * 清扫"卡住的 pending"。
   *
   * 单实例 pm2 部署：`pm2 reload` / 进程崩溃会**杀掉正在跑的后台任务**，
   * 而那张卡会永远停在 `pending`（前端一直画"生成中"，胶囊也不会回来）。
   * 启动时扫一遍，超时的直接转 failed（会顺手还原胶囊）。
   *
   * ⚠️ 判定线 10 分钟：正常一次 30–90 秒。宁可晚一点判死，也不要在任务还活着时
   *    把它标失败（那会出现"卡上写失败、几秒后树又突然出现了"）。
   */
  async sweep(): Promise<void> {
    const rows = await this.prisma.mindmap.findMany({
      where: { aiState: 'pending' },
      select: { id: true, userId: true, aiStartedAt: true, aiInput: true },
    });
    if (!rows.length) return;

    const now = Date.now();
    let n = 0;
    for (const r of rows) {
      const ts = Date.parse(String(r.aiStartedAt || '').replace(' ', 'T') + '+08:00');
      if (isFinite(ts) && now - ts < STUCK_MS) continue;
      let snap: AiInputSnapshot | null = null;
      try { snap = JSON.parse(String(r.aiInput || '{}')); } catch { snap = null; }
      await this.fail(r.userId, r.id, snap, '生成没有完成，请重试');
      n += 1;
    }
    if (n) this.logger.warn(`清扫：${n} 张卡住的脑图已转失败并还原胶囊`);
  }

  /* ══════════════════════════════════════════════════════════════════
   * 调模型
   * ══════════════════════════════════════════════════════════════════ */

  /**
   * 调方舟，返回**原始文本**（清洗交给解析器 —— 它认得围栏/前言，比在这里剥更全）。
   *
   * ★ 三个参数口径：
   *   · `stream: false` 显式 —— 后台任务没有"流式消费方"，写了只会让响应变成 SSE；
   *   · `reasoning_effort`：**不照搬 278 的 `'none'`**。278 是"改写文本"，不需要推理；
   *     本功能是结构化归纳，关掉很可能得到一堆扁平节点（等于白做）。默认取 `low`，
   *     用 `ARK_MINDMAP_EFFORT` 可覆盖（实测时就靠它，不用改代码）；传空串 = 不带该字段；
   *   · `temperature`：默认 0.3，`ARK_MINDMAP_TEMPERATURE` 可覆盖。
   */
  private async callModel(system: string, user: string, maxTokens: number): Promise<string> {
    const key = env('ARK_API_KEY');
    if (!key) {
      console.error('[mindmap-ai] ARK_API_KEY 未配置');
      throw new ApiException(CODE.SERVER, '生成服务未配置，请联系管理员');
    }
    const base = env('ARK_BASE_URL', 'https://ark.cn-beijing.volces.com/api/v3');
    const model = env('ARK_MODEL', 'deepseek-v4-1-flash-261017');
    const effort = env('ARK_MINDMAP_EFFORT', 'low');
    const temperature = Number(env('ARK_MINDMAP_TEMPERATURE', '0.3'));

    const body: any = {
      model,
      messages: [
        { role: 'system', content: system },
        /* ⚠️ `content` 必须是**纯字符串**，绝不许写成数组 —— 本功能的一条硬边界：
           模型**不看图**（图从来不在文本里，它以 `[[图N]]` 的形态出现）。
           一旦有人往这里塞 image_url，等于每张图几百上千 token、还要模型去"看图"。 */
        { role: 'user', content: user },
      ],
      temperature: isFinite(temperature) ? temperature : 0.3,
      max_tokens: maxTokens,
      stream: false,
    };
    if (effort) body.reasoning_effort = effort;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        signal: ctrl.signal,
        body: JSON.stringify(body),
      });
    } catch (e: any) {
      clearTimeout(timer);
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
      console.error('[mindmap-ai] ark fetch failed', aborted ? 'timeout' : (e && e.message));
      throw new Error(aborted ? '模型响应超时了' : '生成服务暂时不可用');
    }
    clearTimeout(timer);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error('[mindmap-ai] ark http', resp.status, text.slice(0, 500));
      throw new Error('生成服务暂时不可用');
    }

    const json: any = await resp.json().catch(() => null);
    const raw = json?.choices?.[0]?.message?.content;
    /* 日志只打用量与长度，**不打文本内容**（含用户原文） */
    console.log(
      '[mindmap-ai] usage',
      JSON.stringify({ prompt: json?.usage?.prompt_tokens, completion: json?.usage?.completion_tokens, reasoning: json?.usage?.completion_tokens_details?.reasoning_tokens, chars: typeof raw === 'string' ? raw.length : -1 }),
    );
    if (typeof raw !== 'string' || !raw.trim()) throw new Error('模型返回了空内容');
    return raw;
  }
}

/** 无 H1 时的兜底名：「语义转脑图 2026-10-27 15:04」（含时间，能看出是哪一次） */
function defaultName(): string {
  return '语义转脑图 ' + nowStr().slice(0, 16);
}
