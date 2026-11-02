/**
 * 设计稿基准画布 · 双基准（横竖自适应）＋ 屏幕方向监听
 *
 *   横屏（宽 ≥ 高）→ 1280 × 800，骨架 = navRail 72 ＋ 内容区 1208      ← 画布 726686551619462
 *   竖屏（宽 < 高）→  800 × 1280，骨架 = 品牌栏 40 ＋ 主工作区 1128 ＋ 底栏 88 ← 画布 727403959376047
 *
 * 目标设备：华为 MatePad Mini（2560×1600 @DPR2 ⇒ 逻辑 1280×800；竖屏 800×1280）。
 * 规则（需求 V7 §4.4：宽屏用 px ＋ flex，不用 rpx）：
 *   视口 ≥ 基准 → 缩放系数 1，1:1 还原设计稿；
 *   视口更小 → 整体等比缩小并居中，保证不破版、不溢出。
 *   ★★ 184 / 185 轮修正：**平板的"画布"不是常量尺寸** —— 竖屏（184）与横屏（185）
 *      都改成「s 由宽定（夹 1）＋ 画布高 ＝ 视口高 ÷ s」，差量落进唯一可伸缩的那一段
 *      （竖屏 ＝ 主工作区 --work-h-port ／ 横屏 ＝ 主工作区 --work-h-land）⇒
 *      画布左右上下四条边都钉在视口上，不再有 letterbox。手机端仍走上面那条"取小"
 *      （它是另一块基准 PHONE_BASE，比例本来就同族，见那块常量的注释）。
 *
 * 三处实现层修正（设计稿是在不带设备 chrome 的画布里画的，落地要补）：
 *   ① 状态栏：设计稿画布 y0–24 是「状态栏占位」。真机状态栏若高于 24，横屏要把画布
 *      下移 (状态栏高 − 24)，首个区块头才不会被状态栏压住；**竖屏不下移画布** ——
 *      品牌行是按真机胶囊实测位置摆的，天然在状态栏之下，改为把「状态栏占位」本身
 *      撑到真机状态栏高、并同步把工作区矮掉同样多（详见 portHeights）。
 *      ⚠️ 下移量**不能**从可用高度里扣，否则会触发整体缩放、四周露边（第十六轮走查）；
 *         「品牌栏吃掉了工作区的高」则必须从工作区里扣，否则品牌行会压住首个区块头
 *         （第十七轮走查）。两条方向相反，别混。
 *      ★ 而「品牌栏吃多少」不是常量 —— 品牌行的实际高由真机胶囊决定，品牌栏必须
 *        至少把它兜住（真机上品牌栏可能 ＞ 设计稿的 40）。少兜的那几像素会落进工作区，
 *        表现为「品牌行压住首个区块头」＋「滚动时内容透过没背景色的标题栏露出来」
 *        （第五十八轮走查）。详见 portHeights 的 ★★ 注释。
 *   ② 微信原生胶囊：竖屏品牌栏与右上角胶囊同行（横屏没有品牌栏，不必对齐）。AVOID_CAPSULE = false 可关掉，
 *      得到与设计稿逐像素一致的结果（仅用于与设计稿比对）。
 *   ③ 方向：**只看视口宽高比自动判定**（ratio ≥ 1 为横屏）。
 *      ⚠️ 107 轮删掉了原来的"强制方向"调试开关（`setForce` + storage 残留态）——
 *         它会让模拟器停在错的形态上、看起来像产品被改坏。要复核某一形态，
 *         直接把开发者工具的机型换成对应尺寸的视口即可（判定本来就只看真实视口）。
 *
 * ── 屏幕方向：官方机制与本模块的职责 ───────────────────────────────
 * 小程序侧「让页面跟着设备旋转」的开关只有配置项，没有可调用的 API：
 *   ① app.json → window.pageOrientation = "auto"   （基础库 2.4.0+，手机 / 平板）
 *   ② app.json → resizable = true                  （基础库 2.3.0+ iPad；2.21.3+ 大屏）
 *   ③ 页面 json 里也各写一份 pageOrientation       （页面级双保险，四页已配）
 * 配置生效后，尺寸变化通过两条官方通道送达，本模块两条都接：
 *   A. Page.onResize(res)        ← 官方推荐；res.size 就是新的显示区域尺寸
 *   B. wx.onWindowResize(res)    ← 官方备注「不是推荐的方式」，作兜底
 * ⚠️ 小程序**没有**「监听设备物理朝向」的页面级 API：
 *    wx.onDeviceOrientationChange 是**小游戏**接口，且只在 game.json 配
 *    deviceOrientation: landscape 时才生效（v2.26.0 前还只监听左横↔右横）。
 *    在小程序里调它没有意义，不要用它来判断该用哪套骨架。
 * ⚠️ 因此「判方向」一律以**视口宽高比**为准，不看物理朝向：平板可能被系统锁了
 *    旋转，此时布局应保持与视口一致。物理朝向只在诊断面板里作为参考信息展示。
 *
 * 本模块提供：
 *   fit(vp)                 → 基准画布 ＋ 缩放 ＋ 样式串（vp 省略时自读视口）
 *   viewportFromResize(res) → 从官方回调对象取视口（优先 res.size）
 *   init()                  → app.js 调一次，注册全局兜底通道
 *   note(source, res)       → 记录一次方向事件（诊断用）
 *   probe()                 → 诊断快照（视口 / 判定 / 各通道触发次数 / 最后一次原始 payload）
 */

const BASE = {
  land: { w: 1280, h: 800 },
  port: { w: 800, h: 1280 }
};
/* ★★ 103 轮 · 手机端基准画布 —— 手机不走上面那两块。
   ── 为什么必须新加一块（这是"整屏列表页"能不能成立的根）
   上面两块是**平板的两种姿态**：横 1280×800、竖 800×1280，都是 **5:8 / 8:5**。
   手机竖屏的视口比例是 390:844 ≈ **1:2.16**，与 800:1280 的 1:1.6 差得很远。
   `s = min(vw/bw, availH/bh, 1)` 取小 ⇒ 手机上永远是**宽**顶死
   （390/800 = 0.4875 ＜ 844/1280 = 0.659），画布于是只有 390×624 那么大，
   上下各空出 110px —— 屏幕最上面和最下面那两条不是"留白"，是**根本没人画**。
   症状：手机端做"整屏列表"时列表只铺到屏高 74%，底下一条空带
   （103 轮 A2/A3 判红量到的就是这条：`.cp` 高 604.5，屏高 844）。
   ⇒ 手机端**必须有自己的基准**，且它要与手机的真实比例同族，
     `s` 才会落在 1 附近（宽和高同时顶死），画布正好铺满一屏。
   ── 为什么取 400×880 而不是 390×844（真机视口）──────────────────────
   · 基准是一个**设计坐标系**，不该跟着某一台机型的视口走（换台手机就变数）；
   · 400×880 = 1:2.2，落在常见手机区间（iPhone 15 393×852≈1:2.17、
     Android 360×800=1:2.22）中间，两边都不会因比例差太多而重新letterbox；
   · 取整百便于心算（`k ≈ 视口宽/400`，390 ⇒ 0.975、360 ⇒ 0.9）。
   ⚠️ 与 800×1280 的关系：**不是**简单折半（400×640 才是折半）——
      这一块**故意更高**，因为手机就是更窄更长。别拿它去套平板的几何公式。
   ⚠️ 一旦走这块基准，原来那些 `--work-h-port: 1280 − …` 的算式**全都不适用**
      （1280 是平板竖屏的画布高）⇒ 手机端的高度全在 `app.wxss` 的 `.app.phone`
      与 `capsule.wxss` 的 `.cp.phone` 里按 `--work-h-phone` 家族现算，
      见那两处的注释。 */
const PHONE_BASE = { w: 400, h: 880 };
const TOP_INSET = 24;             // **竖屏**状态栏的下限（设计稿顶栏自带的 y24）
/* ★★ 214 轮 · 横屏「让位段」高 ＝ **12**。
   ── 五代（这条数被反复试过，按顺序读）──────────────────────────────────
     204 轮：24 ＝ 设计稿顶栏自带的 y24（当时由 `.main` 的 padding-top 占）
     205 轮：12 ＝ 用户「横屏PC的让位24是否可以改为12，距离顶部稍微有点大」
     206 轮：**0** ＝ 用户「横版PC端的让位直接去掉试试，因为页面的工作区顶部
             也都有子标题，所以右侧不会出现内容与小程序胶囊产生遮盖」
             ⚠️ 落地方式：常量归 0 **＋** 五个模块的 `<brand-head>` 挂
                `wx:if="{{!landscape}}"`（零高宿主仍占 flex 的 `gap: 12`，
                只改常量的话首块顶会停在 y12）。
     207 轮：6 ＝ 用户「感觉横屏pc短的那个顶部让位去掉也不成，还是加回来吧，
            从12改为6试试」⇒ **让位段重新渲染**（撤销那五个 `wx:if`）。
     ⚠️ 207–213 期间这个 6 **根本没生效**：`.bh` 的 `padding-top`（按胶囊算）
        把盒子撑到 24（PC）/ 10–24（平板），详见 213 轮。
     214 轮：6 → 10 → **12**＝ 用户「加高到10…还是有点小，改到12吧」。
            这才是第一次**真正**由本常量生效的值（213 已把 `.bh.land` 的 padding 归零）。
            ⚠️ 别把"回到 205 的 12"读成白折腾：205 那版的 12 被 padding 撑成 24/10–24，
                **从来没有一次真的渲染成 12**；现在这个 12 才是真的 12。
   ── 结论（别再来回试了）────────────────────────────────────────────────
     横屏首块自带 `.sec-head` 子标题，确实**不会**被右上角胶囊遮住 —— 0 在遮挡上没问题；
     但内容完全贴顶（子标题上沿就是画布 y0）观感太紧 ⇒ 要一条留白。
     已否：0（贴死）／6（偏小）／10（仍偏小）。当前口径 **12**。
   ⚠️ **不要拿它替换 TOP_INSET**：后者是竖屏 `statusH` 的下限
      （`min(capTop, max(24, sb))`），两者语义不同、只是数值曾经相同。
      混用会让竖屏品牌行在「状态栏很矮」的设备上被压进状态栏。
   ⚠️ 让位段在横屏是**空盒子**（`brand-head.wxml` 内部还有一层 `wx:if="{{!landscape}}"`
      挡住 logo）—— 它只贡献高度，不画任何东西。
   ⚠️ 改这个数只影响横屏三处：`--head-h`、`--work-h-land`（＝ canvasH − 本值）、
      首块顶（＝ 本值）。竖屏与手机一个像素都不动。 */
const LAND_HEAD = 12;
const AVOID_CAPSULE = true;       // 是否避让微信原生胶囊
const LANDSCAPE_MIN_RATIO = 1.0;  // 宽/高 ≥ 该值判为横屏

/* ==========================================================================
   ★ 手机 / 平板 —— 与「横竖屏」是**两个正交的开关**
   ── 为什么要新加这一维 ────────────────────────────────────────────────
   本模块原来只有「横屏 / 竖屏」（按视口宽高比），因为当时只有一台目标设备
   （MatePad Mini，横 1280×800 ／ 竖 800×1280），两种形态共用一套骨架。
   现在手机端要做成「只有闪念胶囊的语音记录本」—— 手机竖屏（eg. 390×844）
   宽高比 < 1 ⇒ 照样判成 `port`，**与平板竖屏走完全同一套骨架**。
   光靠宽高比分不开这两者，必须再加一维。
   ── 判据为什么用「视口短边」而不是 wx.getDeviceInfo().deviceType ────────
   · `deviceType` 在开发者工具里恒为 `'devtools'`、在自定义机型上也拿不到
     真机值 ⇒ 模拟器里**测不了**手机形态，只能上真机试，改一版等一次真机。
   · 短边是纯几何量：`min(w, h)`。手机竖屏 390、手机横屏 390（同一台机器转过来
     短边不变）、平板竖屏 800、平板横屏 800 —— **短边在旋转前后恒定**，
     正好当设备尺寸的代理量（宽高比做不到这件事：它一转就翻）。
   · 阈值 600：真机手机短边最大也就 ≈ 440（iPhone Pro Max 430 / 各家折叠外屏
     多在 400 上下），平板竖屏最小 800（MatePad Mini）——  600 落在中间，
     两边都有 150px 以上余量，不会被任何一档常见机型踩到。
   ⚠️ 这一维**只影响"渲染哪套骨架"**，不影响缩放：手机端仍按 port 基准
      800×1280 等比缩小（s ≈ 0.49），几何与平板竖屏逐值同源 ⇒ 胶囊组件的
      内部量法（`k = 宽/320` 等）一行都不用改。
   ========================================================================== */
const PHONE_MAX_SHORT = 600;      // **设备屏**短边 < 该值判为手机（★ 2026-10-22 起；原为"窗口短边"）
                                  /* ★★ 2026-10-22：判据的量从「窗口短边」换成「**屏**短边」——
                                     理由与逐例见 `phone()` 里的长注释（PC 矮窗口 / 平板分屏
                                     曾被误判成手机，五个模块整段退出渲染）。
                                     阈值 600 一个字没动，语义仍是"手机 / 非手机"的分界。 */
const CAP_GAP_FALLBACK = 8;       // 胶囊 API 取不到时：胶囊顶 ≈ 状态栏底 ＋ 8
                                  // （MatePad Mini 竖屏实测 sb≈57、胶囊顶≈65.5 ⇒ 间距约 8.5；
                                  //   微信通行值 4 偏小，会让品牌行顶到胶囊上方几像素）
const CAP_H_FALLBACK = 32;        // 同上：胶囊高兜底（微信通行值）
const CAP_H_MAX = 40;             // 胶囊高上限 —— 个别机型 / 基础库会返回非逻辑值（物理 px 等），
                                  // 夹住它，免得品牌行把品牌栏（按设计稿写死 40）撑爆
const CAP_TOP_MAX = 80;           // 胶囊顶上限（画布坐标），同上，防异常读数把品牌行推到半屏下

/* 画布底部可以「沉出屏幕」的量 —— 设计稿本来就留了这么多空白：
     竖屏：底栏 88 里最下 24 是系统手势留白；
     横屏：工作区底部 padding 20。
   ★ 用途见 fit() 的 availH：画布被下推 top 之后，把它从底部留白里还回去，
     这样才不用整体缩小（缩了就会在四周露出一圈页面底色）。 */
const BOTTOM_SLACK = { land: 20, port: 24 };
/* ★★ 103 轮 · 手机端的底部余量 = **0**（不是 port 那 24）。
   ── 为什么必须单独给 0 ────────────────────────────────────────────────
   平板的 24 是"画布可以往屏幕外沉一点、反正那一段本来就是手势留白"。
   手机端不能这么干：`PHONE_BASE` 的 880 是**整屏**（品牌栏 ＋ 列表 ＋ 底部圆钮
   都已经算在里头），再放 24 的余量就等于让画布比屏幕高 ——
   实测 s = min(390/400, (844+24)/880) = min(0.975, 0.9864) = 0.975，
   宽顶死 ⇒ 画布 880×0.975 = **858** 高，而屏幕只有 844 ⇒ 上下各削 7px，
   底部那颗录音圆钮被切掉一条（这正是本轮 E 段出图看到的）。
   ⇒ 手机端 give 0：s = min(390/400, 844/880) = **0.959**，高顶死，
     画布 400×0.959 = 384 宽（< 390，左右各留 3px 呼吸）、880×0.959 = 844 高 ✓
     正好铺满、圆钮完整。
   ⚠️ 这是"宽高同时接近顶死"与"某一边溢出"的区别 —— 手机的比例（1:2.2）
      与 PHONE_BASE（1:2.2）本来就同族，取 min 就该两边都够用；
      多给 slack 反而把这层对齐破坏掉。 */
const BOTTOM_SLACK_PHONE = 0;

/* 竖屏骨架里那两段固定高 —— 必须与 app.wxss 的 --cap-row-h / --bnav-h 保持同值：
     品牌行 40（**设计稿值 / 最小值**）＋ 底部导航 88。
   ⚠️ 品牌行的**实际**高不是常量：它按真机胶囊摆，可能比 40 高 ⇒ 由 portHeights()
      取 max(40, capTop ＋ capH − statusH)，写进 CSS 的 --cap-row-h。40 只是它的下限。

   ★★ 204 轮改名：`PORT_TITLE_H` / `--title-h` → **`PORT_CAP_ROW_H` / `--cap-row-h`**。
      旧名字说的是"标题栏"，而 204 起**标题栏这个实体已经不存在了**（`.titlebar`
      整条撤掉，logo 搬进滚动内容）。这个名字现在只表示「与原生胶囊同行的那一段」
      有多高 —— 它是**让位段**（`--head-h` ＝ 状态栏 ＋ 这一行）的第二个加数。
      名字不改，下一个人一定会把它当成"某条栏的壳高"去用。 */
const PORT_CAP_ROW_H = 40;
const PORT_BNAV_H = 88;

/* ================= 视口 ================= */

function readWindowInfo() {
  try {
    return (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {};
  } catch (e) {
    return {};
  }
}

function readCapsuleRight(viewportW) {
  if (!AVOID_CAPSULE) return 0;
  try {
    const r = wx.getMenuButtonBoundingClientRect();
    if (r && r.left) return Math.max(0, viewportW - r.left);
  } catch (e) { /* 拿不到胶囊就不避让 */ }
  return 0;
}

/** 原生胶囊矩形（视口 CSS px）；拿不到返回 null */
function readCapsule() {
  if (!AVOID_CAPSULE) return null;
  try {
    const r = wx.getMenuButtonBoundingClientRect();
    if (r && r.height) return r;
  } catch (e) { /* 旧基础库 / 预览环境可能没有 */ }
  return null;
}

/** 自读当前视口 */
function readViewport() {
  const i = readWindowInfo();
  const v = {
    w: i.windowWidth || BASE.land.w,
    h: i.windowHeight || BASE.land.h,
    sb: i.statusBarHeight || 0,
    capRight: 0
  };
  v.capRight = readCapsuleRight(v.w);
  return v;
}

/**
 * 胶囊 ÷ 缩放 ÷ 垂直偏移的公共推导 —— fit() 与 portXxx() 三个出口都走这一份，
 * 保证「同一个视口 → 同一组 capTop / capH / s」，不会两处算出两个数。
 *
 * 返回 { o, b, top, slack, availH, s, wrapH, centered, offY, cap, capTop, capH }
 */
function capsuleMetrics(vp) {
  const v = (vp && vp.w && vp.h) ? vp : readViewport();
  const o = v.w / v.h >= LANDSCAPE_MIN_RATIO ? 'land' : 'port';
  /* ★★ 103 轮：手机端**换一块基准画布**（PHONE_BASE，理由见那块常量上方的注释）。
     ⚠️ 判 `phone` 只看**短边**、不看方向 —— 手机横屏（短边 390）也走这块。
        这是对的：`PHONE_BASE` 是 400×880（竖），手机横屏时 `s` 会被宽顶死，
        画布横过来铺满 —— 与"手机端恒走竖屏骨架"（壳页那条）合起来，
        得到的就是"画布横过来、内容仍按竖排版"的观感，比切到 1280×800 那套
        （左导轨 + 工作区，手机根本装不下）合理得多。
     ⚠️ 107 轮：手机端**只看短边**（不再有强制开关顶掉判定，那条旁路已删）。 */
  const isPhone = phone(v);
  const b = isPhone ? PHONE_BASE : BASE[o];
  /* 状态栏下推量：只有横屏需要（竖屏不下推画布，见 fit 的注释）
     ⚠️ 手机端**恒不下推**：PHONE_BASE 是竖的（880 高），横屏时若还下推，
        会与"画布横过来"打架。手机的状态栏由滚动内容首段的让位段自己让（见 app.wxss）。
     ★★ 205 轮：下推基准仍是 `TOP_INSET`(24) 而不是 `LAND_HEAD`(12) ——
        两者不是同一件事：24 是「设计稿顶栏原本占的高度」，超出它的部分才由**屏幕**
        真实状态栏吃掉、必须下推；画布内那 12 是本轮主动收紧的让位。
        若把这里也改成 12，实际状态栏 ≥ 24 的设备会**一点变化都看不到**
        （下推多 12、让位少 12，屏幕上首块顶原地不动）—— 正是本轮要避免的"改了等于没改"。 */
  const top = (o === 'land' && !isPhone) ? Math.max(0, v.sb - TOP_INSET) : 0;
  /* ⚠️ 手机端 slack 取 0（理由见 `BOTTOM_SLACK_PHONE`）—— 手机端画布高就是整屏，
     再多给余量会让画布高过屏幕、底部的录音圆钮被削掉一条。 */
  const slack = isPhone ? BOTTOM_SLACK_PHONE : (BOTTOM_SLACK[o] || 0);
  const availH = Math.max(1, v.h + slack - top);
  const wrapH = Math.max(0, v.h - top);
  /* ★★★ 184 轮 · **竖屏平板改「铺满」**：s 只由宽定，画布高按视口现算（canvasH）──
     ── 为什么（iPad mini 真机两条症状，用户口径逐字）────────────────────────
       「ipadmini 左右两侧没有充满，底部导航栏高度也不对，没有给系统手势控制预留缓冲区」
     ── 旧口径为什么两头不讨好 ──────────────────────────────────────────────
         s = min(vw / bw, (vh ＋ slack) / bh, 1)
     这块基准 800×1280（1:1.6）是**照 MatePad Mini 的屏**定的，而 iPad mini 竖屏是
     744×1133（1:1.523）—— 相对地比基准**宽**。于是"宽"那一支永远顶不死：
         s = min(744/800 ＝ 0.93, (1133＋24)/1280 ＝ 0.9039) ＝ **0.9039**
     取小的总是**高**那一支，两个后果同时出现：
       · 画布宽 ＝ 800×0.9039 ＝ **723.1** ＜ 视口 744 ⇒ 左右各露 **10.4px** 的
         `.stage-wrap` 底色，底栏那张白底「差一截没铺到屏幕边」（症状①）；
       · 画布高 ＝ 1280×0.9039 ＝ **1157** ＞ 视口 1133（那 24 是 `BOTTOM_SLACK`
         "借"给它的）⇒ 画布**底边沉到屏幕外 21.7px**，正好把底栏最下 24
         （＝系统手势留白）沉掉 ⇒ 底栏内容行贴在屏幕最下沿、没有缓冲区（症状②）。
     ── 正解：画布**两条边都钉在视口上**，差量交给"会伸缩的那一段"────────────
       · s 只由**宽**定（`vw / b.w`，仍夹 1 不放大）⇒ 左右恒铺满；
       · 画布高 ＝ **视口高 ÷ s**（`canvasH`，画布坐标）⇒ 上下恒铺满。
     差量落在哪：竖屏骨架里**只有"主工作区"是可伸缩的**（状态栏占位 / 品牌栏 /
     底栏 88 都是固定量，见 portHeights）⇒ iPad mini 上工作区 1128 → **1066**
     （矮 62，它本来就是个可滚动区域），而底栏那 88（含手势留白 24）
     **完整落在屏内** —— 两条症状一起消失，且 MatePad 上逐值不变
     （s 恒为 1 ⇒ canvasH ＝ 1280，一个像素都没动）。
     ── 哪些形态走这条 ─────────────────────────────────────────────────────
       · **手机端不走**：`PHONE_BASE`(400×880) 与手机视口本来就同族（1:2.2 vs
         1:2.16），取小之后两边同时接近顶死（390×844 ⇒ s ＝ 0.9591，宽只差 3px）；
         换成"宽顶死"会把整屏缩放从 0.9591 提到 0.975（字号跟着变），
         而它**没有任何症状**要修 ⇒ 不动（`fill` 里排除 isPhone）。
       · **横屏（★ 185 轮起）也走这条**：184 当时把横屏留在外面，理由是"横屏那段高
         是写死的（`--work-h-land: 776` / 脑图 `CANVAS.land 722` / 导轨 72），
         画布一变高就要连它们一起改"，且判"iPad 横屏上下各留 18px **没进症状清单**"。
         用户随后就报了这条 ⇒ 185 轮做掉。同样的病、同一个算式：
         iPad mini 横屏 1133×744（1.523）与基准 1280×800（1.6）不同族 ——
         宽那一支顶死（s ＝ 0.8852）⇒ 画布高 708 ＜ 视口 744 ⇒ **上下各留 17.9px**；
         上面那条被状态栏吃掉（看不见），**下面那条在屏底留成一道底色缝**
         （用户口径：「横版有点小问题，就是底部还是有个缝隙」）。
         横屏可伸缩的那一段同样是**主工作区**（横屏骨架 ＝ 状态栏占位 24 ＋ 工作区），
         所以 `--work-h-land` 也从 776 改成「画布高 − 24」**现算**（见 fit 的 landWorkH）；
         连带脑图画布（＝ 工作区 − 54）一起现算，见 `utils/mindmap-core.js` 的
         `syncLandCanvasH`。
     ⚠️ 画布高**取整**：小数会让 `--work-h-port` / `--mask-h` 一路带小数，
        抽屉 / 遮罩 / 脑图画布的边就可能有半像素缝。取整后 `canvasH×s` 与 `wrapH`
        的差 ≤ 半个逻辑像素，由下面 `centered` 的 1px 容差吸收。 */
  const fill = !isPhone;
  const s = Math.round(Math.min(v.w / b.w, fill ? Infinity : availH / b.h, 1) * 10000) / 10000;
  const canvasH = fill ? Math.max(1, Math.round(wrapH / s)) : b.h;
  /* ★★ 103 轮：`centered` 加 1px 容差 —— 免得"差 0.01px"被判成"放不下"。
     ── 症状与根因（本轮 E 段量出来的）────────────────────────────────────
     手机端 `s = 0.9591`、画布高 `880 × 0.9591 = 844.01`，而 `wrapH = 844`
     ⇒ `844 >= 844.01` 为 **false** ⇒ `centered = false` ⇒ `align-items: flex-start`
     ⇒ 画布**顶部对齐**（本该居中），底部那颗录音圆钮正好被挤出屏外一条。
     差的是 **0.01px** —— 一次舍入误差就把整块画布的垂直对齐翻了面。
     ⚠️ 为什么偏偏手机端会踩到：`s` 被**高**顶死（`844/880`），于是 `b.h * s`
        数学上恰好等于 `v.h`，浮点误差必然把它推到 `v.h` 的某一侧。
        平板端不会被顶死（总有富余），所以这条从来没人撞上。
     ⚠️ 容差取 1px：它只用来吸收"数学上相等但浮点不等"的情形，
        真正的"放不下"（差几十 px）照样判 false，语义没有被削弱。 */
  /* ⚠️ `centered` / `offY` 一律按**当前画布高 canvasH** 算（184 轮起它不再是常量；
     竖屏平板走"宽顶死"时 canvasH×s 与 wrapH 恒等 ⇒ 恒居中、offY ≈ 0）。 */
  const centered = wrapH + 1 >= canvasH * s;
  /* ⚠️ 这两个数不只是"算给自己看的" —— fit() 的 style 里那条 `transform-origin`
       必须与它们**成对**取值，否则视觉盒与 offY 差 `canvasH·(1−s)/2`（183 轮 iPad 病灶，
       详见 fit() 里 `transform-origin` 上方那段）。改这里记得连着看那边。 */
  const offY = centered ? (wrapH - canvasH * s) / 2 : 0;
  const cap = readCapsule();
  const capTop = Math.min(CAP_TOP_MAX, cap
    ? Math.max(0, Math.round((cap.top - top - offY) / s))
    : Math.max(0, Math.round((v.sb + CAP_GAP_FALLBACK - top - offY) / s)));
  const capH = Math.min(CAP_H_MAX, cap
    ? Math.max(20, Math.round(cap.height / s))
    : CAP_H_FALLBACK);
  return {
    o: o, b: b, top: top, slack: slack, availH: availH,
    s: s, wrapH: wrapH, centered: centered, offY: offY,
    /* ★ 184 轮：**当前画布高**（画布坐标）—— 竖屏平板是现算的，其余恒等于 b.h。
       全工程凡"画布高"的地方都该读它（写进 CSS 的 --canvas-h），别再写 1280。 */
    canvasH: canvasH, fill: fill,
    cap: cap, capTop: capTop, capH: capH
  };
}

/**
 * 竖屏骨架的三段高 —— 状态栏占位 statusH ＋ 品牌行 capRowH ＋ 工作区 workH
 *                     ＋ 底栏 PORT_BNAV_H ＝ **画布高**（★ 184 轮起是 canvasH，
 *                       平板竖屏由视口现算；设计稿那 1280 只是它的兜底）
 *
 * ★★ 品牌行的「有效高」不能写死设计稿的 40 —— 它按真机胶囊摆：
 *      行顶 ＝ --cap-top、行高 ＝ --cap-h（画布坐标）⇒ 行底 ＝ capTop ＋ capH。
 *    这一行比胶囊行矮多少，那几像素就压到下面 —— 204 之前症状随页面形态分两种：
 *      · 静止页 —— 品牌行压住首个区块头，把 --gap-top 吃光
 *                  （真机走查「标题栏和第一行子标题中间的间隙没有了」即此症）；
 *      · 滚动页 —— 工作区内容滚到品牌行那一段，透过**没有背景色**的品牌栏露出来
 *                  （真机走查「向上滚动的时候，标题栏会透过看到内容」即此症）。
 *    ⇒ capRowH ＝ max(设计稿 40, capTop ＋ capH − statusH)
 *      等价说法：**这一行的下边缘，至少在品牌行的下边缘之下。**
 *      ⚠️ 模拟器上永远是 max 的第一支（IDE 胶囊 top 28 / 高 31 ⇒ 28＋31 ＝ 59 ＜ 24＋40），
 *         所以这条改动在 IDE 里是**恒等变换**，只在真机上生效。
 *
 * ★ 状态栏占位也不能只信 statusBarHeight：真机上它可能取到 0 或明显偏小，
 *   而胶囊照旧拿得到 ⇒ 品牌行被压成 24 高，整条(37px)掉进下面。
 *   上面那条 capRowH 正好把这种情况兜住（statusH 小 → capRowH 自动变大），
 *   所以无需额外猜值；只把 statusH 夹到不超过胶囊顶，免得品牌行被顶进状态栏里。
 *
 * ★★ 204 轮（标题栏滚出视口）—— **返回值多了两个，语义要分清**：
 *   · `workH`   ＝ **内容可视高** ＝ 画布 − 状态栏 − 品牌行 − 底栏。语义**没变**，
 *                 抽屉 / 胶囊 / 脑图画布 / 遮罩那一整族几何仍按它算（一个字未动）；
 *   · `headH`   ＝ **让位段高** ＝ 状态栏 ＋ 品牌行。这一段的**归属从固定层换成了
 *                 滚动内容**（见 app.wxss 的 `.workarea`）—— 它是"内容的首段"，
 *                 上滑时跟着内容一起走掉；
 *   · `scrollH` ＝ **滚动容器高** ＝ workH ＋ headH ＝ 画布 − 底栏。
 *                 滚动容器从 y0 起吃满，让位段坐在它内部。
 *   ⇒ 三者满足 `scrollH = workH + headH`，而 `workH` 仍是「扣掉让位段之后还能看到多少」。
 *      ⚠️ 抽屉/胶囊/脑图画布**一律继续用 workH**：它们顶边固定在 `--head-h`（品牌行下沿），
 *         高度再用 workH 就正好落到底栏上沿。换成 scrollH 会让它们顶穿底栏 —— 这是本轮
 *         最容易犯的错，改之前先想清楚"这个盒子是从 y0 起算，还是从让位段下沿起算"。
 *
 * ⚠️ 全工程凡是要「工作区高 / 状态栏占位 / 让位段高 / 滚动容器高」的地方一律走这里
 *    （由 fit() 写进 CSS 变量 --work-h-port / --status-h / --head-h / --scroll-h-port），
 *    不要自己拿 1280 去减常量。
 */
function portHeights(vp, capTop, capH, canvasH) {
  const v = (vp && vp.w && vp.h) ? vp : readViewport();
  const statusH = Math.min(capTop, Math.max(TOP_INSET, Math.round(v.sb || 0)));
  const capRowH = Math.max(PORT_CAP_ROW_H, capTop + capH - statusH);
  /* 让位段 ＝ 状态栏 ＋ 品牌行 —— 204 起它是**滚动内容的第一段**，不是固定的一格 */
  const headH = statusH + capRowH;
  /* ★★ 103 轮：手机端走自己的基准（880 高）且**没有底栏** ——
     平板竖屏那 1280 里扣掉 88 是给 `bottom-nav` 留的，手机端本期没有底栏
     （壳页 `!phone`），扣了就是白丢 88 高、列表底边离屏底还差一截。
     ⚠️ 与 `.app.phone` 的 `--work-h-port-phone: calc(--work-h-port + 88px)` 是
        **同一条推论的两种写法**。那边是"在平板值上加回 88"，这边是"根本不减 88"。
        两条必须同源：改一处记得改另一处（谁先算谁说了算 —— 现在是这边说了算，
        因为 `fit()` 写进 CSS 变量的 `--work-h-port` 已经是对的，那边那层 +88 就是多余的）。 */
  const isPhone = phone(v);
  /* ★★ 184 轮：画布高**不再是常量** —— 竖屏平板由 capsuleMetrics 现算
     （"宽顶死 ＋ 画布高 ＝ 视口高 ÷ s"，理由见那里的 ★★★ 段）。
     传进来就用它，没传（老调用点）退回设计稿高：手机 880 ／ 平板 1280。
     ⚠️ 与 `--canvas-h` **同源**：CSS 侧一律 var(--canvas-h)，别在两处各算一遍。 */
  const ch = (Number(canvasH) > 0) ? canvasH : (isPhone ? PHONE_BASE.h : BASE.port.h);
  const navH = isPhone ? 0 : PORT_BNAV_H;
  const workH = Math.max(1, ch - statusH - capRowH - navH);
  const scrollH = Math.max(1, workH + headH);
  return {
    statusH: statusH, capRowH: capRowH, headH: headH,
    workH: workH, scrollH: scrollH, phone: isPhone, canvasH: ch
  };
}

/** 竖屏三段高的便捷出口（内部自算胶囊） */
function portMetrics(vp) {
  const v = (vp && vp.w && vp.h) ? vp : readViewport();
  const cm = capsuleMetrics(v);
  /* ★ 184 轮：把现算的画布高一起带过去 —— 否则 portWorkH() 会退回设计稿的 1280，
     与 fit() 写进 CSS 的 --work-h-port 差一个"状态栏／视口差量"（脑图画布会顶穿底栏）。 */
  const h = portHeights(v, cm.capTop, cm.capH, cm.canvasH);
  h.capTop = cm.capTop;
  h.capH = cm.capH;
  return h;
}

/**
 * 竖屏「状态栏占位」—— 设计稿画布 y0–24 是状态栏占位，真机状态栏往往高得多
 * （MatePad Mini 竖屏实测 ≈57）。
 *
 * 为什么竖屏要按真机值撑开：品牌行是**与右上角原生胶囊同行**摆的，落点 ＝
 * `--cap-top`（胶囊顶）。设计稿里这个落点是 y28（24 ＋ 4 的旧兜底），
 * 真机却是 y66（57 ＋ 9）。
 *
 * ⚠️ 取 max(24, 真机值)：个别机型 / 模拟器状态栏不足 24（IDE 里是 20），
 *    这时必须退回设计稿的 24，否则整条会整体上移、反倒把品牌行顶上状态栏。
 * ⚠️ 再夹到不超过胶囊顶：否则品牌行的 `top` 会落在状态栏里、被系统时间盖住。
 */
function portStatusH(vp) {
  return portMetrics(vp).statusH;
}

/**
 * 竖屏「品牌行」高 —— 见 portHeights 的 ★★ 说明（真机上可能 ＞ 设计稿的 40）。
 * ★★ 204 轮改名：原名 `portTitleH`（"标题栏高"）。**标题栏实体已撤**，这个名字
 *    现在只表示「与原生胶囊同行的那一段」，是让位段 `--head-h` 的第二个加数。
 */
function portCapRowH(vp) {
  return portMetrics(vp).capRowH;
}

/**
 * 竖屏「让位段」高 ＝ 状态栏 ＋ 品牌行 —— 204 起这一段归**滚动内容**（内容的首段）。
 * 组件（`components/brand-head`）与各模块的 `padding-top` 都读它。
 * ⚠️ 横屏没有品牌行 ⇒ 让位段整段就是顶部那一小条，由 `fit()` 直接把 `--head-h`
 *    写成 `LAND_HEAD`（★ 205 轮起是 12，204 时是 24）。
 */
function portHeadH(vp) {
  return portMetrics(vp).headH;
}

/**
 * 竖屏主工作区高 ＝ 画布高 − 状态栏占位 − 品牌行高 − 底栏 88。
 *
 * ★★ 204 轮：**这个语义没有变** —— 它是"扣掉让位段之后还能看到多少"，
 *    抽屉 / 胶囊 / 脑图画布 / 遮罩全族仍按它算（它们的顶边固定在让位段下沿）。
 *    滚动容器（`.workarea`）用的**不是**它，而是 `--scroll-h-port`（＝ 本值 ＋ headH）。
 *    ⚠️ 两者搞混的后果：抽屉/画布顶穿底栏，或滚动区白丢一段。
 *
 * ⚠️ 竖屏凡是写死 1128 的地方都要改用这个值（现由 fit() 写进 `--work-h-port`
 *    这个 CSS 变量，各模块直接 var() 取）：1128 只是「状态栏 24 ＋ 品牌行 40」时的特例。
 *    连带要跟着缩的是脑图画布高（＝ 工作区 − 70，见 mod-mindmap 的 CANVAS）。
 */
function portWorkH(vp) {
  return portMetrics(vp).workH;
}

/**
 * 竖屏「滚动容器」高 ＝ 工作区 ＋ 让位段 ＝ 画布高 − 底栏 88。
 * 204 起 `.workarea` 用它：容器从画布 y0 起、吃满到 y0 之上，让位段坐在它内部。
 */
function portScrollH(vp) {
  return portMetrics(vp).scrollH;
}

/**
 * 横屏主工作区高 ＝ 画布高 − 让位段 12（★ 185 轮起画布高不再是常量；
 * ★★ 205 轮：让位段 24 → 12 ⇒ 本值比 204 时大 12）。
 *
 * ⚠️ 与 `fit()` 写进 CSS 的 `--work-h-land` **同源** —— 脑图画布那半条尺寸链走这里
 *    （见 `utils/mindmap-core.js` 的 `syncLandCanvasH`：画布高 ＝ 工作区 − 54）。
 * ⚠️ 手机 / 竖屏返回**设计稿值 788**：横屏骨架（左导轨 ＋ 1208 内容区）只在
 *    「横屏平板」上成立，别的形态不该被这条带走（与 fit() 里 landWorkH 的判据同一句）。
 */
function landWorkH(vp) {
  const v = (vp && vp.w && vp.h) ? vp : readViewport();
  const cm = capsuleMetrics(v);
  if (phone(v) || cm.o !== 'land') return BASE.land.h - LAND_HEAD;
  return Math.max(1, cm.canvasH - LAND_HEAD);
}

/**
 * 从官方尺寸变化回调对象里取视口。
 * Page.onResize(res) 与 wx.onWindowResize(res) 的 res 结构相同：{ size: { windowWidth, windowHeight, ... } }
 * 优先用官方直接给的 res.size —— 它比「回调里再调一次 wx.getWindowInfo()」更及时，
 * 真机旋转的瞬间后者可能还读到旧值（这正是空转的常见原因）。
 * 拿不到时回退到自读。
 */
function viewportFromResize(res) {
  const s = res && res.size ? res.size : (res && res.windowWidth ? res : null);
  if (!s || !s.windowWidth || !s.windowHeight) return null;
  const v = {
    w: s.windowWidth,
    h: s.windowHeight,
    sb: s.statusBarHeight || readWindowInfo().statusBarHeight || 0,
    capRight: 0
  };
  v.capRight = readCapsuleRight(v.w);
  return v;
}

/* ================= 方向判定（★ 107 轮：取消"强制方向"调试通道） =================
 *
 * ⚠️ 这里原来有一对 `forced()` / `setForce()`：把 `'land' | 'port'` 写进 storage，
 *    让出图脚本能在同一台模拟器上来回切两种形态。**107 轮全部移除**，理由：
 *      · 它是一个**全局残留态** —— 脚本跑完忘了清，模拟器就停在错的形态上，
 *        而现象看起来像"产品被改坏了"（2026-09-29 用户直接质问「为什么强制横版显示」）。
 *      · 它还有一条隐含语义（`phone()` 里 `if (forced()) return false`）：
 *        强制方向时手机端判定被顶掉 —— 这条"隐形分支"让形态判定多了一条谁也看不见
 *        的输入源，量出来的形态不一定是真机形态。
 *      · 复核两种形态本来就有更干净的办法：**直接选一个对应尺寸的机型**。
 *        （要平板就看宽视口，要手机就看窄视口 —— 判定本来就只看真实视口。）
 *    ⇒ 形态一律**只由真实视口决定**，没有任何外部输入能改写它。
 *
 * ⚠️ 下游（`fit()` 的返回值、壳页的 `data.forced`）**保留 `forced` 这个字段**，
 *    但恒为 `''`。这样不必去动一串消费点，语义也清楚：自动判定 = 没有强制。
 */

/** 只算方向，不依赖调用方传参 */
function orientation() {
  const v = readViewport();
  return v.w / v.h >= LANDSCAPE_MIN_RATIO ? 'land' : 'port';
}

/**
 * 是不是手机 —— 见 PHONE_MAX_SHORT 那段注释。**只看真实视口**（★ 107 轮）。
 *
 * ⚠️ 判据是**短边**：开发者工具与真机都一样，不看方向。
 *    要复核平板形态就给一个宽视口；要复核手机形态就给一个窄视口
 *    —— 不再有"强制开关"这条旁路（理由见上面那块注释）。
 */
function phone(vp) {
  const v = (vp && vp.w && vp.h) ? vp : readViewport();
  /* ★★ 2026-10-22 · **判"手机"要看设备屏，不看当前窗口**（审查 P1-03，只读测试已复现）。
     ── 改前为什么错 ────────────────────────────────────────────────────────
       原来的判据是「**窗口**短边 < 600」。这在手机上没问题，但在**窗口可自由缩放**
       的宿主上会当场翻车：PC 把窗口拖到 1280×600 是工作台，再矮 1px 到 1280×599
       就判成手机 ⇒ 壳页 `!phone` 把五个模块**整段 `wx:if` 掉**（不是重排，是退出渲染），
       模块里的草稿 / 录音 / 选中态还随组件销毁一起没了。
       平板分屏（800×599）同理 —— 分屏一拖，功能入口就消失。
       测试实测：1280×600 → 工作台；1280×599 → 手机；1440×540 → 手机。
     ── 现在的判据 ──────────────────────────────────────────────────────────
       **设备屏短边**（`screenWidth/screenHeight` 取小）< 600 ⇒ 手机。
       屏尺寸是**设备能力**，不随窗口缩放 / 分屏 / 旋转变化：
         · 手机：390 / 430 / 360 … → 竖横都是手机 ✓（与改前一致）
         · 平板：768 / 800 / 1024 → 永远不是手机 ✓（分屏、Stage Manager 也算平板）
         · PC：屏 1920×1080，窗口拖成 1280×599 或 1440×540 → **仍是工作台** ✓
       ⚠️ 拿不到屏尺寸（老基础库 / 现有测试桩）⇒ 退回**窗口**短边，
          与改前逐字等价（不会出现"谁都不是手机"）。
       ⚠️ 别改成"窗口短边 ＋ 长边上限"那种双条件：PC 窗口可缩成任意形状，
          两条件之间总会留一条缝（1000×599 就在缝里），而平板分屏照样中招。
          用屏尺寸是**唯一的定性判据** —— 这正是审查 §8 阶段二要的
          「设备能力 / 产品模式」与「布局密度 / 当前几何」分离。
       ⚠️ 窗口矮下来该做的是**滚动 / 收空白 / 弹层上限**（P2-06 那一族），
          不是把工作台换成手机形态 —— 那是"缩小窗口"与"换一台设备"混为一谈。
       ⚠️ `vp` 是测试 / 重排传入的视口对象（`{w,h,sb}`），**不含**屏尺寸 ⇒
          这里显式再问一次 `readWindowInfo()`（一次同步属性读，无事件）。
          刻意**不缓存**：折叠屏开合 / 外接屏切换后屏尺寸会变，缓存只会变旧。 */
  const cap = screenShortSide();
  const short = cap || Math.min(v.w || 0, v.h || 0);
  return short >= 1 && short < PHONE_MAX_SHORT;
}

/**
 * 设备屏的短边（逻辑 px；拿不到 → 0）。
 * `getWindowInfo()` 的 `screenWidth/screenHeight` 是**整块屏**（不是窗口），
 * 在 PC / 分屏 / Stage Manager 下都不随窗口变化 ⇒ 正是"设备能力"这一维。
 * ⚠️ 读不到就返回 0，让调用方退回几何判据 —— **绝不猜**一个值。
 */
function screenShortSide() {
  const i = readWindowInfo();
  const w = Number(i.screenWidth) || 0;
  const h = Number(i.screenHeight) || 0;
  if (!w || !h) return 0;
  return Math.min(w, h);
}

/* ================= 主入口 ================= */

/**
 * 返回 { orientation, landscape, portrait, scale, style, wrapStyle, viewport, forced }
 *   style     → 挂在 .stage 上（基准尺寸 ＋ transform ＋ --topbar-r）
 *   wrapStyle → 挂在 .stage-wrap 上（状态栏高于 24 时整块下移）
 *   vp 省略时自读视口；由 onResize 触发时请传 viewportFromResize(res)
 */
function fit(vp) {
  /* 防御：vp 不是「带 w/h 的视口对象」时一律自读 —— 否则会算出 scale(NaN)，
     而 NaN 在样式里是非法值会被静默忽略（transform 不生效，页面看起来只是「没缩放」），
     排查成本很高。 */
  const v = (vp && vp.w && vp.h) ? vp : readViewport();
  /* ★ 107 轮：`forced` 这个字段**保留但恒为 `''`** —— 下游（壳页 data、诊断面板）
     还在读它，删字段会波及一串消费点，而"没有强制"就是空串的语义本身。 */
  const f = '';
  /* 胶囊 / 缩放 / 垂直偏移 / 状态栏下推 top —— 与 portXxx() 三个出口共用同一份推导，
     保证「同一个视口 ⇒ 同一组 capTop / capH / s」（公式与含义见 capsuleMetrics）。
     ⚠️ 这里**不能**写成「v.h − top」（旧写法，第十六轮走查修掉）：
        画布下推 top 后垂直方向就少了 top，而画布高 800 / 1280 本来就是按整屏画的
        ⇒ 只能整体缩小才能塞进去，于是画布四周露出一圈页面底色。
        真机（MatePad Mini 竖屏 sb≈51–57）实测量到的就是：缩 ~2%、四周各露 8–10px；
        平时看不出来，一开抽屉/表单，遮罩只压画布 ⇒ 那一圈立刻被反衬成「整个页面四周
        有一圈的边」。IDE 里永远复现不了 —— 模拟器 statusBarHeight 只有 20 ≤ 24 ⇒ top = 0。
        正确做法：把下推掉的 top 从**底部留白**里还给画布（BOTTOM_SLACK）——
        那一段本来就是空的（底栏手势留白 / 工作区底 padding），沉出屏幕看不出来，
        而 scale 得以保持 1，几何与设计稿逐像素一致。 */
  const cm = capsuleMetrics(v);
  const o = cm.o;
  const b = cm.b;
  const top = cm.top;
  const slack = cm.slack;
  const availH = cm.availH;
  const s = cm.s;
  /* ★★ 184 轮：画布高（竖屏平板现算）—— 提到这里定义，下面 portHeights 与 style 都要用 */
  const canvasH = cm.canvasH;
  const minPad = o === 'port' ? 16 : 20;

  /* 画布在视口里的垂直偏移 —— 折算胶囊坐标时要用（画布坐标 = (视口Y − top − offY) / s）。
     ★ 第十六轮走查：垂直对齐**由这里显式决定**，不再一律 flex 居中。
       原因：画布一旦高于容器（横屏真机 top > 0 时就是），flex 的 center 会把多出来的
       部分**上下均分**，下推的 top 被吃掉一半（横屏 top 24 实测只生效 12），
       首个子标题比预期更贴状态栏。放不下就顶部对齐（flex-start），offY 归 0；
       放得下才居中 —— 小屏 / PC 上的居中原样保留。 */
  const wrapH = cm.wrapH;
  const centered = cm.centered;
  const offY = cm.offY;
  const cap = cm.cap;
  /* 竖屏品牌栏与原生胶囊同行：capTop / capH 就是胶囊（折算到画布坐标）的顶边与高度，
     由 CSS 的 --cap-top / --cap-h 消费（`components/brand-head` 的 top / height）。
     ⚠️ 拿不到胶囊时**不能写死 28** —— 那是「状态栏 24 ＋ 4」在 s＝1 下的特例。
        真机状态栏往往不是 24（MatePad Mini 竖屏实测约 57），必须按状态栏现算，
        否则兜底值会把品牌行顶到胶囊上方一整行（09-22 走查·十 真机截图即此症）。
        按「状态栏底 ＋ CAP_GAP_FALLBACK」估胶囊顶 —— 该间距由 MatePad Mini 竖屏实测反推
        （状态栏约 57、胶囊顶约 65.5），比微信通行值 4 大。详见 capsuleMetrics。 */
  const capTop = cm.capTop;
  const capH = cm.capH;
  const capRight = cap ? Math.max(0, v.w - cap.left) : 0;
  const padR = capRight ? Math.max(minPad, Math.ceil(capRight / s) + 8) : minPad;
  /* ★★ 竖屏三段高：状态栏占位 / 品牌行 / 工作区（204 起多出「让位段」与「滚动容器」）。
     品牌行的「有效高」必须把品牌行整个兜住 —— 它矮多少，那几像素就压进下面，
     静止页表现为「品牌行压住首个区块头、间隙没了」，滚动页表现为
     「内容透过没有背景色的让位段露出来」。详见 portHeights 的 ★★ 注释。 */
  const ph = o === 'port' ? portHeights(v, capTop, capH, canvasH) : null;
  const statusH = ph ? ph.statusH : LAND_HEAD;
  /* ★★ 204 轮：横屏**没有**品牌行（左导轨承担导航）⇒ capRowH 写 0、
     让位段整段就是顶部那一小条。竖横两态因此共用同一条读取口径：
     `--head-h` ＝ 内容首段要跳过的高度。
     ★★ 207 轮：横屏让位 12 → **6**（206 试过 0、太贴，已回退）⇒ `statusH ＋ capRowH ≡ headH`
     （6 ＋ 0）仍成立（`probe()` 就是按这条恒等式做自校验的，别只改 headH 不改 statusH）。 */
  const capRowH = ph ? ph.capRowH : 0;
  const headH = ph ? ph.headH : LAND_HEAD;
  const workH = ph ? ph.workH : portWorkH(v);
  const scrollH = ph ? ph.scrollH : (workH + LAND_HEAD);

  /* ★★★ 108 轮 · **手机端 letterbox 的水平出血量**（用户口径：*"渐变区两侧还是
     露出了底部背景"*）─────────────────────────────────────────────────
     ── 这是什么（先看它解决的那个真问题）──────────────────────────────────
     手机端走 `PHONE_BASE = 400×880`（竖），缩放是**取小**：
         s = min(vw / 400, vh / 880, 1)
     真机/模拟器上手机是"窄而长"（393×852 ≈ 1:2.17），而 400×880 是 1:2.2
     ⇒ 通常**高**先顶死（vh/880 < vw/400）⇒ s 由高度决定。
     例：393×852 ⇒ s = min(0.9825, 0.9682, 1) = **0.9682**
     ⇒ 画布宽 = 400 × 0.9682 = **387.3**，而视口是 **393**
     ⇒ **左右各露 ≈2.9px** —— 那一条由 `.stage-wrap` / `.stage` 画（`.ph` 已点白）。
     ── 为什么"点白"还不够（这才是本轮真正的病根）────────────────────────
     记录区 `.cp-tail` 的渐变**只铺到画布边界**（387.3），因为
     `.cp.phone` 是 `position: fixed`，而它的**包含块是 `.stage`**
     （`.stage` 有 `transform` ⇒ 成为 fixed 后代的包含块）⇒ `left:0/right:0`
     把 `.cp` 严格钉在**画布**里，而不是视口里。
     ⇒ 画布边上那 2.9px 的"页面白"就贴在渐变左右两缘：
        渐变一端是暖黄（`--yellow-warm`），紧邻却是一条纯白
        ⇒ 眼睛读成"渐变没铺满、两侧露出了背景"。
     ⚠️ 注意这与 106–107 的"页面/标题栏点白"**不是**同一件事：
        那两轮解决的是"上下两段同色"，这条解决的是"画布宽度不等于视口宽度"。
        点白只是把"灰缝"换成"白缝"——缝还在。
     ── 正解：把 `.cp` 按 letterbox 的宽度**向两侧出血**，铺满视口 ──────────
     出血量（**设计坐标**，因为在 `.stage` 里面，必须换算）：
         屏幕像素： (vw − 400·s) / 2
         设计像素： (vw − 400·s) / (2·s)  =  vw / (2·s) − b.w/2
     ⚠️⚠️ **必须换算成设计 px 再交给 CSS**：`.cp` 在 `.stage` 的 `scale(s)` 里，
         CSS 里写的每一个 px 都会被再乘一次 s。直接写"屏幕像素的缝宽"会**少出血
         一倍多**（s ≈ 0.97 时差 ~3%，s ≈ 0.5 时差一倍）—— 铁律 100 的同族错误。
     ⚠️⚠️ **绝不能用 `vw` 写这条**（107 轮上半场正是栽在这上面）：
         `vw` 不参与祖先 transform，在缩放画布里必然算错。
     ⚠️ 平板端一律 0：那边画布 1280×800 在目标机上基本顶死，
         且**抽屉本来就该是画布里的一张卡**，出血会让它越出画面。
     ⚠️ 只对 `phone` 生效；`Math.max(0, ...)` 夹住 —— 万一某台机器是宽顶死
        （vw/400 < vh/880，画布正好等于视口宽），出血量自然是 0。 */
  const isPhone = phone(v);
  const bleed = isPhone
    ? Math.max(0, Math.round((v.w / (2 * s) - b.w / 2) * 100) / 100)
    : 0;

  /* ★★ 184 轮：**画布高**（竖屏平板由视口现算，见 capsuleMetrics 的 ★★★ 段）。
     两个 CSS 变量一起下发 —— 全工程"画布高"只认这两个数，别再写 1280：
       --canvas-h  画布高本身（.stage 的 height 也用它，同一份值）
       --mask-h    遮罩高 ＝ 展示区高：竖屏平板 ＝ 画布高 − 底栏 88（遮罩不盖底栏）；
                   手机端没有底栏 ⇒ 就是画布高。三个竖屏遮罩（胶囊 .cp-mask.port /
                   抽屉 .dw-mask.port / 表单 .sd-mask.port）一律 var(--mask-h, 1192px)。
     ⚠️ 设计稿值 1280 / 1192 只作为 CSS 里的兜底（JS 还没跑的那一帧）。 */
  const maskH = Math.max(1, canvasH - (o === 'port' && !isPhone ? PORT_BNAV_H : 0));
  /* ★★ 185 轮：**横屏工作区高也不再是常量** —— 与竖屏同构，workH ＝ 画布高 − 让位段
     （理由见 capsuleMetrics 的 ★★★ 段）。★ 207 轮让位段 ＝ 6 ⇒ 横屏 workH ＝ **794**。
     ⚠️ 只对「横屏平板」现算：手机与竖屏一律留在设计稿值（画布高 − 6 = 794），
     免得把不适用这套骨架的形态一起带走。 */
  const landWorkH = (!isPhone && o === 'land')
    ? Math.max(1, canvasH - LAND_HEAD)
    : BASE.land.h - LAND_HEAD;
  return {
    orientation: o,
    landscape: o === 'land',
    portrait: o === 'port',
    /* ★ 手机 / 平板这一维 —— 只决定壳页渲染哪套骨架（见 PHONE_MAX_SHORT 注释）。
       ⚠️ 它与 `portrait` 是**两个**开关，不是一件事的两种说法：
          手机横屏（短边 390）是「landscape=true, phone=true」——
          但横屏骨架（左导轨）在手机上本来也不该出现，所以 phone 恒为 false 以外的
          情况一律按竖屏骨架走（见壳页）。 */
    phone: phone(v),
    scale: s,
    baseW: b.w,
    baseH: b.h,
    /* ★ 184 轮：当前画布高 / 遮罩高（画布坐标）—— 见上面那段 ★★ 注释 */
    canvasH: canvasH,
    maskH: maskH,
    /* ★ 185 轮：横屏主工作区高（画布坐标；手机 / 竖屏恒为设计稿 788）。
       全工程凡"横屏工作区高"的地方都该读它（写进 CSS 的 --work-h-land）。
       ★★ 204 轮：横屏的**滚动容器**高 ＝ 本值 ＋ 让位段（＝ 画布高），
          见下面的 scrollH。让位段（24）从固定层搬进滚动内容之后，两者不再相等。 */
    landWorkH: landWorkH,
    /* 204 轮：滚动容器高的横屏支 ＝ 画布高（竖屏支在 ph 里，见 portHeights） */
    landScrollH: landWorkH + LAND_HEAD,
    /* ★ 108 轮：手机端 letterbox 的水平出血量（**设计 px**，理由见上面那段注释） */
    bleed: bleed,
    forced: f,
    capTop: capTop,
    capH: capH,
    capOk: !!cap,
    viewport: v,
    /* ★★★ 183 轮 · `transform-origin` 必须与 `align-items` **成对**（iPad 适配轮的根因）──
       `scale(s)` 只改**视觉**、不改**布局盒**；`.stage` 基线绕 `center center` 缩放
       （app.wxss 那条是"JS 还没跑"时的兜底）。于是"画布放不下"这条路上：
         布局盒顶边贴在 wrap 顶（壳页给 `align-items:flex-start`，offY 语义 ＝ 0），
         但**视觉盒**整体下沉了 `b.h·(1−s)/2` —— 少乘这一次，整块画布就掉下去了。
       真机症状（iPad mini 6 竖屏 744×1133，s ＝ 0.9039 ⇒ 下沉 **61.5px**）：
         · 画布上方多出一条 61.5px 的 `--surface` 空白带，与品牌栏（也是 `--surface`）
           同色 ⇒ 用户读成「**顶部标题栏高度被异常加大**」；
         · 画布底边被推到 `61.5 ＋ 1280×0.9039 ＝ 1218.6`，而视口只有 1133 ⇒
           **底栏（画布 y1192–1280）整条落在视口外** ⇒「**底部导航栏没显示**」。
       ⇒ 放得下（centered）时维持绕中心 —— 那时布局盒本来就居中，
          `offY ＝ (wrapH − b.h·s)/2` 与实际视觉顶端**恒等**（手机端长期验证有效）；
          放不下时改成绕**顶边中点**，让视觉盒顶边回到 wrap 顶（＝ offY 的语义）。
       ⚠️ 横轴两种情况都用 `center`：`.stage-wrap` 是 `justify-content:center`，
          绕中点缩放后视觉盒左右仍居中 ＝ `(vw − b.w·s)/2` 的 letterbox 余量。
       ⚠️ iPad mini 是**唯一**长期踩到这条的设备：MatePad 两种姿态 s 恒为 1（视口 ≥ 基准，
          绕哪都一样）、手机端恰好落进 centered 分支 ⇒ 只有"比 800×1280 小且放不下"的视口才现形。
       判据 `工具/check_stage_origin_round183.js`（7 个视口 × 纵/横落位 ＋ 症状复现 ＋ 回归）。 */
    style: 'width:' + b.w + 'px;height:' + canvasH + 'px;transform:scale(' + s + ');' +
           'transform-origin:center ' + (centered ? 'center' : 'top') + ';' +
           '--canvas-h:' + canvasH + 'px;--mask-h:' + maskH + 'px;' +
           '--topbar-r:' + padR + 'px;--cap-top:' + capTop + 'px;--cap-h:' + capH + 'px;' +
           '--status-h:' + statusH + 'px;--cap-row-h:' + capRowH + 'px;' +
           '--head-h:' + headH + 'px;' +
           '--work-h-port:' + workH + 'px;--work-h-land:' + landWorkH + 'px;' +
           '--scroll-h-port:' + scrollH + 'px;--scroll-h-land:' + (landWorkH + LAND_HEAD) + 'px;' +
           '--cp-bleed:' + bleed + 'px;',
    wrapStyle: 'top:' + top + 'px;align-items:' + (centered ? 'center' : 'flex-start') + ';',
    statusH: statusH,
    /* ★★ 204 轮：titleH → capRowH（"品牌行高"），并新增 headH / scrollH。
       `workH` 语义未变（内容可视高）；`scrollH` 才是滚动容器的高。 */
    capRowH: capRowH,
    headH: headH,
    workH: workH,
    scrollH: scrollH
  };
}

/* ================= 尺寸变化：全局兜底通道 ================= */

let inited = false;

/**
 * 由 app.js 在 onLaunch 调一次：注册 wx.onWindowResize。
 * 真机旋转时它和 Page.onResize 会各响一次（幂等重排，代价可忽略），两条通道互为保险 ——
 * 只要有一条活，方向就不会僵在打开时的那一套骨架上。
 * 直接投递给**页面栈顶**页面（它才是需要重排的那一个）：不用订阅表，
 * 免得 reLaunch 重建页面后订阅表里积压失效引用。
 */
function init() {
  if (inited) return;
  inited = true;
  try {
    if (typeof wx.onWindowResize === 'function') {
      wx.onWindowResize(function (res) {
        note('windowResize', res);
        const vp = viewportFromResize(res);
        try {
          const ps = typeof getCurrentPages === 'function' ? getCurrentPages() : [];
          const top = ps[ps.length - 1];
          if (top && typeof top.layout === 'function') top.layout(vp);
        } catch (e) { /* 页面尚未就绪，忽略 */ }
      });
    }
  } catch (e) { /* 低版本不支持则只靠 Page.onResize */ }
}

/* ================= 诊断 ================= */

const DIAG = {
  onResize: 0,       // Page.onResize 触发次数
  windowResize: 0,   // wx.onWindowResize 触发次数
  show: 0,           // onShow 触发次数（切页回来时校一次）
  lastSource: '',
  lastAt: '',
  lastRes: null,
  lastViewport: null
};

/** 把回调对象压成可读结构：键名全留，size 逐字段留 */
function summarizeRes(res) {
  if (!res || typeof res !== 'object') return { raw: String(res) };
  const o = { keys: Object.keys(res) };
  if (res.size && typeof res.size === 'object') {
    o.size = {};
    Object.keys(res.size).forEach(function (k) { o.size[k] = res.size[k]; });
  }
  if (res.deviceOrientation) o.deviceOrientation = res.deviceOrientation;
  if (res.orientation) o.orientation = res.orientation;
  return o;
}

/** 记录一次方向事件（页面在 onResize / onShow 里主动调用） */
function note(source, res) {
  if (DIAG[source] === undefined) DIAG[source] = 0;
  DIAG[source] += 1;
  DIAG.lastSource = source;
  try {
    const d = new Date();
    DIAG.lastAt = ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) +
                  ':' + ('0' + d.getSeconds()).slice(-2);
  } catch (e) { DIAG.lastAt = ''; }
  // 只有真正带回调对象的事件才算「最近变化」；onShow 没带，别覆盖掉上一次的尺寸变化记录
  if (res === undefined) return;
  DIAG.lastRes = summarizeRes(res);
  const v = viewportFromResize(res);
  if (v) DIAG.lastViewport = { w: v.w, h: v.h, sb: v.sb, capRight: v.capRight };
}

function safe(fn, fallback) {
  try { return fn() || fallback; } catch (e) { return fallback; }
}

/**
 * 诊断快照 —— 真机上「方向不生效」时用它定位断在哪一环：
 *   · count.onResize 恒为 0              → Page.onResize 没来（多半 pageOrientation 没生效 ⇒ 小程序根本没旋转）
 *   · count.windowResize > 0 而 onResize 为 0 → 只有全局兜底通道活着
 *   · view.w/h 旋转前后不变              → 系统侧就没旋转（系统「自动旋转」未开 / 客户端方向锁）
 *   · view 变了但 land 没翻              → 判定基准或强制开关的问题
 *   · capsule.ok 为 false                → 原生胶囊 API 没返回可用值，品牌栏只能按
 *                                           「状态栏底 ＋ CAP_GAP_FALLBACK」兜底
 *                                           （竖屏品牌行会与胶囊差几像素）
 *   · port.headH ≠ capsule.canvasTop ＋ capsule.canvasH
 *                                        → 让位段没把品牌行兜住（第五十八轮的症状）。
 *                                          正常应恒有 headH ≥ 胶囊底；
 *                                          若否，说明 fit() 的新值没写进 --head-h，
 *                                          或 .workarea 的 padding-top 还在吃旧变量。
 */
function probe() {
  const f = fit();
  const raw = safe(function () { return wx.getMenuButtonBoundingClientRect(); }, null) || {};
  return {
    counters: JSON.parse(JSON.stringify(DIAG)),
    lastViewport: DIAG.lastViewport,
    nowViewport: { w: f.viewport.w, h: f.viewport.h, sb: f.viewport.sb, capRight: f.viewport.capRight },
    orientation: f.orientation,
    phone: f.phone,
    shortSide: Math.min(f.viewport.w, f.viewport.h),
    /* ★★ 2026-10-22：**屏短边**也报出来 —— `phone` 现在认的是它（见 `phone()` 的长注释）。
       真机复核"PC 矮窗口为什么还是工作台 / 平板分屏为什么不再是手机"时，
       把 `screenShort` 与 `windowShort` 一起看：前者 ≥ 600、后者可能 < 600。 */
    screenShort: screenShortSide(),
    scale: f.scale,
    forced: f.forced,
    /* ★ 第五十八轮：竖屏三段高也报出来 —— 真机复核「内容会不会从让位段下沿露出来」
       就看这几个数：headH 必须 ≥ 胶囊底，否则品牌行会压到内容首块。
       ★ 184 轮：再加上 canvasH / maskH —— 真机复核「画布有没有铺满视口、
         底栏有没有被沉到屏幕外」就看 canvasH × scale 是否等于视口高。
       ★★ 204 轮：多报 capRowH / headH / scrollH —— 复核「首屏与改动前是否逐像素一致」
         看 workH（必须与 204 之前同值）、「滚动容器有没有吃满」看 scrollH ＝ workH ＋ headH。 */
    port: f.portrait
      ? {
          statusH: f.statusH, capRowH: f.capRowH, headH: f.headH,
          workH: f.workH, scrollH: f.scrollH
        }
      : null,
    /* ★ 185 轮：横屏工作区高也报出来 —— 真机复核「横屏底部还有没有缝」看
       canvasH × scale 是否等于视口高；这条决定脑图画布（工作区 − 54）对不对得上。
       ★★ 204 轮：横屏也多报 scrollH（＝ workH ＋ 24），核对 .workarea 是否吃满。 */
    land: f.landscape ? { workH: f.landWorkH, scrollH: f.landScrollH } : null,
    canvas: { h: f.canvasH, maskH: f.maskH, baseH: f.baseH, fill: f.canvasH !== f.baseH },
    capsule: {
      ok: f.capOk,
      raw: raw.height
        ? { top: raw.top, bottom: raw.bottom, left: raw.left, width: raw.width, height: raw.height }
        : null,
      canvasTop: f.capTop,
      canvasH: f.capH,
      right: f.viewport.capRight
    },
    windowInfo: safe(function () { return readWindowInfo(); }, {}),
    device: safe(function () { return wx.getDeviceInfo ? wx.getDeviceInfo() : null; }, null),
    appBase: safe(function () { return wx.getAppBaseInfo ? wx.getAppBaseInfo() : null; }, null)
  };
}

module.exports = {
  BASE: BASE,
  DESIGN_W: BASE.land.w,
  DESIGN_H: BASE.land.h,
  PORT_W: BASE.port.w,
  PORT_H: BASE.port.h,
  /* ★ 103 轮 · 手机端基准画布（400×880）—— 与上面两块并列的**第三块** */
  PHONE_W: PHONE_BASE.w,
  PHONE_H: PHONE_BASE.h,
  AVOID_CAPSULE: AVOID_CAPSULE,
  PHONE_MAX_SHORT: PHONE_MAX_SHORT,
  orientation: orientation,
  phone: phone,
  readViewport: readViewport,
  viewportFromResize: viewportFromResize,
  capsuleMetrics: capsuleMetrics,
  portMetrics: portMetrics,
  portHeights: portHeights,
  portStatusH: portStatusH,
  portCapRowH: portCapRowH,
  portHeadH: portHeadH,
  portWorkH: portWorkH,
  portScrollH: portScrollH,
  landWorkH: landWorkH,
  init: init,
  note: note,
  probe: probe,
  fit: fit
};
