import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { MINDMAP_DEFAULT_FORMAT, MINDMAP_FORMATS } from '../common/constants';
import { PrismaService } from '../common/prisma.service';
import { mindmapOut } from '../common/shape';
import { nowStr } from '../common/time';
import { emptyTree, normalizeTree, TreeNode } from '../common/tree';
import { CreateMindmapDto, UpdateMindmapDto } from './dto/mindmap.dto';

@Injectable()
export class MindmapsService {
  private readonly logger = new Logger('Mindmaps');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `GET /mindmaps/:id/tree` —— 树**按需**拉取（§6.2）。
   * 它是唯一"体积随内容增长"的数据（20 张 × 20 节点 ≈ 40–100 KB），
   * 而列表页、概览、概览统计**都不需要树**。
   */
  async tree(userId: string, id: string) {
    const m = await this.prisma.owned<any>(this.prisma.mindmap, id, userId, '脑图');
    return {
      mindmapId: m.id,
      name: m.name,
      format: m.format,
      treeJson: m.treeJson,
      nodeCount: m.nodeCount,
      depth: m.depth,
      updatedAt: m.updatedAt,
    };
  }

  /**
   * `POST /mindmaps` —— 新建（FR-7.2）。
   * ★ **归档项目不能新建**：`project.archivedAt != null` → `2005`。
   *   这是后端**唯一**的归档相关校验（其余四处过滤全在前端，§8.3）——
   *   但它必须在后端，因为它是"写入侧"的规则，前端漏一处就是脏数据。
   */
  async create(userId: string, dto: CreateMindmapDto) {
    const project = await this.prisma.project.findFirst({
      where: { id: String(dto.projectId || ''), userId },
    });
    if (!project) throw ApiException.badParam('所属项目不存在');
    if (project.archivedAt) {
      throw ApiException.rejected('已归档的项目不能再新建脑图');
    }

    const name = (dto.name || '').trim() || '未命名脑图';
    const format = dto.format || MINDMAP_DEFAULT_FORMAT;
    const now = nowStr();
    const tree = emptyTree(name);

    const row = await this.prisma.mindmap.create({
      data: {
        // ★ 前端乐观更新时自带 id（可选）；不传就走 cuid 默认值
        id: dto.id || undefined,
        userId,
        projectId: project.id,
        name,
        format,
        /* ★★ 2026-10-27（用户口径）：脑图的归属 agent **由项目决定**，客户端不再选。
           这里按项目推导（项目没绑 agent ⇒ null）。放在服务端而不是只靠前端传，是因为
           `create` 还有别的入口（语义转脑图的占位卡不走这条），规则必须在写库这一处成立。 */
        agentId: project.agentId || null,
        treeJson: tree as any,
        nodeCount: 1,
        depth: 1,
        createdAt: now,
        updatedAt: now,
      },
    });
    return mindmapOut(row, false);
  }

  /** `PATCH /mindmaps/:id` —— 可改 名称 / 归属项目 / 格式（FR-7.2） */
  async update(userId: string, id: string, dto: UpdateMindmapDto) {
    const cur = await this.prisma.owned<any>(this.prisma.mindmap, id, userId, '脑图');
    const data: any = { updatedAt: nowStr() };

    if (dto.name !== undefined) {
      const name = String(dto.name).trim();
      if (!name) throw ApiException.badParam('脑图名不能为空');
      data.name = name;
      // 根节点文本跟着名称走（画布上最大的那个方块写的就是脑图名，与前端 syncMindmapMeta 同口径）
      const tree = cur.treeJson && typeof cur.treeJson === 'object' ? cur.treeJson : emptyTree(name);
      if (tree && tree.id) tree.text = name;
      data.treeJson = tree;
    }
    if (dto.projectId !== undefined) {
      const p = await this.prisma.project.findFirst({ where: { id: String(dto.projectId), userId } });
      if (!p) throw ApiException.badParam('所属项目不存在');
      data.projectId = p.id;
      /* ★★ 2026-10-27（用户口径）：**换项目 ⇒ 归属 agent 跟着换**（项目没绑 agent ⇒ null）。
         与 `create` 同一条规则、同一个真源；「完善脑图信息」抽屉里用户只选项目，
         agent 由这里落定 —— 客户端传不传 `agentId` 都不影响结果（下面那一支只做越权校验）。 */
      data.agentId = p.agentId || null;
    } else if (cur.projectId) {
      /* ★★ 2026-10-27：**不换项目也要重算一次**。
         规则既然叫"由项目决定"，那每一次编辑都该重新读一遍项目的当前 agent —— 否则这条路上
         永远修不好漂移：项目昨晚改绑了 agent（或这行是历史遗留的 null），今天只改脑图名字，
         agent 还是老的。`projects.update` 那边负责"改项目时批量刷"，这里负责"改这张图时对齐"，
         两条路合起来才没有死角。
         只在**推出来的值与库里不同**时才写（避免每次改名都白写一列）。 */
      const p = await this.prisma.project.findUnique({
        where: { id: cur.projectId },
        select: { agentId: true },
      });
      const nextAgent = (p && p.agentId) || null;
      if (nextAgent !== (cur.agentId || null)) data.agentId = nextAgent;
    }
    /* ★★ 280 轮：「归属 agent」—— 只认本人名下的 agent（与 `projectId` 同一条越权口径）。
       ★ 2026-10-27：**值不再采信**。脑图的 agent 由项目决定（用户口径），这里收下字段只为
         兼容还在传它的旧客户端：校验一遍越权、不写入。留着这个分支，旧客户端不会因为
         "多传了一个字段"而报错，也不会造出"项目是 A、agent 是 B"的矛盾数据 ——
         而 agent 的用量/额度是按 agent 归集的，那种数据谁来都解释不通。 */
    if (dto.agentId !== undefined && dto.agentId !== null && dto.agentId !== '') {
      const a = await this.prisma.agent.findFirst({ where: { id: String(dto.agentId), userId } });
      if (!a) throw ApiException.badParam('归属 agent 不存在');
    }
    if (dto.format !== undefined) {
      /* ★ 280 轮：`''` 放行（＝"未设置"这一档真实存在），其余仍只收六档。
         注意 DTO 已经用 `@IsIn` 挡过一次，这里再挡一次是因为 `format` 还会
         从"完善脑图信息"那条路进来 —— 写入侧规则不假设调用方守规矩。 */
      if (dto.format !== '' && !(MINDMAP_FORMATS as readonly string[]).includes(dto.format)) {
        throw ApiException.badParam('脑图格式取值不合法');
      }
      data.format = dto.format;
    }

    const row = await this.prisma.mindmap.update({ where: { id }, data });
    return mindmapOut(row, false);
  }

  /**
   * `PUT /mindmaps/:id/tree` —— 保存整棵树（FR-7.3）。
   *
   * ★★ 两件不能省的事：
   *   ① **服务端严格树校验**：单父 · 无环 · 不越级（`normalizeTree`）。
   *      前端已经保证了，但一条带环 / 有重复 id 的树会让前端排版算法**死循环**（画布整个卡死，无报错）；
   *   ② **`nodeCount` / `depth` 由服务端从树重算**，**不接受客户端传值** ——
   *      它们是派生冗余（列表卡显示"N 个节点"），客户端一旦传错，卡上显示的就是假的。
   */
  async saveTree(userId: string, id: string, treeJson: unknown) {
    await this.prisma.owned(this.prisma.mindmap, id, userId, '脑图');

    /* ★★ 275 轮：把「本人前缀」交给归一化 —— 节点上的 `imageUri` 必须是自己上传的那张
       （别人的 uri 落到自己名下 = 允许引用任意用户的图，见 `common/tree.ts` 的 `NormalizeOpt`）。 */
    const { tree, nodeCount, depth } = normalizeTree(treeJson, { ownPrefix: userId + '/' });
    const row = await this.prisma.mindmap.update({
      where: { id },
      data: { treeJson: tree as any, nodeCount, depth, updatedAt: nowStr() },
    });
    return mindmapOut(row, false);
  }

  /**
   * ★★ 199 轮：`POST /mindmaps/:id/seen` —— 清掉若干节点上的「刚转过来」标记。
   *
   * 触发时机：用户在画布上**选中**了那枚节点（用户口径：「选中这个节点卡片后，这个提示消失」）。
   *
   * ★ 三条口径，三条都不能少：
   *   ① **不刷 `updatedAt`** —— 与 `saveTree` **有意不同**。"看了一眼"不是"改了这张图"：
   *      刷了会让它在脑图列表里被顶到最前（列表按 `updatedAt` 倒序），
   *      症状是"随手点一个节点，脑图顺序自己变了"。同理**也不写** `nodeCount` / `depth`
   *      —— 树体积一个节点没多、一个没少，重算出来的还是同一个数。
   *   ② **幂等** —— 别的端已经清过、或这批 id 本来就带标记 ⇒ `cleared: 0` ＋ 原样返回树，
   *      不报错。多端同时开着同一张图时这是常态，不是异常。
   *   ③ **顺手把清完的树回给前端** —— 前端本地也会清，但它只知道"自己点了哪一枚"；
   *      以服务端这份为准既能把两边差异收齐，又省掉一次 `GET /tree` 往返。
   *
   * ⚠️ 写回前过一遍 `normalizeTree()`：树的合法性**只由它一个人负责**（与 `saveTree` 同一条路），
   *   不能出现"这条路能把非法树写进库"。
   */
  async markSeen(userId: string, id: string, nodeIds: string[]) {
    const m = await this.prisma.owned<any>(this.prisma.mindmap, id, userId, '脑图');
    const wanted = new Set((nodeIds || []).map(String).filter(Boolean));
    /* ★ 280 轮：除了节点级 `flash`，脑图行上还有一个**卡片级**的 `flashAt`
       （语义转脑图刚生成完时亮一次）。它属于同一句"我看过它了"，所以在同一个接口里清。
       ⚠️ 必须**独立于节点清理**判早退：`wanted` 为空的场景（打开完善抽屉、只点卡片不点节点）
          恰恰是最常见的，若沿用原来的 `if (!wanted.size) return`，卡片底色永远清不掉。 */
    const hadRowFlash = !!m.flashAt;
    if (!wanted.size && !hadRowFlash) return { mindmapId: m.id, cleared: 0, treeJson: m.treeJson };

    const { tree } = normalizeTree(m.treeJson);
    let cleared = 0;
    (function walk(n: TreeNode) {
      if (wanted.has(n.id) && n.flash) {
        delete n.flash;
        cleared += 1;
      }
      (n.children || []).forEach(walk);
    })(tree);

    if (!cleared && !hadRowFlash) return { mindmapId: m.id, cleared: 0, treeJson: m.treeJson };

    const data: any = {};
    if (cleared) data.treeJson = tree as any;
    if (hadRowFlash) data.flashAt = null;
    const row = await this.prisma.mindmap.update({
      where: { id },
      /* ★ 只有这两列 —— 刻意不写 `updatedAt` / `nodeCount` / `depth`（见 ① ） */
      data,
    });
    this.logger.log(`脑图 ${id} —— 清掉 ${cleared} 枚节点的「刚转过来」标记${hadRowFlash ? ' + 卡片底色' : ''}`);
    return { mindmapId: id, cleared, flashAt: null, treeJson: row.treeJson };
  }

  /**
   * `DELETE /mindmaps/:id` —— 关联待办的 `mindmapId` **置空、不级联删待办**。
   * 这一条由数据库的 `onDelete: SetNull` 在 DB 层保证（§8.5），业务代码里一个字都不用写。
   */
  async remove(userId: string, id: string) {
    await this.prisma.owned(this.prisma.mindmap, id, userId, '脑图');
    await this.prisma.mindmap.delete({ where: { id } });
    return { id, deleted: true };
  }
}
