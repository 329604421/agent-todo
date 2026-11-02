/**
 * 模型厂商清单 —— Token API（§6.8）。
 *
 * ★★ 这份常量是**后端 `src/token-keys/vendors.ts` 的镜像**，两边**逐条对齐**（2026-10-12）。
 *   为什么要有"厂商"这一层、而不是让用户自己敲厂家名：
 *     · 厂商决定**去哪查余额**（接口地址与响应形态），它本质是个**枚举**，
 *       不是自由文本 —— 用户填「deepseek」「Deep Seek」「深度求索」会被当成三家；
 *     · 表单把它渲染成**只能选、不能输**的菜单（用户口径：「模型厂商改为下列菜单」）。
 *   ⚠️ 后端**会再校验一次**（前端是引导，不是边界）。所以这里加了新厂商、
 *      后端没加 ⇒ 提交会被拒（报「不支持的模型厂商」）—— 两处必须一起改。
 *
 * ★ 加一个厂商 ＝ 这里加一条 ＋ 后端 `VENDORS` 加一条。`code` 是**存库的稳定标识**
 *   （小写、永不变），`name` 才是给人看的展示名。
 */
const VENDORS = [
  {
    code: 'deepseek',
    name: 'DeepSeek',
    /* 表单里的说明小字：告诉用户**去哪拿**这把 key（不然"API Key"三个字很空） */
    apiKeyHint: '在 platform.deepseek.com → API keys 里创建，形如 sk-…'
  }
];

/** 全部厂商（保序，供表单渲染菜单） */
function vendorList() { return VENDORS.slice(); }

/** `code` → 厂商定义；不认得返回 null */
function vendorOf(code) {
  const c = String(code == null ? '' : code).trim().toLowerCase();
  return VENDORS.filter(function (v) { return v.code === c; })[0] || null;
}

/** `code` → 展示名；不认得时**原样返回**（老数据里可能存着改前的自由文本厂家名） */
function vendorName(code) {
  const v = vendorOf(code);
  return v ? v.name : String(code == null ? '' : code);
}

/**
 * 明文 key → 展示掩码（`sk-xxxxxxxx…wxyz` → `sk-****wxyz`）。
 *
 * ★★ 必须与后端 `common/secrets.ts` 的 `maskKey()` **同一套算法**。
 *   ⚠️ 前端的掩码只是**乐观显示**：请求回执里服务端会带权威的 `keyMask` 回来覆盖它
 *      （见 `store.updateTokenKey` 的 `mergeOne`），所以这里算错不会导致数据错，
 *      只会让"保存成功前那一瞬"的显示和最终的略有出入。
 */
function maskKey(plain) {
  const s = String(plain == null ? '' : plain).trim();
  if (!s) return '';
  const tail = s.slice(-4);
  if (s.length < 12) return '****' + tail;
  const head = /^sk-/i.test(s) ? 'sk-' : s.slice(0, 3);
  return head + '****' + tail;
}

module.exports = {
  VENDORS: VENDORS,
  vendorList: vendorList,
  vendorOf: vendorOf,
  vendorName: vendorName,
  maskKey: maskKey
};
