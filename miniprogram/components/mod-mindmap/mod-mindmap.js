/**
 * 脑图模块（FR-7 · ★ V8 改造）
 *
 * 形态：列表 ／ 详情 二态（FR-8）
 *   · 点导航「脑图」→ 有记忆就直接开那一张；没记忆 → 空态 ＋ 自动弹列表抽屉
 *   · 已经在某张脑图上、再点一次「脑图」→ 弹列表抽屉换一张
 *   · 新建 / 改名走表单抽屉（与待办、项目共用一套壳）
 *
 * V8 相对 V7 去掉：
 *   ❌ 顶栏「重新生成初稿」—— 模型生成依赖采集上下文，一期只保留条目、不实现（FR-7.4）
 *   ❌ 脑图侧展示关联待办
 *   ❌ 脑图「来源」字段
 * 保留：严格树编辑（插同级 / 插子级 / 删除 / 上下移）、缩放、导出 Markdown。
 *       ⚠️ 脑图可改名，项目名不可改。
 *
 * ★ 09-21 第四轮（对齐参考版 frontend-static参考版/components/mindmap-graph）：
 *   · 节点操作条从「容器下方单独一行」搬进**容器内底部居中浮条**（圆形图标钮）
 *   · 缩放控件从容器右下挪到**左下**
 *   · 取消容器内的「大纲」键（onOutline 一并删）与容器底部的灰色说明文字
 *   ⇒ 画布高度 +52（多了原节点操作行让出的 12＋40），PAD_BOTTOM 同步放宽到 84，
 *     给浮条（底 16 ／ 高 56）让位。
 *
 * ★ 09-21 第五轮（继续对齐参考版 —— 这一轮补的是**交互**，不是皮肤）：
 *   · **画布可拖**：单指拖空白 = 平移；双指 = 捏合缩放；PC 滚轮 = 以光标为轴缩放；
 *     「− 100% ＋ 适应屏幕」四个键**全部真生效**（之前是 toast「静态演示」）
 *   · **节点可拖**：按住 300ms 或位移超过 8px 进入拖拽 ——
 *     落在别的节点上 = 成为它的**子节点**；落在同级之间 = **插入到那个位置**（有指示线）
 *   · **连线改直角圆角折线**（参考版是正交连线，不是贝塞尔 S 曲线）
 *   · **PC 端**：鼠标拖拽 / 悬停高亮 / 滚轮缩放；键盘快捷键走 `wx.onKeyDown`（基础库 3.6.0
 *     起、**仅 PC 平台**，「更多」菜单里有键位说明）
 *   ⚠️ 参考版里的**「内容块」**（`content-table` / `content-code` / `content-quote`、
 *      可拖拽改尺寸、审批式预览）是另一个产品的概念，**本项目不抄** ——
 *      这里的脑图就是一棵**纯结构树**，节点只有 text。
 *
 * ⚠️ 视口（平移/缩放）与自动排版是**正交**的两件事：
 *    layout 决定「节点在画布坐标里的位置」，view 决定「画布怎么摆进容器」。
 *    所以怎么拖怎么缩都不会打乱拓扑 —— 拖动改的是**结构**，不是坐标。
 *
 * 节点坐标：按树结构自动排版（不再是写死的坐标表）——
 *   这样新建的脑图、以及用户手动加的节点都能落到画布上；拓扑与设计稿一致。
 *   横屏：深度 → 列（x 由左向右），叶子 DFS 顺序 → 行（y）；
 *   竖屏：深度 → 行（y 由上向下），叶子 DFS 顺序 → 列（x）。
 */
const store = require('../../utils/store');
const pub = require('../../utils/pagebase');
const stage = require('../../utils/stage');
const api = require('../../utils/api');
/* ★★ 275 轮：节点挂图的上传链路 —— 与闪念胶囊 / 待办表单**同一份实现**（全工程只此一份：
   选图 → 压缩 → 上传 → 回相对 uri），别在这里另写一套 `wx.chooseMedia` + `uploadFile`。 */
const imgpick = require('../../utils/imgpick');

/* 画布 ＝ 卡内容区（尺寸必须与 mod-mindmap.wxss 的 .mm-viewport / .links 一致）
   横屏 776−0−20−34 ＝ 722   （34 ＝ 区块头：行高 26 ＋ 下间距 8；横屏首块上头就是屏幕顶）
   竖屏 --work-h-port − 70；70 ＝ 上 12 ＋ 下 16 ＋ 区块头 42 ⇒ 设计稿 1128 − 70 ＝ 1058
   （演变：第四轮节点操作行搬进容器 ⇒ 600/996 → 652/1048；09-22 走查·上补区块头 ⇒ 618/1014；
     走查·下首块间距 16 → 20 ⇒ 614/1010；走查·尾横屏标题栏整条去掉 ⇒ 642；
     走查·六横屏顶部收敛 ⇒ 650；走查·十一横屏首块前 padding 12 → 0 ⇒ 662；
     走查·十二横屏首个区块头再吃掉自带 8 ⇒ 670；
     ★ 本轮：**画布下方那排脑图级操作行整条取消** ⇒ 让出 40 的行 ＋ 12 的 .mm-area gap，
       670 → **722** ／ 1006 → **1058**） */
/* ★★ 171 轮：这个文件的**纯核心**（常量 ＋ 度量 ＋ 六种排版 ＋ 折叠几何 ＋ 连线 ＋ 节点
   载荷 ＋ 视口工具）整段搬去了 `utils/mindmap-core.js` —— 因为「待办详情 · 关联脑图」
   那张**只读整图**必须与本模块画得一模一样，**唯一可行的办法是同一份实现**。
   ⚠️ 下面这一串是**同一个外部模块的解构**，不是本文件的局部定义。
      改这些函数请去 `utils/mindmap-core.js`（那里的注释也更全，且在那里改
      **两个调用方同时生效**：脑图模块 ＋ 待办详情的只读卡）。
   ⚠️ 判据脚本（check_mindmap_layout / links / drag / fold）按**源码切片**跑那一段，
      切片锚点在 `utils/mindmap-core.js` 里 —— 别把锚点注释改名。 */
const core = require('../../utils/mindmap-core');
const {
  CANVAS, syncPortCanvasH, syncLandCanvasH, HOLD_MS, DRAG_PX, TAP_PX, TAP_MS,
  PAN_STEP, ZOOM_STEP, WHEEL_K, PARENT_PAD, SCOPE_PAD, ADD_TEXT,
  VOICE_SEC, VOICE_SEND_SEC, VOICE_RESTART_GAP, VOICE_UP_MS, VOICE_STUB, fmtSec, REC_IN_TOOLS,
  isDevtools, rectWithCx, zoneMapOf, hostOf, pickParentId, slotIndexOf,
  slotMarkOf,
  anchorOf, wrapText, metricsMap, visibleTree, layoutOf, foldSideOf,
  buildNodes, ghostPayload, treeLink, boneLink, curveLR, renderBoxOf,
  boxLayerStyle, buildLinksUri, buildDragLinkUri, stageStyleOf, clampView, r2,
  dist2, fitViewOf, boxStyle, boxStyleInCard, ghostBoxStyle, dotStyleOf,
  coverOf, COVER_MIN,
  /* ★★ 2026-10-24（复审 P2-14）：「适应屏幕」允许低于用户缩放下限，
     `applyView` / `floorOf` 需要这两个值现算地盘。 */
  VIEW_MIN, VIEW_MAX
} = core;

/** 候选父节点切换的**驻留时长**（ms）—— ★ 第 211 轮 · P1-3。
 *  病根：黄框一像素抖动就换人（探针里那枚 2px 孤岛是极限形态），看起来"抖"而不是"吸"。
 *  取 80ms ≈ 5 帧：短到不影响正常拖拽，长到能吃掉边缘抖动。
 *  ⚠️ 只延迟**换父**，不延迟同父下的位次变化（那是连续的，延迟反而粘手）。 */
const CAND_HOLD_MS = 80;

/* ==========================================================================
   ★★★ 第 303 轮 · **PC 端那三件事的常量与判据**（双击编辑 / Tab·Enter / 操作提示）
   ──────────────────────────────────────────────────────────────────────────
   用户口径（逐字，四条）：
     「鼠标双击节点时，打开编辑弹窗。该行为仅在 PC 端生效。」
     「仅在选中节点时生效：按 Tab 新增下一级子节点；按 Enter 新增同级节点。」
     「当用户使用 PC 端登录并进入脑图详情页时，在画布内左上角显示一个操作提示……
       该提示支持用户关闭。」

   ── 为什么"PC 端"要单独有一个判据函数 ───────────────────────────────────
   本工程只有一套代码跑三处（手机 / 平板 / PC 小程序）。双击在**触屏上是有害的**：
   手机上"点一下选中、再点一下改主意"是极常见的连击，若双击就开编辑面板，
   用户会莫名其妙地掉进编辑态（而且面板会把底部浮条整条撑高）。所以这条行为
   必须由平台决定，不能由"有没有鼠标事件"去猜 —— PC 版微信会把鼠标动作
   也映射成 touch 事件，两条通道**同时在跑**（见 `beginGuard` 那段注释）。
   `wx.getDeviceInfo().platform` 在桌面端给 `windows` / `mac`，手机给 `ios` / `android`。
   ★ 开发者工具（`devtools`）算 **PC**：它跑在桌面上、有鼠标有键盘，双击与 Tab 都成立；
     否则这两条新交互在 IDE 里永远验不到（`wx.onKeyDown` 也只有桌面环境才派发）。
     ⚠️ 只在模块加载时读一次并缓存（`_deskEnv`）：平台在进程生命周期里不会变，
        而这个值每敲一次键盘、每点一下画布都要问 —— 不必去反复调同步 API。
   ========================================================================== */
const DBL_TAP_MS = 360;         /* 双击判定窗口（ms）。Windows 系统默认双击间隔 500，
                                   取 360：够接住"手快连点两下"，又不至于把
                                   "看完一个节点、隔半秒再点回来"读成双击。 */
const PC_TIP_KEY = 'mindmap.tip.pc';  /* 关掉就永久不再出现 —— 命名跟全工程已有的
                                         点分小写走（`agenttodo.token` / `ui.memory` /
                                         `capsule.hint.swipe`）。storage 在真机上跨版本
                                         共享，键名一改等于"全部用户又被提示一次"。 */
let _deskEnv = null;

/** 是否桌面环境（PC 小程序 / 开发者工具）—— 双击与键盘快捷键只在它为真时成立 */
function deskEnv() {
  if (_deskEnv === null) {
    const p = String((api.platformName && api.platformName()) || '').toLowerCase();
    _deskEnv = (p === 'windows' || p === 'mac' || p === 'devtools');
    /* ⚠️ 只认这三档，别写成 `p !== 'ios' && p !== 'android'` 那种反向判断 ——
       新平台一出现就会静默算成 PC，而错的那一侧正是"手机上凭空多出一个双击手势"。
       ⚠️ 全工程目前**只有这一处**按平台分叉（`utils/api.js` 的 `isDevtools` 是给联调基址
       用的、`mindmap-core` 里那个同名函数是给排版兜底用的，两者都别挪过来当它使）。 */
  }
  return _deskEnv;
}

/** 那条操作提示是不是已经被用户关掉了（读过一次就够，storage 是同步 API） */
function pcTipDone() {
  try { return !!wx.getStorageSync(PC_TIP_KEY); } catch (e) { return false; }
}

/* ==========================================================================
   ★★★ 第 219 轮 · 编辑面板正文区的**自适应高**（用户第 2 条）
   ──────────────────────────────────────────────────────────────────────────
   用户口径（逐字）：「高度别做成固定的，要根据节点中的文本长度进行一定的自适应，
   最大高度356没问题。」
   ⇒ 先 96 定死（112–219 上一版）不符；现在：**按文本折行数算高，下限 96、上限 276**
      （276 ＋ 两键 44 ＋ 一段 gap 12 ＋ 上下 padding 24 ＝ **面板 356**，
       即用户认可的那个上限。要改上限只动 `TA_MAX_H` 一处 —— 它和面板整高差 80）。
      ★ 254 轮：键排从 44 长到 **66**（操作键整体 ×1.5）⇒ 上限从 220 收到 **198**。
      ★ 255 轮：键排从 66 收到 **56**（操作键整体 ×1.25）⇒ 上限回到 **208**。
      ★★★ 256 轮：**编辑态不再渲染键排**（用户口径「弹窗顶部不显示按键……干脆就不显示按键了」）
        ⇒ 面板少了一整行（键排 56 ＋ 它下面那段 gap 12 ＝ 68），这 68 **全部并进正文区**：
        上限 208 → **276**，面板整高仍是 **356**（用户点名认可的那个数，
        也是手机端键盘弹起后放得下的那档）。
        ⚠️ 两处必须联动：**wxml 的键排显隐 ↔ 这里的上限**。
          只隐藏键排不改上限 ⇒ 面板静默矮掉 68（用户想解决的那个"文字面积"反而更小）；
          只改上限不隐藏键排 ⇒ 面板超高，顶到卡片上沿被裁。
          219/241 两条判据现在都现读 wxss 与会话条件，会当场报红。

      ★★★ 275 轮：**非根节点的面板多了一行挂图区**（用户第 3 条：「节点编辑弹窗中需要
        增加图片挂载编辑功能」，形态照闪念胶囊：96×72 的坑 ＋ 一句提示）。
        ⇒ 组成多了 `图区 72 ＋ 一道 gap 12 ＝ 84`，两条路只能二选一：
           · 让面板长到 440 —— **不行**。手机端键盘弹起后能容纳的面板高是**硬的**
             （256 轮那笔账：卡 ≈ 695 CSS、键盘 ≈ 294 CSS ⇒ 可用 ≈ 401 CSS ≈ 418 设计 px），
             440 会顶出屏幕，被裁掉的正是**用户正在写的那几行字**；
           · 从正文区里匀 —— **选这条**：上限 276 → **220**。
        ⇒ 面板整高分两档（正文上限下的整高）：
             根节点（无图区）  ＝ 220 ＋ 80  ＝ **300**
             其余节点（有图区）＝ 220 ＋ 164 ＝ **384**（384 × 0.959 ≈ 368 CSS ＋ 键盘 294 ≈ 662 ＜ 695 ✔）
        ⚠️ 220 仍**大于** 219 轮之前的 208 —— 这不是"把字又挤小了"，是"多了一整块功能之后
           还能写的字比没有挂图功能之前还多一点"。
        ⚠️ 三个数必须一起动：本常量、wxss 的图区（72）、以及 `工具/check_ta_autofit_round219.js`
           与 `check_ta_scroll_round241.js` 里的面板整高期望值（它们现读本常量 ＋ wxss）。
   ⚠️⚠️ 为什么这里是**全工程唯一"JS 算几何"的例外**（112 轮那条"一个几何量都不算"）：
      CSS 唯一的自动高手段是 `auto-height`，而铁律 106 已把它钉死 —— 它只认真机键盘的
      实时输入（模拟器永远不长、程序回填更不认），拿它定高等于"高度看环境"。
      另一半是"幽灵文本 + 绝对定位 textarea"那套纯 CSS 量法：它要求两个盒子**折行逐字
      一致**，而 textarea 在真机是**原生层**、幽灵在 Web 层 —— 正是本轮之前反复栽过的
      "两套控件复刻同一段文字"。⇒ 只能用**同一个折行器**估：`wrapText`（节点卡片的排版
      用的就是它，见 utils/mindmap-core.js）。
   ⚠️ **估宽一律偏大**（`emOf` 是上沿值）⇒ 行数只会**多算**、不会少算 ⇒ 最坏情况是
      "框比内容高一点（多一条空白行）"，绝不会出现"算矮了一行 ⇒ 又冒滚动条"。
   ========================================================================== */
const TA_FS = 15;         /* 与 `.mf-ta` 的 font-size 逐值同源（下发时 ×s，见 `nativePx`） */
const TA_LINE_H = 22;     /* 与 `.mf-ta` 的 line-height 逐值同源（下发时 ×s） */
const TA_BOX_EXTRA = 20;  /* 上下 padding 9×2 ＋ 上下描边 1×2 —— 行数之外的那个常量 */
const TA_MIN_H = 96;      /* 下限 ＝ 112 轮那版（≈3.4 行）：短节点回到原样，不空撑 */
const TA_MAX_H = 220;     /* 上限 ＝ 非根面板整高 384 − 其余 164（275 轮：多了 96×72 的挂图区） */
/* 面板与正文区的**宽度链**（★ 275e 起：这一串是全工程唯一出处，判据现读对撞）
     · `.mm-float.editing` 的 `width: 440px` ⇒ 面板 border-box ＝ 440；
     · 面板 padding 12×2 ＋ 面板描边 1×2 ⇒ 外框 `.mf-ta-box` 被 stretch 撑到 414；
     · 外框 padding 8×2 ＋ 外框描边 1×2 ⇒ 正文区实宽 ＝ **396**（＝ 440 − 44）；
   · 手机（`PHONE_BASE` 400 宽、`stage.phone()` 判短边）被限宽链压到面板 **342**：
       卡内容盒 366（1px 描边 ×2）→ `.mm-float-wrap` 的 `max-width: calc(100% - 8px)` ＝ 358
       → `.mm-float.editing` 的 `max-width: calc(100% - 16px)` ＝ 342（256 轮的贴边 4 ＋ 面板 margin 8 ×2）
     ⇒ 正文区实宽 ＝ 342 − 44 ＝ **298**。
     ★ 256 轮那条"手机 21 → 19"就是这条链压窄 8 的结果；旧值 21 是按"面板 ＝ 368"算的
       （漏掉了 wrap 限宽与面板 margin），本来就偏乐观一档。
   ⚠️ `TA_CHROME_W ＝ 44` 不是凑的：24（面板 padding）＋ 2（面板描边）＋ 16（正文
      padding 8×2）＋ 2（正文描边）。**别按 46 抄** —— 漏掉面板描边那 2，宽就多算 2。
      ★ 275f：正文 padding 从 10 收到 8，这里就从 48 收到 44（正文区 392 → 396）。
        为什么非要多这 4px：真机量出字距是 **15.08 设计稿 px/字**（不是标称 15），
        392 ÷ 15.08 ＝ **25.995** —— 差 0.08px 装不下第 26 个字 ⇒ 每行末尾空掉整整
        一个字。396 ÷ 15.08 ＝ 26.26 ⇒ 第 26 个字进得去，行末余量只剩 ~3px。
        完整推理见 wxss 里 `.mf-ta` 那段 275f。
   ⚠️ 这两个宽度不只是"估行数"用的：它还**行内下发给 textarea 当 `width`**
      （275e 的核心，理由见开面板那段 `editTaW` 的注释）⇒ 两处必须同源，
      改一处就等于让"框"和"字"分家（275d 的病就是这么来的）。 */
const TA_PANEL_W_WIDE = 440;
const TA_PANEL_W_PHONE = 342;
const TA_CHROME_W = 44;
const TA_W_WIDE = TA_PANEL_W_WIDE - TA_CHROME_W;    /* 396 */
const TA_W_PHONE = TA_PANEL_W_PHONE - TA_CHROME_W;  /* 298 */
/* 每行放得下几个**全角宽**（字号 15）—— 由上面那条宽度链现算，别再手抄：
     396/15 ＝ 26.4 ⇒ 26 ／ 298/15 ＝ 19.87 ⇒ 19（与 219/256 两轮的数字逐值相同）。
   ★ 275f：`/TA_FS` 这里仍是按**标称** 15 算的，而真机实测字距 15.08 —— 差 0.5%
     对 26/19 这两个取整结果没有任何影响（396/15.08 ＝ 26.26、298/15.08 ＝ 19.76，
     取整还是 26/19），所以不必为一个测出来的小数去改常量。
   ⚠️ 方向必须记牢：这个数**只许偏小**（行数只会多算）。取大了 ⇒ 算出的高度比内容矮 ⇒
      明明能放下一整行却又冒出滚动条（219 轮用户报的就是这个）。
   ⚠️ 手机这一支不能漏：漏了就是"PC 上算对了、手机上又冒滚动条"（手机才是窄的那头）。 */
const TA_EM_WIDE = Math.floor(TA_W_WIDE / TA_FS);
const TA_EM_PHONE = Math.floor(TA_W_PHONE / TA_FS);

/* ==========================================================================
   ★★★ 275b 轮 · 正文区的字**必须自己乘一遍 s**（用户第 1 条：编辑弹窗文字显示错位）

   ── 现象 ─────────────────────────────────────────────────────────────────
     挂了图之后编辑面板里那几行字"错位"：首行贴顶/被切、下面却空出一截。

   ── 病根 ─────────────────────────────────────────────────────────────────
     `textarea` 是**原生控件**，它的字**不吃祖先 `transform: scale(s)`**，而框（一个普通
     view）是吃的。`.mf-ta` 里写的是 `font-size:15px; line-height:22px` —— 那是**设计稿 px**：

       · 手机端 s ≈ 0.96 ⇒ 框缩了、字没缩 ⇒ 字相对框大**约 4%**；
       · iPad 横屏 s ≈ 0.885 ⇒ 大到**约 13%**。

     字一大，实际折行就比 `taHOf`（按 15／22 的设计稿口径估的）**多出一行**，而框高是按
     估的行数给的 ⇒ 内容装不下 ⇒ 原生自己滚一屏，用户看到的就是"第一行被切掉、底下空一块"。
     275 之前不显眼，是因为上限还是 276、面板有余量把这一行的误差吃掉了；挂图把正文区
     压到接近下限（96）之后，误差立刻露出来。

   ── 修法（与闪念胶囊 149／155 轮**同一条**，别再各自发明）───────────────
     `font-size` / `line-height` 由**行内**按 `设计稿 px × s` 下发；`.mf-ta` 里那两个数
     退化成"老基础库不认行内时的兜底"。这样框与字在**屏幕上**是同一档，`taHOf` 的设计稿
     口径也重新对得上（框高和行高都按设计稿算，同乘 s 之后仍然自洽）。

   ⚠️ `s` 用**量出来的**那份（`measure()` 里 `r.width / (画布宽 × sv)`），不是
      `stage.fit().scale` —— 前者是渲染真值，上游将来多一层缩放也不会漏账。
   ⚠️ 取不到就按 1 办（＝ 与改动之前逐字相同，不会更坏）。
   ========================================================================== */
/** 平台缩放 s —— 优先用量出来的真值，退到 `stage.fit()`，再退到 1 */
function stageScaleOf(card) {
  if (card && card.s > 0) return card.s;
  try {
    const f = stage.fit();
    return (f && f.scale) || 1;
  } catch (e) {
    return 1;
  }
}
/** 设计 px → **原生控件该写的数**（＝ 设计 px × s），保留两位小数 */
function nativePx(designPx, s) { return Math.round(designPx * s * 100) / 100; }

/** 一段文本在面板里折成几行 ⇒ 正文区该多高（px，已夹在 [TA_MIN_H, TA_MAX_H]）
 *  ⚠️ 一律用**设计稿**口径（15／22）估 —— 下发给原生的那份是 ×s 的，两者同乘一个 s
 *     之后行数完全一致，所以这里不需要也不该出现 s。 */
function taHOf(text, em) {
  const lines = wrapText(text, em).length;
  const h = lines * TA_LINE_H + TA_BOX_EXTRA;
  return Math.max(TA_MIN_H, Math.min(TA_MAX_H, h));
}

/** ★★★ 275c：外框总高 → **textarea 自己的高**（减掉外框吃掉的那 20：padding 9×2 ＋ 描边 1×2）
 *
 *  为什么要有这一步：原生 textarea **不认 `box-sizing: border-box`** —— 它的 `height`
 *  只作用于内容盒，padding 与描边是另外加的。所以 padding 一旦留在 textarea 上，
 *  实际渲染就比布局高 20、宽 20（向右出血），下面的挂图区就会被一条**看不见的空白带**顶开
 *  （用户第二次报的"没充满外框"就是这个）。
 *  ⇒ padding/描边搬到外框 `.mf-ta-box`，textarea 的 `padding:0 / border:0`，
 *    它要的就是"外框高 − 外框自己吃掉的那 20"。
 *  ⚠️ 夹一个下限：极端小的值会让原生控件算出一片负的内容区。 */
function taBodyHOf(h) {
  return Math.max(40, h - TA_BOX_EXTRA);
}

/* ★★ 280 轮：轮询的两个数（模块级常量，**不能**放在 `pub.comp` 的配置里 ——
   `comp()` 会把"非 data 的键"统统塞进 `methods`，而 methods 里必须是函数；
   一个数字混在里面轻则告警、重则被框架丢掉，读出来变 `undefined` ⇒ 定时器间隔 NaN）。 */
const AI_POLL_MS = 3000;      /* 3 秒一轮（§7.5） */
const AI_POLL_MAX = 40;       /* 最多 40 轮 ≈ 2 分钟；真实生成 20–60 秒 */

Component(pub.comp('mindmap', {
  data: {
    mindmapId: '',
    name: '',
    projectId: '',
    projectName: '',
    /* ★ 审查-02 P1-17：走 `store` 的统一色出口（原先是裸写 `#8E91A0`） */
    projectColor: store.noneColor(),
    projectArchived: false,
    nodes: [],
    /* ⚠️ 连线必须**成对**下发：`linksUri` 是图，`linksStyle` 是这张图的**渲染盒几何**
       （SVG 拿它当 viewBox —— 排版允许节点摆到画布外，固定尺寸会把连线剪掉，
       见 `renderBoxOf` 那段）。只改一个 ⇒ 线整体偏掉或消失。 */
    linksUri: '',
    linksStyle: '',
    treeSelected: '',
    selNode: null,

    /* —— ★ 本轮：子标题右侧那一行信息（脑图名 ／ 所属项目 ／ 更新时间）——
       三样都在 `.sec-head` 的右端；「所属项目」可点，跳项目模块（原来那行
       脑图级操作行里的项目胶囊搬到这里）。 */
    updated: '',

    /* —— ★ 本轮：画布顶部工具栏 ——
       左组「撤销 / 重做」（真改树，`canUndo`/`canRedo` 决定置灰），
       右组「格式 / 导出 / 编辑」。格式那三样也进子标题行太挤，统一放画布顶。
       `formatKey` 供「格式」弹窗打勾（原 `formatLabel` 是死字段 —— 审查-02 P2-28 已删）。 */
    formatKey: '',
    canUndo: false,
    canRedo: false,

    /* —— ★ 本轮：瞬时缩放比例 ——
       画布左下角那排缩放控件（−／100%／＋／适应屏幕）整条撤掉，改成
       **缩放时浮现、停下来约 900ms 后自动淡出**的一枚胶囊。
       ★ 253 轮：它自己从**左下**搬到了**左上**（左下那格让给节点操作条），
         显隐口径一个字没变。
       `zoomShow` 是它的显隐，`zoomPct` 仍是同一个值（applyView 一处写）。 */
    zoomShow: false,

    /* —— ★ 审查-02 P1-8：PC 端**悬停**命中的节点 id ——
       文件头第五轮起就写着「PC 端：鼠标拖拽 / 悬停高亮 / 滚轮缩放」，但悬停那半句
       一直是空承诺：`gsMove` 未按下时第一站就 return，鼠标划过节点毫无反馈。
       现在由 `gsMove` 的未按下分支写它（**变了才 setData**：mousemove 每秒几十次，
       逐帧写会把渲染层压垮），节点据此挂 `.hv`。空串 ＝ 没悬在任何节点上。 */
    hoverId: '',

    /* —— ★★★ 303 轮：**画布左上角那条 PC 操作提示**是不是该显示 ——
       用户第 4 条（逐字）：「当用户使用 PC 端登录并进入脑图详情页时，在画布内左上角
       显示一个操作提示……该提示支持用户关闭。」
       三个条件同时成立才为真：① 桌面环境（`deskEnv()`）；② 用户从没关过它
       （storage `mindmap.tip.pc`）；③ 当前确实开着某张脑图 —— ③ 由模板那层
       `wx:if="{{mindmapId}}"` 负责，这里只管前两条。
       ⚠️ 只在这里判一次（onLoad），**不进 refresh()**：refresh 一次进图会跑好几趟，
          在那儿判就得额外记住"用户刚关掉的别又给我打开"，反而多一个状态。
       ⚠️ 关了就是永久关（落 storage）—— 与胶囊那条一次性左滑引导同一条口径；
          它贴在画布左上角，每次进图都弹回来会变成一块挥之不去的东西。 */
    pcTipOn: false,

    /* ⚠️ 第 81 轮**删除** `fmt: { open: false, current: '' }` ——
       它是格式主弹窗（`<format-drawer id="fmt-drawer">`）的状态。用户口径
       「原有的'格式'及其抽屉取消，编辑中本身就有格式调整功能」⇒ 弹窗、它的状态、
       它的两个开合方法（`onFormat` / `onFormatClose`）一起撤掉。
       换格式的能力**没丢**：走顶部「编辑」抽屉里那一行格式选择。 */

    /* —— ★ 第 70 轮：节点操作浮条（五颗键 · 三组）——
       用户口径（★ 第 81 轮更新 · ★ 258 轮对调组序）：
         加子节点 ｜ 加同级节点 ‖ 语音 ｜ 编辑 ‖ 删除
       （258 轮用户：「将中间的两个按键移至左侧，录音和修改按键移到按键组中间」——
        只换 DOM 顺序，键数 / 分组 / 置灰 / 手势一个都没动。）
       （「展开 / 收起」第 81 轮搬去了顶部工具条 —— 见 wxml 的 `.mm-tools`。）

       `editId`    ★★ 第 112 轮换形态：正在文本编辑的节点 id。它现在只驱动**两件事**——
                     ① 画布上那一格挂 `edit` 类（wxss `mm-flash`：原有黄框之上**闪**）；
                     ② 底部浮条挂 `editing` 类（同一条胶囊就地长高成"键排／textarea／
                        取消·保存"三行）。
                   ⚠️ 卡片里**不再有任何输入控件**（82–89 轮那版整条作废）——
                      所以这里既不需要行数组、也不需要宽高，**一个几何量都不算**。
       `editText`  面板 textarea 里的当前内容；「保存」/ 点画布时写回 store。
                   ⚠️ 它现在是**原文**（不再是从 `_M[id].lines` 拼回来的折行结果）⇒
                      硬换行（`\n`）也能原样带进节点（`wrapText` 把 `\n` 当硬换行，见那边注释）。
       `editTaH`   ★★ 第 219 轮：正文区当前高度（px），**按文本折行数现算**——
                   开面板时按节点原文算一次、每敲一下就重算（`taHOf`）。
                   ⚠️ 只在"跨行"那一下才 setData（见 `onEditInput`）；不需要退场复位，
                      下次开面板必定重算（下限 96 / 上限 276，见文件头那两个常量）。
       `voiceId`   正在**录音或识别**的节点（呼吸光圈、遮罩、倒计时都挂它）
       `voicePhase` '' ｜ 'rec'（录音中，带 60s 倒计时）｜ 'up'（语音识别中，等识别结果）
       `voiceClock` 遮罩上那一行字 —— 'rec' 阶段是**纯秒数倒计时**（`60` → `1`，
                     ★ 第 89 轮用户口径，原来走 `mm:ss` 显示成 `01:00`）；
                     'up' 阶段直接装状态文案「语音识别中」
       `delArmed`  「删除」的**第一段**：点一次只把图标染成正红，再点一次才真删。
                   点任何别的键都会把它收回去。

       ★★ 275 轮 · 编辑面板里的**四件图状态**（与闪念胶囊的 `editImg*` 同名同义）：
       `editImgOn`   这块图区**该不该出现** ＝ `!selNode.root`（用户第 4 条：原点没有挂图功能）。
                     开面板时算一次 —— 别在 wxml 里现写 `!selNode.root`：编辑态 `selNode`
                     与 `editId` 万一那一刻不同步，就会出现"编辑 A、图区却在说 B"。
       `editImgUri`  草稿的**相对 uri**（库里存的就是它）；空串 ＝ 没挂图。
                     ⚠️ 与 `editText` 同档：**只活在草稿里**，`commitEdit()` 才写回 store。
       `editImgUrl`  喂 `<image src>` 的那个（本地临时路径 / 完整地址）—— 先本地预览、不等上传。
       `editImgUp`   正在上传：挡保存（见 `commitEdit`）＋ 挡住换图 / 撤图。
       `editImgAr`   草稿那张图的**宽高比**（宽/高；0 ＝ 不知道，走 4:3 兜底）。
                     ★ 275b：节点上的图"宽度固定、高度按比例"，这个比例要**跟着图一起入库**
                     （`imageRatio`）—— 排版层是纯函数，拿不到图也调不了 `wx.getImageInfo`。
       `taFs` / `taLh`
                     ★★★ 275b：正文区字属性的**真值**（设计稿 15／22 × 平台缩放 s）。
                     `textarea` 是原生控件，不吃祖先 `transform: scale(s)` ⇒ 必须自己乘一遍，
                     否则字比框大 4%~13%、折行数与 `taHOf` 的估算对不上 —— 那正是用户报的
                     "编辑弹窗文字显示错位"。整段推理见上面 `stageScaleOf` / `nativePx`
                     那一段注释（与闪念胶囊 149／155 轮同一条，别再各自发明）。
       `editTaBodyH`
                     ★★★ 275c：喂给 **textarea 自己**的高度（＝ `editTaH − TA_BOX_EXTRA`）。
                     `editTaH` 是**外框**（`.mf-ta-box`，普通 view）的总高；textarea 身上
                     已经没有 padding / 描边了（那 20 全在外框上）⇒ 它只需要剩下的内容高。
                     ⚠️ 两个数**必须一起下发**：只改 `editTaH` 会让字区比框高一截、
                        只改 `editTaBodyH` 会让外框框住一片空气。 */
    editId: '',
    editText: '',
    editTaH: TA_MIN_H,
    editTaBodyH: TA_MIN_H - TA_BOX_EXTRA,
    /* ★★★ 275e：正文区的**宽度**也必须行内下发（原生 textarea 只认 px 宽）。
       首帧兜底取宽形态那档 —— 面板是 `wx:if="{{editId}}"` 起的，真正上屏的那一帧
       一定和 `editId` 同一次 setData（下面 runAct('edit') 里 `editTaW` 与 `editTaH` 一起发），
       所以这个初值只是"万一"的兜底，不参与正常路径。 */
    editTaW: TA_W_WIDE,
    taFs: TA_FS,
    taLh: TA_LINE_H,
    editImgOn: false,
    editImgUri: '',
    editImgUrl: '',
    editImgUp: false,
    editImgAr: 0,
    voiceId: '',
    voicePhase: '',
    voiceClock: '',
    delArmed: false,

    /* —— 视口（★ 第五轮）：画布平移 + 缩放 ——
       stageStyle 挂在 .mm-viewport 上，节点层与连线层都在它里面 ⇒ 一起动。
       百分比显示在缩放胶囊上，与真实缩放保持一致（不再是写死的 100%）。 */
    stageStyle: '',
    zoomPct: '100%',
    viewScale: 1,
    viewTx: 0,
    viewTy: 0,

    /* —— 拖拽反馈（★ 第 66 轮起；★ 第 68 轮按参考图整块重做）——
       六件：前五件是画布上的标记，最后一件是"判定点"（★ 2026-10-09 新增）：

         dragGhost    跟手的那块**节点本体**（白底半透 ＋ 品牌黄实线描边 ＋ 浮起阴影）；
                      ⚠️ 形状＝`{lines, cls, style}`，**由 `ghostPayload()` 一处产出**
                      （beginDrag 与 updateDrag 共用）—— 见 `ghostPayload` 上面那段
         dragDot      **判定点**小圆环（★ 2026-10-09）—— 压在被拖节点的**正中心**（★ 第 211 轮），
                      告诉用户"系统拿这个点在找父节点"。⚠️ 恒定屏幕尺寸，别跟着缩放缩
         dragSrc      原位那枚**灰色虚线框**（＝被拖节点自己原来占的那一格）
         dragScope    被拖节点**整棵子树**的**品牌黄虚线圆角大框**（"这一窝要跟着走"）
         dragParent   当前**候选父节点**：品牌黄**实线**描边框（随拖动而**换人**；
                      拖到没落点的地方时转成**灰虚线**＝取消态，见 `dragMarkPayload`）
         dragSlot     **落位标记**（★ 第 211 轮）—— 带序号的小黄点，"松手后排第几位"
         dragLinkUri  候选父节点 → 浮动节点 的**品牌黄预览折线**，单独一层压在最上面
                      ⚠️ 与 `hlStyle` **成对下发**（uri 是图、hlStyle 是这张图的渲染盒）

       ⚠️ 第 68 轮删掉的：`dragTip`（child ／ sibling 两态）——
          "手指底下的节点"与"同级插入竖线"这两套口径一起作废，
          统一成 `dragParent`（唯一候选父节点）＋ `store.moveNodeTo({index})` 精确落位。

       ⚠️ ghost 挂在 `.mm-card` 的**容器坐标**（尺寸恒定，不随画布缩放，
          所以位置要按 tx + sv·c 现算）；src / scope / parent / link 都挂在
          **画布坐标**（跟着画布一起缩放平移）。两套坐标别写串。
       ⚠️ 原来那件 `dragSub`（整棵子树随行）**已删除** —— 见 `updateDrag` 上面的注释。

       ★ 2026-10-09 **新增 `dragDot`** —— 判定点小圆点（容器坐标，与 ghost 同一套）：
         它就是"系统拿哪个点去找父节点"的**可见化**。★ 第 211 轮起它压在**节点中心**
         （旧口径是"朝向父节点那一侧边的中点"，见 `anchorOf` 的函数头）。拖拽全程跟着节点走、
         位置不变，一旦它落进别的节点 / 那片孩子带 ⇒ 那个节点亮起 `dragParent` 框。
         清它的地方与另外几件**完全一样**（refresh 两处 ＋ endDrag）。 */
    dragGhost: null,
    dragDot: null,
    dragSrc: null,
    dragScope: null,
    dragParent: null,
    /* ★ 第 211 轮 **新增 `dragSlot`** —— 落位标记（容器坐标，恒定 16px 不吃缩放）：
       在候选父节点的孩子序列第 `index` 位画一枚带序号的小圆点，回答"松手后**排第几**"。
       ⚠️ 它**不是**第 68 轮删掉的那条同级竖线：那条说"手指现在压在哪两人之间"（过程），
          这枚说"松手后确定排第几"（结果）。别把线搬回来。 */
    dragSlot: null,
    dragLinkUri: '',
    hlStyle: ''
  },

  /* ══════════════════════════════════════════════════════════════════════
     ★★ 280 轮 · **「生成中 → 完成」的感知**（全工程第一处网络轮询）
     ──────────────────────────────────────────────────────────────────────
     背景：语义转脑图是**异步**的 —— 受理后立刻返回一张「语义转脑中」的占位卡，
     模型在后台跑二三十秒。而本工程**在此之前没有任何网络轮询**
     （`setInterval` 只有胶囊录音与脑图语音计时两处），所以这一层要新写。

     ── 为什么不靠 `GET /sync` ──
       sync 是**全量**快照（几百 KB）。为了看一张卡的状态每 3 秒拉一次全量，
       等于把"启动一次"的成本按轮询频率重复付。所以专门有一个轻接口
       `GET /mindmaps/ai-pending`，只回"还需要看一眼"的那几条。

     ── 三个停止条件（缺一个都会变成后台常驻请求）──
       ① **没有 pending 了** —— 每轮回来都问一次 `store.anyMindmapAiPending()`；
       ② **进了后台就停** —— `wx.onAppHide`（组件拿不到页面的 onHide，见 `_startAiPoll`）；
       ③ **次数上限** `AI_POLL_MAX` ／ **请求失败** —— 前者到点说明服务端卡住了
          （会被启动 `sweep` 收拾）；后者断网时不停只会把错误刷屏。

     ── 为什么挂在 `refresh()` 上，而不是生命周期 ──
       `refresh()` 已经是"这个模块现在有内容要画"的唯一入口（页面切回来、换图、
       编辑后都走它）。挂在这里等于自动获得"用户回到脑图模块"这个时机，
       也不必去覆盖 `pub.comp` 可能已经包过的 `attached` / `detached`
       （那会波及五个模块）。

     ⚠️ **已知取舍**：用户切到**别的模块**时这里不会立刻停（组件不 `detached`，
       只是不再 `refresh()`），最多还会跑 2 分钟（几十个轻接口）。
       小程序**进后台**那一档已经由 `wx.onAppHide` 堵住了 —— 那才是真正耗电耗流量的场景。
     ══════════════════════════════════════════════════════════════════════ */

  /** 起轮询（幂等：已经有一只在跑就直接返回） */
  _startAiPoll: function () {
    const self = this;
    if (this._aiTimer) return;
    this._aiTick = 0;
    /* ★★ 280 轮 · 停止条件②：**进了后台就停**（§7.5）。
       ⚠️ 组件拿不到页面的 `onHide`（五个模块是常驻的，壳页只切 display），
          能听见的只有小程序级的 `wx.onAppHide` —— 这正是"别在后台持续发请求"要防的那件事。
       ⚠️ 回调必须是**同一个函数引用**才能 `offAppHide`（匿名函数摘不掉，会越堆越多）。 */
    if (!this._aiHide && typeof wx !== 'undefined' && wx.onAppHide) {
      this._aiHide = function () { self._stopAiPoll(); };
      wx.onAppHide(this._aiHide);
    }
    this._aiTimer = setInterval(function () {
      self._aiTick += 1;
      /* 停止条件③：到上限（3 秒 × 40 ＝ 2 分钟）。到点仍在 pending ⇒ 停，
         卡面上那句「生成中，稍后查看」继续挂着 —— 不弹任何提示（用户可能已经在做别的）。 */
      if (self._aiTick > AI_POLL_MAX) { self._stopAiPoll(); return; }
      /* ★★★ 2026-10-27（全量检查 F14）· **在途锁**：上一轮还没回来就不再发。
       * ── 病根：`setInterval` 不看上一轮结束没有。弱网下一次查询要 5 秒，
       *    那就是每 3 秒压一条、几条同时在途，回来的顺序也不保证
       *    （`refreshMindmapAi` 会把同一张卡反复写成不同状态）。
       * ── 现在：`_aiBusy` 期间本轮直接跳过（只让计数走），回来的那一轮再把下一轮放开。
       * ⚠️ 不改成"回来后 setTimeout 再排下一次"是为了不动既有的 3 秒节拍与停止条件
       *    （那套已经被真机验收过）；在途锁解决的是重叠，不是节拍。
       * ⚠️ 失败**仍然停**（断网时反复重试只会耗电）；`refresh()` 会把轮询重新起起来。 */
      if (self._aiBusy) return;
      self._aiBusy = true;
      store.refreshMindmapAi().then(function (n) {
        self._aiBusy = false;
        /* `n === 0` ⇒ 这一轮什么都没变，**不重画**（每 3 秒无条件 setData
           会让整个列表白重画一遍，真机上能看出抖动） */
        if (n) self.refresh();
        /* 停止条件①：没有 pending 了 */
        if (!store.anyMindmapAiPending()) self._stopAiPoll();
      }, function () {
        self._aiBusy = false;
        /* 请求失败也停 —— 断网时每 3 秒重试一次只会耗电，而下次 `refresh()` 还会重新起 */
        self._stopAiPoll();
      });
    }, AI_POLL_MS);
  },

  /** 停轮询（清定时器 ＋ 摘掉后台监听，并把计数归零 —— 下次开始时是全新的一轮） */
  _stopAiPoll: function () {
    /* ★ 在途锁一并放开：停轮询之后若那一轮才回来，它的回调不该再把 `_aiBusy` 留成 true */
    this._aiBusy = false;
    if (this._aiTimer) {
      clearInterval(this._aiTimer);
      this._aiTimer = null;
    }
    if (this._aiHide) {
      if (typeof wx !== 'undefined' && wx.offAppHide) wx.offAppHide(this._aiHide);
      this._aiHide = null;
    }
    this._aiTick = 0;
  },

  /** 回上次打开的脑图；记忆失效 → 清记忆走空态 ＋ 自动弹列表抽屉（FR-8.4） */
  refresh: function () {
    /* ★ 280 轮：进来先决定"要不要问服务端"。有 pending 就起、没有就停 ——
       两句话都幂等，所以这里被反复调用也没关系。 */
    if (store.anyMindmapAiPending()) this._startAiPoll(); else this._stopAiPoll();
    const land = this.data.landscape;
    const remembered = store.memoryOf('mindmap');
    if (remembered && !store.mindmapById(remembered)) store.clearMemory('mindmap');

    const mid = store.memoryOf('mindmap');
    if (!mid) {
      this._L = {}; this._M = {}; this._tree = null; this._vt = null; this._rootId = ''; this._fmt = '';
      this._viewKey = '';
      /* ★★ 2026-10-27（F06）：进空态 ＝ 这一场录音会话作废（在飞的那个 ASR 回调不许再碰状态） */
      this._vtSeq = (this._vtSeq || 0) + 1;
      /* ★ 第 82 轮：空态也要清 —— 这样"从空态再进同一张图"同样算一次新的进入
         （否则 `_lastMid` 还等于那张图 ⇒ 不清选中 ⇒ 又变成"上次选的那个还在"）。 */
      this._lastMid = '';
      /* ★★ 275 轮：离开这张图 ⇒ 还在飞的那次上传**作废**（换号）——
         否则它回来会对一个已经不存在的编辑面板 setData（与胶囊 `_closeCompose` 同一条纪律）。 */
      this._attSeq = (this._attSeq || 0) + 1;
      this.setData({
        mindmapId: '', name: '', nodes: [], linksUri: '', linksStyle: '',
        treeSelected: '', selNode: null,
        updated: '', formatKey: '',
        canUndo: false, canRedo: false, zoomShow: false,
        editId: '', editText: '',
        editImgOn: false, editImgUri: '', editImgUrl: '', editImgUp: false, editImgAr: 0,
        voiceId: '', voicePhase: '', voiceClock: '', delArmed: false,
        dragGhost: null, dragDot: null, dragSrc: null, dragScope: null, dragParent: null,
        dragSlot: null, dragLinkUri: '', hlStyle: ''
      });
      return;
    }

    const m = store.mindmapById(mid);
    /* ★★ 2026-09-30 修：**把"真数据来源"接上**（用户报「加了三层节点，重开只剩一个根」）。
       `ensureTree()` 只是"保证渲染拿得到一棵树、不白屏"的**同步兜底** —— 没有就现造一棵
       **只有根节点**的占位树。而 `GET /sync` 不给 `treeJson`（§6.2 红框）、`hydrate()`
       又会清空 `state.tree` ⇒ **重开小程序后这里必然拿到占位树**，于是画布永远只剩一个根
       （同一次会话内 `state.tree` 是内存里那棵完整的，所以只有"重新打开"才复现）。

       修法：占位树**先照常渲染**（不白屏），同时去向服务端要真的那棵；拿到之后
       （`treeReady(mid)` 变真）再重画一次 —— 这一次是从真树上排版的。
       ⚠️ 只在**真数据态**才拉（`isLoaded()`）：mock 与"连不上后端"两种情况下本地种子
          就是权威，一个请求都不该发（出图脚本的口径是"mock 下一个像素不变"）。
       ⚠️ 失败**不重画**：`loadTree()` 拉失败时不标 `treeReady`，若这里照样重画，
          每次 `refresh()` 都会再拉一次、再失败、再重画 ⇒ **无限循环**。 */
    if (mid && store.isLoaded() && !store.treeReady(mid)) {
      const self = this;
      store.loadTree(mid).then(function () {
        /* 二次校验：拉回来时用户可能已经切到别的脑图了 */
        if (store.treeReady(mid) && self._lastMid === mid) self.refresh();
      });
    }
    const root = store.ensureTree(mid);
    const p = m.projectId ? store.projectById(m.projectId) : null;
    const c = p && p.color ? store.colorOf(p.color) : null;

    /* ★ 本轮：这张脑图画成哪一种结构 —— 排版层与连线层**必须取同一个值**，
       所以在这里读一次、缓存到 `_fmt`，下面两处都从这里拿（各读一次迟早会不同步）。 */
    const fmt = store.formatKeyOf(m);

    /* ★ 第 70 轮：折叠态先剪一遍 —— 排版 / 连线 / 渲染 / 拖拽落点**四处共用这一棵可见树**。
       各剪一遍早晚会有一处漏，而漏掉的那处表现得很隐蔽（隐藏节点还能被点中、线还画着）。 */
    const vt = visibleTree(root);

    /* ★★ 第 82 轮：**进入脑图默认不选中任何节点**（用户第 1 条）。
       改之前这里是一句无条件兜底 ⇒ 首次进入（`treeSelected` 是空串）也会被落到
       `root.children[0]`，于是"一进来第一个节点就是选中态"，浮条五颗键全亮着，
       像是用户自己点过一样。

       ⚠️ 两件事要分开（本轮的坑就在这）：
         · **换图**（`mid` 变了）—— 手上那个 id 是**上一张脑图的**，必须清掉；
           不清就会被下面的"失效兜底"接住、又冒出一个凭空选中。
         · **选中失效**（撤销把它撤没了 ／ 被折叠藏进收起的那一支）—— 这种**仍要兜底**，
           否则浮条会去改一个画面上根本不存在的节点（第 70 轮的老坑）。

       `_lastMid` 是本组件上一次真正渲染过的图 id；空态分支里也会把它清回 `''`
       ⇒ 从空态再进同一张图同样算"一次新的进入"。 */
    /* ★ 本轮（审查-02 P0-2）：下面两处都会**把选中换掉**（换图清空 / 失效兜底换人），
       它们同样是一次"选中变更" ⇒ 删除的武装态必须一起作废。
       （鼠标点选与 Escape 走 `selectNode()`，那里另有一道；这三处是全组。） */
    let selChanged = false;
    if (this._lastMid !== mid) {
      this._lastMid = mid;
      /* ★★ 2026-10-27（F06）：换图 ＝ 上一张图上的录音会话作废（在飞的 ASR 不许清这一张的状态） */
      this._vtSeq = (this._vtSeq || 0) + 1;
      store.state.ui.treeSelected = '';
      selChanged = true;
    }

    /* 选中节点兜底：**原来有选中、但它不在可见树里了** → 落到第一个可见子节点
       （没有就退到根）。⚠️ 判据必须用**可见树** —— 用原树判会留下"选中了一个画面上不存在的节点"，
       浮条那几颗键当场变成在改一个看不见的对象（第 81 轮起是五颗）。
       ⚠️ `sel` 为空（＝用户还没点过任何节点）时**直接跳过**，这是第 82 轮的新口径。 */
    let sel = store.state.ui.treeSelected;
    if (sel && (!vt || !store.findNode(vt, sel))) {
      const first = (root && root.children && root.children.length) ? root.children[0].id : (root ? root.id : '');
      sel = (vt && store.findNode(vt, first)) ? first : (vt ? vt.id : '');
      store.state.ui.treeSelected = sel;
      selChanged = true;
    }

    /* 排版只算一次：节点层 / 连线层 / 命中检测 / 拖拽落点判定共用这一份 L。
       ★ 第五轮起缓存到**实例字段**而不是 data —— 它只服务于 JS 计算，
         进 data 会平白多传一份大对象给渲染层。
       ★ 第 67 轮起再缓存一份 M（每节点的折行与宽高）：节点层要拿它出 lines。
       ★ 第 70 轮起 M／L 都基于 **vt（可见树）**：被折叠那一窝不占位、不连线、不被命中。
         `_tree` 仍是**完整树**（折叠数字要数后代、撤销重做要整棵），
         `_vt` 才是"画出来那一棵"，拖拽判定一律用它。 */
    const M = metricsMap(vt, land);
    const L = layoutOf(vt, land, fmt, M) || {};
    this._L = L;
    this._M = M;
    this._vt = vt;
    this._tree = root;
    this._rootId = root ? root.id : '';
    this._fmt = fmt;

    /* 折叠徽标的两份输入（★ 第 70 轮 / 第 252 轮换口径）——
       `foldSide` 决定徽标挂在哪一侧，`foldCount` 是那枚圆里的数字。
       ⚠️ 数字必须从**完整树**数：传进 buildNodes 的是可见树，它被剪过，
          `countNodes` 只能数到节点自己 ⇒ 徽标永远显示"1"。
       ⚠️⚠️ 挂侧 ＝ **这个节点的出边方向**（`foldSideOf(this._tree, L, fmt)`）——
          用户口径「展开时它和子节点的连线从哪出发，收起时就挂哪」。
          第 70 轮的 `foldZoneOf`（"我站在父的哪一边"，还拿 |dx|/|dy| 比大小选轴）
          已废弃：它会把思维导图的深层节点判成"在下方"、把组织结构图的一级判成"在左右"，
          正是用户说的"徽标位置非常乱"。详见 `foldSideOf` 的函数头。 */
    const foldCount = {};
    (function walkFold(n) {
      if (n.collapsed) foldCount[n.id] = Math.max(0, store.countNodes(n) - 1);
      (n.children || []).forEach(walkFold);
    })(root);
    const foldSide = foldSideOf(root, L, fmt);

    /* 连线层：uri 与几何**必须成对**（SVG 拿 box 当 viewBox，图层的 left/top/w/h 也取 box）*/
    const lk = buildLinksUri(vt, land, L, fmt);

    const patch = {
      mindmapId: mid,
      name: m.name,
      /* 09-22 走查：标题栏不再显示脑图名，name 仍保留全名，供删除确认等文案用 */
      projectId: p ? p.id : '',
      projectName: p ? p.name : '未归属项目',
      projectColor: c ? c.main : store.noneColor(),
      projectArchived: store.isArchived(p),
      /* ★ 本轮：子标题右侧那一行 —— 全量时间，与列表卡的「更新于 …」同一口径
         ⚠️ 必须 `atMin()`：存储是**秒**精度（与后端同构），不截会露出 ':23'。 */
      updated: store.atMin(m.updatedAt),
      /* ★ 本轮：格式（供「格式」弹窗打勾；原 `formatLabel` 是死字段，审查-02 P2-28 已删） */
      formatKey: fmt,
      /* ★ 本轮：撤销 / 重做是否可用 —— 按钮置灰的唯一依据，别在 wxml 里现算 */
      canUndo: store.canUndo(mid),
      canRedo: store.canRedo(mid),
      /* ⚠️ 第 5 个参数是 `foldSide`（`foldSideOf` 的产物，id → 'l'|'r'|'t'|'b'）——
         **不是** `zoneMapOf` 的结果，见上面那段注释 */
      nodes: buildNodes(vt, sel, L, M, foldSide, foldCount),
      linksUri: lk.uri,
      linksStyle: lk.box ? boxLayerStyle(lk.box) : '',
      treeSelected: sel,
      selNode: this.nodeOf(root, sel),
      dragGhost: null,
      dragDot: null,
      dragSrc: null,
      dragScope: null,
      dragParent: null,
      dragSlot: null,
      dragLinkUri: '',
      hlStyle: ''
    };

    /* ★ 审查-02 P0-2：选中被换掉时**顺手收回删除武装态**（与 `selectNode` 里那道同源）。
       并进同一次 setData，不额外多刷一帧。 */
    if (selChanged && this.data.delArmed) patch.delArmed = false;

    /* 视图复位（★ 第 67 轮改口径）——
       原来只在「换了一张脑图」时复位成 100%；现在图会按内容折行长大，
       所以改成：**换图 / 换格式 / 转方向**都用「装得下就 100%、装不下就缩到看得全」，
       同一张图同一格式的普通重排（加节点、改名）仍保留用户当前的平移缩放。 */
    const vkey = mid + '|' + fmt + '|' + (land ? 'L' : 'P');
    if (this._viewKey !== vkey) {
      this._viewKey = vkey;
      const v = fitViewOf(L, land);
      patch.viewScale = v.sv;
      patch.viewTx = r2(v.tx);
      patch.viewTy = r2(v.ty);
      patch.stageStyle = stageStyleOf(v.sv, r2(v.tx), r2(v.ty));
      patch.zoomPct = Math.round(v.sv * 100) + '%';
    }

    const self = this;
    this.setData(patch, function () { self.measure(); });
  },

  /** 当前选中节点（供卡外那排操作按钮用）：根节点要额外标出来，因为它没有同级、也不能删 */
  nodeOf: function (root, sel) {
    const hit = store.findNode(root, sel);
    /* ★★ 275 轮：多带一个 `imageUri`（相对 uri）—— 编辑面板开的时候要用它给草稿打底
       （`editImgUri` / `editImgUrl`）。`refresh()` 每帧都会重建这个对象 ⇒ 它必须
       **从树上现读**，不能另外存一份（存了就会在撤销 / 语音回填之后变旧）。
       ★ 275b：`imageRatio` 同理（改文字时原样带回，别把比例抹掉）。 */
    return hit ? {
      id: sel,
      text: hit.node.text,
      root: !hit.parent,
      imageUri: hit.node.imageUri || '',
      imageRatio: Number(hit.node.imageRatio) || 0
    } : null;
  },

  autoDrawer: function () { this.autoDrawerFor('mindmap'); },

  /** 顶栏点标题 → 弹列表抽屉（等价入口，FR-8.2） */
  onTitleTap: function () { this.openListDrawer('mindmap'); },

  /* ================= 视口 · 坐标换算 ================= */

  /**
   * 量一次 .mm-viewport 的屏幕矩形，反推出两件事：
   *   · 上游缩放 S（壳页 stage 的整体缩放）—— 把画布自身的 sv 剥掉才是它
   *   · 「画布原点」落在屏幕的哪个位置 —— 用 rect 减去 tx·S 得到，
   *     这个值**不随平移变化**，所以量一次之后拖多远都还准
   * 为什么不直接用 stage.fit().scale：量到的就是渲染后的真值，
   * 上游将来多一层缩放也不会漏账。
   */
  measure: function (cb) {
    const self = this;
    const w = this.data.landscape ? CANVAS.land.w : CANVAS.port.w;
    const q = this.createSelectorQuery();
    q.select('.mm-viewport').boundingClientRect();
    q.exec(function (res) {
      const r = res && res[0];
      if (r && r.width) {
        const sv = self.data.viewScale || 1;
        const s = r.width / (w * sv);
        if (s > 0) {
          self._card = {
            left: r.left - (self.data.viewTx || 0) * s,
            top: r.top - (self.data.viewTy || 0) * s,
            s: s
          };
        }
      }
      if (cb) cb();
    });
  },

  /** 方向 / 尺寸变化后卡片尺寸也变了 ⇒ 重新量一次基准（等这一帧渲染完再量） */
  afterLayout: function () {
    const self = this;
    /* 竖屏画布高随真机状态栏变（见 syncPortCanvasH）—— 每次重排前先校一遍，
       免得真机读数晚于模块加载时用了个错的画布高排版。
       ★ 185 轮：横屏同理（画布高随视口高变，见 syncLandCanvasH）—— 两条一起校。 */
    const beforeP = CANVAS.port.h;
    const beforeL = CANVAS.land.h;
    if (syncPortCanvasH() !== beforeP || syncLandCanvasH() !== beforeL) {
      if (this._attached && this.refresh) this.refresh();
    }
    setTimeout(function () { self.measure(); }, 0);
  },

  /** 屏幕坐标 → 容器内「未变换」设计坐标 */
  toLocal: function (cx, cy) {
    const c = this._card;
    if (!c || !c.s) return null;
    return { x: (cx - c.left) / c.s, y: (cy - c.top) / c.s };
  },

  /** 屏幕坐标 → 画布坐标（.mm-viewport 内部那套坐标，节点 left/top 用的就是它） */
  toCanvas: function (cx, cy) {
    const l = this.toLocal(cx, cy);
    if (!l) return null;
    const sv = this.data.viewScale;
    return { x: (l.x - this.data.viewTx) / sv, y: (l.y - this.data.viewTy) / sv };
  },

  /**
   * 视口的唯一写出口：三个字段永远一起更新，不会出现「样式变了、账没变」。
   *
   * ★★ 2026-10-24（复审 P2-14）：第三个可选参数 `min` ＝ **本次允许的最小比例**。
   * ── 为什么需要：`fitViewOf()` 现在可以给出比用户下限（0.2）更低的比例（例如 0.12）。
   *    `applyView()` 如果照旧一律 `clampView()`，那个 0.12 会被**当场抬回 0.2**
   *    —— 这就是复审里说的"二次钳制"，只删 `fitViewOf` 那一处是不够的。
   * ── 别的入口（平移 / 捏合 / ± 键）传的是 `this.floorOf()`：既保住"适应屏幕"后的
   *    低比例，又不会让用户把它当作新的缩放地板继续往外缩。
   */
  applyView: function (sv, tx, ty, min) {
    const lo = (typeof min === 'number') ? min : VIEW_MIN;
    const s = Math.max(lo, Math.min(VIEW_MAX, sv));
    this.setData({
      viewScale: s,
      viewTx: r2(tx),
      viewTy: r2(ty),
      stageStyle: stageStyleOf(s, r2(tx), r2(ty)),
      zoomPct: Math.round(s * 100) + '%'
    });
  },

  /**
   * 本张图**当前**的缩放下限 —— `min(用户下限, 现在已经缩到的比例)`。
   * 唯一用途：平移 / 捏合 / ± 键不该把「适应屏幕」缩到的 12% 又顶回 20%。
   */
  floorOf: function () {
    const cur = Number(this.data.viewScale) || 1;
    return Math.min(VIEW_MIN, cur);
  },

  /**
   * 瞬时缩放读数（★ 本轮）—— 画布左下角那排缩放控件整条撤掉之后，
   * 比例改成「**正在缩放时才露脸**」：每次缩放点亮，停下来 900ms 自己淡出。
   * （★ 253 轮：那枚比例从**左下**搬到了**左上**，逻辑一行没动 —— 见 wxss `.mm-zoom`。）
   *
   * ⚠️ 挂点是 `zoomAt` / `fitView`，**不是** `applyView` ——
   *    `applyView` 还被 `panBy`（推画布）用着，挂在那里会让"平移"也冒出百分比。
   * ⚠️ 连续捏合会不停地重置同一个 timer，只有最后一次之后才真的收起来
   *    （每次都新建 timer 的写法会让读到一半的比例在指头还按着的时候就消失）。
   */
  flashZoom: function () {
    if (this._zt) clearTimeout(this._zt);
    if (!this.data.zoomShow) this.setData({ zoomShow: true });
    const self = this;
    this._zt = setTimeout(function () {
      self._zt = null;
      self.setData({ zoomShow: false });
    }, 900);
  },

  /** 以容器内某点（未变换坐标）为锚点缩放 —— 拿参考版 zoomAt 的公式：锚点下的内容不动 */
  zoomAt: function (sv, lx, ly) {
    /* ★★ 2026-10-24（复审 P2-14）：地板用 `floorOf()`（＝ min(0.2, 当前比例)）——
       「适应屏幕」缩到 12% 之后，再捏一下不该被抬回 20%。 */
    const ns = Math.max(this.floorOf(), Math.min(VIEW_MAX, sv));
    const os = this.data.viewScale;
    if (Math.abs(ns - os) < 0.0005) return;
    const k = ns / os;
    this.applyView(ns, lx - (lx - this.data.viewTx) * k, ly - (ly - this.data.viewTy) * k);
    this.flashZoom();
  },

  /** 画布几何中心（未变换坐标）—— 无光标位置的缩放都绕它 */
  centerLocal: function () {
    const land = this.data.landscape;
    return {
      x: (land ? CANVAS.land.w : CANVAS.port.w) / 2,
      y: (land ? CANVAS.land.h : CANVAS.port.h) / 2
    };
  },

  /* ================= 命中检测 ================= */

  /** 画布坐标落在哪个节点上（倒序：后画的压在上面） */
  hitNode: function (cx, cy) {
    const L = this._L || {};
    const ids = Object.keys(L);
    for (let i = ids.length - 1; i >= 0; i--) {
      const r = L[ids[i]];
      if (cx >= r.x && cx <= r.x + r.w && cy >= r.y && cy <= r.y + r.h) return ids[i];
    }
    return null;
  },

  /** bId 是否在 a 的子树里 —— 自己的子孙不能当落点，否则树会被截断 */
  isDescendant: function (a, bId) {
    if (!a || !bId) return false;
    let hit = false;
    (function walk(n) {
      if (hit) return;
      if (n.id === bId && n !== a) { hit = true; return; }
      (n.children || []).forEach(walk);
    })(a);
    return hit;
  },

  /** 事件里的触点：view 的 Touch 只有 clientX/clientY（x/y 是 canvas 组件专有的，别用混） */
  evPoint: function (t) {
    if (!t) return null;
    const x = (t.clientX !== undefined) ? t.clientX : t.x;
    const y = (t.clientY !== undefined) ? t.clientY : t.y;
    if (x === undefined || y === undefined) return null;
    return { x: x, y: y };
  },

  /* ================= 画布手势（触摸 / 鼠标共用一套状态机） =================

     touch 与 mouse 两条通道在部分平台会**同时**到达（PC 版微信把鼠标操作也映射成触摸）。
     所以两个入口都收口到这里，并且用 beginGuard 做一次 60ms 去重 ——
     不然同一次拖动会被开两遍状态机。 */

  beginGuard: function (src) {
    const now = Date.now();
    if (this._gSrc && this._gSrc !== src && now - (this._gAt || 0) < 60) return false;
    this._gSrc = src;
    this._gAt = now;
    return true;
  },

  onCanvasStart: function (e) {
    const ts = e.touches || [];
    const p = this.evPoint(ts[0]);
    const q = ts.length >= 2 ? this.evPoint(ts[1]) : null;
    if (!this.beginGuard('touch')) return;
    this.gsStart(p, q);
  },

  onMouseDown: function (e) {
    const p = this.evPoint(e.detail || e);
    if (!this.beginGuard('mouse')) return;
    this.gsStart(p, null);
  },

  /**
   * 手势开始。
   *   · 双指 → 捏合缩放
   *   · 单指落在**普通节点**上 → 待拖拽（按住 300ms，或位移过 8px 立刻开拖）
   *   · 单指落在空白 / **根节点**上 → 平移
   *     ⚠️ 根节点允许平移是**有意的改进**：它不可拖，若连平移也禁掉，
   *        画布左上角那块最大的节点就成了拖不动的死区（参考版的那个位置是中心主题）。
   */
  gsStart: function (p, q) {
    /* ★★★ 第 241 轮 · `_uiHold` 的**起点**（每段手势的第一帧都归零，见 `gsEnd`）。
       ⚠️ 顺序必须是"先归零、再读 `_uiTouch`"：同一次 touchstart 里
          `.mm-float-wrap` 的 `onUiTouch` 先跑（置真）→ 这里归零 → 冒泡到 move 时
          `onUiTouch` 会**再置一次真** ⇒ 闸门在整段手势里始终有效。
          反过来（不归零）就会长出"上一段手势残留在工具条上"的假阳性，
          症状是**整块画布从此拖不动**，而且不报错（一次性标记的寿命守两方向）。 */
    this._uiHold = false;
    /* ★★ 第 75 轮 · 第一道闸：这一下落在两条工具条上（它们用 `bindtouchstart` 冒泡上来）——
       只**消费掉标记**并不启动任何画布手势。原来是靠 `catchtouchstart` 在工具条那一层拦的，
       而那条路会让**每一颗键**的 `tap` 不再生成（详见 `onBtnDown` 那段长注释）。
       ⚠️ 顺序是有保证的：触摸事件的冒泡是「目标 → 工具条通栏 → 卡」，
          通栏的 `onUiTouch` 一定先于这里的 `onCanvasStart` 执行。 */
    if (this._uiTouch) { this._uiTouch = false; this.resetGesture(); return; }

    if (!this.data.mindmapId) return;
    if (this.data.drawer.open || this.data.form.open) return;
    if (!p) return;

    if (q) {
      this._pinch = { d0: Math.max(1, dist2(p.x, p.y, q.x, q.y)), s0: this.data.viewScale };
      this._pan = null;
      this.cancelPendingDrag();
      return;
    }

    /* ★★★ 第 112 轮 · **编辑态与画布的关系整条重写**（换形态之后的必然结果）。
       换形态前（87 轮那条闸门）解决的是：卡内输入框是**原生组件**、它上面的触摸会冒泡到
       画布 ⇒ 落在"正在编辑那张卡片"上的触摸要整个让给输入框（不开拖拽、不平移、不算点击），
       否则用户只想挪光标、300ms 后被 `beginDrag()` 拖走。
       现在**卡片里没有输入控件了**、输入框在底部浮条里（浮条由上面那条 `_uiTouch` 闸门
       挡住画布手势）⇒ 87 轮那个矛盾**根本不存在**，`inEditRect()` 一整条删掉。

       取而代之的口径（用户没明说，按"哪儿最不容易误伤"定的）：
         · 平移 / 缩放 / 点选**照常** —— 编着字也能挪画布看节点（不必先退出编辑）；
         · **编辑期间不武装拖拽**（下面 `_pend` 那一处）—— 编辑中点着节点不动不该改结构；
         · **提交点搬到 `handleTap()`**（tap 成立那一刻）。
       ⚠️ 提交点这一挪是本轮唯一容易看错的地方：原来在**触摸起手**就提交，
          那会让"只是想平移画布"也把编辑面板关掉；`handleTap` 只认"点了一下"。
       ⚠️ 别把 `commitEdit()` 加回这里（`gsStart`）—— 一加回，拖动画布就等于"确认提交"，
          而用户多半只是想看看。 */
    const cv = this.toCanvas(p.x, p.y);
    const hit = cv ? this.hitNode(cv.x, cv.y) : null;

    this._pan = { sx: p.x, sy: p.y, tx0: this.data.viewTx, ty0: this.data.viewTy, moved: false, on: true };
    this._tap = { x: p.x, y: p.y, t: Date.now(), moved: false };

    this.cancelPendingDrag();
    if (hit && hit !== this._rootId && !this.data.editId) {
      const self = this;
      this._pend = {
        id: hit, sx: p.x, sy: p.y,
        timer: setTimeout(function () { self.beginDrag(); }, HOLD_MS)
      };
    }
  },

  onCanvasMove: function (e) {
    const ts = e.touches || [];
    const p = this.evPoint(ts[0]);
    const q = ts.length >= 2 ? this.evPoint(ts[1]) : null;
    this.gsMove(p, q);
  },

  onMouseMove: function (e) {
    this.gsMove(this.evPoint(e.detail || e), null);
  },

  gsMove: function (p, q) {
    /* ★★★ 第 241 轮 · **第二道闸**（补上 `catchtouchmove` 让出来的那份职责）。
       卡与浮条原来都挂 `catchtouchmove`，触摸滑动压根冒泡不到这里；
       为了让 textarea 自己能滚（同层渲染下父级 `catch` 会掐死它的滚动，见 wxml 注释），
       两处都换成了 `bindtouchmove` ⇒ 现在必须由这里把"起于工具条/面板的那一段手势"挡住，
       否则在键上按住拖动时画布会跟着平移（正是那个 `catch` 在拦的事）。
       ⚠️ 它挡的是**整段手势**、不是一次 move —— `_uiHold` 由 `onUiTouch` 逐帧续上、
          由 `gsStart`/`gsEnd` 两头归零（寿命守两方向：短了会漏一帧、长了画布永久拖不动）。 */
    if (this._uiHold) return;
    if (!this.data.mindmapId) return;
    if (!p) return;

    /* ---- 双指：捏合 ---- */
    if (q || this._pinch) {
      if (!q) {                                  // 双指松开一根 → 结束捏合，按新单指重起
        this._pinch = null;
        this._pan = { sx: p.x, sy: p.y, tx0: this.data.viewTx, ty0: this.data.viewTy, moved: false, on: true };
        return;
      }
      if (!this._pinch) {
        this._pinch = { d0: Math.max(1, dist2(p.x, p.y, q.x, q.y)), s0: this.data.viewScale };
        this.cancelPendingDrag();
        return;
      }
      const l = this.toLocal((p.x + q.x) / 2, (p.y + q.y) / 2);
      if (!l) return;
      this.zoomAt(this._pinch.s0 * (dist2(p.x, p.y, q.x, q.y) / this._pinch.d0), l.x, l.y);
      return;
    }

    if (this._tap && dist2(p.x, p.y, this._tap.x, this._tap.y) > TAP_PX) this._tap.moved = true;

    /* ---- 正在拖节点 ---- */
    if (this._drag && this._drag.on) { this.updateDrag(p.x, p.y); return; }

    /* ---- 待拖拽：位移够 → 立刻开拖（不用等满 300ms） ---- */
    if (this._pend) {
      if (dist2(p.x, p.y, this._pend.sx, this._pend.sy) >= DRAG_PX) {
        this.beginDrag();
        this.updateDrag(p.x, p.y);
      }
      return;                                    // 未达阈值：什么都不做（此时不平移）
    }

    /* ---- 悬停（★ 审查-02 P1-8 · 只可能来自 PC 的 `bindmousemove` 通道）----
       鼠标**没按下**时 `_pan` 不存在，原来到这里就直接 `return` ⇒ 划过节点零反馈。
       现在先算一次命中；**命中值变了才 setData** —— mousemove 每秒几十次，逐帧写
       会把渲染层压垮，而划过空白区时命中恒为空串、一次都不会写（每次穿越最多写两次）。
       ★★ 2026-10-24（复审 P2-12）：**必须用 `toCanvas()`，不能用 `toLocal()`**。
          `hitNode()` 吃的是**画布坐标**（节点的 left/top 就是那套），而 `toLocal()` 只到
          "容器内未变换坐标" —— 它既没减 `viewTx/viewTy`、也没除 `viewScale`。
          100% 且没平移时两者恰好相等，所以这个问题只在**缩放或平移之后**才现形：
          鼠标划过那片区域高亮的是另一颗节点（或什么都不亮），点下去选中的却是对的 ——
          "看到的高亮"与"点到的对象"分叉，比完全没有高亮更让人不敢用。 */
    if (!this._pan || !this._pan.on) {
      const cv0 = this.toCanvas(p.x, p.y);
      const h0 = cv0 ? this.hitNode(cv0.x, cv0.y) : null;
      if ((h0 || '') !== this._hoverId) {
        this._hoverId = h0 || '';
        this.setData({ hoverId: this._hoverId });
      }
    }

    /* ---- 平移 ---- */
    const pan = this._pan;
    if (!pan || !pan.on) return;
    if (!pan.moved) {
      if (dist2(p.x, p.y, pan.sx, pan.sy) < DRAG_PX) return;
      pan.moved = true;
    }
    const c = this._card;
    if (!c || !c.s) return;
    /* 用「起点 + 总位移」而不是逐帧累加：一次回调丢掉也不会让画面漂走 */
    this.applyView(this.data.viewScale, pan.tx0 + (p.x - pan.sx) / c.s,
      pan.ty0 + (p.y - pan.sy) / c.s, this.floorOf());
  },

  onCanvasEnd: function (e) {
    /* ★★ 2026-10-24（复审 P2-11）：**双指抬起一根时，手势不要整段结束**。
       ── 病根：`gsMove` 里明明有"双指转单指"的重起逻辑（`if (!q) { _pinch = null; _pan = ... }`），
          但抬起一指那一下先走 `onCanvasEnd()` → `gsEnd()`，而 `gsEnd()` 末尾**无条件**
          `resetGesture()` 把 `_pan/_pinch/_tap` 全清了 ⇒ 剩下那根手指再怎么动都不平移，
          必须全部抬手重新按。用户读到的就是"缩放完想挪一下，得先松手再按"。
       ── 现在：还有触点在屏上、且刚才确实在捏合 ⇒ 只结束捏合，用**剩下那根手指**重起平移
          （`moved:true`：这一段已经被算作"动过"，不该再退回点击判定）。
       ⚠️ 只在 `_pinch` 存在时接管：单指拖节点（`_drag`）/ 单指平移抬手的语义一个字都没变。 */
    const rest = (e && e.touches) || [];
    if (rest.length && this._pinch) {
      const p0 = this.evPoint(rest[0]);
      if (p0) {
        this._pinch = null;
        this._tap = null;
        this._pan = {
          sx: p0.x, sy: p0.y,
          tx0: this.data.viewTx, ty0: this.data.viewTy,
          moved: true, on: true
        };
        return;
      }
    }
    const t = (e.changedTouches && this.evPoint(e.changedTouches[0])) || null;
    this.gsEnd(t);
  },

  onMouseUp: function (e) {
    this.gsEnd(this.evPoint(e.detail || e));
  },

  /**
   * ★★★ 2026-10-27（全量检查 F11）· **touchcancel 不许当"松手落地"**。
   *
   * ── 改前：`bindtouchcancel="onCanvasEnd"` —— 系统中断（来电 / 通知横幅 / 手势被宿主收走）
   *   走的是同一条 `gsEnd()`，于是正在拖的那个节点**照样落地写树**、
   *   还弹一句「已收作子节点」。用户那边是"我什么都没松手，结构自己变了"。
   * ── 现在：取消走这里 —— 待拖 / 拖拽 / 平移 / 捏合全部**无声回收**，
   *   不写树、不进历史栈、也不判点击（一次中断不该被读成一次"选中"）。
   * ⚠️ 保留双指抬一指那段接管（与 `onCanvasEnd` 同口径）：那是"还剩一根手指在屏上"
   *   的**正常**分支，不属于取消语义。
   * ⚠️ `_uiHold` 也要在这里放下：中断时 `gsEnd()` 不再被调用，不放就会一直悬着，
   *   之后画布上每一次触摸都会被当成"落在工具条里"而整下失效（第 75 轮记过的病）。
   */
  onCanvasCancel: function (e) {
    const rest = (e && e.touches) || [];
    if (rest.length && this._pinch) {
      const p0 = this.evPoint(rest[0]);
      if (p0) {
        this._pinch = null;
        this._tap = null;
        this._pan = {
          sx: p0.x, sy: p0.y,
          tx0: this.data.viewTx, ty0: this.data.viewTy,
          moved: true, on: true
        };
        return;
      }
    }
    this._uiHold = false;
    this.discardDrag();
    this.resetGesture();
  },

  /** 丢弃一次在途拖拽（清干净拖拽态，**不落地、不写树、不进历史**） */
  discardDrag: function () {
    this._drag = null;
    this._markSig = '';
    this.setData({
      dragGhost: null, dragDot: null, dragSrc: null, dragScope: null, dragParent: null,
      dragSlot: null, dragLinkUri: '', hlStyle: ''
    });
  },

  gsEnd: function (p) {
    /* ★★★ 第 241 轮 · `_uiHold` 的**终点**：手指抬起就把闸门放下。
       ⚠️ 必须在这里清（而不是等下一段手势的 `gsStart`）：中途若整段触摸都在工具条里，
          `gsStart` 是在闸门那里 return 的、不会再被调用一次，标记就会一直悬着。 */
    this._uiHold = false;
    const dragging = !!(this._drag && this._drag.on);
    const pend = this._pend;
    const tap = this._tap;
    const pan = this._pan;
    const pinching = !!this._pinch;

    if (dragging) {
      this.endDrag();
      this.resetGesture();
      return;
    }
    if (pend) this.cancelPendingDrag();

    /* 点击判定：位移够小 + 时长够短 + 期间没平移过 ⇒ 一次选中 */
    if (tap && !pinching && (!pan || !pan.moved) && !tap.moved) {
      const at = p || tap;
      const moved = dist2(at.x, at.y, tap.x, tap.y);
      if (moved < TAP_PX && Date.now() - tap.t < TAP_MS) this.handleTap(at.x, at.y);
    }
    this.resetGesture();
  },

  resetGesture: function () {
    this.cancelPendingDrag();
    this._pan = null;
    this._pinch = null;
    this._tap = null;
    /* ★ 审查-02 P1-8：悬停态跟着手势一起清 —— 鼠标离开画布（`bindmouseleave` 挂的
       就是 `onMouseUp`）与触摸结束时都会走到这里；不清就会在节点上留一圈
       "以为鼠标还在那儿"的灰环。`data.hoverId` 一并复位（有才写，省掉无谓 setData）。 */
    if (this._hoverId) { this._hoverId = ''; this.setData({ hoverId: '' }); }
    /* ★ 第 75 轮：工具条的触摸标记随手势一起清 —— 一次误留就会让**下一次**画布触摸被当成
       "落在工具条上"而整下失效（症状正是用户报的那句"点了没反应"）。 */
    this._uiTouch = false;
  },

  cancelPendingDrag: function () {
    if (this._pend && this._pend.timer) clearTimeout(this._pend.timer);
    this._pend = null;
  },

  /* ⚠️ 第 112 轮**删除** `inEditRect(x, y)`（第 87 轮建立）——
     它给 `gsStart` 的"编辑态闸门"用：判断这一下是否落在**正在编辑的那张卡片矩形**里，
     落在里面就整个让给卡内输入框（不开拖拽 / 不平移 / 不算点击）。
     编辑区搬去底部浮条之后，卡片上没有任何输入控件 ⇒ 这个闸门要解决的问题不存在了。
     ⚠️ 别为了"点编辑卡片时别拖"再把它加回来：那本来就不该发生 ——
        编辑期间 `gsStart` 已经**不武装拖拽**（`!this.data.editId`），
        加回矩形闸门只会把"编辑时想点/平移画布"一起挡掉。 */

  /** 点画布：命中节点就选它；点空白回根节点（浮条需要一个明确的「当前节点」） */
  handleTap: function (cx, cy) {
    /* ★★★ 第 112 轮：**编辑态的提交点就在这里**。
       用户"在画布上点了一下"的语义 ＝ "我看完了 / 换一个" ⇒ 先把这次编辑提交（写回 store），
       再照常选中。这样一来：
         · 提交只在**真的一次点击**上发生 —— 平移 / 缩放 / 长按拖拽都不算（它们在
           `gsStart` 就分流走了，走不到这里）；
         · 与「取消」明确分工：点画布 **保留**、按取消 **丢弃**（见 `commitEdit` 那段注释）。
         ⚠️ 顺序必须是"先提交、后取坐标"：`commitEdit()` 里可能 `refresh()`（文本真改过时），
          `refresh()` 会重建 `_L` / `_vt` —— 先让它重建完，下面的 `hitNode` 才用得上新表。
       ⚠️ 传 `true`（隐式提交）：空内容按取消处理，别把用户困在"点画布也退不出编辑态"里。 */
    if (this.data.editId) this.commitEdit(true);
    const cv = this.toCanvas(cx, cy);
    if (!cv) return;
    const hit = this.hitNode(cv.x, cv.y);
    this.selectNode(hit || this._rootId);

    /* ================= ★★★ 303 轮 · **双击节点 ⇒ 开编辑面板**（仅 PC）=================
       用户口径（逐字）：「鼠标双击节点时，打开编辑弹窗。该行为仅在 PC 端生效。」

       ── 为什么判在 `handleTap` 里（而不是另挂一个 `binddblclick`）────────────────
       ① 小程序**没有** dblclick 事件（原生 Web 那套 `ondblclick` 不存在），
          而画布的点击本来就全部走 `gsEnd → handleTap` 这条唯一通道
          （触摸与鼠标两个入口都在那儿汇合，见 `gsStart`/`gsEnd` 上面那段）。
       ② 这条通道里**已经**过滤掉了"拖动 / 长按拖节点 / 平移过 / 捏合过"的手势
          —— 双击的每一下都必须是一次**干净的点击**，这正是 `handleTap` 的定义。
          另起一套就得把那些过滤条件再抄一遍，且两套判据迟早在某条边上分叉。
       ③ 顺序：`selectNode` 在前 —— 开面板要用 `data.selNode`（`runAct('edit')` 读的就是它），
          而 `selectNode` 是它唯一的写入口。第二下点击时选中已经是它，`selectNode`
          会早退（`id === treeSelected`）⇒ 不会白刷一次画布。

       ── 为什么只认"同一个节点 ＋ 两次点击挨得够近"────────────────────────────
       · 换了节点不算双击（两次点在不同节点上是"选完这个又选那个"，很常见）；
       · 点空白会把"上一击"清掉（`hit` 为空的那一支），否则"点节点 → 点空白 → 再点同一节点"
         会被连成一次双击。
       ⚠️ 编辑态下双击**当前正在编辑的节点**：`handleTap` 开头已经 `commitEdit(true)`
          存过一遍，随后重开面板 —— 等于"确认并继续编辑"，文字不会丢。
       ⚠️ 手机上永远不会走到这里（`deskEnv()` 为假）—— 双击在触屏上是"点一下再点一下"，
          若也开面板，用户改主意时会莫名掉进编辑态。 */
    if (!deskEnv()) return;
    if (!hit) { this._tapId = ''; this._tapAt = 0; return; }
    const now = Date.now();
    if (hit === this._tapId && now - this._tapAt < DBL_TAP_MS) {
      /* 消费掉这一对，免得"快速点三下"被读成两次双击（第二次双击会把刚开的面板又开一遍） */
      this._tapId = '';
      this._tapAt = 0;
      this.act('edit');
      return;
    }
    this._tapId = hit;
    this._tapAt = now;
  },

  selectNode: function (id) {
    if (!id || id === this.data.treeSelected) return;
    store.state.ui.treeSelected = id;
    /* ★ 本轮（审查-02 P0-2）：**武装态必须随选中一起收回去**。
       「删除」是两段式：第一段只把图标染红（`delArmed = true`），第二段才真删。
       而 `delArmed` 原来**只在 `runAct()` 开头**复位（`act !== 'del'` 时）——
       而"换选中"走的是本函数与键盘 Escape，**两处都不经 `runAct`** ⇒
       「点删除武装 → 点另一个节点 → 再点删除」会跳过染红那一段、**第一按即真删**。
       ⇒ 复位挂到**选中变更的唯一出口**（本函数）上：鼠标点、键盘 Escape 一并覆盖。
       ⚠️ `store.undo` 是事后兜底，不能拿它救这个设计缺陷。 */
    if (this.data.delArmed) this.setData({ delArmed: false });
    /* ★★ 199 轮：**选中 ⇒ 这枚节点的「刚转过来」提示消失**（用户口径：
       「用户在……选中这个节点卡片后，这个提示消失」）。
       ★ 挂在本函数上（＝选中变更的**唯一出口**）而不是 `onCanvasEnd` 里：
         鼠标点选、键盘 Escape 兜底、将来任何新的选中入口都一并覆盖 ——
         与上面那道 `delArmed` 复位同一个理由。
       ⚠️ 顺序：**先清、后 `refresh()`**。`refresh()` 里会 `visibleTree(root)` 重新拷一份
          可见树（`mindmap-core` 那边明确写了"返回的是拷贝"）⇒ 本地清掉 `flash` 之后
          这一帧画出来就是褪回灰底的，不需要额外再刷一次。
       ⚠️ 传的是 `this.data.mindmapId`（**屏幕上正显示的那张**）而不是 `memoryOf('mindmap')`：
          用户点的是眼前这张画布上的节点，两者在切图的那一帧可能不同步。
       ⚠️ 幂等且不刷 `updatedAt`（后端那边也不刷）—— 每点一下都会走到，没标记时一个请求都不发。 */
    store.markNodesSeen(this.data.mindmapId, [id]);
    this.refresh();
  },

  /** 两条工具条上的触摸 —— **只竖一个标记**，由 `gsStart()` 的第一道闸把它挡在画布手势之外。
      ⚠️ 第 75 轮之前这里是个空函数、绑在 `catchtouchstart` 上（＝拦住了手势，
         代价是键上的 tap 全不生成）。现在换成 `bindtouchstart` ＋ 抬标记，两件事都保住。
      ★★★ 第 241 轮：`catchtouchmove` 也换成了 `bindtouchmove`（同样调这里）——
         那两个 `catch` 在同层渲染下会**掐死 textarea 自己的滚动**（微信官方社区结论，
         见 wxml 里 `.mm-card` 那段注释）。让出来的"别让画布跟着平移"由 `_uiHold` 承担：
         这里**每帧置真**（touchstart 与 touchmove 都走这个函数），
         `gsMove()` 开头读它早退，`gsStart` / `gsEnd` 两头归零。 */
  onUiTouch: function () { this._uiTouch = true; this._uiHold = true; },

  /* ================= ★★★ 303 轮 · PC 端操作提示 =================
     用户第 4 条：「……该提示支持用户关闭。」

     ── 三个细节，缺一个都会变成小毛病 ────────────────────────────────
     ① **`catchtap`**（模板那边）：✕ 在提示条里、提示条在卡片里，用 `bindtap`
        会继续往上冒 —— 冒到卡片上没有任何 tap 监听（画布的点击是走手势状态机的，
        见 `onUiTouch` 那条注释），所以其实也不会误触；但**加上更省心**：将来谁在
        卡片上挂一个 tap，这颗 ✕ 就变成"关提示 ＋ 顺手做了别的事"。
     ② **先关、后落盘**：`setData` 排在 `setStorageSync` 之前 —— 真机上 storage 偶尔
        会同步失败（配额满 / 只读），那种情况下**界面必须已经收起来了**，
        否则就是"点了 ✕ 没反应"。落盘失败只意味着下次进图再提示一次，无害。
     ③ **不写库、不动树**：这条提示纯粹是本地偏好，一个请求都不发
        （与胶囊那条一次性引导同一条纪律：`capsule.hint.swipe` 也只落本地）。 */
  onTipClose: function () {
    this.setData({ pcTipOn: false });
    try { wx.setStorageSync(PC_TIP_KEY, 1); } catch (e) { /* 存不下只是下次再提示一次 */ }
  },

  /* ================= 节点拖拽（拖到哪 ＝ 改结构） =================

     ★ 第 68 轮按参考图（用户给了 5 张连续帧）整块重做。**一句话**：
       长按把节点拎起来之后，画面上只有一件事在变 ——
       **一枚黄框 ＋ 一条黄线，从"当前父节点"挪到"松手后会挂上去的那个父节点"身上。**

     ★★ 2026-10-09（用户口径）· **判定点可见化** —— 这一轮解决的是"判据藏得太深"：
       第 92 轮把锚点换成了**手指点**，于是"用哪个位置在判父节点"完全看不出来，
       同一颗节点抓左边和抓右边还可能判成两个不同的父节点
       （用户原话：「有点混乱，用户不知道用什么位置作为父节点选择的判定」）。
       参照腾讯文档的思维导图（以**悬浮节点的左侧中部**为基点找父节点），改成：

         · 判定点 ＝ **被拖节点的中心**（`anchorOf`，★ 第 211 轮改口径）——
           旧口径是"朝向当前父节点那一侧边的中点"，实测与中心差 ±83…±125px、
           六格式里 81% 落在左右边缘、左右支手感互为镜像（用户说的"判断不清晰"首先是这个）；
         · 它在画面上**画出来**（`.mm-anchor-dot` 那枚小圆环，挂 `dragDot`）——
           用户一眼就能看到"系统拿这个点在找父节点"；
         · 拖动全程它跟着节点走、位置不变（`beginDrag` 算一次、`findDrop` 现推 absolutes）。
       ⚠️ **不要**为了"更像腾讯"再按父节点方向偏移一个点 —— 那条路已经走过并被否掉两次
          （第 92 轮手指点、2026-10-09 边中点）。中心是两者之间唯一正确的折中。

     ① 长按瞬间（＝"标记节点位置关系"）：
        · `dragGhost`   被拖节点的**半透明**副本跟手；
        · `dragDot`     判定点小圆环 —— 压在副本的**正中心**（★ 第 211 轮）；
        · `dragParent`  它的**当前父节点**套一圈**品牌黄实线框**；
        · `dragLinkUri` 从那个父节点拉一条**品牌黄折线**到副本（咬住副本近侧边）；
        · `dragSrc`     原位留一枚**灰色虚线框**（＝被拖节点自己原来占的那一格）；
        · `dragScope`   被拖节点的**整棵子树**圈一枚**品牌黄虚线圆角大框**。

     ② 拖动中（＝"提示最终落点"）：
        · 判定点落在**哪个节点身上** ⇒ 那个节点成为候选父节点（"成为它的子节点"）；
          落在**它两端 `EDGE_PX`（12px）** 且那一侧确实有邻兄弟 ⇒ 与它同级（插前／插后）；
          落在**兄弟之间的缝**里 ⇒ 父节点不变、只是位次变（接管区兜底）；
          **哪儿都没落点** ⇒ **取消态**：灰虚线框、所有黄标记消失，松手什么都不做。
        · 候选父节点一换人 ⇒ **黄框与黄线一起换过去**（见 `findDrop` → `hostOf` / `pickParentId`）；
          换人还要**连续命中 80ms** 才算数（`settleDrop`，把"抖"变成"吸"）。
        · 另外画一枚**落位标记**（`dragSlot`）：带序号的小黄点，回答"松手后排第几"。
        · ⇒ 一句话：**"黄框框住的那个，就是松手后会挂到的父节点；小黄点数出第几位"**。

     ③ 松手：`store.moveNodeTo({ asChild, targetId, index })` 落到**精确的第 k 位**。
        上一版那套「落点上就是子节点 ／ 同级之间插一条竖线」两态**一起作废** ——
        同级重排现在天然表达成"父节点没变、index 变了"，不需要第二套视觉。

     ⚠️ 第 66 轮留在这里的三条结论**依然有效**，别改回去：
        · 子树**原地不动**（不随行）、**不洗淡**（参考图里那层"淡字"是半透明副本透出来的，
          副本移开就恢复纯黑 —— 参考图 #5 可证）；
        · 被高亮的永远是**一个节点自己**，绝不圈它的子树；
        · 拖动体 ＝ **节点本体**，不是小胶囊。
     */

  beginDrag: function () {
    const pend = this._pend;
    if (!pend) return;
    this.cancelPendingDrag();
    /* ⚠️ 一律查**可见树**（★ 第 70 轮）：折叠掉的后代在画面上不存在，
       拿原树查会让"根判断""落点候选""子树范围"都带上看不见的节点。 */
    const hit = store.findNode(this._vt, pend.id);
    if (!hit || !hit.parent) return;                 // 根节点不可拖
    const r = this._L[pend.id];
    if (!r) return;

    /* 按下那一刻的容器坐标 —— 后面每一帧都用「起点 ＋ 总位移」算，
       不做逐帧累加（丢一次回调也不会让画面漂走） */
    const l = this.toLocal(pend.sx, pend.sy);
    if (!l) return;
    const sv = this.data.viewScale;
    const origin = this.toContainer(r.x, r.y);       // 节点左上角在容器里的位置

    const scope = this.subtreeBox(pend.id) || r;

    /* ★ 判定点（＝**被拖节点的中心**，★ 第 211 轮改口径）—— **只在这里算一次**，
       之后整个拖拽过程沿用同一个点，见 `anchorOf` 的函数头。
       ⚠️ 第二个入参（当前父节点矩形）现在**不参与计算**，保留是为了不动调用点签名。 */
    const a0 = anchorOf(r, hit.parent ? this._L[hit.parent.id] : null);

    /* ⚠️ 顺序**不能颠倒**：`dragMarkPayload` → `findDrop` 的第一行就是读 `this._drag`。
       必须**先把 `_drag` 挂上、再算标记** —— 反过来（第 68 轮第一版真就是）长按那一帧
       `findDrop` 恒返回 null，于是父节点框与预览线**全都不出现**；`updateDrag` 里 `_drag` 已在、
       又一切正常 ⇒ 症状是"长按没反应、手指一动才亮起来"，出图断言一眼抓到
       （`parent:false / link:false / same:false`）。 */
    this._drag = { id: pend.id, on: true, drop: null, r: r, p0: l, origin: origin, anchor: a0 };
    this._markSig = '';
    this._pan = null;
    /* 长按瞬间先按"节点还在原位"算一次标记 —— 此时判定点**就压在被拖节点自己身上**：
       节点自己是候选之外的（防环剔除了自己与后代）⇒ `hostOf` 看不见它，
       但 `findDrop` 最前面那道"判定点还在自己原位格子里 ⇒ 什么都没动"的守卫会接住
       ⇒ `same: true` ＋ 父节点不变 ⇒ 那一帧亮着的就是**当前父节点**
       （就是参考图第 1 张的样子：父节点已经亮着框）。 */
    const mark = this.dragMarkPayload(rectWithCx(r));
    this._drag.drop = mark.drop;

    if (wx.vibrateShort) { try { wx.vibrateShort({ type: 'light' }); } catch (err) {} }

    this.setData({
      dragGhost: ghostPayload(this._M, pend.id, hit.node.level, ghostBoxStyle(origin.x, origin.y, r, sv)),
      /* 判定点小圆点：长按那一帧先画在**原位**（位移 0）—— 它跟着节点走，位置见 dotStyleOf */
      dragDot: { style: dotStyleOf(origin, { x: 0, y: 0 }, r, a0, sv) },
      /* 原位框 ＝ **被拖节点自己**那一格（灰色虚线）。上一版这里圈的是整棵子树 ——
         第 68 轮把"这一窝"的活儿交给下面那枚**品牌黄虚线大框**，两枚框不再重复表达同一件事。 */
      dragSrc: { style: boxStyle(r, 0) },
      dragScope: { style: boxStyle(scope, SCOPE_PAD) },
      dragParent: mark.dragParent,
      dragSlot: this.slotPayload(mark.slotAt, mark.drop),
      dragLinkUri: mark.dragLinkUri,
      hlStyle: mark.hlStyle
    });
  },

  /** 画布坐标 → 容器坐标（.mm-card 内绝对定位那套 ＝ translate ＋ scale） */
  toContainer: function (x, y) {
    const sv = this.data.viewScale;
    return { x: this.data.viewTx + sv * x, y: this.data.viewTy + sv * y };
  },

  /**
   * 某节点**整棵子树**在画布坐标里的外框（含自己）。
   * 用在源位置那枚虚线占位框上 —— "这一窝原来占多大地方"。
   */
  subtreeBox: function (id) {
    const L = this._L || {};
    const hit = store.findNode(this._vt, id);
    if (!hit) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    (function walk(n) {
      const r = L[n.id];
      if (r) {
        if (r.x < x0) x0 = r.x;
        if (r.y < y0) y0 = r.y;
        if (r.x + r.w > x1) x1 = r.x + r.w;
        if (r.y + r.h > y1) y1 = r.y + r.h;
      }
      (n.children || []).forEach(walk);
    })(hit.node);
    if (x0 === Infinity) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  },

  /**
   * ⚠️ 第 66 轮返工：原来的 `buildDragSub()`（整棵子树随行）**已删除**。
   * 对着参考图核对后确认：拖动带子节点的节点时，**子树留在原地不动**，
   * 只有被拖的那个节点跟着手指走；源位置那枚虚线框只圈**它自己**那一格，
   * 整窝的范围交给蓝虚线大框（`dragScope`）。
   * 少渲染一窝节点，拖动每帧的 setData 也轻得多。
   */

  /**
   * 拖拽标记的**统一产出**（★ 第 68 轮新增）—— `beginDrag` / `updateDrag` **必须共用这一处**。
   *
   * 输入：浮动节点当前在**画布坐标**里的矩形。输出四件：
   *   `drop`        落点 `{parentId, index, same}`（`same` ⇒ 松手等于没动）
   *   `dragParent`  候选父节点的实线框（品牌黄）＋ `isRoot`（根要走双环，见下）
   *   `dragLinkUri` 候选父节点框的外缘 → 浮动节点的品牌黄预览线
   *   `hlStyle`     上面那条线的渲染盒（**成对下发**，见 renderBoxOf）
   *
   * ⚠️ 教训照抄 `ghostPayload` 那条：`setData` 是**按 key 整体替换**的，
   *    同一件标记在两处各写一份，早晚有一处漏字段 —— 第 67 轮拖动体文字消失就是这么来的。
   *
   * ★ 第 92 轮 · 路线 A：多收一个 `at` ＝ **手指（指针）在画布坐标里的位置**。
   *   落点判定用它（`findDrop`），浮动矩形 `ghost` 只用来画拖动体与那条预览线。
   *   两者**分工不同、都得传** —— 只传一个会出现"线画对了、落点判错"或反过来。
   * ★ 2026-10-09：`at` **整条撤掉** —— 判定点改由 `findDrop` 从 `_drag.anchor` 现推
   *   （＝节点自己的固定点 ＋ 浮动位移，见 `anchorOf`）。少一个入参就少一处"两个锚点各算一份"。
   */
  /**
   * 候选父节点的**驻留**（★ 第 211 轮 · P1-3）—— 把"抖"变成"吸"。
   *
   * 规则：新候选必须**连续命中 ≥ `CAND_HOLD_MS`** 才允许从当前候选手里夺权；
   *       等待期里沿用**上一个稳态**（`d.settled`），而不是上一帧的临时值。
   *
   * 为什么用"上一个稳态"而不是"上一帧"：
   *   快速掠过 B 时，每一帧的 drop 都在变（A→B→C），拿上一帧当兜底等于把 B 又亮一帧 ——
   *   视觉上还是抖。拿稳态兜底 ⇒ 从 A 直接跳到 C，中间那个人不闪。
   *
   * ⚠️ `same` / `cancel` 两种态**直接采纳、不驻留**：
   *   · `same`（判定点还在自己原位）是抓起来那一帧的状态，延迟它会让长按没反应；
   *   · `cancel`（拖到空白）是"什么都不发生"，早一点给灰虚线反而更清楚。
   * ⚠️ 只拦"换父"，不拦"同父下的 index 变化"—— 后者是连续位移，延迟会粘手。
   * ⚠️ 松手用的是**同一份**（驻留后的）`d.drop`，所见即所得。
   *    不要为了"更准"在 `endDrag` 里绕开驻留重算一次 —— 那会造成
   *    "看到 A 亮着、松手却挂到 B"，比慢 80ms 难解释得多。
   */
  settleDrop: function (drop) {
    const d = this._drag;
    if (!d || !drop) return drop;
    const st = d.settled;
    if (!st || drop.same || drop.cancel || st.same || st.cancel
        || drop.parentId === st.parentId) {
      d.settled = drop;
      d.cand = null;
      return drop;
    }
    const now = Date.now();
    if (!d.cand || d.cand.id !== drop.parentId) {
      d.cand = { id: drop.parentId, since: now };
      return st;
    }
    if (now - d.cand.since < CAND_HOLD_MS) return st;
    d.settled = drop;
    d.cand = null;
    return drop;
  },

  dragMarkPayload: function (ghost) {
    const drop = this.settleDrop(this.findDrop(ghost));
    if (!drop) return { drop: null, dragParent: null, dragLinkUri: '', hlStyle: '', slotAt: null };
    const r = this._L[drop.parentId];
    if (!r) return { drop: null, dragParent: null, dragLinkUri: '', hlStyle: '', slotAt: null };
    /* ★ 第 212 轮：候选父节点框搬到了 `.mm-viewport` **外面**（见 wxss 里那段说明）——
       只有搬出来，它的 `z-index` 才压得过拖动体。于是这里要按 `.mm-viewport` 的
       `translate(tx,ty) scale(sv)` 把画布坐标换算成**卡片容器坐标**。 */
    const pv = {
      tx: this.data.viewTx, ty: this.data.viewTy,
      sv: this.data.viewScale
    };
    const parentBox = function () {
      return boxStyleInCard(r, PARENT_PAD, pv.tx, pv.ty, pv.sv);
    };
    /* ★ 第 212 轮 · **被盖住时给框内补一层淡黄底**（`.is-under`）。
       病根：框抬到拖动体之上以后，它仍然只画 2px 边 —— 当拖动体把候选父节点整个罩住时，
       用户看到的是"一个框圈住了拖动体自己的一段字"，分不清框的是下面那颗节点。
       补一层 16% 黄底之后，那一块读作"被挖出来高亮了"，与"拖动体本身"能分开。
       ⚠️ 只在**真的被盖住**时才加（交叠 ≥ 候选面积的 25%）：正常情形下框露在外面，
          第 68 轮那条"框内不填色、节点底色照常透出来"的设计原样保留，不抢戏。 */
    const ov = (function () {
      if (!ghost || !r) return 0;
      const w = Math.min(ghost.x + ghost.w, r.x + r.w) - Math.max(ghost.x, r.x);
      const h = Math.min(ghost.y + ghost.h, r.y + r.h) - Math.max(ghost.y, r.y);
      if (w <= 0 || h <= 0) return 0;
      return (w * h) / Math.max(1, r.w * r.h);
    })();
    const under = ov >= 0.25;
    /* ★ 第 211 轮 · P0-2 · **取消态**：框照旧亮着（任何时刻都有且只有一个父节点亮框），
       但换成灰虚线、并且**预览折线整条撤掉** —— "这条线本来要连上去"这件事不成立了。
       ⚠️ 折线撤掉时要连 `hlStyle` 一起给空串：它是那条线的渲染盒，留下一个空盒子
          会在画布上压一层看不见但吃触摸的层（`renderBoxOf` 那套的成对约定）。 */
    if (drop.cancel) {
      return {
        drop: drop,
        dragParent: {
          style: parentBox(),
          isRoot: !!(this._vt && drop.parentId === this._vt.id),
          cancel: true
        },
        dragLinkUri: '', hlStyle: '', slotAt: null
      };
    }
    /* ⚠️ 预览折线的**起点**用"框"（父节点外扩 `PARENT_PAD`）而不是节点本身 ——
       第 69 轮用户反馈"连接线穿透了上一级节点"就是这个：
       框比节点大 3px，线若从节点边缘出发，它的左端就落在**框的内侧**，看起来像从框里钻出来。
       框与线必须是**同一个矩形**，两个外扩量各写一份早晚会错开。 */
    const frame = rectWithCx({
      x: r.x - PARENT_PAD, y: r.y - PARENT_PAD,
      w: r.w + PARENT_PAD * 2, h: r.h + PARENT_PAD * 2
    });
    const dl = buildDragLinkUri(frame, ghost, this.data.landscape, this._fmt,
      !(this._vt && drop.parentId === this._vt.id));
    return {
      drop: drop,
      dragParent: {
        style: parentBox(),
        /* 候选父节点是**根**时，框压在根自己的品牌黄实心底上 ⇒ 改走「白间隙 ＋ 黄外环」双环。
           （66 轮的老办法，68 轮改蓝时撤掉过；69 轮改回品牌黄就必须补回来，否则一点也看不见） */
        isRoot: !!(this._vt && drop.parentId === this._vt.id),
        /* ★ 第 212 轮：被拖动体盖住时补淡黄底（见上面 `under` 那段） */
        under: under
      },
      dragLinkUri: dl.uri,
      hlStyle: dl.box ? boxLayerStyle(dl.box) : '',
      slotAt: drop.slotAt || null
    };
  },

  updateDrag: function (cx, cy) {
    const d = this._drag;
    if (!d || !d.on) return;
    const l = this.toLocal(cx, cy);
    if (!l) return;

    const sv = this.data.viewScale;
    const dx = l.x - d.p0.x, dy = l.y - d.p0.y;      // 容器坐标下的总位移
    const hit = store.findNode(this._vt, d.id);
    /* 浮动节点在**画布坐标**里的矩形 —— 落点判定（探针）与预览折线都用它。
       ⚠️ 必须带 cx / cy：连线函数（treeLink / boneLink / curveLR）读的是中心点。 */
    const ghost = rectWithCx({
      x: d.r.x + dx / sv, y: d.r.y + dy / sv, w: d.r.w, h: d.r.h
    });
    /* ★ 2026-10-09：判定点不再取自手指 —— 它由 `findDrop` 从 `_drag.anchor` 现推
       （固定点 ＋ 浮动位移）。这里只负责把那个**小圆点**画到同一处（`dotStyleOf`）。
       ★ 第 211 轮：判定点是**节点中心**，圆点因此在节点正中。 */
    const mark = this.dragMarkPayload(ghost);
    d.drop = mark.drop;

    const patch = {
      /* ⚠️ 与 beginDrag 共用同一个构造函数 —— 少给一个字段，拖动体的字就当场没了 */
      dragGhost: ghostPayload(this._M, d.id, hit && hit.node.level,
        ghostBoxStyle(d.origin.x + dx, d.origin.y + dy, d.r, sv)),
      /* 判定点小圆点：跟手指走（每帧都在动），所以**不能**跟 dragParent 一起做去抖 */
      dragDot: { style: dotStyleOf(d.origin, { x: dx, y: dy }, d.r, d.anchor, sv) },
      /* 蓝色预览折线：候选父节点 → 浮动节点。**终点每帧都在动**（咬住副本左边缘），
         所以这两个字段不能跟 dragParent 一起做去抖 —— 它跟的是手，不是父节点。
         ⚠️ uri 与几何成对：图层 left/top/w/h 必须跟着这条线的渲染盒走 */
      dragLinkUri: mark.dragLinkUri,
      hlStyle: mark.hlStyle
    };
    /* 候选父节点（连同它那个框）没换人就别重复 setData —— 拖拽每秒几十次回调，
       这里省下的是实打实的渲染。
       ★ 第 211 轮：落位标记（`dragSlot`）跟着一起走 —— 它由 `(parentId, index)` 唯一决定，
         与浮动位置无关 ⇒ 同一个 sig 下不可能变，没必要每帧重发。
       ★★ 2026-10-24（复审 P2-13）：**签名必须覆盖"框长什么样"的全部输入**。
         ── 改前只有 `parentId|index`，而框的三种外观分别由 `cancel`（灰虚线、无预览线）
            与 `under`（被拖动体盖住时补 25% 黄底）决定。同一父节点、同一位次下
            "有效 → 取消 → 有效"来回切时 sig 不变 ⇒ 那两个字段不刷新，
            屏幕上留着上一帧的灰虚线 / 黄底，与松手后的真实结果不一致。
         ── 现在把 `cancel` / `under` 一起进签名（`isRoot` 由 `parentId` 唯一决定，不必再列）。
         ⚠️ 仍然只在"真的变了"时才发 `dragParent` / `dragSlot`，性能口径不变。 */
    const sig = mark.drop
      ? (mark.drop.parentId + '|' + mark.drop.index +
         '|' + (mark.drop.cancel ? 'x' : 'o') +
         '|' + (mark.dragParent && mark.dragParent.under ? 'u' : '-'))
      : '';
    if (sig !== this._markSig) {
      this._markSig = sig;
      patch.dragParent = mark.dragParent;
      patch.dragSlot = this.slotPayload(mark.slotAt, mark.drop);
    }
    this.setData(patch);
  },

  /**
   * 落位标记的渲染数据（★ 第 211 轮 · P0-3）—— 画布坐标 → 容器坐标。
   * 标记本身是**恒定尺寸**（wxss 定 16px、负 margin 居中），不吃 `scale` ——
   * 画布缩到 20% 时仍然看得清（和判定点小圆点同一个理由，见 `dotStyleOf`）。
   */
  slotPayload: function (slotAt, drop) {
    if (!slotAt || !drop || drop.cancel || drop.same) return null;
    const c = this.toContainer(slotAt.x, slotAt.y);
    return {
      style: 'left:' + r2(c.x) + 'px;top:' + r2(c.y) + 'px;',
      /* 序号从 1 起 —— 用户看的是"第几位"，不是数组下标 */
      n: drop.index + 1
    };
  },

  /**
   * 算落点（★ 第 68 轮重写；★ 第 92 轮锚点改手指点；★ 2026-10-09 锚点改**判定点**）。
   *
   * 规则本身在模块级的 `hostOf` / `pickParentId` / `slotIndexOf` / `slotMarkOf` 里
   * （纯函数，可无头校验）；这里只负责**取数据 ＋ 兜底**：
   *   · 候选 ＝ 所有节点 **减去** 被拖节点自己与它的后代（防环）；
   *   · 层级取自 `_M`（排版层现算的 depth，比节点上的 `level` 更贴"画出来"的样子）；
   *   · **一个落点都没有**（被拖到整棵树远处）⇒ **取消态**（★ 第 211 轮）：
   *     父与位次都不动、`same: true`、`cancel: true`。框照样亮着（换成灰虚线），
   *     因为参考图的口径是"任何时刻都有且只有一个父节点亮着框"。
   *
   * ★ 2026-10-09 · **锚点 ＝ 判定点**（只有一个入参 `ghost`）：
   *   判定点 ＝ `_drag.anchor`（拖动开始时算好的点）＋ 浮动节点相对原位的位移。
   *   ★ 第 211 轮：那个点现在是**节点中心**（旧口径是"朝向父节点那一侧边的中点"）。
   *   ⚠️ 这条替换掉了第 92 轮那条"锚点 ＝ 手指点"：手指点随"抓在哪"漂，
   *      同一颗节点抓左抓右能判成两个不同的父节点，用户说"不知道拿哪个位置在判"。
   *   ⚠️ 判据与落位**仍共用这一个锚点**（`pickParentId` 与 `slotIndexOf` 收到的是同一个 `anchor`）——
   *      这条从第 92 轮起就没变过，别在某一处再换一个点。
   *
   * 返回 `{ parentId, index, same, cancel, slotAt }`（index 口径见 `slotIndexOf`，
   * `slotAt` 是落位标记的画布坐标，见 `slotMarkOf`）。
   */
  findDrop: function (ghost) {
    const drag = this._drag;
    const L = this._L || {};
    if (!drag || !ghost) return null;
    const self = this;
    /* ★ 判定点：固定点 ＋ 浮动位移。
       ⚠️ `drag.anchor` 理论上必有（`beginDrag` 一挂 `_drag` 就给了）；没有时退回
           `anchorOf(原位矩形, null)`（左中），绝不退回"浮动矩形的左上角" ——
           那是第 92 轮之前的老口径，退回去等于把这次的改动静默取消。 */
    const ax0 = drag.anchor || anchorOf(drag.r, null);
    const anchor = { x: ax0.x + (ghost.x - drag.r.x), y: ax0.y + (ghost.y - drag.r.y) };
    /* ★ 第 70 轮：全部改查**可见树** —— `L` 的键本来就只含可见节点，
       若这里拿原树查，`parentHit.node.children` 会带出**被折叠藏起来**的子节点 id，
       而它们在 L 里没有几何 ⇒ `slotIndexOf` 拿到的 u 是 undefined，插位算成 NaN。 */
    const dragHit = store.findNode(this._vt, drag.id);
    /* 子节点区朝向按**这一棵画出来的树**现推（第 68 轮：不能按格式查表 ——
       思维导图/时间轴的根孩子一左一右，同一格式里不同分支的朝向也可能不同） */
    const zones = zoneMapOf(this._vt, L);

    const cands = Object.keys(L).filter(function (id) {
      if (id === drag.id) return false;
      /* 自己子树里的不能当父 —— 选了就是成环，store 那边也会拒（双保险） */
      return !(dragHit && self.isDescendant(dragHit.node, id));
    });
    const depthOf = function (id) {
      if (self._M && self._M[id]) return self._M[id].depth || 0;
      const hit = store.findNode(self._vt, id);
      return (hit && hit.node.level) || 0;
    };
    /* ★ 第 92 轮 · 路线 A：`hostOf` 第 0 层要的两件事，都从**可见树**现取 ——
       · `parentOf`：宿主是根时返回 null（那就只能挂到它下面，不能"同级"）；
       · `sibsOf`  ：**含宿主自己**的兄弟矩形数组（判两端 1/4 该不该让给插前/插后）。
       ⚠️ 必须过滤 `!!L[c.id]` —— 折叠藏起来的兄弟在 L 里没有几何。 */
    const parentOf = function (id) {
      const hit = store.findNode(self._vt, id);
      return (hit && hit.parent) ? hit.parent.id : null;
    };
    const sibsOf = function (id) {
      const hit = store.findNode(self._vt, id);
      if (!hit || !hit.parent) return [];
      return (hit.parent.children || [])
        .map(function (c) { return L[c.id]; })
        .filter(function (r) { return !!r; });
    };
    /* ⚠️⚠️ 第 211 轮**试过又撤回**的一条（原方案 P1-2："`sibsOf` 剔除被拖节点自己"）：
       剔除之后"该侧有没有邻兄弟"会漏掉**它原来的那个位置** —— 拖 `n1` 到 `n2` 的上边缘时，
       `n2` 上方唯一的邻居正是 `n1`（正在被拖的那个），剔掉 ⇒ `before=false` ⇒
       那 12px 不再判"同级"，反而判成**成为 n2 的子**。语义整个反了：
       用户是"放回 n2 前面"，系统给"挂到 n2 下面"。
       根因：那个位置并不是"影子"—— 它是一格**真空位**，正是同级插入要落的锚点。
       ⇒ 不剔除。判据 `check_mindmap_drag.js` ②b 那两条就是这条结论的守门人。 */

    /* ★ 第 92 轮 · 路线 A 的**前置守卫**：节点**整体**还没怎么挪动 ⇒ 等于没动。
       ⚠️⚠️ 这条必须自己做，**不能指望 `hostOf` 顺带发现** —— "自己"被防环从候选里剔掉了，
           `hostOf` **看不见它**，于是会一路落到接管区兜底；而兜底只问"这一片是谁的孩子
           该在的地方"，在鱼骨图那种密排布局上会给出**别的**节点
           （真机实测：长按 `n1`、手指没动，落点父被算成 `n3` ⇒ 松手莫名其妙重排一次）。
       ★ 第 212 轮：判"动没动"改看**浮动矩形的中心**，不再看判定点。
         判定点挪到左边缘之后，它只要往左偏 1px 就出格 —— 守卫会当场失灵
         （而往右偏要整整一个节点宽才出格，左右彻底不对称）。
         用整体中心＝"移动不超过半个节点宽/高就算没动"，两边等距，也不再依赖 `anchorOf` 的口径。
       节点只微动时也走这条 ⇒ 松手什么都不做；
       一旦真拖出去才正常判定（`same: true` 会让 `endDrag` 直接返回、不弹 toast）。 */
    const selfR = L[drag.id];
    if (selfR && dragHit && dragHit.parent
        && ghost.cx >= selfR.x && ghost.cx <= selfR.x + selfR.w
        && ghost.cy >= selfR.y && ghost.cy <= selfR.y + selfR.h) {
      const sk = (dragHit.parent.children || []).map(function (c) { return c.id; });
      const sfrom = sk.indexOf(drag.id);
      return { parentId: dragHit.parent.id, index: sfrom < 0 ? 0 : sfrom, same: true };
    }

    let best = pickParentId(L, cands, depthOf, zones, anchor,
      { parentOf: parentOf, sibsOf: sibsOf });
    /* ★ 第 212 轮 · **覆盖率兜底**：判定点一个都没压到，但浮动节点把某颗节点整颗盖住了
       ⇒ 认它。这是"大节点盖小节点"的唯一出路：判定点在左边缘，比目标还宽的节点压上去时，
       点落在目标左边的空白里（实测 176 宽压 92 宽 ⇒ 点落在目标左边 88px）。
       ⚠️ 只在主路径一个都没中时才跑 ⇒ 211 轮那套规则一个字没动，风险锁在这一条里。 */
    if (!best) best = coverOf(L, cands, ghost, COVER_MIN);
    /* ★ 第 211 轮 · P0-2：**没有任何落点 ⇒ 取消**（父与位次都不动）。
       旧口径在这里兜底到"当前父节点"，然后照常走 `slotIndexOf` 算 index ——
       于是"拖到画布远处放下"会**静默改位次**：父没变、index 变了、还弹「已调整顺序」。
       探针扫全画布实测：33.3% 的空白格会落到这条路径上（`文档/脑图拖拽-父节点判定-问题与优化方案.html` F6）。
       用户的心智模型是"拖到没人的地方 ＝ 什么都没发生"，那就让它真的不发生。
       ⚠️ 不能简单"什么都不返回"：参考图的口径是**任何时刻都有一个父节点亮着框**，
          取消态（灰虚线）正好承担"亮着但不生效"的表达 —— 见 `dragMarkPayload`。 */
    if (!best) {
      const par = (dragHit && dragHit.parent) ? dragHit.parent.id : null;
      if (!par) return null;
      const sk0 = (dragHit.parent.children || []).map(function (c) { return c.id; });
      const at0 = sk0.indexOf(drag.id);
      return {
        parentId: par, index: at0 < 0 ? 0 : at0,
        same: true, cancel: true, slotAt: null
      };
    }

    const parentHit = store.findNode(this._vt, best);
    if (!parentHit || !parentHit.node) return null;
    const kids = (parentHit.node.children || []).map(function (c) { return c.id; });
    const slotAxis = (zones[best] || {}).slot || 'y';
    /* ★ 第 212 轮：**排位改看节点中心**，不再跟判定点共用。
       判定点在左边缘（x 比中心小 w/2）⇒ 兄弟沿 x 排的格式（组织结构图一级、鱼骨图主干）
       会带着半个节点宽的系统偏差："看着插在 B、C 之间，实际落到 B 前面去了"。
       找父是"光标指着谁"，排位是"我这块整体落在哪"，本来就该用不同的基准。 */
    const slot = slotIndexOf(kids, L, drag.id, { x: ghost.cx, y: ghost.cy }, slotAxis);
    /* ★ 第 211 轮 · P0-3：落位标记 —— "松手后确定排在第几位"。
       `same` 时不画（本来就待在原位，画出来等于说"你要挪到你现在的地方"）。
       坐标是**画布坐标**，由 `updateDrag` 转容器坐标（标记本身恒定尺寸、不吃缩放）。 */
    const slotAt = slot.same ? null : slotMarkOf(L, kids, drag.id, slot.index, slotAxis);
    return { parentId: best, index: slot.index, same: slot.same, cancel: false, slotAt: slotAt };
  },

  /**
   * ⚠️ 第 68 轮删除：`siblingTip()`（同级插入的指示线：横屏一条横线、竖屏一条**竖线**）。
   * 用户明确要求"去掉原来那个竖线来进行标记的模式" ——
   * 「同级」这个概念现在由 `findDrop` 的 `{ parentId, index }` 一并表达：
   * 父节点没变、只是 index 变了，那就是同级重排，
   * 不需要再画第二条线去说明"插在谁和谁之间"。
   */

  endDrag: function () {
    const d = this._drag;
    const drop = d ? d.drop : null;
    /* ★ 复用 `discardDrag()` —— 拖拽态的清场只有一份实现（取消与落地共用，
       否则总有一天只改了一边：残留的 ghost / 高亮线会把画布画脏）。 */
    this.discardDrag();
    if (!d || !drop) return;
    /* `same` ⇒ 插回自己原来占的那一位，位置其实没变。
       （参考图里刚拎起一个节点时被高亮的正是它的当前父节点，
         松手不该弹「已收作子节点」—— 那会让人以为真发生了什么。）
       ★ 第 211 轮：**拖到空白（`cancel`）也走这条** —— `findDrop` 给的正是
         当前父 ＋ 原位 index ＋ `same: true`，所以"拖到远处放下"真的什么都不做。 */
    if (drop.same) return;

    const mid = this.data.mindmapId;
    const cur = store.findNode(this._vt, d.id);
    const par = cur && cur.parent;
    const sameParent = !!(par && par.id === drop.parentId);
    const ok = store.moveNodeTo(mid, d.id, {
      asChild: true, targetId: drop.parentId, index: drop.index
    });
    /* 失败（撞上守卫：拖进自己子树、目标没了…）就静默复位，
       画布原样还原 —— 这正是「什么都没发生」应该有的样子，不要弹错。 */
    if (!ok) return;
    wx.showToast({ title: sameParent ? '已调整顺序' : '已收作子节点', icon: 'none' });
    this.refresh();
  },

  /* ================= PC 键盘（wx.onKeyDown · 仅 PC 平台） =================

     基础库 3.6.0 起提供，文档写明「仅适用于 PC 平台」。
     手机/平板上 typeof 就是 undefined，这里干脆不注册 —— 不必写一堆兼容分支去猜。
     ⚠️ 官方注意事项：焦点在 input / textarea / editor 或 webview 里时不派发，
        所以弹窗里敲节点文本不会被这些快捷键打断。
     ⚠️ 参考版里**没有**任何键盘代码（全目录搜 keydown / keyCode 零命中）——
        这一套是按小程序在 PC 上的能力**补**出来的，不是「继承」来的。 */

  onLoad: function () {
    this._L = {};
    this._M = {};
    this._viewKey = '';
    this._tree = null;
    this._vt = null;
    this._rootId = '';
    /* ★ 审查-02 P1-8：PC 悬停的**上一帧命中值**（与 `data.hoverId` 成对）——
       先落个空串，免得第一次 mousemove 因为 `undefined !== ''` 白跑一次 setData。 */
    this._hoverId = '';
    /* ★★★ 303 轮 · PC 端操作提示的初值（桌面环境 ＋ 没关过）——
       在这里判而不是在 `refresh()` 里判，见 `data.pcTipOn` 那段注里的理由。 */
    this.setData({ pcTipOn: deskEnv() && !pcTipDone() });
    /* ★★★ 303 轮 · 双击判定的"上一击"（节点 id ＋ 时刻）—— 见 `handleTap` 的双击分支。
       初始值留空串 / 0（不是 null）：`handleTap` 里的比较是"同一个 id 且够近"，
       空串永远等不中任何节点，所以第一次点选永远不会被判成双击。 */
    this._tapId = '';
    this._tapAt = 0;
    this.bindKeys();
  },

  /**
   * ★★★ 2026-10-27（全量检查 F16）· **模块被销毁时把"挂在外面的东西"收干净**。
   *
   * 什么时候会真销毁：手机 ↔ 工作台**形态切换**（壳页 `wx:if="{{mounted.mindmap}}"`）。
   * 平时只是 `display:none`，所以这条路径平时看不见 —— 但它一旦走过，
   * 下面这三样都会留在原地：
   *   · `wx.onKeyDown` 的监听（**全局累加**，且回调指着这个已经销毁的实例）；
   *   · AI 轮询的 `setInterval` ＋ `wx.onAppHide`；
   *   · 语音倒计时的 200ms 定时器与"等上一段收尾"的待发定时器。
   * ⇒ 这里逐条收掉。⚠️ 不做"存树 / 提交流程"的收尾：销毁不是保存，草稿与已提交的
   *    写都由 store 管，这里只回收**本实例持有的资源**。
   */
  onDetach: function () {
    this.unbindKeys();
    this._stopAiPoll();
    this.voiceCleanup();
    this._clearStartDelay();
    /* ★ 在飞的上传 / 语音回调一起作废（换号即可，不需要取消请求）——
       与胶囊 `detached` 同一条纪律：不让回调对已销毁实例 setData。 */
    this._attSeq = (this._attSeq || 0) + 1;
    this._vtSeq = (this._vtSeq || 0) + 1;
  },

  bindKeys: function () {
    if (this._keyBound) return;
    if (typeof wx.onKeyDown !== 'function') return;
    this._keyBound = true;
    const self = this;
    this._keyFn = function (res) { self.onKey(res); };
    wx.onKeyDown(this._keyFn);
  },

  unbindKeys: function () {
    if (!this._keyBound) return;
    this._keyBound = false;
    if (this._keyFn && typeof wx.offKeyDown === 'function') wx.offKeyDown(this._keyFn);
    this._keyFn = null;
  },

  /**
   * 键盘只在「脑图模块 + 开着某张脑图 + 没开抽屉/表单 + **不在编辑文字** + 页面还在」时接管。
   * 最后一条不是洁癖：组件是**常驻**的，少了它用户在待办页按 Delete
   * 会隔着模块把脑图节点删掉。
   * ★ 2026-10-22：**「不在编辑文字」（`editId` 为空）** 这一条是审查 P1-08 补的 ——
   *   编辑节点文本时按 Enter / Backspace / 方向键，原来会分别触发
   *   新增同级节点 / 武装删除 / 平移画布。
   */
  keyActive: function () {
    if (!this.data.mindmapId) return false;
    if (this.data.drawer.open || this.data.form.open) return false;
    /* ★★ 2026-10-22（审查 P1-08）· **文字编辑期间不接管键盘**。
       ── 改前：只管"抽屉 / 表单 / 模块是否在前台"，没看 `editId` ⇒ 节点文本编辑面板
          开着时，Enter / Backspace / 方向键照样进快捷键分发：
          实测 `onKey` 分别走到 `del`、`sibling`、`pan(-40,0)`
          （即"武装删除确认 / 新增同级节点 / 平移画布"）。
       ── 现在：`editId` 非空 ⇒ 直接不接管，这些键只影响输入框。
       ⚠️ 这一条同时把"编辑面板上的保存/取消"保住了：删除有二次确认，
          但 Enter 新增同级节点是**当场生效**的，编辑时敲回车就多出一个节点。
       ⚠️ 官方文档说"焦点在 input/textarea 时不派发 onKeyDown"，但那是**平台实现细节**，
          不是本工程的契约（且语音面板/浮条里的控件未必都算原生输入）。
          守卫写在这里，是让"不该动"变成代码事实，而不是等某个平台行为兜住。 */
    if (this.data.editId) return false;
    try {
      const ps = getCurrentPages();
      const p = ps[ps.length - 1];
      if (!p || !p.data || p.data.active !== 'mindmap') return false;
    } catch (e) { return false; }
    return true;
  },

  onKey: function (res) {
    if (!this.keyActive()) return;
    const key = res && res.key;
    if (!key) return;
    /* ★★★ 303 轮 · **Tab / Enter 只在「有选中节点」时生效**（用户第 2 条逐字：
       「仅在选中节点时生效：按 Tab 键新增下一级子节点；按 Enter 键新增同级节点。
         快捷键需与现有节点选中状态配合，未选中节点时不触发。」）
       ⚠️ `runAct('child'/'sibling')` 里本来就有 `if (!sel) return`（所以"不触发"这件事
          在今天也不会错），但那条守的是**动作**、不是**键位**：将来谁把 `runAct` 的
          空选中分支改成"没有选中就落到根上"，这条口径就会**静默失效**。
          ⇒ 在按键这一层显式拦一道，让"必须选中"变成键盘自己的规则。
       ⚠️ 看的是 `data.selNode` 而不是 `data.treeSelected`：真正决定"往谁身上加"的是前者
          （它是 refresh 从可见树里取出来的整条节点数据），两者在极少数帧里可能不同步，
          以实际会用到的那个为准。 */
    if ((key === 'Tab' || key === 'Enter') && !this.data.selNode) return;
    /* ★ 审查-02 C-2（2026-10-15）：**拖拽 / 长按待拖期间只放行"看"的键，拦住"改树"的键**。
       `this._pend` ＝ 长按已触发、手指还没移够 `DRAG_PX`（待拖）；
       `this._drag` ＝ 已经在拖。这两种状态下树正被一只手指按着，
       此时敲 Enter / Tab / F2 / Delete **会穿插改树** ——
       正在被拖的那个节点可能在落地前就被改掉、甚至删掉，
       于是落地那一步拿到的是一个**已经不存在的 id**。
       ⚠️ 方向键（推画布）/ `+` `-`（缩放）/ `0`（适应屏幕）**照旧放行** —— 它们不动树，
          而且"拖着东西找落点"的时候，推画布恰恰是用户可能真想做的。
       ⚠️ `Escape`（回根）不改树、只改选中，由 `selectNode` 里 P0-2 建好的那道收口统一处理，
          不在这里重复拦。 */
    const busy = !!(this._drag || this._pend);
    const structural = (key === 'Enter' || key === 'Tab' || key === 'F2'
      || key === 'Delete' || key === 'Backspace');
    if (busy && structural) return;
    switch (key) {
      /* 方向键 = 推画布（内容跟着键走，与鼠标拖动的方向感一致） */
      case 'ArrowUp':    return this.panBy(0, -PAN_STEP);
      case 'ArrowDown':  return this.panBy(0, PAN_STEP);
      case 'ArrowLeft':  return this.panBy(-PAN_STEP, 0);
      case 'ArrowRight': return this.panBy(PAN_STEP, 0);
      /* 缩放 */
      case '+': case '=': return this.zoomStep(1);
      case '-': case '_': return this.zoomStep(-1);
      case '0': return this.fitView();
      /* 编辑：与浮条走同一个入口，不另起一套逻辑 */
      case 'Enter': return this.act('sibling');
      case 'Tab': return this.act('child');
      case 'F2': return this.act('edit');
      case 'Delete': case 'Backspace': return this.act('del');
      case 'Escape': return this.selectNode(this._rootId);
      default: return;
    }
  },

  panBy: function (dx, dy) {
    this.applyView(this.data.viewScale, this.data.viewTx + dx, this.data.viewTy + dy, this.floorOf());
  },

  zoomStep: function (dir) {
    const c = this.centerLocal();
    this.zoomAt(this.data.viewScale + dir * ZOOM_STEP, c.x, c.y);
  },

  /** 键盘 → 复用浮条那套动作（`runAct` ＝ 按键与键盘的公共出口） */
  act: function (a) {
    this.runAct(a);
  },

  /** PC 滚轮：以光标为轴缩放（拿不到光标位置就绕画布中心） */
  onWheel: function (e) {
    /* ★★★ 第 243 轮 · 第二道闸：这一下滚轮是从编辑面板里冒上来的（`onFloatWheel` 竖的标记）。
       编辑态下滚轮该归 textarea 自己滚文本，画布**一格都不许缩**。
       ⚠️ 标记必须在这里**消费掉**（置回 false），不能指望别处归零：
          一次 wheel 就是一次完整的"目标 → 面板 → 卡"冒泡，这里不归零的话，
          下一次在画布空白处滚轮会被上一次的残留标记误伤（＝永久不缩放，且不报错）。
       ⚠️ 所以它**排在 `mindmapId` 判断前面**：那个 return 也会把标记留在原地，
          而"标记残留"和"标记没竖"在现象上分不开，排查成本极高。 */
    if (this._wheelPanel) { this._wheelPanel = false; return; }
    if (!this.data.mindmapId) return;
    const d = e.detail || {};
    const dy = d.deltaY || 0;
    if (!dy) return;
    let l = null;
    if (d.x !== undefined && d.y !== undefined) l = this.toLocal(d.x, d.y);
    if (!l) l = this.centerLocal();
    this.zoomAt(this.data.viewScale - dy * WHEEL_K, l.x, l.y);
  },

  /* ================= 浮条／编辑面板上的滚轮（★★★ 第 219 轮建 · 第 243 轮重做） =================
     用户报障（第 219 轮原话）：「pc 端脑图详情编辑节点文本时，文本输入框由于文本长，出现了滚动条，
     但是滚动条中鼠标滚轮时，编辑框背后的脑图进行了缩放」。

     机制：`bindwheel` 挂在 `.mm-card` 上（整张画布是它的子节点），而编辑面板也住在卡片里
     ⇒ 光标停在 textarea 上滚轮时，**原生输入框自己滚一格，事件再冒泡到卡片又缩放一次**。

     ★ 第 219 轮的修法是"面板上挂 `catchwheel` 吞掉"，那一步**同时把 textarea 自己的滚动也吞了**
       （`catch` 连默认行为一起吃，同层渲染下输入框就再也滚不动）。表现为：
         平板手指滑动能滚（touchmove 那条已改 `bind`）／**PC 鼠标滚轮滚不动**（第 243 轮用户报的）。
     ★ 第 243 轮改成"`bindwheel` 放行 ＋ 标记闸门"：
         · 面板这层只竖 `_wheelPanel` 标记，**不拦、不转发**（`bind` 会让事件自己冒泡到卡片）；
         · `onWheel` 见到标记就早退 ⇒ textarea 滚动照旧、画布不缩；
         · 画布空白处的滚轮**没有**标记 ⇒ 编辑态在空白处照样能缩放（第 219 轮那条"别一刀切"的要求仍成立）。
     ⚠️ `onFloatWheel` 里**绝不能再调 `this.onWheel(e)`**（第 219 轮那版是这么写的）：
        `catch` 时代不转发就丢事件，`bind` 时代再转发就是**一次滚轮缩两次**。
     ⚠️ 标记只在**编辑态**竖：静止态这条浮条只有 60 高，在它上面滚轮仍该缩放画布
        （不竖标记 ⇒ 冒泡上去的 `onWheel` 照常工作，行为与第 219 轮之前逐值一致）。 */
  onFloatWheel: function () {
    if (this.data.editId) this._wheelPanel = true;
  },

  /* ---------------- 节点操作浮条（★ 第 81 轮：**五颗键 · 三组**；第 70 轮定的形态） ----------------

     用户口径（★ 第 81 轮更新 · ★ 258 轮对调组序，组之间用竖线隔开，分组只在 wxml 里用 .fb-sep 表达）：
        增加子节点 ｜ 增加同级节点 ‖ 语音 ｜ 编辑 ‖ 删除
     （258 轮只是把「加子｜加同级」挪到最左、把「语音｜编辑」挪到中间，见 wxml `.mf-row`。）
     （「展开 / 收起」第 81 轮**搬到顶部工具条**第 2 组 —— 用户第 1 条"功能不变"，
       动作本身一个字没动，`runAct` 里那两个分支仍在，只是落点换了。
       同理「格式」那颗键与格式弹窗整条取消 —— 用户第 2 条。）

     ⚠️ 三条"要快、别拦人"的口径（用户明确要求）：
        · 加子节点 / 加同级 —— 直接落「新增节点」，**不弹窗、不吐司**；
        · 收起 / 展开 —— 直接改画布，**不吐司**（★ 第 81 轮起这两颗在顶部）；
        · 删除 —— **两段式**（第一段只把图标染成正红），第二段**直接删、不弹确认框**。
     还留着提示的只剩「撤回 / 重做」那两颗 —— 那两颗明确需要反馈：没得撤就该说一声。

     ⚠️ 第 70 轮**撤掉**了原来的「上移 / 下移」两颗（用户点名的七颗里没有它们）：
        同级重排改由**拖拽**承担（`store.moveNodeTo({index})`，第 68 轮那套精确插位）。
        `store.moveNode` 作为 API 留着，只是浮条上不再有入口。
  */
  /** 程序化入口（键盘 `act()` / 核验脚本直调）—— 与"按键被按到"完全同一套动作，不做去重 */
  onTool: function (e) { this.runAct(e.currentTarget.dataset.act); },

  /* ================= 按键的**触摸取词**（★ 第 75 轮 · 修「点了没反应」） =================

     用户报障（第 71、75 轮两次）："不管是节点操控区还是顶部那个按钮，点击以后没有反应"。
     第 72 轮在模拟器里量过 **11/11 颗键都能点**（真实坐标 tap），于是当时归因成"设备上的包落后"。
     （⚠️ 那个 11 是**当时的**键数：顶部 4 ＋ 浮条 7。★ 第 81 轮起是 **10 颗** ——
        顶部 5（多出「展开 / 收起」）＋ 浮条 5（少了「展开 / 收起」，另去掉「格式」）。
        下面这段讲的是**机制**，与"当时有几颗"无关，所以 11 这个数字**故意按原样留着**。）
     第 75 轮换方向重查，找到真因 —— **它不是一个"点得到／点不到"的问题**：

       微信基础库有一条既有规则：**某一层 `catch` 了 `touchstart`，
       这一下触摸对应的 `tap` 事件就不再生成**（与子节点上绑没绑 `bindtap` 无关）。
       两条工具条此前正是 `catchtouchstart="onUiTouch"`（见 wxml 注释）
       ⇒ 键上挂的 `bindtap` **永远收不到事件**。
       ⚠️ 而自动化里 `--action tap` 是**直接合成一个 tap 派发下去**的，压根不走"触摸 → tap"这段
          ⇒ 它量出来当然 11/11 全绿。**"断言全绿"与"用户点不动"第三次并存。**

     ⇒ 修法两层（缺一不可）：
       ① wxml 把两条工具条的 `catchtouchstart` 改成 `bindtouchstart`（冒泡上来），
          画布手势改由 `gsStart()` 的第一道闸按 `_uiTouch` 标记挡掉 —— 拦住的效果不变；
       ② **动作不再依赖 `tap`**：每一颗键都改由 `touchend` 取词（`onBtnUp`）。
          `tap` 那条路留着（`onBtnTap`），但同一手势里已被 `touchend` 处理过的就跳过 ——
          于是"tap 生不生成"都不影响按键可用，也不会重复执行。

     ⚠️ 去重用的是**手势标记 `_btnHandled`**（`touchstart` 置 false、`touchend` 置 true、
        `tap` 读一次就清），**不是时间窗** —— 时间窗会把「删除」那颗两段式的第二次快点吞掉。
     ⚠️ `runAct` 是唯一出口：键盘、`onTool`（脚本直调）、两条触摸路径全部收口到它。
     ⚠️ 位移超过 `TAP_PX`(20) 判"不是点它"（与画布上选节点同一把尺子）——
        在键上按住拖走再松手不触发，也不误触发别的键。 */
  onBtnDown: function (e) {
    const t = (e.touches && e.touches[0]) || null;
    this._btnHandled = false;
    this._btn = t ? { x: t.clientX, y: t.clientY, act: e.currentTarget.dataset.act } : null;
  },

  /** 触摸被打断（来电 / 弹窗）—— 当作没按过 */
  onBtnCancel: function () { this._btn = null; this._btnHandled = false; },

  onBtnUp: function (e) {
    const d = this._btn;
    this._btn = null;
    if (!d) return;
    const act = e.currentTarget.dataset.act;
    if (!act || act !== d.act) return;
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    if (t && dist2(t.clientX, t.clientY, d.x, d.y) > TAP_PX) return;   // 手指拖走了 ⇒ 不算点它
    this._btnHandled = true;
    this.runAct(act);
  },

  /** `tap` 那条路（PC 鼠标 / 部分基座）—— 同一手势里 `touchend` 已经处理过就不重复 */
  onBtnTap: function (e) {
    if (this._btnHandled) { this._btnHandled = false; return; }
    this.runAct(e.currentTarget.dataset.act);
  },

  /** 两条工具条 10 颗键的**唯一出口** */
  runAct: function (act) {
    if (!act) return;
    /* ★ 第 81 轮：「格式」那颗键取消 ⇒ 这里原来那条
       `if (act === 'format') { this.onFormat(); return; }` 转发整条删除。
       换格式走「编辑」抽屉（`editinfo` → 表单里的格式一行）。
       ⚠️ 编程入口 `setFormat(key)` 仍在（核验脚本用），但它**不经过 runAct** ——
          没有哪个 UI 动作会再派发出 `act === 'format'`。 */
    if (act === 'editinfo') { this.onEditInfo(); return; }

    const mid = this.data.mindmapId;
    const sel = this.data.treeSelected;

    /* 换动作先把两样"瞬时态"收回去 ——
       · `delArmed`：「点过删除 → 又点了编辑 → 再点删除」若不收回，第二次就成了直接删，
         那第一段的确认等于白设；
         ⚠️ 审查-02 P0-2：这里只是**其中一道**。真正兜住"绕过"的是
            `selectNode()`（选中变更出口）与 `refresh()` 的选中兜底 ——
            换节点/按 Escape 都**不经过本函数**，只在这么复位会留一条"一按即真删"的路。
       · `editId`：正在编辑时点别的键，编辑面板该退场（★ 第 112 轮：面板与那五颗键同住
         一条浮条 —— 点「语音」时若不先退出编辑，同一格上会同时挂 `.editing` 与 `.rec`）。
         ⚠️ 走的是 `commitEdit()`（**保留**输入），不是 `onEditCancel()` ——
            用户点的是"另一颗键"，不是"取消"。
         ⚠️ 传 `true`（隐式提交）：空内容按取消走，好让那颗键自己的动作照常发生。 */
    if (act !== 'del' && this.data.delArmed) this.setData({ delArmed: false });
    if (act !== 'edit' && this.data.editId) this.commitEdit(true);

    /* ---- ② 增加子节点 / 增加同级节点（第二组）—— 快速增加：无弹窗、无吐司 ---- */
    if (act === 'child' || act === 'sibling') {
      if (!sel) return;
      /* 根节点没有同级（wxml 已置灰，这里再兜一道 —— 键盘 Enter 也走这条） */
      if (act === 'sibling' && this.data.selNode && this.data.selNode.root) return;
      const id = store.addNode(mid, sel, ADD_TEXT, act === 'sibling');
      if (!id) return;
      /* ⚠️ 往**收起着的**节点上加子节点，必须顺手把它展开：不然新节点当场是"看不见的"，
         用户会以为"点了没反应"，然后再点一次 —— 于是加出第二个。 */
      store.setNodeCollapsed(mid, sel, false);
      store.state.ui.treeSelected = id;
      this.refresh();
      return;
    }

    /* ---- ① 编辑（第一组）—— 开**底部编辑面板**（★★ 第 112 轮换形态） ---- */
    if (act === 'edit') {
      const cur = this.data.selNode;
      if (!cur) return;
      /* 用户口径（第 112 轮，逐字）：「当选中节点后点击"编辑"按钮后，选中的节点在原有边框
         变色的基础上增加闪烁效果；整个节点内容编辑区要嵌入到底部节点操作工具栏中……」
         ⇒ 这一条**只改两个状态**，几何与渲染全交给 CSS：
             · `editId`   → 卡片挂 `edit`（闪）＋ 浮条挂 `editing`（长高成面板）；
             · `editText` → textarea 的初值，取**节点原文**。
         ⚠️ 之前那版要在这里算 `editW / editH`（原生输入框不吃百分比宽 ⇒ 得从 `_L[id]`
            取画布矩形、再用 inline style 写死 px）。**整条算量链已随形态一起下线** ——
            铁律 108：一条 CSS 能表达的关系，不要拆成"量→回调→setData→下发"。
         ⚠️ 光标位置：`focus="{{true}}"` 拉起输入法即可，**不再钉"落在文字最后"**
            （那是"就地编辑"时代的原口径；现在输入框在面板里，原生行为就好）。
         ⚠️ 这里**只改状态、不写库**：写回只在 `commitEdit()`（＝「保存」/ 点画布 / 点别的键）。 */
      /* ★★ 第 219 轮：正文区不再是死高 —— 按**这个节点自己的文本**折几行算一次。
         每行几个全角宽按形态取一次并存到 `this._taEm`（手机 19 / 宽形态 26），
         编辑期间不再逐键问一次系统信息（`stage.phone()` 会读视口，属同步 API）。 */
      /* ★★★ 275e：`phone` 只问一次，宽与字数**同源**取自那条宽度链 ——
         两处各算各的就会出现"按 26 字估行、按 24 字排版"这种静默错位。 */
      const phone = stage.phone();
      const em = phone ? TA_EM_PHONE : TA_EM_WIDE;
      const taW = phone ? TA_W_PHONE : TA_W_WIDE;
      this._taEm = em;
      /* ★★ 275 轮：图区三件一起打底 ——
           · `editImgOn` ＝ **非根**才有（用户第 4 条「选中原点时点击编辑，该弹窗维持当前
             状态不变，因为它没有挂载图片功能」）；
           · `editImgUri` 取节点现有那张（相对 uri），`_editImgInit` 记一份进面板时的原值
             —— `commitEdit()` 靠它判断"图到底改没改"（没改就别顶 updatedAt，也别发请求）；
           · `editImgUrl` 现拼完整地址（库里存相对 uri，见 `utils/imgpick.js` 口径④）。
         ⚠️ `editImgUp` 必须显式归 false：上一次编辑若在"上传中"被别的路径收掉，
            这个标记会留在 data 里，下一次开面板就会"一进来就挡住保存"。 */
      const imgUri = String(cur.imageUri || '');
      this._editImgInit = imgUri;
      /* ★ 275b：进面板时把这张图**现有的比例**也带进来（改图时会换成新图的，
         不改图就原样带着 —— 否则"只改了文字"也会把比例抹成 0）。 */
      this._editImgArInit = Number(cur.imageRatio) || 0;
      this._attSeq = (this._attSeq || 0) + 1;    // 换节点 ⇒ 上一次在飞的上传作废
      /* ★★★ 275b：正文区的字属性必须 ×平台缩放 s（原生控件不吃祖先 transform）——
         整段理由见文件上部 `stageScaleOf` 那段注释。`s` 只在进面板这一下取一次。 */
      const s = stageScaleOf(this._card);
      const taH = taHOf(cur.text, em);
      this.setData({
        editId: cur.id,
        editText: cur.text,
        editTaH: taH,
        /* ★★★ 275c：两个高度必须**同一次 setData** 下发（差一帧就是"框先长、字没跟上"） */
        editTaBodyH: taBodyHOf(taH),
        /* ★★★ 275e：宽度也是行内实值（设计稿 px，**不乘 s**）—— 原生 textarea 的框
           （不是字）是吃 `.stage` 那个 `transform: scale(s)` 的，写设计稿值就对了。
           为什么不交给 CSS 的 `left/right` / `width: 100%`：这两条 275b、275d 各试过一次，
           都把宽度交给了"元素自己解析包含块"，而 iPad 上 textarea 是**替换元素**，
           `width: auto` 取的是**固有宽**、`right` 直接被判成过度约束丢掉 ⇒
           框永远比外框窄一截（实测 362 vs 392 设计稿 px，右边空出 34 屏 px ≈ 3 个字）。
           行内写死一个 px 数是这件事唯一的确定性来源：`height` 一直是这么干的，
           行内一给就准，宽度同理。⚠️ 与 `taH` 同一次 setData：分开发就是先按旧宽排一帧。
           ★★★ 275f 修正上面那句"框窄一截"的结论：**框其实是对的**（275e 之后逐像素量过，
           正文区实宽正好 392，左内距 9.7 设计 px 分毫不差）。真机看着空的那一截是
           **行末余量** —— 字距实测 15.08 设计 px/字，392 ÷ 15.08 ＝ 25.995，差 0.08px
           装不下第 26 个字 ⇒ 每行末空掉整整一个字。治法有两条（正文区 392 → 396 ＋
           `text-align: justify`），完整推理见 wxss 里 `.mf-ta` 那段 275f。
           ⇒ 教训：**"右边空一截"不等于"框窄了"**，先把"左边内距"量出来对一下 ——
              左边准、只有右边不准，就去看"每行几个字 × 字距"的余数，别再改宽度。 */
        editTaW: taW,
        taFs: nativePx(TA_FS, s),
        taLh: nativePx(TA_LINE_H, s),
        editImgOn: !cur.root,
        editImgUri: imgUri,
        editImgUrl: imgUri ? api.fileUrl(imgUri) : '',
        editImgUp: false,
        editImgAr: this._editImgArInit
      });
      return;
    }

    /* ---- ③ 语音（第一组）—— 录 → 停 → 语音识别中 → 回填 ---- */
    if (act === 'voice') {
      if (!sel) return;
      if (this.data.voicePhase === 'up') return;      // 识别结果还没回来，两次点击别打架
      if (this.data.voiceId) { this.voiceStop(); return; }
      this.voiceStart(sel);
      return;
    }

    /* ---- ④ 展开 / 收起（★ 第 81 轮起这两颗挂在**顶部**工具条第 2 组）——
       选中就都亮，不区分当前是否已展开。
       ⚠️ 动作本身**一个字没改**（用户第 1 条"功能不变"）：搬的只是落点 ——
          原来它们在底部浮条第 3 组，现在与「撤回 / 重做」同住上边那条胶囊。 */
    if (act === 'collapse') {
      if (!sel) return;
      const hit = store.findNode(this._vt, sel);
      /* 叶子节点收起等于没变化 —— 但**不弹提示**（第三组自己的口径就是静默），照常 refresh */
      if (hit && hit.node.children && hit.node.children.length) store.setNodeCollapsed(mid, sel, true);
      this.refresh();
      return;
    }
    if (act === 'expand') {
      if (!sel) return;
      /* 「展开」＝**整支**都展开（用户口径："点击展开会将该节点下所有节点均展开"）——
         所以之前被单独收起过的后代也一并放开，不是只解一层。 */
      store.setSubtreeCollapsed(mid, sel, false);
      this.refresh();
      return;
    }

    /* ---- ⑤ 删除（第四组）—— 两段式：第一段只染红，第二段直接删 ---- */
    if (act === 'del') {
      if (this.data.selNode && this.data.selNode.root) return;   // 根不可删（wxml 已置灰）
      if (!this.data.delArmed) { this.setData({ delArmed: true }); return; }
      store.removeNode(mid, sel);
      const root = store.state.tree[mid];
      /* 删完选中落到第一个子节点，没有就回根（refresh 还会按可见树再兜一次） */
      store.state.ui.treeSelected = (root && root.children && root.children.length)
        ? root.children[0].id : (root ? root.id : '');
      this.setData({ delArmed: false });
      this.refresh();
      return;
    }

    /* ★ 本轮：撤销 / 重做从「静态演示」改成**真改树**。
       两者都由 store 的历史栈承担（每次 addNode / removeNode / updateNode /
       moveNodeTo 前后各埋一次 seed/push），组件这边只管问 canUndo / canRedo。
       ⚠️ 撤销可能把当前选中节点整支撤没 ⇒ 选中兜底交给 refresh（它是那条口径的唯一实现点）。 */
    if (act === 'undo' || act === 'redo') {
      const ok = act === 'undo' ? store.undo(mid) : store.redo(mid);
      if (!ok) {
        wx.showToast({ title: act === 'undo' ? '没有可撤销的改动' : '没有可重做的改动', icon: 'none' });
        return;
      }
      this.refresh();
      return;
    }
  },

  /* ================= 节点文本编辑 · 底部面板（★★★ 第 112 轮换形态） =================

     用户口径（逐字）：
       「将用 textarea 提出来用单独的交互单独解决；
         1、当选中节点后点击"编辑"按钮后，选中的节点在原有边框变色的基础上增加闪烁效果
            （可以参照语音输入模式，只不过无需遮罩倒计时）；
         2、整个节点内容编辑区要嵌入到底部节点操作工具栏中，整个工具栏高度自适应加高，
            底部位置不变顶部向上平移，原有的工具栏按键在整个展开的工具栏顶部展示，
            中间为 textarea，底部有"取消""保存"按键。」

     形态（wxml 的 `.mm-float` ＋ wxss 的 `.mm-float.editing` 那一段）：键排 / textarea /
     取消·保存三行，全部由 CSS 自己长；改形态的起点只有一件事 —— `editId` 非空。

     ── 三个出口，语义**各不相同**（这是本轮唯一的行为口径变化，别记混）──
       · 「保存」`onEditSave`   —— 写回 store；
       · 「取消」`onEditCancel` —— **丢弃**本次输入，节点文本原样不动；
       · 画布上**点一下**（`handleTap`）—— 走 `commitEdit()`，**保留**改动。
     ⚠️ 为什么"点画布"是保留、而不是丢弃：这是旧口径（卡内编辑时代"点卡片外面＝提交"），
        而且底部那条面板是个大靶子 —— 手指随便蹭到画布就丢字，代价太大。
     ⚠️ 平移 / 缩放**不提交**（它们不是"点了一下别处"）⇒ 提交点从 `gsStart`（触摸起手）
        挪到了 `handleTap`（tap 成立那一刻，见那边注释）。

     ⚠️ 退场**依然不能挂 `bindblur`**（第 82 轮老口径，理由没变）：用户点面板上那颗键、
        或者点画布，都会先触发 textarea 的 blur；挂在 blur 上就会"先退出、再执行"，两条路打架。
  */

  /** textarea 每敲一下 —— 更新 `editText`（面板的 `value` 跟着它走，不要另存一份）
   *  ★ 219 轮：顺手按新内容重算正文区高度，**只在跨行那一下才 setData 第二个键**
   *  （逐键都下发 `editTaH` 会让渲染层每敲一下就改一次盒高，而绝大多数键不跨行）。
   *  ⚠️ 用的是 `this._taEm`（开面板时按形态定的那份），别再每键调一次 `stage.phone()`。 */
  onEditInput: function (e) {
    const v = e.detail.value;
    const patch = { editText: v };
    const h = taHOf(v, this._taEm || TA_EM_WIDE);
    /* ★★★ 275c：外框高与 textarea 高是一对，跨行时**一起**下发 —— 只改前者会让
       字区比框矮 20（露出外框底色的一截），只改后者会让字溢到框外。 */
    if (h !== this.data.editTaH) {
      patch.editTaH = h;
      patch.editTaBodyH = taBodyHOf(h);
    }
    this.setData(patch);
  },

  /** 「取消」—— **丢弃**本次输入（不写库、不 refresh；节点文本与图片一个字都没动过） */
  onEditCancel: function () {
    if (!this.data.editId) return;
    /* ★★ 275 轮：图草稿一起丢 —— 「取消」的语义是"这一条一个字、一张图都没变"。
       顺手换号把在飞的上传作废（它回来时 `alive()` 已经不成立）。 */
    this._attSeq = (this._attSeq || 0) + 1;
    this.setData({
      editId: '', editText: '',
      editImgOn: false, editImgUri: '', editImgUrl: '', editImgUp: false, editImgAr: 0
    });
  },

  /** 「保存」—— 与 `commitEdit()` 同一个出口 */
  onEditSave: function () { this.commitEdit(); },

  /**
   * 提交并退场（**保存**语义）—— 「保存」／ 画布上点一下 ／ 点工具条上别的键 都走这里。
   *
   * ★★ 2026-10-24（复审 P2-06）：**空文本分两种情形，不能再一律静默退出**。
   * ── 改前：先 `setData({editId:'', editText:''})` 把面板和草稿一起清掉，
   *    再 `if (!text) return;` ⇒ 用户把字删光后点「保存」，看到的是"面板收了、
   *    节点上还是原来那句"，**没有任何解释**。画布 / 工具条的隐式提交也走同一出口。
   * ── 现在：
   *     · **显式保存**（`onEditSave` → `commitEdit()`）⇒ 空内容**不关闭**，
   *       明说一句，草稿留着（用户往往是想重打，不是想放弃）；
   *     · **隐式提交**（点画布 / 点别的键 → `commitEdit(true)`）⇒ 空内容按**取消**处理：
   *       节点文字本来就没被改过，没有东西可丢；若在这里也拦住，
   *       用户会陷在"点哪儿都退不出编辑态"里。
   * ⚠️ `editText` 现在是**原封不动的原文**（不再是从折行结果拼回来的）⇒ 硬换行 `\n`
   *    会原样进节点。这是**要的**：`wrapText` 把 `\n` 当硬换行（见那边的注释），
   *    所以 textarea 里敲的回车在画布上就是一行新的 —— 与「沿用换行」那条口径一致。
   *
   * @param {boolean} [implicit] 来自画布 / 工具条的隐式提交（空内容按取消处理）
   */
  commitEdit: function (implicit) {
    const id = this.data.editId;
    if (!id) return;
    /* ★★ 275 轮：**图片还在上传时不许保存** —— 显式与隐式（点画布 / 点别的键）**同一道闸门**。
       两件事都会发生，而且都不出声：`editImgUri` 那一刻还是空的 ⇒ 存进去的是"没挂图"，
       用户却以为挂上了；面板一收，那张正在传的图回来也没处安放。
       挡一下（约一两秒，上传失败时 `editImgUp` 会自己落回 false）比静默丢图好得多。 */
    if (this.data.editImgUp) {
      wx.showToast({ title: '图片还在上传，稍等一下', icon: 'none' });
      return;
    }
    const text = String(this.data.editText || '').trim();
    const cur = this.data.selNode;
    /* ★★ 275 轮：图是不是真的改了 —— 与进面板那一刻的值比（`_editImgInit`，
       在 `runAct('edit')` 里落的）。没改就不该顺手顶 updatedAt，更不该发一次没必要的请求。 */
    const imgUri = String(this.data.editImgUri || '');
    const imgChanged = imgUri !== String(this._editImgInit || '');
    /* ★ 275b：比例跟着图一起判"改没改" —— 换了一张比例不同的图、uri 恰好相同是不可能的，
       但"撤图再挂回同一张"这种情况 uri 一样、比例一样，也不算改。 */
    const imgAr = Number(this.data.editImgAr) || 0;
    if (!text) {
      if (implicit) {
        /* 隐式提交：没有东西可保存，安静收场（等价于原来的行为） */
        this._attSeq = (this._attSeq || 0) + 1;
        this.setData({
          editId: '', editText: '',
          editImgOn: false, editImgUri: '', editImgUrl: '', editImgUp: false, editImgAr: 0
        });
        return;
      }
      /* 显式保存：面板、草稿都留着 —— 让用户能接着改，或自己按「取消」 */
      wx.showToast({ title: '节点文字不能为空，不要了就按「取消」', icon: 'none' });
      return;
    }
    this.setData({
      editId: '', editText: '',
      editImgOn: false, editImgUri: '', editImgUrl: '', editImgUp: false, editImgAr: 0
    });
    this._attSeq = (this._attSeq || 0) + 1;
    if (cur && cur.id === id && cur.text === text && !imgChanged) return;   // 没真改就别顶 updatedAt
    const patch = { text: text };
    /* 空串 ＝ **撤图**（不是"没传这个字段"）：`normalizeTree()` 收空串就等于没挂图，
       与胶囊 `setCapsuleImage(id, null)` 同一条口径。
       ★ 275b：比例与 uri **必须同批**写 —— 只写 uri 不写比例，节点就会拿着上一张图的
       比例去算图块高（症状是"换了张竖图，节点高矮不对、图被拉扁"）；撤图时比例一并清 0。 */
    if (imgChanged) {
      patch.imageUri = imgUri;
      patch.imageRatio = imgUri ? (imgAr || 0) : 0;
    }
    store.updateNode(this.data.mindmapId, id, patch);
    this.refresh();
  },

  /* ================= 编辑面板 · 挂图（★★★ 275 轮） =================

     用户口径（第 3 条）：「节点编辑弹窗中需要增加图片挂载编辑功能（参考胶囊编辑）」。
     ⇒ 直接复用 `components/capsule-attach`（三态与两句文案只有一份），链路也与
        闪念胶囊的 `_attachPick` **逐环同款**：

           imgpick.pick → 立刻本地预览 ＋ 「上传中」→ imgpick.upload → uri/url 落进草稿

     分两步调（而不是用一步到位的 `pickAndUpload`）的理由一样：要拿**本地临时路径**
     去盖那层「上传中」的霜白，否则那层提示永远看不到（胶囊那边有整段说明）。

     ⚠️ 三条与胶囊**有意相同**的取舍：
       ① **失败回空坑** —— 面板上只挂 1 张图，留着那张"没传上的图"会让人以为挂上了，
          而保存时根本带不上去（`imgpick` 口径③对此有不同取舍，那是待办表单的场景）；
       ② **上传中不许换图 / 撤图 / 保存** —— 换图会发出第二个上传，回来两张谁后到谁生效；
       ③ **草稿制** —— 改动只在 `editImgUri` 里，`commitEdit()` 才落库 ⇒ 「取消」是真的没动过。

     ⚠️ 换节点 / 关面板 / 换脑图都要**换号**（`_attSeq`）把在飞的回调作废。
        `alive()` 同时比 **号** 与 **editId**：号挡住"面板已经关了"，
        editId 挡住"号还没换、用户已经点了另一个节点"（那种情况下图会挂到别人身上）。

     ⚠️ 这里**没有**"看大图" —— 面板里正在编辑，用户要的是"换一张"；
        画布上那张也不给（画布自己能放大，用户第 2 条）。 */
  onEditAttachPick: function () { this._editAttachPick(); },
  onEditAttachRemove: function () { this._editAttachRemove(); },

  _editAttachPick: function () {
    if (!this.data.editId || !this.data.editImgOn || this.data.editImgUp) return;
    const self = this;
    const eid = this.data.editId;
    const seq = (this._attSeq = (this._attSeq || 0) + 1);
    const alive = function () {
      return !!self.data && seq === self._attSeq && self.data.editId === eid;
    };
    imgpick.pick(function (localPath) {
      if (!alive()) return;
      /* ① 先本地预览 ＋ 上传中（口径②：先预览、不等上传） */
      self.setData({ editImgUrl: localPath, editImgUp: true });
      /* ①b ★ 275b：**同时**读这张图的像素比例 —— 节点上的图"宽固定、高按比例"，
          这个比例要跟着图一起入库（`imageRatio`）；`imgpick` 是纯函数，读不到就回 null，
          此时 `editImgAr` 留 0 ⇒ 渲染走 4:3 兜底（`aspectFit`，只是两边留细边，绝不裁图）。
          ⚠️ 与上传**并行**发：`getImageInfo` 是本地读，比上传快得多，串行会让"上传中"多挂一会儿。 */
      imgpick.sizeOf(localPath, function (info) {
        if (!alive()) return;
        self.setData({ editImgAr: info ? info.ar : 0 });
      });
      imgpick.upload(localPath, function (uri, url) {
        if (!alive()) return;
        self.setData({ editImgUri: uri, editImgUrl: url, editImgUp: false });
      }, function () {
        /* ② 失败：toast 已由 `imgpick` 弹过，这里只做"回空坑" ——
           坑还在 ＝ 再点一次就是重试（组件那个 ✕ 也跟着没了，因为 url 空了）。
           ⚠️ 比例一并清 0：留着上一张的比例，坑里却是空的，下一次挂图会拿错比例算高。 */
        if (!alive()) return;
        self.setData({ editImgUri: '', editImgUrl: '', editImgUp: false, editImgAr: 0 });
      });
    });
    /* ⚠️ 用户取消选图：`imgpick` 两个回调都不来 ⇒ 这里什么都不用做 */
  },

  _editAttachRemove: function () {
    if (!this.data.editId || this.data.editImgUp) return;
    /* 撤图是**纯本地**动作（只改草稿）：不删服务器上的文件 ——
       别的胶囊 / 节点可能正引用着同一张图。
       ⚠️ 比例一并清 0（见 `commitEdit` 里 `patch.imageRatio` 那条）。 */
    this._attSeq = (this._attSeq || 0) + 1;
    this.setData({ editImgUri: '', editImgUrl: '', editImgUp: false, editImgAr: 0 });
  },

  /* ---------------- 语音录入（★ 第 70 轮） ----------------
     用户口径："单击之后节点卡片使用呼吸式光圈来做提示正在录音，且节点卡片使用半透明遮罩
     盖住节点文字，遮罩上浮现 60 秒倒计时，此时小麦克风也加呼吸式光圈进行提示，
     再次点击结束录音，节点卡片倒计时结束浮层显示「语音识别中」，等待后端返回语音对应文本后，
     将文本整体替换进该节点卡片中。"

     ⇒ 状态机只有三个态，全挂在**一个**节点上（同时只可能有一处录音）：
          ''    静止
          'rec' 录音中 —— 呼吸光圈 ＋ 半透明遮罩 ＋ **纯秒数**倒计时（`60` → `1`）；
                          再点（或 60s 到点）转 'up'
          'up'  语音识别中 —— 遮罩上的字变成「语音识别中」，等 `recognizeVoice` 回来
       回来之后：**整段替换**节点文本（不是追加、不是插入）。

     ⚠️「到点自动结束」与「手动再点一次」必须是**同一个出口**（`voiceStop`）——
        两处各写一份的话，"到点"那条路必然漏掉某件复位（第 68 轮 `dragMarkPayload` 就是这么栽的）。
     ⚠️ 真录音走**能力守卫**：一期是静态前端，DevTools 与出图脚本里可能根本没有
        `wx.getRecorderManager` ⇒ 拿不到就只跑 UI 状态机（光圈与倒计时照常），不抛错。
        识别那一步是**唯一**要接后端的口子，见 `recognizeVoice`。
  */

  /** 起录 */
  voiceStart: function (id) {
    if (!id) return;
    this.voiceCleanup();
    const self = this;
    /* ★★★ 2026-10-27（全量检查 F06）· **每起一段就换一个会话令牌** ——
       上一段还在识别中的那个回调（它捕获的是旧令牌）从此不许再碰录音状态。
       见 `voiceStop` 里那段。 */
    this._vtSeq = (this._vtSeq || 0) + 1;
    this._voiceT0 = Date.now();
    this._voiceTimer = setInterval(function () { self.voiceTick(); }, 200);
    this.setData({
      editId: '',
      /* ★★ 275 轮：起录会把编辑面板收掉 ⇒ 图草稿与在飞的上传一起作废（同 `onEditCancel`）。 */
      editImgOn: false, editImgUri: '', editImgUrl: '', editImgUp: false, editImgAr: 0,
      delArmed: false,
      voiceId: id,
      voicePhase: 'rec',
      voiceClock: fmtSec(VOICE_SEC * 1000)
    });
    this._attSeq = (this._attSeq || 0) + 1;
    this.startRecorder();
  },

  /** 每 200ms 一帧 —— 用「起点 ＋ 总时长」算剩余，不逐帧累减（丢一帧也不会漂） */
  voiceTick: function () {
    const left = VOICE_SEC * 1000 - (Date.now() - (this._voiceT0 || Date.now()));
    if (left <= 0) { this.voiceStop(); return; }        // 到点 ＝ 录音满 60s，自动收
    this.setData({ voiceClock: fmtSec(left) });
  },

  /** 停录 → 进「**语音识别中**」（★ 第 89 轮用户口径，原文案是「更新中」）→ 拿回文本 → 整段替换 */
  voiceStop: function () {
    if (!this.data.voiceId) return;
    const self = this;
    const id = this.data.voiceId;
    /* ★★★ 2026-10-27（全量检查 F06）· **这一段录音的会话令牌 ＋ 它属于哪张图**。
     *
     * ── 病根（改前）：回调里只捕获了 `id`，其余全读**当前** `this.data` / `this._vt`：
     *    · 换图之后 `data.voiceId` 已经是空的 ⇒ `gone` 为真，但下一行
     *      `setData({voiceId:'',voicePhase:'',voiceClock:''})` 在 `gone` 判断**之前**
     *      已经执行 —— 用户刚在新图里起的那一段被这条旧回调当场清掉
     *      （浮层消失、录音器还在跑）。
     *    · 更坏的一种：节点 id 在新图里**也命中**时，识别结果会被写到那张图上。
     * ── 现在：令牌 ＋ 图 id 都捕获下来，回调先验会话，再决定"写哪张图的哪个节点"。
     *    ⚠️ 过期**不等于把识别结果扔掉** —— 那段话用户只说过一次，能落到它当初那个节点
     *       就落（`updateNode(mid, id)` 自己会在节点不在了时返回 false）；
     *       过期只表示"不许再动界面上的录音状态"。
     * ⚠️ 令牌在**起录**（`voiceStart`）、**换图 / 进空态**（`refresh`）也各加一次 ——
     *    只在停录时加的话，"停录 → 认到一半 → 用户又起一段 → 再停"这套时序里
     *    中间那一段的回调仍然能命中。 */
    const tok = this._vtSeq = (this._vtSeq || 0) + 1;
    const mid = this.data.mindmapId;
    this.voiceCleanup();
    this.stopRecorder();
    this.setData({ voicePhase: 'up', voiceClock: '语音识别中' });
    /* ★ 本轮：录音文件是**异步**才拿到的（`stopRecorder()` 之后 `onStop` 才回来），
       所以先挂上"等音频"，拿到了再识别。
       ⚠️ `voicePhase:'up'` 已经落定在上面的 `setData` —— 用户看到的「语音识别中」一点都没晚。
       ⚠️ mock 下**不等**（见 `recognizeVoice` 的开关）：`awaitAudio()` 的兜底是 800ms，
          会把核验脚本（`shoot_mindmap.py`）的时序判据推后。 */
    const audio = api.useMock() ? Promise.resolve('') : this.awaitAudio();
    audio.then(function (file) {
      if (tok !== self._vtSeq) return;          // 等在音频上的这段时间会话已经换了
      self.recognizeVoice(file, function (text) {
        /* ⚠️ 会话校验在**动任何 state 之前**：这一条是 F06 的正题 */
        const stale = tok !== self._vtSeq || self.data.mindmapId !== mid;
        if (stale) {
          if (text && store.mindmapById(mid)) store.updateNode(mid, id, { text: text });
          return;
        }
        /* 期间可能已经换了脑图 / 删了这个节点 —— 对象没了就静默丢弃结果 */
        const gone = !self.data.voiceId || !store.findNode(self._vt, id);
        self.setData({ voiceId: '', voicePhase: '', voiceClock: '' });
        if (gone) return;
        if (text) store.updateNode(mid, id, { text: text });
        self.refresh();
      });
    });
  },

  /** 定时器的唯一回收点 */
  voiceCleanup: function () {
    if (this._voiceTimer) { clearInterval(this._voiceTimer); this._voiceTimer = null; }
  },

  /**
   * 等这一段录音的临时文件 —— ★ 本轮新增，**只服务接后端的识别链路**。
   *
   * ⚠️ 必须带兜底（800ms）：真机上 `onStop` 偶发不回，无限等下去会把浮层永远钉在
   *    「语音识别中」上（用户看到的是"卡住了"，比报错更难解释）。等不到就给空串 ⇒
   *    `api.asr()` 走失败分支 ⇒ 节点文本保持原样，用户重来一次即可。
   * ⚠️ 工具里**默认**不真录（`REC_IN_TOOLS = false`，见本文件顶部的常量）⇒ 这里会走兜底；
   *    把那个常量开成 `true`（或上真机）就等得到 `onStop` 给的文件。
   */
  awaitAudio: function () {
    const self = this;
    return new Promise(function (resolve) {
      let settled = false;
      const finish = function (p) {
        if (settled) return;
        settled = true;
        if (self._audioWait === finish) self._audioWait = null;
        resolve(p || '');
      };
      self._audioWait = finish;
      setTimeout(function () { finish(self._recFile || ''); }, 800);
    });
  },

  /**
   * ⚠️⚠️ **本期唯一"等后端"的口子** —— 别在别处再抄一份等待逻辑。
   * UI 那三个态（rec → up → 回填）与它**毫无耦合**，不用跟着改。
   */
  recognizeVoice: function (file, cb) {
    const self = this;
    /* ★ `USE_MOCK = true`（默认）—— 与接入前**逐字相同**：延时 `VOICE_UP_MS` 回一句占位文本。
       ⚠️ `_voiceWait` 这个句柄**必须留着**：核验脚本 `shoot_mindmap.py` 会
          `clearTimeout(c._voiceWait)` 把识别态**冻住**再截图 —— 不冻住的话，
          两次 CLI 往返（远超 1100ms）之后回调早已替换完节点文本，
          那张图拍到的就是"回填之后"，等于什么都没验（第 70 轮记过的假绿）。 */
    if (api.useMock()) {
      this._voiceWait = setTimeout(function () {
        self._voiceWait = null;
        cb(VOICE_STUB);
      }, VOICE_UP_MS);
      return;
    }
    /* ★ 真接口：一个 `POST /asr` 服务三个入口（待办录入 / 这里 / 胶囊口播）。
       ⚠️ 失败**不替换**节点文本（`cb('')` ⇒ 调用方不写），也不能把节点删掉 ——
          识别失败只是"这次没听清"，用户重新按一次语音键即可。
       ★★ 2026-09-30：提示文案改由 `api.asrHint()` **分档**（与闪念胶囊同一句真源）——
          原来一律「没听清」，会把"没连上后端 / 登录失效"也读成"识别不准"。 */
    api.asr(file).then(function (r) {
      cb((r && r.text) || '');
    }, function (e) {
      try { wx.showToast({ title: api.asrHint(e, !!file, self._recErr), icon: 'none', duration: 3000 }); } catch (err) { /* 提示失败不影响收尾 */ }
      cb('');
    });
  },

  /** 录音器（能力守卫）—— 拿不到就返回 null，UI 照跑 */
  ensureRecorder: function () {
    if (this._rm !== undefined) return this._rm;
    this._rm = null;
    try {
      if (typeof wx.getRecorderManager === 'function') {
        const rm = wx.getRecorderManager();
        const self = this;
        /* ⚠️ `onStop` 是**累加**监听 —— 只注册一次（放这里最稳：整个组件生命周期一次）。
           ★ 本轮：拿到路径的同时兑现"等音频"的那个 deferred（`awaitAudio` 挂的）。 */
        rm.onStop(function (res) {
          /* ★ 257：`onStop` ＝ 底层采集通道真关了 ⇒ 解锁 `startRecorder` 那道节流 */
          self._recBusy = false;
          self._recFile = (res && res.tempFilePath) || '';
          const done = self._audioWait;
          self._audioWait = null;
          if (done) done(self._recFile);
        });
        /* ★★ 2026-09-30 新增：把"**录不了**"的原因留下来（与闪念胶囊同一口径）。
           没有这条回调时，录音起不来只会表现成"等 800ms 兜底、然后什么都没发生"，
           与"用户没说话"完全同一个样子 —— 分不清是权限/设备的问题还是人的问题。
           ⚠️ 顺手**兑现 deferred**，否则那层「语音识别中」会一直不收。 */
        rm.onError(function (err) {
          /* ★ 257：英文原串只进 console，人看中文（`api.shortErr` 分档） */
          try { console.warn('[mindmap] recorder onError', err); } catch (e) { /* 无 console 也不影响 */ }
          /* ★★ 2026-10-22（审查 P2-07）· **录不了就收回录音态**（与闪念胶囊同一口径）。
             ── 改前只记录原因，倒计时与呼吸光圈照跑 ⇒ 用户按满 60 秒才知道没录上。
             ── 现在：还在 `rec` 态 ⇒ 停计时、清 `voiceId/voicePhase`、按原因提示
                （`api.asrHint` 的"录音不可用：…"分档），节点文本保持原样。
             ⚠️ 只收 `rec`：`voiceStop()` 之后是 `up` 态，那时 onError 属于
                "音频没拿到"，由 `recognizeVoice` 按 `_recErr` 报，不能再插手。
             ⚠️ `voiceCleanup()` 必须有：200ms 的 tick 仍在跑，到点会调 `voiceStop()`，
                而 `voiceStop()` 在 `voiceId` 已清时早退 —— 清掉它才不会有僵尸定时器。
             ★ 257：整段动作收进 `_abortVoice()` —— 与 `onInterruptionBegin` 共用出口。 */
          const raw = (err && err.errMsg) || '录音失败';
          self._abortVoice(raw, api.asrHint(null, false, raw));
        });
        /* ★★★ 257 轮新增 · **被系统打断**（微信语音/视频通话抢麦克风）。
           它走的是 `onInterruptionBegin`，**不会**触发 `onError` ⇒ 改前会一路倒计时到
           60 秒才停，用户以为说了大半段，实际一个字都没进来（与 P2-07 同一个病）。
           ⚠️ 先 `stop()` 再收 UI：中断时底层停在 pause，不 stop 就回不到空闲态
              ⇒ 下一次 `start()` 继续撞 PCM 通道，"被打断一次"会变成"这台设备录不了"。
           ⚠️ `_stopAt` 打点：打断后马上再按语音键，同样要留出重启间隔。 */
        rm.onInterruptionBegin(function () {
          try { console.warn('[mindmap] recorder interruptionBegin'); } catch (e) { /* 同上 */ }
          self._recBusy = false;
          self._stopAt = Date.now();
          try { rm.stop(); } catch (e) { /* 已停 / 不支持就跳过 */ }
          self._abortVoice('interrupted', '被通话或其他录音打断，请稍后重试');
        });
        rm.onInterruptionEnd(function () {
          self._recBusy = false;
          self._stopAt = Date.now();
        });
        this._rm = rm;
      }
    } catch (e) { this._rm = null; }
    return this._rm;
  },

  /**
   * ★★★ 257 轮 · **"这一段录不下去"的唯一出口**（`onError` 与 `onInterruptionBegin` 共用）。
   *
   * 顺序不能反：
   *   ① **兑现 deferred** —— 不兑现的话 `awaitAudio` 要等满 800ms 才醒，醒来第一件事
   *      是去拿"上一段"的文件 ⇒ 一段错位的转写；
   *   ② 解锁底层（`_recBusy = false` + 撤掉待发定时器）；
   *   ③ **只在 `rec` 态收 UI** —— `voiceStop()` 之后是 `up` 态，那时的错属于
   *      "音频没拿到"，由 `recognizeVoice` 按 `_recErr` 报，再收一次会误伤下一段。
   *
   * ⚠️ `voiceCleanup()` 必须有：200ms 的 tick 仍在跑，到点会调 `voiceStop()`；
   *    它在 `voiceId` 已清时早退，但定时器本身要清掉，否则是僵尸。
   *
   * @param {string} recErr 录音器原始 `errMsg`
   * @param {string} tip    已翻好中文的提示
   */
  _abortVoice: function (recErr, tip) {
    this._recErr = recErr || '录音失败';
    this._recBusy = false;
    this._recWanted = false;
    this._clearStartDelay();
    const done = this._audioWait;
    this._audioWait = null;
    if (done) done('');
    /* ★★ 2026-10-27（F06）：这一段作废 ⇒ 在飞的旧识别回调也不许再动状态 */
    this._vtSeq = (this._vtSeq || 0) + 1;
    if (this.data.voicePhase !== 'rec') return;
    this.voiceCleanup();
    this.setData({ voiceId: '', voicePhase: '', voiceClock: '' });
    try { wx.showToast({ title: tip, icon: 'none', duration: 3000 }); } catch (e) { /* 提示失败不影响复位 */ }
  },

  /** 撤掉"等上一段收尾"的待发定时器（停录 / 打断 / 组件销毁都要清） */
  _clearStartDelay: function () {
    if (this._startTimer) { clearTimeout(this._startTimer); this._startTimer = null; }
  },

  startRecorder: function () {
    /* ★ 每次起录先清上一段的残留 —— 见 `capsule.js` 同名逻辑的说明 */
    this._recFile = '';
    this._recErr = '';
    const rm = this.ensureRecorder();
    if (!rm) return;
    /* ⚠️ **开发者工具里不真录**（★ 第 70 轮）——
       `rm.start()` 会弹系统授权框（「希望获取 operateRecorder 的操作权限」），
       那个弹窗带**全屏暗遮罩**：它一出，整批核验图当场被压暗、交付图全废，
       而自动化脚本**点不到**它（不是小程序页面里的按钮）。
       一期语音识别走 stub（见 `recognizeVoice`）—— 录下来的那个文件**没有下游消费者**，
       所以在 tools 里只跑 UI 状态机完全等价（光圈 / 遮罩 / 倒计时照常）。
       ⚠️ 真机走下面那条真录路径（那才是要上传给后端的文件）；要联调 DevTools 录音改 `REC_IN_TOOLS`。 */
    if (!REC_IN_TOOLS && isDevtools()) return;
    /* ★★★ 257 轮 · **等上一段真的收尾再 `start()`**（见 `VOICE_RESTART_GAP`）。
       两道闸门：① 距上次 `stop()` 不足 `VOICE_RESTART_GAP` 就先等；
       ② `_recBusy` 仍为 true（`onStop` 没回）再等一轮，最多让两轮（＋400ms），
       超过就照常 start —— 底层极小概率永远不回 `onStop`，"永远不录"比"偶发失败"更糟。
       ⚠️ `if (!self.data.voicePhase) return` 是**语义**不是保险丝：这 300ms 里用户
          可能已经点了停 ⇒ 这次起录整个作废，绝不起一个没人收的录音。 */
    const self = this;
    this._clearStartDelay();
    /* ★★★ 257 · **不要用 `data.voicePhase` 判"用户是不是已经停了"**：
       它是 `setData` 下发的，落进 `this.data` 与"起录"不在同一拍 —— 判错一次
       就把这一段整个吞掉（连点两次语音键时尤其明显）。改用同步的意愿标记：
       起录置 true，停录 / 打断置 false。 */
    this._recWanted = true;
    const gap = VOICE_RESTART_GAP - (Date.now() - (this._stopAt || 0));
    const go = function (retry) {
      self._startTimer = null;
      if (!self._recWanted) return;
      if (self._recBusy && retry > 0) {
        self._startTimer = setTimeout(function () { go(retry - 1); }, 200);
        return;
      }
      try {
        rm.start({ duration: VOICE_SEND_SEC * 1000, format: 'mp3', sampleRate: 16000, numberOfChannels: 1 });
        self._recBusy = true;
      } catch (e) { /* 起不来就当"只走 UI" */ }
    };
    if (gap > 0) this._startTimer = setTimeout(function () { go(2); }, gap);
    else go(2);
  },

  stopRecorder: function () {
    /* ★ 257：先撤意愿 + 清掉"还没起录"的那一颗，再打时间戳（下一次靠戳算间隔） */
    this._recWanted = false;
    this._clearStartDelay();
    this._stopAt = Date.now();
    if (!this._rm) return;
    try { this._rm.stop(); } catch (e) {}
  },

  /* ---------------- 画布**右上角**工具栏（★ 第 81 轮建 · ★★ 第 253 轮换落点） ----------------
     用户口径（原文）：五颗键＝「撤回 / 重做 / 展开 / 收起 / 编辑」，
       「撤回」与「重做」一组 ‖ 「展开」与「收起」随后一组 ‖ 「编辑」自己一组
       （组间各一道竖线）。
     左组改的是**整棵树的历史**；中组改的是**选中节点那一支**的折叠态；
     右组是这张脑图自身的**属性**（名称 / 所属项目 / 格式）。
     节点级动作仍留在**左下角**那条浮条上（右上管"整图 + 选中支"，左下管"单个节点"）。
     造型仍与那条浮条同源（`.fb-btn` 56 热区 / 40 的 `.fb-tile` 底色 / 图标 30），不另起一套。
     ★★★ 254 轮：两条工具条**整体 ×1.5**（用户口径「上下两组操作栏应该整体加大 50%」）——
        热区 44 → 66、视觉块 32 → 48、图标 24 → 36、间距 4 → 6、竖线 17 → 26。
     ★★★ 255 轮：**收到 ×1.25**（用户口径「1.5 倍又有点大了，稍微再缩小一点」）——
        热区 66 → 56、视觉块 48 → 40、图标 36 → 30、间距 6 → 5、竖线 26 → 21；
        热区四条边贴 0（可见块离画布边 8；原来是上/下 10、左/右 12 ⇒ 块离边 19/21）；`runAct` 同样一个字没动。

     ★★ 253 轮（《脑图工具栏位置方案》）：这两条工具条从"上下通栏居中"改成
        **贴右上 / 贴左下** —— 上下两边的正中央是画布最贵的地方（三种纵向格式的根节点
        就落在那里），而"两个角"是画布上最稳定的空白。整条胶囊外壳同时撤掉（减重）。
        ⚠️ 这一轮 **`runAct` 一个字没动**：改的只有落点与外壳，没有新增/合并任何动作。

     ⚠️ 第 81 轮的两次撤并（用户第 1 / 2 条）：
        · 「展开 / 收起」**从底部浮条搬上来** —— `runAct` 里那两个分支一个字没动，
          搬的只是落点；
        · 「格式」那颗键 ＋ 它的格式主弹窗（`onFormat` / `onFormatClose` / `data.fmt`）
          **整条取消** —— 用户口径「编辑中本身就有格式调整功能」⇒ 换格式改走
          「编辑」抽屉里那一行（`form-drawer` 的 formats 选择器）。
     ⚠️ 第 71 轮**撤掉**两颗键：`onExport`（单独导出这张脑图成 md）与 `onMore`（⋯）——
        用户口径「原有的导出和更多功能取消」。原来「⋯」里的三件事各有新家：
        · 新建一张脑图 → **列表抽屉底部**那颗「＋ 新建脑图」（本来就有，不是新做）；
        · 删除这张脑图 → **编辑抽屉底部**的危险位（`onFormDelete` → `confirmRemove`）；
        · 键盘快捷键说明 → 随「更多」一起取消（一期不做 PC Web，键位记在工作备忘录）。 */

  /**
   * 「切格式」的**唯一写入口**。
   *
   * ⚠️ 第 81 轮现状：**没有任何一颗键 / 弹窗会调它** —— 用户口径「原有的'格式'及其抽屉
   *    取消，编辑中本身就有格式调整功能」⇒ 用户侧的正路是顶部「编辑」抽屉里那一行
   *    （`form-drawer` 的 formats 选择器，提交时随名称 / 所属项目一起写回 store）。
   *    但它**必须留着**，且必须留成"一个参数一步到位"的样子：核验脚本靠它把
   *    六种格式逐个切过去（`工具/shoot_mindmap.py` 的 `FN_SET`、`工具/shoot_fishbone.py`）
   *    —— 六格式的排版 / 零重合 / 连线形态 / 接管区断言全部挂在它身上。
   *    这条路与**用户走的那条（表单提交）最终落到同一个 store 调用**（`updateMindmap`），
   *    所以两边验出来的排版是同一套。
   * ⚠️ **不换图** ⇒ 视口（平移 / 缩放）保留：用户是站在同一张脑图上看它换排布，
   *    这时候把画布弹回 100% 会让他刚调好的视角白调。
   * ⚠️ 传的 key 与当前相同 ＝ 只返回，不写库、不刷 updatedAt
   *    （否则"点开看看又关掉"会把这张图顶到列表最前面）。
   */
  setFormat: function (key) {
    const mid = this.data.mindmapId;
    if (!mid || !key) return false;
    if (key === this.data.formatKey) return false;
    store.updateMindmap(mid, { format: key });
    this.refresh();
    wx.showToast({ title: '已切换为「' + store.formatOf(key).label + '」', icon: 'none' });
    return true;
  },

  /**
   * 「编辑」→ 弹**脑图信息编辑抽屉**（名称 / 所属项目 / 格式，三项一次改完）。
   * 图标用的是`more`（⋯）那枚 —— 用户口径「「编辑」使用更多的图标」。
   * ★ 71 轮：抽屉底部多了「删除这张脑图」这颗危险键（走 `onFormDelete`），
   *   原来挂在顶部「⋯」上，那颗键取消后搬到这里。
   */
  onEditInfo: function () {
    if (!this.data.mindmapId) return;
    this.openForm('mindmap', this.data.mindmapId);
  },

  /* ---------------- 顶栏 ---------------- */

  /**
   * 「删除这张脑图」（★ 第 71 轮）—— 从画布顶部「⋯（更多）」搬到**编辑抽屉底部**
   * 的危险位（`.sd-del`，与项目「归档项目」、agent / token「删除」同一颗）。
   *
   * ⚠️ 顺序：**先把抽屉收掉、再弹确认框**。反过来会把一个模态确认框压在表单抽屉上面，
   *    用户点「取消」之后还留着一张"正在编辑一张马上要没了的脑图"的表单，读起来自相矛盾。
   * ⚠️ 用 `form.id` 而不是 `data.mindmapId` —— 两者当下恒等（这个抽屉只从当前这张图打开），
   *    但拿**表单自己的 id** 更不容易在将来"从别处打开脑图表单"时删错对象。
   */
  onFormDelete: function () {
    const id = this.data.form.id;
    if (!id) return;
    this.onFormCancel();
    this.confirmRemove(id);
  },

  /**
   * 删脑图 → 待办上的关联被置空，但待办一条不删（FR-3.4 口径 3）。
   * ⚠️ 名字从**被删的那张脑图**现查（入参 id），不再读 `this.data.name`：
   *    删的对象一旦由参数传入，确认框里的名字就必须跟着那个对象走，
   *    否则会出现"删 A 却问『删除 B？』"。
   */
  confirmRemove: function (id) {
    const self = this;
    const mid = id || this.data.mindmapId;
    if (!mid) return;
    const m = store.mindmapById(mid);
    const linked = store.state.todos.filter(function (t) { return t.mindmapId === mid; }).length;
    wx.showModal({
      title: '删除「' + (m ? m.name : '这张脑图') + '」？',
      content: '有 ' + linked + ' 条待办关联着这张脑图。\n删掉之后这些待办的「关联脑图」会被清空，但**待办本身一条都不会删**。\n删完本模块回到空态并自动弹出列表抽屉。',
      confirmText: '删除',
      confirmColor: store.danger(),
      success: function (r) {
        if (!r.confirm) return;
        store.removeMindmap(mid);
        self.refresh();
        self.openListDrawer('mindmap');
      }
    });
  },

  /* ---------------- 缩放 ---------------- */

  /**
   * 「适应屏幕」＝ 回到 100% 且不偏移。
   * 节点本来就是按画布尺寸自动排版的，所以这一档就是**复位** ——
   * 图被拖飞了、缩过头了，点它回来。
   * ★ 本轮：左下角那排缩放控件整条撤掉之后，入口一度只剩**键盘 `0`**（PC 专属）。
   * ★ 审查-02 P1-7（2026-10-14）：**补上触屏入口** —— 缩放时浮现的那颗比例胶囊
   *   （`.mm-zoom`）挂了 `bindtap`，点的就是本函数；它内部再 `flashZoom()`，
   *   胶囊会留一屏 ⇒ 按下有回话。原先平板只有"双指捏"，而捏合只能连续缩放、
   *   捏不出「正好装下」那一档（PC 的键盘 `0` 一字未改）。
   */
  fitView: function () {
    /* ★ 第 67 轮：从"回到 100%"改成**真正适应内容** ——
       图的体积随着折行变大了，100% 常常只看得到一角，"适应屏幕"这个名字
       也就名不副实了。现在它就是 fitViewOf 的那一套（装得下仍是 100%）。 */
    const v = fitViewOf(this._L, this.data.landscape);
    /* ★★ 2026-10-24（复审 P2-14）：第四个参数把"本次下限"直接设成 `v.sv` ——
       否则 `applyView` 会把 `fitViewOf` 刚算出的低比例（如 12%）再钳回 20%。 */
    this.applyView(v.sv, r2(v.tx), r2(v.ty), v.sv);
    this.flashZoom();
  },

  /* ---------------- 跳转 ---------------- */

  onGoProject: function () {
    if (!this.data.projectId) return;
    store.setMemory('project', this.data.projectId);
    this.gotoModule('project');
  }
}));
