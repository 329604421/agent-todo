/**
 * 手填数值解析 —— 与前端 `store.amountOf()` 同一口径。
 *
 * 为什么需要它：额度 / 余额在**前端是手填字符串**（'1240'、'¥ 128.40'、'1,240 积分'），
 * 而数据库里是整数（积分是纯整数；余额单位是「分」，避免浮点误差）。
 * 两端必须能互相读懂，所以解析口径要与前端逐字一致 —— 不一致的症状是
 * 「表单里填进去 128.40，回来变成 128 或 null」，很难查。
 */

/** `'¥ 128.40'` / `'1,240'` / `'1240 积分'` → number；取不到 → null */
export function amountOf(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const m = /-?\d+(?:\.\d+)?/.exec(String(v).replace(/,/g, ''));
  return m ? Number(m[0]) : null;
}

/**
 * 余额（元，手填字符串）→ **分**（整数入库）。
 * 例：`'¥ 128.40'` → `12840`。取不到 → null（表示未填，而不是 0）。
 */
export function balanceToCents(v: unknown): number | null {
  const n = amountOf(v);
  return n === null ? null : Math.round(n * 100);
}

/** 分 → 元的展示串（`12840` → `'128.40'`）—— 「我的」页余额由此现算，不由后端存格式化结果 */
export function centsToYuan(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2);
}
