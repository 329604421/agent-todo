import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from './api-exception';

/**
 * 微信开放接口客户端 —— 只做一件事：`code2session`（§7.1）。
 *
 * ★ 四条实现要点（§7.1）：
 *   ① `AppSecret` **只存在于服务端环境变量** —— 绝不能进小程序代码（会随包分发出去）；
 *   ② `session_key` **拿到即弃**：本项目不解析用户信息（不用 `getUserProfile`、不读手机号），
 *      所以不做解密、不落库 —— 这省掉了大量与加密相关的坑；
 *   ③ `wx.login` 的 code **只能用一次**且 5 分钟失效 ⇒ 前端失败重登即可；
 *   ④ 用**原生 https** 而不是 axios / node-fetch —— 只有这一个外部调用点，
 *      没必要为它多一个依赖（也少一份"依赖被投毒"的面）。
 */
export interface Code2SessionResult {
  openid: string;
  sessionKey: string;
  unionid?: string;
}

const ERR_TEXT: Record<number, string> = {
  40029: '登录凭证无效，请重试',
  45011: '请求过于频繁，请稍后再试',
  40163: '登录凭证已被使用，请重试',
  '-1': '微信服务繁忙，请稍后再试',
};

@Injectable()
export class WxService {
  private readonly logger = new Logger('WeChat');

  async code2session(code: string): Promise<Code2SessionResult> {
    const appid = process.env.WX_APPID || '';
    const secret = process.env.WX_SECRET || '';
    if (!appid || !secret) {
      throw new Error('未配置 WX_APPID / WX_SECRET（见 .env.example）');
    }

    const url =
      'https://api.weixin.qq.com/sns/jscode2session' +
      `?appid=${encodeURIComponent(appid)}` +
      `&secret=${encodeURIComponent(secret)}` +
      `&js_code=${encodeURIComponent(code)}` +
      '&grant_type=authorization_code';

    const data = await this.getJson(url);

    if (data.errcode) {
      const msg = ERR_TEXT[data.errcode] || `微信登录失败（${data.errcode}）`;
      this.logger.warn(`code2session 失败 errcode=${data.errcode} errmsg=${data.errmsg}`);
      /*
       * ★★ 必须抛 `ApiException`，不能抛通用 `Error`（2026-10-08 121+ 轮修）。
       *
       * 这些是**预期内的业务结果**（code 只能用一次且 5 分钟失效、并发会撞频率限制），
       * 不是服务故障。抛裸 `Error` 会落到全局过滤器的**兜底分支** ⇒ `HTTP 500 + 5000`
       * ⇒ 前端 `netHint()` 把 `body.message` 当 toast 打出来 ⇒ 用户看到的是
       * **「服务开小差了」**，与真实原因（"凭证过期，再进一次就好"）差了十万八千里。
       * `api-exception.ts` 的注释里本来就写死了这条纪律（"不要抛通用 Error"），
       * 这里是一处**实现漏网**。
       *
       * ⚠️ 用 `REJECTED(2005)` 而**不是** `UNAUTHORIZED(1001)`：前端收到 1001 会
       *    `reloginOnce()` 静默重登 —— 而本接口正是**发 token 的登录接口**，
       *    自返 1001 ⇒ 重登 ⇒ 再 1001 ⇒ **死循环**。
       */
      throw ApiException.rejected(msg);
    }
    if (!data.openid) {
      this.logger.error(`code2session 返回缺少 openid：${JSON.stringify(data)}`);
      throw new Error('微信登录失败');
    }

    return { openid: data.openid, sessionKey: data.session_key, unionid: data.unionid };
  }

  private getJson(url: string): Promise<any> {
    // 用 require 而不是 import：让这个"唯一的外部依赖"不参与打包期的静态分析，
    // 也让本模块在单测里可以被轻易 stub 掉。
    const https = require('https');
    const timeout = Number(process.env.WX_HTTP_TIMEOUT_MS || 8000);

    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout }, (res: any) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (body += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            reject(new Error('微信接口返回了非 JSON 内容'));
          }
        });
      });
      req.on('timeout', () => {
        req.destroy(new Error('连接微信接口超时'));
      });
      req.on('error', (e: Error) => reject(e));
    });
  }
}
