import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { bumpActivity } from '../common/activity';
import { PrismaService } from '../common/prisma.service';
import { capsuleOut, todoOut } from '../common/shape';
import { nowStr } from '../common/time';
import { appendCapsuleChildren, countNodes, depthOf, normalizeTree } from '../common/tree';
import { CreateCapsuleDto, PromoteToMindmapDto, PromoteToTodoDto, UpdateCapsuleDto } from './dto/capsule.dto';

/**
 * 闪念胶囊（FR-9 · §6.7）
 *
 * 三条与别处**有意不同**的口径（改代码前先读）：
 *   ① **按创建时间正序**（越早越靠上）—— 它记的是"我当时怎么想的"，顺序本身就是信息；
 *   ② **接住时没有归属** —— 不挂 projectId / mindmapId。归属是"整理"那一步的产物，
 *      接住的时候不该逼用户先想清楚（这正是这个功能存在的理由）。
 *      ★★ 248 轮：整理多了一条落点 —— **关联到某条待办**（`Capsule.todoId`）。
 *      那一步在 `todos.service.linkCapsules()` 里做（因为它是"待办多了一块内容"），
 *      并且和转待办 / 转脑图一样把胶囊标成**已消费**（从列表消失，见 schema 的字段注释）。
 *   ③ **「识别中」不进数据** —— 那句占位只活在组件状态里，识别文本回来才写进 `text`。
 */
@Injectable()
export class CapsulesService {
  private readonly logger = new Logger('Capsules');

  constructor(private readonly prisma: PrismaService) {}

  /** `POST /capsules` —— 接住一段口播（允许空文本） */
  async create(userId: string, dto: CreateCapsuleDto) {
    const now = nowStr();
    const imageUri = this.ownImage(userId, dto.imageUri);
    /* ★ 2026-10-09：接住一枚胶囊 ⇒ 那一天活跃度「胶囊」+1（同事务，见 common/activity.ts）。
       ⚠️ 记的是**创建**那一刻：识别文本异步回来走的是 `PATCH /capsules/:id`，
          那一次**不记**（改错字不是新接住一枚）。 */
    const row = await this.prisma.$transaction(async (tx) => {
      const created = await tx.capsule.create({
        data: {
          // ★ 客户端自带 id（可选）—— 胶囊这里尤其要紧：口播落下后，
          //   识别文本是**异步**回来的，必须能立刻写回同一条，中间不能有 id 替换
          id: dto.id || undefined,
          userId,
          text: dto.text === undefined || dto.text === null ? '' : String(dto.text),
          source: dto.source || 'voice',
          // ★★ 263 轮：挂图（`null` ＝ 没挂）—— 上传先于建条，所以这里一次性带上，
          //   不必"先建空壳再补一张图"（那会多一次 PATCH、也多一个中间态）
          imageUri,
          // ★ 只写 createdAt。这张表**没有** updatedAt（§8.1 硬要求 2）：
          //   胶囊只贡献"创建"这一个数，不要为了"两列对齐"给它补对称字段。
          createdAt: now,
        },
      });
      await bumpActivity(tx, userId, 'capsule', now);
      return created;
    });
    return capsuleOut(row);
  }

  /**
   * `PATCH /capsules/:id` —— 就地改错字。
   *
   * ★ **不得刷新 `createdAt`**（需求 §7.1 口径②）：「改一个错字不该让它跳到末尾」。
   *   所以这里**只写 text** —— 连 `updatedAt` 都没有（表里根本没这个字段，想刷也刷不了）。
   *
   * ★★ 160 轮：**已删除 / 已被消费的胶囊不给改**（与 `todos.service.ownedAlive` 同一条）——
   *   避免出现"在「已删除胶囊」列表里长按还能改字"这种自相矛盾的路。
   */
  async update(userId: string, id: string, dto: UpdateCapsuleDto) {
    const c = await this.prisma.owned<any>(this.prisma.capsule, id, userId, '胶囊');
    if (c.deletedAt) throw ApiException.badParam('这枚胶囊已被删除，请先「还原」');
    /* ★★ 248 轮：`consumedAt` 现在有两种来路 —— 被转成待办 / 脑图，或**被关联到某条待办**
       （`todoId` 非空）。两者在"不许就地改"上完全一致：内容已经在别处被人看着了，
       在这儿改一个字，那一边不会跟着变（用户口径：「卡片信息只能查看不能编辑」）。 */
    if (c.consumedAt) throw ApiException.badParam('这枚胶囊已经转成待办 / 脑图，或已关联到待办，不能再改');
    const data: any = {};
    if (dto.text !== undefined) data.text = String(dto.text == null ? '' : dto.text);
    /* ★★ 263 轮：换图 / 撤图 —— **三态**必须分清（DTO 那边有注释）：
       · `undefined` ⇒ 一个字都不动（改错字的每一次 PATCH 都会带上整条对象，
         若把"没传"当成"撤图"，那用户每改一个错字图就没了）；
       · `null` / `''` ⇒ 显式撤掉；
       · 相对 uri ⇒ 换成这一张（上限 1 张，旧的让位 —— 磁盘上的旧文件不在这里删，
         与 `todos` 换图的取舍同一条：删文件是独立动作，一个删不掉不该让写库失败）。 */
    if (dto.imageUri !== undefined) data.imageUri = this.ownImage(userId, dto.imageUri);
    const row = await this.prisma.capsule.update({ where: { id }, data });
    return capsuleOut(row);
  }

  /**
   * ★★ 263 轮：**图片路径的归属校验 ＋ 归一化**（`create` / `update` 共用这一个口子）。
   *
   * 口径：
   *   · 没传 / 空串 / `null` ⇒ `null`（没挂图）；
   *   · 传了 ⇒ 必须**以 `<userId>/` 开头**——`relPathFor()` 产出的相对路径就是这个形状
   *     （见 `common/upload.ts`）。别人的 uri 落到自己名下，等于给了"引用任意用户图片"
   *     的能力（文件接口虽然要鉴权，但 `GET /files/<uri>` 是按路径直出的静态目录）。
   * ⚠️ 形状白名单（不许 `../`、不许完整 URL）在 DTO 的 `@Matches` 里做 ——
   *   这一层只回答"是不是你的"，两件事分开、各答各的。
   */
  private ownImage(userId: string, uri: string | null | undefined): string | null {
    const v = (uri === undefined || uri === null) ? '' : String(uri).trim();
    if (!v) return null;
    if (v.indexOf(userId + '/') !== 0) {
      throw ApiException.badParam('图片不属于当前账号，请重新上传');
    }
    return v;
  }

  /**
   * `DELETE /capsules/:id` —— ★★ 160 轮起是**逻辑删除（软删）**，不再真删。
   * 口径与 `DELETE /todos/:id` 同一套（见 `todos.service.ts` 的长注释）：
   * 盖一个 `deletedAt` 时刻；「正常列表」的判据是 `deletedAt` 与 `consumedAt`
   * **都为 null**（★ 248 轮：`GET /sync` 另外还会下发"关联在待办上的"那批，
   * 见 `sync.service.ts` 的 `OR` 条件），前端据此提供「已删除胶囊」列表 ＋ 「还原」。
   *
   * ⚠️ 软删**不动 `todoId`**（248 轮）：一条正关联在待办上的胶囊被删掉之后，
   *    「已删除胶囊」里还能还原它；还原回来 `deletedAt` 一清，它**仍然挂在原来那条
   *    待办上**（内容本来就没搬家）。在这里顺手清掉关联，会造出"内容还在、
   *    但详情页少一张卡"的半截状态 —— 那是另一个动作（`DELETE /todos/:id/capsules`）。
   */
  async remove(userId: string, id: string) {
    const c = await this.prisma.owned<any>(this.prisma.capsule, id, userId, '胶囊');
    if (c.deletedAt) return capsuleOut(c);   // 幂等：再删一次不报错（改前是 P2025 ⇒ 50000）
    const row = await this.prisma.capsule.update({
      where: { id },
      data: { deletedAt: nowStr() },
    });
    this.logger.log(`胶囊 ${id} → 已删除（软删，可还原）`);
    return capsuleOut(row);
  }

  /** `DELETE /capsules` —— 批量删除（多选模式用；比 N 次请求省得多） */
  async removeMany(userId: string, ids: string[]) {
    const list = (ids || []).map(String).filter(Boolean);
    if (!list.length) return { deleted: 0 };
    // 条件里带 userId —— 传了别人的 id 只会"删 0 条"，而不是删掉别人的东西
    const r = await this.prisma.capsule.updateMany({
      where: { id: { in: list }, userId, deletedAt: null },   // ★ 已删的不重复盖时刻（幂等）
      data: { deletedAt: nowStr() },
    });
    return { deleted: r.count, requested: list.length };
  }

  /**
   * `POST /capsules/restore` —— ★★ 160 轮新增：**还原**选中的已删除胶囊。
   *
   * ★ 与待办那边的差别（**用户 2026-10-12 拍板**）：胶囊没有状态，还原就是**清掉 `deletedAt`**，
   *   内容、顺序（`createdAt` 正序）一个字都不改 —— "它还回到原来那个位置"。
   * ★ 批量（数组）而不是单条：入口是「已删除胶囊」列表的多选，
   *   与 `DELETE /capsules` 对称（同一条路，只是方向相反）。
   * ⚠️ 条件带 `userId` ＋ `deletedAt: { not: null }`：前者是用户隔离（与所有路由同一条铁律），
   *   后者让"还原一条正常的胶囊"变成**无操作**而不是报错（幂等，前端不必先自查）。
   * ⚠️ **不碰 `consumedAt`**：「被消费」的那批压根不在可还原名单里
   *   （用户口径：只有手动删除才进「已删除胶囊」）—— 它连 `deletedAt` 都没有，这里自然选不中。
   */
  async restoreMany(userId: string, ids: string[]) {
    const list = (ids || []).map(String).filter(Boolean);
    if (!list.length) return { restored: 0 };
    const r = await this.prisma.capsule.updateMany({
      where: { id: { in: list }, userId, deletedAt: { not: null } },
      data: { deletedAt: null },
    });
    this.logger.log(`胶囊 [${list.join(',')}] ← 已还原 ${r.count} 条`);
    return { restored: r.count, requested: list.length };
  }

  /**
   * ★★ 277 轮 · 转待办时的图片清单 ＝ **胶囊挂的图（在前）＋ 调用方给的图**。
   *
   * 三条口径（与前端 `store.capsuleImagesForTodo()` 逐条同源，改一处必须回头看另一处）：
   *   ① **胶囊的图排最前** —— 它是这条待办的"现场截图"，后来补的图跟在后面；
   *   ② **按 `uri` 去重** —— `imageUri` 是文件名级唯一，两条胶囊挂同一张图只该存一份
   *      （详情页出现两张一样的图是肉眼可见的错，也会让导出多一行重复链接）；
   *   ③ **`sort` 重排成 0…n-1** —— `dto.images` 自带 `sort` 时会与前面的序号撞车，
   *      而详情页 / 导出都按 `sort` 升序读（`shape.sortImages()`）⇒ 撞了就顺序不稳。
   *
   * ⚠️ 胶囊顺序按 `createdAt` 正序（与胶囊列表同一把尺：早的在前）——
   *    `findMany({ id: { in } })` 的返回顺序**不保证**，别直接拿它排。
   * ⚠️ 没有图的胶囊不产生条目（`imageUri` 为 null 是本轮之前那批历史数据）。
   */
  private imagesOfPromotion(capsules: any[], dtoImages: any[]) {
    const out: { uri: string; label: string | null; sort: number }[] = [];
    const seen = new Set<string>();

    const ordered = (capsules || [])
      .slice()
      .sort((a, b) =>
        String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
        String(a.id || '').localeCompare(String(b.id || '')));

    ordered.forEach((c) => {
      const uri = String(c && c.imageUri ? c.imageUri : '').trim();
      if (!uri || seen.has(uri)) return;
      seen.add(uri);
      out.push({ uri, label: `胶囊图片 ${out.length + 1}`, sort: 0 });
    });

    (dtoImages || []).forEach((img) => {
      const uri = String((img && img.uri) || '').trim();
      if (!uri || seen.has(uri)) return;
      seen.add(uri);
      out.push({ uri, label: img.label ? String(img.label) : null, sort: 0 });
    });

    return out.map((r, idx) => Object.assign({}, r, { sort: idx }));
  }

  /**
   * `POST /capsules/:id/promote-to-todo` —— ★ **必须原子**（§6.7）。
   *
   * 需求 §9.5：「表单提交成功之后才把气泡删掉」。若分两次请求，
   * 第二次失败就会留下「待办建了、气泡还在」的脏数据 —— 用户下次会看到同一件事记了两遍。
   * 所以「创建待办」与「消费掉胶囊」必须在**同一事务**里。
   *
   * ★★ 160 轮：「消费掉」从 `deleteMany` 改成 `updateMany({ consumedAt })` ——
   *   这条路**不是**用户点「删除」，所以它**不进**「已删除胶囊」列表（用户口径）。
   *   两个字段分开正是为了这句话：`deletedAt` ＝ 手动删除（可还原），
   *   `consumedAt` ＝ 被消化（不可还原 —— 内容已经在待办里了）。
   */
  async promoteToTodo(userId: string, capsuleId: string, dto: PromoteToTodoDto) {
    const capsule = await this.prisma.owned<any>(this.prisma.capsule, capsuleId, userId, '胶囊');

    const text = String(dto.text === undefined ? capsule.text || '' : dto.text || '').trim();
    if (!text) throw ApiException.badParam('待办文字不能为空');

    const project = await this.prisma.project.findFirst({ where: { id: String(dto.projectId || ''), userId } });
    if (!project) throw ApiException.badParam('归属项目不存在');

    /* 关联脑图（可选）—— 必须**同时属于本项目**。前端表单里"归属项目一变就清空脑图"
       那条规则只作用于它自己的界面，后端不能假设它一定守规矩：
       跨项目的关联会让「待办详情 → 点脑图」跳到一张不属于这个项目的图。 */
    let mindmapId: string | null = null;
    if (dto.mindmapId) {
      const mm = await this.prisma.mindmap.findFirst({
        where: { id: String(dto.mindmapId), userId, projectId: project.id },
        select: { id: true },
      });
      mindmapId = mm ? mm.id : null;   // 对不上就当作"没填"，不报错（那是前端的陈旧选项）
    }

    /* ★★ 160 轮：只认**还活着**的胶囊 —— `deletedAt: null`（没被删）＋ `consumedAt: null`
       （没被消费过）。少了前者会把一条已删胶囊再消费一次（它的内容已在待办里，
       用户还原之后会看到同一段话两处）；少了后者会在重复提交时二次消费。
       ⚠️ 用 `findMany` 而不是直接 `updateMany({id: {in}})` —— 要先确认这些 id 真的存在且可用
       （前端传了已经删掉的 id 不该算失败）。 */
    const wanted = Array.from(new Set([capsuleId, ...(dto.capsuleIds || []).map(String)])).filter(Boolean);
    const consumed = await this.prisma.capsule.findMany({
      where: { id: { in: wanted }, userId, deletedAt: null, consumedAt: null },
      /* ★★ 277 轮：多取 `imageUri` / `createdAt` —— 转出来的待办要继承胶囊挂的那张图，
         而继承的顺序按胶囊自己的先后（见 `imagesOfPromotion()`） */
      select: { id: true, imageUri: true, createdAt: true },
    });
    const consumedIds = consumed.map((c) => c.id);

    const now = nowStr();
    /* ★★ 277 轮：**胶囊的图并进待办的图**（用户口径 2026-10-27 第 1 条）。
       ── 为什么后端也要做一遍（前端 `store.promoteCapsulesToTodo` 已经会把它塞进 `images`）──
          这条是**数据规则**，不是某个界面的行为：PC 端、以后的多选合并、任何一个新客户端
          漏带一次，用户就会看到"转过来的待办少了那张截图"，而且刷新之后也没了
          （图只存在 `TodoImage` 里，胶囊那边已经 `consumed` 走掉）。
          两处都做、按 `uri` 去重 ⇒ 谁先做都不重、谁漏做都不丢。
       ⚠️ `sort` 在这里**统一重排**：胶囊的图在前（`0…n-1`），表单带进来的跟在后
          （`dto.images` 的 `sort` 原样保留会与前面的序号撞车 ⇒ 详情页顺序不稳）。 */
    const images = this.imagesOfPromotion(consumed, dto.images || []);

    const todo = await this.prisma.$transaction(async (tx) => {
      const created = await tx.todo.create({
        data: {
          // ★ 客户端 id（可选）—— 前端本地那条待办已经用这个 id 渲染出去了
          id: dto.id || undefined,
          userId,
          projectId: project.id,
          mindmapId, // ★ 表单里选了脑图就带上（已校验它属于本项目）；没选就是 null
          text,
          urgency: dto.urgency,
          status: 'open',
          createdAt: now,
          completedAt: null,
          updatedAt: now,
          /* ★★ 199 轮：**「刚转过来」提示** —— 从胶囊转出来的这条待办要带一层"新到"填充色，
             直到用户打开它的详情（`POST /todos/:id/seen` 把它清回 null）。
             ★ **只有这一条路会写它**：`POST /todos`（手动新建）**刻意不写** ——
               用户口径是"刚**转**过去的"那一条；手建的人就在眼前，不需要提示。
               ⚠️ 别为了"统一"给 create 也补上：那会让每一次手建都在列表里亮一块，
                  提示就从"信号"退化成"噪音"。
             ★ 与 `createdAt` **正交**：那个回答"什么时候建的"（热力图源），
               这个回答"还没被过目"。别合并。 */
          flashAt: now,
          images: { create: images },
        },
        include: { images: true },
      });
      /* ★★ 160 轮：从"真删"改成"记一次消费"（`consumedAt`）—— 与用户手动删除
         （`deletedAt`）分列，理由见 `restoreMany()` 的注释。 */
      await tx.capsule.updateMany({
        where: { id: { in: consumedIds }, userId },
        data: { consumedAt: now },
      });
      /* ★ 2026-10-09：转待办 = **真的诞生了一条待办** ⇒ 活跃度「创建」+1。
         ⚠️ 反过来，被消费掉的那几枚胶囊的「胶囊」计数**不减** ——
            "我当时接住了 3 枚"是已发生的事实，整理之后它仍然发生过
            （这正是原来那个"实时值"统计最典型的错：一转待办，当天胶囊数就掉）。 */
      await bumpActivity(tx, userId, 'created', now);
      return created;
    });

    this.logger.log(`胶囊 [${consumedIds.join(',')}] → 待办 ${todo.id}（已消费）`);
    return { todo: todoOut(todo, false), capsuleIds: consumedIds };
  }

  /**
   * `POST /capsules/promote-to-mindmap` —— ★ **必须原子**，且返回 `addedCount`（§6.7）。
   *
   * 落点口径（与前端 `store.capsulesToMindmap()` 逐字一致）：
   *   ① 复用已存在的「闪念胶囊」一级节点（不存在才创建），每条文本作**二级节点**；
   *   ② ★ **`addedCount` 是前端的判据** —— 需求第八十七轮明确「只有真的写进去了才换记忆」，
   *      判据是写入条数 `n > 0`；一枚都没落成时前端**不许**换 `ui.mindmapId`。
   *      所以这个字段必须如实反映"真的写了几条"，不能是"请求里有几条"。
   */
  async promoteToMindmap(userId: string, dto: PromoteToMindmapDto) {
    const mindmap = await this.prisma.owned<any>(this.prisma.mindmap, dto.mindmapId, userId, '脑图');
    /* ★ 280 轮：占位中/失败的脑图**不能追加内容** ——
       `pending` 时后台任务正要把整棵树覆盖掉（追加进去的东西几秒后就没了，且不报错）；
       `failed` 时它是一棵只有原点的空树（用户点重试还会再覆盖一次）。 */
    if (mindmap.aiState === 'pending' || mindmap.aiState === 'failed') {
      throw ApiException.rejected(
        mindmap.aiState === 'pending'
          ? '这张脑图还在生成，等它完成后再添加内容'
          : '这张脑图没有生成成功，请先重试或删除它',
      );
    }

    // 只取**属于自己的、还活着的**胶囊；顺序按创建时间正序（与列表口径一致）
    const caps = await this.prisma.capsule.findMany({
      where: {
        id: { in: (dto.capsuleIds || []).map(String) },
        userId,
        deletedAt: null,     // ★★ 160 轮：已删除的不参与"转脑图"
        consumedAt: null,    // ★★ 160 轮：已被消费过的不再二次消费
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!caps.length) return { mindmapId: mindmap.id, addedCount: 0, nodeCount: mindmap.nodeCount, depth: mindmap.depth, updatedAt: mindmap.updatedAt };

    // 树的严格校验先过一遍（库里那条理论上一定合法，但这是**唯一**让前端排版死循环的入口）
    const { tree } = normalizeTree(mindmap.treeJson);
    /* ★★ 275 轮：**文字和图片一并转过去** —— 一个胶囊仍对应一个节点，只是节点多了张图。
       ⚠️ 传对象而不是两个数组（`texts` / `images`）：平行数组一旦错位，图会挂到别人的节点上。 */
    const addedCount = appendCapsuleChildren(
      tree,
      caps.map((c) => ({ text: c.text || '', imageUri: c.imageUri })),
    );

    const nodeCount = countNodes(tree);
    const depth = depthOf(tree);
    const now = nowStr();

    await this.prisma.$transaction(async (tx) => {
      await tx.mindmap.update({
        where: { id: mindmap.id },
        data: { treeJson: tree as any, nodeCount, depth, updatedAt: now },
      });
      /* ★★ 160 轮：同样是"消费"而不是"删除"（见 promoteToTodo 那段注释） */
      await tx.capsule.updateMany({
        where: { id: { in: caps.map((c) => c.id) }, userId },
        data: { consumedAt: now },
      });
    });

    this.logger.log(`胶囊 ${caps.length} 条 → 脑图 ${mindmap.id}（写入 ${addedCount} 枚节点 · 已消费）`);

    return {
      mindmapId: mindmap.id,
      addedCount,
      nodeCount,
      depth,
      updatedAt: now,
      capsuleIds: caps.map((c) => c.id),
      treeJson: tree, // ★ 顺手把新树给前端 —— 它正开着这张图，省一次 `GET /tree` 往返
    };
  }
}
