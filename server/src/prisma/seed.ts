/**
 * 种子数据 —— 把 `小程序前端/utils/mock.js` 的那套演示数据灌进库。
 *
 * 数据来源：`prisma/seed-data.json`（由 `工具/gen_seed_data.js` 从 mock.js 抽取，签入仓库）。
 * 本脚本**不做任何数据搬运**，只做三件事：
 *   ① 把 mock 的**手填字符串**交给后端自己的函数解析（`balanceToCents` / `amountOf`）
 *      —— 同一个口径只有一个来源，否则"表单里填 128.40、回来变 128"这类偏差查不出来；
 *   ② 把日期补成 `YYYY-MM-DD HH:mm:ss`（§8.7 的定长约定：字典序＝时间序，切片即日期）；
 *   ③ **用 `normalizeTree()` 校验并重算 `nodeCount` / `depth`** —— 与线上写入路径同一个函数。
 *      第 86 轮真实踩过：mock 里 m6 写着 `nodes: 7`，而树实际是 10 枚节点，
 *      列表卡上那个「N 个节点」就一直是假的。让 seed 也走这道校验，同样的错会在灌库时被喊出来。
 *
 * ★ 只动**演示账号自己的**数据（全部 where 都带 userId），并且可反复执行：
 *   跑之前先清空该账号的 7 张表，跑完再灌 —— 不碰任何真人数据。
 *
 * 用法：
 *   npx prisma db seed                    # 或 npm run seed —— 完整演示数据（默认）
 *   node dist/prisma/seed.js accounts     # 或 npm run seed:accounts —— **只确保白名单**，空库初始化用
 *   SEED_OPENID=oXXXX npx prisma db seed
 */

import { PrismaClient } from '@prisma/client';
import { balanceToCents, amountOf } from '../common/money';
import { nowStr } from '../common/time';
import { normalizeTree } from '../common/tree';

const prisma = new PrismaClient();

// eslint-disable-next-line @typescript-eslint/no-var-requires
const DATA = require('../../prisma/seed-data.json');

/** 演示账号 —— 与真人 openid 分开，方便"这台库里有演示数据"一眼可见 */
const SEED_OPENID = process.env.SEED_OPENID || 'seed-demo-openid';
const SEED_NICKNAME = process.env.SEED_NICKNAME || '演示工位';

/** `'2026-08-02'` → `'2026-08-02 00:00:00'`；已经是完整时刻的原样返回 */
function toStamp(v: any): string | null {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  return s;
}

function required(v: any, what: string): string {
  const s = toStamp(v);
  if (!s) throw new Error(`seed-data.json 缺少${what}`);
  return s;
}

async function main() {
  /**
   * ★ 两种模式（`accounts` 于 2026-09-30 新增）：
   *   - `full`（默认）—— 灌完整演示数据，与前端 `utils/mock.js` 完全一致；
   *   - `accounts`     —— **只确保白名单**，业务表一行不灌（「空库初始化联调」用）。
   *
   * ⚠️ 为什么空库模式必须做在 seed 里：`prisma migrate reset` 在 package.json 配了
   *    `prisma.seed` 之后**会自动跑一次 seed** ⇒ 「重放迁移、但不要演示数据」这件事
   *    没法单靠 `migrate reset` 完成。所以让 seed 自己能只建账号，是最省事且唯一可靠的做法。
   *    （`migrate reset --skip-seed` 也行，但那样就得再单独跑一次账号初始化，两条命令。）
   *
   * 取值优先级：命令行第 1 个参数 > 环境变量 `SEED_MODE` > `full`。
   * 优先支持**参数形式**：它在 cmd 与 bash 下写法一致；环境变量形式在 cmd 里得先 `set`，容易踩坑。
   */
  const mode = String(process.argv[2] || process.env.SEED_MODE || 'full').toLowerCase();
  if (mode !== 'full' && mode !== 'accounts') {
    throw new Error(`SEED_MODE 只支持 full / accounts，收到的是 "${mode}"`);
  }

  console.log(`[seed] openid = ${SEED_OPENID}  mode = ${mode}`);

  // ---------- 1. 演示账号 + 白名单 ----------
  // 把演示账号和调试通道一起放进白名单，否则登录会在 1002 就被拦掉（§7.3）
  // ★ 去重：本机联调时 `DEV_OPENID` 与 `SEED_OPENID` **就是取同一个值**的
  //   （必须是同值，否则登录进去是另一个空白账号）。不去重的话日志会打出
  //   「白名单已确保 2 条：xxx, xxx」，看着像写了两条记录，实际只有一条。
  const allowOpenids = Array.from(
    new Set(
      [SEED_OPENID, process.env.DEV_OPENID, process.env.ADMIN_OPENID].filter(Boolean) as string[]
    )
  );
  for (const openid of allowOpenids) {
    await prisma.allowlist.upsert({
      where: { openid },
      update: {},
      create: {
        openid,
        note: openid === SEED_OPENID ? '演示账号（seed）' : '本机调试通道（seed 顺带加白）',
        createdAt: nowStr(),
      },
    });
  }
  console.log(`[seed] 白名单已确保 ${allowOpenids.length} 条：${allowOpenids.join(', ')}`);

  if (mode === 'accounts') {
    // ★ 到这里就返回：**不建 user、不碰任何业务表**。
    //   user 行交给首次 `POST /auth/login` 自己 upsert（见 `auth.service.ts` 的登录流程），
    //   这样顺带把「白名单 → 登录建号」这条链路也一起验了，比预建一行更接近真实首登。
    console.log('[seed] mode=accounts —— 只确保白名单，业务表一行不灌（空库初始化）');
    console.log('[seed] ✔ 完成 —— 项目 0 · agent 0 · 厂家 key 0 · 待办 0 · 胶囊 0 · 脑图 0');
    console.log(`[seed] 下一步：小程序登录用 openid = ${SEED_OPENID}（DEV_OPENID 已对齐）`);
    return;
  }

  const now = nowStr();
  const user = await prisma.user.upsert({
    where: { openid: SEED_OPENID },
    update: {},
    create: { openid: SEED_OPENID, nickname: SEED_NICKNAME, avatar: null, createdAt: now, updatedAt: now },
  });
  const userId = user.id;

  // ---------- 2. 清空该账号的旧数据（顺序受外键约束支配） ----------
  // TodoImage → Todo → Mindmap → Project → Capsule → Agent → TokenKey
  // ⚠️ 待办必须先于脑图删：Todo.mindmap 是 SetNull，先删脑图会触发一批无用回写；
  //    Project 最后删，因为 Todo.project 是 **Restrict**（数据安全网，§8.5）——
  //    待办还在时就删项目，DB 会直接拒绝。
  await prisma.todoImage.deleteMany({ where: { todo: { userId } } });
  await prisma.todo.deleteMany({ where: { userId } });
  await prisma.mindmap.deleteMany({ where: { userId } });
  await prisma.project.deleteMany({ where: { userId } });
  await prisma.capsule.deleteMany({ where: { userId } });
  await prisma.agent.deleteMany({ where: { userId } });
  await prisma.tokenKey.deleteMany({ where: { userId } });
  await prisma.asrQuota.deleteMany({ where: { userId } });
  console.log('[seed] 该账号的旧数据已清空');

  // ---------- 3. Agent ----------
  // 额度是**积分纯整数**（第四十二轮·补二）；手填串统一走 amountOf，取不到＝ null（未填，不是 0）
  for (const a of DATA.AGENTS) {
    const q1 = amountOf(a.quotaLeft);
    const q2 = amountOf(a.monthlyQuota);
    await prisma.agent.create({
      data: {
        id: a.id,
        userId,
        name: a.name,
        quotaLeft: q1 === null ? null : Math.round(q1),
        monthlyQuota: q2 === null ? null : Math.round(q2),
        quotaResetAt: a.quotaResetAt || null, // ★ 只记「日」的 'DD' 串（'01'–'31'），不是日期类型
        createdAt: now,
        updatedAt: toStamp(a.updatedAt) || now, // 「你上次手动改的时间」（FR-6.1）
      },
    });
  }

  // ---------- 4. 模型厂家 key ----------
  // 余额入库单位是**分**（§5.3 D-8）：mock 给的是手填串 '¥ 128.40'，交给 balanceToCents 解析
  for (const k of DATA.TOKEN_KEYS) {
    await prisma.tokenKey.create({
      data: {
        id: k.id,
        userId,
        vendor: k.vendor,
        balance: balanceToCents(k.balance), // '¥ 128.40' → 12840
        createdAt: toStamp(k.updatedAt) || now,
        updatedAt: toStamp(k.updatedAt) || now,
      },
    });
  }

  // ---------- 5. 项目 ----------
  // color 为 null 的项目走「8 色槽位之外」，与 @@unique([userId, color]) 相安无事
  // （MySQL 唯一索引里 NULL 不参与判重 —— 这正是"多个项目都可以不着色"能成立的原因）
  for (const p of DATA.PROJECTS) {
    await prisma.project.create({
      data: {
        id: p.id,
        userId,
        name: p.name,
        remark: p.remark || '',
        node: p.node,
        color: p.color || null,
        agentId: p.agentId || null,
        archivedAt: toStamp(p.archivedAt),
        createdAt: required(p.createdAt, `项目 ${p.id} 的 createdAt`),
        updatedAt: required(p.updatedAt, `项目 ${p.id} 的 updatedAt`),
      },
    });
  }

  // ---------- 6. 脑图（元信息 ＋ 树） ----------
  let treeWarn = 0;
  for (const m of DATA.MINDMAPS) {
    const raw = DATA.MINDMAP_TREE[m.id];
    if (!raw) throw new Error(`seed-data.json 里脑图 ${m.id} 没有对应的树`);

    // ★ 与线上写入口**同一个**校验函数：校验 + 归一化 + 重算派生值
    const { tree, nodeCount, depth } = normalizeTree(raw);

    if (nodeCount !== m.nodes || depth !== m.depth) {
      treeWarn += 1;
      console.warn(
        `[seed] ⚠️ 脑图 ${m.id}「${m.name}」的派生值与树对不上：` +
          `mock 写 nodes=${m.nodes}/depth=${m.depth}，树实际是 nodes=${nodeCount}/depth=${depth}` +
          ` —— 以树为准（列表卡显示的是重算值）`
      );
    }

    await prisma.mindmap.create({
      data: {
        id: m.id,
        userId,
        projectId: m.projectId,
        name: m.name,
        format: m.format,
        treeJson: tree as any,
        nodeCount,
        depth,
        createdAt: required(m.updatedAt, `脑图 ${m.id} 的 updatedAt`),
        updatedAt: required(m.updatedAt, `脑图 ${m.id} 的 updatedAt`),
      },
    });
  }

  // ---------- 7. 待办（＋图片） ----------
  let imageCount = 0;
  for (const t of DATA.TODOS) {
    const images = (t.images || []).map((img: any, idx: number) => ({
      id: img.id,
      uri: img.uri, // mock 是外链，urlFor() 会原样放行（见 common/upload.ts）
      label: img.label || null,
      sort: idx,
    }));
    imageCount += images.length;

    await prisma.todo.create({
      data: {
        id: t.id,
        userId,
        projectId: t.projectId,
        mindmapId: t.mindmapId || null,
        text: t.text,
        draftText: null,
        urgency: t.urgency,
        // ★ mock 是布尔 done，库里是字符串 status —— 两个口径的映射**只在这一处**
        status: t.done ? 'done' : 'open',
        createdAt: required(t.createdAt, `待办 ${t.id} 的 createdAt`),
        // 未完成必须为 null，否则热力图会永久多出一条并不存在的完成记录（§8.1）
        completedAt: t.done ? toStamp(t.completedAt) : null,
        updatedAt: required(t.updatedAt, `待办 ${t.id} 的 updatedAt`),
        images: images.length ? { create: images } : undefined,
      },
    });
  }

  // ---------- 8. 闪念胶囊 ----------
  // ★ 只写 createdAt。这张表没有 updatedAt，也不要给它补 —— 胶囊只贡献「创建」这一个数
  for (const c of DATA.CAPSULES) {
    await prisma.capsule.create({
      data: {
        id: c.id,
        userId,
        text: c.text || '',
        source: c.source || 'voice',
        createdAt: required(c.createdAt, `胶囊 ${c.id} 的 createdAt`),
      },
    });
  }

  // ---------- 9. 汇总 ----------
  const [p, a, k, t2, c2, m2] = await Promise.all([
    prisma.project.count({ where: { userId } }),
    prisma.agent.count({ where: { userId } }),
    prisma.tokenKey.count({ where: { userId } }),
    prisma.todo.count({ where: { userId } }),
    prisma.capsule.count({ where: { userId } }),
    prisma.mindmap.count({ where: { userId } }),
  ]);
  console.log(
    `[seed] ✔ 完成 —— 项目 ${p} · agent ${a} · 厂家 key ${k} · 待办 ${t2}（图片 ${imageCount}）` +
      ` · 胶囊 ${c2} · 脑图 ${m2}${treeWarn ? ` · ⚠️ ${treeWarn} 张脑图的派生值被纠正` : ''}`
  );
  console.log(`[seed] 演示账号 openid：${SEED_OPENID}`);
}

main()
  .catch((e) => {
    console.error('[seed] ✘ 失败：', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
