/**
 * 启动动画（品牌开屏）—— 全应用冷启动时铺满一屏的那一段 Canvas 动画
 *
 * ── 来源 ────────────────────────────────────────────────────────────────
 * 设计稿：`设计/Agent-ToDo-启动动画.html`（用户设计，5.2 秒四幕：
 *   01 声波 → 02 脑图 → 03 接住 → 04 Logo）。
 * 本组件是那份设计**逐帧等价**的小程序移植版，不是"照感觉重做"：
 *   · 时间轴、缓动、波形函数、五条枝干的端点表、图标的 SVG 路径 —— 全部逐值搬过来；
 *   · 只有三处**落地性改写**（都是小程序 Canvas 2D 与浏览器的差异，见下）。
 *
 * ── 三处与 HTML 版不同的地方（都不影响画面）─────────────────────────────
 *   ① **不依赖 `Path2D`** —— 小程序 Canvas 2D 不保证有 `Path2D`。
 *      图标那两条路径（`ICON_D` / `CHECK_D`）由 `_tracePath()` 就地解析成
 *      `moveTo/lineTo/bezierCurveTo`（只支持这两条路径用到的 M/L/H/V/C，够用）。
 *   ② **`roundRect` 有兜底** —— 那是较新的 API，老基础库上会静默不画（圆角底板整个消失）。
 *      `_roundRect()` 在 `ctx.roundRect` 缺失时用四段 `arcTo` 画同一个圆角矩形。
 *   ③ **不等字体** —— HTML 版要等 `Brand` 字体（页面上的字标）就绪才起播；
 *      小程序这边的字标是**图片**（`brand-lockup.png` 里就有字），Canvas 里一个字都不写，
 *      所以起播条件只剩"拿到画布"这一条 ⇒ 少等一段、开屏更早。
 *
 * ── Logo 图为什么用现成的那张 ───────────────────────────────────────────
 * HTML 里那张 lockup 是内联 base64（995×301 的定格）；工程里 `assets/brand-lockup.png`
 * （3980×1204，恰好 ×4、宽高比逐位相同、**同一版细线稿**）就是它的高分辨率版本
 * —— 138/178 轮给标题栏升配时已经躺在 assets 里了。⇒ **不新增图片、不内联 base64**，
 * 直接引用它。⚠️ 名字与路径与标题栏、悬浮块**共用同一份**，将来换图三处一起换。
 *
 * ── 幕次文案为什么不锚"屏高"（★ 180 轮修的正是这条）────────────────────
 * 首版把文案写成 `bottom: 12%`（屏高百分比），而动画本身是**按屏幕中线 ＋ 自身尺寸**摆的
 * （半径 98 的黄底板 × scale）—— 一个跟屏高走、一个跟画布走，两者在三种形态下越差越远：
 *      平板横屏 175px ／ 手机竖屏 258px ／ 平板竖屏 **374px**
 * ＝ 同一句"距离动画稍微近一点"，在竖屏平板上差了整整一倍多，屏越高越离谱。
 * ⇒ 180 轮改成**跟着动画自己的下沿走**：`文案顶 ＝ h/2 ＋ 98·scale ＋ CAP_GAP`
 *   （98 ＝ 黄底板的半径，见 `TILE_HALF`；由 `_capTopFor()` 算好后经 style 交给 `.sp-cap`）。
 *   ⚠️ 锚的是**黄底板**下沿、不是组合标下沿：文案只在第 01–03 幕出现，
 *      第 04 幕（组合标淡入，下沿要再低 25·scale）时它已经收成空串，不必为它让位。
 *   ⚠️ 别把这条再改回百分比 —— `check_splash_round180.py` 的 G3 会按公式复算，
 *      要求三形态的距离**恒等于同一个数**（屏高百分比一写进去立刻报红）。
 *
 * ── 收场：动画跑满后要"化掉"，不能"啪"一下换页（★ 180 轮）──────────────
 * 用户口径：「显示完动画后到显示应用页面，这个过程有点僵硬，是否能将动画最后的画面来个淡出」。
 * 这里的关键是**淡出必须画在画布自己身上**，不能只靠容器的 CSS `opacity`：
 * `<canvas type="2d">` 在小程序里可能走同层渲染，**祖先的 opacity/transition 对它不保证生效**
 * （这正是"看着有淡出、实际是硬切"的成因）。所以：
 *   · 画布内容：`_render(t, fade)` 把 `(1-fade)` 折进**每一个** alpha 通道 → 一定淡得掉；
 *   · 容器与画布外那两行字：`.splash.sp-fade{opacity:0}` ＋ 420ms 过渡（在 wxss 里）。
 * 两边**同时起、同时落**（都由 `_play` 的收场状态机推进），合起来才是一次完整的淡出。
 *
 * ── 背景色 ─────────────────────────────────────────────────────────────
 * 用户口径：「启动动画的背景色要和现有的应用背景色一致」。
 * 所以**不用**设计稿里的暖白 `--paper (#f8f7f3)`，而是走工程令牌：
 *   · 平板（横 / 竖）：`--surface` ＝ #F7F8FA —— 与 `.stage` / `.app` 的页底逐值相同；
 *   · 手机：`#FFFFFF` —— 手机端整屏就是白的（`.app.phone` / `.cp.phone` / `.ph` 三处同一条口径，
 *     见 app.wxss 里 106/107 轮那两段注释）。
 *   两档都由 `.splash` / `.splash.sp-phone` 承担，**不覆盖、不新增令牌**。
 *
 * ── 它能盖住谁（z-index 900）────────────────────────────────────────────
 * 全工程最高的 z-index 是 300（诊断浮层），抽屉族 80–98、悬浮块 85、胶囊编辑挡板 96。
 * 开屏必须盖住**全部** ⇒ 取 900。并且它挂在**壳页根节点**下（`.stage-wrap` 的兄弟），
 * 而不是 `.stage` 里面 —— `.stage` 有 `transform`，会让 `position: fixed` 的后代
 * 变成"相对 `.stage` 定位"（那是 108 轮踩过的坑），开屏就会被**画布边界**裁掉、
 * 在画布比屏幕小的机型上露出一圈没盖住的边。
 *
 * ── 出图 / 走查脚本的处置（★ 务必知道这一条）────────────────────────────
 * 它是**全屏不透明**的一层，冷启动后会盖住整个界面 5.2 秒 ⇒ 立刻截图会拍到开屏。
 * 两条出口：
 *   · **轻触任意位置立即跳过**（组件自己监听，不需要调用方配合）；
 *   · 脚本侧可 `getCurrentPages()[0].selectComponent('#splash').skip()` 主动跳过
 *     （与 `#cap` / `#m-*` 同一套「组件用 id 取」的既有做法）。
 * ⚠️ **刻意不做 storage 开关** —— 107 轮删掉「强制方向」那条调试通道时的教训：
 *    全局残留态会让模拟器停在"看起来像产品坏了"的状态上。要跳过就现调 `skip()`。
 *
 * ── 深色模式（★ 186 → 188 → 190 → 191 → 2026-10-16，务必连着读）────────────
 * 开屏是**画在画布上的**，颜色不来自 WXSS ⇒ 它必须自己问主题（`utils/theme`）。
 *
 *   · **186 立的口径**：把画面里的墨分**两类** —— "画在背景上的"（枝干 `_stroke`、
 *     节点圆点 `_dot`）跟主题走；"画在黄底板上的"（`_logoPath` 描的「接住」图标）
 *     **恒墨色**，理由是"底板是品牌黄 `#FFD02F`、黄底白字对比度只剩 1.6:1"。
 *   · **188 订正了第 04 幕那张图**（详见下面那条）：它其实落在**背景**上，不是黄底板。
 *   · **190 曾把"两类"合成一支**（用户口径：「在动画里 logo 中的线条和文字的颜色是
 *     和最开始的声波颜色呼应的，所以应该是进行统一」）—— ★★ **这一条 2026-10-16 已撤回，
 *     见下面那条**。它当时的前提是"组合标在深色下走 `d-brand-lockup.png`、那张图里的
 *     图标**就是柔白**"；2026-10-16 把那个前提改掉了（组合标里的勾改成**恒墨**）
 *     ⇒ 推理链失效，"两类"分法复位。
 *
 *   · ★★★ **2026-10-16（P0 裁决）：`_logoPath` 改回恒墨 —— "两类"分法复位** ★★★
 *     用户口径：「深色模式下底部导航选中后图标应该变浅……（研究后）对比下来还是现状的
 *     可读性比较好，**维持 P0 的配色模式**」⇒ 全应用统一到 P0：**黄面上的笔画恒墨**。
 *     `d-brand-lockup.png` 随 `gen_brand_dark.py` 按**面**分区重做：
 *       左半黄块（含里面那个对勾与抗锯齿过渡）**整块照抄浅色版** ⇒ 恒墨；
 *       右半字标落在透明底上（最终落页底 / 标题栏）⇒ 仍跟主题（深色柔白）。
 *     **连带**：第 03 幕描的正是同一个图标、画在**同一块黄底板**上；而 191 轮的
 *     "两层同色、零闪烁"依赖"描线与第 04 幕组合标里的勾同色" ⇒ 这一笔**必须也是墨**。
 *     两边同为 `INK` ⇒ 191 的前提**照旧成立**。
 *     ⇒ 附带修好一件事：深色下黄底板上的这条线从 **1.25 : 1**（原柔白，等于看不见）
 *       变成 **11.6 : 1**（墨）。
 *     ⚠️ 190 那句"在黑底板/黄底板上黑→白糊一遍"的担心**不再成立** —— 组合标的勾现在就是黑的。
 *     ⚠️ `_stroke` / `_dot` **仍然跟主题**（它们画在**背景**上，不在这块黄底板上）：
 *        这两类是**按"画在哪块面上"分的**，别因为这一笔恒墨就把另外两笔也拉平。
 *
 *   · **第 04 幕淡入的组合标** ⇒ ★★ **188 轮订正**：186 当时判"它压在黄底板上 ⇒
 *     不用换图"，**这条判断是错的**。黄底板的 alpha 是 `tile × (1 - word)`、
 *     组合标是 `word` ⇒ 组合标淡入的同时底板在淡出，**末帧底板已经没了**，
 *     那张图实际落在**背景**上（深色下墨字 ≈1.02:1，整行字消失）。
 *     现在按标题栏同一条路换 `d-brand-lockup.png`（见 `LOCKUP_DARK` 与 `_pickLockup`）。
 *     ⚠️ 它仍是"品牌资产"，所以**只换墨不反色**（`gen_brand_dark.py` 逐像素换墨、
 *        品牌黄不动）—— 与设计稿「用户图片 / 品牌图不机械反色」仍是同一条口径。
 * 背景那两档（`.splash` 走 `--surface`、`.splash.sp-phone` 走 `--bg-phone`）本来就走令牌，
 * 深色自动跟着走；但本组件是 `.stage-wrap` 的**兄弟节点**（拿不到根节点的 `.theme-dark`）
 * ⇒ 由自己挂 `.sp-dark`（与 `app.wxss` 里那句 `.theme-dark, .splash.sp-dark` 合并选择器对接）。
 * ⚠️ 主题切换**不重播动画** —— 只把**当前帧**按新墨色重画一遍（`_render(现值)`），
 *    时间轴与 `_elapsed` 一个字不动（设计稿「切换只改外观、不打断」）。
 *
 * ── ★★ 188 轮补的两条（都在"首帧"上，务必连着读）──────────────────────────
 *   · `INIT_DARK`：`dark` 的初值在**模块求值期**同步探定 ⇒ 首帧就是深色，
 *     不会再"先闪一整屏浅灰"（用户第 6 条；根因见 `INIT_DARK` 那段注释）。
 *   · `LOCKUP_DARK` / `_pickLockup()`：末幕那张图跟着主题换（用户第 5 条）。
 *     ⚠️ 出图脚本（`render_splash_round179|180|182.js`）的桩里**没有 `isDark`**
 *     ⇒ 两个守卫都回落到"浅色基线"，那三条判据拿到的仍是改前的画面。
 */
const stageMod = require('../../utils/stage');
const themeMod = require('../../utils/theme');

/* ======================= 设计常量（与 HTML 逐值同源）======================= */

/* **浅色档的墨** —— 也是"取不到主题服务"时的回落值（`inkOnCanvas()` 的兜底）。
   ★190：全画布**只有这一支墨的概念**，深色档由 `themeMod.splashInk()` 给（＝ `#EEEDEA`）；
     三处笔（`_stroke` / `_dot` / `_logoPath`）都走 `inkOnCanvas()`，**没有第二支**。
     ⚠️ 186 曾把"黄底板上那条描线"钉死在这个常量上 —— 190 已撤销，理由见文件头「深色模式」
        （它会与末幕那张换过墨的组合标**在同一块底板上打架**）。 */
const INK = '#1C1C1E';        // ＝ --primary（设计稿里的 --ink，同值）
const YELLOW = '#FFD02F';     // ＝ --yellow（同值）
const TOTAL = 5200;           // 全长（ms）—— 设计稿「品牌启动动画 / 5.2 秒」
const FADE = 420;             // 收场淡出（ms）—— 画布内的 alpha 与容器的 CSS 过渡共用这一个数
const UNIT = 196 / 240;       // 组合标里"240 高的图标"折成"196 的底板"的比例

/* 幕次文案的纵向落位（★ 180 轮；为什么不能写屏高百分比见文件头）：
     文案顶 ＝ h/2 ＋ TILE_HALF·scale ＋ CAP_GAP                                */
const TILE_HALF = 98;         // 「接住」底板半径 —— 与 _render 里 _roundRect(-98,-98,196,196) 同源
const CAP_GAP = 56;           // 底板下沿 → 文案顶（px）；三形态恒定，与屏高无关
/* 下面四个数是 **`.sp-skip` / `.sp-cap` 在 wxss 里的取值的影子**，只服务于「矮屏兜底」
   （见 `_capTopFor` 的第三条）：手机横屏 844×390 时，"锚动画"算出来的顶边会**压到
   「轻触跳过」身上**（347 ↔ 351）。那行是用户点名"位置不变"的 ⇒ 让步的是文案。
   ⚠️ 改 wxss 那两处要回来改这里（`6%` 已被 `check_splash_round180.py` 的 G2 盯住）。 */
const SKIP_BOTTOM = 0.06;     // ＝ wxss `.sp-skip { bottom: 6% }`
const SKIP_LINE = 18;         // 「轻触跳过」行盒高（12px × ≈1.4 取整）
const CAP_LINE = 21;          // 幕次文案行盒高（14px × wxss 写死的 1.5）
const CAP_CLEAR = 12;         // 两行之间至少留的间隙
/* ⚠️ 下面 `_scaleFor` 里的 `1.1 / 44 / 995 / 340` 四个数**故意不抽成常量** ——
   `check_splash_round179.py` 的 A 组按**字面**把移植式与设计稿的
   `Math.min(1.1, (w-44)/(995*UNIT), h/340)` 逐字对照；抽成符号名等于
   把自己的判据变成假红。（同族：178 轮"文件名即接口"。） */
/* ★ 整体系数 —— **唯一一处"移植之后的产品口径"**（182 轮用户："这个动画有点太大了，
   缩小一些"，并明确"位置和效果没啥问题" ⇒ 只改大小这一件）。
   设计稿那条公式**原样不动**地放在里面，只有这一个乘数落在它外面：
     · `SCALE_K = 1` ⇒ 逐字回到设计稿（179 判据的 A 组正是这么守的）；
     · 它只出现在 `_scaleFor()` 里（＝"视口 → scale"的映射），
       **`_render()` 不认它** ⇒ 画面生成器与设计稿的一致性不因此受损。
   ⚠️ 别把它挪进 `_render`、也别在 `_scaleFor` 之外再乘一次：
      那会让"缩小"变成画面级的改动，179 的逐像素对撞随之失效（判据里两条断言盯着它）。 */
const SCALE_K = 0.8;

/* 五条枝干：根、两个一级节点、四个叶端的端点表（设计稿原值，别动） */
const ROOT = [-58, 0];
const UPPER = [-3, -32];
const LOWER = [-3, 32];
const EDGES = [
  [ROOT, UPPER],
  [UPPER, [65, -62]],
  [UPPER, [82, -15]],
  [ROOT, LOWER],
  [LOWER, [65, 60]]
];
/* 五条枝干展开的先后（让脑图"长出来"而不是整体翻面）—— 设计稿原值 */
const DELAY = [0, 150, 230, 75, 190];

/* 「接住」图标 —— 100×100 空间里的两条路径（外面用 scale(1.96) 放大到 196 的底板）。
   ⚠️ 这两条与 `assets/brand-lockup.png` 里那枚图标是**同一份线稿**：
      第 03 幕先用它描出黑线，第 04 幕再交叉淡入真图 —— 两条不走形才对得上。 */
const ICON_D = 'M53 26H35C28 26 24 30 24 37V66C24 73 28 77 35 77H65C72 77 76 73 76 66V59';
const CHECK_D = 'M43 47L54 58L79 28';

/* 第 04 幕淡入的组合标 —— **两份配色、同一张母版**（★★ 188 轮）：
     · 浅色：`brand-lockup.png`（黄底图标 ＋ **墨色**字标）；
     · 深色：`d-brand-lockup.png`（`工具/gen_brand_dark.py` 逐像素换墨、品牌黄不动）。
   ⚠️ 与让位段里那张**同一份资产、同一个变换**（`components/brand-head/brand-head.wxml`
      也是 `{{!dark}}` 切这两个 `src`）—— 用户 188 第 5 条的原话就是"参照应用标题栏
      左侧 logo 横图的变换方式变换"。
      ★ 204 轮：那张图跟着"标题栏"一起从壳页搬进了 `components/brand-head`
      （标题栏撤掉、logo 进滚动内容），**这份资产与切图规则一个字没变** ——
      所以上面这条口径仍然成立，只是锚点从 `shell.wxml` 换成了 brand-head。
   ⚠️ 路径写在这两个常量里（不再内联在 `_init`），但**字面量本身不许改**：
      `check_splash_round179.py` 的 C4 按 `'/assets/brand-lockup.png'` 这个字面找它。 */
const LOCKUP_LIGHT = '/assets/brand-lockup.png';
const LOCKUP_DARK = '/assets/d-brand-lockup.png';
/* ★★ 2026-10-24（复审 P3-02）：**另一张主题的组合标延后多久再开始解码**（ms）。
   两张源图各 3980×1204（RGBA 解码约 18.3 MiB），同时预载会把冷启动的内存峰值推到
   36.6 MiB 左右，而真正要画的只有当前主题那一张。900ms 足够避开首帧与开场解码高峰，
   又远早于末幕（4.3s）—— 那 5 秒里万一用户切了主题，第二张也已经就位。 */
const SPLIT_LOCKUP_DELAY = 900;

/* ======================= 缓动 / 波形（与设计逐值同源）======================= */

function clamp01(v) { return Math.min(1, Math.max(0, v)); }
function smooth(v) { v = clamp01(v); return v * v * (3 - 2 * v); }
/** 某一段的进度 0→1（设计稿里的 `stage(t,a,b)`） */
function ramp(t, a, b) { return smooth((t - a) / (b - a)); }
function mix(a, b, v) { return a + (b - a) * v; }

/**
 * 相位积分 —— 承载波形的那个"包"在 1150ms 处减速到停。
 * ⚠️ 直接线性推进相位的话，第 01 幕收尾会"啪"一下顿住；这条把速度积到零。
 */
function signalTime(t) {
  if (t <= 1150) return t;
  const u = clamp01((t - 1150) / 400);
  return 1150 + 400 * (u - u * u * u + 0.5 * u * u * u * u);
}

/** 声波本身：x 处的振幅。edge ＝ 两端收口，packet ＝ 一个向右跑的波包 */
function wave(x, t) {
  const time = signalTime(t), phase = x * 0.092 - time * 0.0076;
  const edge = Math.pow(Math.sin(Math.PI * clamp01((x + 142) / 284)), 1.3);
  const packet = 0.52 + 0.48 * Math.exp(-Math.pow((x - (-120 + time * 0.17)) / 88, 2));
  return edge * packet * (40 * Math.sin(phase) + 7 * Math.sin(phase * 1.8 + 0.65));
}

/* 幕次文案 —— **逐字取自设计稿**（`labels=[…]`），★ 句末**不带句号**：
   四句里的逗号（「让片段，重新拥有关系」）留着，句末的「。」一律不写。 */
const LABELS = ['先说出来', '让片段，重新拥有关系', '把想法稳稳接住', ''];

/* ======================= 取色（★ 186 / 190 深色模式）======================= */

/**
 * **整条动画唯一的墨色** —— 三处笔共用：枝干 `_stroke`、节点圆点 `_dot`、
 * 以及黄底板上那条「接住」描线 `_logoPath`（★190 合并，理由见文件头「深色模式」）。
 * 深色 ⇒ `themeMod.splashInk()`（柔白 `#EEEDEA`，与末幕组合标、标题栏 logo 同一支）；
 * 浅色 / 取不到 ⇒ `INK`。
 * ⚠️ 为什么要包一层而不是直接 `themeMod.splashInk()`：`工具/render_splash_round179|180|182.js`
 *    把本文件注入无头页时，宿主桩的 `require()` **一律返回同一个假对象**
 *    （里面只有 `phone`，没有 `splashInk`）⇒ 直接调就是 `TypeError`、整帧画不出来。
 *    取不到就回落 `INK` ⇒ 那三条出图判据拿到的仍是**浅色基线**（与改前逐像素相同）。
 *    （同族做法：`utils/mindmap-core.js` 的 `linkC()` —— 上线拿主题色、判据拿浅色基线。）
 */
function inkOnCanvas() {
  try {
    if (themeMod && typeof themeMod.splashInk === 'function') return themeMod.splashInk();
  } catch (e) { /* 无头桩 / 旧宿主：回落墨色 */ }
  return INK;
}

/**
 * ★188 当前主题是不是深色 —— 与 `inkOnCanvas()` **同一个"守卫式取色"**的理由：
 *   `工具/render_splash_round179|180|182.js` 把本文件注入无头页时，宿主桩的 `require()`
 *   一律返回同一个假对象（里面只有 `phone` / `readViewport`，没有 `isDark`）
 *   ⇒ 直接调 `themeMod.isDark()` 就是 `TypeError`、整个组件定义都挂掉。
 *   取不到 ⇒ 假（浅色基线）⇒ 那三条出图判据拿到的仍是**浅色画面**。
 */
function isDarkNow() {
  try {
    if (themeMod && typeof themeMod.isDark === 'function') return !!themeMod.isDark();
  } catch (e) { /* 无头桩 / 旧宿主：回落浅色 */ }
  return false;
}

/**
 * ★★ 188 轮 · **首次渲染**就该用的主题。
 *
 * ── 它在修什么（用户 188 年第 6 条）────────────────────────────────────
 * 用户原话：「深色模式下启动应用，**在启动动画开始前会先全屏亮一下**」。
 * 根因：`data.dark` 的初值是写死的 `false`，真值要等 `attached` 里 `setData` 才补上，
 * 而 **`attached` 在首次渲染之后才跑** ⇒ 中间至少有一帧走的是**浅色令牌**
 * （`.splash` 的 `background: var(--surface)` ＝ 浅色 #F7F8FA）。
 * 本组件是**全屏不透明**的一层（z-index 900、`position: fixed` 四边为 0）
 * ⇒ 那一帧就是用户看到的那一整屏浅灰：先亮一下，再变深，才开始画动画。
 *
 * ── 做法（与 `pages/shell/shell.js` 的 `INIT_DARK` 逐字同源）────────────
 * 在**模块求值期**同步探一次。`theme.current()` 读的是宿主主题、本来就是同步的
 * ⇒ 组件的第一帧就已经是深色，**不存在"先画浅色、再切深色"的那一帧**
 * （这正是 186 设计方案 §6.2 的硬要求；186 时**壳页守住了、开屏没守住**）。
 *
 * ⚠️ 必须在 `require('../../utils/theme')` **之后**求值：模块顶部的 `const themeMod`
 *   在它之前处于 TDZ，而 `isDarkNow()` 里的 `try/catch` 会把那个 ReferenceError
 *   一起吞掉 ⇒ 静默回落成浅色（＝ 白修）。
 * ⚠️ 别把它挪进 `attached` —— 那正是本条要根除的那一帧。
 */
const INIT_DARK = isDarkNow();

Component({

  options: { styleIsolation: 'apply-shared' },

  properties: {},

  data: {
    /* 手机端整屏是白的（见文件头「背景色」），平板端走 --surface */
    phone: false,
    caption: LABELS[0],
    /* 幕次文案的**顶边**（px）—— 由 `_capTopFor()` 现算，见文件头「文案为什么不锚屏高」。
       0 ＝ 还没算出来（attached 之前）：这时 wxml 不画这行字，免得它先闪在错的位置上。 */
    capTop: 0,
    fading: false,
    gone: false,
    /* ★186 深色开关 —— 只用来在根节点挂 `.sp-dark`（拿深色令牌表）。
       画面里的颜色**不读它**：画布每次绘制现问 `themeMod.splashInk()`。
       ★★ 188：初值**不再是字面 `false`**，而是模块求值期同步探到的那个值
       （`INIT_DARK`）—— 否则首帧是浅色，深色下冷启动会先闪一整屏浅灰，
       见 `INIT_DARK` 那段注释（用户 188 第 6 条）。 */
    dark: INIT_DARK
  },

  lifetimes: {
    attached: function () {
      /* 先把文案位置按**视口**估一份 —— 画布还没量到（要等 ready），但文案是从第一帧
         就在的，不能等。`_init` 量到画布真实尺寸后会再写一次（同一条公式、同一个函数）。 */
      const vp = stageMod.readViewport();
      const s = this._scaleFor(vp.w, vp.h);
      this.setData({
        phone: stageMod.phone(vp),
        capTop: this._capTopFor(vp.h, s),
        /* ★188：走 `isDarkNow()`（守卫式）而不是裸 `themeMod.isDark()` ——
           与 `INIT_DARK` 取的是同一个函数，语义只有一处；且出图脚本的桩里没有 `isDark`
           时它会回落浅色而不是抛错（那个桩**不会**跑到这里，但保持同族）。 */
        dark: isDarkNow()
      });
      /* ★186 订阅主题 —— 开屏最长只活 5.2s，但在"冷启动那一瞬恰好跨过主题切换"时
         仍可能撞上（用户在系统里切完深色立刻点开小程序）。回调引用挂在 `this` 上，
         `detached` 要能原样摘掉（不能写成匿名函数）。 */
      this._onTheme = this._themeChanged.bind(this);
      themeMod.subscribe(this._onTheme);
    },
    /* ready（不是 attached）：要等节点真的排过版，createSelectorQuery 才量得到画布尺寸 */
    ready: function () { this._boot(); },
    detached: function () {
      if (this._onTheme) themeMod.unsubscribe(this._onTheme);
      this._stop();
      if (this._timer0) clearTimeout(this._timer0);
      if (this._timer) clearTimeout(this._timer);
    }
  },

  methods: {

    /* ---------------------------------------------------------------- 主题 */

    /**
     * ★186 主题变了 —— **只做两件事，绝不重播**：
     *   ① 更新 `dark` ⇒ wxml 给根节点换 `.sp-dark`（背景令牌跟着换）；
     *   ② 把**当前帧**按新墨色 / 新组合标重画一遍（`_elapsed` / `_fade` 原样带过去）。
     * ⚠️ 画布还没起来（`ready` 之前 / 已收场）⇒ 只做 ①：
     *    那时没有 `_ctx`，也没什么可重画的；起播时会现读 `splashInk()`，天然是新的。
     * ★188：重画这件事交给 `_pickLockup()`（它会顺手把组合标换成当前主题该用的那张）。
     */
    _themeChanged: function () {
      const dark = isDarkNow();
      if (dark !== this.data.dark) this.setData({ dark: dark });
      this._pickLockup();
    },

    /**
     * ★188 选出当前该画哪一张组合标 —— 深色取 `d-brand-lockup.png`，其余取浅色那张。
     *
     * ⚠️⚠️ 为什么第 04 幕**必须**换图（这是对 186 一句判断的订正，务必读完）──────
     *   186 写的是"第 04 幕的组合标画在**黄底板**上 ⇒ 深色下不用换图"。
     *   把时间轴摊开看就知道这条不成立：
     *     黄底板的 alpha ＝ `tile × (1 - word)`，组合标的 alpha ＝ `word`
     *   ⇒ **组合标淡入的同时，黄底板正在淡出**；末帧（`word`→1）时底板**已经完全没了**。
     *   也就是说末幕那张组合标实际落在**背景**上：
     *     浅色下背景 #F7F8FA ⇒ 墨色字标读得出；
     *     深色下背景 #18191B ⇒ 墨色字标对比度 ≈ **1.02:1**，整行字等于消失，
     *     只剩一个孤零零的黄方块 —— 正是用户 188 第 5 条看到的现象。
     *   ⇒ 与标题栏同一条处置：换 `d-brand-lockup.png`（用户点名的参照物）。
     *
     * ⚠️ `this._lockup` 这个字段名**不能改**：`工具/render_splash_round179|180|182.js`
     *   与 179 判据的 C6 都按它取值（那边**只设 `_lockup`**，走的是浅色基线路径）。
     *    这里让 `_pickLockup()` 负责把它指向正确的那一张，`_render` 一个字不改。
     */
    _pickLockup: function () {
      const want = isDarkNow() ? this._lockupDark : this._lockupLight;
      /* 想要的那张还没就绪 / 加载失败 ⇒ 退回浅色那张：宁可"墨色画在炭底上"
         （读不清但形状在），也不要末幕空一帧。⚠️ 这只覆盖"图还没到位"的极短窗口。 */
      this._lockup = want || this._lockupLight || null;
      /* ⚠️ 只有画布起来了才谈得上重画 —— 没起来时起播会现取，不必在这里补 */
      if (this._ctx) this._render(this._elapsed || 0, this._fade || 0);
    },

    /* ---------------------------------------------------------------- 几何 */

    /** 缩放 —— 与设计稿同一条公式：宽留 44 的呼吸、高按 340 兜底、上限 1.1；再乘 `SCALE_K`。
     *  设计值（`SCALE_K=1`）：手机竖屏（≈390×844）由**宽**顶死 ⇒ 0.43、
     *  平板横屏由上限顶死 ⇒ 1.1、平板竖屏由宽顶死 ⇒ 0.93。
     *  现取 `SCALE_K = 0.8` ⇒ 三形态同比缩到 **0.34 / 0.88 / 0.74**（比例关系不变）。 */
    _scaleFor: function (w, h) {
      return Math.min(1.1, (w - 44) / (995 * UNIT), h / 340) * SCALE_K;
    },

    /** 幕次文案的顶边 —— 屏幕中线 ＋ 黄底板下沿 ＋ 固定间距（见文件头「为什么不锚屏高」）。
     *  ★ 只用 h 与 scale 两个量 ⇒ 同一条公式下，**任何屏宽/屏高得到的距离都相同**。
     *  ★ 再夹一条「别压到轻触跳过」：正常形态（平板横/竖、手机竖）那条 `limit` 永远够宽，
     *    是个恒等变换；只有矮屏（手机横屏 844×390）才咬得住。
     *  ⚠️ 表达式**写成一整条、不留局部变量** —— 判据会把它整段抠出来、在若干视口上求值
     *    （G5 要求"到动画下沿的距离恒定"）；中间插一层 `const want = …` 会让它读不到。 */
    _capTopFor: function (h, scale) {
      return Math.round(Math.min(h / 2 + TILE_HALF * scale + CAP_GAP,
                                 h * (1 - SKIP_BOTTOM) - SKIP_LINE - CAP_LINE - CAP_CLEAR));
    },

    /* ---------------------------------------------------------------- 起播 */

    _boot: function (tries) {
      const self = this;
      const left = (tries === undefined) ? 2 : tries;
      this.createSelectorQuery()
        .select('#sp-canvas')
        .fields({ node: true, size: true })
        .exec(function (res) {
          /* 已经被跳过 / 已经摘层 ⇒ 别再起播（`detached` 之后节点也没了） */
          if (self.data.gone || self._fading) return;
          const info = res && res[0];
          if (info && info.node && info.width && info.height) { self._init(info); return; }
          /* 节点还没排过版 / 量出来是 0 ⇒ **重试一次**再放弃。
             （个别基础库上 `ready` 会早于 fixed 节点的首次布局。） */
          if (left > 0) { self._timer0 = setTimeout(function () { self._boot(left - 1); }, 120); return; }
          /* 真拿不到画布 ⇒ **直接收场**。开屏是装饰，
             绝不能因为它把用户卡在一个永远不动的封面上。 */
          self._kill();
        });
    },

    _init: function (info) {
      const self = this;
      if (this.data.gone || this._fading) return;
      const canvas = info.node;
      const w = info.width, h = info.height;
      /* DPR 上限 2 —— 与设计稿 `Math.min(devicePixelRatio, 2)` 同一条口径：
         开屏是全屏画布，@3x 的 390×844 会到 1170×2532（≈3M 像素），
         每帧重绘这个尺寸纯属浪费，而这条动画全是细笔画、2 倍已经足够干净。 */
      const win = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
      const dpr = Math.min(win.pixelRatio || 1, 2);

      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);

      this._canvas = canvas;
      this._ctx = canvas.getContext('2d');
      this._w = w;
      this._h = h;
      this._dpr = dpr;
      this._scale = this._scaleFor(w, h);

      /* 文案位置：用**量到的画布**再算一次（attached 里那份是按视口估的，
         通常逐值相同；不同就以后者为准 —— 几何的真源是画布本身，不是视口）。 */
      const capTop = this._capTopFor(h, this._scale);
      if (capTop !== this.data.capTop) this.setData({ capTop: capTop });

      /* Logo 图 —— 局部资源、同步性很好；它到第 4.3 秒才用得上，
         所以**不等它**就起播（缺了也只是末帧少一张图，见 _render 的守卫）。
         ★★ 188：浅 / 深两张都要预载（哪怕当前用不上另一张）——
           开屏最长只活 5.2s，但"冷启动那一瞬恰好跨过主题切换"是可能发生的；
           那一刻若现去加载，末幕会空一帧。当前该画哪张由 `_pickLockup()` 决定。
         ★★ 2026-10-24（复审 P3-02 · 部分采纳）：**先载当前主题那一张，另一张延后 900ms**。
           ── 为什么要动：两张源图都是 **3980×1204**，单张 RGBA 解码约 **18.3 MiB**，
              同时预载 ⇒ 冷启动峰值 ≈ **36.6 MiB**（还不含 canvas 与重复副本）。
              而真正被画出来的只有**当前主题**那一张，另一张是为"5 秒内切主题"买的保险。
           ── 现在：当前主题那张立刻载（末幕要它），另一张在 900ms 后补 —— 仍早于 4.3s
              的末幕，保险还在，只是不再和首帧抢内存。
           ⚠️ 顺序不能反成"另一张永远不载"：`_pickLockup()` 在主题切换时要能立刻拿到它。
           ⚠️ 900 这个数不是随手取的：它要长到能避开首帧与四幕开头的解码高峰，
              又要短到"用户在第 2 秒切主题"时那张图已经就位。 */
      const imgL = canvas.createImage();
      imgL.onload = function () { self._lockupLight = imgL; self._pickLockup(); };
      imgL.onerror = function () { self._lockupLight = null; self._pickLockup(); };

      const imgD = canvas.createImage();
      imgD.onload = function () { self._lockupDark = imgD; self._pickLockup(); };
      imgD.onerror = function () { self._lockupDark = null; self._pickLockup(); };

      const loadL = function () { imgL.src = LOCKUP_LIGHT; };
      const loadD = function () { imgD.src = LOCKUP_DARK; };
      if (isDarkNow()) {
        loadD();
        setTimeout(loadL, SPLIT_LOCKUP_DELAY);
      } else {
        loadL();
        setTimeout(loadD, SPLIT_LOCKUP_DELAY);
      }

      this._elapsed = 0;
      this._fade = 0;
      this._play();
    },

    /**
     * 主循环 —— 两条时间轴，**互斥推进**（★ 180 轮收场状态机）：
     *   · 正常：`_elapsed` 从 0 推到 TOTAL（＝四幕），到了才开始推 `_fade`；
     *   · 跳过：`_elapsed` **就地冻结**在当刻（画面定格），只有 `_fade` 在推。
     * ⇒ 收场只有一处实现：`_fade` 0→1 的这 FADE 毫秒里，
     *   画布内按 `1-_fade` 化掉（`_render` 的第二个参数）、画布外的字与容器按 CSS 化掉。
     * ⚠️ 收场段**不能**停掉 raf 再交给 CSS —— 万一容器 opacity 管不到 canvas（同层渲染），
     *    画面就会"停住不动、然后啪一下消失"，正是用户说的"僵硬"。
     */
    _play: function () {
      if (this._playing) return;
      const self = this;
      this._playing = true;
      this._last = 0;
      this._fade = 0;

      const step = function (now) {
        if (!self._playing) return;
        if (!self._last) self._last = now;             // 首帧只对齐基准，不推进
        const dt = Math.max(0, now - self._last);
        self._last = now;

        if (self._fading) {
          self._fade = Math.min(1, self._fade + dt / FADE);
        } else {
          self._elapsed = Math.min(TOTAL, self._elapsed + dt);
          if (self._elapsed >= TOTAL) self._beginFade();   // 四幕跑满 ⇒ 起淡出
        }

        self._render(self._elapsed, self._fade);
        self._captionFor(self._elapsed);

        if (self._fade >= 1) { self._playing = false; self.setData({ gone: true }); return; }
        self._raf = self._canvas.requestAnimationFrame(step);
      };

      this._raf = this._canvas.requestAnimationFrame(step);
    },

    _stop: function () {
      this._playing = false;
      if (this._raf && this._canvas && this._canvas.cancelAnimationFrame) {
        this._canvas.cancelAnimationFrame(this._raf);
      }
      this._raf = 0;
    },

    /** 起收场：**只置状态**，剩下的交给主循环（画布在跑时）。
     *  两件事一起发生 —— 容器 `fading`（CSS 420ms）＋ 主循环里的 `_fade`（画布内 420ms）。 */
    _beginFade: function () {
      if (this._fading) return;
      this._fading = true;
      this.setData({ fading: true });
    },

    /** 画布没起来的收场路径（还没 ready 就被点掉）：只有 DOM 层，退化成一个 CSS 淡出 */
    _finish: function () {
      if (this._fading) return;
      const self = this;
      this._beginFade();
      this._timer = setTimeout(function () { self.setData({ gone: true }); }, FADE);
    },

    /** 未起播就失败的兜底 —— 直接摘掉，不淡出 */
    _kill: function () {
      this._stop();
      this.setData({ gone: true });
    },

    /** 公开出口：**跳过开屏**（轻触 / 脚本调用） */
    skip: function () {
      if (this.data.gone || this._fading) return;
      /* 画布在跑 ⇒ 让主循环把"画面定格 + 淡出"推完（唯一一条收场实现，别在别处再写一遍） */
      if (this._playing) { this._beginFade(); return; }
      /* 还没起播（量画布的重试窗口内）⇒ 没有画布可淡，只有容器 */
      this._finish();
    },

    _onTap: function () { this.skip(); },

    _captionFor: function (t) {
      const i = t < 1250 ? 0 : (t < 2900 ? 1 : (t < 4160 ? 2 : 3));
      if (LABELS[i] !== this._data_cap) {
        this._data_cap = LABELS[i];
        this.setData({ caption: LABELS[i] });
      }
    },

    /* ---------------------------------------------------------------- 绘制 */

    /**
     * 画一帧。
     * @param t    动画时刻（ms，0…TOTAL）
     * @param fade 收场进度（0…1，缺省 0）—— **整个画面的 alpha 总闸**：
     *             `k = 1 - fade` 折进下面**每一个** alpha 通道（枝干 / 节点 / 黄底板 /
     *             图标描线 / 组合标）⇒ 到 fade=1 时画布上一个墨点都不剩。
     *             ⚠️ 新增任何画东西的语句都要乘上 k，否则它会"淡不掉"、在收场里留在屏上。
     *             ⚠️ fade=0（默认）时输出与 179 轮的移植版**逐像素相同** ——
     *                两条对照帧（`render_splash_round180.js` 的 A/B）就是靠这个前提才可比。
     */
    _render: function (t, fade) {
      const ctx = this._ctx;
      if (!ctx) return;
      const k = 1 - clamp01(fade || 0);
      const w = this._w, h = this._h, dpr = this._dpr, scale = this._scale;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, w * dpr, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const finish = ramp(t, 3950, 4750), capture = ramp(t, 2900, 3650);
      const settle = ramp(t, 1250, 1740), appear = ramp(t, 0, 230);

      /* 组合标落位：图标先停在正中，末幕整体左移半个字标宽 ⇒ 收在"图＋字"的居中位上 */
      const logoX = mix(w / 2, w / 2 - (497.5 - 150) * UNIT * scale, finish);
      const cy = h / 2;
      const word = ramp(t, 4320, 4950);
      /* ★191「让位」曲线 —— 第 03 幕的「黄板 ＋ 描线」**在 `word` 跑完之后**才退场。
         为什么**不跟** `word` 对淡：交叉那 630ms 里"半透明的黄板"会垫在"半透明的描线"
         下面 ⇒ 线色被压暗并黄化（`工具/probe_lockup_align.py` 实测 t=4600：
         深色 `#DAD4BA` ／ 浅色 `#534C35`，而两端静帧都是纯色）—— 就是用户说的
         "图标中的线条……好像更换过颜色 / 闪烁"。
         为什么**不能干脆不退**：它会和第 04 幕那张图**叠成两层不透明的墨** ⇒ 收场淡出时
         图标区比字标区"实一倍"（`check_splash_round180.py` 的 F8「墨量比 ≡ 1 − fade」
         就是这么抓出来的：fade=50% 时量到 0.6428 ≠ 0.5）。
         ⇒ 退场点放在 `TOTAL` 前 220ms：那时 `word` 已 ≡ 1、组合标**完全不透明**，
            底下这一层退掉**一个像素都看不出来**；而末帧只剩组合标一层，墨量回到线性。 */
      const handoff = ramp(t, TOTAL - 220, TOTAL);

      ctx.translate(logoX, cy);
      ctx.scale(scale, scale);

      /* ---- 第 01–02 幕：声波settle → 五条枝干展开成两层脑图 ---- */
      const shrink = 1 - 0.93 * capture;
      ctx.save();
      ctx.scale(shrink, shrink);
      ctx.translate(0, 14 * capture);

      const treeAlpha = appear * (1 - ramp(t, 3480, 3700)) * k;
      for (let j = 0; j < 5; j++) {
        const start = EDGES[j][0], end = EDGES[j][1];
        const delay = DELAY[j];
        const unfold = ramp(t, 1640 + delay, 2340 + delay);
        const pts = [];
        for (let kk = 0; kk <= 64; kk++) {
          const u = kk / 64, x = -142 + (j + u) * 284 / 5, v = smooth(u);
          const tx = mix(start[0], end[0], u), ty = mix(start[1], end[1], v);
          pts.push([mix(x, tx, unfold), mix(wave(x, t) * (1 - settle), ty, unfold)]);
        }
        this._stroke(pts, mix(5.5, 6.5, unfold), treeAlpha);
        /* 节点长在**正在跑的笔画尖端**上，而不是"未来的目标位"——这一条是设计的关键之一 */
        const tip = pts[pts.length - 1];
        this._dot(tip[0], tip[1], mix(2, 5.5, unfold),
          ramp(t, 2030 + delay, 2380 + delay) * treeAlpha);
      }
      this._dot(ROOT[0], ROOT[1], 7, ramp(t, 2310, 2570) * treeAlpha);
      ctx.restore();

      /* ---- 第 03 幕：黄底板升起 ＋ 描出「接住」图标 ----
         ★★191 用户第 2 条：「图标中的线条……好像播放动画的过程中更换过颜色，
         颜色没有统一，导致会出现图标中的线条闪烁」。
         根因（实测，不是推理）：这块原来乘 `(1 - word)`，与第 04 幕的 `word` **对淡**。
         交叉的那 630ms 里，"半透明的黄板"垫在"半透明的描线"下面，
         线色被**压暗并黄化** —— `工具/probe_lockup_align.py` 在 t=4600 量到
         深色 `#DAD4BA` ／ 浅色 `#534C35`，而两端的静帧都是纯色（`#EEEDEA` / `#1C1C1E`）。
         肉眼就是"线条闪了一下"。
         ⇒ 改法：第 03 幕的「黄板 ＋ 描线」在**交叉期全程不透明**（只乘收场闸 `k` 与
            上面那条「让位」曲线 `(1 - handoff)`，`handoff` 在 `word` 跑完前恒为 0），
            由第 04 幕那张组合标**直接盖上去**。两层**同色 ＋ 同位置** ⇒
            交叉期线色恒为那一支墨（`word·墨 ＋ (1−word)·墨 ≡ 墨`）。零闪烁。
         ⚠️ 这条修法**依赖"真的重合"**，别当成理所当然：
            `工具/probe_lockup_align.py` 实测组合标里的黄块换算回画布坐标系是
            **中心 (0.48, −1.27)、196.00×196.00**（＝ 这里的 `_roundRect(-98,-98,196,196)`），
            图标内线条色两边同为 **`#1C1C1E`（两个主题都是墨）**
            ← 2026-10-16 P0 后：组合标里的勾恒墨（`gen_brand_dark.py` 按面分区），
              第 03 幕这条描线也跟着恒墨 ⇒ 两笔同色，"零闪烁"依旧成立。
            **动了任一边的尺寸 / 位置 / 圆角，这条前提就失效**（会露出双层边）。 */
      const tile = ramp(t, 3400, 4030), outline = ramp(t, 2900, 3460), check = ramp(t, 3650, 4160);
      if (tile > 0) {
        ctx.globalAlpha = tile * (1 - handoff) * k;
        ctx.fillStyle = YELLOW;
        this._roundRect(-98, -98, 196, 196, 48.02);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.save();
      ctx.translate(-98, -98);
      ctx.scale(1.96, 1.96);
      ctx.globalAlpha = (1 - handoff) * k;
      if (outline > 0) this._logoPath(ICON_D, outline, 7.8);
      if (check > 0) this._logoPath(CHECK_D, check * 0.29, 7.8);
      ctx.restore();

      /* ---- 第 04 幕：淡入真·组合标（画在黄底板之上，压住刚才的描线）----
         ★191：它现在是唯一的"交叉方"（第 03 幕不再对淡）⇒ 真正在变的只有右侧那行字标；
         左侧图标部分与底层逐像素重合且同色 ⇒ 那段过渡里图标**一个像素都不变**。 */
      if (word > 0 && this._lockup) {
        ctx.globalAlpha = word * k;
        ctx.drawImage(this._lockup, -150 * UNIT, -150 * UNIT, 995 * UNIT, 301 * UNIT);
        ctx.globalAlpha = 1;
      }
    },

    /** 一笔折线（脑图的枝干） */
    _stroke: function (points, width, alpha) {
      const ctx = this._ctx;
      if (!ctx || alpha <= 0) return;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      /* ★186 / ★190 枝干是画布上的笔 ⇒ 走"整条动画那一支墨"（深色下转柔白） */
      ctx.strokeStyle = inkOnCanvas();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        if (i) ctx.lineTo(p[0], p[1]); else ctx.moveTo(p[0], p[1]);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    },

    /** 一枚节点圆点 */
    _dot: function (x, y, r, alpha) {
      const ctx = this._ctx;
      if (!ctx || alpha <= 0 || r <= 0) return;
      ctx.globalAlpha = alpha;
      /* ★186 / ★190 节点圆点同样画在画布上 ⇒ 跟 `_stroke` 取同一个色 */
      ctx.fillStyle = inkOnCanvas();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    },

    /**
     * 把一条路径**从 0 长到全长** —— 手法是虚线：dash 长度 ＝ amount × 220，
     * 剩下留一段足够长的实线（1000）当间隙，视觉上就是"笔画在生长"。
     * ⚠️ 220 是给这两条路径（实测全长都 < 220）留的余量；换成更长的路径要跟着调。
     */
    _logoPath: function (d, amount, width) {
      const ctx = this._ctx;
      if (!ctx || amount <= 0) return;
      ctx.lineWidth = width;
      /* ★★★ 2026-10-16（P0 裁决）：**改回恒墨** —— 这一笔描在**品牌黄底板**上
         （第 03 幕的 `_roundRect(-98,-98,196,196)`），按 P0「黄面上的笔画恒墨」就该是 `INK`。
         190 曾把它改成跟主题（`inkOnCanvas()`，深色柔白），当时的前提是"第 04 幕组合标里
         同一个勾是柔白"；2026-10-16 `gen_brand_dark.py` 改成**按面分区**（黄块区整块照抄）
         ⇒ 组合标里的勾**已是墨** ⇒ 这一笔跟着回墨，191 轮"两层同色、零闪烁"的前提**照旧成立**
         （两边都 `INK`）。附带把深色下这条线的对比度从 1.25:1 修成 11.6:1。
         ⚠️ 别顺手把 `_stroke` / `_dot` 也改成 `INK` —— 那两笔画在**背景**上，必须跟主题。
         详见文件头「深色模式（★ 186 → 188 → 190 → 191 → 2026-10-16）」。 */
      ctx.strokeStyle = INK;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      this._tracePath(d);
      if (typeof ctx.setLineDash === 'function') {
        ctx.setLineDash([amount * 220, 1000]);
        ctx.lineDashOffset = 0;
      }
      ctx.stroke();
      if (typeof ctx.setLineDash === 'function') ctx.setLineDash([]);
    },

    /**
     * 极小的 SVG 路径执行器 —— **只支持 M / L / H / V / C 且只支持绝对坐标**。
     * 上面两条路径正好只用这五个命令；要拿它跑别的路径，先确认命令集。
     * （为什么不用 `Path2D`：小程序 Canvas 2D 不保证有它，缺了就是整段静默不画。）
     */
    _tracePath: function (d) {
      const ctx = this._ctx;
      const re = /([MLHVC])\s*([-0-9.,\s]*)/g;
      let m, cx = 0, cy = 0, i;
      while ((m = re.exec(d))) {
        const n = (m[2].match(/-?\d*\.?\d+/g) || []).map(Number);
        switch (m[1]) {
          case 'M':
            ctx.moveTo(n[0], n[1]); cx = n[0]; cy = n[1]; break;
          case 'L':
            for (i = 0; i + 1 < n.length; i += 2) { ctx.lineTo(n[i], n[i + 1]); cx = n[i]; cy = n[i + 1]; } break;
          case 'H':
            for (i = 0; i < n.length; i++) { ctx.lineTo(n[i], cy); cx = n[i]; } break;
          case 'V':
            for (i = 0; i < n.length; i++) { ctx.lineTo(cx, n[i]); cy = n[i]; } break;
          case 'C':
            for (i = 0; i + 5 < n.length; i += 6) {
              ctx.bezierCurveTo(n[i], n[i + 1], n[i + 2], n[i + 3], n[i + 4], n[i + 5]);
              cx = n[i + 4]; cy = n[i + 5];
            } break;
        }
      }
    },

    /** 圆角矩形 —— `ctx.roundRect` 缺失时用四段 arcTo 兜底（老基础库上它整个消失） */
    _roundRect: function (x, y, w, h, r) {
      const ctx = this._ctx;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(x, y, w, h, r);
        return;
      }
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  }
});
