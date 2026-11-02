import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { bumpActivity } from '../common/activity';
import { TODO_IMAGE_MAX, URGENCIES } from '../common/constants';
import { PrismaService } from '../common/prisma.service';
import { todoOut } from '../common/shape';
import { nowStr } from '../common/time';
import { removeUpload } from '../common/upload';
import { CreateTodoDto, LinkCapsulesDto, TodoImageDto, UpdateTodoDto } from './dto/todo.dto';

@Injectable()
export class TodosService {
  private readonly logger = new Logger('Todos');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `GET /todos/:id` —— ★ **全项目唯一返回图片完整 URL 的接口**（§4.3.3 / §6.5）。
   * 列表与 `GET /sync` 都只给相对 uri：3 Mbps 带宽经不起预取。
   */
  async detail(userId: string, id: string) {
    const t = await this.prisma.owned<any>(this.prisma.todo, id, userId, '待办');
    const full = await this.prisma.todo.findUnique({ where: { id }, include: { images: true } });
    return todoOut(full || t, true);
  }

  /**
   * ★★ 199 轮：`POST /todos/:id/seen` —— 清掉这条待办的「刚转过来」提示。
   *
   * 触发时机：用户**真的打开了这条待办的详情**（用户口径：「用户在打开这个待办详情后，
   * 这个提示消失」）。只有 `promote-to-todo` 落下来的那条会带提示（`flashAt` 非空），
   * 手动新建的从来就是 `null` ⇒ 走到这里直接幂等返回。
   *
   * ★ 三条口径：
   *   ① **不刷 `updatedAt`** —— "看了一眼"不是"改了内容"。刷了会让这条在列表里被顶到最前
   *      （列表按 `updatedAt` 倒序），症状是"点开看一眼，顺序自己变了"，与那条
   *      「列表是更新时间的流水」的口径直接冲突。这也正是它**不能**复用 `PATCH /todos/:id` 的原因。
   *   ② **幂等** —— 没有提示时返回 `cleared: false`、不报错。多端同时看同一条是常态。
   *   ③ 与 `deletedAt` / `status` / `completedAt` **全不相干**：删除、完成、还原都不该顺手清它
   *      （它们都没说"我看过这条"）。
   */
  async markSeen(userId: string, id: string) {
    const t = await this.prisma.owned<any>(this.prisma.todo, id, userId, '待办');
    if (!t.flashAt) return { id, cleared: false };
    await this.prisma.todo.update({ where: { id }, data: { flashAt: null } });
    return { id, cleared: true };
  }

  /** `POST /todos` —— 创建（FR-3.6）。五条校验逐条对应 §6.5 的备注。 */  async create(userId: string, dto: CreateTodoDto) {
    const text = String(dto.text || '').trim();
    if (!text) throw ApiException.badParam('待办文字不能为空');

    const projectId = await this.assertProject(userId, dto.projectId);
    if (!(URGENCIES as readonly string[]).includes(dto.urgency)) {
      throw ApiException.badParam('紧急程度取值不合法');
    }
    // ④ mindmapId 可空；非空必须属于**同一个 projectId**（需求「候选范围只列归属项目下的脑图」）
    const mindmapId = await this.assertMindmapInProject(userId, dto.mindmapId, projectId);

    const now = nowStr();
    /* ★ 2026-10-09：创建待办 ⇒ 那一天的活跃度「创建」+1。
       ⚠️ 必须与建行**同一个事务** —— 分开写会出现"待办建了、计数没加"，
          热力图不会报错，只会**悄悄少一格**（见 common/activity.ts）。
       ⚠️ 传 `now` 而不是让它自己取：保证台账的 `day` 与这条的 `createdAt` 是**同一个自然日**。 */
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.todo.create({
        data: {
          // ★ 前端乐观更新时自带 id（可选）；不传就走 cuid 默认值
          id: dto.id || undefined,
          userId,
          projectId,
          mindmapId,
          text,
          urgency: dto.urgency,
          status: 'open',
          createdAt: now,
          completedAt: null,
          updatedAt: now,
          images: { create: this.imageRows(dto.images) },
        },
        include: { images: true },
      });
      await bumpActivity(tx, userId, 'created', now);
      return created;
    });
    return todoOut(row, false);
  }

  /**
   * `PATCH /todos/:id` —— 编辑（FR-3.9）。
   *
   * ★ `updatedAt` 由**这里**刷新（不是靠 DB 默认值）：列表抽屉按它倒序、
   *   卡上显示"更新于 X"。需求里「点已选中的格式不刷时间」那类口径属于脑图 format 的交互，
   *   由**前端决定要不要发请求** —— 后端**刻意不做"内容相同就不更新"的智能判断**
   *   （那种判断是隐蔽的副作用源，§6.5 备注）。
   *
   * ★★ 160 轮：**已删除的待办不给编辑**（`ownedAlive`）—— 它在界面上只有「还原」一颗键，
   *   能改内容的那几条路必须先还原（口径与"删除之后它就只是一条归档记录"一致）。
   */
  async update(userId: string, id: string, dto: UpdateTodoDto) {
    const cur = await this.ownedAlive(userId, id);

    const data: any = { updatedAt: nowStr() };

    if (dto.text !== undefined) {
      const text = String(dto.text).trim();
      if (!text) throw ApiException.badParam('待办文字不能为空');
      data.text = text;
    }
    if (dto.urgency !== undefined) data.urgency = dto.urgency;

    // —— 归属项目变更 ——
    let projectId = cur.projectId;
    if (dto.projectId !== undefined) {
      projectId = await this.assertProject(userId, dto.projectId);
      data.projectId = projectId;
    }

    // —— 脑图关联：显式 null = 清空；undefined = 不动；有值 = 校验归属 ——
    if (dto.mindmapId !== undefined) {
      data.mindmapId = await this.assertMindmapInProject(userId, dto.mindmapId, projectId);
    } else if (dto.projectId !== undefined && cur.mindmapId) {
      // ★ 联动规则①：**换项目时旧关联自动置空**（需求原文「换项目时旧关联自动置空」）
      //   判据是"那张脑图还在不在新项目下"—— 在的话没必要清（前端也允许跨项目保留同一张图的引用吗？
      //   不允许，所以只要不在新项目下就置空）。
      const mm = await this.prisma.mindmap.findFirst({ where: { id: cur.mindmapId, userId } });
      if (!mm || mm.projectId !== projectId) data.mindmapId = null;
    }

    // —— 图片整体替换（增量 diff：只删真的被去掉的那几张的磁盘文件） ——
    let orphanUris: string[] = [];
    if (dto.images !== undefined) {
      const rows = this.imageRows(dto.images);
      const keep = new Set(rows.map((r) => r.uri));
      const old = await this.prisma.todoImage.findMany({ where: { todoId: id } });
      orphanUris = old.map((o) => o.uri).filter((u) => !keep.has(u));
      data.images = { deleteMany: {}, create: rows };
    }

    const row = await this.prisma.todo.update({ where: { id }, data, include: { images: true } });

    // 文件删除**异步、不阻塞响应**：行已经删了，用户看到的是成功（§8.5）
    orphanUris.forEach((u) => void removeUpload(u));

    return todoOut(row, false);
  }

  /**
   * ★★ 248 轮：`POST /todos/:id/capsules` —— 把选中的**闪念胶囊**关联到这条待办。
   *
   * 用户口径（2026-10-23）：
   *   ② 「点击『+选择胶囊』弹出选择胶囊的抽屉（主抽屉），……**可多选卡片**，
   *      底部按键为『取消』『保存』，无胶囊新增按钮」
   *   ④ 「**在建立关联时，胶囊信息需要从闪念胶囊中移除**（和转脑图、转待办后的
   *      胶囊列表数据的操作一致）」
   *
   * ── 三条实现口径（改代码前先读）────────────────────────────────────
   * ① **"从列表移除"复用 `consumedAt`，不新造字段**：关联 / 转待办 / 转脑图在
   *    列表可见性上完全一致（`store.capsules()` 一条判据挡住三种），差别只在
   *    "还能不能回到列表"—— 那由 `todoId` 回答（解除关联会把它清空）。
   *    新造一个 `linkedAt` 只会让"这条胶囊到底算不算在列表里"变成两处判断。
   * ② **只认"干净"的胶囊**：`deletedAt: null`（没被删）＋ `consumedAt: null`（没被转走 /
   *    没被关联过）＋ `todoId: null`（冗余的一道，防并发）。前端拿着陈旧快照（比如
   *    另一端刚把它转成待办）是常态 ⇒ 传进来只关联成功一部分，**不报错**，
   *    返回值里的 `linked` 是**真的写进去几条**（与 `promoteToMindmap` 的 `addedCount`
   *    同一条纪律：不能报"请求里有几条"）。
   * ③ **刷 `updatedAt`**：这条待办的内容确实变了（详情页多了一块）——
   *    与「加一张图片」走 `PATCH /todos/:id` 的效果同口径。
   *    ⚠️ **但不动活跃度台账**：关联不是"创建 / 完成 / 接住"三个动作中的任何一个
   *      （`common/activity.ts` 的黑名单口径），概览统计不该因为整理动作而上涨。
   *
   * ⚠️ 已删除的待办不给关联（`ownedAlive`）—— 那一档在界面上只有「还原」一颗键。
   */
  async linkCapsules(userId: string, id: string, dto: LinkCapsulesDto) {
    await this.ownedAlive(userId, id);
    const ids = Array.from(new Set((dto.capsuleIds || []).map(String).filter(Boolean)));
    if (!ids.length) return { todoId: id, capsuleIds: [], linked: 0 };

    /* 先确认这些 id 真的存在且可用 —— 不能直接 `updateMany({id:{in}})`：
       选了别人的 / 已删的 id 应当安静地"关联 0 条"，而不是把别人的胶囊挂到自己名下。 */
    const caps = await this.prisma.capsule.findMany({
      where: { id: { in: ids }, userId, deletedAt: null, consumedAt: null, todoId: null },
      select: { id: true },
    });
    const ok = caps.map((c) => c.id);
    if (!ok.length) return { todoId: id, capsuleIds: [], linked: 0 };

    const now = nowStr();
    const linked = await this.prisma.$transaction(async (tx) => {
      /* 条件再写一遍（`consumedAt: null, todoId: null`）：两个端同时把这枚胶囊
         关到不同待办上时，后到的那次只更新 0 条 —— 而不是悄悄改掉前一次的归属。 */
      const r = await tx.capsule.updateMany({
        where: { id: { in: ok }, userId, deletedAt: null, consumedAt: null, todoId: null },
        data: { todoId: id, consumedAt: now },
      });
      await tx.todo.update({ where: { id }, data: { updatedAt: now } });
      return r.count;
    });

    this.logger.log(`胶囊 [${ok.join(',')}] → 关联到待办 ${id}（${linked} 条）`);
    return { todoId: id, capsuleIds: ok, linked };
  }

  /**
   * ★★ 248 轮：`DELETE /todos/:id/capsules` —— **解除关联**，胶囊回到闪念胶囊列表。
   *
   * 用户口径（2026-10-23 第 5 条，逐字）：
   *   「如果待办和胶囊解除关联信息，该信息会回到闪念胶囊列表，但是这个过程**不算新增胶囊，
   *     不计入概览统计**，此时胶囊信息的**创建时间为解除关联的时间**，胶囊信息最开始的
   *     创建时间无需保存」。
   *
   * ── 三个字段各自为什么要动（少一个都会出问题）─────────────────────────
   *   · `todoId → null`      —— 归属断开（`GET /sync` 靠它挑"关联在待办上的那批"）；
   *   · `consumedAt → null`  —— **这是"回到列表"的唯一开关**：`store.capsules()` 的判据是
   *                             `!deleted && !consumed`，不清它胶囊就永远隐身；
   *   · `createdAt = now`    —— 用户明写「创建时间为解除关联的时间」。列表按 `createdAt`
   *                             **正序**（越早越靠上）⇒ 重置后它排到**末尾**，等于"刚回来的
   *                             那条在最后"，与"刚接住一枚"观感一致。
   *      ⚠️ 原创建时间**直接覆盖、不留副本** —— 用户明写「最开始的创建时间无需保存」。
   *         别出于"以后可能有用"再补一个 `origCreatedAt`：热力图读的是活跃度台账
   *         （`activity.ts`），早就不用胶囊的 `createdAt` 了，留副本没有任何消费者。
   *   · **不调 `bumpActivity`** —— "回到列表"不是"新接住一枚"（用户明写不计入统计）。
   *     这一条最容易写错：`POST /capsules` 那条路会 +1，但解绑这条路**不是创建**。
   *
   * ⚠️ 只解绑**确实挂在这条待办上**的胶囊（`todoId: id`）——
   *    前端传了别的待办的 id 只会"解绑 0 条"，不会把别人的关联拆掉。
   * ⚠️ 已删除的待办不给解绑（`ownedAlive`）：界面上那一档不渲染这个入口。
   *    软删时**不解绑** —— 还原之后详情页应当还是原来那几张胶囊。
   */
  async unlinkCapsules(userId: string, id: string, dto: LinkCapsulesDto) {
    await this.ownedAlive(userId, id);
    const ids = Array.from(new Set((dto.capsuleIds || []).map(String).filter(Boolean)));
    if (!ids.length) return { todoId: id, capsuleIds: [], unlinked: 0 };

    const now = nowStr();
    const unlinked = await this.prisma.$transaction(async (tx) => {
      const r = await tx.capsule.updateMany({
        where: { id: { in: ids }, userId, todoId: id },
        data: { todoId: null, consumedAt: null, createdAt: now },
      });
      await tx.todo.update({ where: { id }, data: { updatedAt: now } });
      return r.count;
    });

    this.logger.log(`胶囊 [${ids.join(',')}] ← 从待办 ${id} 解除关联（${unlinked} 条，回到列表末尾）`);
    return { todoId: id, capsuleIds: ids, unlinked };
  }

  /**
   * `POST /todos/:id/complete` —— 写 `completedAt` **并给台账 +1**。
   *
   * ★ 2026-10-09 改：热力图不再靠读 `completedAt` 反推（那会被 reopen 清掉），
   *   而是在这里给活跃度台账的「完成」**记一次动作**。
   *   勾完成 → 取消 → 再勾 ⇒ 记 **2** 次（用户拍板：记动作次数，不去重）。
   */
  async complete(userId: string, id: string) {
    await this.ownedAlive(userId, id);
    const now = nowStr();
    const row = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.todo.update({
        where: { id },
        data: { status: 'done', completedAt: now, updatedAt: now },
        include: { images: true },
      });
      await bumpActivity(tx, userId, 'completed', now);
      return updated;
    });
    return todoOut(row, false);
  }

  /**
   * `POST /todos/:id/reopen` —— ★ **`completedAt` 必须置 null**（§8.1 硬要求 1）。
   *
   * 忘了置空不会报错，而 `completedAt` 表达的是「这条**当前**是什么状态」，
   * 留着它就等于一条明明没完成的待办挂着完成时刻（详情页 / 列表都要读它）。
   *
   * ★★ 2026-10-09 补充（**别在这里减台账**）：
   *   热力图自本轮起**不再读 `completedAt`**（它读活跃度台账），所以"取消完成"是
   *   「当时确实完成过一次」这个**历史事实**的一部分 —— 台账里那一次**不减**。
   *   台账一旦回退，就又变回用户报的那个缺陷（统计"现在还剩下什么"）。
   */
  async reopen(userId: string, id: string) {
    await this.ownedAlive(userId, id);
    const row = await this.prisma.todo.update({
      where: { id },
      data: { status: 'open', completedAt: null, updatedAt: nowStr() },
      include: { images: true },
    });
    return todoOut(row, false);
  }

  /**
   * `DELETE /todos/:id` —— ★★ 160 轮起是**逻辑删除（软删）**，**不再真删**。
   *
   * 用户口径（2026-10-12）：*「优化一下待办信息和闪念胶囊的删除逻辑，需要将其改为逻辑删除，
   *   通过在数据库中新增字段的形式来去区分正常和删除」*。
   *
   * ── 与改前（物理删除）的三处**必须一起想**的差别 ─────────────────────────
   *   ① **不删 `todo_image` 行、也不删磁盘文件**。改前靠 `onDelete: Cascade` 连行带图一起没了
   *      （还顺手 `removeUpload()`）；现在整条数据都留着，还原之后图**还在**。
   *      ⇒ 这是"删除可还原"从设计上讲得通的前提：还原回来必须长得跟删之前一样。
   *   ② **同时刷 `updatedAt`** —— 已删除列表按更新时间倒序读，等于"按删除时间倒序"，
   *      刚删的排最前（用户找它多半就是在那一下之后）。不刷的话它会按老时间沉到中间。
   *   ③ **不碰 `status` / `completedAt`**（"在不在"与"什么状态"是两回事）——
   *      但**还原**时按用户口径一律回到「未完成」，那一步在 `restore()` 里做。
   *
   * ★★ **这里依然不碰活跃度台账**（2026-10-09 定的口径，软删之后更不必碰了）：
   *   "那天创建过 3 条待办"是已经发生过的事实 —— 删掉（现在是"标记删掉"）其中一条
   *   不会让时间倒退。这也是当初修掉的那个缺陷（原来靠遍历现存待办现算 ⇒ 删除会让历史变浅）。
   */
  async remove(userId: string, id: string) {
    const t = await this.prisma.owned<any>(this.prisma.todo, id, userId, '待办');
    /* 幂等：重复删不报错（软删之后再删一次仍是"它已被删"这个事实）。
       改前是 `delete()`，第二次会抛 P2025 ⇒ 前端拿到 50000。 */
    if (t.deletedAt) return todoOut(t, false);
    const now = nowStr();
    const row = await this.prisma.todo.update({
      where: { id },
      data: { deletedAt: now, updatedAt: now },
      include: { images: true },
    });
    this.logger.log(`待办 ${id} → 已删除（软删，可还原）`);
    return todoOut(row, false);
  }

  /**
   * `POST /todos/:id/restore` —— ★★ 160 轮新增：**还原**一条已删除的待办。
   *
   * ★★ 状态口径（**用户 2026-10-12 拍板**）：还原后**一律回到「未完成」**，
   *   而不是"回到删除前的状态"。所以这里同时清掉 `completedAt` ——
   *   这不是顺手的：`completedAt` 表达的是「这条**当前**是什么状态」（§8.1 硬要求 1），
   *   留着它就会出现"一条 status=open 却挂着完成时刻"的待办，详情页与列表都会读错。
   *
   * ⚠️ `updatedAt` 也刷 —— 它与 `deletedAt` 一起回到"刚动过"，
   *    于是它立刻出现在「未完成」列表的**最上面**（用户的下一步动作就是处理它）。
   * ⚠️ **幂等**：对一条没被删的待办调它，返回当前状态、什么都不改（不报错）。
   *    前端在"还原"那把闸门（只有已删除态才给这颗键）之外，服务端不必再挑一次错。
   *
   * ★ **不补记台账**：台账记的是"创建 / 完成 / 接住"这三个**动作**，
   *   "还原"不是其中任何一个 —— 给它在台账里加一列会污染热力图的语义
   *   （那是本轮明确不许做的第二件事，见 common/activity.ts 的黑名单）。
   */
  async restore(userId: string, id: string) {
    const t = await this.prisma.owned<any>(this.prisma.todo, id, userId, '待办');
    if (!t.deletedAt) return todoOut(await this.prisma.todo.findUnique({ where: { id }, include: { images: true } }), false);
    const now = nowStr();
    const row = await this.prisma.todo.update({
      where: { id },
      data: { deletedAt: null, status: 'open', completedAt: null, updatedAt: now },
      include: { images: true },
    });
    this.logger.log(`待办 ${id} ← 已还原（回到「未完成」）`);
    return todoOut(row, false);
  }

  /**
   * 取一条**未删除**的待办（改内容 / 改状态的三条路都先过它）。
   * ⚠️ 与 `detail()` / `remove()` / `restore()` 用的 `owned()` **有意不同**：
   *    那三条本来就要能看见已删除的那一条（详情要显示它、「还原」要找到它）。
   */
  private async ownedAlive(userId: string, id: string) {
    const t = await this.prisma.owned<any>(this.prisma.todo, id, userId, '待办');
    if (t.deletedAt) throw ApiException.badParam('这条待办已被删除，请先「还原」');
    return t;
  }

  /** 归属校验：项目必须存在且属于自己 */
  private async assertProject(userId: string, projectId: string): Promise<string> {
    const pid = String(projectId || '').trim();
    if (!pid) throw ApiException.badParam('必须选择归属项目'); // FR-3.3：单级归属必填
    const p = await this.prisma.project.findFirst({ where: { id: pid, userId } });
    if (!p) throw ApiException.badParam('归属项目不存在');
    return pid;
  }

  /**
   * 脑图归属校验：非空时必须属于**同一个项目**。
   * （跨项目关联会让"这条待办挂在别的项目的脑图上"，读起来自相矛盾 —— 43 轮定下的规则。）
   */
  private async assertMindmapInProject(
    userId: string,
    mindmapId: string | null | undefined,
    projectId: string,
  ): Promise<string | null> {
    const mid = mindmapId ? String(mindmapId).trim() : '';
    if (!mid) return null;
    const m = await this.prisma.mindmap.findFirst({ where: { id: mid, userId } });
    if (!m) throw ApiException.badParam('关联的脑图不存在');
    if (m.projectId !== projectId) {
      throw ApiException.badParam('只能关联归属项目下的脑图');
    }
    return mid;
  }

  /** 图片行 —— id 一律由服务端生成（不采信客户端传的 id，防"改到别人的图片行"） */
  private imageRows(images: TodoImageDto[] | undefined) {
    const list = Array.isArray(images) ? images : [];
    if (list.length > TODO_IMAGE_MAX) {
      throw ApiException.badParam(`最多 ${TODO_IMAGE_MAX} 张图片`);
    }
    return list.map((img, idx) => ({
      uri: String(img.uri || '').trim(),
      label: img.label ? String(img.label) : null,
      sort: typeof img.sort === 'number' ? img.sort : idx,
    })).filter((r) => r.uri);
  }
}
