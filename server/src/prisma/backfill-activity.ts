/**
 * 历史回填 —— 给活跃度台账（`agenttodo_activity_day`）一个初始值。
 *
 * ★ 为什么要跑它：热力图从「遍历现存实体现算」改成「读台账」之后，台账一开始是空的，
 *   图会**直接变白**（用户上线后看到的第一个反应会是"我的数据呢"）。
 *   回填把**现在还在库里的**实体折算回去，让图保持原样。
 *
 * ★★ 它做不到什么（必须说清楚，别以为跑完就"完整还原"了）：
 *   已经被删掉的待办 / 已经被取消的那次完成 / 已经被消费掉的胶囊 ——
 *   那些记录**在库里根本不存在**，没有任何地方能把它们捞回来。
 *   所以回填是"**能补多少补多少**"，不是"完整还原历史"。
 *   好消息是从此以后计数只加不减，这份台账不会再缩水。
 *
 * ★ 幂等：默认**跳过已经有台账的用户**（`activityDay` 非空就 skip），
 *   所以重复执行安全，也不会把上线后已经累加的新计数覆盖掉。
 *   要强行按现存实体重建，加 `--force`（⚠️ 会丢掉"已发生但实体不存在"的那部分计数）。
 *
 * ★ 执行时机：**在 `prisma migrate deploy` 之后、`pm2 restart` 之前**。
 *   那会儿旧进程还在跑（不打点）⇒ 表必然是空的 ⇒ 一次填满，不存在"回填 vs 增量打架"。
 *
 * 用法：
 *   node dist/prisma/backfill-activity.js           # 只填没有台账的用户
 *   node dist/prisma/backfill-activity.js --force   # 按现存实体重建（覆盖）
 */

import { PrismaClient } from '@prisma/client';
import { dayOf, nowStr } from '../common/time';

const prisma = new PrismaClient();

interface Acc {
  created: number;
  completed: number;
  capsule: number;
}

async function backfillOne(userId: string, openid: string, force: boolean) {
  const existing = await prisma.activityDay.count({ where: { userId } });
  if (existing > 0 && !force) {
    return { skipped: true, days: 0, existing };
  }

  const [todos, capsules] = await Promise.all([
    prisma.todo.findMany({
      where: { userId },
      select: { createdAt: true, completedAt: true },
    }),
    prisma.capsule.findMany({ where: { userId }, select: { createdAt: true } }),
  ]);

  const map = new Map<string, Acc>();
  const bump = (ts: string | null, k: keyof Acc) => {
    const d = dayOf(ts);
    if (!d) return;
    const a = map.get(d) || { created: 0, completed: 0, capsule: 0 };
    a[k] += 1;
    map.set(d, a);
  };

  todos.forEach((t) => {
    bump(t.createdAt, 'created');
    bump(t.completedAt, 'completed'); // 现在仍是"已完成"的那些，各算一次完成动作
  });
  capsules.forEach((c) => bump(c.createdAt, 'capsule'));

  const now = nowStr();
  const rows = Array.from(map.entries()).map(([day, a]) => ({
    userId,
    day,
    created: a.created,
    completed: a.completed,
    capsule: a.capsule,
    updatedAt: now,
  }));

  // 事务：先清该用户的台账（`--force` 时才有东西可清）再整体写入，避免半途失败留下残缺
  await prisma.$transaction(async (tx) => {
    await tx.activityDay.deleteMany({ where: { userId } });
    if (rows.length) await tx.activityDay.createMany({ data: rows });
  });

  return { skipped: false, days: rows.length, existing };
}

async function main() {
  const force = process.argv.includes('--force');
  const users = await prisma.user.findMany({ select: { id: true, openid: true } });

  console.log(
    `[backfill] 用户 ${users.length} 个 · force=${force} · ` +
      (force ? '将按现存实体重建台账' : '只填尚无台账的用户'),
  );

  let filled = 0;
  let skipped = 0;
  let totalDays = 0;

  for (const u of users) {
    const r = await backfillOne(u.id, u.openid, force);
    if (r.skipped) {
      skipped += 1;
      console.log(`  - ${u.openid}：已有 ${r.existing} 天台账，跳过`);
    } else {
      filled += 1;
      totalDays += r.days;
      console.log(`  √ ${u.openid}：写入 ${r.days} 天`);
    }
  }

  console.log(`[backfill] 完成：写入 ${filled} 个用户 / ${totalDays} 天，跳过 ${skipped} 个`);
  if (!force && skipped > 0) {
    console.log('[backfill] 提示：跳过的那些用户若想重建，重新执行并加 --force');
  }
}

main()
  .catch((e) => {
    console.error('[backfill] 失败：', e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
