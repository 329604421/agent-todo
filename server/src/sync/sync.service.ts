import { Injectable } from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { nowStr } from '../common/time';
import { agentOut, capsuleOut, meOut, mindmapOut, projectOut, todoOut, tokenKeyOut } from '../common/shape';

/**
 * `GET /sync` —— 一次拿回**除脑图树以外**的全部数据（§6.2）。
 *
 * ★★ 这是本方案最重要的一个决定，值得在这里再写一遍理由：
 *   首年全量 JSON < 300 KB、一次请求 < 1 秒。用"启动时一次全量快照"换来的最大红利是
 *   —— **后端不需要写任何统计接口**。
 *   因为 `todos`（含 createdAt / completedAt）与 `capsules`（含 createdAt）全都在前端手上，
 *   而项目四档计数、综合紧急度排序、概览卡片 —— 前端 `store.js`
 *   里已经全部实现并走过 114 轮核验。直接复用，**口径零风险**。
 *
 * ⚠️⚠️ 2026-10-09 更正：上面那条红利**对活跃度日历不成立**（其余照旧）。
 *   当时把热力图也算进"能从实体推出来"的一类，实际推不出来 ——
 *   实体数组回答的是「**现在还剩下什么**」，而热力图问的是「**那天发生过多少事**」。
 *   由前者反推后者的后果是：删掉一条待办、取消一次完成、胶囊被转成待办，
 *   历史那天的颜色就会跟着变浅（用户实测报出）。所以专门加了 `activity` 台账
 *   （见 prisma/schema.prisma 的 `ActivityDay`），随动作**只加不减**地累加。
 *   ★ 它不是"统计接口"：没有新路由、没有新的查询逻辑，只是全量快照里多带一组小数组。
 *
 * ⚠️ 两组"不给"（各自对应一个真实故障，别顺手补上）：
 *   ① 不给 `todos[].images[].url` —— 只给相对 uri（否则前端会预加载图片，3 Mbps 下 20 张要 16 秒）；
 *   ② 不给 `mindmaps[].treeJson` —— 树按需走 `GET /mindmaps/:id/tree`。
 */
@Injectable()
export class SyncService {
  constructor(private readonly prisma: PrismaService) {}

  async snapshot(userId: string) {
    const [user, agents, tokenKeys, projects, todos, mindmaps, capsules, activity] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.agent.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.tokenKey.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.project.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } }),
      /* ★★ 160 轮 · **已删除的待办也要给**（所以这里没有 `deletedAt: null`）。
         理由：待办列表的筛选弹窗有三档「未完成 / 已完成 / 已删除」，`已删除` 那一档
         必须能列出来 —— 那是**唯一的还原入口**。而"这条还在不在"由出参的 `deletedAt`
         回答（见 `todoOut`），前端据此分流，不是靠"服务端不给"。
         ⚠️ 于是别在这里顺手加 `deletedAt: null` —— 那会让「已删除」筛选永远空。
         ⚠️ 也决定了 `GET /sync` 的体积会随"删除量"缓慢增长（软删不清理）——
            一期数据量下可忽略；将来要清理由"彻底删除 / 回收站保留 N 天"另开一轮。 */
      this.prisma.todo.findMany({
        where: { userId },
        include: { images: true },
        orderBy: { createdAt: 'asc' },
      }),
      // ★ 不带 treeJson —— 只取元信息（Prisma 的 select 让它根本不出现在结果里）
      /* ⚠️⚠️ 280 轮：这是**白名单 select**，`mindmapOut` 里新加的字段若不在这里一起加，
         结果是"不报错、不失败，只是前端那个字段永远 undefined"。三列必加：
         `agentId`（归属 agent）、`aiState`（占位/失败态）、`flashAt`（刚转过来亮一次）。
         `aiStartedAt / aiError / aiInput` **刻意不加**：前端用不上，`aiInput` 还含用户原文。 */
      this.prisma.mindmap.findMany({
        where: { userId },
        select: {
          id: true, projectId: true, name: true, format: true,
          agentId: true, aiState: true, flashAt: true,
          nodeCount: true, depth: true, createdAt: true, updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
      }),
      /* ★ 胶囊**正序**（越早越靠上）：它记的是"我当时怎么想的"，顺序本身就是信息（FR-9 口径①）
         ★★ 160 轮：**已删除的要给、被消费的不给** —— 两者是两张名单（见 schema 里那两列）：
            · `deletedAt` 非空 ⇒ 进「已删除胶囊」列表（可还原）⇒ 必须下发；
            · `consumedAt` 非空 ⇒ 已经变成待办 / 脑图节点了，界面上**任何一处都不列**
              ⇒ 直接不带（省字节，也让前端少一条"要记得排除"的分支）。
         ★★ 248 轮：**"被消费"里要挑出"被关联到待办上的"那批一起下发**。
            ── 为什么（用户口径 2026-10-23 第 3 / 4 条）：
               「建立关联时，胶囊信息需要从闪念胶囊中移除（和转脑图、转待办后的操作一致）」
               ＋「关联后，胶囊卡片就在待办详情页以卡片形式显示」。
               关联与"转走"在**列表可见性**上完全一致（都靠 `consumedAt` 从正常列表消失），
               但关联的那批**内容还在**、只是挂到了某条待办上 —— 待办详情要画它们。
            ── 判据写成 `OR: [{consumedAt: null}, {todoId: {not: null}}]`：
               ① 第一支 ＝ 正常 ＋ 手动删除（与 160 轮逐字一致）；
               ② 第二支 ＝ 关联在待办上的（它们 `consumedAt` 非空，但 `todoId` 有值）；
               被转成待办 / 脑图的那批 `todoId` 是 null ⇒ 照旧**不下发**（省字节那条没破）。
            ⚠️ 别把它简化成 `consumedAt: null` 或 `todoId: null` —— 前者会让详情页永远
               画不出胶囊，后者会把"转走"的那批又捞回来。
            ⚠️ 体积代价：关联的胶囊随"关联动作"增长，但每枚只有一行文本字段；
               且用户口径本身就是"胶囊信息在一个时刻相对是少的"。
            ⚠️ 前端那侧靠 `store.isGoneCapsule()`（`deleted || consumed`）照旧把它们
               挡在胶囊列表之外 —— 所以放宽在这里**不会**让它们重新出现在闪念胶囊里。 */
      this.prisma.capsule.findMany({
        where: {
          userId,
          OR: [{ consumedAt: null }, { todoId: { not: null } }],
        },
        orderBy: { createdAt: 'asc' },
      }),
      /* ★★ 活跃度台账（2026-10-09 新增）—— 热力图的**计数真源**。
         ⚠️ 别把它当成"又一组可由 todos / capsules 推出来的数据"：**推不出来**。
            它记的是"动作发生过几次"（删了也留着），而实体数组只反映"现在还剩下什么"。
            原来前端就是拿后者反推的 ⇒ 删一条待办，历史那天的颜色跟着变浅（用户报的缺陷）。
         ⚠️ 只给需要的三列 ＋ day：`userId` 不必回传（本来就是问谁给谁），
            `updatedAt` 是运维字段，前端一个字都不用。 */
      this.prisma.activityDay.findMany({
        where: { userId },
        select: { day: true, created: true, completed: true, capsule: true },
        orderBy: { day: 'asc' },
      }),
    ]);

    return {
      // ★ 前端用它校正"今天"（热力图的开周窗口跟系统当天走）
      serverTime: nowStr(),
      me: meOut(user),
      agents: agents.map(agentOut),
      tokenKeys: tokenKeys.map(tokenKeyOut),
      projects: projects.map(projectOut),
      todos: todos.map((t) => todoOut(t, false)), // ★ 不带完整图片 URL
      mindmaps: mindmaps.map((m) => mindmapOut(m, false)),
      capsules: capsules.map(capsuleOut),
      activity: activity,
    };
  }
}
