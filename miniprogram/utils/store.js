/**
 * 本地状态层（静态前端：全部在内存里，单会话内可交互）
 * 业务判断全部在这里算完再交给页面 —— 页面只做渲染与交互转发。
 *
 * 对齐 需求说明书 V8 精简版：
 *   · FR-2  项目 ＝ 用户自建分类容器（无 task / 提问 / 交付物），可归档（FR-2.9）
 *   · FR-3  待办单级归属 ＋ 脑图协同；详情页取代卡片就地展开
 *   · FR-5  热力图 ＝ 待办创建 ＋ 待办完成 ＋ 胶囊创建（§7.2：**三个数各自独立计数**）
 *           ★★ 2026-10-09：计数源改为**活跃度台账**（`state.activity`，真库 `agenttodo_activity_day`）。
 *              原来是"遍历现存实体现算" ⇒ 删一条待办 / 取消一次完成 / 胶囊被转走，
 *              历史那天的颜色都会跟着变浅 —— 那统计的是「**现在还剩下什么**」，
 *              而热力图问的是「**那天发生过多少事**」。两者不是一回事（用户实测报出）。
 *   · FR-6  agent 全部手动维护
 *   · FR-8  三个内容模块各记一个「上次打开的详情 ID」，决定点导航时的落点
 */
const api = require('./api');
const mock = require('./mock');
const md = require('./markdown');
const fmts = require('./formats');
/* ★★ 2026-10-12：模型厂商清单（Token API 的"厂商"那一层）—— 见 utils/vendors.js */
const vendors = require('./vendors');
/* ★★★ 186 轮（深色模式）：主题服务 —— **本模块是"数据侧颜色"的唯一换色边界**。
   ⚠️ 为什么边界必须在这里、而不是各个调用点：`colorOf()` / `colorList()` 返回的是
      **带 hex 的原始对象**，下游（项目卡 / 待办卡的项目气泡 / 表单抽屉的色表 /
      概览的 agent 卡 / 脑图卡的色点）全都直接读 `.main` / `.soft` 打进行内 style。
      只要在这四个出口统一过一道 `theme`，全工程一次换色；若散到调用点去改，
      迟早漏一处（本工程 159 / 178 轮的教训）。 */
const theme = require('./theme');

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function pad(n) { return n < 10 ? '0' + n : '' + n; }

/**
 * 'YYYY-MM-DD HH:mm:ss' —— ★ 与后端 `src/common/time.ts` 的 `nowStr()`
 * **同格式、同精度、同时区口径（都是本地时间字符串）**。
 *
 * ⚠️⚠️ 精度必须一致 —— 这是本轮真机量出来的一条真缺陷，别再退回去：
 *   列表排序是**字符串字典序**，而"前端乐观插入的那条"与"后端落库后 hydrate 回来的那条"
 *   **会混在同一张列表里**（后者由 `queue()` 的 `mergeOne()` 覆盖上来，`createdAt` 取自
 *   服务端 `nowStr()`，**带秒**）。
 *   前端原来只到分钟 ⇒
 *       '2026-09-30 17:10'   vs   '2026-09-30 17:10:23'
 *   前缀相同、**短的小** ⇒ 同一分钟内**新录的那条被排到上一条前面**（＝列表中部）。
 *   症状（用户 2026-09-30 报）：胶囊停录后「列表中空出一个位置」—— 因为它的入场动画
 *   是**按"最后一条"算落点**的（见 `capsule.js` 的 `_scrollBottomTo`）：
 *   新条一旦不在末尾，滚动目标/幽灵落点全部指向别处，而真身还在那一格隐身。
 *   mock 态看不出（那时所有数据都由本函数生成、同精度），**接后端才暴露**。
 *
 * 显示一律**截到分钟**再渲染（见 `atMin()`）—— 别把秒露给用户。
 */
function stamp(d) {
  const t = d || new Date();
  return t.getFullYear() + '-' + pad(t.getMonth() + 1) + '-' + pad(t.getDate()) +
    ' ' + pad(t.getHours()) + ':' + pad(t.getMinutes()) + ':' + pad(t.getSeconds());
}

/**
 * 排序键：把**无秒**的时间串（'YYYY-MM-DD HH:mm'）显式读作**该分钟的 0 秒**。
 *
 * ── 它是干什么的（以及**不是**干什么的）──────────────────────────────────
 * ⚠️ 它**不是**那条错排的修复 —— 修那条的是 `stamp()` 带秒（见它上面那段注释）。
 *    补 `:00` 救不了"本地乐观插入的串少一档精度"这件事：
 *    '17:10:00' 仍然小于 '17:10:23'，照样排到同分钟那条前面。
 * ✅ 它解决的是**另一个入口**：库里本来就可能有**无秒**的字符串 ——
 *    `mock.js` 的种子全是无秒，更早版本写进真库的数据也是。
 *    不归一化时，比较结果取决于"两个串谁短"，短的那个恒定更小。
 *    对"无秒 ＝ 该分钟 0 秒"这种老数据来说那**恰好**是对的，
 *    但那是**巧合**、不是契约 —— 一旦哪天又冒出一种"无秒却代表更晚时刻"的写入方，
 *    它会静默地错排（正是本工程最怕的那类"不报错的错"）。
 *    ⇒ 归一化把口径写死：**无秒就按 0 秒算**，行为可预测。
 *
 * ⚠️ 只补 16 位这一种；其余（带秒 / 空串 / 异常值）原样返回，不猜、不改写 ——
 *    排序只要"可比"即可。
 */
function tkey(s) {
  const t = String(s == null ? '' : s);
  return t.length === 16 ? t + ':00' : t;
}

/**
 * 显示口径：时间串**截到分钟**（'2026-09-30 17:10:23' → '2026-09-30 17:10'）。
 *
 * ★ 46 轮定的口径是「全量时间（2026-09-22 17:30）」—— 到分钟，**不带秒**。
 * ⚠️ 凡把时间串直接绑进 wxml 的地方都先过它一遍：存储是秒级精度，
 *    后端 hydrate 回来的数据**本来就带秒**，不截就会在页面上露出 `:23`。
 */
function atMin(s) { return s ? String(s).slice(0, 16) : ''; }
function dateOf(s) { return s ? String(s).slice(0, 10) : ''; }

/**
 * ★★ 2026-10-22 · **客户端 id 的唯一生成口**（项目 / 待办 / 脑图 / 节点 / agent / key）。
 *
 * ── 改前为什么是错的（审查 P2-11，只读测试已复现）──────────────────────────
 *   原写法 `'d' + (Date.now() % 100000)` 有两个**确定性**缺陷：
 *   ① **同一毫秒**连建两条 ⇒ 两次都取到同一个尾数 ⇒ id 完全相同
 *      （测试里 `addTodo` 连着调两次，a、b 都是 `d123`）⇒ WXML `wx:key` 冲突、
 *      `state.todos` 里按 id 更新会**同时改两条**、详情记忆指向"两条中的哪一条"说不清；
 *   ② `% 100000` 让 id 每 **100 秒**循环一次 ⇒ 同一会话里隔一会儿建的实体也可能撞上。
 *   ⚠️ 后端**接得住任何 1–40 位的 `[A-Za-z0-9_-]`**（见 `后端服务/src/common/client-id.decorator.ts`
 *      的 `CLIENT_ID_RE`），所以这里换格式**不需要后端改**；撞 id 时服务端抛 P2002 → 2004。
 *
 * ── 现在的口径 ──────────────────────────────────────────────────────────────
 *   前缀 ＋ **不取模的毫秒时间戳** ＋ `-` ＋ **进程内自增序号**（最多三位一轮）
 *   ⇒ 长度 `1 + 13 + 1 + 1..3 = 16..18` 位，远小于 40；
 *   ⇒ 同毫秒内的多次创建由序号拆开，序号回绕（1000 次）也要再同一毫秒内不可能发生。
 *   ⚠️ **别再写回 `% N`**：取模换来的"id 短一点"没有任何下游收益（没有任何地方解析 id），
 *      换来的是确定性碰撞。
 *   ⚠️ 保留前缀（`p` / `d` / `m` / `n` / `a` / `k`）—— 它是人读日志时的唯一线索
 *      （`mergeOne()` 靠**在不在哪张表里**分流，不靠前缀解析，所以前缀只是可读性）。
 */
let _idSeq = 0;
function uid(prefix) {
  _idSeq = (_idSeq + 1) % 1000;
  return String(prefix || '') + Date.now() + '-' + _idSeq;
}

/**
 * 「月-日」短写（★ 45 轮·待办卡底行用）：'2026-09-21 21:04' → '**9-21**'。
 * 与 `dateOf(...).slice(5)`＝'09-21' 的差别只在**月份不留前导零** —— 卡片底行是
 * 「创建9-21 · 未完成 · 更新9-22」这种挤在一行里的元信息，少一位更清爽。
 * 日仍是两位（对齐好扫）。解析不出来就给空串，页面自然不渲染那一段。
 */
function mdShort(s) {
  const d = dateOf(s);
  if (!d || d.length < 10) return '';
  return String(Number(d.slice(5, 7))) + '-' + d.slice(8, 10);
}

/**
 * 「年月日」中文全写（★ 169 轮 · 项目脑图卡那行「更新时间」用）：
 *   '2026-10-09 21:04' → `2026年10月9日`。
 * ⚠️ 与 `mdShort` 那档**刻意不同**：`mdShort` 是给「创建9-21 · 未完成 · 更新9-22」
 *   这种一行挤三项的元信息用的（越短越好）；这里是**一整行只装一件事**，
 *   语境是"这张图是什么时候动过的"，要的是**正式**（用户口径：「10-09 太不正式」）。
 * ⚠️ 月与日**不留前导零**（"10月9日" 不是 "10月09日"）—— 中文里就这么念；
 *   顺带省两位宽（手机档那行本来就窄）。
 * 解析不出来 → 空串，页面自然不渲染那一段。
 */
function cnDate(s) {
  const d = dateOf(s);
  if (!d || d.length < 10) return '';
  return d.slice(0, 4) + '年' + Number(d.slice(5, 7)) + '月' + Number(d.slice(8, 10)) + '日';
}

/**
 * 距离下次重置还有几天 —— agent 的 `quotaResetAt` **只记「日」**（如 `'15'`）。
 * · 各家 agent 都按**自然月**重置 ⇒ 月份没有信息量，只记日
 *   （★ 133 轮改：早先记 `'MM-DD'`，那个月份要手填、还得自己推"今年还是明年"，是个纯错源）
 * · 已过今天就按**下个月**的同一天算 —— 那才是「下次」重置
 * · 目标月没有这一天（31 号遇上 2 月）⇒ **退到该月最后一天**（不猜闰年，2 月固定 28）
 * · 没填 / 解析不出来 → null，页面显示「未填」
 */
function daysUntilReset(s) {
  const day = resetDayOf(s);
  if (day === null) return null;
  const base = new Date(baseToday() + 'T00:00:00');   // ★ 真数据 ⇒ 真实今天（见 baseToday()）
  let t = resetAt(base.getFullYear(), base.getMonth(), day);
  if (t < base.getTime()) t = resetAt(base.getFullYear(), base.getMonth() + 1, day);
  return Math.round((t - base.getTime()) / 86400000);
}

/* ---------------- quotaResetAt ＝「每月几号」的解析 / 合成 ----------------
 * ★ 133 轮：**只记「日」**。表单里是一个 1–31 的循环步进器（不弹日历、也不弹键盘），
 *   数据层就 `'01'`–`'31'` 这两个字符；解析 / 合成收口在这里，
 *   表单 / 概览 / 项目详情都不用知道它长什么样。
 * ★ 42 轮·补二那代是「月 / 日」两行步进器 ＋ 'MM-DD' 串 —— 月份那一半已删（见上）。
 */
const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 某月最多几天 —— 只记日、不记年，2 月按 28 固定（不猜闰年） */
function daysInMonth(mon) {
  const m = Math.round(Number(mon));
  return (m >= 1 && m <= 12) ? MONTH_DAYS[m - 1] : 31;
}

/**
 * 「每月第 day 日」在**某年某月**零点的毫秒时刻（月从 0 起）。
 * ⚠️ 必须**先夹到该月最后一天**再交给 `Date` —— `new Date(2026, 1, 31)` 会静默滚到 3 月 3 日
 *    （JS 的日期溢出），"每月 31 日"于是被算成"还有一个月"，**不报错、只是数字错**。
 */
function resetAt(year, monIdx, day) {
  const y = year + Math.floor(monIdx / 12);
  const m = monIdx - Math.floor(monIdx / 12) * 12;   // 调用点只会传 0–12，取模只为防御
  const max = daysInMonth(m + 1);
  return new Date(y, m, day > max ? max : day).getTime();
}

/**
 * 解析「每月重置日」⇒ **只回日**（1–31）；空 / 解析不出回 `null`（＝未填）。
 * 兼容三种历史写法，都从里面抠出末尾那一节「日」：
 *   `'15'`（★ 现行）· `'10-15'`（42 轮的"月-日"）· `'2026/10/15 13:54:03'`（更早的完整时间戳）
 * ⚠️ 不能简单"取最后两位" —— 完整时间戳的末两位是**秒**。
 */
function resetDayOf(s) {
  const str = String(s == null ? '' : s).trim();
  if (!str) return null;
  const m = /^(?:\d{4}[-\/])?(?:\d{1,2}[-\/])?(\d{1,2})(?:\s|$)/.exec(str);
  if (!m) return null;
  const d = Math.round(Number(m[1]));
  if (!d || d < 1) return null;
  return d > 31 ? 31 : d;
}

/** 新建 agent 的默认值 ＝ **每月 1 号**（自然月重置，多数厂家就是这么算的） */
function nextResetDay() { return 1; }

/** `1` → `'01'`（补零两位；畸形输入一律落到 `'01'`） */
function joinResetDay(day) {
  const d = Math.round(Number(day));
  return pad(d >= 1 && d <= 31 ? d : 1);
}

/** 步进器的 ±1：1–31 **循环**（31 再 ＋ 回 1；1 再 − 回 31）——
 *  "每月重来"本身就带循环语义，点满一圈比顶住（到 31 就不动）更顺 */
function stepResetDay(cur, delta) {
  let d = Math.round(Number(cur));
  if (!d) d = 1;
  d += Math.round(Number(delta)) || 0;
  if (d > 31) d = 1;
  if (d < 1) d = 31;
  return d;
}

/**
 * 通用截断：**最多 n 个字**，超出补省略号。
 * ⚠️ 09-22 走查后标题栏不再显示详情名 ⇒ 当前**暂无调用点**；保留 ——
 *    列表摘要 / 详情节选这类地方还要它，且它是"按可见字符截断"的唯一真源。
 * 「字」按可见字符算 —— 空白不计入计数，但原位保留，中英混排时更接近直觉：
 *   '补齐 OCR 期号截断的兜底逻辑…' → '补齐 OCR 期号截断的…'（10 个可见字）
 * 正好 n 个字（或更少）时原样返回，不补省略号。
 */
function clip(s, n) {
  const str = String(s == null ? '' : s).trim();
  const max = n || 10;
  let count = 0;
  let cut = -1;                       // 第 max 个可见字符的下标
  for (let i = 0; i < str.length; i++) {
    if (str[i] === ' ' || str[i] === '\u3000') continue;
    count += 1;
    if (count === max) { cut = i; break; }
  }
  if (cut < 0 || cut === str.length - 1) return str;
  return str.slice(0, cut + 1) + '…';
}

const TODAY = '2026-09-21';

/**
 * 算「距今多少天」时该拿哪一天当"今天"（★ 2026-09-30 新增）。
 *
 * · **真快照灌进来了**（`state.loaded`）⇒ **系统真实今天**。
 *   数据是实时的，基日就必须是实时的 —— 原来一律拿 `TODAY`（种子基准 09-21）算，
 *   于是联调时概览显示「距离重置 28 天」而真值是 19 天（实测 a1：quotaResetAt=10-19），
 *   **整整差 9 天**（正好是种子基准与真实日期的偏移）。这类"数字看着像个合理值、
 *   所以没人怀疑"的错，比报错难发现得多。
 * · **还是种子数据** ⇒ `TODAY`（种子基准）。演示数据的每一条时间都围着 09-21 写，
 *   换成真实今天会把「过期弱化」整体推过阈值（实测：mock 的 `a2` 会从"不弱化"
 *   变成"弱化"）⇒ **把 114 轮走查过的演示形态改掉**。
 *
 * ★ 与 `todayCell()` 的做法**故意不同**，两边各有理由：
 *   热力图窗口本身就跟真实日期走（`mock.js` 的 `LAST_MONDAY`），所以"今天那一格"必须
 *   按真实日期反查，否则根本查不到；而这三个量（距离重置 / 已过天数 / 下次重置默认值）
 *   跟的是**数据本身的年代**，所以按 `state.loaded` 分流。
 * ⚠️ 别在 `state` 装配过程中调它（`state` 是 `const`，那会儿还没初始化 —— TDZ）。
 *    调用点都是渲染期（`agentCardViews()` / 表单装配），安全。
 */
function baseToday() { return state.loaded ? dateOf(stamp()) : TODAY; }

/** 概览按**色槽位数量**最多列几张项目卡（`mock.PROJECT_COLORS` 就 8 个槽位 —— 再多也认不出第 9 种色） */
const PROJECT_SLOTS = mock.PROJECT_COLORS.length;
/** FR-5.3 的「过期弱化」阈值：N 天没手填过 ⇒ 概览那张 agent 卡弱化（设计阶段定 7 天） */
const STALE_DAYS = 7;

/* 热力图「现算」的那两格缓存槽位（★ 第 97 轮）——
   ⚠️ **必须声明在这里（模块顶层、`state` 之前）**：`state` 装配完紧接着就会调
   `todayCell()`（见下面 `state.ui.heatSelected`），那一刻 `heatWeeks()` 会读这两个变量。
   原来它们写在 `heatWeeks()` 上方（文件后部）⇒ 直接撞 `let` 的 TDZ：
   `Cannot access '_heatCache' before initialization`（模块还没执行到那一行）。
   用法与失效规则见 `heatWeeks()`。 */
let _heatCache = null;
let _heatKey = '';

const state = {
  /* 个人资料 —— ★ 09-22 第四十二轮：只留「用户名 ＋ 头像」
     头像为空 ＝ 用默认图标；有值 ＝ 相册选出来的本地临时路径（真机接后端时换成上传后的 url）。
     ❌ 去掉了 desc：页面上不再有那句自述小字。 */
  me: {
    name: '我的工位',
    avatar: '',
    /* 服务端要的**相对 uri**（`avatar` 那格给的是"能显示的值"：完整 URL 或本地临时路径） */
    avatarUri: ''
  },
  build: 'Agent ToDo v1.1.0 · 构建 20260921 · 一期精简版（V8）',

  /* ★ 本轮：`GET /sync` 的快照灌进来了没有。
     mock 下恒为 false —— 没有任何启动流程会去改它，读它的人按"已就绪"处理。 */
  loaded: false,

  agents: clone(mock.AGENTS),
  tokenKeys: clone(mock.TOKEN_KEYS),   // 模型厂家 key（Token API · ★★ 175 轮起余额是**真查**回来的）
  projects: clone(mock.PROJECTS),
  todos: clone(mock.TODOS),
  mindmaps: clone(mock.MINDMAPS),
  tree: clone(mock.MINDMAP_TREE),
  /* ★ 本轮：每张脑图一份**编辑历史栈**（撤销 / 重做）——
     结构形状：`{ stack: ['<tree 的 JSON>', …], idx }`，`stack[idx]` 恒等于当前树。
     放在 store 而不是组件里：节点增删 / 拖动 / 改文本都在这里发生，
     快照点跟着写操作走，组件那层就只管"点一下调 undo()"。
     懒创建（第一次改动时才 push 初版），不占启动开销。 */
  hist: {},
  heat: clone(mock.HEATMAP),
  /* ★★ 2026-10-09：活跃度**台账** —— 热力图的**计数真源**（`FR-5`）。
     形状：`{ 'YYYY-MM-DD': {created, completed, capsule} }`（按日索引，便于逐格 O(1) 直取）。
     ★ 语义是「**动作发生过几次**」而不是「现在还剩几条」⇒ **只加不减**：
       删待办、取消完成、胶囊被消费，这里**一个数都不减**。
     · mock 态：初值由演示实体推出来（`mock.buildActivity()`）—— 演示数据没有删除/取消的
       历史，所以与改动前的现算结果**逐格等价**，走查图形态一个像素不变；
     · 真接口：由 `GET /sync` 的 `activity` 灌进来（见 `_load()` → `adaptActivity()`）。 */
  activity: clone(mock.ACTIVITY),
  /* ★ 本轮：闪念胶囊 —— 口播接住的一段段碎信息（FR-9）。
     与待办 / 脑图不同，它**没有任何归属**（不挂项目、不挂脑图）：
     先接住，等到整理那一刻才被「转成待办」或「转到脑图」消化掉。 */
  capsules: clone(mock.CAPSULES),

  ui: {
    /* —— FR-8.4 三模块各一个「上次打开的详情 ID」（记忆） —— */
    projectId: 'p1',
    todoId: 'd1',
    mindmapId: 'm1',

    /* —— 列表抽屉 —— */
    drawer: { open: false, kind: '', activeId: '' },

    /* —— 待办列表的筛选（★ 第四十七轮 · 筛选副弹窗）——
       四个条件各自独立、与左侧列表实时联动。
       ★★ 160 轮：`status` 默认 **'open'（未完成）** —— 用户口径「默认只显示"未完成"的待办卡片」。
       ⚠️ 这张字面量与下面的 `TODO_FILTER_DEF` 必须是**同一份默认值**
          （`resetTodoFilter()` 用的是那一份）—— 两处不一致就会出现
          "清除全部筛选之后列表反而多出一批已完成"这种莫名现象。 */
    todoFilter: { kw: '', status: 'open', projectId: '', range: 'all' },

    /* —— 项目列表的筛选（★ 第五十六轮 · 同款副弹窗）——
       status 默认 **active**（FR-2.10 项目列表默认视图 ＝ 活跃）；
       「筛选 N」的计数不把默认值算作已生效条件（与待办的 'all' 同一条规则，见 projectFilterCount）。 */
    pFilter: { kw: '', status: 'active', node: 'all', agentId: '' },

    /* —— 脑图列表的筛选（★ 本轮 · 同款副弹窗）——
       三组条件，默认全 = 不筛（脑图**没有「活跃 / 已归档」**这一档：归档是项目的属性，
       归档项目下的脑图本来就要能翻到，见 `D-15`）。
       `format` 的存储值就是 `mindmap.format`（六种格式 key，见 utils/formats.js）。 */
    mFilter: { kw: '', projectId: '', format: 'all', range: 'all' },

    /* —— 表单抽屉（FR-3.6 / FR-3.9 · D-4 定案走抽屉） —— */
    form: { open: false, mode: 'todo', id: '', offset: 0 },

    /* —— 概览 ——
       ★ 第 59 轮：默认选中**今天**那一格 —— 一进页面就有一条明细可读，
         不必先点一下；因此页面上不再存在「未选中」的状态，也就没有空态。
         ⚠️ 这里是**系统真实今天**（不是种子基准 `TODAY`）—— 见 `todayCell()` 的说明。
         初值在下面的 `state` 装配完之后补（它要读 `state.heat`）。 */
    heatSelected: null
  }
};

/* 热力图默认落在今天那一格 —— 写在字面量外面，是因为它要读已经装配好的 state.heat */
state.ui.heatSelected = todayCell();

/* ================= 静态字典 =================
   ★★★ 186 轮（深色模式）：下面这一组是**颜色进入视图的唯一出口** ——
       `mock` 里那几份调色板**恒为浅色原件**（是"身份"的定义处，不随主题动），
       **显示色**一律在这里过 `theme` 之后才交给调用方。
   ⚠️ key / name / weight / dash 等**非色字段一律原样保留**：
      项目色身份靠 `key`（`qing` / `lv` / …），不靠 hex；
      紧急度的排序权重与虚线档位也不许被换色带偏。 */
function colorOf(key) {
  const c = mock.PROJECT_COLORS.filter(function (x) { return x.key === key; })[0] || null;
  return theme.projectColor(c);
}
function urgencyOf(key) {
  const u = mock.URGENCIES.filter(function (x) { return x.key === key; })[0] || mock.URGENCIES[0];
  return theme.urgency(u);
}
function projectNodes() { return mock.PROJECT_NODES.slice(); }
function colorList() { return mock.PROJECT_COLORS.map(theme.projectColor); }
function urgencyList() { return mock.URGENCIES.map(theme.urgency); }
/**
 * 活跃度日历的 **5 档色卡**（当前主题）—— 与 `colorList()` / `urgencyList()` 同族：
 * "有哪几档"由这里一处说了算，颜色经 `theme.heatLegend()` 出。
 * ⚠️ 浅色下 `theme.heatLegend(src)` 原样返回 `state.heat.legend`（逐值不变）；
 *    深色下换成"越活跃越亮"那一支（同一语义的另一种显示，见 `utils/theme.js`）。
 */
function heatLegend() { return theme.heatLegend(state.heat.legend); }
/**
 * 「**未归属项目**」的中性灰点 ／ 它背后那格圆底 —— 与 `colorOf()` **同族**（同一处出口）。
 *
 * ⚠️ 为什么需要这两支：`PROJECT_COLORS` 只有 **8 个色槽、没有"无"这一档** ⇒
 *    `colorOf('')` 返回 `null`，于是各处 `c ? c.main : '#8E91A0'` 的兜底就是这么来的。
 *    那两处 hex 原先**裸写** ⇒ 深色下同一类色点两个来源、浅灰在深卡上偏暗一档
 *    （审查-02 P1-17；报告只数出 4 处，实际连同 `soft` 共 19 处）。
 * ★ 点与底**必须成对**换（≡ `--p-none` ＋ `--p-none-l`）—— 只换点不换底，
 *   深色下一粒深灰点会坐在一块近白圆底上，比完全不换还难认。
 */
function noneColor() { return theme.noneColor(); }
function noneSoft() { return theme.noneSoft(); }

/**
 * `wx.showModal` 的 `confirmColor` —— 危险动作（删除 / 清空）确认键的那支红。
 * ★ 审查-02 P2-20：原先全工程 **5 处**各写一遍 `'#C63B2E'` 字面量（报告只数出 3 处），
 *   深色下它们仍是浅色那支红 —— 而 `--danger` 的深色档是 `#F08070`（浅色底上看不清、
 *   深色底上又偏暗）⇒ 同一个危险动作**两套红**，与 `--danger` 那条腿脱钩。
 *   与 `noneColor()` 同族：**颜色一律从 store 这一处出**，调用方不自己判主题。
 */
function danger() { return theme.danger(); }

/* ================= 查询 · 项目 ================= */

function rawProject(id) { return state.projects.filter(function (p) { return p.id === id; })[0] || null; }
/** 记忆失效时返回 null，由页面走「空态」分支（FR-8.4） */
function projectById(id) { return rawProject(id); }

function isArchived(p) { return !!(p && p.archivedAt); }
function activeProjects() { return state.projects.filter(function (p) { return !isArchived(p); }); }
function archivedProjects() { return state.projects.filter(isArchived); }

/**
 * 某个颜色是否已被**别的**项目占用（★ 57 轮）——
 * 项目色是**项目身份的唯一颜色载体**（8 个固定槽位，见 `mock.PROJECT_COLORS`），
 * 两个项目撞成同一个颜色之后，列表 / 卡片上的色点就再也认不出谁是谁。
 * 所以新建 / 编辑项目的表单里，被别家占了的颜色**置灰不可选**。
 *
 * @param {string} key      色键；`''`（无颜色）永远不算占用 —— 多个项目都可以不着色
 * @param {string} exceptId 排除的项目 id：**编辑自己时自己那一格不算被别人占**
 * @returns {object|null}   占用者；没人用 → null
 *
 * ⚠️ 已归档项目同样算占用 —— 归档只是退出活跃视图（FR-2.9），
 *    内容与归属一条不改，取消归档之后就会和它撞色。
 */
function projectOfColor(key, exceptId) {
  if (!key) return null;
  return state.projects.filter(function (p) {
    return p.color === key && p.id !== exceptId;
  })[0] || null;
}

/** 项目列表排序：综合紧急度降序 → 紧急条数 → 最近更新（FR-2.10 / C16） */
function sortProjects(list) {
  return list.slice().sort(function (a, b) {
    const sa = scoreOf(statOfProject(a.id));
    const sb = scoreOf(statOfProject(b.id));
    if (sb !== sa) return sb - sa;
    if (statOfProject(b.id).urgent !== statOfProject(a.id).urgent) {
      return statOfProject(b.id).urgent - statOfProject(a.id).urgent;
    }
    return tkey(b.updatedAt).localeCompare(tkey(a.updatedAt));
  });
}

/* ================= 项目列表筛选（★ 第五十六轮 · 筛选副弹窗）=================
 * 四个条件挂在 `ui.pFilter`，与待办那份（下面 `TODO_FILTER_DEF`）同构：
 *   kw       关键词 —— 只在**项目名**里找（大小写不敏感、忽略首尾空白）
 *   status   active(默认) | archived | all      —— 默认＝活跃视图（FR-2.10）
 *   node     all | 构思期 | 建设期 | 迭代期 | 暂停期（取值域 ＝ `projectNodes()`）
 *   agentId  'all' = 全部，其余是 agent id
 *
 * ⚠️ 默认值一律**不参与**「筛选 N」的计数：status 的默认是 `active` 而不是 `all`，
 *    所以计数里判的是 `status !== 'active'`（与待办判 `status !== 'all'` 同一条规则）。
 * ⚠️ 与「待办筛选」一样是**即时联动**：改任何一项都立刻重画左边那张列表，没有「确定」。
 */
const P_FILTER_DEF = { kw: '', status: 'active', node: 'all', agentId: 'all' };

function projectFilter() { return state.ui.pFilter; }

function setProjectFilter(key, value) {
  state.ui.pFilter[key] = value == null ? '' : value;
  return state.ui.pFilter;
}

function resetProjectFilter() {
  state.ui.pFilter = clone(P_FILTER_DEF);
  return state.ui.pFilter;
}

/** 已生效的条件**条数**（默认值不计）—— 标题栏那颗「筛选」按钮靠它显示数字并转深色 */
function projectFilterCount() {
  const f = state.ui.pFilter;
  let n = 0;
  if (String(f.kw || '').trim()) n += 1;
  if (f.status && f.status !== 'active') n += 1;
  if (f.node && f.node !== 'all') n += 1;
  if (f.agentId && f.agentId !== 'all') n += 1;
  return n;
}

/** 按当前条件过一遍项目（**不改排序** —— 活跃/已归档各排各的，见 visibleProjects） */
function filterProjects(list) {
  const f = state.ui.pFilter;
  const kw = String(f.kw || '').trim().toLowerCase();
  return list.filter(function (p) {
    if (kw && String(p.name || '').toLowerCase().indexOf(kw) < 0) return false;
    if (f.status === 'active' && isArchived(p)) return false;
    if (f.status === 'archived' && !isArchived(p)) return false;
    if (f.node && f.node !== 'all' && (p.node || '') !== f.node) return false;
    if (f.agentId && f.agentId !== 'all' && (p.agentId || '') !== f.agentId) return false;
    return true;
  });
}

/**
 * 项目列表抽屉看到的顺序 ＝ **筛选 → 活跃在前（按综合紧急度）／ 已归档沉底（按归档时间）**。
 *   先分两拨 `activeProjects()` / `archivedProjects()` 再各自筛，是为了保住 FR-2.10 那条
 *   「已归档项目排在最后区、不参与综合紧急度排序」—— 合成一拨再排，归档项目会跟着紧急度
 *   插到活跃项目中间去。
 */
function visibleProjects() {
  const act = sortProjects(filterProjects(activeProjects()));
  const arc = filterProjects(archivedProjects()).slice().sort(function (a, b) {
    return tkey(b.archivedAt).localeCompare(tkey(a.archivedAt));
  });
  return act.concat(arc);
}

/**
 * 某个项目的四档待办条数（留置计 0 分但仍显示条数 · FR-5.2）
 * ★★ 160 轮：**已删除的不计** —— 这张卡报的是"这个项目还欠着什么"，
 *   一条已经删掉的待办不该再占一颗数字（否则"卡片说我还有 3 条紧急，
 *   点进去一条都找不到"）。项目卡的 `total` 与 `score` 都从它派生，改这一处即全对。
 */
function statOfProject(pid) {
  const s = { urgent: 0, mid: 0, low: 0, hold: 0 };
  state.todos.forEach(function (t) {
    if (t.projectId !== pid || t.done || isDeletedTodo(t)) return;
    if (s[t.urgency] !== undefined) s[t.urgency] += 1;
  });
  return s;
}
function scoreOf(stat) {
  return (stat.urgent || 0) * 5 + (stat.mid || 0) * 3 + (stat.low || 0) * 1 + (stat.hold || 0) * 0;
}
function statTotal(stat) {
  return (stat.urgent || 0) + (stat.mid || 0) + (stat.low || 0) + (stat.hold || 0);
}

/**
 * 项目卡的装配 —— **项目列表主弹窗（`drawers.packProjectCard`）与概览「项目待办统计」共用这一份**。
 * ★ 第 59 轮从 `drawers.js` 提到 store：概览的项目卡改成与项目卡同形（FR-5.2「复用项目卡片」），
 *   若两边各写一份，改一边漏一边是迟早的事（本工程已在这类问题上踩过两次）。
 * 字段 ＝ 项目卡（`FR-2.5`）那一套：色点色值 · 节点 · 关联 agent 名 · 四档条数 · 脑图数 · 归档态。
 * ⚠️ `color` 给的是**色值**（不是 `p.color` 那个色键）—— 色键本身不再对页面暴露。
 */
function projectCardView(p) {
  const c = p.color ? colorOf(p.color) : null;
  const stat = statOfProject(p.id);
  const agent = p.agentId ? agentById(p.agentId) : null;
  const arch = isArchived(p);
  return {
    id: p.id,
    name: p.name,
    node: p.node,
    color: c ? c.main : noneColor(),
    soft: c ? c.soft : noneSoft(),
    agentId: p.agentId || '',
    agentName: agent ? agent.name : '',
    stat: stat,
    /* ★★ 203 轮：四档条的**渲染形状** —— 档名与键名只有一份真源（`urgencyList()`），
       卡面不再手抄「紧急 / 中等 / 不紧急 / 留置」四个中文名（156 轮那条口径）。
       ⚠️ 概览「项目待办统计」与项目列表主弹窗**共用这一份**（第 59 轮起），
          所以"项目卡的四档条"改一次两处一起变 —— 本轮「两处统一」的落点就在这里。
       ⚠️ 键名与 `statOfProject()` 的计数键**同源**（都是 `mock.URGENCIES[].key`），
          漂了就会出现"档名有第四档、计数里没有"这种静默错（判据 A2 钉这条）。 */
    statChips: urgencyList().map(function (u) {
      return { key: u.key, name: u.name, n: stat[u.key] || 0 };
    }),
    total: statTotal(stat),
    score: scoreOf(stat),
    mindmaps: mindmapsOfProject(p.id).length,
    archived: arch,
    archivedAt: arch ? dateOf(p.archivedAt).slice(5) : ''
  };
}

/**
 * 概览「项目待办统计」的项目卡（FR-5.2）：**排除已归档** → **只取有颜色的项目**
 * → 按综合紧急度降序 → 最多 `PROJECT_SLOTS`(8) 张。
 *   · 只取有色项目：项目色是**项目身份唯一的颜色载体**（8 个固定槽位），
 *     没着色的项目在这张"按色识人"的网格里认不出来，混进来只会多一张读不懂的卡；
 *   · 上限 8 ＝ 色槽位数量，先到先得（排序在前的项目占位）；
 *   · 分数（`score`）仍随卡片带出去，但**卡面不表达它** —— 排序用，
 *     表达交给四档条数（FR-5.2 明确「分数只承担排序、不承担表达」）。
 */
function overviewProjectCards() {
  const colored = activeProjects().filter(function (p) { return !!p.color; });
  return sortProjects(colored).slice(0, PROJECT_SLOTS).map(projectCardView);
}

/* ================= 查询 · 待办 ================= */

/**
 * ★★ 160 轮：**这条待办是不是"已删除"**（逻辑删除）。
 *
 * 数据层只认一个字段 `deletedAt`（有值 ＝ 已删除），对外的读法统一收在这一个函数里 ——
 * 全工程**不许**在别处写 `t.deletedAt` 或 `t.status === 'deleted'`：
 * 一旦有两种写法，下一轮改口径就会改一处漏一处（本工程已在这类问题上踩过两次）。
 *
 * ⚠️ 与 `status`（`done`）**正交**：已删除的待办仍然记得自己删之前是未完成还是已完成
 *    （后端软删不碰 `status`），只是界面上不给它那个档位而已（见 `filterTodos`）。
 *
 * ⚠️ 两种写法都认（`deletedAt` 时刻串 **或** `deleted` 布尔）—— 与 `adaptTodo()` 落布尔
 *    时那句 `!!(t.deletedAt || t.deleted === true)` **逐字同源**，两边不许各认一种：
 *    · 真接口下来的走 `adaptTodo()`，两个字段并存；
 *    · `mock.js` 的种子**绕过适配层**直接进 `state`（`state = clone(mock.TODOS)`）⇒
 *      种子里写了哪个都该被认出来（写漏一种不会报错，只会"这条删了却还在列表里"，
 *      是那种要查半天的静默错）。
 */
function isDeletedTodo(t) { return !!(t && (t.deletedAt || t.deleted === true)); }

/** 未删除的待办（**所有"正常视图"的数据源**：列表、计数、四档统计、项目页看板…） */
function aliveTodos() { return state.todos.filter(function (t) { return !isDeletedTodo(t); }); }
/** 已删除的待办（**只有「已删除」筛选那一档读它** —— 它是还原的唯一入口） */
function deletedTodos() { return state.todos.filter(isDeletedTodo); }

/**
 * ★ 定位一条待办 —— **在全量数组里找，不做"活/删"之分**。
 *
 * ⚠️ 这一条是**有意**不滤的：详情页要能显示一条**已删除**的待办
 *    （它的操作区只有「还原」，那是唯一的回头路）。
 *    同理 `validMemory()` 也走它 —— 记忆指向一条已删除的待办时，
 *    详情页该正常打开并显示「已删除」，而不是当成"记忆失效"清掉。
 */
function rawTodo(id) { return state.todos.filter(function (t) { return t.id === id; })[0] || null; }
function todoById(id) { return rawTodo(id); }

/** 某个项目下的待办 —— ★★ 160 轮起**不含已删除**（项目页的看板与计数都不该数它） */
function todosOfProject(pid) {
  return state.todos.filter(function (t) { return t.projectId === pid && !isDeletedTodo(t); });
}

/**
 * ★★ 162 轮：项目概要三数 —— **未完成待办 / 已完成待办 / 项目脑图**。
 *
 * 为什么要有它：同一张「基础信息卡」长在**两页**（项目详情 ／ 待办详情的「所属项目」），
 * 162 轮起卡上要报这三个数 ⇒ 两页各 filter 一遍的话，迟早出现"同一张卡在两页数不一样"。
 * 本工程在这类"两处装配"上已经踩过两次（第 59 轮就是把项目卡装配提进 store 解决的）。
 *
 * ⚠️ **不含已删除**：`todosOfProject()` 自 160 轮起就滤掉软删的 ——
 *    "这个项目有多少活"里不该算已经被删掉的那几条。
 * ⚠️ `open + done` ＝ 这个项目**活着的待办总数**（＝ 归档确认弹窗里报的那个数，同源不同用）。
 * ⚠️ **项目页自己不走这个函数**：那边网格铺的就是未完成集合，`openCount` 必须与网格同源
 *    （`open.length`），否则会出现"格子里写 5、点开只有 3 张卡"。
 *    两条路的**口径定义相同**（都是 `todosOfProject` 里 `!done` 的条数），只是取数点不同。
 */
function projectSummary(pid) {
  const todos = todosOfProject(pid);
  let open = 0;
  todos.forEach(function (t) { if (!t.done) open += 1; });
  return {
    open: open,
    done: todos.length - open,
    mindmap: mindmapsOfProject(pid).length
  };
}

/** 待办排序（FR-3.7）：未完成优先 → 组内按紧急程度 → 创建时间倒序 */
const URGENCY_ORDER = { urgent: 0, mid: 1, low: 2, hold: 3 };
function sortTodos(list) {
  return list.slice().sort(function (a, b) {
    if (!!a.done !== !!b.done) return a.done ? 1 : -1;
    const ua = URGENCY_ORDER[a.urgency] === undefined ? 9 : URGENCY_ORDER[a.urgency];
    const ub = URGENCY_ORDER[b.urgency] === undefined ? 9 : URGENCY_ORDER[b.urgency];
    if (ub !== ua) return ua - ub;
    return tkey(b.createdAt).localeCompare(tkey(a.createdAt));
  });
}
/**
 * 待办列表抽屉排序（★ 44 轮）：**一条流水，按更新时间倒序**。
 * 与 `sortTodos`（FR-3.7 未完成优先 → 紧急度 → 创建时间）**并存**：
 *   · `sortTodos`          项目页里的待办清单，仍然分「该先做哪条」；
 *   · `sortTodosByUpdated` 待办列表抽屉，读作「最近动过什么」，完成态由卡片上的徽章标。
 * 两处口径不同是有意的 —— 抽屉里把已完成的沉底会让人找不到刚勾掉的那条。
 * ★★ 160 轮：`removeTodo` 会同时刷 `updatedAt` ⇒ 「已删除」那一档读它时
 *   实际就是**按删除时间倒序**（刚删的排最前 —— 用户找它多半就在那一下之后）。
 */
function sortTodosByUpdated(list) {
  return list.slice().sort(function (a, b) {
    return tkey(b.updatedAt).localeCompare(tkey(a.updatedAt));
  });
}
/* ★★ 160 轮：这两个"全量"出口**只给未删除的** —— 名字里的 all 是"全部项目"，
   不是"全部状态"。已删除的走 `deletedTodos()` / `visibleTodosByUpdated()` 的 deleted 档。 */
function allTodosSorted() { return sortTodos(aliveTodos()); }
function allTodosByUpdated() { return sortTodosByUpdated(aliveTodos()); }
/** 还欠着几条（概览 / 导航角标）—— ★★ 160 轮起同样不含已删除 */
function openTodoCount() {
  return state.todos.filter(function (t) { return !t.done && !isDeletedTodo(t); }).length;
}

/* ================= 待办列表筛选（★ 第四十七轮 · 筛选副弹窗）=================
 * 四个条件挂在 `ui.todoFilter`（与项目的 `ui.pFilter` 同一层、同构，见上面的 56 轮那一段），
 * 各自独立、可与列表实时联动：
 *   kw        关键词 —— 只在**待办正文**里找（大小写不敏感、忽略首尾空白）
 *   status    open(未完成) | done(已完成) | deleted(已删除)
 *   projectId '' = 全部，其余是项目 id
 *   range     all | w1(最近一周) | m1(最近一月) | m3(最近3个月)
 *
 * ★★ 160 轮 · **状态这一组改成三档、且默认落在「未完成」**（用户口径）：
 *   *「默认只显示"未完成"的待办卡片，筛选弹窗中待办状态为"未完成""已完成""已删除"三个状态，
 *     选中之后列表中显示对应状态的待办卡片」*。
 *   ⇒ 三档**互斥且完备**（每条待办恰好属于一档），所以原来的 `'all'`（全部）**没有了** ——
 *     留着它就会与"三档"打架：`all` 既不等于任何一档，也不是"第四档"。
 *   ⚠️ 与 `pFilter.status`（活跃 / 已归档 / 全部）**有意不同**：项目的"全部"是一个
 *     真实可表达的需求（活跃 ＋ 已归档），而待办这边"三档并起来"正是用户不想默认看到的东西。
 *   ⚠️ `'deleted'` 那一档**只能靠它到达** —— 它是「还原」的唯一入口（删完默认列表里就看不见了）。
 *
 * ⚠️ 时间档的基准是 **`baseToday()`**（★ 2026-10-22 起；改前写死 `TODAY`＝2026-09-21，
 *    真数据态下「最近一周」会从 09-14 起算、把一个月前的记录算进来 —— 审查 P2-02）。
 *    · 种子数据 ⇒ `TODAY`：整套演示时间都围着它排，改用 `Date.now()` 会让同一份种子
 *      几天后集体滑出「最近一周」之外，看起来像筛选坏了；
 *    · 真数据（`state.loaded`）⇒ **系统真实今天**（`baseToday()` 自己分流，见那边注释）。
 *    ⚠️ 待办与脑图两条筛选共用 `dayBack()` ⇒ 口径天然一致，别在任一处另算一遍。
 * ⚠️ 「最近一周」＝**含今天的 7 天内**（≥ 基准−6），一月/三月同理（29 / 89 天）：
 *    写 7 / 30 / 90 会让"最近一周"实际覆盖 8 天，边界那天怎么算说不清。
 */
const TODO_FILTER_DEF = { kw: '', status: 'open', projectId: '', range: 'all' };
const RANGE_DAYS = { w1: 6, m1: 29, m3: 89 };
/**
 * 状态三档（**唯一真源**）—— `drawers.js` 的选行与 `filterTodos` 的判定都读它，
 * 免得"界面上有这一档、过滤时却不认"这种两头对不上的老问题。
 *
 * ★ 形状与 `urgencyList()` / `projectNodes()` **同一族**（「有哪些档」只有一份，
 *   中文名跟着档走）。这样加/改一档只动这一处，副弹窗自动跟上。
 * ⚠️ **顺序就是界面顺序**：默认档（未完成）必须排最前 —— 与 `pjStatusRowsOf`
 *   「默认项排最前」是同一条原则（副弹窗一打开，被选中的那一项就该在第一眼的位置）。
 * ⚠️ **没有 `all`（全部）**：三档互斥且完备，见上面那段长注释。
 */
const TODO_STATUS_OPTIONS = [
  { key: 'open', label: '未完成' },
  { key: 'done', label: '已完成' },
  { key: 'deleted', label: '已删除' }
];
const TODO_STATUSES = TODO_STATUS_OPTIONS.map(function (o) { return o.key; });
function todoStatusOptions() { return TODO_STATUS_OPTIONS.slice(); }
/** 是不是三档里的合法值 —— 判据只认这三档，别处不许再手写一遍（`'all'` 一定要落在这之外） */
function isTodoStatus(s) { return TODO_STATUSES.indexOf(String(s || '')) >= 0; }

/**
 * ★★ 160 轮：**按状态取一档** —— 这条判定的**唯一实现**。
 *
 * 两个调用口共用它（口径不能有两份）：
 *   · `filterTodos()` —— 筛选副弹窗那三档（走 `ui.todoFilter.status`）；
 *   · `drawers.build('todo')` —— 项目页那两张带 scope 的"半列表"（走 `scope.status`）。
 *     ⚠️ 156 轮那里用的是 `{ done: true }` 布尔，本轮统一成同一套三档词
 *        （见 `drawers.js`）：同一件事留两套写法，迟早在某一处对不上。
 *
 * 语义：`open` / `done` 两档**都排除已删除**；`deleted` 档**只要已删除的**；
 * 给空串或未知值 ⇒ **不切**（原样返回）。
 * ⚠️ "未知值 ＝ 不切"与 `filterTodos` 的"未知值兜底成 `open`"**不同**，是有意的：
 *    · scope 那一侧，缺省本来就该是"这个项目的全部未删除待办"（156 轮的项目待办-N）；
 *    · 筛选那一侧，默认视图绝不能变成"什么都不筛"—— 那会把已删除的放回默认列表里。
 */
function pickTodosByStatus(list, status) {
  if (status !== 'open' && status !== 'done' && status !== 'deleted') return list;
  return list.filter(function (t) {
    const del = isDeletedTodo(t);
    if (status === 'deleted') return del;
    if (del) return false;
    return status === 'done' ? !!t.done : !t.done;
  });
}

/** 以「业务今天」为基准往回 n 天 → 'YYYY-MM-DD'（走本地日期构造，避开 'YYYY-MM-DD' 被当 UTC 解析）
 *
 * ★★ 2026-10-22 · **基准从常量 `TODAY` 改成 `baseToday()`**（审查 P2-02，只读测试已复现）。
 *
 * ── 改前是错的（而且是"看着像个合理值"的那类错）────────────────────────────
 *   `TODAY` 是**种子数据的基准日**（`'2026-09-21'`），而「最近一周 / 一月 / 三月」是拿它
 *   往回推的 ⇒ 真数据态下，2026-10-22 打开「最近一周」，窗口是
 *   `'2026-09-14'` 起 —— **把一个月前的记录也算进来了**（测试实测 from=2026-09-14，
 *   09-20 与 10-21 两条都通过）。
 *   ⚠️ 那个函数（`baseToday()`）早就存在、`agentCardViews()` / `resetInOf()` 都在用，
 *      唯独**筛选这条**漏了 ⇒ "同一个概念两个来源"的又一次原形。
 *
 * ── 现在的口径：与全工程其他"距今"计算**同一个基准** ──────────────────────
 *   · 真数据（`state.loaded`）⇒ **系统真实今天**；
 *   · 种子数据          ⇒ `TODAY`（演示数据的每条时间都围着它写，换真今天会把
 *                          走查过的演示形态整体推过阈值 —— 见 `baseToday()` 的长注释）。
 *   ⇒ mock 态逐字节不变（核验脚本的读数不受影响），真数据态才修掉那条偏移。
 *   ⚠️ 别在这里再引 `Date.now()`：业务时钟只有一个出入口（`baseToday()`）。
 */
function dayBack(n) {
  const p = baseToday().split('-');
  const d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  d.setDate(d.getDate() - n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

function todoFilter() { return state.ui.todoFilter; }

/** 改一个筛选条件（值与"全部"等价时存默认值，别让 '' 和 'all' 两套写法并存） */
function setTodoFilter(key, value) {
  state.ui.todoFilter[key] = value == null ? '' : value;
  return state.ui.todoFilter;
}

function resetTodoFilter() {
  state.ui.todoFilter = clone(TODO_FILTER_DEF);
  return state.ui.todoFilter;
}

/**
 * 已生效的筛选**条数**（默认值不计）—— 标题栏那颗「筛选」按钮靠它显示数字并转深色。
 * ★★ 160 轮：**默认值从 `all` 变成 `open`** ⇒ 判据也跟着从 `!== 'all'` 变成 `!== 'open'`。
 *   ⚠️ 这两处是**一对**：漏改的话，"什么都没筛"的列表会一直顶着「筛选 1」，
 *      用户会以为列表被人为裁过（而它其实只是默认视图）。
 */
function todoFilterCount() {
  const f = state.ui.todoFilter;
  let n = 0;
  if (String(f.kw || '').trim()) n += 1;
  if (f.status && f.status !== 'open') n += 1;
  if (f.projectId) n += 1;
  if (f.range && f.range !== 'all') n += 1;
  return n;
}

/** 按当前条件过一遍待办（**不改排序** —— 排什么序由调用方决定） */
function filterTodos(list) {
  const f = state.ui.todoFilter;
  const kw = String(f.kw || '').trim().toLowerCase();
  const days = RANGE_DAYS[f.range];
  const from = days === undefined ? '' : dayBack(days);
  /* ★★ 160 轮：状态那一刀转调 `pickTodosByStatus()`（**唯一实现**，与 scope 那条共用）。
     ⚠️ 兜底成默认档 `open`（而不是"不切"）：`status` 只可能是三档之一（`TODO_FILTER_DEF` 定的），
        真出现别的值也必须**把已删除的挡在外面** —— 「未知值 ＝ 什么都不筛」
        会把已删除的待办放回默认列表里，那正是本轮要消灭的东西。 */
  const body = pickTodosByStatus(list, isTodoStatus(f.status) ? f.status : 'open');
  return body.filter(function (t) {
    if (kw && String(t.text || '').toLowerCase().indexOf(kw) < 0) return false;
    if (f.projectId && t.projectId !== f.projectId) return false;
    /* 时间比到「日」为止：种子里带时分（2026-09-21 18:20），拿整串比会把当天的都排掉 */
    if (from && String(t.updatedAt || '').slice(0, 10) < from) return false;
    return true;
  });
}

/** 待办列表抽屉看到的流水 ＝ 筛选 → 按更新时间倒序（三档共用这一条出口） */
function visibleTodosByUpdated() { return sortTodosByUpdated(filterTodos(state.todos)); }

/* ========= 脑图列表筛选（★ 本轮 · 筛选副弹窗）=========
 * 与待办 / 项目两张列表**同一套机制**：条件挂在 `ui.mFilter`，副弹窗的数据驱动由
 * `utils/drawers.js` 给（`tf.groups[]`），组件只把 `{key, value}` 抛回来。
 *   kw        关键词 —— 只在**脑图名**里找
 *   projectId '' = 全部，其余是项目 id
 *   format    all ／ 六种格式 key（新增一种格式只要往 `fmts.list()` 加一行，这里自动跟上）
 *   range     all | w1 | m1 | m3 —— 比的是 `updatedAt`（"多久没动过"）
 *
 * ⚠️ 时间档基准同样是 `TODAY`（不是系统当天），与待办那条口径完全一致（原因见上）。
 */
const MINDMAP_FILTER_DEF = { kw: '', projectId: '', format: 'all', range: 'all' };

function mindmapFilter() { return state.ui.mFilter; }

function setMindmapFilter(key, value) {
  state.ui.mFilter[key] = value == null ? '' : value;
  return state.ui.mFilter;
}

function resetMindmapFilter() {
  state.ui.mFilter = clone(MINDMAP_FILTER_DEF);
  return state.ui.mFilter;
}

/** 已生效的筛选**条数**（默认值不计）—— 标题栏那颗「筛选」按钮靠它显示数字并转深色 */
function mindmapFilterCount() {
  const f = state.ui.mFilter;
  let n = 0;
  if (String(f.kw || '').trim()) n += 1;
  if (f.projectId) n += 1;
  if (f.format && f.format !== 'all') n += 1;
  if (f.range && f.range !== 'all') n += 1;
  return n;
}

/** 按当前条件过一遍脑图（**不改排序** —— 排什么序由调用方决定） */
function filterMindmaps(list) {
  const f = state.ui.mFilter;
  const kw = String(f.kw || '').trim().toLowerCase();
  const days = RANGE_DAYS[f.range];
  const from = days === undefined ? '' : dayBack(days);
  return list.filter(function (m) {
    if (kw && String(m.name || '').toLowerCase().indexOf(kw) < 0) return false;
    if (f.projectId && m.projectId !== f.projectId) return false;
    if (f.format && f.format !== 'all' && formatKeyOf(m) !== f.format) return false;
    if (from && String(m.updatedAt || '').slice(0, 10) < from) return false;
    return true;
  });
}

/* ================= 查询 · 脑图 ================= */

function rawMindmap(id) { return state.mindmaps.filter(function (m) { return m.id === id; })[0] || null; }
function mindmapById(id) { return rawMindmap(id); }
function mindmapsOfProject(pid) {
  return state.mindmaps.filter(function (m) { return m.projectId === pid; })
    .sort(function (a, b) { return tkey(b.updatedAt).localeCompare(tkey(a.updatedAt)); });
}
/** 跨项目列出全部脑图，按项目分组（FR-7.2：组间按该组最近编辑倒序）
 *  ⚠️ 本轮起**列表抽屉不再用它**（改成一条按更新时间倒序的平铺流水）——
 *     留着是给表单里「关联脑图」的三级选项表用（那一层要按项目分组 ＋ 显示项目名）。 */
function mindmapGroups() {
  const groups = [];
  activeProjects().concat(archivedProjects()).forEach(function (p) {
    const ms = mindmapsOfProject(p.id);
    if (!ms.length) return;
    groups.push({
      id: p.id, project: p, archived: isArchived(p),
      label: p.name + ' · ' + ms.length + ' 张',
      latest: ms[0].updatedAt,
      items: ms
    });
  });
  return groups.sort(function (a, b) { return tkey(b.latest).localeCompare(tkey(a.latest)); });
}

/* ================= 脑图格式（★ 本轮） =================
 * 一张脑图的排版格式存在 `mindmap.format`（六种 key，目录在 utils/formats.js）。
 * 下面这一组是**格式相关的唯一出口** —— 画布、列表卡、表单都从这里取，
 * 免得"格式名"在三个地方各写一份（本工程在"同一个东西两处各写一份"上踩过两次）。
 */

/** 取某张脑图的格式 key；老数据没这个字段 ⇒ 落到默认格式，不让画布空着 */
function formatKeyOf(m) { return (m && m.format) || fmts.defaultKey(); }
/** 格式目录里的那一条（key / label / desc / thumb） */
function formatOf(key) { return fmts.byKey(key); }
/** 六种格式（带缩略图）—— 「格式」主弹窗与表单里的格式字段共用这一份 */
function mindmapFormats() { return fmts.list(); }
/** 六种格式 + `selected` —— 表单的格式字段直接用（模板只做循环） */
function mindmapFormatOptions(sel) {
  /* ★★ 280 轮：`''`（未设置）是**一档真实状态**，不许兜成默认键。
     ⚠️ 只有"调用方没有当前值这个概念"（`undefined` / `null`，例如新建）才给默认。
        显式传空串时必须**一个都不勾** —— 否则「完善脑图信息」抽屉里会替用户勾上
        「思维导图」，他一路点保存，那个从没做过的选择就被写进了库（假话）。
     ⚠️ `formatKeyOf()` 的兜底**不动**：筛选副弹窗还要按它把老数据归到「思维导图」那一档。 */
  const cur = (sel === undefined || sel === null) ? fmts.defaultKey() : String(sel);
  return fmts.list().map(function (f) {
    return Object.assign({}, f, { selected: f.key === cur });
  });
}

/** 脑图列表抽屉排序（★ 本轮）：**一条流水，按更新时间倒序** ——
 *  与待办抽屉 44 轮那条口径同源（"最近动过什么"）。
 *  ⚠️ 原来这里是按项目分组（`mindmapGroups`）：组内有序、组间也有序，
 *     但**整条列表不是全局有序** —— 一眼扫下来读不出"我最近在写哪张"。
 *     本轮用户口径「列表显示上按照脑图的更新时间倒序排列」⇒ 拍平成一条流水，
 *     项目身份改由**卡片自己带**（色点 ＋ 项目名）。 */
function sortMindmapsByUpdated(list) {
  return list.slice().sort(function (a, b) {
    return tkey(b.updatedAt).localeCompare(tkey(a.updatedAt));
  });
}

/** 列表抽屉看到的流水 ＝ 筛选 → 按更新时间倒序 */
function visibleMindmaps() { return sortMindmapsByUpdated(filterMindmaps(state.mindmaps)); }

/**
 * ★★ 280 轮：**这张脑图现在能不能进画布**的唯一判据（卡面、闸门、三处入口共用一份）。
 *
 * 四档：
 *   · `missing`    —— id 对不上（数据刚被删 / 记忆失效）⇒ 不拦，交给既有的空态
 *   · `pending`    —— 后台还在生成。**连看都不许看**：`ensureTree()` 在本地的树缺失时会
 *                     造一棵"只有原点"的占位树，用户会看到一个写着「语义转脑中」的方块
 *                     并以为图就是这个样子（§7.3）
 *   · `failed`     —— 生成失败，同样不进（里面是空的）
 *   · `incomplete` —— 生成出来了，但项目 / 格式 / 归属 agent 缺一 ⇒ 先进「完善脑图信息」
 *   · `''`         —— 正常可进
 *
 * ⚠️⚠️ `incomplete` 这一档**必须挂 `aiState` 这个前提**，不能只看字段。原因：
 *    `Mindmap.agentId` 是本轮才有的列，**全部历史脑图都是 null** ——
 *    如果只判字段，199–279 攒下的每一张图都会当场变成"不能打开"，用户点自己的老图
 *    会被弹一个「完善脑图信息」，这是**全体回归**，不是新功能。
 *    `aiState` 恰好只有本轮的 AI 受理才会写（历史行恒为 null）⇒ 拿它当"这是新链路产物"的
 *    印记，老数据一格都不用回填，既有行为一个字不变。
 *    （同理，从「新建脑图」表单建出来的图 agentId 也可以为空 —— 它不该被拦。）
 */
/**
 * 项目绑定的 agent（没有绑定 ⇒ 空串）。
 *
 * ★★ 2026-10-27（用户口径）：**脑图的归属 agent 完全由项目决定** ——
 *    所以 `Mindmap.agentId` 不是"用户填的字段"，而是"项目那一格"的副本。
 *    前端所有需要这个值的地方（表单初值 / 换项目 / 提交）都走这一个函数，
 *    后端 `create` / `update` 那侧也按项目推导（同一条规则、两边各写一次源码，
 *    谁漏了都不会造出矛盾数据：以项目为唯一真源）。
 */
function projectAgentId(pid) {
  const p = pid ? rawProject(pid) : null;
  return (p && p.agentId) || '';
}

function mindmapGateOf(m) {
  if (!m) return 'missing';
  if (m.aiState === 'pending') return 'pending';
  if (m.aiState === 'failed') return 'failed';
  /* ★★ 2026-10-27：「未完善」＝ **项目 / 格式 缺一**。
     原来还有 `!m.agentId` —— 已撤：agent 由项目决定，用户无从选择，拿它当拦截条件等于
     要求用户去填一个界面上不存在的字段（永远填不上）。
     ★ `aiState` 这个前提仍必须留着：它是**新链路才写的印记**，历史脑图恒为 null。
       去掉它，199–279 的每一张图都会因为"没写过 aiState"之外的原因被读成"未完善"。 */
  if (m.aiState && (!m.projectId || !String(m.format || ''))) return 'incomplete';
  return '';
}

/**
 * ★★ 280 轮（用户 2026-10-27）· 「转脑图」那张选择列表里，这张卡**能不能被选中**。
 *
 * 判据与"能不能进画布"**同一份**（`mindmapGateOf`），不是另立一条：
 *   把胶囊挂进一张进不去的图，等于挂进用户**看不见**的地方 ——
 *   生成中的图回填时会整棵替换掉本地那一枝（刚挂进去的节点当场没了），
 *   未完善的图连打开都被闸门拦下（用户永远看不到自己刚挂上去的东西）。
 * ⇒ **能进画布 ⇔ 能当选中的靶子**。
 *
 * @returns {''|'pending'|'failed'|'incomplete'} '' ＝ 可选
 * ⚠️ `missing`（id 对不上）归 '' —— 那一档交给既有的"什么都没写"路径
 *    （选择列表里的卡天然都还在），别在这里多造一档。
 */
function mindmapPickLock(m) {
  const g = mindmapGateOf(m);
  return g === 'missing' ? '' : g;
}

/**
 * 脑图卡的装配 —— ★ 本轮起**唯一真源**（列表抽屉与项目页那张「项目脑图」共用）。
 *   · 本轮把**归属项目**融进卡片（平铺流水之后，卡上的项目名就是"它属于谁"的唯一线索）
 *   · 本轮新增**格式**（用户第 6 条：卡片里要能看到这是哪种排版的图）
 *   · 项目名不在这里截断 —— 卡片自己用 CSS 收口（这里截了，量宽度时反而算不准）
 */
function mindmapCardView(m) {
  const p = m.projectId ? rawProject(m.projectId) : null;
  const c = p && p.color ? colorOf(p.color) : null;
  /* ★★ 280 轮：`format` 可能是**空串**（＝语义转脑图的"未设置"态，是一档真实状态）。
     ⚠️ 绝不能沿用 `formatKeyOf(m)` —— 它对空串会兜底成默认键，卡上就会显示
        「思维导图」+ 缩略图，**那是一句假话**（用户从没选过格式）。
        所以格式这一支改成"有才给、没有就说未设置"，`formatKeyOf` 本身不动
        （筛选副弹窗还要按它归类，而"未设置"不该混进「思维导图」那一档）。 */
  const rawFmt = String(m.format || '');
  const f = rawFmt ? fmts.byKey(rawFmt) : null;
  return {
    id: m.id,
    name: m.name,
    projectName: p ? p.name : '未归属项目',
    projectColor: c ? c.main : noneColor(),
    projectArchived: isArchived(p),
    /* 三档：正常六档 / 未设置（''）/ 未归属项目（无 projectId）—— 后两档是"未完善"的构成 */
    hasFormat: !!f,
    format: f ? f.label : '未设置',
    formatKey: f ? f.key : '',
    formatThumb: f ? f.thumb : '',
    nodes: m.nodes || 0,
    depth: m.depth || 0,
    updated: m.updatedAt || '',
    /* ★★ 280 轮：语义转脑图的处理态。
       `''`（空串）＝ 普通脑图（所有历史行都是这一档，模板据此**一个字都不变**）。
       ⚠️ 只认这两个派生量，模板里不要再写 `it.aiState === 'pending'` ——
          `undefined === 'pending'` 为假看着没事，但 `aiState` 缺失时那三行会互相打架。 */
    aiState: m.aiState || '',
    aiPending: m.aiState === 'pending',
    aiFailed: m.aiState === 'failed',
    /* 刚转过来要亮一次底色（后端 `flashAt`；`adaptMindmap` 原样带过来，null 归一成空串）
       ★★★ 2026-10-27（用户口径）：「当脑图已经完善信息之后，就应该恢复成了普通脑图，
           就应该恢复原来的颜色」。
       ⇒ 那层紫只属于**"它刚生成好、用户还没接手"**这一段，不是一个永久的"这是 AI 生的"标记。
       判据不能只看 `flashAt` 在不在：它落在库里就一直在（历史上已经完善过的行也都还带着），
       所以必须叠一个"还没完善"的前提 —— `mindmapGateOf(m) === 'incomplete'`。
       「完善脑图信息」这动作做的正是把这一档从 `incomplete` 变成 `''` ⇒ 紫在那一下当场褪掉。
       ⚠️ 两个抽屉（脑图列表 / 选择脑图）与项目页那张卡**共用这一份装配** ⇒
          改这一行就是三处一起改对，不要到某个模板里再写第二套条件。
       ⚠️ 与 `markMindmapSeen()` 的分工：这里管**画出来的颜色**（历史数据也立刻正确），
          那边管**库里那一列**（别让服务端永远把它当"没看过"下发）。两件事，都要做。 */
    fresh: !!m.flashAt && mindmapGateOf(m) === 'incomplete',
    /* 「未完善」：项目 / 格式 缺一 ⇒ 点它只能进「完善脑图信息」。
       ★ 2026-10-27：原来这里还有"归属 agent"一项，已撤 —— agent 由项目决定，
         用户选不了就不该拿它拦人（明细见 `mindmapGateOf` 的注释）。
       ★★ 判据收在 `mindmapGateOf()` 里（与拦截闸门同一份）——
          这里只把它的结果翻成布尔，别在这写第二套条件。
       ⚠️ 它**不是**"缺字段"的同义词：历史脑图 agentId 恒为 null，
          若按字段判，全部老图都会被读成"未完善"。见那个函数的注释。 */
    incomplete: mindmapGateOf(m) === 'incomplete',
    /* ★ 本轮：是不是「当前正开在画布上的那张」——
       闪念胶囊「转到脑图」的选择列表要用它打一枚「当前」小标志（用户口径）。
       判据直接取脑图模块的记忆（FR-8.4），与"点导航会回到哪一张"完全同源，
       不为这件事另记一份状态（两个真源迟早对不上）。 */
    current: state.ui.mindmapId === m.id
  };
}

/* ================= 脑图节点（严格树） ================= */

function findNode(root, id, parent) {
  if (!root) return null;
  if (root.id === id) return { node: root, parent: parent };
  for (let i = 0; i < (root.children || []).length; i++) {
    const r = findNode(root.children[i], id, root);
    if (r) return r;
  }
  return null;
}
function countNodes(node) {
  return node ? 1 + (node.children || []).reduce(function (a, c) { return a + countNodes(c); }, 0) : 0;
}
function depthOf(node) {
  if (!node || !node.children || !node.children.length) return node ? 1 : 0;
  return 1 + Math.max.apply(null, node.children.map(depthOf));
}
/**
 * 取一棵树；没有就按脑图名补一个「只有根节点」的空树。
 * 页面的自动排版能处理空树与任意拓扑，所以这里不做结构假设。
 */
function ensureTree(mid) {
  if (!mid) return null;
  if (!state.tree[mid]) {
    const m = rawMindmap(mid);
    state.tree[mid] = {
      id: 'n0', text: m ? m.name : '未命名脑图', remark: '', level: 0, kind: 'root', children: []
    };
  }
  return state.tree[mid];
}

/* ---------- 「这棵树的子节点到底在不在本地」 ----------
 *
 * ★★ 2026-09-30 修（用户报「加了三层节点，重新打开只剩一个根」）。
 *
 * 为什么必须有这个标记：树有**两个**来源，而它们长得一模一样 ——
 *   · `ensureTree()`：**同步兜底**，只为"渲染拿得到的树、不白屏"。没有就现造一棵
 *     **只有根节点**的占位树，它不是数据。
 *   · `loadTree()`：**真数据来源**，从 `GET /mindmaps/:id/tree` 拉。
 * `GET /sync` 不给 `treeJson`（§6.2 红框）⇒ `hydrate()` 会清空 `state.tree`，
 * 画布渲染时必然先走 `ensureTree()` ⇒ `state.tree[mid]` **又有值了**。
 * 于是原来的短路条件 `if (state.tree[mid]) return` 被这棵占位树满足，
 * **`loadTree()` 一次请求都不发** —— 占位树把真数据来源挡在门外。
 * 症状就是"加完节点（同一次会话里 `state.tree` 是内存里那棵完整的，所以看着正常）
 * → **重开小程序**只剩根节点"。
 *
 * ⇒ 铁律：**判断"要不要拉树"只能看 `_treeReady`，不许再看 `state.tree[mid]` 在不在。**
 */
const _treeReady = {};

/**
 * `mid` 这棵树的**子节点已经和服务端对齐过**了吗。
 * ⚠️ mock 下恒为 true：本地种子就是权威，不存在"对齐"这回事（也让核验脚本零变化）。
 */
function treeReady(mid) {
  if (!mid) return true;
  if (api.useMock()) return true;
  return !!_treeReady[mid];
}

/** 标为"已对齐" —— 本地树即权威的场合用（新建脑图 / promote 拿回服务端的树 / mock） */
function markTreeReady(mid) {
  if (mid) _treeReady[mid] = true;
}

/**
 * 树写操作的前置闸门。
 *
 * ★ 为什么：整棵树的写入口只有一个 `PUT /mindmaps/:id/tree`，**推的是本地整棵树**。
 *   如果本地还停在 `ensureTree()` 那棵**占位树**（只有根），这一推就会把服务端
 *   原本完整的树**整个覆盖成"只有根 ＋ 刚改的这一笔"** —— 那是**真丢数据**，
 *   不是显示问题，而且用户看到的是"我加的东西没了"，极难往"前端推了棵空树"上想。
 *   ⇒ 没对齐过就**拒绝这次写**并说一句。窗口只有一次 `GET /tree` 的往返（本机毫秒级），
 *   正常手速碰不到；万一碰到了，拒绝也远比静默覆盖强。
 */
function guardTree(mid) {
  if (treeReady(mid)) return true;
  try { wx.showToast({ title: '脑图还在加载，稍等一下再改', icon: 'none' }); } catch (e) { /* 提示失败不该影响判断 */ }
  return false;
}

function syncMindmapMeta(mid) {
  const root = state.tree[mid];
  if (!root) return;
  state.mindmaps = state.mindmaps.map(function (m) {
    return m.id === mid
      ? Object.assign({}, m, { nodes: countNodes(root), depth: depthOf(root), updatedAt: stamp() })
      : m;
  });
}

/* ================= 查询 · Agent ================= */

function agentById(id) { return state.agents.filter(function (a) { return a.id === id; })[0] || null; }
/**
 * 列表里的第一个 agent。
 * ★ 09-22 第四十二轮：「当前 agent」概念整体取消（卡片与表单都不再有它），`D-7` 由此落地
 *   —— 当时是"概览额度卡固定取第一个"。★ 第 59 轮「Agent 概况」改成**列出全部 agent**，
 *   于是这条查询当前**没有调用点**；留着是因为「默认 agent」这类判断（新建项目时预选关联）
 *   迟早还要用它，而且它是"列表顺序即优先级"这条口径的唯一落点。
 */
function primaryAgent() { return state.agents[0] || null; }

/**
 * 手填数值 → 数字：`'¥ 128.40'` / `'1,240'` / `'1240 积分'` 都读得出来；取不到给 null。
 * ★ 第五十五轮：从 `mod-mine` 提到这里 —— 「我的」页 agent 卡与「项目」页基础卡
 *   都要判「额度偏低」，两处各写一份迟早会漂（额度是按积分手填的字符串，不是数）。
 */
function amountOf(s) {
  const m = /-?\d+(?:\.\d+)?/.exec(String(s == null ? '' : s).replace(/,/g, ''));
  return m ? Number(m[0]) : null;
}

/**
 * 「额度偏低」＝ 当前剩余 ÷ 每月套餐 < 20%（★ 42 轮·补二 口径）。
 * 单看「当前剩余 1240」没有意义（是高是低取决于套餐是 2000 还是 5000），必须两个数配起来读；
 * 缺一个、或套餐 ≤ 0 ⇒ false —— 宁可不说，也不误标。
 */
function quotaLowOf(a) {
  if (!a) return false;
  const left = amountOf(a.quotaLeft);
  const total = amountOf(a.monthlyQuota);
  if (left === null || total === null || total <= 0) return false;
  return left / total < 0.2;
}

/**
 * 「距离重置」的**文字**展示值（项目详情页基础信息卡的灰块四格走它）：
 *   quotaResetAt 只记「每月几号」（★ 133 轮）⇒ 换算成天数更好读：未填 → `'未填'`；0 → `'今天'`；n → `'n 天'`。
 * ⚠️ agent 卡（「我的」/ 概览）自 ★ 157 轮起改用 `ringOf()` 的**图形版**（圆环 ＋ 圆心大字）；
 *    本函数仍是「同一口径的文字出口」，`mod-project` 仍在用，别跟着一起删。
 */
function resetInOf(a) {
  if (!a) return '';
  const d = daysUntilReset(a.quotaResetAt);
  if (d === null) return '未填';
  return d <= 0 ? '今天' : d + ' 天';
}

/**
 * 「距离重置」的**圆环三件套**（★ 157 轮）—— agent 卡把"还剩几天重置"从一行小字
 * 升成卡面上的主视觉（圆环进度 ＋ 圆心大字）。
 *
 * ★ 圆环画的是**本周期已过多少**，不是"额度已用多少"：
 *   调研确认 WorkBuddy / Trae **都没有取余额的 API**（用户 157 轮口径）⇒ 额度剩余本文就不显示；
 *   圆环要画就**只能**画周期 —— 从上一个重置日走到下一个重置日，走到头就重置。
 *   ⚠️ 千万别把它读成/写成"已用额度"：那是另一个数，而且拿不到。
 *
 * 周期按**自然月**取（`quotaResetAt` 只记「日」，见 133 轮）：
 *   · 上一界 `prev`：本月那一日；若它已过今天就取**上个月**的同一天。
 *   · 下一界 `next`：本月那一日；若它 ≤ 今天就取**下个月**的同一天。
 *   ⚠️ 两边刻意**不对称**（`prev > base` 取严格大于、`next <= base` 含等号）——
 *      好让"今天正好是重置日"落到 **prev ＝ today**：进度 0、圆心「今天」，
 *      读作"今天刚重置、圆环刚归零"。改成对称就变成"周期刚走完"（进度满），那正好是反的。
 *   · `resetAt()` 自带月末夹紧（2 月没有 31 号 ⇒ 退到 28），所以 span 恒 > 0。
 *
 * 返回 `{ deg, num, unit, muted }`：
 *   · `deg`   进度角 0–360 —— 模板直接喂给 `.ag-ring` 的 `--ring-deg`（conic-gradient）
 *   · `num`   圆心大字：`'20'` ／ `'今天'` ／ `'未填'`
 *   · `unit`  单位小字：`'天'` ／ `''` ／ `''`
 *   · `muted` 「未填」时 true ⇒ 圆心改用 13px 灰字（`未填` 两个字按 23px 撑不进 60 的圆心）
 */
function ringOf(a) {
  const day = resetDayOf(a && a.quotaResetAt);
  if (day === null) return { deg: 0, num: '未填', unit: '', muted: true };
  const base = new Date(baseToday() + 'T00:00:00');
  let prev = resetAt(base.getFullYear(), base.getMonth(), day);
  if (prev > base.getTime()) prev = resetAt(base.getFullYear(), base.getMonth() - 1, day);
  let next = resetAt(base.getFullYear(), base.getMonth(), day);
  if (next <= base.getTime()) next = resetAt(base.getFullYear(), base.getMonth() + 1, day);
  const span = next - prev;
  const deg = span > 0 ? Math.max(0, Math.min(360, Math.round(((base.getTime() - prev) / span) * 360))) : 0;
  const d = daysUntilReset(a.quotaResetAt);
  if (d === null) return { deg: deg, num: '未填', unit: '', muted: true };
  if (d <= 0) return { deg: deg, num: '今天', unit: '', muted: false };
  return { deg: deg, num: String(d), unit: '天', muted: false };
}

/**
 * agent 卡的装配 —— **「我的」页 agent 区 与 概览「Agent 概况」共用这一份**（★ 第 59 轮）。
 * 四个手填字段（`FR-6.1`）＋ 派生出来的「距离重置圆环」「承担项目」。
 *
 * ★★ 157 轮（用户口径）：卡面**删掉「当前剩余」与「更新于 X」** ——
 *   WorkBuddy / Trae 都没有取余额的 API，那个手填的余额数只会过期误导；
 *   「更新于」本来就是给那颗数做保质期标注的，数没了它也没意义。
 *   ⇒ 本条装配里 `quotaLeft` / `quotaLow` / `resetIn` 三个字段**一并撤掉**
 *     （两个卡面都不再引用它们；项目页基础卡走的是自己那份装配，不受影响）。
 *   ✅ 「每月套餐」是**档位**（静态、不会过期）⇒ 留下，与「承担项目」一起排在圆环右侧。
 *
 * ⚠️ 留在数据层的三个字段（`updatedAt` / `daysAgo` / `stale`）：157 轮只是**撤下展示**，
 *    口径本身没变 —— 卡面上已经没有"会过期的手填值"，所以 FR-5.3 的「过期弱化」失去了落点
 *    （见 `待拍板与遗留.md`）。先留着，换个落点随时能用；`updatedAt` 仍必须是 `atMin()` 过的
 *    分钟精度（`check_source_guard.py` 的 G11d 钉着这一条）。
 */
function agentCardViews() {
  return state.agents.map(function (a) {
    const ps = state.projects.filter(function (p) { return p.agentId === a.id; });
    const days = daysSince(dateOf(a.updatedAt));
    /* ★ 157 轮：圆环三件套（deg / num / unit / muted）—— 见 ringOf() */
    const ring = ringOf(a);
    return {
      id: a.id,
      name: a.name,
      monthlyQuota: a.monthlyQuota || '未填',
      projectCount: ps.length,
      projects: ps.map(function (p) {
        const c = p.color ? colorOf(p.color) : null;
        return { id: p.id, name: p.name, color: c ? c.main : noneColor(), archived: isArchived(p) };
      }),
      /* 「距离重置」＝ 本卡的主视觉：圆心大字 ＋ 圆环进度角 */
      resetNum: ring.num,
      resetUnit: ring.unit,
      resetMuted: ring.muted,
      ringDeg: ring.deg,
      /* ⚠️ 这一份是**给视图的**（概览 / 我的两张 Agent 卡都直接绑它）
         ⇒ 时间必须先 `atMin()` 截到分钟：存储是秒精度，不截会露出 ':23'。
         ★ 157 轮起卡面不再渲染它（见上），字段保留。 */
      updatedAt: atMin(a.updatedAt),
      daysAgo: days,
      stale: days >= STALE_DAYS
    };
  });
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const a = new Date(dateStr + 'T00:00:00').getTime();
  const b = new Date(baseToday() + 'T00:00:00').getTime();   // ★ 真数据 ⇒ 真实今天（见 baseToday()）
  return Math.max(0, Math.round((b - a) / 86400000));
}

/* ================= 查询 · 热力图（FR-5.1） ================= */

/**
 * 30 周热力图数据 —— **查询时现算**（★ 第 97 轮落地 `D-6` 的"当日值现算、不落库"）。
 *
 * 组成 ＝ **基线**（`mock.HEATMAP`：纯造出来的"日常活跃度"；真接口下是零基线）
 *        ＋ **活跃度台账**（`state.activity`：待办创建 / 待办完成 / 胶囊创建的**动作计数**）。
 *
 * ★★ 2026-10-09 的关键改动：**输入从「实体数组」换成了「台账」**。
 *   改前这里是 `state.todos.forEach(...)` ＋ `state.capsules.forEach(...)` ——
 *   拿"现在还活着的记录的 `createdAt` / `completedAt`"反推每天几次。那统计的是
 *   「**现在还剩下什么**」，于是任何"消失"都会把历史一起带走：
 *     · 删掉一个待办      ⇒ 那天的「创建」少 1
 *     · 完成 → 取消完成    ⇒ 那天的「完成」少 1（`completedAt` 被置空，§8.1 硬要求）
 *     · 胶囊转待办后被消费 ⇒ 那天的「胶囊」少 1
 *   而热力图问的是「**那天发生过多少事**」（活跃度）。用户 2026-10-09 实测报出后，
 *   改成读台账 —— 台账**只加不减**，动作留下的痕迹不会被后来的删除抹掉。
 *
 * ★ 为什么还是"现算"而不是开机算一次：用户**刚记下的东西要立刻出现在图上**。
 *   台账在本地也是**乐观 +1** 的（`ledgerBump()`，见各写函数）⇒ 勾完一条待办、
 *   说完一段口播，下一次读这里就是 +1 后的结果，不必等一次 `GET /sync` 往返。
 *   启动时算一次的那份（`state.heat`）只是**基线**，它不含台账、也没有 `sum` / `level`。
 *
 * 缓存：键由 `heatKey()` 给 —— 它现在**只看台账**（原来是"待办数 / 已完成数 / 胶囊数"，
 *   那个口径已随本次改动作废，理由见 `heatKey()`）。
 *
 * ⚠️ 返回的是**缓存对象本身**（不克隆）：调用方只读。页面那边 `buildWeeks()` 会再 map 一层
 *   （因为它要往每格挂 `sel` 标记），不存在被改到的风险。
 * ⚠️ `_heatCache` / `_heatKey` 声明在**文件顶部**（`state` 之前）—— 别挪回来，会撞 TDZ。
 * ⚠️⚠️ **别再让这里读 `state.todos` / `state.capsules`** —— 那正是本轮修掉的缺陷形态。
 */
function heatWeeks() {
  const key = heatKey();
  if (_heatCache && _heatKey === key) return _heatCache;

  const led = state.activity || {};

  _heatCache = state.heat.weeks.map(function (w) {
    return {
      weekNo: w.weekNo,
      key: w.key,
      days: w.days.map(function (d) {
        /* 三个来源各取各的桶（D-6：分开计数，绝不打成一个总数） */
        const a = led[d.date] || {};
        const created = d.created + (a.created || 0);
        const completed = d.completed + (a.completed || 0);
        const capsule = d.capsule + (a.capsule || 0);
        const sum = created + completed + capsule;
        return {
          weekNo: d.weekNo, dayIndex: d.dayIndex, date: d.date,
          created: created, completed: completed, capsule: capsule,
          sum: sum, level: mock.levelOf(sum),
          mmdd: d.mmdd, label: d.label
        };
      })
    };
  });
  _heatKey = key;
  return _heatCache;
}

/**
 * 热力图缓存键 —— ★★ 2026-10-09 换了口径：**只看活跃度台账**。
 *
 * 原来数的是「待办数 / 已完成数 / 胶囊数」—— 那三个数现在与热力图**已经没有关系**
 * （图不再读实体数组了，见 `heatWeeks()`）。若还按旧口径做键，会出两种都很难查的错：
 *   · **该变的没变**：删掉一条待办、又新记一条 ⇒ 数量三元组碰巧不变 ⇒ 键命中 ⇒
 *     图上还是旧的那份（"我明明删了 / 加了，颜色没动"）；
 *   · **白算**：彻底无关的改动（改个文本）也让 210 格重算一遍。
 * 台账才是热力图的唯一输入，所以键直接由它算。
 *
 * ⚠️ 键里**必须带天数**（`Object.keys(led).length`）：不然"某天从无到有"这一类变化
 *    （三个计数合计恰好为 0 的边界）会漏判。台账只加不减 ⇒ 天数只增不减，带上它零成本。
 */
function heatKey() {
  const led = state.activity || {};
  const days = Object.keys(led);
  let created = 0, completed = 0, capsule = 0;
  for (let i = 0; i < days.length; i++) {
    const a = led[days[i]] || {};
    created += a.created || 0;
    completed += a.completed || 0;
    capsule += a.capsule || 0;
  }
  return days.length + '/' + created + '/' + completed + '/' + capsule;
}

/**
 * 某日明细：各来源的数分开给（D-6：图上只显示合值，明细里各数分开）。
 * ★ 第 97 轮起是**三个数** —— 待办创建（`created`）／ 待办完成（`completed`）／
 *   闪念胶囊创建（`capsule`）；`sum` ＝ 三者之和，`level` 由 `sum` 分档。
 * ⚠️ 页面上每次读都要走 `heatWeeks()`（现算），**不要**再直接读 `state.heat.weeks` ——
 *   那份是基线，里面没有真实计数，也没有 `sum` / `level`。
 */
function heatDay(weekNo, dayIndex) {
  const w = heatWeeks().filter(function (x) { return x.weekNo === weekNo; })[0];
  return w ? (w.days[dayIndex] || null) : null;
}

/**
 * 「今天」那一格的坐标 `{ week, day }` —— 概览的默认选中格（★ 第 59 轮）。
 * 按日期反查而不是写死 `{week:39, day:0}`：日期一改（甚至跨周）这里自动跟着走，
 * 页面不会出现"默认选中的那一格其实是上周"这种看不出错在哪的问题。
 *
 * ★★ 2026-09-30 修：内层比对的值由 `TODAY` 换成**系统真实今天**（`dateOf(stamp())`）。
 *    原来的写法有两处不同源，现场症状正是「日历默认没选中今天」：
 *      · `TODAY` ＝ `'2026-09-21'`，是**种子数据的基准**（演示待办 / 脑图的时间都围着它写），
 *        身份是"假今天"；
 *      · 而热力图窗口的右端跟着**真实日期**走（见 `mock.js` 的 `LAST_MONDAY`）。
 *    两者一错位，默认选中格就永远停在 09-21 —— 图上有 09-21 的格子，所以**不报错、
 *    只是安静地选错**（比"选不中"更难发现）。
 *    ⚠️ 别顺手把全局的 `TODAY` 改掉：它还要给种子数据算 `daysUntilReset` / `nextResetDay`，
 *       改了会把演示数据的语义一起挪走。这里只在**求坐标**这一处换成真今天。
 * 30 周窗里找不到它（约 30 周后窗口都不含它）⇒ null，明细条自然不渲染。
 */
function todayCell() {
  const real = dateOf(stamp());                 // 系统真实今天（本地时区，'YYYY-MM-DD'）
  const weeks = heatWeeks();
  for (let i = 0; i < weeks.length; i++) {
    const days = weeks[i].days;
    for (let j = 0; j < days.length; j++) {
      if (days[j].date === real) return { week: days[j].weekNo, day: days[j].dayIndex };
    }
  }
  return null;
}

/* ================= 变更 · 项目 ================= */

function addProject(p) {
  mark();
  const id = uid('p');
  const t = stamp();
  state.projects = state.projects.concat([{
    id: id,
    name: p.name || ('未命名项目 ' + (state.projects.length + 1)),
    color: p.color || null,
    node: p.node || mock.PROJECT_NODES[0],
    agentId: p.agentId || null,
    remark: p.remark || '',
    archivedAt: null,
    createdAt: t,
    updatedAt: t
  }]);
  queue(function () { return pushCreate('project', id); });
  return id;
}
function updateProject(id, patch) {
  mark();
  state.projects = state.projects.map(function (p) {
    return p.id === id ? Object.assign({}, p, patch, { updatedAt: stamp() }) : p;
  });
  /* ★★ 2026-10-27：项目改绑 agent ⇒ **本地这些脑图也跟着换**。
     这是后端 `projects.update` 那条级联的本地镜像（同一条规则、同一时刻生效）。
     不跟的话：界面上是"项目 A ↔ agent 新"，可本地 `m.agentId` 还是旧的，
     下一次保存某张脑图就把旧值当补丁推回服务器 —— 级联白做了。
     ⚠️ 只改 `projectId === id` 的（占位卡 projectId 为 null，本来就没有 agent，不动）。 */
  if (patch && patch.agentId !== undefined) {
    const nextAgent = patch.agentId || '';
    state.mindmaps = state.mindmaps.map(function (m) {
      return m.projectId === id ? Object.assign({}, m, { agentId: nextAgent }) : m;
    });
  }
  queue(function () { return pushUpdate('project', id); });
}
/** 归档（FR-2.9）：只标记归档时间，内容一条不动、归属关系一个不改 */
function archiveProject(id) {
  mark();
  /* ⚠️ **不要**改成调 `updateProject` —— 那会补发一次 `PATCH /projects/:id`
     （而 `archivedAt` 不在 UpdateProjectDto 里，白跑一趟），
     且两个 `queue()` 会互相抢快照（先跑的那个把 `_pre` 消费掉，后者就失去了回滚依据）。 */
  state.projects = state.projects.map(function (p) {
    return p.id === id ? Object.assign({}, p, { archivedAt: stamp(), updatedAt: stamp() }) : p;
  });
  queue(function () { return api.archiveProject(id); });
}
function unarchiveProject(id) {
  mark();
  state.projects = state.projects.map(function (p) {
    return p.id === id ? Object.assign({}, p, { archivedAt: null, updatedAt: stamp() }) : p;
  });
  queue(function () { return api.unarchiveProject(id); });
}

/* ================= 变更 · 待办 ================= */

function addTodo(t) {
  mark();
  const id = uid('d');
  const now = stamp();
  state.todos = [{
    id: id,
    projectId: t.projectId,
    mindmapId: t.mindmapId || null,
    text: t.text,
    urgency: t.urgency,
    done: false,
    createdAt: now,
    completedAt: null,
    /* ★ 44 轮：updatedAt ＝ 最后被动过的时刻（列表抽屉按它倒序、卡上显示它） */
    updatedAt: now,
    images: t.images || []
  }].concat(state.todos);
  /* ★ 2026-10-09：记下一件事 ⇒ 那天的活跃度「创建」+1（本地乐观，见 `ledgerBump()`）。
     传 `now` 与上面 `createdAt` **同一个值**，保证台账那天与这条待办那天是同一格。 */
  ledgerBump('created', now);
  queue(function () { return pushCreate('todo', id); });
  return id;
}
/** 编辑（FR-3.9）—— updatedAt 必须跟着走，否则列表按更新时间排就"看不见这次编辑" */
function updateTodo(id, patch) {
  mark();
  state.todos = state.todos.map(function (d) {
    return d.id === id ? Object.assign({}, d, patch, { updatedAt: stamp() }) : d;
  });
  /* ⚠️ 换项目时后端会**自动置空 `mindmapId`**（脑图候选范围只列归属项目下的脑图），
     本地必须跟着清 —— 否则会出现"本地还挂着 A 项目的脑图、服务端已经置空"这种
     下次启动才被发现的不一致。判断放循环外面做一次就够。 */
  if (patch && patch.projectId !== undefined) {
    const d = rawTodo(id);
    if (d && d.mindmapId) {
      const mm = rawMindmap(d.mindmapId);
      if (mm && mm.projectId !== d.projectId) {
        state.todos = state.todos.map(function (x) {
          return x.id === id ? Object.assign({}, x, { mindmapId: null }) : x;
        });
      }
    }
  }
  queue(function () { return pushUpdate('todo', id); });
}
/**
 * 删除 —— ★★ 160 轮起是**逻辑删除（软删）**，本地不再把它从数组里摘掉。
 *
 * 改前（物理删除）与改后（软删）的差别，在**本地这一侧**只有两件事：
 *   ① 那条仍然留在 `state.todos` 里，只是多了 `deletedAt`（＋ `deleted` 读法）
 *      ⇒ 它从"未完成 / 已完成"两档里消失（`filterTodos` 干这件事），
 *        但**能被「已删除」那一档列出来** —— 那是「还原」的唯一入口；
 *   ② `updatedAt` 一起刷 ⇒ 在「已删除」列表里按**删除时间**倒序，刚删的排最前。
 *
 * ⚠️ **这里本来要做的那三件事全撤了**：不再 `filter` 掉、不再由它顺手删磁盘图片
 *    （图片的后端删除本来也不在前端）、也**不再清 `ui.todoId` 记忆以外的任何东西** ——
 *    记忆仍按老口径清掉（FR-8.4：删掉当前详情就回空态 + 弹列表），
 *    用户要找回它就走「筛选 → 已删除」。
 * ★ 台账**不动**（只加不减，见 `ledgerBump` 与后端 `bumpActivity` 的黑名单）。
 */
function removeTodo(id) {
  mark();
  const now = stamp();
  state.todos = state.todos.map(function (d) {
    return d.id === id ? Object.assign({}, d, { deletedAt: now, deleted: true, updatedAt: now }) : d;
  });
  if (state.ui.todoId === id) state.ui.todoId = '';     // 记忆失效 → 走空态（FR-8.4）
  queue(function () { return pushRemove('todo', id); });
}

/**
 * ★★ 160 轮新增：**还原**一条已删除的待办（逻辑删除的对侧动作）。
 *
 * ★ 状态口径（用户 2026-10-12 拍板）：**一律回到「未完成」** —— 所以本地同时把
 *   `done` 与 `completedAt` 清掉。⚠️ 这与后端 `TodosService.restore()` 是**同一句话**，
 *   本地不照做的话会先画出「已完成」一帧，等 `queue()` 的回执回来才变回未完成（闪一下）。
 * ★ `updatedAt` 也刷：它回到"刚动过"，于是立刻出现在「未完成」列表最上面 ——
 *   用户的下一步动作就是处理它。
 * ⚠️ 走 `api.restoreTodo` 而不是「把 `deletedAt` 塞进 `updateTodo` 的 patch」：
 *   后端 `UpdateTodoDto` 是白名单，`deletedAt` 会被剥掉（静默无效）；
 *   而且"还原"是一条独立口径（顺手回未完成），不该藏在通用编辑里。
 */
function restoreTodo(id) {
  mark();
  const now = stamp();
  state.todos = state.todos.map(function (d) {
    return d.id === id
      ? Object.assign({}, d, { deletedAt: '', deleted: false, done: false, completedAt: null, updatedAt: now })
      : d;
  });
  queue(function () { return api.restoreTodo(id); });
}

/**
 * 完成 / 取消完成：取消时 completedAt 必须置空，否则热力图会多出一条假的完成记录（§7.2）。
 * ★ 44 轮：同时刷新 updatedAt —— 勾完成也是一次"动过"，列表抽屉按更新时间排，
 *  勾完那条应该跳回列表最上面（而不是沉底）。
 * ★★ 160 轮：**已删除的待办不许勾** —— 界面上它只有「还原」，这里再挡一道，
 *   免得"从别处调进来"把一条已删除的待办勾成已完成（那会与"还原后一律未完成"打架）。
 */
function toggleTodo(id) {
  const before = rawTodo(id);
  if (!before || isDeletedTodo(before)) return;
  mark();
  const done = !before.done;
  const now = stamp();
  state.todos = state.todos.map(function (d) {
    if (d.id !== id) return d;
    return Object.assign({}, d, {
      done: done,
      completedAt: done ? now : null,
      updatedAt: now
    });
  });
  /* ★★ 2026-10-09：**只有勾上**才记一次「完成」动作。
     ⚠️ 反过来（取消完成）**不减** —— 台账只加不减，"当时确实完成过一次"是历史事实。
        这也意味着：勾完成 → 取消 → 再勾 ⇒ 图上那天 **+2**（用户 2026-10-09 拍板：
        记动作次数，不去重）。别"顺手对称"地在这里补一个减号。 */
  if (done) ledgerBump('completed', now);
  /* ★ 后端把"完成 / 取消完成"拆成**两个**接口（不是 PATCH 一个 status 字段）——
     因为「取消完成必须把 completedAt 置空」是一条独立口径，混在通用 PATCH 里
     迟早有人只改 status 忘清 completedAt，于是待办挂着一个并不成立的完成时刻
     （详情页 / 列表都读它；热力图自 2026-10-09 起改读台账，不再依赖这个字段）。 */
  queue(function () { return done ? api.completeTodo(id) : api.reopenTodo(id); });
}

/* ================= 变更 · 脑图 ================= */

/** 新建脑图 —— ★ 本轮补第三参 `format`（六种格式 key；不传落到默认格式「思维导图」） */
function addMindmap(pid, name, format, agentId) {
  mark();
  const id = uid('m');
  state.mindmaps = state.mindmaps.concat([{
    id: id, projectId: pid, name: name, nodes: 1, depth: 1,
    format: format || fmts.defaultKey(),
    /* ★★ 280 轮：新建脑图也带得上归属 agent（表单里那一行是可空的）。
       不传 ⇒ 空串，与历史行同形；别在这里替用户挑一个。 */
    agentId: agentId || '',
    updatedAt: stamp()
  }]);
  /* 新建时就把根节点树备好（`addMindmap` 的调用方紧接着会打开画布，不能等一次网络往返） */
  state.tree[id] = { id: 'n0', text: name, remark: '', level: 0, kind: 'root', children: [] };
  /* ★ 标"已对齐"：服务端建完会落一棵**同形的空树**（`emptyTree()`）⇒ 本地这棵就是权威。
     不标的话画布会去 `GET /tree`，而那次请求可能跑在 `POST /mindmaps` 前面（404 ⇒ 占位树），
     更糟的是：**用户抢先加的节点会被随后拉回来的空树覆盖**。 */
  markTreeReady(id);
  queue(function () { return pushCreate('mindmap', id); }, function () {
    /* ★ 服务端建完会顺手落一棵**同形的空树**（`emptyTree()`），不需要再补一次 `PUT /tree` */
  });
  return id;
}
function renameMindmap(id, name) {
  mark();
  state.mindmaps = state.mindmaps.map(function (m) {
    return m.id === id ? Object.assign({}, m, { name: name, updatedAt: stamp() }) : m;
  });
  const t = state.tree[id];
  if (t) t.text = name;
  /* 改名会同步根节点 text（后端也这么做），所以除了元信息还要把树推上去。
     ⚠️ 但**树没对齐时不推树** —— 手上那棵是 `ensureTree()` 的占位树，
        推上去会把服务端完整的树覆盖成"只有根"。
        改名本身照常生效（它走的是 `PATCH /mindmaps/:id`，与树无关）。 */
  queue(function () { return pushUpdate('mindmap', id); }, function () {
    if (treeReady(id)) syncTreeToServer(id);
  });
}

/**
 * 编辑脑图信息 —— ★ 本轮新增：脑图表单从"只能改名"扩成"改信息"（名称 / 所属项目 / 格式）。
 * 三个字段都是**可选补丁**（`undefined` ＝ 不动它），所以「只换格式」那条路径
 * （画布顶部工具栏 → 格式主弹窗）不必先把名称和项目捞一遍再传进来。
 * 改完刷 `updatedAt` —— 改信息也是一次"动过"，列表按更新时间倒序，它该往上跳。
 */
function updateMindmap(id, patch) {
  mark();
  const p = patch || {};
  state.mindmaps = state.mindmaps.map(function (m) {
    if (m.id !== id) return m;
    const next = Object.assign({}, m, { updatedAt: stamp() });
    if (p.name !== undefined) next.name = p.name;
    if (p.projectId !== undefined) next.projectId = p.projectId;
    /* ⚠️ 格式允许被写成**空串**（＝未设置）。别顺手 `|| defaultKey` —— 那会把
       "用户还没选"这件事当场抹掉，而"未完善"正是靠它判的。 */
    if (p.format !== undefined) next.format = (p.format === null || p.format === undefined) ? '' : String(p.format);
    /* ★★ 2026-10-27：agent **不独立写** —— 它由项目派生，与后端 `mindmaps.update` 完全同口径：
         · 这一行有项目（本次给的，或原来就有的）⇒ 按**项目的当前值**重算。
           不要求 patch 里带 projectId —— 列表里「切换格式」那条路只传 `{format}`，
           后端照样会重算，本地不跟着算就会与服务器分叉。
         · 这一行没有项目（占位卡 `projectId=null`）⇒ 只有显式给了 `agentId` 才动。
       ⚠️ 项目在本地找不到时**保持原值**（`rawProject` 为空 ⇒ 没有依据，别抹成空）。
       ⚠️ 别简化成 `next.agentId = projectAgentId(...)` 不看 `rawProject` —— 那样
          `projects` 尚未同步到本地的瞬间会把 agent 抹掉，下一次保存就把它当真值推回服务器。 */
    const pidForAgent = (p.projectId !== undefined) ? p.projectId : m.projectId;
    if (pidForAgent) {
      const proj = rawProject(pidForAgent);
      if (proj) next.agentId = proj.agentId || '';
    } else if (p.agentId !== undefined) {
      next.agentId = p.agentId || '';
    }
    return next;
  });
  /* 根节点文本跟着名称走（画布上最大的那个方块写的就是脑图名） */
  let renamed = false;
  if (p.name !== undefined) {
    const t = state.tree[id];
    if (t) { t.text = p.name; renamed = true; }
  }
  /* ★★★ 2026-10-27（用户口径）· **这一次编辑把它变成普通脑图了 ⇒ 摘掉"刚来"的提示**
     （明细见 `markMindmapSeen` 的注释）。判据仍走 `mindmapGateOf()` ——
     "完善"这件事全工程只有一份定义，不要在这里写第二遍"两个字段都非空"。
     ⚠️ 必须拿 map 之后的这一行来判：patch 里可能只带 `format`（画布顶部那颗格式键），
        原行没有项目时它照样补不齐 —— 那就继续紫着，正是对的。
     ⚠️ 卡面上的颜色**不依赖**这一步（`mindmapCardView().fresh` 自己判），
        这里清的是库里那一列，好让服务端别再把这张图当"没看过"往回下发。 */
  const afterSave = rawMindmap(id);
  if (afterSave && afterSave.flashAt && mindmapGateOf(afterSave) === '') markMindmapSeen(id);
  queue(function () { return pushUpdate('mindmap', id); }, function () {
    if (renamed) syncTreeToServer(id);     // 根节点文本变了 ⇒ 树也要推（改格式则不用）
  });
}
/** 删脑图 → 待办关联置空（SET NULL），不级联删待办（FR-3.4 口径 3） */
function removeMindmap(id) {
  mark();
  state.mindmaps = state.mindmaps.filter(function (m) { return m.id !== id; });
  state.todos = state.todos.map(function (d) { return d.mindmapId === id ? Object.assign({}, d, { mindmapId: null }) : d; });
  delete state.tree[id];
  delete _treeReady[id];       // 脑图删了，"已对齐"标记也别留着（同上：脏标记比没有更坏）
  if (state.ui.mindmapId === id) state.ui.mindmapId = '';   // 记忆失效 → 空态 + 列表抽屉
  queue(function () { return pushRemove('mindmap', id); });
}

/* --------- 树结构：后端只有**一个**写入口 `PUT /mindmaps/:id/tree`（整树） ---------
 * ★ 所以下面每个改动树的地方都是同一个收尾：`syncTreeToServer(mid)`。
 *   别试图改成"增量节点接口" —— 服务端的严格树校验（单父/无环/不越级/重算 nodeCount）
 *   是按**整棵树**做的，拆成增量反而要在服务端维护树的可变状态。
 */
/** 把整棵树推给服务端（`mark()` 已由调用方采好快照） */
function syncTreeToServer(mid) {
  queue(function () { return pushTree(mid); });
}

/**
 * 新增节点（`asSibling` 决定挂哪儿）。
 *
 * ⚠️⚠️ **level 必须按"落在谁下面"现推，不能一律 `target.level + 1`** ——
 *   加**同级**节点时新节点与 `target` **同层**，用 `+1` 会当场多一层。
 *   后果不是"少个字段"，而是**渲染档位错掉**：`level` 同时喂两个地方 ——
 *     ① 节点样式 `cls: 'lv' + min(level,3)`（`.mm-lvN` 决定字号/字重）；
 *     ② `metricsMap` 的估宽（`fsOf(level)` × 字数 ⇒ 节点宽高）。
 *   症状（用户 2026-10-09 报）：「选中一级节点 → 加同级 → 新节点看着**不是一级的字体**，
 *   只有重新挪一次位置（`moveNodeTo` → `relevel`）才变回来」。
 *   ⇒ 同级分支 `+0`、子级分支 `+1`，见下面 `sib`。
 *
 * ⚠️ 收尾再走 `relevel(root)` —— `level` 是**派生值**（＝结构深度），
 *   加完节点就把整棵树按结构重刷一遍（与 `moveNodeTo` 的 `relevel(parent)` 同一手法，
 *   只是从根起算更彻底：历史上漂掉的 level 一并修回来）。
 *   这与服务端 `normalizeTree` 那条"level / kind 一律由服务端按真实层级重算"**同口径** ——
 *   两边都认"结构是权威、level 是缓存"。
 *
 *   ⚠️ 两层是**刻意都留**的（2026-10-09 反向验证过）：
 *      · 单去 `relevel(root)`、留着 `+ (sib ? 0 : 1)` ⇒ 结果仍对（新节点当场就是对的档位）；
 *      · 单去 `+ (sib ? 0 : 1)`、留着 `relevel(root)` ⇒ 结果也对（重刷把它救了回来）——
 *        **这正是用户看到的那条线索**：「挪一次位置（`moveNodeTo` → `relevel`）就变回来」；
 *      · 两个一起去 ⇒ `check_store_move.js` 第 ⑦ 条当场红（level 2，期望 1），
 *        症状与用户报的一模一样 ⇒ 判据是有效的。
 *      留上面那个显式值是为了"写下去那一刻就是对的"（别指望下游一定调了重刷），
 *      留 `relevel` 是为了"历史上漂掉的错层也能被下一次加节点顺手修回来"。
 *
 * ⚠️ `kind` 一律给 `'leaf'`（新节点必然没孩子）—— 这也正是服务端的口径
 *   （`level === 0 ? 'root' : children.length ? 'branch' : 'leaf'`），别按"层级"去猜。
 */
function addNode(mid, parentId, text, asSibling) {
  if (!guardTree(mid)) return null;       // 树没对齐就写 ⇒ 会把服务端整棵树覆盖成"只有根"
  const root = state.tree[mid];
  const target = findNode(root, parentId);
  if (!target) return null;
  mark();
  seedHist(mid);
  /* 只有**真的**有父节点可挂时才算同级；`target` 是根节点时 `asSibling` 无意义 ⇒ 退化成加子节点 */
  const sib = !!(asSibling && target.parent);
  const node = {
    id: uid('n'), text: text || '新节点', remark: '',
    level: (target.node.level || 0) + (sib ? 0 : 1), kind: 'leaf', children: []
  };
  if (sib) target.parent.children.push(node);
  else { target.node.children = target.node.children || []; target.node.children.push(node); }
  relevel(root);
  syncMindmapMeta(mid);
  pushHist(mid);
  syncTreeToServer(mid);
  return node.id;
}
function removeNode(mid, id) {
  if (!guardTree(mid)) return;            // 同上：先确认本地树是"真的那棵"
  const hit = findNode(state.tree[mid], id);
  if (!hit || !hit.parent) return;            // 根节点不允许删除
  mark();
  seedHist(mid);
  hit.parent.children = hit.parent.children.filter(function (c) { return c.id !== id; });
  syncMindmapMeta(mid);
  pushHist(mid);
  syncTreeToServer(mid);
}
function updateNode(mid, id, patch) {
  if (!guardTree(mid)) return;            // 同上
  const hit = findNode(state.tree[mid], id);
  if (hit) {
    mark();
    seedHist(mid);
    /* ⚠️⚠️ 必须是**就地改属性**，不能写成 `hit.node = Object.assign({}, hit.node, patch)`。
       `findNode()` 返回的是一个**临时包装** `{node, parent}`（每次现建），
       所以对 `hit.node` **重新赋值**只会改那个包装、**原树纹丝不动** ——
       症状是"编辑写回 / 语音回填静默无效"，而 `pushHist` 还会照常把**没变**的树压进历史，
       于是连撤销都看不出来（第 70 轮的真 bug，见当日日志坑 49）。
       `seedHist` 是 `JSON.stringify` 深快照 ⇒ 就地改**不会**污染历史，撤销照常正确。 */
    Object.assign(hit.node, patch);
    syncMindmapMeta(mid);
    pushHist(mid);
    syncTreeToServer(mid);
  }
}
function moveNode(mid, id, dir) {
  if (!guardTree(mid)) return;            // 同上
  const hit = findNode(state.tree[mid], id);
  if (!hit || !hit.parent) return;
  const arr = hit.parent.children;
  const i = arr.findIndex(function (c) { return c.id === id; });
  const j = i + dir;
  if (j < 0 || j >= arr.length) return;
  mark();
  seedHist(mid);
  const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  syncMindmapMeta(mid);
  pushHist(mid);
  syncTreeToServer(mid);
}

/* ================= 折叠 / 展开（★ 第 70 轮 · 节点操作浮条新增「收起 / 展开」） =================
 *
 * 节点上多一个**可选**字段 `collapsed`（布尔，缺省即展开）。含义只有一句：
 *   **它自己还画，它下面那一窝不画** —— 画布那一侧由 `visibleTree()` 把这一支剪掉。
 *
 * ⚠️ 折叠走这两个函数，**不要图省事去调 `updateNode`**：
 *    `updateNode` 会 seed/push 历史栈、还会刷新 `updatedAt`。
 *    折叠是**看图的姿势**，不是内容改动 —— 记进撤销栈之后，用户"收起一支去看别的"
 *    会变成一次可撤销的编辑；更糟的是撤销只把折叠退回去，看着像"撤销没生效"。
 *    同理 `syncMindmapMeta` 也不调：节点数、层级、更新时间一样都没变。
 *
 * ★ 接入后端后同样**不往服务端推**（尽管服务端的树校验会原样保留 `collapsed`）：
 *   一次"点收起"就发一次整树 PUT 纯属浪费 —— 折叠是纯展示状态，
 *   下次拉到树时缺省即"展开"，正是最自然的重开姿势。
 *   它仍会随**下一次真的内容改动**一起被带上去（`syncTreeToServer` 推的是整棵本地树）。
 */
function setNodeCollapsed(mid, id, on) {
  const hit = findNode(state.tree[mid], id);
  if (!hit) return false;
  hit.node.collapsed = !!on;      // findNode 给的是**原树里的引用**，直接写就落库
  return true;
}

/**
 * 整支同态（含自己）。
 *   · 「展开」用它传 `on=false` —— 用户口径是"点击展开会将该节点下所有节点均展开"，
 *     所以后代里**之前被单独收起过的那些也要一起放开**，不能只解一层；
 *   · 「收起」只折叠**该节点自己**（`setNodeCollapsed`）—— 常见交互就该是这个：
 *     收起来时把后代的折叠状态原样留着，下次展开才不至于"全摊平了"。
 */
function setSubtreeCollapsed(mid, id, on) {
  const hit = findNode(state.tree[mid], id);
  if (!hit) return false;
  (function walk(n) {
    n.collapsed = !!on;
    (n.children || []).forEach(walk);
  })(hit.node);
  return true;
}

/** 重算整棵子树层级（level 决定 lv0–lv3 的样式档，拖拽换父之后必须重刷） */
function relevel(node, level) {
  if (!node) return;
  const lv = (level === undefined) ? (node.level || 0) : level;
  node.level = lv;
  (node.children || []).forEach(function (c) { relevel(c, lv + 1); });
}

/* ================= 编辑历史（撤销 / 重做 · ★ 本轮） =================
 * 脑图本质是个编辑器，改完结构必须能退回来。模型很简单：
 *   `stack` 依次存每一版树的 JSON，`idx` 指着**当前版本**（不变式：stack[idx] === 当前树）。
 *
 * 调用约定（★ 两句话，别记反）：
 *   · `seedHist(mid)`  —— 写在**改动之前**（保证初版进栈；栈非空时是空操作）
 *   · `pushHist(mid)`  —— 写在**改动之后**（把新版本推进去、并砍掉 redo 尾巴）
 * 两者一起用才成立：只 push 会让"第一次改动"无从撤销，只 seed 则新版本根本不进栈。
 *
 * ⚠️ 快照是 `JSON.stringify` 全树 —— 一棵 21 节点的树约 2KB，上限 40 版约 80KB，够用。
 *    真接后端时这里换成"操作日志"更省，但一期只有本地几十个节点，全量快照最不容易写错。
 */
const HIST_MAX = 40;

function histOf(mid) {
  if (!state.hist[mid]) state.hist[mid] = { stack: [], idx: -1 };
  return state.hist[mid];
}
function seedHist(mid) {
  const t = state.tree[mid];
  if (!t) return;
  const h = histOf(mid);
  if (h.stack.length) return;
  h.stack.push(JSON.stringify(t));
  h.idx = 0;
}
function pushHist(mid) {
  const t = state.tree[mid];
  if (!t) return;
  const h = histOf(mid);
  const cur = JSON.stringify(t);
  if (!h.stack.length) { h.stack.push(cur); h.idx = 0; return; }
  if (h.stack[h.idx] === cur) return;              // 没变就别堆垃圾版本
  h.stack = h.stack.slice(0, h.idx + 1);           // 砍掉 redo 尾巴（改过之后"重做"就不该还在）
  h.stack.push(cur);
  if (h.stack.length > HIST_MAX) h.stack.shift();
  h.idx = h.stack.length - 1;
}
function canUndo(mid) { const h = state.hist[mid]; return !!(h && h.idx > 0); }
function canRedo(mid) { const h = state.hist[mid]; return !!(h && h.idx >= 0 && h.idx < h.stack.length - 1); }

function undo(mid) {
  const h = state.hist[mid];
  if (!h || h.idx <= 0) return false;
  mark();
  h.idx -= 1;
  state.tree[mid] = JSON.parse(h.stack[h.idx]);
  syncMindmapMeta(mid);
  /* ★ 撤销 / 重做**也要推服务端**：它是"用户真实做出的一个改动"，
     而 `syncMindmapMeta` 已经把 `updatedAt` 刷了 —— 不推的话本地显示的时间和服务端对不上，
     下次启动一拉就"跳回去"。 */
  syncTreeToServer(mid);
  return true;
}
function redo(mid) {
  const h = state.hist[mid];
  if (!h || h.idx >= h.stack.length - 1) return false;
  mark();
  h.idx += 1;
  state.tree[mid] = JSON.parse(h.stack[h.idx]);
  syncMindmapMeta(mid);
  syncTreeToServer(mid);
  return true;
}

/**
 * 拖拽改结构（★ 09-21 第五轮，对齐参考版的节点拖拽）。
 *   asChild:true  → 把 id 收进 targetId 之下（追加为最后一个子节点）
 *   asChild:false → 与 targetId 同级：before:true 插到它前面，false 插到它后面
 * 守卫（失败一律返回 false，不抛）：
 *   · 根节点不可被移动（它是整棵树的锚，没有父节点可落）
 *   · 目标不能是自己
 *   · 目标不能在自己的子树里 —— 否则会把子树挂到自己的后代下，树被截断
 *   · 目标不存在 / 树不存在
 * ⚠️ 顺序：**先摘除再按 anchor 落位**。反过来在同一父节点内「往前挪」时会算错位置。
 */
function moveNodeTo(mid, id, opt) {
  if (!guardTree(mid)) return false;      // 同上（拖拽改结构也是整树 PUT）
  const root = state.tree[mid];
  if (!root || !id) return false;
  const hit = findNode(root, id);
  if (!hit || !hit.parent) return false;

  const node = hit.node;
  const o = opt || {};
  let parent = null;
  let anchorId = null;                    // null ⇒ 追加到末尾

  if (o.asChild) {
    const t = findNode(root, o.targetId);
    if (!t || t.node === node) return false;
    if (findNode(node, o.targetId)) return false;
    parent = t.node;
  } else {
    const t = findNode(root, o.targetId);
    if (!t || !t.parent || t.node === node) return false;
    parent = t.parent;
    if (findNode(node, parent.id)) return false;
    if (o.before) {
      anchorId = o.targetId;
    } else {
      const arr = parent.children || [];
      const i = arr.findIndex(function (c) { return c.id === o.targetId; });
      anchorId = (i >= 0 && i + 1 < arr.length) ? arr[i + 1].id : null;
    }
  }
  if (parent === node) return false;

  seedHist(mid);                          // ★ 历史：所有守卫都过了，这才真要动树
  mark();                                 // ★ 快照：同样等守卫全过再采（守卫失败不改树，不必回滚）
  hit.parent.children = hit.parent.children.filter(function (c) { return c.id !== id; });
  parent.children = parent.children || [];
  /* ★ 第 68 轮：`o.index` ＝ **精确插入位**（拖拽落点用）。
     ⚠️ 口径约定：调用方给的 index 是「**摘掉自己之后**那张列表」里的下标 ——
        node 在上面那行已经摘掉了，所以这里 splice 不需要再做「原位置在前／在后」的修正
        （自己修正反而会错位一位，这坑第 66 轮的同级插入就差点踩上）。
        给 index 时忽略 targetId 的 before 语义：两者不要同时用。 */
  if (o.index != null) {
    const k = Math.max(0, Math.min(o.index, parent.children.length));
    parent.children.splice(k, 0, node);
  } else if (anchorId && anchorId !== id) {
    const ai = parent.children.findIndex(function (c) { return c.id === anchorId; });
    if (ai >= 0) parent.children.splice(ai, 0, node);
    else parent.children.push(node);
  } else {
    parent.children.push(node);
  }
  relevel(parent);
  syncMindmapMeta(mid);
  pushHist(mid);                          // ★ 历史：新版本进栈、砍掉 redo 尾巴
  /* ★★ 2026-10-22 · **拖拽也必须落库**（审查 P1-01，只读测试已复现）。
     ── 改前：这里 `return true` 就结束了，**没有** `syncTreeToServer(mid)`。
        后果：界面上弹出「已收作子节点」、本地树也真的变了，而服务端那棵树**一格都没动**
        ⇒ 刷新 / 重进 / 换一端打开，结构回到拖之前。用户会以为"我拖丢了"。
        更隐蔽的一条：下一次别处保存（加节点、改文本）会**顺带**把这次拖拽推上去 ——
        于是"有时候能存上、有时候不能"，看起来像随机故障。
     ── 现在：与 `addNode` / `removeNode` / `updateNode` / `moveNode` / `undo` / `redo`
        走**同一个出口**（整树 PUT，服务端按整棵树做严格校验）。
     ⚠️ 顺序照抄上面几个写口：`mark()`（快照）已在本函数中段采过、`pushHist` 之后立刻推 ——
        推之前树必须已经是最终形态，否则推出去的是半成品。
     ⚠️ 失败走 `queue()` 的默认整块回滚（`restore(snapshot)`）＋ `notifyFail()`：
        用户看到"保存失败，已还原"，树回到拖之前 —— 与其它写操作同一套语义。
        这里**不做**"只回滚这一棵树"的精细回滚（那是 P1-02 的架构改造，见审查报告）。 */
  syncTreeToServer(mid);
  return true;
}

/* ================= 变更 · Agent（全部手动 · FR-6.1） ================= */

function addAgent(a) {
  mark();
  const id = uid('a');
  state.agents = state.agents.concat([{
    id: id,
    name: a.name || '未命名 agent',
    quotaLeft: a.quotaLeft || '',
    monthlyQuota: a.monthlyQuota || '',
    quotaResetAt: a.quotaResetAt || '',
    updatedAt: stamp()
  }]);
  queue(function () { return pushCreate('agent', id); });
  return id;
}
/** 编辑即刷新「最后更新于」—— 这是 agent 上唯一的自动字段（FR-6.1） */
function updateAgent(id, patch) {
  mark();
  state.agents = state.agents.map(function (a) {
    return a.id === id ? Object.assign({}, a, patch, { updatedAt: stamp() }) : a;
  });
  queue(function () { return pushUpdate('agent', id); });
}
/** 删 agent → 引用它的项目关联置空，不级联删项目（FR-6.1） */
function removeAgent(id) {
  mark();
  state.agents = state.agents.filter(function (a) { return a.id !== id; });
  state.projects = state.projects.map(function (p) {
    return p.agentId === id ? Object.assign({}, p, { agentId: null }) : p;
  });
  queue(function () { return pushRemove('agent', id); });
}

/* ============ 查询 / 变更 · 模型厂家 key（Token API · ★★ 自动查余额） ============
 * ⚠️ 与 agent 额度互不相干：这一块是「你在模型厂家开通的 key」的余额。
 *
 * ★★ 2026-10-12 起是真功能（此前是纯手填展示）：
 *   存 key（**后端加密**）→ 进「我的」页触发 `refreshTokenKeys()` → 后端代查厂家接口 → 回写余额。
 *
 * ★★ 本层有一条**必须守住**的界线：**明文 key 不进内存**。
 *   `state.tokenKeys` 里每一条只存 `keyMask`（掩码）—— 明文只在
 *   `addTokenKey` / `updateTokenKey` 的**参数里活过那一刻**，随后直接进请求体。
 *   写成"先把明文挂到对象上、发请求时再取"会在内存里留下一份完整凭证，
 *   而内存里任何一份多余的副本都可能被日志 / 调试面板 / 导出顺手带出去。
 *   ⇒ 这也是这两个函数**不走通用 `pushCreate/pushUpdate`** 的原因：
 *     通用那条路是"从 `state` 取 payload"，而明文根本不在 state 里。
 * ★ 09-22 第四十二轮（历史）：字段曾收紧为 vendor / balance / updatedAt；
 *   本轮又加回 `keyMask` / `hasKey` / `balanceAt` / `lastError` 四个与"真查询"有关的字段。
 */

function tokenKeyById(id) {
  return state.tokenKeys.filter(function (k) { return k.id === id; })[0] || null;
}

/**
 * 新增一条厂家 key。
 * @param {{vendor:string, apiKey:string}} k  `apiKey` 是**明文** —— 后端加密后入库，永不回传
 * @returns {string} 本地 id
 */
function addTokenKey(k) {
  const p = k || {};
  const vendor = p.vendor || 'deepseek';
  const key = String(p.apiKey == null ? '' : p.apiKey).trim();

  mark();
  const id = uid('k');
  state.tokenKeys = state.tokenKeys.concat([{
    id: id,
    vendor: vendor,
    /* 新建时还没有余额 ⇒ 空串（卡片显示「待查询」），紧接着的 refresh 会把它填上 */
    balance: '',
    keyMask: vendors.maskKey(key),        // 本地先算一份乐观掩码，服务端回执会覆盖它
    hasKey: !!key,
    balanceAt: '',
    lastError: '',
    updatedAt: stamp()
  }]);

  queue(function () {
    return api.createTokenKey({ id: id, vendor: vendor, apiKey: key });
  }, function () {
    /* ★★ 存好之后**立刻查一次**：用户刚贴完 key，下一眼想看到的就是这把 key 的余额，
       而不是「待查询」（不主动查的话得等他下次进「我的」页才会去查）。
       ⚠️ 必须 `force` —— 普通节流会因为"刚才进页面已经查过一次"把它整条跳过。 */
    refreshTokenKeys(true);
  });
  return id;
}

/**
 * 编辑一条厂家 key —— **改厂商 / 换 key**（至少给一个）。
 *
 * ⚠️ `apiKey` **不传表示不动它**：不能把"这次只改了厂商"写成"key 被清空了"。
 *    后端 DTO 也是这个语义（`undefined` 才是不动）。
 *
 * @param {string} id
 * @param {{vendor?:string, apiKey?:string}} patch
 */
function updateTokenKey(id, patch) {
  const p = patch || {};
  const key = p.apiKey == null ? '' : String(p.apiKey).trim();
  mark();

  const local = { updatedAt: stamp() };
  if (p.vendor) local.vendor = p.vendor;
  if (key) {
    local.keyMask = vendors.maskKey(key);
    local.hasKey = true;
    /* ⚠️ 换 key ⇒ 旧余额 / 旧余额时间 / 旧失败原因**一起作废**（与后端同一口径）：
       它们是**上一把 key 那个账号**的数，留着就是"显示别人的钱"。
       置空后卡片退回「待查询」，下次进页面查到的就是新 key 的数。 */
    local.balance = '';
    local.balanceAt = '';
    local.lastError = '';
  }
  state.tokenKeys = state.tokenKeys.map(function (k) {
    return k.id === id ? Object.assign({}, k, local) : k;
  });

  queue(function () {
    const body = {};
    if (p.vendor) body.vendor = p.vendor;
    if (key) body.apiKey = key;
    return api.updateTokenKey(id, body);
  }, function () {
    /* 与 `addTokenKey` 同一条理由：换了 key 就要立刻看到新余额。
       ⚠️ `force` 是必须的 —— 后端刚把余额清成 null（换 key 作废旧数），
          这一次不查的话卡片会一直停在「待查询」直到下次进页面。 */
    refreshTokenKeys(true);
  });
}

function removeTokenKey(id) {
  mark();
  state.tokenKeys = state.tokenKeys.filter(function (k) { return k.id !== id; });
  queue(function () { return pushRemove('tokenKey', id); });
}

/* ---------- 余额刷新（进「我的」页触发 · ★★ 2026-10-12） ---------- */

/** 「进页面就查」的**节流窗口**（ms）—— 用户口径：60 秒内不重复查 */
const TK_REFRESH_MIN_MS = 60 * 1000;

let _tkRefreshing = null;    // 并发合并：一次刷新没回来前，第二次调用复用它
let _tkLastOkAt = 0;         // 上次**成功**刷新的时刻（ms）；0 ＝ 从没成功过

/**
 * 查全部 key 的余额（`POST /token-keys/refresh`）并整份替换本地列表。
 *
 * ★★ 三条口径（用户 2026-10-12 定）：
 *   ① **进「我的」页触发** —— 余额是"此刻的钱"，不该等用户手动点一次；
 *   ② **60 秒内不重复查** —— 在模块之间来回切不该反复打厂家接口；
 *      ⚠️⚠️ 计时**只在成功时记**：查失败（key 失效 / 后端抖了一下）时**不记**，
 *         用户重新进页面就会立刻再试一次 —— 失败必须能自愈，不能被节流卡住 60 秒。
 *         这是"防抖"而不是"缓存"：防的是**同一秒里连点/来回切**，不是"少查几次"。
 *   ③ **并发合并** —— 上一次还没回来时第二次调用复用同一个 Promise，
 *      避免"两次刷新回来的顺序反了、用旧结果覆盖新结果"。
 *
 * ⚠️ 服务端**不做节流**（每次调用都真查）—— 频率控制是前端的事。
 *
 * @param {boolean} [force] 忽略节流窗口（留给将来的手动「刷新」入口）
 * @returns {Promise<{ok:boolean, skipped:boolean, message?:string, kind?:string}>}
 */
function refreshTokenKeys(force) {
  if (api.useMock()) return Promise.resolve({ ok: true, skipped: false });
  if (_tkRefreshing) return _tkRefreshing;                                  // ③
  if (!force && _tkLastOkAt && (Date.now() - _tkLastOkAt) < TK_REFRESH_MIN_MS) {
    return Promise.resolve({ ok: true, skipped: true });                    // ②
  }

  _tkRefreshing = api.refreshTokenKeys().then(function (list) {
    /* 整份替换：服务端回的是"该用户全部 key 的最新状态"。
       逐条合并没有收益，反而会漏字段（本轮的坑就是"少一个字段显示 undefined"）。 */
    if (list && typeof list.length === 'number') {
      state.tokenKeys = Array.prototype.map.call(list, adaptTokenKey);
    }
    _tkLastOkAt = Date.now();
    return { ok: true, skipped: false };
  }, function (e) {
    return {
      ok: false, skipped: false,
      message: (e && e.message) || '余额查询失败',
      kind: (e && e.kind) || ''
    };
  });

  /* ⚠️ 用二参而不是 `.catch()`：这条链**永远 fulfill**（失败也被转成 `{ok:false}`），
     所以 onRejected 走不到；留着它是给"将来有人往上面加了一步会抛的代码"一个兜底。 */
  _tkRefreshing.then(function () { _tkRefreshing = null; }, function () { _tkRefreshing = null; });
  return _tkRefreshing;
}

/** 上次余额刷新**成功**的时刻（ms）—— 诊断 / 离线判据用；0 ＝ 从没成功过 */
function lastTokenRefreshAt() { return _tkLastOkAt; }

/* ================= 变更 · 个人资料（★ 09-22 第四十二轮） =================
 * 「我的」页资料卡右侧的「编辑」走标准表单抽屉（profile mode）：
 * 用户名（必填）＋ 头像（相册选图；空 ＝ 默认图标）。
 * ★ 接入后端后：头像先在 `form-drawer` 里 `POST /files` 上传，把返回的**完整 URL**
 *   放进表单值 `v.avatar`（这样预览与「我的」页的 `<image src>` 都能直接显示），
 *   到了这里再把它还原成**相对 uri** 交给服务端（库里只存相对路径，§4.5）。
 */
function updateMe(patch) {
  const p = patch || {};
  mark();
  if (p.name !== undefined) state.me.name = p.name;
  if (p.avatar !== undefined) {
    const uri = toAvatarUri(p.avatar);
    state.me.avatar = p.avatar || '';
    /* `undefined` ＝ "判不出来是哪种值，这次就别动头像" —— 宁可不动，
       也不要把一个本地临时路径写进库（那样下次启动就是一张永远加载不出来的图）。 */
    if (uri !== undefined) state.me.avatarUri = uri;
  }
  queue(function () {
    const body = { nickname: state.me.name };
    if (p.avatar !== undefined && state.me.avatarUri !== undefined) body.avatar = state.me.avatarUri;
    return api.updateMe(body);
  });
}

/** 表单里的头像值 → 服务端要的相对 uri。
 *  判不出来时给 `undefined`（＝这次不动它），**不要给 `''`**（那会清掉已有头像）。 */
function toAvatarUri(v) {
  const s = String(v || '');
  if (!s) return '';
  const ours = /\/files\/(.+)$/.exec(s);
  if (ours) return ours[1];                                   // 我们自己的完整 URL → 取相对段
  if (/^w[xX]file:\/\//.test(s) || /^https?:\/\/(tmp|usr)\//i.test(s)) return undefined;  // 本地临时路径，还没上传
  if (/^https?:\/\//i.test(s)) return '';                     // 别的站的外链，不该进库
  return s;                                                   // 已经是相对 uri
}

/* ================= 闪念胶囊（★ 本轮新增 · FR-9） =================
 * 它是一条**流水账**：只进不出 —— 进 ＝ 录一段口播，出 ＝ 被「转成待办 / 转到脑图 / 删除」消掉。
 * 三条口径与别处不同，写在这里免得后来人顺手"统一"掉：
 *   ① **按创建时间正序**（越早越靠上）—— 它记的是"我当时怎么想的"，顺序本身就是信息；
 *      与待办 / 脑图那两张「最近优先」的倒序列表**有意相反**。
 *   ② **没有归属** —— 不挂 projectId、不挂 mindmapId。归属是"整理"那一步的产物，
 *      接住的时候不该逼用户先想清楚（这正是这个功能存在的理由）。
 *   ③ **「识别中」不进数据** —— 那句占位只活在组件状态里（见 mock.js 同一段注释）。
 */

/** 「转到脑图」时承载文本的那枚一级节点名 —— 已存在就复用，不重复建 */
const CAPSULE_HOST = '闪念胶囊';

/* id 生成：时间戳 ＋ 自增序号。
   ⚠️ 批量转脑图会连着建好几枚节点，只用 `Date.now() % 1e6` 会在同一毫秒里撞 id
   —— 撞了不报错，是两枚节点被当成一枚（本工程已在这一类"静默错"上踩过多次）。 */
let CAP_SEQ = 0;
function nextCapId() { CAP_SEQ += 1; return 'c' + (Date.now() % 1000000) + '-' + CAP_SEQ; }
let CAP_NODE_SEQ = 0;
function nextCapNodeId() { CAP_NODE_SEQ += 1; return 'n' + (Date.now() % 1000000) + '-' + CAP_NODE_SEQ; }

/**
 * ★★ 160 轮：这枚胶囊**在不在正常名单里**。
 *
 * 两个"消失原因"，都读成"不在了"，但**去向不同**（这是本轮最关键的一条口径）：
 *   · `deleted`  —— `deletedAt` 非空：**用户手动删除** ⇒ 进「已删除胶囊」列表、**可还原**；
 *   · `consumed` —— `consumedAt` 非空：被 `转待办 / 转脑图` 消化掉 ⇒ **不进那个列表、不可还原**
 *                  （内容已经在待办 / 脑图里了，还原会让同一段话出现两遍）。
 *
 * ⚠️ 所以"正常列表"的判据是 `!deleted && !consumed`，而"已删除列表"的判据**只有** `deleted`
 *   —— 两个名单**不互补**，这正是用户 2026-10-12 要的那个差别。
 * ⚠️ 与待办那边**有意不对称**：待办没有"被消费"这条路，所以它只有一个 `isDeletedTodo`。
 */
function isGoneCapsule(c) { return !!(c && (c.deleted || c.consumed)); }

/**
 * 全部胶囊，**按创建时间正序**（早的在上）—— 于是"刚录的那条永远在末尾"。
 *
 * ★★ 这条不变量是**有消费者的**，别当成"排序口味"随便动：
 *   `capsule.js` 的停录链路（`_scrollBottomTo` → `_startFly`）默认
 *   **"新条就是渲染出来的最后一条"** —— 滚动目标、幽灵落点全按它算。
 *   一旦新条跑到中间，用户看到的就是"幽灵浮到列表中部、原位置空出一格"。
 * ⚠️ 所以比较键走 `tkey()`（归一化到秒）：本地新写与后端 hydrate 的数据精度不同，
 *    直接比字符串会让'…17:10'排到'…17:10:05'前面（详见 `stamp()` 的注释）。
 *
 * ★★ 160 轮：**只给"正常"的那些** —— 两个"消失原因"（见 `isGoneCapsule`）都不进这里。
 *   ⚠️ 这是**唯一**一处需要在读的时候就滤掉的地方：`capsule.js` 的列表、
 *      手机端那一屏、`drawer`、以及所有的条数都从这里出去。
 */
function capsules() {
  return state.capsules.filter(function (c) { return !isGoneCapsule(c); }).sort(function (a, b) {
    const x = tkey(a.createdAt);
    const y = tkey(b.createdAt);
    if (x === y) return String(a.id) < String(b.id) ? -1 : 1;
    return x < y ? -1 : 1;
  });
}

/**
 * ★★ 160 轮：**已删除的胶囊**（用户手动删的那批）—— 「已删除胶囊」列表的唯一数据源。
 *
 * ⚠️ 与 `isGoneCapsule` **不是一回事**：被消费掉的那批也"不在了"，
 *   但它们**不进这张名单**（用户口径：「只有手动删除才进」）——
 *   还原一条已经变成待办的胶囊，会让同一段内容在待办里出现第二遍。
 * ⚠️ 排序仍是**创建时间正序**（与正常列表同一把尺）：换的只是名单，不是读法。
 */
function deletedCapsules() {
  return state.capsules.filter(function (c) { return !!c.deleted; }).sort(function (a, b) {
    const x = tkey(a.createdAt);
    const y = tkey(b.createdAt);
    if (x === y) return String(a.id) < String(b.id) ? -1 : 1;
    return x < y ? -1 : 1;
  });
}

/**
 * 定位一枚胶囊 —— 不滤"活 / 删"（与 `rawTodo` 同一条理由）：
 * 「已删除胶囊」列表要能长按以外的操作、`restoreCapsules` 要能找到它。
 */
function capsuleById(id) { return state.capsules.filter(function (c) { return c.id === id; })[0] || null; }
/** 正常胶囊的条数（标题「闪念胶囊-N」用的就是它） */
function capsuleCount() { return capsules().length; }

/**
 * ★★ 248 轮：**一枚胶囊在卡片上要显示什么** —— 唯一真源。
 *
 * 两个消费者：待办详情页的「闪念胶囊」卡（关联之后已经挂在那条待办上）、
 * 以及「选择胶囊」抽屉里的卡（还没挂上去的那批）。
 * 两处是**同一件事的两个时刻**，各拼一份就等着漂（本工程在 `projectCardView` /
 * `mindmapCardView` 上已经立过同一条规矩：卡片装配收在 store）。
 *
 * ⚠️ 只给"能直接画"的字段，**不给可编辑入口** —— 用户口径第 3 条
 *    「卡片信息只能查看不能编辑」。所以这里没有 `uri` / `editing` 之类的东西，
 *    将来要加"点开看全文"也走这里加只读字段。
 * ⚠️ `time` 走 `atMin()`：胶囊的 `createdAt` 存储是秒精度（`stamp()`），
 *    不截会显示成「2026-10-23 10:35:41」—— 而卡上只需要读"哪一天/几点"。
 *    与详情页「创建于 …」、待办卡「更新于 …」同一口径。
 */
function capsuleCardView(c) {
  return {
    id: c.id,
    text: c.text || '',
    time: atMin(c.createdAt),
    /* ★★ 263 轮（清单 H1/C4）· 这条挂的那张图 —— **拼好的完整 URL**（`<image src>` 直接用）。
       数据层存的是相对 uri（§4.5），拼 URL 是"调用方的显式动作"（`api.js` 顶部第 ④ 条）；
       而这里是**卡片装配**，正是那个"调用方" ⇒ 在这里拼一次，别让每个消费者各拼一遍
       （各拼一遍的病：三处只改了两处 ⇒ 某一处变成裂图）。
       ⚠️ 没有图时给**空串**而不是 `undefined`：wxml 里 `wx:if="{{item.img}}"` 两种都挡得住，
          但"字段恒在"能让判据直接断它存在，也让 `bindtap` 那侧的取值不用再兜一次。
       ⚠️ 上限 1 张（`Capsule.imageUri`）⇒ 这里恒是"一个字符串"，不是数组。
       ★★ 277 轮（用户口径 2026-10-27 第 2、3 条）· **三处都在画它了**：
         · `drawer.wxml` 的 `.dw-cap-pic`（「选择胶囊」抽屉 —— 挑的时候要看得到现场）；
         · `mod-todo.wxml` 的 `.cap-pic`（详情页网格卡 —— 原来 96 定高塞不下，本轮改成
           `min-height` ＋ 正文下方一条 88 高的图带，见 wxss 那段）；
         · `mod-todo.wxml` 的 `.cap-view-pic`（点开看全文时的大图）。
       ⚠️ 263 轮那句"两处有意不画"**已作废**（当时的理由是"定高 96 塞不下"，
          而 277 轮用户明确要看到图 ⇒ 改的是卡片形态，不是这条字段的用途）。 */
    img: c.imageUri ? api.fileUrl(c.imageUri) : ''
  };
}

/**
 * 录一段 → 接住一条。
 * @param {string} text 识别结果；还没回来时传空串（组件在气泡上显示「语音识别中」）
 * @param {object} [opts] { source: 'voice' | 'text', imageUri: string }
 * @returns {string} 新胶囊 id
 */
function addCapsule(text, opts) {
  mark();
  const o = opts || {};
  const id = nextCapId();
  const now = stamp();
  state.capsules = state.capsules.concat([{
    id: id,
    text: text || '',
    createdAt: now,
    source: o.source || 'voice',
    /* ★★ 263 轮（清单 H1）· 挂一张图 —— `POST /files` 回来的**相对 uri**（不是 URL）。
       上传**先于**建条（面板里选完图就传，等到点「记下来」时 uri 早就在手上了）⇒
       这里一次性写全，不走"先建空壳再补图"那条路（那要多一次 PATCH、多一个中间态）。
       ⚠️ 恒给 `null` 而不是 `undefined`：`payloadOf` 会把整条对象**原样**发给后端，
          字段缺省与显式 `null` 在 Prisma 那边是同一种结果，但"字段恒在"让判据读得出来。 */
    imageUri: o.imageUri || null
  }]);
  /* ★ 2026-10-09：接住一枚 ⇒ 那天的活跃度「胶囊」+1（本地乐观，见 `ledgerBump()`）。
     ⚠️ 记的是**接住**这一刻。识别文本异步回来走 `updateCapsuleText()` —— 那一次**不记**
        （改个错字不是又接住了一枚）。 */
  ledgerBump('capsule', now);
  /* ★ 这一条是**先落库、后回填**的：口播一结束就建一条 `text: ''` 的空壳，
     识别文本异步回来再 `updateCapsuleText`。所以这里必须**立刻**把空壳推上去 ——
     否则识别回来时那条 `PATCH` 会打在服务端不存在的 id 上（`2002`），
     症状是"语音识别出来的字一刷新就没了"。
     ★★★ 2026-10-27（全量检查 F04）：**光"立刻推上去"不够** —— POST 与 PATCH 还得分先后。
        把这一笔的 Promise 挂进 `_createGate`，同一 id 的 PATCH 会等它落地
        （见 `pushUpdate` 里那段）。创建一失败/一成功就把门摘掉，别拦住之后的正常编辑。 */
  const gateKey = opKey('capsule', id);
  const created = queue(function () { return pushCreate('capsule', id); });
  if (created) {
    _createGate[gateKey] = created;
    const shut = function () { if (_createGate[gateKey] === created) delete _createGate[gateKey]; };
    created.then(shut, shut);
  }
  return id;
}

/** 识别结果回填 / 就地编辑写回 —— 只改文本；`createdAt` 不动（它记的是"什么时候说的"） */
function updateCapsuleText(id, text) {
  mark();
  state.capsules = state.capsules.map(function (c) {
    return c.id === id ? Object.assign({}, c, { text: text || '' }) : c;
  });
  /* ★ 后端 `PATCH /capsules/:id` **只写 text，不刷 `createdAt`**（需求 §7.1 口径②：
     「改一个错字不该让它跳到末尾」）—— 本地这里也一个字都没动 `createdAt`，两边同口径。 */
  queue(function () { return pushUpdate('capsule', id); }, null, function (e) {
    /* ★★★ 2026-10-20：**这一段文字不许回滚掉**。
     *
     * 用户报的症状（长语音）：识别出来的字先显示出来 → 一会儿消失 → 气泡退回「语音识别中」，
     * 同时弹一句「服务开小差了」。
     * 根因在后端（正文列只有 VARCHAR(191)，超长由 Prisma P2000 拒写 —— 见迁移
     * `20261020090000_text_width`），但**前端这一侧把伤害放大了**：
     * 默认的 `restore(快照)` 是"整块回滚"，而这份快照的 `text` 还是空串 ⇒ 文字当场没了。
     *
     * 为什么要区别对待（别的写失败该回滚，这一条不该）：
     *   · 删错 / 勾错 / 改名失败 ⇒ 回滚是对的，"当作没发生"正是用户想要的；
     *   · **语音识别结果** ⇒ 它只存在于这一次 PATCH 里 —— 录音文件由微信回收、后端不落盘
     *     （技术文档 §6.8.1 硬约束④）、用户也没法重说一遍一模一样的话。
     *     回滚等于把用户唯一找不回来的东西扔了，比"没保存上"恶劣得多。
     * ⇒ 留在界面上，用一句**准确**的话说明"字还在、只是没存上"（`notifyFail` 的
     *   「保存失败，已还原」在这里是**假话** —— 什么都没还原）。
     * ⚠️ 代价说清楚：这条此刻只活在内存里，下拉刷新 / 重进小程序会没有。
     *   真要把它变成"离线草稿队列"是另一个量级的设计（需要本地存储 + 冲突处理），
     *   一期不做 —— 但**不许因为"反正没存上"就把它抹掉**。 */
    try {
      /* 文案口径：**先说结论、再给原因**。
         `notifyFail` 那种"直接显示后端 message"在这里不够用 —— 用户要知道的是
         "我刚才说的话还在不在"，而不是"服务开小差了"。
         ⚠️ 别写成「保存失败，已还原」：这里**什么都没还原**（字还在界面上）。 */
      const why = (e && e.kind === 'biz' && e.message) ? String(e.message) : '';
      wx.showToast({
        title: why ? ('文字没存上，' + why) : '文字没存上，请稍后再试',
        icon: 'none',
        duration: 3000
      });
    } catch (err) { /* 提示失败不该影响保留文本 */ }
    return true;
  });
}

/**
 * ★★ 263 轮（清单 H1/H3）· **换图 / 撤图** —— 只动 `imageUri`，一个字都不碰 `text`。
 *
 * 与 `updateCapsuleText` 是**对称**的两条（各改一列、各发一次 PATCH）：
 *   · `updateCapsuleText` ⇒ 不刷 `createdAt`（改错字不该让它跳到末尾）；
 *   · 本函数             ⇒ 同样不刷 `createdAt`（换张图也不是"又接住一枚"）。
 *
 * ⚠️ 失败语义**与文字那一条相反**：这里用默认的整块回滚（`queue` 的 `restore`）——
 *   图是可以重选一次的，文字不行（那段话只存在于那一次 PATCH 里，见 `updateCapsuleText`
 *   的长注释）。所以这里**不接管** `onFail`，让"回滚 + 一句提示"照常发生。
 * @param {string} id
 * @param {string|null} uri 相对 uri；`null` ＝ 撤掉这张图
 */
function setCapsuleImage(id, uri) {
  if (!capsuleById(id)) return;
  mark();
  state.capsules = state.capsules.map(function (c) {
    return c.id === id ? Object.assign({}, c, { imageUri: uri || null }) : c;
  });
  queue(function () { return pushUpdate('capsule', id); });
}

/**
 * 删除（单条 / 批量走同一个口子）—— ★★ 160 轮起是**逻辑删除（软删）**。
 *
 * 本地不再把这几条从 `state.capsules` 里摘掉，只打上 `deleted` 标记
 * ⇒ 它们从正常列表消失（`capsules()` 滤掉），但**能被「已删除胶囊」列表列出来**。
 * ⚠️ `createdAt` 一个字不动（它记的是"什么时候说的"）⇒ 还原之后**回到原来那个位置**，
 *   这正是胶囊与待办在还原上的差别（待办没有"顺序"这回事，胶囊有）。
 */
function removeCapsules(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return;
  mark();
  markCapsulesLocal(list, 'deleted');
  /* 多选删除走**批删接口**（`DELETE /capsules` ＋ body.ids）—— 比 N 次单删省得多。
     ⚠️ 条件里带 `userId`：传了别人的 id 只会"删 0 条"，不会删掉别人的东西。 */
  if (list.length === 1) queue(function () { return pushRemove('capsule', list[0]); });
  else queue(function () { return api.deleteCapsules(list); });
}

/**
 * ★★ 160 轮新增：**还原**选中的已删除胶囊（「已删除胶囊」列表的「还原」键）。
 *
 * ⚠️ 与 `removeCapsules` **严格对称** —— 同形状的入参、同为批量：
 *   它们是同一张名单上的两个方向，写成一个模子下一个人就不会改歪。
 * ⚠️ 只认 `deleted` 的那批：`markCapsulesLocal(list,'alive')` 即使被传进一枚
 *   `consumed` 的 id 也**不会**把它变活（`consumed` 只清 `consumed`，见那个函数）——
 *   这是"不可还原"这条口径在本地这一侧的落点。
 * ★ 只清标记，`createdAt` 与 `text` 都不动 ⇒ 它回到列表里**原来的位置**。
 */
function restoreCapsules(ids) {
  const list = (ids || []).filter(Boolean);
  if (!list.length) return;
  mark();
  markCapsulesLocal(list, 'alive');
  queue(function () { return api.restoreCapsules(list); });
}

/**
 * 在本地改这几枚胶囊的"在不在"标记（**不发请求**）。
 *
 * ★ 抽出来是因为有**两条**路要动它：
 *   ① `removeCapsules()` / `restoreCapsules()` —— 用户自己点（各自发自己的请求）；
 *   ② `capsulesToMindmap()` / `promoteCapsulesToTodo()` —— 胶囊被"消化"进脑图 / 待办，
 *      服务端在**同一个事务**里已经标了 `consumedAt`，前端**不能再发一次删除**
 *      （发了就是单删接口的 `2002`，而 `queue()` 的错误分支会把快照还原 ⇒
 *      气泡**又冒回来**，还附赠一个「胶囊不存在」的报错）。
 *
 * @param {string[]} ids
 * @param {'deleted'|'consumed'|'alive'} how
 *   · `'deleted'`  用户手动删除（可还原，进「已删除胶囊」）
 *   · `'consumed'` 被转走消化（**不可还原**，不进那个列表）
 *   · `'alive'`    还原 ⇒ 清掉 **`deleted` 这一枚**标记
 *     ⚠️ `'alive'` **有意不清 `consumed`**：那是"不可还原"的实现方式 ——
 *        万一被传进一枚已消费的 id，它照样回不到正常列表里。
 *        （服务端那侧靠 `deletedAt: { not: null }` 的条件做同一件事，两处同口径。）
 */
function markCapsulesLocal(ids, how) {
  const now = stamp();
  const set = {};
  (ids || []).forEach(function (i) { set[i] = 1; });
  state.capsules = state.capsules.map(function (c) {
    if (!set[c.id]) return c;
    if (how === 'deleted') return Object.assign({}, c, { deleted: true, deletedAt: c.deletedAt || now });
    if (how === 'consumed') return Object.assign({}, c, { consumed: true, consumedAt: c.consumedAt || now });
    return Object.assign({}, c, { deleted: false, deletedAt: '' });
  });
}

/**
 * 批量转到脑图 —— 把选中胶囊的文本挂成**一棵新的一级子树**。
 *
 * 口径（用户 2026-09-27）：
 *   · 一级节点固定叫「**闪念胶囊**」，**已存在就复用**（第二次转不再建第二枚同名节点）；
 *   · 每段文本是它下面的一个**二级节点**（严格树，不越级，FR-7.3）；
 *   · 整批只 `seedHist` / `pushHist` 一次 ⇒ 在脑图里按一次「撤回」就能整批退回。
 * ⚠️ 这里**不能**改写成"连着调 `addNode()`"：那条路枚枚都用 `Date.now() % 1e6` 生成 id，
 *    同一毫秒里连着加会撞 id（撞了不报错，是两枚节点被当成一枚）。
 * ★★ 2026-10-15 修（用户报：**选中的脑图不是当前开着的那张时，「转脑图」一声不响地没执行**）：
 *    上面那整套写入都建立在 `state.tree[mid]` 之上，而**那棵树只有"当前开着的那张"才在内存里** ——
 *    `hydrate()` 一进来先把 `state.tree` 清空，之后只有脑图模块渲染那一张时才会 `ensureTree()` /
 *    `loadTree()` 把它拉回来。于是"挑一张**别的**图转过去"这条用户明写的路径必然走到 `!root`
 *    ⇒ 老代码那句 `return 0` 把整件事吞掉：气泡没少、图里没多、连一句提示都没有。
 *    ⇒ 本地没有这棵树时**先把树拉回来**（`loadTree`），再走同一段写入逻辑。
 *
 *    ⚠️ 顺序不能反：必须**先** `loadTree`、**再**发 promote 请求。反过来的话，画布在 `mapped`
 *       之后自己会发一次 `GET /mindmaps/:id/tree`，它与 promote 抢跑、可能先回来并给出
 *       **改动前**的树 ⇒ 画面停在旧树上，也就是同一个 bug 换了个样子。
 *       （`loadTree` 一回来 `_treeReady` 就是真了，画布那次 `refresh()` 便不再自己发请求，
 *        直接从内存里那棵**已经乐观写入过**的树上排版。）
 *    ⚠️ 这也是本函数**唯一**的异步分叉 ⇒ 返回值统一成 `Promise<number>`。
 *       `0` 仍表示"一枚都没写"，调用方照旧据此决定要不要换 `ui.mindmapId`。
 *
 * @returns {Promise<number>} 实际写入的节点数（0 ＝ 一枚没写）
 */
function capsulesToMindmap(mid, ids) {
  const list = (ids || []).map(capsuleById).filter(Boolean);
  /* 图不在 / 一枚胶囊都没选中 ⇒ 真的没什么可做（同步短路，调用方照样拿到 Promise） */
  if (!mid || !rawMindmap(mid) || !list.length) return Promise.resolve(0);
  /* 本地已经有这棵树 ⇒ 老路：一次同步写完，画布当场就能画 */
  if (state.tree[mid]) return Promise.resolve(promoteCapsulesIntoTree(mid, list));
  /* 本地没有这棵树（＝选中的不是当前开着的那张）⇒ 先拉树，再写 */
  return loadTree(mid).then(function () { return promoteCapsulesIntoTree(mid, list); });
}

/**
 * `capsulesToMindmap()` 的**真身** —— 前提是这棵树已经在本地内存里。
 * ⚠️ 拆出来只为让上面那层"要不要先拉树"读起来是一件事；**别在别处调它**。
 * @returns {number} 写进去几条
 */
function promoteCapsulesIntoTree(mid, list) {
  const root = state.tree[mid];
  if (!root) return 0;                    // 兜底：树都没拿到就宁可不写，也不写进一棵不存在的树
  mark();                                 // ★ 快照必在**第一次本地改动之前**（守卫全过、确认真要动了）
  seedHist(mid);
  let host = (root.children || []).filter(function (c) { return c.text === CAPSULE_HOST; })[0];
  if (host) {
    host.children = host.children || [];
  } else {
    host = { id: nextCapNodeId(), text: CAPSULE_HOST, remark: '', level: 1, kind: 'branch', children: [] };
    root.children = (root.children || []).concat([host]);
  }
  list.forEach(function (c) {
    /* ★★ 199 轮：**这几枚新挂上去的**叶子带 `flash` —— 画布据此给它们一层"刚转过来"
       的填充色，直到用户选中其中一枚（`markNodesSeen(mid, ids)`）。
       ⚠️ 复用到的那个 host 节点**不带**：它可能已经存在很久了，每次都让它亮一下是错的
          （用户这次转过来的是**那几条内容**）。同理也别把标记下到 host 上让"整支一起亮"。
       ⚠️ 服务端 `appendCapsuleChildren()` 逐字同口径 —— 两边都写，是因为
          "当前正开着这张图"时用户看到的是**本地这段**（服务端回执要等一次往返）。
       ★★ 275 轮：**图跟着文字一起进节点**（用户第 5 条「文字和图片一并转至脑图……
          一个胶囊对应一个节点，只是增加了图片」）。一个胶囊仍是一枚叶子，只是多了 `imageUri`。
          ⚠️ 服务端那一侧同口径（`common/tree.ts` 的 `appendCapsuleChildren`）；
             上面 `onOk` 拿回执整棵换树时也带着图 ⇒ 这一句只负责"回执回来之前那一帧"。 */
    const leaf = { id: nextCapNodeId(), text: c.text, remark: '', level: 2, kind: 'leaf', flash: true, children: [] };
    if (c.imageUri) leaf.imageUri = c.imageUri;
    host.children.push(leaf);
  });
  syncMindmapMeta(mid);
  pushHist(mid);
  state.mindmaps = state.mindmaps.map(function (m) {
    return m.id === mid ? Object.assign({}, m, { updatedAt: stamp() }) : m;
  });
  /* ── 后端接入：一步原子请求 ─────────────────────────────────────────────
   * ★ 用**专用接口** `POST /capsules/promote-to-mindmap`（技术文档 §6.7），
   *   不是"`pushTree` 存树 ＋ `removeCapsules` 删气泡"两次请求：
   *   分两次时第二次失败会留下「节点进了脑图、气泡还挂在列表里」——
   *   用户下次看到同一段口播记了两遍。服务端把两件事放进同一事务里。
   * ★ 本地**同步标掉**这几枚气泡（不靠 `onOk`）：mock 下没有 `onOk`，而"进了脑图就不该
   *   再留在胶囊列表"是**两条分支共同**的结果 —— 放在 `onOk` 里 mock 就会漏。
   *   ★★ 160 轮：从"本地摘掉"改成 **`markCapsulesLocal(..., 'consumed')`** ——
   *      它们**不进「已删除胶囊」列表**（那是"手动删除"的专属名单，用户口径），
   *      所以标的必须是 `consumed` 而不是 `deleted`。
   * ★ 成功回调里用服务端回的 `treeJson` **整棵换掉本地树**：服务端那几个新节点
   *   自带它自己的 id（`newNodeId()`），不回填的话本地会一直用另一套 id。
   */
  markCapsulesLocal(list.map(function (c) { return c.id; }), 'consumed');
  queue(function () {
    return api.promoteToMindmap(mid, list.map(function (c) { return c.id; }));
  }, function (d) {
    if (!d) return;
    /* ★ 这棵是**服务端返回的**树（`POST /capsules/promote-to-mindmap` 的回执）⇒ 天然已对齐 */
    if (d.treeJson) { state.tree[mid] = d.treeJson; markTreeReady(mid); }
    state.mindmaps = state.mindmaps.map(function (m) {
      return m.id === mid ? Object.assign({}, m, {
        nodes: d.nodeCount !== undefined ? d.nodeCount : m.nodes,
        depth: d.depth !== undefined ? d.depth : m.depth,
        updatedAt: d.updatedAt || m.updatedAt
      }) : m;
    });
  });
  return list.length;
}

/**
 * ★★ 280 轮 · **语义转脑图**（受理那一步）。
 *
 * 与上面 `capsulesToMindmap()` 的区别（两条路都在，别合并）：
 *   · 那条是"把胶囊原样挂到**已有**脑图下"，同步、免费、一条胶囊 = 一个节点；
 *   · 这条是"建一张**新**脑图、让模型按语义重组"，异步、计费、可能失败。
 *
 * ── 三条口径 ──────────────────────────────────────────────────────────
 * ① **先等服务端回执，再改本地**。不做乐观更新，理由：
 *    受理可能被拒（"上一张还在生成"／"这几条已经不在列表里"），
 *    而"气泡先消失、再冒回来"比"等 200 毫秒"难看得多。
 * ② **成功了才标 `consumed`**，而且用 `markCapsulesLocal(..., 'consumed')` 而不是 `'deleted'`：
 *    被语义转走的胶囊**不进「已删除胶囊」列表**（那是手动删除的专属名单）——
 *    与 `promoteCapsulesIntoTree` 同一条口径。
 *    失败时服务端会把它们**自动还原**（`consumedAt` 置空），所以这里什么都不用做。
 * ③ **占位卡插在最前**（`unshift`）：它刚被创建，`updatedAt` 是此刻，
 *    与列表"按更新时间倒序"的排队结果一致，插在最前不需要再排一次。
 *
 * ⚠️ 这里**不调 `mark()`**：`mark()` 记的快照是给 `queue()` 失败回滚用的，
 *    本函数出错时**本地一个字都没改**（口径 ①），留一个悬挂的快照只会让
 *    下一次 `queue()` 拿着它把状态退回更早的时候。
 *
 * @param {string[]} ids 选中的胶囊
 * @returns {Promise<object|null>} 服务端给的占位卡（已 `adaptMindmap`）；幂等命中时也返回它
 */
function capsulesToMindmapAi(ids) {
  const list = (ids || []).map(capsuleById).filter(Boolean);
  if (!list.length) return Promise.reject(new Error('这几条胶囊已经不在列表里了'));
  const cid = uid('mm');
  return api.promoteToMindmapAi(list.map(function (c) { return c.id; }), cid).then(function (d) {
    if (!d || !d.mindmap) return null;
    if (!d.reused) {
      markCapsulesLocal(list.map(function (c) { return c.id; }), 'consumed');
      state.mindmaps = [adaptMindmap(d.mindmap)].concat(state.mindmaps);
    }
    return adaptMindmap(d.mindmap);
  });
}

/**
 * ★★ 280 轮 · **失效重试**：把一张「语义转脑图失败」的卡拉回生成中。
 * ★ 不需要重新选胶囊 —— 服务端存着受理时的输入快照（含胶囊挂的图）。
 * ⚠️ 卡片名称与状态由服务端写，本地只把这两个字段乐观改掉（回执里也会有）。
 */
function retryMindmapAi(id) {  const m = rawMindmap(id);
  if (!m) return Promise.reject(new Error('这张脑图不存在'));
  state.mindmaps = state.mindmaps.map(function (x) {
    return x.id === id ? Object.assign({}, x, { name: '语义转脑中', aiState: 'pending', flashAt: '' }) : x;
  });
  return api.retryMindmapAi(id).catch(function (e) {
    /* 失败要把本地那两处改回去，否则卡上会永远写着"生成中"而服务端是 failed */
    state.mindmaps = state.mindmaps.map(function (x) {
      return x.id === id ? Object.assign({}, x, { name: '语义转脑图失败', aiState: 'failed' }) : x;
    });
    throw e;
  });
}

/**
 * ★★ 280 轮：**还有没有"生成中"的脑图** —— 轮询的三个停止条件之一。
 * 只看 `pending`（`failed` 是终态，用户不动它就一直失败，不该让轮询一直跑）。
 */
function anyMindmapAiPending() {
  return state.mindmaps.some(function (m) { return m.aiState === 'pending'; });
}

/**
 * ★★ 280 轮 · **把"生成中 → 完成/失败"这一步拉回来**（轮询的唯一动作）。
 *
 * 服务端只回"还需要看一眼"的那几条（`GET /mindmaps/ai-pending`）：
 * 生成中 / 失败 / 刚完成但用户还没打开过。
 *
 * ★ 三条口径：
 *  ① **按 id 就地更新**，不整批替换 `state.mindmaps` —— 整批替换会把本地刚插入的
 *     其它卡（比如用户刚新建的）挤掉，因为那个接口只回 ai 相关的几条。
 *  ② **逐字段比一遍再决定要不要改**，返回"真的变了几条"：轮询每 3 秒一次，
 *     每次都无条件 `setData` 会让整个列表白重画一遍（真机上能看出抖动）。
 *  ③ 服务端回了本地**没有**的 id（另一台设备刚发起的）⇒ 直接补进列表头部。
 *     这是"跨端"这条承诺的落点：卡不该只在发起它的那台设备上出现。
 *
 * @returns {Promise<number>} 变化条数（0 ＝ 什么都没变，调用方据此跳过 setData）
 */
function refreshMindmapAi() {
  return api.mindmapAiPending().then(function (d) {
    const items = (d && d.items) || [];
    if (!items.length) return 0;
    const byId = {};
    items.forEach(function (x) { byId[x.id] = x; });
    let changed = 0;
    const known = {};
    state.mindmaps = state.mindmaps.map(function (m) {
      known[m.id] = 1;
      const x = byId[m.id];
      if (!x) return m;
      const next = Object.assign({}, m, adaptMindmap(x), { aiError: x.aiError || '' });
      if (next.aiState === m.aiState && next.name === m.name
        && (next.flashAt || '') === (m.flashAt || '')
        && (next.nodes || 0) === (m.nodes || 0)) return m;
      changed += 1;
      return next;
    });
    const fresh = items.filter(function (x) { return !known[x.id]; });
    if (fresh.length) {
      changed += fresh.length;
      state.mindmaps = fresh.map(adaptMindmap).concat(state.mindmaps);
    }
    return changed;
  });
}

/**
 * ★★ 277 轮 · **胶囊转待办时，它自己挂的那张图跟着走**。
 *
 * 用户口径（2026-10-27）：「胶囊可以在闪念列表中触发转待办，这时如果该胶囊本身有图片，
 * 那转为待办后，这个图片会作为待办的关联图片」。
 *
 * ── 为什么在 store 里拼，而不是让调用方（`capsule.js` 的 `onFormSubmit`）各拼一次 ──
 *   这条规则属于"胶囊 → 待办"这件事本身，与"谁点的按钮"无关：
 *   将来 PC 端、多选合并（`capsuleIds` 那条路）都会走同一个函数。
 *   拼在调用方＝同一条规则有第二个副本，早晚有一份漏了图。
 *
 * ── 三个决定 ──────────────────────────────────────────────────
 * ① **胶囊的图排在最前**：它是这条待办的"现场截图"，先看到它才读得出后来加的那几张是补充。
 * ② **按 `uri` 去重**（不是按 `id`）：`imageUri` 是文件名级唯一，同一张图被两条胶囊引用
 *    只会存一份 —— 待办详情里出现两张一模一样的图是肉眼可见的错。
 * ③ **恒给 `id`**：详情页的 `wx:for` 拿 `item.id` 当 `wx:key`；缺 id 的占位图会让
 *    "删了第一张、留在原地的是第二张"这种错位重排出现（`uid('im')` 是本地临时 id，
 *    服务端回执会把它整批换成真 id）。
 *
 * @param {Array} caps   源胶囊（`promoteCapsulesToTodo` 挑好的那几条）
 * @param {Array} [extra] 调用方另给的图（目前恒空：表单 247 起不再提交 `images`）
 * @returns {Array} `[{ id, uri, label }]`，可直接进 `todo.images` 与 `POST …/promote-to-todo`
 */
function capsuleImagesForTodo(caps, extra) {
  const out = [];
  const seen = {};
  (caps || []).forEach(function (c) {
    const uri = String((c && c.imageUri) || '').trim();
    if (!uri || seen[uri]) return;
    seen[uri] = 1;
    out.push({ id: uid('im'), uri: uri, label: '胶囊图片 ' + (out.length + 1) });
  });
  (extra || []).forEach(function (im) {
    if (!im) return;
    const isObj = typeof im === 'object';
    const uri = String((isObj ? im.uri : im) || '').trim();
    if (!uri || seen[uri]) return;
    seen[uri] = 1;
    out.push({
      id: (isObj && im.id) || uid('im'),
      uri: uri,
      label: (isObj && im.label) || ('图片 ' + (out.length + 1))
    });
  });
  return out;
}

/**
 * 批量转到待办 —— ★ **一次原子请求**（技术文档 §6.7）。
 *
 * 为什么不能写成"`addTodo()` ＋ `removeCapsules()`"两步：
 *   两条请求各自独立发出（都是微任务），**建待办失败但删气泡成功**时
 *   这段口播就被无声地扔掉了 —— 那正是用户唯一没法找回的东西。
 *   服务端 `POST /capsules/:id/promote-to-todo` 把两件事放进同一事务。
 *
 * ⚠️ 目前的入口（胶囊底部「转待办」）**只允许单条**（`onToTodo` 里 `ids.length !== 1` 直接返回），
 *    所以 `ids` 实际恒为长度 1。仍然按数组写，是因为"多选合并成一条"这条路径
 *    一旦被打开（表单里只有一个文本框，用户预期就是"合并"），这里不用再改：
 *    `capsuleIds` 会一起带上，服务端在同一个事务里一并消费。
 *
 * @returns {string} 新待办 id
 */
function promoteCapsulesToTodo(ids, t) {
  const list = (ids || []).filter(Boolean);
  const src = list.map(capsuleById).filter(Boolean);
  mark();                                 // ★ 快照必须在本地改动之前
  const tid = uid('d');
  const now = stamp();
  /* ★★ 277 轮：**胶囊自己挂的那张图跟着过来**（用户口径 2026-10-27 第 1 条）。
     放在 `mark()` 之后、`state.todos` 之前：`capsuleImagesForTodo()` 会 `uid('im')`
     生成临时 id（不碰 state），顺序上仍是"先拍快照、后改动"。
     ⚠️ 这里算出来的这一份**同时**是本地 `todo.images` 与请求体 `images` 的唯一来源 ——
        两处各算一遍就会出现"界面上有图、服务端没有"（刷新即消失）。 */
  const images = capsuleImagesForTodo(src, t.images);
  state.todos = [{
    id: tid,
    projectId: t.projectId,
    /* ★ 表单里「关联脑图」那一行选了就带上（与后端同口径：跨项目的关联会被后端丢弃） */
    mindmapId: t.mindmapId || null,
    text: t.text,
    urgency: t.urgency,
    done: false,
    createdAt: now,
    completedAt: null,
    updatedAt: now,
    /* ★★ 199 轮：**本地也要打上「刚转过来」** —— 服务端 `promoteToTodo` 同样写这一列，
       但它的回执要等一次往返；用户点完确定、列表当场就在眼前，
       少了这一行会出现"转过去的那条当时不亮、刷新一下才亮"。
       ⚠️ 与后端逐字同口径：**只有转过来的**带它（手建的那条 `addTodo()` 不写）。 */
    flashAt: now,
    images: images
  }].concat(state.todos);
  /* ★ 2026-10-09：转待办 ＝ **真的诞生了一条待办** ⇒ 那天活跃度「创建」+1（本地乐观）。
     与后端 `promoteToTodo` 事务里的打点同口径（那边也只 +created）。
     ⚠️ 被消费掉的那几枚胶囊的「胶囊」计数**不减** —— `markCapsulesLocal()` 只动本地数组的
        标记，一个字节都不许碰台账（这是"实时值统计"最典型的错法）。 */
  ledgerBump('created', now);
  /* ★★ 160 轮：标 `consumed`（**不是** `deleted`）—— 内容已经在待办里了，
     它不该出现在「已删除胶囊」列表里、也不可还原（用户口径）。 */
  markCapsulesLocal(src.map(function (c) { return c.id; }), 'consumed');
  if (!src.length) { queue(function () { return pushCreate('todo', tid); }); return tid; }   // 没有源胶囊 ⇒ 退化成"纯新建待办"

  queue(function () {
    return api.promoteToTodo(src[0].id, {
      id: tid,                                // ★ 客户端 id：本地已经用这个 id 建好了
      capsuleIds: src.map(function (c) { return c.id; }),
      projectId: t.projectId,
      mindmapId: t.mindmapId || null,
      urgency: t.urgency,
      text: t.text,
      images: images
    });
  }, function (d) {
    if (d && d.todo) mergeOne(d.todo);
  });
  return tid;
}

/* ================= 闪念胶囊 ↔ 待办的关联（★★ 248 轮） =================
 *
 * 用户口径（2026-10-23）：
 *   ② 「点击『+选择胶囊』弹出选择胶囊的抽屉（主抽屉），卡片显示当前胶囊列表卡片，
 *       **可多选卡片**，底部按键为『取消』『保存』，无胶囊新增按钮」
 *   ③ 「关联后，胶囊卡片就在待办详情页以卡片形式显示，一行可以展示多个卡片，
 *       卡片信息**只能查看不能编辑**，可以取消关联」
 *   ④ 「在建立关联时，胶囊信息需要**从闪念胶囊中移除**（和转脑图、转待办后的
 *       胶囊列表数据的操作一致）」
 *   ⑤ 「如果待办和胶囊解除关联信息，该信息会回到闪念胶囊列表，但是这个过程**不算新增胶囊，
 *       不计入概览统计**，此时胶囊信息的**创建时间为解除关联的时间**，胶囊信息最开始的
 *       创建时间无需保存」
 *
 * ── 为什么"关联"也要标 `consumed`（与转待办 / 转脑图同一套）────────────────
 *   胶囊的"在不在正常列表里"只有**一个**判据：`isGoneCapsule()`（`deleted || consumed`）。
 *   关联如果另开一种标记，那么 `capsules()`、条数、手机端那一屏、drawer、
 *   以及"已删除胶囊"名单——五处都要再加一条"还要排除被关联的"。
 *   关联与"转走"在可见性上确实完全一样 ⇒ 复用同一个标记，
 *   差别只在 `todoId`（有值 ＝ 还挂在某条待办上，解除关联就清掉）。
 *
 * ── 与 `capsulesToMindmap` / `promoteCapsulesToTodo` 的关键差别 ──────────
 *   · 那两条是"内容搬家"（胶囊从此不可还原）；这条是"内容挂一处"——
 *     胶囊本体还在，解除关联就**完整回到列表**；
 *   · 所以这条路**绝不碰活跃度台账**（`ledgerBump`）：关联与解除都不是
 *     "接住 / 创建 / 完成"三个动作之一（用户口径第 5 条明写"不计入概览统计"）。
 */

/** 关联在某条待办上的胶囊 —— **按创建时间正序**（与胶囊列表同一把尺：早的在上） */
function capsulesOfTodo(tid) {
  if (!tid) return [];
  return state.capsules.filter(function (c) {
    return c.todoId === tid && !c.deleted;
  }).sort(function (a, b) {
    const x = tkey(a.createdAt);
    const y = tkey(b.createdAt);
    if (x === y) return String(a.id) < String(b.id) ? -1 : 1;
    return x < y ? -1 : 1;
  });
}

/**
 * 把选中的几枚胶囊**关联**到这条待办（本地乐观 ＋ 一次请求）。
 *
 * ★ 服务端在**同一个事务**里做两件事：胶囊 `todoId = 本条` ＋ `consumedAt = now`、
 *   待办刷 `updatedAt`。分两次请求会留下"关联了但气泡还在列表里"的脏数据
 *   （与 `promoteToTodo` 那条"不能拆成建 ＋ 删"同一条纪律）。
 * ⚠️ 本地**同步**标掉（不靠 `onOk`）：mock 档没有 `onOk`，而"关联完就不该在胶囊列表里"
 *   是两条分支共同的结果。
 * ⚠️ 回执里的 `capsuleIds` 可能**少于**请求（另一端已经把它转成待办 / 关联走了）——
 *   服务端只认"还干净"的那些，所以成功回调要把没挂上的本地**还原回列表**，
 *   否则界面上会多出一张"其实没关联成功"的卡（刷新一次才消失）。
 *
 * @returns {number} 本地标掉了几枚
 */
function linkCapsulesToTodo(tid, ids) {
  const list = (ids || []).map(capsuleById).filter(Boolean);
  if (!tid || !list.length) return 0;
  mark();
  const now = stamp();
  const set = {};
  list.forEach(function (c) { set[c.id] = 1; });
  state.capsules = state.capsules.map(function (c) {
    if (!set[c.id]) return c;
    return Object.assign({}, c, { todoId: tid, consumed: true, consumedAt: c.consumedAt || now });
  });
  state.todos = state.todos.map(function (d) {
    return d.id === tid ? Object.assign({}, d, { updatedAt: now }) : d;
  });
  const okIds = list.map(function (c) { return c.id; });
  queue(function () { return api.linkCapsules(tid, okIds); }, function (d) {
    if (!d || !d.capsuleIds) return;
    const hit = {};
    d.capsuleIds.forEach(function (i) { hit[i] = 1; });
    /* ★★ 2026-10-24（复审 P1-03）：**只修正"本次请求涉及的那几枚"**。
       ── 改前只有 `c.todoId !== tid || hit[c.id]` 两个条件 ⇒ 凡是挂在这条待办上的
          都会被当成"没被接受"，于是一个回执只含 B 的时候，**此前已关联的 A 也被清成
          `todoId:null`、`consumed:false`**，从详情页消失、跑回胶囊列表 —— 而服务端
          那条关联还好好的（下一次全量刷新又冒出来，用户看到的是"关联自己掉了又自己回来"）。
       ── 现在多一个 `!set[c.id]`：本次没请求过的胶囊，任何回执都无权改它。
       ⚠️ 判据顺序无所谓，三条件必须同时在：`set` 管"是不是本次的"、
          `todoId` 管"还挂不挂在这条上"、`hit` 管"服务端接没接"。 */
    state.capsules = state.capsules.map(function (c) {
      if (!set[c.id] || c.todoId !== tid || hit[c.id]) return c;
      return Object.assign({}, c, { todoId: null, consumed: false, consumedAt: '' });
    });
  });
  return list.length;
}

/**
 * **解除关联** —— 胶囊回到闪念胶囊列表（用户口径第 5 条）。
 *
 * ── 三个字段一起动，少一个都会出问题 ──────────────────────────────────
 *   · `todoId → null`     —— 归属断开（详情页不再画它）；
 *   · `consumed → false`  —— **这是"回到列表"的唯一开关**（`isGoneCapsule()`）；
 *   · `createdAt = now`   —— 用户明写「创建时间为解除关联的时间，最开始的创建时间
 *                            无需保存」。列表按创建时间**正序** ⇒ 它排到**末尾**，
 *                            读起来就是"刚回来的那条在最后"。
 * ⚠️ **不调 `ledgerBump`**：回到列表不是"新接住一枚"（用户口径：不计入概览统计）。
 *    这一条最容易写错 —— `addCapsule()` 那条路会 +1，但解绑这条路**不是创建**。
 * ⚠️ 只解绑**确实挂在这条待办上**的（`c.todoId === tid`）：详情页的卡片本来就来自
 *    `capsulesOfTodo(tid)`，这一道是给"确认框弹出那几秒里别处改了"留的兜底。
 *
 * @returns {number} 解绑了几枚
 */
function unlinkCapsulesFromTodo(tid, ids) {
  const list = (ids || []).map(capsuleById).filter(function (c) {
    return !!c && c.todoId === tid;
  });
  if (!tid || !list.length) return 0;
  mark();
  const now = stamp();
  const set = {};
  list.forEach(function (c) { set[c.id] = 1; });
  state.capsules = state.capsules.map(function (c) {
    if (!set[c.id]) return c;
    return Object.assign({}, c, { todoId: null, consumed: false, consumedAt: '', createdAt: now });
  });
  state.todos = state.todos.map(function (d) {
    return d.id === tid ? Object.assign({}, d, { updatedAt: now }) : d;
  });
  queue(function () { return api.unlinkCapsules(tid, list.map(function (c) { return c.id; })); });
  return list.length;
}

/* ================= 「刚转过来」提示（★★ 199 轮） =================
 *
 * 用户口径（2026-10-15 逐字）：
 *   「胶囊可以转化为待办或者脑图节点，对于刚转过去的这个信息，无论是在脑图上还是在这个
 *     待办列表里，最好有一个特殊的颜色填充来进行提示；然后用户在打开这个待办详情或者
 *     选中这个节点卡片后，这个提示消失。这个颜色提示的信息最好要存在数据库，而不是一个
 *     前端的缓存信息，因为整个应用是跨多端交互的。」
 *
 * ⇒ 一条**跨端**的、可以被"看过"这个动作消掉的状态：
 *     待办     `todo.flashAt`（时刻串）—— 由 `promote-to-todo` 写、由 `POST /todos/:id/seen` 清
 *     脑图节点 `node.flash`（布尔）    —— 由 `promote-to-mindmap` 写、由 `POST /mindmaps/:id/seen` 清
 *
 * ★ 为什么不做成"几分钟后自动消失"的本地计时器：
 *   那是**前端缓存**，换一台设备打开就没了 —— 而用户明确要的是"我还没看过"这件事本身，
 *   不是"它刚出现几秒"。所以它只有一个消失条件：**用户真的把它打开了**。
 *
 * ★ 两条清除规则**都有意绕开 `mark()` / `queue()`**（本工程其余写操作的标配），理由是同一条：
 *   `queue()` 失败时会 `restore()` 回滚 ＋ 弹「保存失败，已还原」。而"我看过了"是
 *   **已经发生的事实** —— 没有"该还原的东西"，把紫块闪回来更是错的（用户明明看过了）。
 *   ⇒ 本地先清、请求后发、失败静默（只保留 `2002` 那条多端删除的既有处理）。
 */

/**
 * 清掉**一条待办**的「刚转过来」提示 —— 用户真的打开了这条的详情。
 *
 * 入口：所有"进详情"的路（待办模块选中一条 / 项目页点待办卡）都收在
 * `store.setMemory('todo', id)` 之后的同一个 `refresh()` 点上，见 `mod-todo.refresh()`。
 *
 * ⚠️ **幂等**：本来就没提示（手动建的那条、或别的端已经清过）⇒ 立刻返回，**一个请求都不发**。
 *    这条不只是省流量 —— `GET /todos/:id/seen` 每次开详情都会走，
 *    没有它等于"每看一条待办就发一次没必要的写请求"。
 * ⚠️ 与 `deletedAt` / `done` **正交**：删除 / 完成 / 编辑 / 还原都**不**顺手清它
 *    （那些动作都没说"我看过这条"）。
 */
function markTodoSeen(id) {
  const d = rawTodo(id);
  if (!d || !d.flashAt) return;
  state.todos = state.todos.map(function (x) {
    return x.id === id ? Object.assign({}, x, { flashAt: null }) : x;
  });
  /* mock 态不发请求（与 `queue()` 同一条闸）；真数据态才补发 */
  if (api.useMock()) return;
  api.todoSeen(id).then(function () {}, function (e) {
    /* ★ `2002` ＝ 这条在服务端已经没了（多端同时用）⇒ 走既有的"记忆失效"处理，
       不弹"XX 不存在"。其余失败**刻意静默**：本地已经清掉了，没什么可还原的。 */
    if (e && e.code === 2002) handleGone();
  });
}

/**
 * 清掉**一张脑图里若干节点**上的「刚转过来」标记 —— 用户选中了那一枚。
 *
 * ⚠️ 直接改 `state.tree[mid]` 里的节点（**就地删 `flash`**），并且：
 *   · **不 `pushHist`** —— "看过"不该进撤销栈。用户按「撤回」要退回的是**编辑动作**，
 *     不是"把紫块变回来"（那反而是错的：他明明看过了）。
 *   · **不 `mark()` / `queue()`** —— 理由见上面那一节的总注释。
 *   · **不碰 `updatedAt`** —— 服务端那边也刻意不刷（看一眼不等于改了这张图）。
 * ⚠️ 调用方（脑图模块）负责在这一下之后**重画那一帧**，节点才会当场褪色。
 * ⚠️ **幂等**：这批 id 里一枚带标记的都没有 ⇒ 立刻返回，一个请求都不发
 *    （`selectNode` 每点一下都会走到这里）。
 */
function markNodesSeen(mid, ids) {
  const list = (ids || []).filter(Boolean);
  if (!mid || !list.length) return;
  const root = state.tree[mid];
  if (!root) return;                       // 树不在本地 ⇒ 无从清起（也没得清）
  const set = {};
  list.forEach(function (i) { set[i] = 1; });
  let hit = 0;
  (function walk(n) {
    if (!n) return;
    if (set[n.id] && n.flash) { delete n.flash; hit += 1; }
    (n.children || []).forEach(walk);
  })(root);
  if (!hit) return;
  if (api.useMock()) return;
  api.mindmapSeen(mid, list).then(function (d) {
    /* ★ 服务端回的是"清完之后的整棵树" —— 以它为准可以把两边的差异一次收齐
       （比如别的端已经清过几枚，本地却还留着）。⚠️ 只在**确实回了树**时才换，
          没回就保持本地这棵（免得把刚画好的画面清空）。 */
    if (d && d.treeJson) { state.tree[mid] = d.treeJson; markTreeReady(mid); }
  }, function (e) {
    if (e && e.code === 2002) handleGone();
  });
}

/**
 * 清掉**一张脑图行上**的「刚转过来」提示 —— 这张图已经交还给用户了（信息完善完成）。
 *
 * ★★★ 2026-10-27（用户口径）：「当脑图已经完善信息之后，就应该恢复成了普通脑图，
 *     就应该恢复原来的颜色」。卡面那一层紫由 `mindmapCardView().fresh` 判
 *     （它已经叠了"未完善"前提，历史数据当场就正确）；**这一个函数管的是数据库那一列**：
 *     `flashAt` 不落回 null 的话，服务端会一直把这张图当成"用户没看过"，
 *     `GET /mindmaps/ai-pending` 每次都把它下回来 —— 一个永久存在的假待办。
 *
 * ★ 三条口径，与 `markTodoSeen` / `markNodesSeen` **逐条同源**：
 *   ① **不 `mark()` / 不 `queue()`** —— "我看过了"是已经发生的事实，没有"该还原的东西"，
 *      失败弹一句「保存失败，已还原」再把紫块闪回来更是错的；
 *   ② **幂等**：本来就没提示 ⇒ 立刻返回，一个请求都不发（每次保存表单都会走这里）；
 *   ③ **不碰 `updatedAt`** —— 服务端 `markSeen` 那边也刻意不刷（看一眼不是改过一张图）。
 * ⚠️ 用 `api.mindmapSeen(id, [])`：与"清节点标记"同一个接口、同一句语义，
 *    空 `nodeIds` 是它的合法入参（`MarkSeenDto` 里写明"空数组合法"），
 *    服务端 `markSeen` 正是靠行级 `flashAt` 与节点级 `flash` 分头清。
 * ⚠️ **必须导出**（组件与判据都从 `store.` 上取）—— 漏了只在用户真去完善时炸。
 */
function markMindmapSeen(id) {
  const m = rawMindmap(id);
  if (!m || !m.flashAt) return;
  state.mindmaps = state.mindmaps.map(function (x) {
    return x.id === id ? Object.assign({}, x, { flashAt: null }) : x;
  });
  /* mock 态不发请求（与 `queue()` 同一条闸）；真数据态才补发 */
  if (api.useMock()) return;
  api.mindmapSeen(id, []).then(function () {}, function (e) {
    /* `2002` ＝ 这张图在服务端已经没了（多端同时用）⇒ 走既有的"记忆失效"处理；
       其余失败**刻意静默**：本地已经清掉了，没什么可还原的。 */
    if (e && e.code === 2002) handleGone();
  });
}

/* ================= 复制 / 导出 ================= */

/**
 * 一张脑图的 Markdown 序列化（FR-7.5 · 单独导出时根节点默认不输出）。
 * ⚠️ 第 71 轮起**暂时没有 UI 入口** —— 画布顶部那颗「导出」键已按用户口径取消
 *    （「原有的导出和更多功能取消」）。这个函数**留着**：
 *     ① 它是"脑图序列化 md"的唯一纯函数出口（`md.treeToMarkdown`），删掉等于把能力一起删；
 *     ② 脑图 md 对用户仍有一个出口 —— 待办详情页的「导出」抽屉复制的是
 *        **原文 ＋ 脑图 Markdown**（走下面的 `copyTodoText`），底层是同一套序列化；
 *     ③ 将来若要"导出这张脑图/从列表卡导出"，直接调它即可，不必重写。
 *    ⇒ 属于"有意的保留"，不是漏删的死代码。
 */
function exportMarkdown(mid, opt) {
  const root = state.tree[mid];
  return root ? md.treeToMarkdown(root, opt || {}) : '';
}
function copyTodoText(todoId, opt) {
  const t = rawTodo(todoId);
  if (!t) return '';
  const mm = t.mindmapId ? state.tree[t.mindmapId] : null;
  /* ★ 225 轮：把相对 `uri` 拼成**完整 URL** 的注入点就在这里。
     `api.js` 顶部第 ④ 条明写「不在本层拼图片 URL，拼是调用方的显式动作」，
     而 `markdown.js` 是零依赖纯函数 ⇒ 唯一同时认识两边的地方就是这里。
     不注入的后果（改前）：导出的 md 里是 `![](2026/10/ab12.jpg)` 这种相对路径，
     粘到任何地方都是**死链**，等于图片根本没导出去。
     `imageUrl === undefined` 才注入 ⇒ 调用方显式传 `null` 可以关掉（判据要用）。 */
  const o = Object.assign({}, opt || {});
  if (o.imageUrl === undefined) o.imageUrl = api.fileUrl;
  /* ★★ 250 轮：**关联到这条待办上的闪念胶囊**一并带走
     （用户口径 2026-10-23：「胶囊信息还能合并到待办中进行导出」）。
     ── 为什么在 store 这一层注入，而不是让 `markdown.js` 自己去查：
        那个文件是**零依赖纯函数**（不认识 store、不认识 `todoId` 反查），
        225 轮把 `imageUrl` 也放在这里注入，是同一个理由 ——
        唯一同时认识"数据层"与"纯序列化"两边的地方，就是这一个函数。
     ── 为什么按 `undefined` 判断而不是 `|| []`：调用方显式传 `[]` ＝
        明确"这次不要胶囊"（判据要用；将来看需求也可能给它一个开关）。
        直接写 `|| []` 会把"显式关掉"误当成"没传"。
     ⚠️ 只取 `text` ＋ `uri`（图）：导出是给 agent 读的正文，时间与 id 都是噪声
        （`capsuleCardView` 那套带 `time`，是给界面用的，两处别混）。
        ★ 277 轮把 `uri` 加进来 —— 用户口径「导出的 Markdown 中也要有胶囊挂载图片的链接」。
     ⚠️ `capsulesOfTodo()` 已经滤掉 `deleted`、并按创建时间正序 ——
        顺序直接用，这里不再排一次。 */
  if (o.capsules === undefined) {
    /* ★★ 277 轮：多带一个 `uri`（库里存的**相对 uri**，`imageUri`）——
       `markdown.js` 用注入的 `imageUrl`（＝ `api.fileUrl`）把它拼成完整地址，
       与待办自己的图片走同一条路。缺了它 ⇒ 导出的胶囊那一段只有文字、图整个丢掉。
       ⚠️ 字段名必须是 `uri`（数据层的叫法），**不是** `imageUri`：那个名字只活在
          `Capsule` 行上，序列化函数不认它（认了就等于让纯函数去理解仓储层）。
       ⚠️ 空图给空串（不是 null / undefined）：`markdown.js` 里 `if (c.uri)` 一个判断，
          两种都挡得住，但"字段恒在"让判据读得出来。 */
    o.capsules = capsulesOfTodo(todoId).map(function (c) {
      return { text: c.text, uri: c.imageUri || '' };
    });
  }
  return md.todoToMarkdown(t, mm, o);
}

/* ================= 记忆（FR-8） ================= */

const MEMORY_KEY = { project: 'projectId', todo: 'todoId', mindmap: 'mindmapId' };
function memoryOf(kind) { return state.ui[MEMORY_KEY[kind]] || ''; }
/* ★ 本轮：记忆一变就落一次 storage（技术文档 §9.4）—— 三个口子是**唯一**的写入路径，
   所以放在这里而不是散在页面里。`saveMemory()` 内部自己判 `USE_MOCK`，
   mock 下不碰 storage（否则真机联调留下的记忆会污染核验脚本的起点）。 */
function setMemory(kind, id) { state.ui[MEMORY_KEY[kind]] = id || ''; saveMemory(); }
function clearMemory(kind) { state.ui[MEMORY_KEY[kind]] = ''; saveMemory(); }

/* ================= 后端接入（★ 本轮 · 技术文档 §9.2 / §9.3 / §9.4） =================
 *
 * 设计原则：**能不动就不动**。「加」为主、「改」为辅 —— 上面那些读函数与写函数
 * 一行都没被重构，写函数只在**首尾各多一行**（`mark()` / `queue(...)`）。
 *
 * ★★ 三条硬约束，改这一段之前先读：
 *
 *   ① **`USE_MOCK = true` 时这一整段是"真空"**。
 *      `mark()` 不采快照、`queue()` 直接 return、记忆不读写 storage、树不拉取。
 *      ⇒ 既有核验 / 出图脚本的读数与改造前**逐字相同**（§9.6 末的回归底线）。
 *      这也是为什么这里每处都要显式判 `api.useMock()`，而不是"反正 mock 下请求会返回 null"。
 *
 *   ② **写操作是"乐观更新"**：先改内存（界面立刻响应），请求在**微任务里补发**。
 *      ⇒ 调用方一行都不用改成 async —— `addTodo()` 照样同步返回 id。
 *      代价是 id 必须由**客户端**生成：所以后端在创建类接口上接受可选 `id`
 *      （见 `后端服务/src/common/client-id.decorator.ts` 的完整理由）。
 *
 *   ③ **失败 → 整块回滚 ＋ 提示**。快照粒度是"业务数据全体"，不是精细 diff ——
 *      数据量极小（< 2000 条），`clone` 一次最省事、最不容易错；
 *      为了省内存去写精细 diff 回滚是 bug 温床（§9.3 原话）。
 */

/** 写前快照槽位 —— `mark()` 采、`queue()` 消费。同一时刻只可能有一次写操作在途。 */
let _pre = null;
/**
 * 快照里**不含 `ui`**：那是本地状态（详情记忆 / 筛选 / 抽屉开合），服务端根本没有它。
 *
 * ⚠️ 但**必须含 `hist`（撤销栈）** —— 这是一处容易漏的地方：
 *   脑图的一次改动会同时推 `state.tree`（本地）与 `state.hist`（历史栈）。
 *   若只在失败时回滚 `tree`，历史栈里那一版**仍然留着刚改完的样子** ⇒
 *   用户按一次「撤回」，撤回来的是"那次其实没保存成功的改动" ——
 *   界面看着像撤销生效了，实际与服务端越差越远。
 */
function snapshot() {
  return {
    me: clone(state.me),
    agents: clone(state.agents),
    tokenKeys: clone(state.tokenKeys),
    projects: clone(state.projects),
    todos: clone(state.todos),
    mindmaps: clone(state.mindmaps),
    capsules: clone(state.capsules),
    tree: clone(state.tree),
    hist: clone(state.hist),
    /* ★★ 2026-10-09：**必须含台账**。
       写函数现在会乐观 `ledgerBump()` ＋1（见 `ledgerBump()`），而失败回滚走的是
       `restore(快照)`。快照里漏了它，症状是：**请求失败、待办还原了，热力图却多了一格**
       —— 而且这一格永远不会自己消失（下次 `hydrate` 才会被服务端那份覆盖）。
       与 `hist` 那条是同一类错误（"只回滚了一半"）。 */
    activity: clone(state.activity)
  };
}
function restore(s) {
  if (!s) return;
  state.me = s.me;
  state.agents = s.agents;
  state.tokenKeys = s.tokenKeys;
  state.projects = s.projects;
  state.todos = s.todos;
  state.mindmaps = s.mindmaps;
  state.capsules = s.capsules;
  state.tree = s.tree;
  state.hist = s.hist;
  /* ⚠️ `|| {}` 是防御：快照理论上一定含 activity（见 `snapshot()`），但万一某条老路径
     漏了它，`undefined` 会让**下一次打点**（`ledgerBump` 里的 `state.activity[d]`）
     直接抛 TypeError —— 一次失败的写入会把之后的记数全带崩。退化成空台账最差只是少一次计数。 */
  state.activity = s.activity || {};
  /* ★★★ 2026-10-27（全量检查 F01）· **整块回滚之后，把"这一笔之后已经成功着陆的写"盖回去**。
     改前：A 失败 → `restore(A 的快照)` ⇒ 连带把 B（A 之后发出、已经成功）那笔改动一起抹掉，
     服务端 B 是新值、本地却是旧值，之后任何一次基于本地的保存都会把旧值推回去。
     `_rbSeq` ＝ 正在回滚的这一笔的操作号（`queue()` 失败分支设的），
     `reapplyAcked()` 只回放**序号更大**且**真的成功过**的那些行 —— 没有这些行时它什么都不做，
     所以"单笔失败"的语义与改前逐字相同。 */
  reapplyAcked(_rbSeq);
}

/* ================= 写操作台账（★★ 2026-10-27 · 全量检查 F01 / F03 / F26） =================
 *
 * 三件互相关联、但都很小的事，放一起说明：
 *
 *   ① `_opSeq` / `_issue` —— **同一实体只认最后一笔**（F03）。
 *      改前 `queue()` 成功就 `mergeOne(data)`，不看这期间同一实体有没有又发过一笔：
 *      连改两次同名待办时，第一笔的回执后到 ⇒ 把第二笔的值盖回去（"刚改完又变回去"）。
 *      现在 `pushXxx()` 给请求挂上 `__k/__id`，`queue()` 记下"这个 id 最后一笔的序号"，
 *      回执只在自己仍是最后一笔时落地。
 *
 *   ② `_acked` / `reapplyAcked()` —— **失败只还自己那一笔**（F01）。
 *      整块快照回滚没法分辨"哪些行是别的写成功后落的"，所以再回放一遍那些行。
 *
 *   ③ `_inflightOps` —— **刷新不吞掉等待期间的新写**（F02）。
 *      `refresh()` 只等"调用那一刻"在途的写（有意的，否则刷新会被无限推迟），
 *      但 GET 期间用户还能继续改。ⓘ 那几笔此刻还只是本地乐观值，快照里当然没有；
 *      `hydrate()` 整份替换就会把它们抹掉。现在把这几行抓出来，灌完快照再盖回去。
 *
 * ⚠️ 都不参与渲染、都不落 storage，纯内存台账；`OP_KEEP` 只留最近几十笔就够
 *    （一次连续操作不会超过这个量级，留着更早的既没用也占内存）。
 * ⚠️ 台账**不替代**服务端版本号：两台设备同时改同一条，前端仍然只能"最后收到的赢"。
 *    这里只保证**本机**不会自己跟自己打架。
 */
let _opSeq = 0;            // 每发起一笔写 +1
let _rbSeq = 0;            // 正在回滚的那一笔的序号（`restore()` 读）
let _inflightOps = [];     // 在途写：[{seq, kind, id}]
const _issue = {};         // 'kind:id' → 最后一笔**已发出**的操作号
const _acked = {};         // 'kind:id' → { seq, kind, data } 最后一笔**已成功**的回执
const _ackedOrder = [];    // 上面那张表的插入顺序（只为按容量淘汰）
const _createGate = {};    // 'kind:id' → 创建那一笔的 Promise（PATCH 要等它落地）
const OP_KEEP = 60;

/** 六个实体各自的"当前数组 / 适配函数" —— 台账与回放都走这一份，别再各写一遍 */
const SLICE = {
  project: { get: function () { return state.projects; }, set: function (a) { state.projects = a; }, adapt: function (d) { return adaptProject(d); } },
  todo: { get: function () { return state.todos; }, set: function (a) { state.todos = a; }, adapt: function (d) { return adaptTodo(d); } },
  mindmap: { get: function () { return state.mindmaps; }, set: function (a) { state.mindmaps = a; }, adapt: function (d) { return adaptMindmap(d); } },
  agent: { get: function () { return state.agents; }, set: function (a) { state.agents = a; }, adapt: function (d) { return adaptAgent(d); } },
  tokenKey: { get: function () { return state.tokenKeys; }, set: function (a) { state.tokenKeys = a; }, adapt: function (d) { return adaptTokenKey(d); } },
  capsule: { get: function () { return state.capsules; }, set: function (a) { state.capsules = a; }, adapt: function (d) { return adaptCapsule(d); } }
};

function opKey(kind, id) { return (kind && id) ? (kind + ':' + id) : ''; }

/** 给请求挂上"我是谁来着" —— `queue()` 靠它算序号、判过期、记录已确认 */
function opTag(p, kind, id) {
  if (p && typeof p.then === 'function') { p.__k = kind; p.__id = id; }
  return p;
}

function rowIn(arr, id) {
  for (let i = 0; i < arr.length; i++) { if (arr[i] && arr[i].id === id) return arr[i]; }
  return null;
}

/** 把一行**覆盖或补插**进对应数组（回放用；`mergeOne` 只覆盖、不补插） */
function applyRow(kind, data) {
  const S = SLICE[kind];
  if (!S || !data || !data.id) return;
  const arr = S.get().slice();
  const row = S.adapt(data);
  let hit = false;
  for (let i = 0; i < arr.length; i++) { if (arr[i] && arr[i].id === data.id) { arr[i] = row; hit = true; break; } }
  if (!hit) arr.push(row);
  S.set(arr);
}

/** 把一行从数组里摘掉（回放"那笔是删除"的情况） */
function dropRow(kind, id) {
  const S = SLICE[kind];
  if (!S || !id) return;
  S.set(S.get().filter(function (x) { return !x || x.id !== id; }));
}

function rememberAck(key, kind, seq, data, del, id) {
  _acked[key] = { seq: seq, kind: kind, id: id || (data && data.id) || '', data: data, del: !!del };
  _ackedOrder.push(key);
  while (_ackedOrder.length > OP_KEEP) {
    const k = _ackedOrder.shift();
    /* 同一个 key 可能被 push 过多次：只有它仍是最后一条时才真删 */
    if (_acked[k] && _ackedOrder.indexOf(k) < 0) delete _acked[k];
  }
}

/** 回放"序号比 `after` 更大、且确实成功过"的行 —— 失败回滚只该还自己那一笔 */
function reapplyAcked(after) {
  Object.keys(_acked).forEach(function (k) {
    const rec = _acked[k];
    if (!rec || !rec.seq || rec.seq <= after) return;
    if (!rec.kind || !rec.id) return;
    /* ★ 那一笔是**删除**且已成功 ⇒ 回滚之后也不许把行复活（否则"删掉了又自己回来"） */
    if (rec.del) { dropRow(rec.kind, rec.id); return; }
    if (!rec.data || !rec.data.id) return;
    applyRow(rec.kind, rec.data);
  });
}

/** 抓一份"刷新等待期间又发起的那些写"的本地行（快照灌进来之前调） */
function captureNewerOps(boundary) {
  const out = [];
  /* ① **还在飞的**：本地这一行就是用户此刻看到的那一版（快照里当然没有） */
  _inflightOps.forEach(function (op) {
    if (!op || op.seq <= boundary || !op.kind || !op.id) return;
    const S = SLICE[op.kind];
    if (!S) return;
    const row = rowIn(S.get(), op.id);
    out.push({ kind: op.kind, id: op.id, row: row ? clone(row) : null, del: !row });
  });
  /* ② **GET 期间已经成功落库的**：服务端确认过的那一版（比本地更准）。
     不改前那一版会被"GET 起跑时更旧"的快照盖回去 —— 正是 F02 的正题。 */
  Object.keys(_acked).forEach(function (k) {
    const rec = _acked[k];
    if (!rec || !rec.seq || rec.seq <= boundary) return;
    if (!rec.kind || !rec.id) return;
    out.push({ kind: rec.kind, id: rec.id, row: rec.del ? null : rec.data, del: !!rec.del });
  });
  return out;
}

/** 把它们盖回刚灌完快照的内存里（`del` ⇒ 那一笔是删除，行不该被复活） */
function reapplyOps(ops) {
  (ops || []).forEach(function (op) {
    if (!op) return;
    if (!op.del && op.row) applyRow(op.kind, op.row);
    else dropRow(op.kind, op.id);
  });
}

/** 写前标记 —— ★ 每个写函数的**第一行**。mock 下是空操作。 */
function mark() {
  if (api.useMock()) return;
  _pre = snapshot();
}

/* ================= 在途写 ＋ 回滚通知（★★ 2026-10-24 · 复审 P1-02 / P2-01） =================
 *
 * 两件互不相关、但都必须挂在 `queue()` 上的事：
 *
 *   ① **`_inflight`** —— 这一笔请求的 Promise。`refresh()` 用它判"现在能不能拉快照"：
 *      改前刷新与写是**两条互不知情的路**，`api.sync()` 一回来就 `hydrate(snap)` 整份覆盖。
 *      于是"新建一条 → 立刻下拉刷新"时，快照里若还没有这条（写还没落库），
 *      它会**从界面上消失**；而随后写成功的回执只走 `mergeOne()`（只更新已存在的 id），
 *      不会把它补回来 ⇒ 只能再刷一次才看得见（复审 P1-02 的 A 面）。
 *      ⚠️ 这只解决"A 面"（刷新不越过在途写）。B 面（旧快照覆盖已确认的新状态、
 *        回执乱序）需要服务端 `version` / 幂等键，本轮**不做**，理由见报告。
 *
 *   ② **`_rollbackSubs`** —— 整块回滚发生了。改前 `restore(s)` 只把内存改回去，
 *      **没有任何人通知视图**：界面上那颗"已完成"的勾、刚归档走的卡片都还留着，
 *      而 toast 却说"已还原"（复审 P2-01）。
 *      ⚠️ 只在**真的回滚了**（`handled === false`）时发 —— `updateCapsuleText`
 *        那种"我自己处理了"的接管路径不该触发重画（它刻意保留用户刚说出的文字）。
 *      ⚠️ 成功**不发**：绝大多数调用方本来就会自己 `refresh()`，再统一重画一遍是
 *        白付一次 setData，还会把滚动位置与正在输入的表单一起打断。
 */
const _inflight = [];
let _rollbackSubs = [];

/** 订阅"某次写失败、数据已整块回滚" —— 壳页用它把已挂载的视图重画一遍 */
function onRollback(fn) {
  if (typeof fn === 'function' && _rollbackSubs.indexOf(fn) < 0) _rollbackSubs.push(fn);
}
function offRollback(fn) {
  const i = _rollbackSubs.indexOf(fn);
  if (i >= 0) _rollbackSubs.splice(i, 1);
}
function emitRollback() {
  _rollbackSubs.slice().forEach(function (fn) {
    try { fn(); } catch (e) { /* 单个订阅者出错不该拖垮其余的 */ }
  });
}
/** 当前在途的写（给 `refresh()` 用；返回副本，调用方不许改这个数组） */
function inflightWrites() { return _inflight.slice(); }

/**
 * 补发请求 —— ★ 每个写函数的**最后一行**。
 * @param {Function} call  () => Promise
 * @param {Function} [onOk] 成功后的额外处理（服务端返回值形态不是"单个实体"时用）
 * @param {Function} [onFail] 失败时的**自定义出口**；返回 `true` ＝ "这一笔我自己处理了，
 *        别走默认的整块回滚"（见 `updateCapsuleText` 那条为什么必须这样）
 * @returns {Promise|null} 这一个写操作的完整回执（含成功 / 失败处置），调用方可选地等它
 */
function queue(call, onOk, onFail) {
  if (api.useMock() || typeof call !== 'function') { _pre = null; return null; }
  const s = _pre;
  _pre = null;
  /* ★★ 2026-10-27（全量检查 F03）：这一笔的操作号 —— 回执晚到时不看它就会被旧值盖回去 */
  const seq = ++_opSeq;
  let p = null;
  let syncErr = null;
  let threw = false;
  try { p = call(); } catch (e) { threw = true; syncErr = e; }

  /* ★★ 2026-10-27（全量检查 F26）· **同步抛错不许静默跳过**。
     改前这里 `p = null; return null;` —— 界面上那个乐观值**永远留着**，
     在途数也归零，看起来像"保存成功了"，其实一个请求都没发出去。
     现在与 Promise rejection 走**同一套**失败处置：回滚这一笔 ＋ 说一句 ＋ 通知重画。 */
  if (threw) {
    try { console.error('[store] 写请求同步抛错（这一笔没有发出）', syncErr); } catch (e) { /* 无 console 也不影响 */ }
    _rbSeq = seq;
    restore(s);
    notifyFail(syncErr);
    emitRollback();
    return null;
  }
  /* 非 Promise 返回：**只记账、不回滚** —— 有些写函数在"这一行已经不在了"时本来就会
     返回 null（`pushCreate` 的 `payloadOf` 落空），那不是失败，回滚反而会把界面改乱。 */
  if (!p || typeof p.then !== 'function') {
    try { console.warn('[store] 写函数没有返回 Promise，这一笔没有发出', p === null ? 'null' : typeof p); } catch (e) { /* 同上 */ }
    return null;
  }

  const kind = p.__k || '';
  const id = p.__id || '';
  const key = opKey(kind, id);
  if (key) _issue[key] = seq;
  const op = { seq: seq, kind: kind, id: id };
  _inflightOps.push(op);

  const run = p.then(function (data) {
    /* ★ 用服务端返回值覆盖本地那一条（§9.3）：`updatedAt` 这类服务端会自己改，
       不回填就会"本地显示的更新时间和服务器不一致"。 */
    if (key) rememberAck(key, kind, seq, data, p.__del, id);
    /* ★★ 2026-10-27（F03）：同一实体已经有**更新的一笔**发出去了 ⇒ 这张回执是过期的。
       ⚠️ 只拦 `mergeOne`，`onOk` 照跑 —— 它的活（级联刷新 / 表单回填）与"这一版值新不新"无关 */
    if (!key || _issue[key] === seq) { if (data && data.id) mergeOne(data); }
    if (onOk) onOk(data);
  }, function (e) {
    /* ★★ 2026-10-20：允许调用方**接管失败**（`onFail` 返回真 ⇒ 不回滚、也不弹默认文案）。
       唯一的用户就是 `updateCapsuleText`：识别回填那一笔失败时，默认的"整块回滚"
       会把**用户刚说出口、系统刚识别出来的那段文字**从界面上抹掉（症状是气泡退回
       「语音识别中」，用户以为白说了）。那段文字是**用户唯一找不回来的东西**，
       所以宁可留着 + 明说没存上，也不能悄悄吞掉。 */
    let handled = false;
    if (typeof onFail === 'function') {
      try { handled = !!onFail(e); } catch (err) { handled = false; }
    }
    _rbSeq = seq;
    if (!handled) restore(s);
    if (!handled) notifyFail(e);
    if (!handled) emitRollback();
  });

  /* ★★ 记账：`refresh()` 要等它结束才去拉快照（见上面 ①）。
     ⚠️ 两头都必须摘：成功、失败都摘 —— 漏一个就会让之后**所有**刷新都在等一个
        早已结束的 Promise（虽然 `allSettled` 会立刻过，但数组会一直变长）。 */
  _inflight.push(run);
  const done = function () {
    const i = _inflight.indexOf(run);
    if (i >= 0) _inflight.splice(i, 1);
    const j = _inflightOps.indexOf(op);
    if (j >= 0) _inflightOps.splice(j, 1);
  };
  run.then(done, done);
  return run;
}

/** 失败提示分级（§9.3）：网络类与业务类的文案必须不同，否则用户以为"数据被拒了" */
function notifyFail(e) {
  /* ★ `2002`（对象不存在）是一条**特殊**失败，先于普通文案处理 —— 见下面的注释。 */
  if (e && e.code === 2002) { handleGone(); return; }

  let title = '保存失败，已还原';
  if (!e) { /* 保持默认 */ }
  else if (e.code === 1002) title = '这个账号还没开通';
  else if (e.kind === 'timeout') title = '请求超时，改动已还原';
  else if (e.kind === 'network') title = '网络不太好，改动已还原';
  else if (e.kind === 'biz' && e.message) title = e.message;   // 直接展示后端的话（如「已被「青」占用」）
  try { wx.showToast({ title: title, icon: 'none' }); } catch (err) { /* 提示失败不该影响回滚 */ }
}

/* ---------- 记忆失效（FR-8.4 · 技术文档 §9.4） ---------- */

/** 「数据在别处被删了、请重画」的订阅者 —— 壳页注册，`relayoutAll + showActive` */
let _goneCbs = [];
function onDataGone(fn) {
  if (typeof fn === 'function') _goneCbs.push(fn);
}

/**
 * `2002` 的处理 —— 与"写失败"是**两件不同的事**。
 *
 * 写失败（网络 / 校验）：本地那一笔回滚掉，用户重来一次即可。
 * `2002`：这个对象**在服务端已经没有了**（多端同时用 / 别处删掉了）。这时：
 *   ① **不许弹"XX 不存在"** —— 需求 FR-8.4 要的是"按记忆失效处理"：清掉那条记忆、
 *      走"无详情"分支（列表抽屉），而不是甩一个报错给用户（技术文档 §9.4 末行明确）
 *   ② 三个记忆**就地重新校验一次**（`validMemory` 只在本地数组里比对，**不需要额外接口**）
 *   ③ 叫一声让壳页重画 —— 否则用户还停在"那个点不动的东西"上，直到切模块才发现
 */
function handleGone() {
  pruneMemory();
  _goneCbs.forEach(function (fn) { try { fn(); } catch (e) { /* 单个订阅者出错不拖垮其余 */ } });
}
/** 把三个记忆里**本地已经找不到**的清掉并落盘（幂等） */
function pruneMemory() {
  if (api.useMock()) return;
  const next = {
    projectId: validMemory('project', state.ui.projectId),
    todoId: validMemory('todo', state.ui.todoId),
    mindmapId: validMemory('mindmap', state.ui.mindmapId)
  };
  const changed = next.projectId !== state.ui.projectId ||
                  next.todoId !== state.ui.todoId ||
                  next.mindmapId !== state.ui.mindmapId;
  state.ui.projectId = next.projectId;
  state.ui.todoId = next.todoId;
  state.ui.mindmapId = next.mindmapId;
  if (changed) saveMemory();
}

/** 把服务端返回的单个实体覆盖到本地（按 id 在哪张表里自动分流） */
function mergeOne(d) {
  if (!d || !d.id) return;
  const id = d.id;
  const hit = function (arr) { return arr.some(function (x) { return x.id === id; }); };
  if (hit(state.projects)) { state.projects = state.projects.map(function (x) { return x.id === id ? adaptProject(d) : x; }); return; }
  if (hit(state.todos)) { state.todos = state.todos.map(function (x) { return x.id === id ? adaptTodo(d) : x; }); return; }
  if (hit(state.mindmaps)) { state.mindmaps = state.mindmaps.map(function (x) { return x.id === id ? adaptMindmap(d) : x; }); return; }
  if (hit(state.agents)) { state.agents = state.agents.map(function (x) { return x.id === id ? adaptAgent(d) : x; }); return; }
  if (hit(state.tokenKeys)) { state.tokenKeys = state.tokenKeys.map(function (x) { return x.id === id ? adaptTokenKey(d) : x; }); return; }
  if (hit(state.capsules)) { state.capsules = state.capsules.map(function (x) { return x.id === id ? adaptCapsule(d) : x; }); return; }
}

/* ---------- 形态适配：API ↔ 前端（差异只有下面这几处，别在别处再造一份） ----------
 * ★ 前端的数据形态才是**接口契约的"标准答案"**（它先于后端存在，且被 mock 固定住了）。
 *   所以适配只做"把后端形态翻译成前端形态"，反过来不发散 —— 发请求时直接发本地对象，
 *   多余字段由后端的 ValidationPipe(whitelist) 剥掉。
 *
 * 已知的三处差异（§5.3）：
 *   · `todo.status('open'|'done')`  ↔ 前端 `todo.done` (bool)
 *   · `mindmap.nodeCount`           ↔ 前端 `mindmap.nodes`
 *   · `tokenKey.balance`（**分**，整数）↔ 前端 `balance`（可显示的串 '¥ 128.40'）
 *   另有 `me.nickname` ↔ 前端 `me.name`。
 */
/**
 * ★★ 160 轮：`deletedAt`（时刻字符串 / null）→ **`deleted`（布尔）**。
 *
 * 形态适配只做这一件事：后端那侧"在不在"是**一个时刻**（有值 ＝ 已删除），
 * 前端这边所有判断都只想问"在不在"⇒ 在这里落成一个布尔，全工程只读 `t.deleted`。
 * ⚠️ **`deletedAt` 原样留着**（`Object.assign` 带过来的）—— 后端回执要靠它对齐，
 *    而且"什么时候删的"是将来的排序 / 清理的口子。两个字段并存是有意的。
 * ⚠️ 与 `done` **正交**：软删不碰 `status`，所以一条已删除的待办仍然记得自己删之前的状态。
 */
function adaptTodo(t) {
  const o = Object.assign({}, t);
  o.done = (t.status === 'done') || t.done === true;
  o.deleted = !!(t.deletedAt || t.deleted === true);
  /* ★★ 199 轮：「刚转过来」提示 —— 后端给的是**时刻串或 null**，这里统一成
     "空串 ＝ 没有提示"，全工程只问真假（`!!t.flashAt`）。
     ⚠️ 必须兜底：后端未升级 / 本地还留着改前的快照时它是 `undefined`，
        虽然 `undefined` 同样 falsy，但会顺着 `mergeOne` / `Object.assign` 一路带下去，
        某天谁拿它拼字符串就会长出 "undefined"。与 `adaptTokenKey` 那四个字段同一条手法。 */
  o.flashAt = t.flashAt || '';
  return o;
}
function adaptMindmap(m) {
  const o = Object.assign({}, m);
  o.nodes = typeof m.nodeCount === 'number' ? m.nodeCount : m.nodes;
  /* ★★ 280 轮：本轮新增的四个字段**逐个兜底**（同 `adaptTokenKey` 那四个键的手法）。
     ⚠️ 为什么必须兜：后端未升级 / 本地还留着改前的快照时它们是 `undefined`，
        会顺着 `mergeOne` / `Object.assign` 一路带下去，某天谁拿它拼字符串就长出
        "undefined"，而"看着像 UI 坏了"最难往"少一个字段"上想。
     ⚠️⚠️ `format` 兜成**空串**，绝不兜成默认键：空串是"未设置"这**一档真实状态**
        （语义转脑图刚生成出来的卡就是这样），兜成 `'mindmap'` 等于替用户说他选过了。 */
  o.format = (m.format === null || m.format === undefined) ? '' : String(m.format);
  o.agentId = m.agentId || '';
  o.aiState = m.aiState || '';
  o.flashAt = m.flashAt || '';
  return o;
}
function adaptProject(p) { return Object.assign({}, p); }
/** 额度：整数 ↔ 手填串。`null` 原样保留（＝「未填」，不是 0） */
function adaptAgent(a) {
  const o = Object.assign({}, a);
  o.quotaLeft = quotaText(a.quotaLeft);
  o.monthlyQuota = quotaText(a.monthlyQuota);
  return o;
}
function quotaText(v) { return (v === null || v === undefined) ? null : String(v); }
/** 分 → 可显示的串 */
function adaptTokenKey(k) {
  const o = Object.assign({}, k);
  o.balance = (k.balance === null || k.balance === undefined) ? '' : '¥ ' + (k.balance / 100).toFixed(2);
  /* ★★ 2026-10-12（Token API 转真功能）新增的四个字段，**逐个兜底**：
     `keyMask` / `hasKey` / `balanceAt` / `lastError`。
     ⚠️ 为什么必须兜：后端未升级、或本地还留着改前的快照时，这四个字段是 `undefined`
        ⇒ 卡片上会长出 "undefined"，而"看着像 UI 坏了"的现象最难往"少一个字段"上想。
     ⚠️ `hasKey` 用 `=== true`（不是取反）：**老数据（没配过 key）必须是 false**
        —— 那正是"这条需要去补一把 key"的判据。 */
  o.keyMask = k.keyMask || '';
  o.hasKey = k.hasKey === true;
  o.balanceAt = k.balanceAt || '';
  o.lastError = k.lastError || '';
  return o;
}
/**
 * ★★ 160 轮：胶囊的**两个"消失原因"**从时刻串翻成两个布尔（同 `adaptTodo` 的手法）：
 *   · `deleted`  ← `deletedAt`   手动删除 ⇒ 进「已删除胶囊」、可还原
 *   · `consumed` ← `consumedAt`  被转走消化 ⇒ 不进那个列表、不可还原
 * ⚠️ **两个都要翻**。只翻 `deleted` 的话，被消费的胶囊会读成"正常"⇒ 它会在列表里
 *    复活一份（而服务端的 sync 已经不给了 ⇒ 下次启动又消失，"刷新一下就不见了"）。
 */
function adaptCapsule(c) {
  const o = Object.assign({}, c);
  o.deleted = !!(c.deletedAt || c.deleted === true);
  o.consumed = !!(c.consumedAt || c.consumed === true);
  return o;
}
function adaptMe(m) {
  return {
    name: (m && m.nickname) || '我的工位',
    /* ⚠️ `avatar` 喂给 `<image src>` ⇒ 必须是**能显示的值**（完整 URL 或本地临时路径）。
       相对 uri 另存 `avatarUri`，提交时用它。 */
    avatar: (m && (m.avatarUrl || m.avatar)) || '',
    avatarUri: (m && m.avatar) || ''
  };
}

/**
 * ★★ 2026-10-09：活跃度台账 —— 后端数组 `[{day, created, completed, capsule}]`
 * → 前端按日索引的 map `{ 'YYYY-MM-DD': {created, completed, capsule} }`。
 *
 * 为什么在适配层换形状：`heatWeeks()` 要给 210 个格子**逐格查**台账。
 * 数组得每格 `find` 一次（210 × N 次比较），map 是 O(1) 直取。形状差异只在这一个函数里消化。
 *
 * ⚠️ 三个计数一律 `Number(...) || 0` 兜底：后端缺列、空库、老版本快照都可能给 `undefined`。
 *   漏一个 NaN 的后果很难往"缺字段"上想 —— `levelOf(NaN)` 会一路落到最后 `return 4`
 *   ⇒ **整张图全是最深一档**，看着像"数据特别多"，其实是一个字段没读到。
 */
function adaptActivity(rows) {
  const map = {};
  (rows || []).forEach(function (r) {
    const d = (r && r.day) ? String(r.day).slice(0, 10) : '';
    if (!d) return;
    map[d] = {
      created: Number(r.created) || 0,
      completed: Number(r.completed) || 0,
      capsule: Number(r.capsule) || 0
    };
  });
  return map;
}

/**
 * 台账打点（**本地乐观**）—— 给某天的某一类 +1。真库那边的对应物是后端 `bumpActivity()`。
 *
 * ★ 为什么要本地先加：热力图读的是这份台账，若只等服务端回执，**勾完那条待办图上不动**
 *   （要等一次 `GET /sync`）—— 那正是第 97 轮专门解决过的体验问题，别退回去。
 *   服务端那份随后由 `hydrate()` 整份覆盖，**以服务端为准**（本地乐观只是"先看见"）。
 *
 * ⚠️ **只加不减**。取消完成（`toggleTodo` 的 done=false 分支）、删除待办、
 *    删胶囊、胶囊被消费 —— **一处都不许调它做减法**（本函数也做不了减法）。
 *    这就是本轮修的那个缺陷：动作发生过就是发生过，后来的删除不该让历史缩水。
 *
 * ⚠️ 失败回滚**不需要单独处理**：`mark()` 拍的快照里含 `activity`（见 `snapshot()`），
 *    请求失败走 `restore()` 时整份回退，乐观加的这一次会跟着一起消失。
 */
function ledgerBump(kind, at) {
  const d = dateOf(at) || dateOf(stamp());
  if (!d) return;
  const cur = state.activity[d] || { created: 0, completed: 0, capsule: 0 };
  const next = { created: cur.created || 0, completed: cur.completed || 0, capsule: cur.capsule || 0 };
  next[kind] = (next[kind] || 0) + 1;
  state.activity[d] = next;
}

/* ---------- 全量快照灌入（§9.2） ---------- */

/**
 * 内部装载 —— `hydrate()`（真快照）与 `wipeToEmpty()`（连不上后端时的**真空态**）共用。
 *
 * ★ 为什么要抽出来：这两条路要清的字段**必须一样多**。本工程踩过"清了一处、漏了另一处"
 *   —— 热力图那张 `mock.HEATMAP` 基线就漏过一次，结果是**空库却满图颜色**。
 *   共用一段 ⇒ 以后加字段只改一个地方，两条路同时生效。
 *
 * @param {object}  s       快照；真空态传 `{}`（六组数组全空）
 * @param {boolean} loaded  ★ 它是 `isLoaded()` 的**唯一来源**，而 `isLoaded()` 又是
 *                          「拼不拼图片完整地址」「要不要去拉真树」的闸门。
 *                          **真空态必须传 `false`** —— 否则会拿 mock 的
 *                          `https://example.com/...` 去拼 src，占位块变裂图
 *                          （见 `form-drawer.imageRows()` / `mod-todo` 那两处注释）。
 */
function _load(s, loaded) {
  const d = s || {};
  state.me = adaptMe(d.me);
  state.agents = (d.agents || []).map(adaptAgent);
  state.tokenKeys = (d.tokenKeys || []).map(adaptTokenKey);
  state.projects = (d.projects || []).map(adaptProject);
  state.todos = (d.todos || []).map(adaptTodo);
  state.mindmaps = (d.mindmaps || []).map(adaptMindmap);
  state.capsules = (d.capsules || []).map(adaptCapsule);
  /* ★★ 2026-10-09：活跃度台账**跟着快照一起换**（它是热力图的计数真源）。
     真空态（`wipeToEmpty()`）传进来的是 `{}` ⇒ `adaptActivity(undefined)` → `{}` ✓，
     与上面那 7 份数组"一起清空"是同一件事，不会留下"库清了、图上还满着计数"。
     ⚠️ 必须与下面那两行 `_heatCache = null` **配套**：换了台账就必须让缓存失效，
        否则 `heatWeeks()` 会直接吐回用旧台账算的那份（键恰好相同时尤其隐蔽）。 */
  state.activity = adaptActivity(d.activity);

  /* ★★ 热力图的**基线**也是 mock 种子，必须跟着一起清。
     `state.heat` 的初值是 `mock.HEATMAP` —— 一张 30 周 × 7 的**伪随机**"日常活跃度"
     （`baseLoad` 的正弦取模造出来；实测 210 格里 184 格非零、合计 880 次活动，**全是假的**）。
     上面那 7 份实体数组都清了，唯独漏了它 ⇒ 真接口下热力图 ＝ **假基线 ＋ 真计数**：
     空库（`snap` 六组全空）也会**满图颜色**，现场看就像"库清了、数据还在"。
     真接口下换成**零基线**（同形骨架、计数全 0）；真实计数由 `heatWeeks()` 从上面那份
     **台账**（`state.activity`）叠加 —— ★ 2026-10-09 起**不再**是"遍历现存实体"（那会随删除缩水）。 */
  state.heat = mock.emptyHeatmap();

  /* ⚠️ 换了底图，必须让**热力图缓存**失效：`_heatCache` 的失效键只看
     「待办数 / 已完成数 / 胶囊数」三元组，若 hydrate 前后这三个数**恰好相同**
     （比如真库里也正好 13 条待办 / 0 条完成 / 4 条胶囊），键不变 ⇒
     `heatWeeks()` 会直接返回**用旧底图算出来的**那份缓存，等于没换。 */
  _heatCache = null;
  _heatKey = '';

  /* ★★ `GET /sync` **不给 `treeJson`**（§6.2 红框）⇒ 树必须清空、按需拉取。
     留着旧树更糟：换账号后会把上一个人的树画出来。 */
  state.tree = {};
  /* ⚠️ "已和服务端对齐过"的标记必须**跟着一起清**：不清的话，那些 mid 还带着
     上一份数据的"已对齐"⇒ `loadTree()` 直接短路 ⇒ 画布画的是**上一份**的树
     （症状与"只剩根节点"恰好相反，同样难查）。`_treeReady` 是 const 对象，
     只能逐个 delete —— 不能整体重新赋值。 */
  Object.keys(_treeReady).forEach(function (k) { delete _treeReady[k]; });
  /* 撤销栈是**编辑会话内**的临时结构，跨会话没有意义 */
  state.hist = {};

  /* ★ 这一行是 `isLoaded()` 的**全部来源**，语义是「**这份数据来自后端**」，
     不是"内存里有东西"。真空态传 `false`，见上面的 `@param`。 */
  state.loaded = !!loaded;

  /* ★ 详情记忆：三个 id 必须还能在数组里找到，否则清空该记忆、走无详情分支
     （FR-8.4「记忆对象已删除 → 清空该记忆」）—— 不需要任何额外接口，
     全量数据就在手上，直接比对即可（§9.4）。 */
  loadMemory();

  /* 热力图默认那一格要跟着新数据重算 */
  state.ui.heatSelected = todayCell();
}

/** `store.hydrate(snap)` —— 把 `GET /sync` 的结果灌进来（**真数据** ⇒ `loaded = true`） */
function hydrate(snap) {
  if (!snap) return false;
  _load(snap, true);
  return true;
}

/**
 * `store.wipeToEmpty()` —— 把内存清成**真的空**：零基线 ＋ 空树 ＋ 无记忆。
 *
 * ★ 谁会用：`boot()` 拉不到后端、且 `api.useFallbackMock()` 为假（**默认 / 联调 / 上线态**）。
 *   它守的是产品口径 **「界面上只可能出现数据库里的数据」** —— 拉不到就空着，
 *   不许拿 `mock.js` 的演示数据顶上。否则「库是空的」与「根本没连上」在界面上
 *   长得一模一样，部署 / 排障时会被带偏。
 * ⚠️ `loaded` 传 **`false`**（＝这份数据**不是**从后端来的）：
 *   `isLoaded()` 为假 ⇒ 不去拉真树、不拼图片完整地址。
 */
function wipeToEmpty() { _load({}, false); }

/** 快照灌进去了没有 —— 启动流程用它判断"首屏该不该等" */
function isLoaded() { return !!state.loaded; }

/* ---------- 主动刷新（★★ 126 轮） ---------- */

/**
 * `store.refresh()` —— **用户主动要一份最新数据**。
 *
 * ── 与 `boot()` 的分界（本节唯一必须记住的一条）──────────────────────────
 *   · `boot()`    —— **启动那一次**。拉不到时按 `_fallback` 决定"清空"还是"留种子"。
 *   · `refresh()` —— **用户要最新数据**。拉不到时**保留手上这份**，绝不清空。
 *   为什么必须分家：`boot()` 那套"拉不到就清空"守的是**首屏口径**
 *   （"界面上只可能出现数据库里的数据"）；而用户点一次导航／下拉一次，
 *   想的是"看看有没有新东西"，**不是"把这个应用重置掉"**。
 *   在刷新路径上复用 `wipeToEmpty()`，症状是"点一下菜单，正在看的详情全没了" ——
 *   那是**破坏**，不是刷新。所以这一条**不能省**。
 *
 * ★ 并发去重：连着点几下导航只会发**一个** `GET /sync`（同一个 Promise 给所有调用方）。
 *   重画本来就是幂等的，所以"共享一次回执"没有任何副作用。
 * ★ **永远 resolve**：失败也返回 `{ok:false,...}`，让调用方（壳页 dump toast / 胶囊换文案）
 *   在一个地方处理 —— 而不是每处都写一遍 `catch`。
 * ★ `api.useMock()`（出图态）直接返回成功：`工具/` 那套脚本吃的是本地种子，
 *   一个请求都不该发，刷新的语义在那里退化成"什么都不用做"。
 *
 * @returns {Promise<{ok:boolean, mock:boolean, code:number, message:string, kind:string, errMsg:string}>}
 *   字段形状与 `boot()` 的回执**同形** ⇒ `api.netHint()` 两边都能直接吃。
 */
let _refreshing = null;

function _refreshOk() { return { ok: true, mock: false, code: 0, message: '', kind: '', errMsg: '' }; }
function _refreshFail(e) {
  return {
    ok: false, mock: false,
    code: (e && e.code) || 0,
    message: (e && e.message) || '刷新失败',
    kind: (e && e.kind) || '',
    errMsg: (e && e.errMsg) || ''
  };
}

/**
 * ★★ 2026-10-22 · **普通同步不许清掉"这一场会话已经对齐过的树"**（审查 P2-01，只读测试已复现）。
 *
 * ── 改前的现象 ──────────────────────────────────────────────────────────────
 *   `refresh()` → `hydrate()` → `_load()` 会**无条件**执行
 *   `state.tree = {}` ＋ 清空 `_treeReady` ＋ `state.hist = {}`。
 *   于是在脑图里改了两笔、点一下导航（导航就会触发一次 `refresh`）之后：
 *   `canUndo` 从 true 变 false，画布要重新 `GET /tree` 才能再看到树 ——
 *   用户读到的是"刚还能撤回的动作突然不可撤回了"。
 *   ⚠️ 那段"清空"本身是**对的、要保留**：`_load()` 还被
 *      `boot()` 与 `wipeToEmpty()` 用 —— 换账号 / 冷启动时必须清，
 *      否则会把上一个人的树画出来。所以修法不在 `_load()` 里，而在**刷新这一条路**上。
 *
 * ── 现在的口径：**按脑图 id 认领**，只留住"这次快照里还在的那些" ──────────────
 *   · 先按新快照的 `mindmaps[].id` 把现有的「树 ＋ 撤销栈 ＋ 已对齐标记」收起来；
 *   · `hydrate()` 照旧清空（冷启动 / 换账号那条路一点没变）；
 *   · 再把收起来的灌回去。
 *   ⇒ 脑图还在 ⇒ 树与历史原地保留（刷新后仍可撤销、不白拉一次树）；
 *     脑图没了（别处删了 / 换了账号）⇒ 认领不到 ⇒ 自然被清掉，与改前一致。
 *
 * ⚠️ **只认 `_treeReady`**：占位树（`ensureTree()` 造的那棵"只有根"）不进保留集 ——
 *    留住它并把标记置真，等于把"真数据来源"永久挡在门外（那正是"永远只剩一个根"）。
 * ⚠️ 远端树此刻可能已经被别处改过，我们留的是本地这一版 —— 与改前"加载过一次就不再拉"
 *    是同一个取舍（`loadTree()` 只按 `_treeReady` 短路）。真正的版本冲突要靠后端版本号，
 *    不在本次范围内（见审查 P1-02 / P2-01 的验收口径）。
 * ⚠️ 本函数只服务 `refresh()`（用户主动要最新数据）；`boot()` 不许调它。
 */
function keepSessionTrees(snap) {
  const keep = { tree: {}, hist: {}, ready: [] };
  const list = (snap && snap.mindmaps) || [];
  list.forEach(function (m) {
    const id = m && m.id;
    if (!id || !_treeReady[id]) return;
    if (!state.tree[id]) return;
    /* ★★★ 2026-10-27（全量检查 F08）· **远端更新过，本地这棵树就不再是"最新"了**。
     * ── 病根：`keepSessionTrees()` 只按 id 认领，`loadTree()` 又只按 `_treeReady` 短路
     *    ⇒ 设备 B 改完脑图，设备 A 主动刷新只换到新元信息，画布照旧画**本地那棵旧树**
     *    （导出也一样），而且再也拉不下来 —— 直到杀进程重进。
     * ── 判据用 `updatedAt`：本地保存成功时 `mergeOne()` 已经把服务端的新值回填，
     *    所以"远端更新"唯一可能＝**别处改的**（本机刚改完的那一版此刻是相等的）。
     *    这时不认领 ⇒ `_treeReady` 跟着 `hydrate()` 一起清掉 ⇒ 下次进图会重新 GET。
     * ── 本地脏树（有未确认写）也可能被这一步丢掉；那种情况由"写失败 → 整块回滚"
     *    与 `treeGuard` 挡住，不会静默覆盖服务端（服务端树版本号仍是要补的协同项）。
     * ⚠️ 字符串比较就够：两边都是 'YYYY-MM-DD HH:mm:ss'，同宽同序。
     * ⚠️ 缺 `updatedAt`（老数据 / 测试桩）⇒ 退化成"照旧保留"，与改前逐字相同。 */
    const local = rawMindmap(id);
    if (local && m.updatedAt && local.updatedAt &&
        String(m.updatedAt) > String(local.updatedAt)) return;
    keep.tree[id] = state.tree[id];
    if (state.hist[id]) keep.hist[id] = state.hist[id];
    keep.ready.push(id);
  });
  return keep;
}

function mergeSessionTrees(keep) {
  if (!keep) return;
  Object.keys(keep.tree).forEach(function (id) {
    /* 再确认一次"这张图还在" —— hydrate 之后 state.mindmaps 才是权威 */
    if (!rawMindmap(id)) return;
    state.tree[id] = keep.tree[id];
    if (keep.hist[id]) state.hist[id] = keep.hist[id];
    _treeReady[id] = true;
  });
}

function refresh() {
  if (api.useMock()) return Promise.resolve(_refreshOk());
  if (_refreshing) return _refreshing;

  /* ★★ 2026-10-24（复审 P1-02 · A 面）：**先让在途写落地，再拉快照**。
     改前这里直接 `api.sync()`：一次"新建 → 立刻刷新"里，快照很可能还不含那条新记录，
     而 `hydrate()` 是**整份覆盖** ⇒ 新记录从界面上消失；随后写成功的回执只走
     `mergeOne()`（只更新已存在的 id，不补插）⇒ 它一直不回来，直到下一次刷新。
     症状是用户以为自己刚记的那条没了。
     ⚠️ 只等**调用这一刻**已经在途的那些：等待期间新发起的写不在 `pending` 里，
        这是有意的 —— 否则连续操作会互相等待、刷新被无限推迟。
     ⚠️ `Promise.allSettled` 在小程序基础库里可用性不确定 ⇒ 用 `Promise.all`
        ＋ 每条自带 `.catch` 的写法，效果等价且不挑基础库。
     ⚠️ 代价：写请求挂住（弱网）时刷新会一起等。这是"宁可晚一点、也别给出旧快照"
        的取舍；`api` 自身有超时，不会无限等。 */
  const pending = inflightWrites();
  /* ★★ 2026-10-27（全量检查 F02）：**这一刻是"本地修订边界"**。
     下面只等 `pending`（调用这一刻已在途的那些，有意如此：等全部新写会让刷新被无限推迟），
     而 GET 往返期间用户还能继续改 —— 那几笔此刻只是本地乐观值，快照里必然没有，
     `hydrate()` 整份替换就会把它们抹掉。⇒ 灌快照前把它们抓一份、灌完再盖回去。 */
  const boundary = _opSeq;
  const wait = pending.length
    ? Promise.all(pending.map(function (p) {
        return p && typeof p.then === 'function' ? p.catch(function () {}) : Promise.resolve();
      }))
    : Promise.resolve();

  _refreshing = wait.then(function () {
    if (api.useMock()) return _refreshOk();
    return api.sync().then(function (snap) {
      /* ⚠️ `hydrate()` 在**本地**的工作（清旧树、清 `_treeReady`、重算 `heatSelected`）
         全部是同步的，包在 try 里是为了万一它抛错也不会把 Promise 卡在"永远 pending"
         —— 那样 `_refreshing` 就不会归零，之后**所有**刷新都会静默变成空操作。 */
      /* ★★ 2026-10-22：刷新要**保住已对齐的树与撤销栈**（理由见 `keepSessionTrees`）。
         ⚠️ 顺序：收 → hydrate → 灌回。hydrate 抛错时直接返回（那时内存已经被改了一半，
            没有"纠正"的余地，与改前一致）。 */
      let keep = null;
      try { keep = keepSessionTrees(snap); } catch (e) { keep = null; }
      /* ★ 快照**到达**这一刻再抓一次边界之后的在途写（等待期间新发起的那些） */
      let newer = [];
      try { newer = captureNewerOps(boundary); } catch (e) { newer = []; }
      try { hydrate(snap); } catch (e) { return _refreshFail(e); }
      try { mergeSessionTrees(keep); } catch (e) { /* 保留失败不该让刷新报错 */ }
      /* ★★ F02：把"刷新期间刚改的那几行"盖回去 —— 快照是 GET **起跑时**的旧版。
         ⚠️ 两份来源都要：①**仍在途**的（本地乐观值，快照里必然没有）；
            ②`boundary` 之后**已经成功**的回执（服务端确认过，比快照更新 ——
              报告 R2 那种"GET 期间改完还收到成功回执"就是这一条）。
         ⚠️ 失败的那些不回放：它们已经回滚过了。 */
      try { reapplyOps(newer); } catch (e) { /* 同上，不该让刷新报错 */ }
      return _refreshOk();
    }, function (e) {
      /* ★★ 这里**不许**调 `wipeToEmpty()` —— 理由见上面那条分界。 */
      return _refreshFail(e);
    });
  });

  /* 回执交付之后立刻归零（下一次点击才会真的再发一次请求）。
     ⚠️ 用二参而不是 `.catch()`：这条链**永远 fulfill**，所以 onRejected 走不到，
     但留着它是给"将来有人往上面加了一步会抛的代码"一个兜底。 */
  _refreshing.then(function () { _refreshing = null; }, function () { _refreshing = null; });
  return _refreshing;
}

/* ---------- 脑图树：按需拉取 ---------- */

/**
 * 取一张脑图的树 —— **画布的真数据来源**。
 *
 * ★★ 2026-09-30：这条链路之前是**断的**（`loadTree` 写好了、导出里也有，
 *    但**一个调用点都没有**），画布只用了同步兜底 `ensureTree()` ⇒
 *    重开小程序后永远只有根节点。现在由 `mod-mindmap.js` 的 `refresh()` 调用。
 *
 * ★ 与 `ensureTree()` 的分工（**必须分清**）：
 *   · `ensureTree()` —— **同步兜底**：保证"渲染拿得到一棵树、不白屏"。
 *     它造的是一棵**只有根节点**的占位树，**不代表数据已就绪**。
 *   · `loadTree()` —— **真数据来源**：把服务端那棵树拉回来。
 *   判断"要不要拉"只认 `_treeReady`（见上面 `treeReady()` 的说明），
 *   **不许**看 `state.tree[mid]` 在不在 —— 占位树也在。
 */
function loadTree(mid) {
  if (!mid) return Promise.resolve(null);
  /* ⚠️⚠️ 短路条件只看 `_treeReady` —— 见上面那段说明。
     写成 `if (state.tree[mid]) return` 会让 `ensureTree()` 的占位树把这里挡死。 */
  if (treeReady(mid) && state.tree[mid]) return Promise.resolve(state.tree[mid]);
  if (api.useMock()) { markTreeReady(mid); return Promise.resolve(ensureTree(mid)); }
  return api.getTree(mid).then(function (d) {
    const t = d && (d.treeJson || d);
    if (t && typeof t === 'object') state.tree[mid] = t;
    else ensureTree(mid);
    markTreeReady(mid);                       // ★ 只有走到这里才算"和服务端对齐过"
    return state.tree[mid];
  }, function () {
    /* 拉失败不阻塞渲染：给一棵只有根节点的空树，用户能看到画布而不是白屏。
       ⚠️ 刻意**不** markTreeReady —— 这次并没有对齐；下次进入这张图会再试一次。 */
    return ensureTree(mid);
  });
}

/* ---------- 服务端推送：按实体分流 ---------- */

/** 从本地取一条，做**请求体**（多余字段由后端 whitelist 剥掉） */
function payloadOf(kind, id) {
  const src =
    kind === 'project' ? rawProject(id) :
    kind === 'todo' ? rawTodo(id) :
    kind === 'mindmap' ? rawMindmap(id) :
    kind === 'agent' ? agentById(id) :
    kind === 'tokenKey' ? tokenKeyById(id) :
    kind === 'capsule' ? capsuleById(id) : null;
  return src ? clone(src) : null;
}
function pushCreate(kind, id) {
  const o = payloadOf(kind, id);
  if (!o) return null;
  const p =
    kind === 'project' ? api.createProject(o) :
    kind === 'todo' ? api.createTodo(o) :
    kind === 'mindmap' ? api.createMindmap(o) :
    kind === 'agent' ? api.createAgent(o) :
    /* ⚠️★ 175 轮：`tokenKey` 的**新建 / 编辑已不从这里走** —— 它要带明文 key，而明文
       不在 `state` 里（`payloadOf` 取的是 state）。那两条改由 `addTokenKey` /
       `updateTokenKey` 自己构造请求体，见它们的注释。这两行**留着**只为防御：
       万一将来有人从通用路径动 tokenKey，这里仍然发得出请求，而不是静默什么都不做。 */
    kind === 'tokenKey' ? api.createTokenKey(o) :
    kind === 'capsule' ? api.createCapsule(o) : null;
  return p ? opTag(p, kind, id) : p;
}
function pushUpdate(kind, id) {
  const o = payloadOf(kind, id);
  if (!o) return null;
  const send = function () {
    if (kind === 'project') return api.updateProject(id, o);
    if (kind === 'todo') return api.updateTodo(id, o);
    if (kind === 'mindmap') return api.updateMindmap(id, o);
    if (kind === 'agent') return api.updateAgent(id, o);
    /* ⚠️★ 175 轮：同 `pushCreate` —— token 的编辑走 `updateTokenKey` 自己那条路 */
    if (kind === 'tokenKey') return api.updateTokenKey(id, o);
    if (kind === 'capsule') return api.updateCapsule(id, o);
    return null;
  };
  /* ★★★ 2026-10-27（全量检查 F04）· **PATCH 必须等创建落地**。
     ── 病根：口播一结束先建一条空壳（POST），识别文本异步回来再 PATCH；
        两条请求**互不知情**（`addCapsule()` 发完就返回本地 id），
        POST 还没落库时 PATCH 已经出去了 ⇒ 服务端那边这条还不存在（`2002`），
        慢网 / 识别很快时都可能撞上。
     ── 现在：创建那一笔的 Promise 记在 `_createGate`，同一 id 的更新挂在它后面。
        ⚠️ 请求体 `o` 在**这一刻**就取好了（`payloadOf` 现读），
           所以"晚发出去的那一版"带的仍是此刻的最终文本，不会因为等待而变旧。
        ⚠️ 创建失败就**不再补发** PATCH（那一笔已经回滚、行都不在了）——
           失败提示与回滚由创建那一笔自己报。 */
  const gate = _createGate[opKey(kind, id)];
  if (gate) return opTag(gate.then(send, function () { return null; }), kind, id);
  const p = send();
  return p ? opTag(p, kind, id) : p;
}
function pushRemove(kind, id) {
  const p =
    kind === 'todo' ? api.deleteTodo(id) :
    kind === 'mindmap' ? api.deleteMindmap(id) :
    kind === 'agent' ? api.deleteAgent(id) :
    kind === 'tokenKey' ? api.deleteTokenKey(id) :
    kind === 'capsule' ? api.deleteCapsule(id) : null;
  /* ★ 项目**没有删除接口** —— 需求 FR-2.9 是"只归档不删"，后端刻意不提供 DELETE。
     走不到这里；真走到了返回 null，`queue()` 会识别成"没有请求要发"。 */
  if (p && typeof p.then === 'function') {
    p.__del = true;      // ★ 回滚/刷新回放要知道"这一笔是删除"，不能把行复活
    return opTag(p, kind, id);
  }
  return p;
}
/** 整树保存 —— 后端只有一个入口：`PUT /mindmaps/:id/tree`（严格树校验在那边做） */
function pushTree(mid) {
  const t = state.tree[mid];
  if (!t || !mid) return null;
  return opTag(api.saveTree(mid, t), 'mindmap', mid);
}

/* ---------- 详情记忆的本地持久化（FR-8.4 · §9.4） ----------
 * ★ 全工程唯一需要 `wx.setStorageSync` 的地方，且**只存三个 id** ——
 *   不持久化任何业务数据（业务真值在服务端；两套数据源必然要处理"哪个新"，是自找的复杂度）。
 * ★ mock 下**完全不读写 storage**：否则上一次真机联调留下的记忆会污染核验脚本的起点。
 */
const UI_MEM_KEY = 'ui.memory';

function loadMemory() {
  if (api.useMock()) return;
  let mem = {};
  try { mem = wx.getStorageSync(UI_MEM_KEY) || {}; } catch (e) { mem = {}; }
  state.ui.projectId = validMemory('project', mem.projectId);
  state.ui.todoId = validMemory('todo', mem.todoId);
  state.ui.mindmapId = validMemory('mindmap', mem.mindmapId);
}
/** 记忆里的 id 还在不在 —— 不在就清空该记忆（不弹"资源不存在"的报错，需求要的是这个交互） */
function validMemory(kind, id) {
  if (!id) return '';
  const alive = kind === 'project' ? !!rawProject(id) : (kind === 'todo' ? !!rawTodo(id) : !!rawMindmap(id));
  return alive ? id : '';
}
function saveMemory() {
  if (api.useMock()) return;
  try {
    wx.setStorageSync(UI_MEM_KEY, {
      projectId: state.ui.projectId || '',
      todoId: state.ui.todoId || '',
      mindmapId: state.ui.mindmapId || ''
    });
  } catch (e) { /* 存不下不影响本次会话 */ }
}

/* ---------- 启动：登录 → 快照 → 灌入 ---------- */

/**
 * 启动流程（§9.6 第 2 项）：`wx.login` → `GET /sync` → `hydrate()`。
 *
 * ★★ **失败的处置分两档，由 `api.useFallbackMock()` 决定**（2026-09-30 收尾）：
 *   · `false`（**默认 · 联调 / 上线态**）—— 调 `wipeToEmpty()` 把内存清成**真的空**。
 *     守的是产品口径「**界面上只可能出现数据库里的数据**」：拉不到就空着 ＋ 说清成因，
 *     不许拿 `mock.js` 的演示数据冒充真数据（否则"库是空的"和"根本没连上"
 *     在界面上长得一模一样，部署 / 排障会被带偏）。
 *   · `true`（**老口径**）—— 保持内存里的种子数据不动（"停掉后端也能出图"，README §3.4）。
 * ⚠️ 两档都**不白屏、也不静默**：`ok === false` 一律由 `app.js` 把**成因**弹出来
 *   （文案在 `api.netHint()`，单一真源）。
 * ★ `1002`（不在白名单）是**正常业务结果**，不是故障：如实告诉用户"还没开通"，
 *   同时后端会把 openid 记进待批列表，方便手动加白名单。
 *
 * @returns {Promise<{ok:boolean, mock:boolean, cleared:boolean, code:number, message:string}>}
 *   `mock`    —— 当前显示的**是不是**演示数据（只在回落档为真）
 *   `cleared` —— 本次失败**已把界面清空**（＝没有任何数据可显示）
 */
function boot() {
  if (api.useMock()) return Promise.resolve({ ok: true, mock: true, cleared: false, code: 0, message: '' });
  return api.login().then(function () {
    return api.sync();
  }).then(function (snap) {
    hydrate(snap);
    return { ok: true, mock: false, cleared: false, code: 0, message: '' };
  }, function (e) {
    /* ★ 默认档（`false`）＝ **清空**：界面上只可能出现数据库里的数据 —— 见上面长注释 */
    const fallback = api.useFallbackMock();
    if (!fallback) wipeToEmpty();
    return {
      ok: false,
      mock: !!fallback,                             // 显示的是不是演示数据
      cleared: !fallback,                           // 已清空（没有任何数据可显示）
      code: (e && e.code) || 0,
      message: (e && e.message) || '加载失败',
      /* ★★ 2026-09-30：把"为什么失败"一起带出去 —— 只给 `code` 的话，
         app.js 只能笼统说一句"没连上"；而真机上"域名没校验 / 不在同一网段 /
         后端没起"三种成因的**处置完全不同**（见 `api.netHint`）。
         ⚠️ 这两个字段只用于**提示与日志**，不参与任何业务判断。 */
      kind: (e && e.kind) || '',
      errMsg: (e && e.errMsg) || ''
    };
  });
}

module.exports = {
  state: state,
  TODAY: TODAY,
  /* ⚠️ `stamp()` 落的是**秒**精度（与后端同构）；要显示给用户的一律先过 `atMin()`。 */
  clone: clone, stamp: stamp, dateOf: dateOf, mdShort: mdShort, cnDate: cnDate, atMin: atMin,
  daysUntilReset: daysUntilReset, clip: clip,
  /* ★ 133 轮：重置日只剩「日」—— `daysInMonth` 降为模块内函数（只被 resetAt 用），不再对外导出 */
  resetDayOf: resetDayOf, nextResetDay: nextResetDay,
  joinResetDay: joinResetDay, stepResetDay: stepResetDay,

  colorOf: colorOf, urgencyOf: urgencyOf,
  projectNodes: projectNodes, colorList: colorList, urgencyList: urgencyList,
  heatLegend: heatLegend,
  /* ★ 审查-02 P1-17：「未归属项目」的色点 ／ 它背后那格圆底 —— `colorOf('')` 的空值兜底 */
  noneColor: noneColor, noneSoft: noneSoft,
  /* ★ 审查-02 P2-20：`wx.showModal` 的危险确认色 —— 五处 `'#C63B2E'` 字面量收口到此 */
  danger: danger,

  rawProject: rawProject, projectById: projectById,
  isArchived: isArchived, activeProjects: activeProjects, archivedProjects: archivedProjects,
  projectOfColor: projectOfColor,
  statOfProject: statOfProject, scoreOf: scoreOf, statTotal: statTotal,
  /* ★ 56 轮：项目列表筛选（筛选副弹窗 ＋ 标题栏「筛选」按钮都靠这组）——
     `listProjects(单值)` 已被 `visibleProjects()` 取代（筛选条件升成四条件对象）。 */
  projectFilter: projectFilter, setProjectFilter: setProjectFilter,
  resetProjectFilter: resetProjectFilter, projectFilterCount: projectFilterCount,
  filterProjects: filterProjects, visibleProjects: visibleProjects,
  /* ★ 59 轮：概览的项目卡 ＝ 项目卡（FR-5.2）—— 装配只有一份，抽屉与概览共用 */
  projectCardView: projectCardView, overviewProjectCards: overviewProjectCards,

  rawTodo: rawTodo, todoById: todoById, todosOfProject: todosOfProject,
  projectSummary: projectSummary,
  sortTodos: sortTodos, allTodosSorted: allTodosSorted, openTodoCount: openTodoCount,
  sortTodosByUpdated: sortTodosByUpdated, allTodosByUpdated: allTodosByUpdated,
  /* ★★ 160 轮：逻辑删除 —— 活 / 删两个名单 ＋ 判据。
     ⚠️ `isDeletedTodo` 必须导出：`drawers.js` / `mod-todo.js` / `mod-project.js` 都要问
        "这条是不是已删除的"，而它们**不许**各自去读 `deletedAt`（多一种写法就多一处会漏改）。 */
  isDeletedTodo: isDeletedTodo, aliveTodos: aliveTodos, deletedTodos: deletedTodos,
  /* ★ 47 轮：待办列表筛选（筛选副弹窗 ＋ 标题栏「筛选」按钮都靠这组） */
  todoFilter: todoFilter, setTodoFilter: setTodoFilter, resetTodoFilter: resetTodoFilter,
  todoFilterCount: todoFilterCount, filterTodos: filterTodos,
  visibleTodosByUpdated: visibleTodosByUpdated, dayBack: dayBack,
  /* ★★ 160 轮：状态三档的**唯一真源**（筛选副弹窗的选行读它，不手抄档名）
     ＋ 「按状态取一档」的**唯一实现**（`filterTodos` 与 `drawers.build('todo')` 的 scope 共用） */
  TODO_STATUSES: TODO_STATUSES, todoStatusOptions: todoStatusOptions,
  isTodoStatus: isTodoStatus, pickTodosByStatus: pickTodosByStatus,

  rawMindmap: rawMindmap, mindmapById: mindmapById, mindmapsOfProject: mindmapsOfProject,
  mindmapGroups: mindmapGroups,
  /* ★ 本轮：脑图格式 ＋ 列表筛选 ＋ 列表卡装配（"格式"这一层只有这一处出口） */
  formatKeyOf: formatKeyOf, formatOf: formatOf,
  mindmapFormats: mindmapFormats, mindmapFormatOptions: mindmapFormatOptions,
  mindmapFilter: mindmapFilter, setMindmapFilter: setMindmapFilter,
  resetMindmapFilter: resetMindmapFilter, mindmapFilterCount: mindmapFilterCount,
  filterMindmaps: filterMindmaps,
  sortMindmapsByUpdated: sortMindmapsByUpdated, visibleMindmaps: visibleMindmaps,
  mindmapCardView: mindmapCardView,
  /* ★★ 280 轮：**能不能进画布**的唯一判据 —— 三处入口（脑图列表 / 项目页网格 / 待办详情）
     都调它，别在各处再写一遍 `aiState === 'pending'` 或"缺字段"的条件。 */
  mindmapGateOf: mindmapGateOf,
  /* ★★ 280 轮：「转脑图」选择列表里**能不能被选**（＝能不能进画布） ——
     卡片装配、抽屉的点击闸门、按下「确定」那一帧的复检，三处共用这一个出口。 */
  mindmapPickLock: mindmapPickLock,
  projectAgentId: projectAgentId,

  findNode: findNode, countNodes: countNodes, depthOf: depthOf, ensureTree: ensureTree,

  agentById: agentById, primaryAgent: primaryAgent,
  amountOf: amountOf, quotaLowOf: quotaLowOf, resetInOf: resetInOf,
  /* ★ 157 轮：「距离重置」的图形版 —— 圆环进度角 ＋ 圆心大字（文字版 resetInOf 仍归项目页用） */
  ringOf: ringOf,
  /* ★ 59 轮：agent 卡的装配也只有一份 ——「我的」页 agent 区与概览「Agent 概况」共用。
     `agentQuotaView()`（只服务旧的那张单 agent 额度卡）随卡一起删除。 */
  agentCardViews: agentCardViews, daysSince: daysSince,

  tokenKeyById: tokenKeyById,

  heatWeeks: heatWeeks, heatDay: heatDay, todayCell: todayCell,

  addProject: addProject, updateProject: updateProject,
  archiveProject: archiveProject, unarchiveProject: unarchiveProject,
  /* ★★ 160 轮：`removeTodo` 是软删、`restoreTodo` 是它的对侧 —— 一对，别只导出前一半 */
  addTodo: addTodo, updateTodo: updateTodo,
  removeTodo: removeTodo, restoreTodo: restoreTodo, toggleTodo: toggleTodo,
  addMindmap: addMindmap, renameMindmap: renameMindmap, removeMindmap: removeMindmap,
  updateMindmap: updateMindmap,
  addNode: addNode, removeNode: removeNode, updateNode: updateNode, moveNode: moveNode,
  moveNodeTo: moveNodeTo, relevel: relevel,
  setNodeCollapsed: setNodeCollapsed, setSubtreeCollapsed: setSubtreeCollapsed,
  /* ★ 本轮：编辑历史（撤销/重做）。`seedHist`/`pushHist` 是内部约定，不外抛；
     真正给页面用的只有这四颗 —— 先问 canUndo/canRedo 再动手，按钮才能正确置灰。 */
  canUndo: canUndo, canRedo: canRedo, undo: undo, redo: redo,
  addAgent: addAgent, updateAgent: updateAgent, removeAgent: removeAgent,
  addTokenKey: addTokenKey, updateTokenKey: updateTokenKey, removeTokenKey: removeTokenKey,
  /* ★★ 2026-10-12：Token API 的余额刷新（进「我的」页触发）——
     `TK_REFRESH_MIN_MS` 一并导出：判据脚本要拿它验节流窗口，别在脚本里另抄一个数 */
  refreshTokenKeys: refreshTokenKeys, lastTokenRefreshAt: lastTokenRefreshAt,
  TK_REFRESH_MIN_MS: TK_REFRESH_MIN_MS,
  updateMe: updateMe,

  /* ★ 本轮：闪念胶囊（FR-9）—— 只读的排序出口 ＋ 几个改数据的口子
     ★★ 160 轮：**两个名单 ＋ 两个方向**（`capsules/deletedCapsules` ·
     `removeCapsules/restoreCapsules`），对称着写、对称着读。 */
  capsules: capsules, deletedCapsules: deletedCapsules,
  capsuleById: capsuleById, capsuleCount: capsuleCount,
  addCapsule: addCapsule, updateCapsuleText: updateCapsuleText,
  /* ★★ 263 轮：换图 / 撤图（`updateCapsuleText` 的对称口子） */
  setCapsuleImage: setCapsuleImage,
  removeCapsules: removeCapsules, restoreCapsules: restoreCapsules,
  capsulesToMindmap: capsulesToMindmap, promoteCapsulesToTodo: promoteCapsulesToTodo,
  /* ★★ 280 轮：语义转脑图（受理 ＋ 重试）—— 与上面两条并列的第三条"把胶囊送走"的路 */
  capsulesToMindmapAi: capsulesToMindmapAi, retryMindmapAi: retryMindmapAi,
  refreshMindmapAi: refreshMindmapAi,
  anyMindmapAiPending: anyMindmapAiPending,
  /* ★★ 248 轮：**胶囊 ↔ 待办的关联** —— 三个口子（读一条待办挂了哪些 / 关联 / 解除关联）。
     ⚠️ 必须导出：`mod-todo` 与 `pagebase` 在运行期会直接调，
        漏一个只在用户真的点那一下才炸（静态判据若只查定义不查导出会全绿 —— 
        199 轮 `markTodoSeen` 已经踩过这条，判据 R4 因此专门钉导出表）。 */
  capsulesOfTodo: capsulesOfTodo,
  linkCapsulesToTodo: linkCapsulesToTodo, unlinkCapsulesFromTodo: unlinkCapsulesFromTodo,
  /* ★★ 248 轮：卡片装配的唯一真源（详情页与选择抽屉共用） */
  capsuleCardView: capsuleCardView,
  CAPSULE_HOST: CAPSULE_HOST,

  /* ★★ 199 轮：「刚转过来」提示的两个**清除**口子 ——
     由 `mod-todo.refresh()`（打开详情）与 `mod-mindmap.selectNode()`（选中节点）调用。
     ⚠️ 必须导出：这两个函数住在 store 的模块作用域里，不导出的话组件那两处
        会在运行时报 `store.markTodoSeen is not a function`
        —— 而且**只在用户真的去点的时候**才炸（静态判据全绿也照样漏）。
        判据 `check_fresh_round199.js` 因此专门钉了"导出表里有这两个名字"这一条。 */
  markTodoSeen: markTodoSeen, markNodesSeen: markNodesSeen,
  /* ★★★ 2026-10-27：「完善信息之后它就是普通脑图了」—— 由 `updateMindmap()` 调用，
     把库里那行 `flashAt` 清回 null（卡面颜色另由 `mindmapCardView().fresh` 判）。
     ⚠️ 同 `markTodoSeen` / `markNodesSeen`：**必须导出**，漏了只在用户真去完善时炸。 */
  markMindmapSeen: markMindmapSeen,

  exportMarkdown: exportMarkdown, copyTodoText: copyTodoText,

  memoryOf: memoryOf, setMemory: setMemory, clearMemory: clearMemory,

  /* ★ 本轮：后端接入的出口（技术文档 §9.2 / §9.6）——
     `boot()` 是启动流程唯一入口（登录 → 快照 → 灌入）；**失败按 `api.useFallbackMock()`
     分档**：默认档 ⇒ `wipeToEmpty()`（界面真空）；回落档 ⇒ 保持内存里的种子数据。
     `hydrate()` / `wipeToEmpty()` 是一对（真快照 / 真空态，**共用 `_load()`**）；
     `isLoaded()` / `loadTree()` 给壳页与脑图模块用。
     ⚠️ `USE_MOCK = true` 时它们全是空操作 / 立即 resolve，读数与改造前逐字相同。 */
  boot: boot, hydrate: hydrate, wipeToEmpty: wipeToEmpty,
  /* ★★ 126 轮：主动刷新（主导航点击 / 手机端胶囊下拉）—— 与 `boot()` 的差别见它的注释 */
  refresh: refresh,
  isLoaded: isLoaded, loadTree: loadTree,
  treeReady: treeReady,
  onDataGone: onDataGone,
  /* ★★ 2026-10-24（复审 P2-01）：「整块回滚发生了」的唯一通知口 ——
     壳页订阅它，回滚后把已挂载的视图重画一遍（改前只回内存、界面留着乐观结果）。 */
  onRollback: onRollback, offRollback: offRollback,
  /* ★★ 2026-10-24（复审 P1-02）：给判据与调试用 —— 现在还有几笔写没落地 */
  inflightWrites: inflightWrites
};
