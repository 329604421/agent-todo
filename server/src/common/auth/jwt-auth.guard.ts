import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiException } from '../api-exception';
import { CODE } from '../codes';
import { AuthUser } from './current-user.decorator';

/**
 * 登录守卫 —— `Authorization: Bearer <token>`（§6.1）。
 *
 * 为什么不用 passport：本项目不解析微信用户信息、不做 session_key 解密、不做 refresh token
 * （§7.1 四条实现要点），一个"验签 + 塞 req.user"的守卫就够了，少引入两个依赖。
 *
 * ★ 失败一律返回 **1001**，前端据此静默 `wx.login` 重登一次再重试（§9.1 第 2 点）。
 *   刻意不区分"没带 token" / "过期" / "篡改" —— 三者的前端处置完全一样，区分只会扩大攻击面。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const header = String(req.headers?.authorization || '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token) throw new ApiException(CODE.UNAUTHORIZED, '未登录');

    try {
      const payload = this.jwt.verify<{ sub: string; openid: string }>(token);
      const user: AuthUser = { userId: payload.sub, openid: payload.openid };
      req.user = user;
      return true;
    } catch {
      throw new ApiException(CODE.UNAUTHORIZED, '登录已失效');
    }
  }
}
