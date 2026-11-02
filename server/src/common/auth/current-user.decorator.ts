import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/** 挂在 req 上的登录态 —— 只有这两个字段，**其它一切都从 token 取，绝不信任客户端传的 userId**（§7.4 第 4 条） */
export interface AuthUser {
  userId: string;
  openid: string;
}

/**
 * `@CurrentUser()` —— 从请求上下文里取登录用户。
 *
 * ★ 这是全项目**唯一**合法获取 `userId` 的入口。
 *   任何 `@Body()` / `@Query()` 里出现的 `userId` 都应当被忽略或拒绝 ——
 *   "客户端传 userId"是 IDOR 的经典入口（§7.2）。
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest();
  return req.user as AuthUser;
});
