import { dayOf, nowStr } from './time';

/**
 * 活跃度台账打点 —— 热力图（概览「活跃度日历」）的**唯一写入入口**。
 *
 * ★★ 一条铁律：**只加不减**。
 *   每发生一个动作就 +1，此后无论那个实体被删除 / 取消完成 / 被消费掉，
 *   计数**永不回退**。热力图表达的是「那天发生过多少事」（活跃度），
 *   不是「那天留下的东西现在还剩下多少」—— 后者正是 2026-10-09 被用户报出来的缺陷
 *   （症状：删一个待办，历史那天的颜色跟着变浅）。
 *
 * ⚠️ 因此本模块**没有** `dec()`，也不该加。谁想在 `reopen` / `DELETE` 里"对称地减回去"，
 *    谁就是把这个 bug 又写回来一遍。
 *    「完成」记的是**动作次数**：勾完成 → 取消 → 再勾 ⇒ 2 次（用户 2026-10-09 拍板）。
 *
 * ★ 为什么用 `upsert` ＋ `increment` 而不是"先查再写"：
 *   两个请求同时落在同一天会各自读到旧值、各自 +1 写回 ⇒ **丢一次计数**（经典丢更新）。
 *   `INSERT … ON DUPLICATE KEY UPDATE x = x + 1` 由数据库保证原子，无需事务也不需要重试。
 *
 * ★ 为什么打点要跟业务写入**在同一个事务里**（见调用点）：
 *   分开写就会出现"待办建了、计数没加"（或反过来）。热力图不会报错、只会**悄悄少一格**，
 *   属于本项目最怕的那类静默缺陷。
 *
 * @param db   `PrismaService` 或 `$transaction` 里的 `tx`（两者接口一致）
 * @param userId 归属用户
 * @param kind 'created' 待办创建 / 'completed' 待办完成动作 / 'capsule' 胶囊创建
 * @param at   该动作对应的**业务时间戳**（'YYYY-MM-DD HH:mm:ss'）。
 *             必须传业务那一刻的时间，不要靠默认值 —— 这样 `activity_day.day`
 *             与 `todo.createdAt` 的日期切片**永远一致**，两边不会出现"差一天"。
 */
export type ActivityKind = 'created' | 'completed' | 'capsule';

export async function bumpActivity(
  db: any,
  userId: string,
  kind: ActivityKind,
  at?: string | null,
): Promise<void> {
  const day = dayOf(at) || dayOf(nowStr());
  const now = nowStr();

  const create: any = { userId, day, created: 0, completed: 0, capsule: 0, updatedAt: now };
  create[kind] = 1;

  const update: any = { updatedAt: now };
  update[kind] = { increment: 1 };

  await db.activityDay.upsert({
    where: { userId_day: { userId, day } },
    create,
    update,
  });
}
