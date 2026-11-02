import { balanceToCents } from '../common/money';

/**
 * 模型厂家白名单（§6.8 · Token API）。
 *
 * ★★ 为什么要有一份白名单，而不是让用户自己填厂家名（2026-10-12 用户口径）：
 *   ① 「厂商」决定**去哪查余额**（`balanceUrl` 与响应形态），它是一个**枚举**，
 *      不是一段自由文本 —— 用户填「deepseek」「Deep Seek」「深度求索」都会被当成三家；
 *   ② 前端把它渲染成**只能选、不能输**的菜单（用户原话：「模型厂商改为下列菜单」）；
 *   ③ 后端必须**独立再校验一次**：前端是"引导"，不是"边界"（请求可以绕过前端直接发）。
 *      ⇒ 这一份是**唯一的真源**，前后端各持一份常量、由这里对齐语义。
 *
 * ★ 新增一个厂商 ＝ 在这里加一条 + 前端 `utils/vendors.js` 加同一条（两处、一处语义）。
 *   若新厂商的余额接口不是"GET + Bearer + DeepSeek 那个形态"，加一个 `parseBalance` 即可。
 */

/** 一条厂商定义 */
export interface VendorSpec {
  /** 存库的稳定标识（小写，永不变）—— 卡片/表单里的展示名走 `name` */
  code: string;
  /** 展示名 */
  name: string;
  /** 余额查询地址 */
  balanceUrl: string;
  /** 表单里告诉用户"去哪拿 key" */
  apiKeyHint: string;
  /** 从厂家的响应体里取出余额（分）。取不到/格式不符 → null */
  parseBalance: (json: any) => number | null;
}

/**
 * DeepSeek —— 余额接口 `GET https://api.deepseek.com/user/balance`
 * （只填 API key 一样东西，`Authorization: Bearer sk-…`；2026-10-12 调研确认）。
 *
 * 响应形如：
 * ```json
 * { "is_available": true,
 *   "balance_infos": [{ "currency":"CNY", "total_balance":"110.00",
 *                       "granted_balance":"10.00", "topped_up_balance":"100.00" }] }
 * ```
 * ★ 取 `total_balance`（含赠送额）—— 那才是"还能用多少"，`granted` / `topped_up` 是它的拆解。
 * ★ 多币种（CNY/USD）：优先 CNY，没有才退第一个 —— 卡片上只有一个数位，必须定优先级。
 * ★ 转分走 `balanceToCents`（**与前端同一套口径**）：'110.00' → 11000。
 *   ⚠️ 不要在这里写 `Number(x) * 100` —— 那就是第二条口径，迟早和别处对不上。
 */
function parseDeepSeekBalance(json: any): number | null {
  const infos = json && json.balance_infos;
  if (!Array.isArray(infos) || !infos.length) return null;
  const pick =
    infos.filter((i: any) => String(i && i.currency).toUpperCase() === 'CNY')[0] || infos[0];
  if (!pick) return null;
  return balanceToCents(pick.total_balance);
}

export const VENDORS: Record<string, VendorSpec> = {
  deepseek: {
    code: 'deepseek',
    name: 'DeepSeek',
    balanceUrl: 'https://api.deepseek.com/user/balance',
    apiKeyHint: '在 platform.deepseek.com → API keys 里创建，形如 sk-…',
    parseBalance: parseDeepSeekBalance,
  },
};

/** 厂商小写 code → spec；不认得的返回 null（调用方负责报"不支持的厂商"） */
export function vendorOf(code: string): VendorSpec | null {
  return VENDORS[String(code || '').trim().toLowerCase()] || null;
}

/** 全部厂商（保序）—— 前端那份常量要与它逐条对齐 */
export function vendorList(): VendorSpec[] {
  return Object.keys(VENDORS).map((k) => VENDORS[k]);
}
