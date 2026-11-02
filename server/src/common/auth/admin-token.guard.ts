import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ApiException } from '../api-exception';
import { CODE } from '../codes';

/**
 * 管理接口守卫 —— `X-Admin-Token: <ADMIN_TOKEN>`（§7.3）。
 *
 * ★ 关键设计：它守护的是「待批列表」这类管理入口，**绝不与用户 token 共用一套凭证**。
 *   理由很直接 —— 用户 token 会随小程序包分发到客户端，一旦某个管理接口能用用户 token 调，
 *   任何一个用户就都能看全站数据。管理凭证只存在服务端 `.env` 里，只有你自己知道。
 */
@Injectable()
export class AdminTokenGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    const expect = process.env.ADMIN_TOKEN || '';
    if (!expect) {
      // 没配就等于关闭管理功能 —— 比"配了空串就谁都能进"安全得多
      throw new ApiException(CODE.NOT_FOUND, '资源不存在');
    }
    const got = String(req.headers['x-admin-token'] || '');
    if (!got || !timingSafeEqual(got, expect)) {
      // ★ 与「路径不存在」做出**完全同形**的响应 —— HTTP 200 ＋ code 2002。
      //   本项目的业务错误一律 HTTP 200（§6.1），所以"隐藏管理口"这件事落在 code 上：
      //   实测 `GET /api/v1/no-such-endpoint` 也是 200 ＋ 2002 ⇒ 扫描者无法从响应里
      //   区分"这里有个管理口只是没给令牌"和"这个路径压根不存在"。
      //   ⚠️ 别改成抛 NotFoundException —— 过滤器对框架异常同样收敛成 HTTP 200，
      //      改了半天状态码还是 200，只是把注释和实现对不上。
      throw new ApiException(CODE.NOT_FOUND, '资源不存在'); // 与「不存在」同形，不暴露管理口
    }
    return true;
  }
}

/** 定长比较 —— 避免用 `===` 比较密钥时被时序侧信道逐字节猜出来 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
