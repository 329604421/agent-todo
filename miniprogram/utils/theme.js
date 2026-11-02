/**
 * 主题服务（★ 深色模式 · 2026-10-13 新增）
 *
 * ── 它解决什么 ─────────────────────────────────────────────────────────────
 * 全应用要跟随微信宿主的深浅主题。WXSS 那一侧由 `pages/shell` 挂在**根节点**上的
 * `.theme-dark` 类切换（令牌表在 `app.wxss`，**只写一份**）；而下面这几类东西
 * **不是 WXSS 能表达的**，必须由 JS 出一份"当前主题下的色板"：
 *   · **图标**：`<icon>` 渲染的是 `<image src="…/x.svg">`，SVG 里的颜色硬编码在文件里，
 *     `<image>` 跨文档拿不到宿主的 CSS 变量（见 `工具/gen_icon_white.py` 的文件头）⇒
 *     深色下要换成 `d-x.svg`（见 `工具/gen_icon_dark.py`），由 `<icon>` 问本模块要主题；
 *   · **数据侧的颜色**：项目八色 / 紧急四档（经 `utils/store.js` 的视图装配下发）、
 *     热力图 5 档色卡（`mock.HEATMAP.legend` 经概览下发）—— 它们是**行内 style 的 hex**，
 *     不走 WXSS 令牌；
 *   · **脑图连线**：`utils/mindmap-core.js` 把 `stroke="#C8C8CC"` 拼进 SVG 的 data URI；
 *   · **开屏画布**：`components/splash` 是 Canvas 2D，笔画色写死在 JS 里。
 *
 * ── 单一真源：**JS 说了算**（对设计稿 §6.2 的一处刻意取舍）─────────────────
 * 设计稿建议"媒体查询兜底 ＋ JS 类覆盖"两层。这里**只用 JS 一层**，理由：
 *   · ★★ **192 轮订正**：官方文档对 `wx.getAppBaseInfo().theme` 的原话是
 *     「**系统当前主题**，取值为 `light` 或 `dark`」⇒ 它与 WXSS 的 `prefers-color-scheme`
 *     **同源**（都跟系统）。186 当时把 `theme` 读成"微信主题"**是有误的**，
 *     据此推出的"两层可以不一致"也随之作废。
 *     ⇒ 媒体查询在**唯一一处**解禁：`app.wxss` 里 `page` 的背景（`page` 是 `.stage-wrap`
 *       的**父**，是令牌唯一够不到的一层 —— 深色下重进小程序时露出来的那块浅灰就是它）。
 *       **稳态令牌仍只用 JS 一层**，本条没有推翻"单一真源"。
 *   · 两份深色令牌分别写在媒体查询与类选择器里 ⇒ 迟早改一处漏一处（本工程对
 *     "同一份值抄两遍"的容忍度是零，已有 159/178 轮两次教训）。
 *   · 首帧问题**不需要**媒体查询解决：`current()` 是**同步**读宿主主题的，
 *     `pages/shell` 在模块求值时就把它算进初始 data ⇒ 首次渲染就是对的，
 *     不存在"先画浅色再切深色"的那一帧。读不到时确定性回落浅色（与旧宿主行为一致）。
 *
 * ── 与"不支持的宿主"的关系 ─────────────────────────────────────────────────
 * 旧客户端 / 未开 darkmode 时 `theme` 为 `undefined` ⇒ 一律回落 `light`，
 * 界面与适配前逐像素一致（浅色令牌一字未改）。**不需要**额外兼容分支。
 *
 * ── 线程/事件 ─────────────────────────────────────────────────────────────
 * `init()` 注册 `wx.onThemeChange`（唯一主入口，**只注册一次**）。切主题时：
 * 重新读宿主主题 → 与缓存比对 → **有变化才**通知订阅者（去重，见 `refresh`）。
 * 前台复核由 `app.js` 的 `onShow` 调用 `refresh()` 补一次 —— 后台期间错过的
 * 事件在回到前台时被纠正。订阅者是**视图组件**（`icon` / `splash`）与壳页，
 * 通知只做"重新取色并重画"，**不触发任何业务请求、不重建模块、不清表单/录音**。
 *
 * ⚠️ 本模块**必须能在 Node 桩环境里安全 require**：`工具/` 下全部核验脚本都吃
 *    `utils/store.js`（它 require 本模块），而那边没有 `wx`。所有 wx 调用都包在
 *    守卫里，node 下 `readHost()` 返回空 ⇒ `light`（＝脚本期望的浅色基线，逐值不变）。
 */

/* ==========================================================================
   JS 调色板 —— 与 `app.wxss` 的深色令牌**同源**（同一张设计稿 §4）
   ⚠️ 这里只列**会经 JS 走到屏幕上**的那几支；其余令牌（背景 / 文字 / 边框…）
      一律由 WXSS 承担，**不要**往这里搬 —— 搬进来就等于同一份值抄了两遍。
   ========================================================================== */

/** 项目八色 ＋ 未关联（key 与 `mock.PROJECT_COLORS` 一一对应；**identity 用 key，不是 hex**） */
const PROJECT_DARK = {
  qing:    { main: '#50BCAE', soft: '#20332F' },
  lv:      { main: '#78BC80', soft: '#263329' },
  ganlan:  { main: '#A9BE65', soft: '#303424' },
  zong:    { main: '#C59973', soft: '#342C25' },
  zi:      { main: '#B099DD', soft: '#302A3C' },
  pinhong: { main: '#D18EBA', soft: '#372936' },
  dian:    { main: '#A09CDD', soft: '#2B2A3B' },
  song:    { main: '#69AFBB', soft: '#223138' },
  none:    { main: '#9B9DA7', soft: '#292B31' }
};

/** 紧急程度四档（`main` 色点/色条 · `text` 徽章字 · `soft` 徽章/选中底） */
const URGENCY_DARK = {
  urgent: { main: '#EC7279', text: '#F28B8F', soft: '#382426' },
  mid:    { main: '#D9A44E', text: '#EAB769', soft: '#342C20' },
  low:    { main: '#6EA6DB', text: '#81B5E5', soft: '#212D39' },
  hold:   { main: '#9B9DA7', text: '#B6B8C0', soft: '#292B31' }
};

/** 热力图 5 档 · 深色（越活跃越亮；与浅色的"越活跃越深"是**同一语义的两种显示**） */
const HEAT_DARK = ['#2D2F32', '#51442A', '#856822', '#B98C1A', '#FFD02F'];
/** 与 `mock.HEATMAP.legend` **逐值相同** —— 浅色下用它作兜底，别在这里改浅色值 */
const HEAT_LIGHT = ['#F1F2F5', '#FFF4C4', '#FFE07A', '#FFD02F', '#E5A400'];

/** 脑图普通父子连线（深色要"比装饰分隔线明显"，见设计稿 §5.5） */
const LINK_DARK = '#858783';

/** 开屏画布的笔画色 —— ★190 起**整条动画只有这一支墨**：枝干 / 节点 / **黄底板上那条
 *  「接住」描线** / 末幕组合标，四处同色（186 曾把描线钉死成浅色墨，190 撤销）。
 *  ⚠️ 别照 186 的老注释理解成"只有画在背景上的笔用它"。 */
const SPLASH_INK_DARK = '#EEEDEA';

/** 深色专用图标用的前景色（与 `工具/gen_icon_dark.py` 的 INK_DARK 同值） */
const ICON_DARK = '#EEEDEA';

/* ★★ 审查-02（2026-10-14）新增的三个取色出口 ──────────────────────────────
   它们补的是 S2「深色两条腿」里**JS 侧没走到 `theme.js`**那几处（CSS 那侧另有修）。
   规矩不变：**行内 hex 一律从这里出**，调用方不要自己 `isDark()` 再抄一份。 */

/** 格式缩略图三色（`utils/formats.js` 现算 SVG 用）——
 *  浅色支与那三个旧常量**逐值相同**；深色支换"深色卡上读得出来"的一套：
 *  根＝深色主墨（≈ `--primary`）、叶＝深色卡底（≈ `--card`，靠描边立住）、线＝连线深色档。 */
const THUMB_DARK = { line: '#858783', root: '#EEEDEA', leaf: '#202123' };
const THUMB_LIGHT = { line: '#C7CAD5', root: '#1C1C1E', leaf: '#FFFFFF' };

/** `wx.showModal` 的 `confirmColor` —— 危险动作的确认键（浅 `--danger` / 深 `--danger`） */
const DANGER_LIGHT = '#C63B2E';
const DANGER_DARK = '#F08070';

/** 未归属项目的中性灰点（浅 `--p-none` / 深 ＝ `PROJECT_DARK.none.main`） */
const NONE_LIGHT = '#8E91A0';
const NONE_DARK = '#9B9DA7';
/** 上面那粒色点**背后那格圆底**（浅 `--p-none-l` / 深 ＝ `PROJECT_DARK.none.soft`）
 *  ★ 与 `noneColor()` **成对**：只换点不换底 ⇒ 深色下一粒深灰点坐在一块近白圆底上，
 *    比不换还显眼。两个值都取自令牌表已有的那两支，不新增概念。 */
const NONE_SOFT_LIGHT = '#F3F4F6';
const NONE_SOFT_DARK = '#292B31';

/* ==========================================================================
   主题状态
   ========================================================================== */

/** `'light' | 'dark'`；`null` ＝ 还没读过（见 `current()`） */
let _theme = null;
/** 订阅者（视图组件）。切主题只在**真有变化**时通知一次 */
let _subs = [];
let _inited = false;

/** 宿主当前主题；读不到 / 不支持 ⇒ `''`（调用方回落浅色） */
function readHost() {
  try {
    if (typeof wx === 'undefined') return '';
    /* `theme` 只在 `app.json` 声明了 `darkmode: true` 时才有值（微信官方口径）。
       `getAppBaseInfo` 是新接口；老基础库退回 `getSystemInfoSync`。 */
    const info = (typeof wx.getAppBaseInfo === 'function')
      ? wx.getAppBaseInfo()
      : ((typeof wx.getSystemInfoSync === 'function') ? wx.getSystemInfoSync() : null);
    const t = info && info.theme;
    if (t === 'dark' || t === 'light') return t;
    const t2 = (typeof wx.getSystemInfoSync === 'function') ? wx.getSystemInfoSync().theme : '';
    if (t2 === 'dark' || t2 === 'light') return t2;
  } catch (e) { /* 旧宿主 / 预览环境 */ }
  return '';
}

/**
 * 当前有效主题。**同步**，且结果缓存 —— 首帧就要它，不能异步。
 * ⚠️ `theme` 缺失（旧宿主 / 未开 darkmode）⇒ **确定性回落 `light`**：
 *    这是"不支持就保持原样"的落点，与 WXSS 侧（根节点没有 `.theme-dark`）**同一条**。
 */
function current() {
  if (_theme) return _theme;
  _theme = (readHost() === 'dark') ? 'dark' : 'light';
  return _theme;
}

function isDark() { return current() === 'dark'; }

/** 主题变了的唯一出口（视图订阅它）—— 回调拿到新主题串 */
function subscribe(fn) {
  if (typeof fn === 'function' && _subs.indexOf(fn) < 0) _subs.push(fn);
}

function unsubscribe(fn) {
  const i = _subs.indexOf(fn);
  if (i >= 0) _subs.splice(i, 1);
}

function notify() {
  /* 快照一层：回调里可能有组件 detach 掉自己（改数组会跳过下一个） */
  _subs.slice().forEach(function (fn) {
    try { fn(_theme); } catch (e) { /* 单个订阅者出错不拖垮其余的 */ }
  });
}

/**
 * 重新读宿主主题 → **有变化才**通知一次。
 * 三处调用：`wx.onThemeChange`（主入口）、`App.onShow`（前台复核）、测试。
 * @returns {boolean} 是否真的变了（＝ 是否发了通知）
 */
function refresh() {
  const next = (readHost() === 'dark') ? 'dark' : 'light';
  if (next === _theme) return false;
  _theme = next;
  notify();
  return true;
}

/** 冷启动：同步定一次主题 ＋ 注册宿主主题事件（幂等，重复调只注册一次） */
function init() {
  current();
  if (_inited) return;
  _inited = true;
  try {
    if (typeof wx !== 'undefined' && typeof wx.onThemeChange === 'function') {
      wx.onThemeChange(function () { refresh(); });
    }
  } catch (e) { /* 老基础库没有这个事件：只靠 onShow 复核 */ }
}

/* ==========================================================================
   取色出口（调用方一律走这里，不要自己判 isDark 再抄一份 hex）
   ========================================================================== */

/** 项目色：入参是 `mock.PROJECT_COLORS` 里那一项（浅色原件），返回当前主题下的一份 */
function projectColor(light) {
  if (!light) return light;
  if (!isDark()) return light;
  const d = PROJECT_DARK[light.key];
  return d ? { key: light.key, name: light.name, main: d.main, soft: d.soft } : light;
}

/** 紧急程度：入参是 `mock.URGENCIES` 里那一项（**权重 / dash 等非色字段原样保留**） */
function urgency(light) {
  if (!light) return light;
  if (!isDark()) return light;
  const d = URGENCY_DARK[light.key];
  if (!d) return light;
  return {
    key: light.key, name: light.name, weight: light.weight, dash: light.dash,
    main: d.main, text: d.text, soft: d.soft
  };
}

/** 热力图图例：`light` 省略时用与本工程同值的浅色兜底 */
function heatLegend(light) {
  const src = (light && light.length) ? light : HEAT_LIGHT;
  return (isDark() ? HEAT_DARK : src).slice();
}

/** 脑图普通连线色（拼进 SVG data URI，见 mindmap-core） */
function linkColor() { return isDark() ? LINK_DARK : '#C8C8CC'; }

/** 开屏画布：**整条动画唯一的一支墨**（★190/191 起黄底板上那条描线也走这里；
 *  186 曾把它写死成浅色墨 —— 那样它会在交叉淡入里与末幕组合标"黑糊到白"） */
function splashInk() { return isDark() ? SPLASH_INK_DARK : '#1C1C1E'; }

/** 格式缩略图三色（`utils/formats.js` 现算 SVG 用）——
 *  ⚠️ 深色下必须走这里：缩略图原先把三色钉在模块常量里，深色时
 *  主墨根块（#1C1C1E）画在 #202123 卡底上对比 ≈ 1.06（等于没有）、白叶块成一粒粒白点。 */
function thumbColors() { return isDark() ? THUMB_DARK : THUMB_LIGHT; }

/** `wx.showModal` 的 `confirmColor`（同一个危险动作不该有两套红） */
function danger() { return isDark() ? DANGER_DARK : DANGER_LIGHT; }

/** 未归属项目的中性灰点 —— `projectColor(null)` 的补充（后者对空值原样返回） */
function noneColor() { return isDark() ? NONE_DARK : NONE_LIGHT; }

/** 上面那粒色点**背后那格圆底** —— 与 `noneColor()` **成对**用（≡ `--p-none` ＋ `--p-none-l`） */
function noneSoft() { return isDark() ? NONE_SOFT_DARK : NONE_SOFT_LIGHT; }

module.exports = {
  /* 状态 */
  current: current,
  isDark: isDark,
  refresh: refresh,
  init: init,
  subscribe: subscribe,
  unsubscribe: unsubscribe,
  /* 取色 */
  projectColor: projectColor,
  urgency: urgency,
  heatLegend: heatLegend,
  linkColor: linkColor,
  splashInk: splashInk,
  thumbColors: thumbColors,
  danger: danger,
  noneColor: noneColor,
  noneSoft: noneSoft,
  /* 常量（生成器 / 判据对撞用） */
  ICON_DARK: ICON_DARK,
  HEAT_DARK: HEAT_DARK,
  PROJECT_DARK: PROJECT_DARK,
  URGENCY_DARK: URGENCY_DARK,
  THUMB_DARK: THUMB_DARK,
  THUMB_LIGHT: THUMB_LIGHT,
  DANGER_DARK: DANGER_DARK,
  DANGER_LIGHT: DANGER_LIGHT,
  NONE_DARK: NONE_DARK,
  NONE_LIGHT: NONE_LIGHT,
  NONE_SOFT_DARK: NONE_SOFT_DARK,
  NONE_SOFT_LIGHT: NONE_SOFT_LIGHT
};
