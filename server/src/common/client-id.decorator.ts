import { applyDecorators } from '@nestjs/common';
import { IsOptional, IsString, Matches } from 'class-validator';

/**
 * 允许**客户端自带 id**（创建类接口的可选字段）。
 *
 * ★★ 为什么要留这个口子（不是图省事，是接口设计的必然）：
 *
 *   前端的写操作是**乐观更新**（§9.3）——`addTodo()` 是**同步**函数，
 *   它必须在同一次调用里就返回一个 id，调用方（`forms.submitOn` → `pagebase`）
 *   紧接着要用这个 id 去挂脑图、写详情记忆。如果 id 只能由服务端生成，
 *   就会出现"本地先用临时 id、拿到服务端 id 后再替换"这一步 ——
 *   而替换 id 意味着要**同时改写**待办的 `projectId`/`mindmapId`、
 *   详情记忆、筛选条件里存的 id、抽屉的作用域 id……
 *   一处漏改就是一条静默的悬空引用。那是把一个两步的接口问题
 *   变成一个遍布全工程的引用一致性问题。
 *
 *   ⇒ 让**客户端生成 id、服务端原样接受**，前端的同步契约与
 *     "谁创建谁拥有这个 id"这条事实就同时成立，不需要任何 id 替换逻辑。
 *
 * ★ 安全评估（三条都过了才这么定）：
 *   ① **格式收紧**：只允许 `[A-Za-z0-9_-]{1,40}`，不可能带路径分隔符 / 引号 / 控制字符。
 *   ② **最坏后果可控**：客户端撞了别人的 id ⇒ Prisma 抛 `P2002` ⇒ 我们已有的
 *      冲突映射回 `2004`。它**不构成越权**：`create` 之后的所有读/写仍然要过
 *      `prisma.owned()` 的 `userId` 比对，撞上的那条别人也读不走。
 *   ③ **不构成信息泄露**：`P2002` 的语义是"这个 id 已被占用"，但本项目的 id
 *      由 `时间戳＋自增` 生成，猜中别人 id 的概率可以忽略；且撞上也无从读出内容。
 *
 * ⇒ 不传 `id` 时行为完全不变（走 `@default(cuid())`），
 *   所以**这个字段对任何现有调用方都是向后兼容的**。
 */
export const CLIENT_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;

export function ClientId() {
  return applyDecorators(
    IsOptional(),
    IsString(),
    Matches(CLIENT_ID_RE, { message: 'id 只能是 1–40 位的字母、数字、下划线或连字符' })
  );
}
