/**
 * 时间口径 —— ★ 全项目**唯一**的时间字符串来源（§8.7 约定 1）。
 *
 * 为什么不用 `new Date().toISOString()` / `@default(now())`：
 *   热力图按「自然日」聚合，而 MySQL 的 DATETIME 不存时区、Prisma 读写 DateTime 时按 UTC 解释
 *   ⇒ 北京时间 0:00–8:00 记的东西会被算到**前一天**去（症状是"整张热力图错一天"，不报错）。
 *   本项目只有一个时区（都在国内），所以直接**存本地时间字符串**：零转换、与 API 契约一致、
 *   与前端 `utils/store.js` 的字符串切片天然一致。
 *
 * ★ 两条硬约定：
 *   ① 格式严格 `YYYY-MM-DD HH:mm:ss`（补零）—— 补零是"字典序＝时间序"成立的前提，
 *      漏零会出现 `9-5` > `10-1` 的错排；
 *   ② 一律由应用层生成，**不用数据库默认值** —— 避免"库默认值"与"应用层格式"两套来源。
 *
 * ⚠️ 这里显式按 +08:00 换算，**不依赖服务器时区**（虽然 §10.3 第 1 步仍要求设 Asia/Shanghai，
 *   但那一步的作用是让日志、MySQL、cron 都对齐，不该成为时间字符串正确性的前提）。
 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

/** 把一个绝对时刻格式化成北京时间字符串 */
export function fmt(ms: number): string {
  const d = new Date(ms + TZ_OFFSET_MS);
  return (
    d.getUTCFullYear() +
    '-' + pad(d.getUTCMonth() + 1) +
    '-' + pad(d.getUTCDate()) +
    ' ' + pad(d.getUTCHours()) +
    ':' + pad(d.getUTCMinutes()) +
    ':' + pad(d.getUTCSeconds())
  );
}

/** 当前时刻（'YYYY-MM-DD HH:mm:ss'）—— 所有写入都用它 */
export function nowStr(): string {
  return fmt(Date.now());
}

/** 当前自然日（'YYYY-MM-DD'）—— 日配额用它 */
export function todayStr(): string {
  return nowStr().slice(0, 10);
}

/** 取某个时间字符串的自然日部分（'2026-09-30 10:35:54' → '2026-09-30'）。
 *  非法值返回 ''，让调用方自然跳过 —— 与前端 `store.dateOf()` 同一口径。 */
export function dayOf(s: string | null | undefined): string {
  return s ? String(s).slice(0, 10) : '';
}

/** 判断一个字符串是否是合法的时间格式（校验入参用） */
const TIME_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
export function isTimeStr(s: unknown): boolean {
  return typeof s === 'string' && TIME_RE.test(s);
}
