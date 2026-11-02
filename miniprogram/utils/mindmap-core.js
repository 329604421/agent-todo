/**
 * ★★ 171 轮新建：**脑图的纯核心** —— 「常量 ＋ 度量 ＋ 六种排版 ＋ 折叠几何 ＋ 连线 ＋
 *    节点载荷 ＋ 视口工具」，**没有一行 wx / 组件依赖**（只有 `stage.portWorkH()` 一处读屏）。
 *
 * ── 为什么要有这个文件 ────────────────────────────────────────────────────────
 * 用户在待办详情「关联脑图」卡里要的是「**就是把脑图显示在里面**」——
 * 与脑图详情那张画布**同一种画法**，区别只有三条减法：不能移动、不能编辑、不能缩放。
 * 唯一能保证"同一种画法"的办法就是**同一份实现**：另写一套近似的画法迟早漂，
 * 而且漂的时候没有任何东西会红。
 *
 * 这段代码**原本长在 `components/mod-mindmap/mod-mindmap.js` 里**（第 58–1976 行），
 * 171 轮原样搬到这里、一个字没改（改动只有两处：脑图模块顶部那句解构、本文件末尾的导出）。
 * ⇒ 想改排版 / 连线 / 度量：**只改这里**，两个调用方（脑图模块 / 待办详情的只读卡）同时生效。
 *
 * ⚠️⚠️ 无头判据脚本是按**源码切片**跑的，切片锚点就落在这个文件里：
 *    「const CANVAS 那一行」 → 「排版段开头那条『渲染』分隔注释」
 *    「const CANVAS 那一行」 → 「dist2 那个函数定义所在的行」
 *    改这两个锚点的名字，`check_mindmap_layout / links / drag / fold` 会一起挂。
 *    同理：切片里**不许出现 wx / require**（`const stage = require('./stage')` 排在锚点之前，
 *    脚本会自己塞一个 `stage` 桩进去）。
 *
 * ⚠️⚠️ 本注释里**一个字都不许写那两个锚点的字面量**（星号加斜杠那条分隔线、
 *    以及 `indexOf` 要找的那两串）—— 判据用的是 `indexOf`，注释里先出现一次，
 *    切片就会从**注释中间**开始，症状是 `new Function` 报一句没头没脑的
 *    「Unexpected token 'const'」。本文件第一版正是这么把四个判据一起弄挂的。
 */
const stage = require('./stage');
/* ★★ 275 轮：节点挂图 —— 渲染层要的是**完整地址**，而库里存的是相对 uri。
   拼地址只在"要看图"的场合做（与 `store` 的胶囊卡 `img` 同一个口径、同一个函数）。 */
const api = require('./api');

const CANVAS = { land: { w: 1168, h: 722 }, port: { w: 768, h: 1058 } };

/* 竖屏画布高**不是常量**：它 ＝ 工作区 − 70，而工作区随真机状态栏变
   （utils/stage.js 的 portWorkH()，MatePad Mini 上 1128 → 1091 ⇒ 画布 1058 → 1021）。
   70 ＝ 上 12 ＋ 下 16 ＋ 区块头 42，与 mod-mindmap.wxss 的 .mm-viewport / .links 同一个算式。
   ⚠️ 状态栏高在一次会话里不变（转屏也不变），所以挂在模块加载时算一次就够；
      真机读数若晚于模块加载才可用，会在 layout 里再校一次（见 syncPortCanvasH）。 */
const MM_CHROME_H = 70;
function syncPortCanvasH() {
  CANVAS.port.h = Math.max(1, stage.portWorkH() - MM_CHROME_H);
  return CANVAS.port.h;
}
syncPortCanvasH();

/* 横屏画布高**也不是常量**（★ 185 轮）—— 与竖屏那条**同源异式**：
   横屏 ＝ 工作区 − 54（54 ＝ 上 0 ＋ 下 20 ＋ 区块头 34），
   竖屏 ＝ 工作区 − 70（70 ＝ 上 12 ＋ 下 16 ＋ 区块头 42）。
   工作区随视口高变（utils/stage.js 的 landWorkH()，iPad mini6 横屏 776 → 816 ⇒ 画布 722 → 763）。
   ⚠️ 与 mod-mindmap.wxss / mm-canvas.wxss 里那三处 `--work-h-land` 是**同一个算式**，
      改一处必须连着改（`.mm-viewport` 的 CSS 尺寸就是这里的 CANVAS.land 的渲染值 ——
      mod-mindmap.js 的 measure() 拿它反推卡片缩放，两边不一致会让落点整体偏）。 */
const MM_CHROME_H_LAND = 54;
function syncLandCanvasH() {
  CANVAS.land.h = Math.max(1, stage.landWorkH() - MM_CHROME_H_LAND);
  return CANVAS.land.h;
}
syncLandCanvasH();

/* ---------------- 视口 · 手势阈值（★ 第五轮，照参考版口径） ---------------- */
const VIEW_MIN = 0.2;          // 缩放下限（★ 第 67 轮 0.4 → 0.2：节点改成折行自适应之后，
                               //   一棵 21 节点的树横着能铺到 3000+ px，0.4 的地板会卡住"看全"
                               //   这个最基本的诉求 —— 先看得见全貌，再放大读字）
/* ★★ 2026-10-24（复审 P2-14）：**"适应屏幕"允许比用户缩放下限更低**。
   ── 病根：`fitViewOf()` 算出的比例也要过 `clampView()` ⇒ 一张需要 12% 才装得下的宽树，
      点「适应屏幕」后仍停在 20%，右下角那一大片还在画布外 ——"适应屏幕"名不副实。
   ── 为什么不用"把 VIEW_MIN 调到 0.05"这条路：`VIEW_MIN` 是**用户连续缩放**的地板
      （它同时被 pinch / 滚轮 / ± 键引用，改它等于放宽所有入口的缩放下限），
      而且 `工具/check_safe_band.js` 等判据按 0.2 钉着它。
      ⇒ 单开一支"只给 fit 用"的地板，两条口径各自独立。
   ⚠️ 5% 是"再小就纯属凑数"的实用下限：400 宽的画布上，5% 意味着 8000px 宽的内容
      刚好能进来 —— 再宽就该改用折叠 / 换布局，而不是继续缩。 */
const VIEW_FIT_MIN = 0.05;
const VIEW_MAX = 2.5;          // 缩放上限（参考版放到 5，本项目节点是自动排版、放太大会空）
const HOLD_MS = 300;           // 按住节点多久进入拖拽
const DRAG_PX = 8;             // 屏幕位移超过它 → 立刻进入拖拽（不必等长按）
const TAP_PX = 20;             // 松手时位移小于它 …
const TAP_MS = 500;            // … 且时长小于它 ⇒ 算一次点击（选中节点）
const PAN_STEP = 40;           // PC 方向键每次平移多少（容器设计坐标 px）
const ZOOM_STEP = 0.2;         // 「＋ / −」每档缩放
const WHEEL_K = 0.001;         // 滚轮灵敏度（照参考版）

/* ⚠️ 第 68 轮整块撤掉三个常量：`GAP_HIT`（同级指示线首尾留白）、`HIT_PAD`（"收作子节点"
   的命中容差）、`SIB_MAX`（离参照节点太远就不给提示）。它们全都服务于**手指位置**
   （cx / cy）那套落点判定 —— 而这套判定连同"同级插入指示线"一起被参考图推翻了：
   现在的落点只看**被拖动节点自己的矩形**，且只有一种落点（挂到某个父节点的第 k 位）。 */

/* ================= 拖拽标记（★ 第 68 轮：按参考图重做） =================

   参考图（用户给了 5 张连续帧）里的交互是**两件事在说话**，而不是"手指下面是谁"：

     ① **标记位置关系**（长按即出现，跟手不动）：
        · 被拖节点拎起来 ⇒ 一枚**半透明**浮动副本跟手；
        · 它的**当前父节点**套一圈**蓝色实线框**；
        · 从那个父节点的近侧边拉一条**蓝色折线**到浮动副本 —— 这条线就是"你现在挂在哪"；
        · 原位留一枚**灰色虚线框**（＝被拖节点自己原来占的那一格）；
        · 被拖节点的**整棵子树**用一枚**虚线圆角大框**圈住（"这一窝要跟着走"）。

     ② **提示最终落点**（随着手指拖动而**切换**）：
        · 一旦浮动节点的**左上角**在横纵两个方向都越过了某个节点 ⇒
          那个节点成为**候选新父节点**：框**从原父节点挪到它身上**，
          折线也**一起改接到它**；
        · 一句话：**高亮框 ＋ 折线永远指向"松手后会挂到的那个父节点"**。

   ⇒ 所以"标记"是**一套**（框 ＋ 线 ＋ 两个虚线框），颜色**只有一个** `DRAG_C`。
      ⚠️ 第 68 轮按参考图把它定成了蓝 `#2E6BE6`；**第 69 轮按用户口径改回品牌黄** ——
         用户原话："整个交互变色用的是蓝色，应该用应用的品牌色黄色"。
         参考图里那套蓝是人家的产品色；本工程的品牌色是黄，标记色就该从品牌色走。
      ⚠️ 上一版（66 轮）是品牌黄 ＋ 一条竖线插到同级之间；竖线那套已被用户明确要求**去掉**。 */
/* ⚠️⚠️ 118 轮：这一支**不能**改成 `var(--yellow)` ——
   它被拼进 SVG 的 `data:` URI（见下面 `previewLink` 的 `stroke="' + DRAG_C + '"`），
   而 `data:` URI 是**独立文档**，拿不到宿主的 CSS 变量。
   ⇒ 它是全工程**唯一一处"必须与 `--yellow` 手工同值"**的颜色常量：
      wxss 里那几处（`.mm-parent-box` / `.mm-scope-box` / `.mm-ghost` / `.mm-node.sel`）
      已全部走 `var(--yellow)`，改品牌黄时它们自动跟，**这里必须手改**。 */
const DRAG_C = '#FFD02F';      // 拖拽标记色 ＝ **品牌黄**（父节点框／预览折线／子树虚线框／拖动体描边，同一色）
const PARENT_PAD = 3;          // 候选父节点框相对节点外扩多少 —— ⚠️ 预览折线的起点必须用**同一个量**（否则线从框里钻出来）
const DROP_TOL = 12;           // 「接管区」相对节点的子节点包围盒**向外扩**多少（画布坐标）—— 见 `dropBoxOf`
const DROP_STEP = 24;          // 叶子节点的"孩子位"沿展开轴多长 —— 只在同类间距一条都测不到时的兜底

/* ★ 第 92 轮 · 路线 A：**判定点落在某个节点身上**时，沿"兄弟排列轴"的两端各让出一段，
   给"插在它前/后"（同级），中间归"成为它的子节点" —— 见 `hostOf` 的函数头。
   ★★ 第 211 轮：**从"宿主尺寸的 1/4"改成常量像素**（P1-1）。旧口径下同一句"与它同级"
   在树形图里只有 10px（节点高 40 × 0.25）、在逻辑图里有 59px（节点宽 236 × 0.25）——
   差 6 倍，而且**跟内容的字长走**：字多的节点容错大、字少的几乎打不中。
   用户对"插在前面"的心理预期是恒定的距离感，与节点有多少字无关 ⇒ 钉成像素。
   值取 12，与 `DROP_TOL` 同量级（都是"手感容差"这一类量，别各自发明）。
   ⚠️ 上界保护 `min(EDGE_PX, 该轴尺寸 × 0.25)`：节点极小时（如 40 高的紧凑格）
      12px 已经占掉 30% ⇒ 让到 1/4 为止，免得"中间那段成为子"被挤没。
   ⚠️ 只有该侧**确实存在相邻兄弟**时这一段才让出去（`checkIsOverlap` 规则）；
      独生子节点不收缩，点哪儿都是"挂到它下面"。 */
const EDGE_PX = 12;
const SCOPE_PAD = 14;          // 子树虚线大框相对子树包围盒外扩多少

/* ---------------- 节点操作浮条 · 五颗键（★ 第 81 轮：原七颗，"展开 / 收起"搬去顶部） ---------------- */

/** 「加子节点 / 加同级节点」直接落的文本 —— 快速增加，不让用户先想名字（用户口径） */
const ADD_TEXT = '新增节点';

/** 录音上限（秒）—— 用户口径「60 秒倒计时」；到点自动停，与手动再点停走**同一个出口** */
const VOICE_SEC = 60;

/**
 * **真正上传给 ASR 的时长** —— ★ 比 UI 的 60 秒少 1 秒（技术文档 §6.8.1／§13 `#10`）。
 *
 * ⚠️ 这里只是**录音器的安全上限**，UI 上那一圈倒计时仍然是 `VOICE_SEC = 60`（用户口径）。
 *    腾讯云一句话识别的上限也是 60s，与 UI 顶格相撞时**整段会直接失败**
 *    （症状：说满一分钟必失败，说短的都正常）。少掉的 1 秒是最后那点静音。
 * ⚠️ 这是**待拍板项**：若决定"不做收口"，把这一行改回 `VOICE_SEC` 即可。
 *
 * ★ 改动前这里是 `VOICE_SEC * 1000 + 500`（＝ 60.5 秒）—— 那是**超出接口上限**的，
 *   属于"看着像留了余量、实际是踩线"，顺带在这一轮修正了。
 */
const VOICE_SEND_SEC = VOICE_SEC - 1;

/**
 * ★★★ 257 轮 · **两次起录之间的最小间隔**（毫秒，与 `components/capsule/capsule.js`
 * 的 `REC_RESTART_GAP` 同值同因）。
 *
 * `RecorderManager` 是全局单例：`stop()` 之后要等 `onStop` 回来底层才真正关掉采集通道。
 * 而语音键是"点一下录、再点一下停"，用户完全可能在 `onStop` 还没回的时候就按第二次
 * （尤其他发现第一段没录上、立刻重按）—— 那一下就撞 `errType:1, err:error PCM`。
 * ⇒ 起录前先看时间差与 `_recBusy`，都过了才 `start()`（见 `startRecorder`）。
 * 取 300ms：`onStop` 实测多在 100–200ms 内回来，而人抬手再按本身就要 200ms 以上。
 */
const VOICE_RESTART_GAP = 300;

/** 「语音识别中」停留时长：接真后端后由网络耗时决定，这里取一个"看得清那个浮层"的值 */
const VOICE_UP_MS = 1100;

/** 识别回来的占位文本 —— ⚠️ 只在一期用，`recognizeVoice` 一处替换即可去掉 */
const VOICE_STUB = '（语音）这是一段由语音转写进来的节点文本';

/**
 * 剩余毫秒 → **纯秒数**（★ 第 89 轮用户口径："不是一分钟倒计时应改为 **60 秒倒计时**"）。
 *
 * ⚠️ 别改回 `mm:ss` —— 那会显示成 `01:00`，正是用户否掉的那个形态。
 * **向上取整**：还剩 0.2s 也该显示 `1`，否则会出现"数字已经是 0、光圈还亮着"的那一瞬间。
 */
function fmtSec(ms) {
  return '' + Math.max(0, Math.ceil(ms / 1000));
}

/** 想让**开发者工具**里也真录（做录音联调时）改成 `true` —— 见 `startRecorder` 的守卫说明 */
const REC_IN_TOOLS = false;

/** 当前是不是开发者工具（拿不到 systemInfo 就按"不是"处理 —— 绝不因探测失败而拦住真机录音） */
function isDevtools() {
  try {
    return typeof wx.getSystemInfoSync === 'function'
      && wx.getSystemInfoSync().platform === 'devtools';
  } catch (e) { return false; }
}

/** 给矩形补上中心点 —— 连线函数（treeLink / boneLink / curveLR）要读 cx / cy */
function rectWithCx(r) {
  return { x: r.x, y: r.y, w: r.w, h: r.h, cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
}

const ZONE_GAP_MIN = 4;        // 子节点包围盒与父节点之间"算得上分开"的最小间隙（画布坐标）

/* ---------------------------------------------------------------------------
   落点判定 · **纯函数**（★ 第 68 轮）

   这两件事是**规则**而不是交互，所以抠成模块级纯函数：
   ① 好读好改（Component 里只剩"取数据 → 调它 → setData"）；
   ② 能进无头校验 —— `工具/check_mindmap_drag.js` 靠切片跑它（0.1s），
      不必为了验证一条判定规则先开模拟器出图（那是几分钟）。
   ⚠️ 别为了"顺手"把它们挪到那条「渲染」分隔注释**之后**：切片点就在那儿，
      挪过去校验脚本会当场拿不到它们。同理，这里只用 Math，不依赖 dist2（它在切片点之外）。
   ⚠️ 本段注释里**不要写那组分隔线的字面量**（星号加斜杠）：它会把本注释当场闭合，
      后面的字变成代码 —— 第 68 轮就是这么把校验脚本跑挂的。
   --------------------------------------------------------------------------- */

/**
 * 一个节点的**接管区** —— "把浮动节点放到这块地方，就等于挂到它下面"。
 * 返回 `{ core, box }` 两个盒：`core` ＝ **精确区**，`box` ＝ 精确区再向外扩 `DROP_TOL`。
 *
 * 口径（★ 第 80 轮新定）：
 *   · **有子节点** ⇒ 精确区 ＝ 它那些子节点的**包围盒**。
 *     依据是用户第 68 轮那句原话的反面：落点就是"那个节点自己的孩子该在的地方"，
 *     孩子已经在的地方当然是可落的。
 *   · **没有子节点** ⇒ 精确区 ＝ 把节点自己**沿 `zone` 方向平移一格**
 *     （步长取同类父子间距的中位数，`stepOf` 现算），也就是"它将来的孩子会长在哪"。
 *
 * ⚠️ **为什么必须是"两级"（精确区 ＋ 外扩区），不能只用外扩区**：
 *    同一行的兄弟之间只隔 `V_GAP`（12px），两侧各外扩 12 就会**互相咬进去 24px**，
 *    于是"锚点在谁那儿"变成"谁的盒子面积更小"—— 实测把节点拖到 `n2b1` 的位置会
 *    落到 `n2a` 身上（因为 `n2a1` 那行字短，面积小）。精确区之间是**严格互斥**的
 *    （不同节点的孩子包围盒不重叠），所以先用精确区判，判不出来才拿外扩区兜"差一点点"。
 * ⚠️ 叶子那一格必须**离开节点自己**（平移 `gap` 而不是贴着边）：
 *    贴着边写的话，"把节点放回它自己原来的位置"会命中它自己那一侧的空格
 *    （靠 `>=`／`<=` 的闭区间落在边界上），于是长按不动都会换父节点。
 */
function dropBoxOf(r, z, kids, L, stepOf) {
  let core;
  if (kids.length) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    kids.forEach(function (c) {
      const k = L[c.id];
      if (k.x < x0) x0 = k.x;
      if (k.y < y0) y0 = k.y;
      if (k.x + k.w > x1) x1 = k.x + k.w;
      if (k.y + k.h > y1) y1 = k.y + k.h;
    });
    core = { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  } else {
    const g = stepOf(z);
    core = z.axis === 'x'
      ? (z.sign >= 0 ? { x: r.x + r.w + g, y: r.y, w: r.w, h: r.h }
                     : { x: r.x - g - r.w, y: r.y, w: r.w, h: r.h })
      : (z.sign >= 0 ? { x: r.x, y: r.y + r.h + g, w: r.w, h: r.h }
                     : { x: r.x, y: r.y - g - r.h, w: r.w, h: r.h });
  }
  return {
    core: core,
    box: {
      x: core.x - DROP_TOL, y: core.y - DROP_TOL,
      w: core.w + DROP_TOL * 2, h: core.h + DROP_TOL * 2
    }
  };
}

/**
 * 每个节点的**子节点区朝向** —— `{ axis: 'x'|'y', sign: -1|0|1, slot: 'x'|'y', box }`。
 * `axis`/`sign` 给拖拽探针与折叠徽标用；`slot` 决定同级插入位沿哪根轴比大小；
 * `box` 是本节点的**接管区**（见 `dropBoxOf`）。六种格式不必各写一套。
 *
 * 判据（按顺序）：
 *   ① **子节点包围盒与父节点包围盒之间哪条边有正间隙** ⇒ 那条轴 ＋ 那个方向（取最大者）。
 *      这一条覆盖全部六种格式：逻辑图 / 鱼骨图 → `x`，
 *      树形图 / 组织结构图 / 时间轴 → `y`，思维导图 → 看这一支伸向哪边。
 *   ② 四条边都没有正间隙（子节点在两条轴上都与父节点交叠）⇒ 用子节点中心的**均值偏移**定轴；
 *      若该轴上**两侧都有**孩子 ⇒ `sign: 0` ＝ **两侧都认**。
 *      这一条是给**思维导图 / 时间轴的根**准备的：它的两支一左一右，"哪边都行"。
 *   ③ 没有子节点（叶子）⇒ **继承父节点的朝向** —— 它将来的孩子会长在同一侧。
 *
 * ⚠️ 为什么**不能**用"子节点中心偏移"直接定轴（第一版就是这么写的，一跑就挂）：
 *    树形图的偏移是"右下"、且两个分量同量级（实测 dx127 / dy115），均值法会把 `x`
 *    判成主轴，于是"往某个节点**下方**拖"永远落不上；而按**边界间隙**判，
 *    树形图只有"下间隙"是正数（+12），稳当选 `y`。
 * ⚠️ 另一条踩过的坑：`metricsMap` 读的是 `node.level`（不是递归深度）——
 *    拿它做无头校验时，测试树漏写 `level` 会让所有节点 depth 都是 0，
 *    组织结构图当场退化成一整行。校验脚本里必须显式写 level。
 * ⚠️⚠️ **第 80 轮把"接管区"并进了本函数**：`box` 与 `axis/sign/slot` 由**同一次遍历**
 *    产出，三处消费者（拖拽落点、折叠徽标、同级插入轴）看到的是同一份朝向。
 *    拆成两个函数早晚会出现"朝向按 A 算、接管区按 B 算"这种对不上的错位。
 */
function zoneMapOf(root, L) {
  const out = {};
  const hasByAxis = function (kids, axis, cmp, base) {
    return kids.some(function (c) {
      const k = L[c.id];
      const u = axis === 'x' ? (k.x + k.w / 2) : (k.y + k.h / 2);
      return cmp ? (u < base - 2) : (u > base + 2);
    });
  };
  /* 子节点中心在某一根轴上的**展开量** —— 用来判"同级沿哪根轴排开"（见下面的 `slot`） */
  const spread = function (kids, axis) {
    let lo = Infinity, hi = -Infinity;
    kids.forEach(function (c) {
      const k = L[c.id];
      const u = axis === 'x' ? (k.x + k.w / 2) : (k.y + k.h / 2);
      if (u < lo) lo = u;
      if (u > hi) hi = u;
    });
    return hi - lo;
  };
  /* **按某一根轴排开时，兄弟顺序是不是单调的**（＝ 与树序同向／反向）。
     ⚠️ 与 `slotIndexOf` 里的 `kOf` / `cmp` **逐字同口径**（字典序：主轴 → 另一轴）——
        两处若各写一份，就会出现"判排列轴时说 monotonic、算插位时按另一套比"的错位。 */
  const monoOf = function (kids, axis) {
    const kOf = function (r) { return axis === 'y' ? [r.y, r.x] : [r.x, r.y]; };
    /* ⚠️ `kids` 里是**节点对象**（`zoneMapOf` 的 locals 口径），不是 id —— 要过 `L[c.id]` */
    let up = true, dn = true;
    for (let i = 1; i < kids.length; i++) {
      const p = kOf(L[kids[i - 1].id]), q = kOf(L[kids[i].id]);
      const c = p[0] !== q[0] ? (q[0] - p[0]) : (q[1] - p[1]);
      if (c < -0.5) up = false;
      if (c > 0.5) dn = false;
    }
    return up ? 'asc' : (dn ? 'desc' : 'non');
  };
  (function walk(n, pZone) {
    const r = L[n.id];
    const kids = (n.children || []).filter(function (c) { return !!L[c.id]; });
    let z = null;
    if (r && kids.length) {
      let kx0 = Infinity, ky0 = Infinity, kx1 = -Infinity, ky1 = -Infinity;
      kids.forEach(function (c) {
        const k = L[c.id];
        if (k.x < kx0) kx0 = k.x;
        if (k.y < ky0) ky0 = k.y;
        if (k.x + k.w > kx1) kx1 = k.x + k.w;
        if (k.y + k.h > ky1) ky1 = k.y + k.h;
      });
      const cand = [
        { axis: 'x', sign: 1, v: kx0 - (r.x + r.w) },
        { axis: 'x', sign: -1, v: r.x - kx1 },
        { axis: 'y', sign: 1, v: ky0 - (r.y + r.h) },
        { axis: 'y', sign: -1, v: r.y - ky1 }
      ].sort(function (a, b) { return b.v - a.v; });

      if (cand[0].v > ZONE_GAP_MIN) {
        z = { axis: cand[0].axis, sign: cand[0].sign };
      } else {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        let dx = 0, dy = 0;
        kids.forEach(function (c) {
          const k = L[c.id];
          dx += (k.x + k.w / 2) - cx;
          dy += (k.y + k.h / 2) - cy;
        });
        if (Math.abs(dx) >= Math.abs(dy)) {
          z = { axis: 'x', sign: (hasByAxis(kids, 'x', true, cx) && hasByAxis(kids, 'x', false, cx))
            ? 0 : (dx >= 0 ? 1 : -1) };
        } else {
          z = { axis: 'y', sign: (hasByAxis(kids, 'y', true, cy) && hasByAxis(kids, 'y', false, cy))
            ? 0 : (dy >= 0 ? 1 : -1) };
        }
      }
      /* 同级沿哪根轴排开 —— 给 `slotIndexOf` 用。
         ⚠️ **不能**简单地取"展开轴的正交轴"：六种格式里只有三种成立。
            实测（`node .tmp-verify/_dumpdrag.js`）：
              · 逻辑图   子向右、兄弟**竖向**排 ⇒ 正交轴 ✔
              · 组织图   子在下、兄弟**横向**排 ⇒ 正交轴 ✔
              · 思维导图 子向左右、兄弟**竖向**排 ⇒ 正交轴 ✔
              · 树形图   子在下、兄弟**竖向**排 ⇒ **同轴**（取正交会把插位算反）
              · 时间轴   子在下、兄弟**竖向**排 ⇒ **同轴**
              · 鱼骨图   根的子沿主脊**横向**排 ⇒ **同轴**
            所以按"子节点中心的展开量谁大"实测判定，六种格式都不用特判：
            root 展开量 x1568 > y220 ⇒ x（鱼骨图）；树形图 y564 > x0 ⇒ y。
            ⚠️ **但这一行只是"那一棵树"的实测，不普适** —— 展开量是**树形相关**的，
               鱼骨图换一棵树就能翻过来（真机实测 x735 / y742）。见下面第 80 轮补的那段。
         ① 两侧都认（思维导图根 / 时间轴的根）⇒ 竖向：它两边的枝各自都是竖着排的；
         ② 否则看两根轴上的展开量，谁大用谁；
         ③ 只有一个孩子（两轴展开量都是 0）⇒ **继承父节点的**排列轴。 */
      let slot;
      if (z.sign === 0) {
        slot = 'y';
      } else {
        const sx = spread(kids, 'x'), sy = spread(kids, 'y');
        slot = (sx === sy) ? ((pZone && pZone.slot) || 'y') : (sx > sy ? 'x' : 'y');
      }
      /* ⚠️⚠️ 第 80 轮补：**展开量只能选"哪根轴更宽"，选不出"哪根轴能把树序排对"。**
         鱼骨图的根正好是反例 —— 一级节点沿**主脊**横向排（树序 ⇔ `x`），
         而"上支一个、下支一个"把 `y` 的展开量顶得更大。真机实测（m3 那棵树）：
         `spread(x)=735`、`spread(y)=742` —— **只差 7px**，判成 `'y'`。
         后果不是"排序略有偏差"，而是 `slotIndexOf` 的 `asc` 检测**也救不回来**：
         `[y,x]` 顺序下三个一级节点是 "上支、下支、上支"（y = 119 / 861 / 119），
         **既非升也非降** ⇒ 任何一个一级节点"**原地长按不动**"都会被算成插到末位 ⇒
         松手走一次 `moveNodeTo` 并弹「已调整顺序」（用户第 80 轮说的"没有逻辑"）。
         ⇒ 判据改成：**主轴若是"非单调"，而另一根轴单调 ⇒ 换到另一根轴**。
         只在"主轴非单调"时才会换 ⇒ 六格式实测 48 组里**只有 1 组**被改动（就是鱼骨图的根），
         其余 47 组（含鱼骨图下支镜像那种"降序"）一位不动。
         ⚠️ 两根轴都非单调时**不换** —— 那种情况换也救不了，交给 `slotIndexOf` 的 `asc` 兜底。 */
      const otherAxis = slot === 'y' ? 'x' : 'y';
      if (monoOf(kids, slot) === 'non' && monoOf(kids, otherAxis) !== 'non') slot = otherAxis;
      z = { axis: z.axis, sign: z.sign, slot: slot };
    }
    /* ⚠️⚠️ 第 80 轮修：这里原来写的是 `if (!z) z = pZone || {...}` —— **直接把父节点的 zone
       对象派给了子节点**（同一个引用）。66～79 轮只读 `axis/sign/slot`，继承来的值与父节点
       恒等，所以看不出来；第 80 轮往对象上挂了 `box`（接管区）之后，同一支上所有"没有自己
       朝向"的节点共用一枚对象 ⇒ **后算的把先算的覆盖掉**：症状是叶子节点的接管区被
       它的兄弟／父节点顶掉，落点判定到处落空（`n3b1` 原地长按都认不出 `n3b` 是父）。
       ⇒ 继承时必须**拷一份**，不能共用引用。 */
    if (!z) {
      const p = pZone || { axis: 'x', sign: 1, slot: 'y' };
      z = { axis: p.axis, sign: p.sign, slot: p.slot };
    }
    out[n.id] = z;
    (n.children || []).forEach(function (c) { walk(c, z); });
  })(root, null);

  /* ---- ② 每个 zone 的「父子典型间距」—— 叶子节点的"孩子位"多长靠它，不写死 ----
     key 用「轴 ＋ 符号」（`x1` / `x-1` / `y1` / `y-1`）：同一根轴的两个方向间距可以差很远
     （鱼骨图上支 38、下支 42），分开统计才不会被拉平。取**中位数**不取均值 ——
     有一两支被挤到负值或异常大时中位数不动。 */
  const gaps = {};
  (function collect(n) {
    const z = out[n.id], r = L[n.id];
    (n.children || []).forEach(function (c) {
      const k = L[c.id];
      if (r && k && z) {
        const g = z.axis === 'x'
          ? (z.sign >= 0 ? k.x - (r.x + r.w) : r.x - (k.x + k.w))
          : (z.sign >= 0 ? k.y - (r.y + r.h) : r.y - (k.y + k.h));
        const key = z.axis + (z.sign < 0 ? -1 : 1);
        if (g > 0) (gaps[key] = gaps[key] || []).push(g);
      }
      collect(c);
    });
  })(root);
  const stepOf = function (z) {
    const arr = gaps[z.axis + (z.sign < 0 ? -1 : 1)];
    if (!arr || !arr.length) return DROP_STEP;
    const s = arr.slice().sort(function (a, b) { return a - b; });
    return s[Math.floor(s.length / 2)];
  };

  /* ---- ③ 接管区（同一个 `out`，attach 上去：`core` ＝ 精确区、`box` ＝ 外扩区）---- */
  (function boxes(n) {
    const r = L[n.id], z = out[n.id];
    if (r && z) {
      const kids = (n.children || []).filter(function (c) { return !!L[c.id]; });
      const d = dropBoxOf(r, z, kids, L, stepOf);
      z.core = d.core;
      z.box = d.box;
      /* ★ `real` ＝ 这枚精确区是**从真实子节点量出来的**（不是叶子那格猜出来的）。
         `pickParentId` 靠它分层：真实区优先 —— 见那边的注释。 */
      z.real = kids.length > 0;
    }
    (n.children || []).forEach(boxes);
  })(root);
  return out;
}

/**
 * 锚点（**手指点**）直接落在某个候选节点的矩形里 ⇒ 它就是**落点宿主**（★ 第 92 轮 · 路线 A）。
 *
 * 返回 `{ id, sibling }`：
 *   · `sibling: false` ⇒ 成为它的**子节点**（锚点落在它中间那条带里）；
 *   · `sibling: true`  ⇒ 与它**同级**（锚点落在沿「兄弟排列轴」两端各 `EDGE_PX` 的带里，
 *                        且那一侧**确实有相邻兄弟**）；
 *   · `null` ⇒ 锚点不在任何候选节点上（兄弟之间的缝隙／空白处）⇒ 交给调用方的接管区兜底。
 *
 * 出处：`simple-mind-map`（wanglin2/mind-map）`simple-mind-map/src/plugins/Drag.js` 的
 *   `handleVerticalCheck` / `checkIsOverlap`。它把指针落点沿判断轴分三段：
 *   中间段 ⇒ `overlapNode`（成为子节点），两端各 1/4 ⇒ `prevNode` / `nextNode`（同级插入后／前）。
 *   ★ 第 211 轮：那个 1/4 已改成**像素常量 `EDGE_PX`**（见常量表）—— 原文的 1/4 会让
 *     同一句"与它同级"在 10px 与 59px 之间漂，而且跟着字长走。
 *   **最值得抄的是 `checkIsOverlap` 里那条**：
 *     `nodeRect[dir1] + (prevBrotherOffset > 0 ? 0 : size) <= pos`
 *   —— **这一侧有相邻兄弟时，这一侧的 1/4 容差不收缩**（整条边都算"成为子"区）；
 *      **没有兄弟才收缩 1/4**。我们照搬 ⇒ 独生子节点点哪儿都是"挂到它下面"。
 *
 * ⚠️ **为什么这条能治"只有逻辑图／思维导图判断得清楚"**：它**完全不看 `zoneMapOf` 推出来的
 *    朝向**。后四种格式（组织结构图／时间轴／鱼骨图／树形图）里"孩子方向**随层级变**"，
 *    朝向推导只对一半层级（见 `文档/Agent-ToDo-脑图父节点判定-算法调研与建议.md` §2）。
 *    锚点在谁身上就是谁 ⇒ 天然六格式通吃，也不再有"叶子继承父朝向、结果猜到隔壁兄弟身上"。
 * ⚠️ **为什么用手指点、而不是浮动矩形的左上角**：拖动时手指恒按在被拖节点上，
 *    而 `L`（`_L`）是**原位置**的布局、拖拽不改它 ⇒ `hitNode(手指)` 问到的正是
 *    "手指底下原本是哪个节点"，＝ 用户想把这块挪到哪儿。
 *    三个参照库（simple-mind-map / mind-elixir / dnd-kit）的锚点**全都是指针位置**。
 * ⚠️ 命中用**倒序**（后画的压在上面）—— 与组件里的 `hitNode` 同一口径。
 *    已知局限也照抄那条：被压在别的节点底下时返回的未必是**视觉上**那颗；
 *    但这正是"手指点在哪个节点上"该问的问题，所以这里用它、而不用它去比"谁的接管区更具体"。
 */
function hostOf(L, cands, at, opt) {
  const ax = at.x, ay = at.y;
  let host = null;
  for (let i = (cands || []).length - 1; i >= 0; i--) {
    const r = L[cands[i]];
    if (r && ax >= r.x && ax <= r.x + r.w && ay >= r.y && ay <= r.y + r.h) { host = cands[i]; break; }
  }
  if (!host) return null;
  const r = L[host];
  const sibs = (opt && opt.sibsOf) ? (opt.sibsOf(host) || []) : [];
  /* 兄弟只剩自己（独生子）⇒ 哪一端都没有邻 ⇒ 整枚节点都归"成为子" */
  if (sibs.length < 2) return { id: host, sibling: false };
  /* 兄弟沿**哪根轴**排开 —— 取**离得最近的那个兄弟**的方向上的主分量。
     ⚠️⚠️ 第 92 轮真机实测的两处反例，逼出了这个口径（一开始用的是"全体兄弟展开量大者"）：
       · **思维导图**：根的孩子左右分拨 ⇒ n1/n3 在右、n2 在左，
         `spread(x)=442 > spread(y)=189` ⇒ 选 x；可 n1 真正相邻的兄弟是**同一支上下排的 n3**，
         "横向 442px"之外是**另一支**。拿 x 判边带 ⇒ 锚点落在 x 中间 ⇒ 永远判"成为子"，
         「拖到 n1 下半 ⇒ 插在 n1 后面」这条路整条失效。
       · **鱼骨图**：一级沿主脊横向排（`spread(x)=735`）而上下支把 y 也撑起来，
         同样是"整组最宽"与"这颗节点的邻"不是一回事。
     ⇒ 改成问一句"**离我最近的那个兄弟在哪个方向**"：那个方向才是"人往旁边挪一格"的方向，
        也才是 `simple-mind-map` 的 `handleVerticalCheck / handleHorizontalCheck` 想区分的东西。
     （"最近"用中心距；没有兄弟时上面已经返回了。） */
  let nb = null, nbd = Infinity;
  sibs.forEach(function (b) {
    if (b === r) return;
    const d = Math.pow(b.x + b.w / 2 - (r.x + r.w / 2), 2) + Math.pow(b.y + b.h / 2 - (r.y + r.h / 2), 2);
    if (d < nbd) { nbd = d; nb = b; }
  });
  const ux = nb ? (nb.x + nb.w / 2 - (r.x + r.w / 2)) : 0;
  const uy = nb ? (nb.y + nb.h / 2 - (r.y + r.h / 2)) : 0;
  const axis = Math.abs(ux) >= Math.abs(uy) ? 'x' : 'y';
  const kOf = function (b) { return axis === 'x' ? (b.x + b.w / 2) : (b.y + b.h / 2); };
  const hk = kOf(r);
  let before = false, after = false;
  sibs.forEach(function (b) {
    if (b === r) return;
    const k = kOf(b);
    if (k < hk - 1) before = true;
    if (k > hk + 1) after = true;
  });
  const t = axis === 'x'
    ? (ax - r.x) / Math.max(1, r.w)
    : (ay - r.y) / Math.max(1, r.h);
  /* 两端各让出 `EDGE_PX`（★ 第 211 轮：像素常量，不再是 1/4 —— 见常量表那段）——
     且**只有该侧有相邻兄弟时**才让出去（见函数头那条规则）。
     没有邻兄弟的那一端不收缩 ⇒ 靠那一端也是"成为子"（"拖到尽头就挂到它下面"）。
     ⚠️ 上界保护：节点很小时 12px 会吃掉太大比例，最多让到该轴尺寸的 1/4。 */
  const sizeAlong = axis === 'x' ? r.w : r.h;
  const edge = Math.min(EDGE_PX, sizeAlong * 0.25) / Math.max(1, sizeAlong);
  if (before && t < edge) return { id: host, sibling: true };
  if (after && t > 1 - edge) return { id: host, sibling: true };
  return { id: host, sibling: false };
}

/**
 * 在候选里挑**唯一**的落点父节点（★ 第 80 轮重写；★ 第 92 轮加第 0 层）。
 *
 * 判据（**按顺序**）：
 *   **⓪（★ 第 92 轮 · 路线 A）锚点落在谁的矩形里 ⇒ 谁就是落点宿主**：
 *      中间带 ⇒ 成为它的子节点；两端 `EDGE_PX`（该侧有邻兄弟时）⇒ 与它同级，折算成**它的父节点**。
 *   ---- 以下三层只在"锚点没落在任何节点上"（缝隙／空白）时兜底 ----
 *   **锚点落在谁的「接管区」里，谁就是新父节点**。
 *   分**三层**取（`zoneMapOf` 给的 `core`／`box` ＋ `real`）：
 *     ① **真实精确区**（`real`：由真实子节点量出来的包围盒）：命中即候选。
 *     ② 叶子那格**猜出来的精确区**：只有在①一枚都没命中时才考虑。
 *     ③ 外扩区（"差了 `DROP_TOL` 以内也算"）：取**精确区离锚点最近**的那一枚。
 *     ④ 还是没有 ⇒ 返回 `null`，调用方兜底到**当前父节点**（"拖到空白处等于没动"）。
 *   命中多枚时一律取**精确区面积最小**的（最具体）；面积打平取层级更深的，再打平取更近的。
 *
 * ⚠️ **为什么①要压过②**（第 80 轮实测出来的）：叶子那格是"猜"出来的
 *    （把节点沿 zone 方向平移一个间距），它会**跨支压在别的节点头上**。
 *    鱼骨图里把 `n3a` 原地长按，锚点同时落在 `n0` 的真实区、`n3` 的真实区、
 *    以及隔壁支 `n1a1` 猜出来的那格里 —— 只按"面积最小"取就落到 `n1a1` 身上。
 *    真实区之间是严格互斥的（不同节点的孩子包围盒不重叠），所以**真实区优先**是稳的。
 *    （放宽在③：叶子那格外扩出来的那圈仍然算数，"贴着边放"还是能挂上去。）
 *
 * 为什么推倒重来（用户第 80 轮："鱼骨图长按节点移动时，上一级节点变化的没有逻辑"）：
 *   旧判据只要求"候选整个落在浮动节点的同一侧"，**完全不看远近**，再靠
 *   「反轴重叠 → 沿轴最紧挨 → 反轴最近 → 层级最深」四条依次掰。后果是把画布切成了一张
 *   **补丁图**：把同一个节点在鱼骨图上按 40px 网格扫一遍，父节点会在一行里从
 *   `n1`（祖父）跳到 `n1b`（叔）、跳回 `n1`、再跳到 `n2`（隔壁支的一级）；
 *   而"整棵树的上方很远处"会命中 `n2`。落点既不可预期、也不能用一句话说清。
 *
 * 新判据的性质（这才是"有逻辑"的判据该有的性质）：
 *   · **分区**：接管区按"每个节点的孩子实际在哪"划出来，
 *     锚点在画布上连续移动时，父节点只在分区边界处跳变。
 *   · **可解释**：一句话 —— "放到谁的孩子那一带，就算谁的"。想同级重排就把节点挪到
 *     兄弟所在的那一行／列（那一片属于**父节点**的接管区，因为兄弟都是它的孩子），
 *     `slotIndexOf` 再算插入位 ⇒ 父不变、位次变（用户第 68 轮口径）。
 *   · **不依赖格式**：接管区由 `zoneMapOf` 的 `axis/sign` ＋ 子节点包围盒现推，
 *     六种格式（含鱼骨图那种"孩子在下、还偏左"的怪形状）一套代码。
 *
 * ⚠️ 锚点 `at` **是手指（指针）位置**，不再是浮动矩形的左上角（★ 第 92 轮 · 路线 A）。
 *    三个参照库（simple-mind-map 的 `toPos(clientX, clientY)`、mind-elixir 的 `elementFromPoint`、
 *    dnd-kit 的指针策略）**锚点全是指针位置** —— 触控下这才是用户意图。
 *    ⇒ **`slotIndexOf` 必须收到同一个锚点**（第 92 轮起由 `findDrop` 统一发手指点）：
 *      两个锚点各算一份，就会出现"判成插在兄弟前面、实际却排到末尾"这种判据与落位错位的病。
 * ⚠️ `opt` 可选，给第 0 层（`hostOf`）用，缺省时第 0 层退化成"整枚节点都算成为子"：
 *    · `opt.parentOf(id)` → 该 id 的父 id（同级插入要折算成它）；
 *    · `opt.sibsOf(id)`   → 该 id **连同兄弟**的矩形数组（判"两端 `EDGE_PX` 该不该让给插前/插后"）。
 * ⚠️ `cands` 由调用方给，且**已经剔除拖拽自己和它的后代**（防环）。
 */
function pickParentId(L, cands, depthOf, zones, at, opt) {
  const ax = at.x, ay = at.y;
  const inBox = function (b) { return ax >= b.x && ax <= b.x + b.w && ay >= b.y && ay <= b.y + b.h; };
  /* 点到矩形的距离 —— ②那一级"谁离得近"用它（不用中心距：细长区域上中心距会骗人） */
  const distTo = function (b) {
    const dx = ax < b.x ? b.x - ax : (ax > b.x + b.w ? ax - (b.x + b.w) : 0);
    const dy = ay < b.y ? b.y - ay : (ay > b.y + b.h ? ay - (b.y + b.h) : 0);
    return Math.sqrt(dx * dx + dy * dy);
  };

  /* ★ 第 92 轮 · 路线 A **第 0 层**：锚点（手指点）落在谁的矩形里，谁就是落点宿主。
     —— 这是最贴近触控直觉的一层，也是唯一"不依赖朝向推导"的一层。
     没落在任何节点上（兄弟之间的缝隙／画布空白）才往下走那三层接管区兜底。 */
  const h = hostOf(L, cands, at, opt);
  if (h) {
    if (!h.sibling) return h.id;
    /* 同级 ⇒ 折算成**宿主的父节点**；宿主是根（没有父）时只能挂到它下面 */
    const par = (opt && opt.parentOf) ? opt.parentOf(h.id) : null;
    return par || h.id;
  }

  const hitReal = [], hitSlot = [], hitBox = [];
  (cands || []).forEach(function (id) {
    const z = zones[id];
    if (!z || !z.core || !L[id]) return;
    if (inBox(z.core)) (z.real ? hitReal : hitSlot).push(id);
    else if (inBox(z.box)) hitBox.push(id);
  });
  const pick = function (list, near) {
    let best = null, bestA = Infinity, bestD = -1, bestP = Infinity;
    list.forEach(function (id) {
      const z = zones[id];
      const a = z.core.w * z.core.h;                 // 比的是**精确区**的面积（外扩量不参与）
      const d = depthOf(id);
      const p = near ? distTo(z.core) : 0;
      if (a < bestA - 0.5 ||
          (Math.abs(a - bestA) <= 0.5 && (d > bestD || (d === bestD && p < bestP - 0.5)))) {
        bestA = a; bestD = d; bestP = p; best = id;
      }
    });
    return best;
  };
  /* 三层顺序：真实精确区 → 叶子猜出来的格 → 外扩区（取最近的精确区） */
  if (hitReal.length) return pick(hitReal, false);
  if (hitSlot.length) return pick(hitSlot, false);
  if (hitBox.length) return pick(hitBox, true);
  return null;
}

/**
 * 挂到 `parentKids`（该父节点的子节点 id 列表，**含被拖节点自己**）下排第几位。
 *
 * **排列轴** 由调用方给（`zones[parentId].slot`）—— 为什么不能自己转 90° 见 `zoneMapOf`：
 * 六种格式里只有逻辑图/组织图/思维导图是"正交轴"，树形图/时间轴/鱼骨图是同轴。
 *
 * ⚠️⚠️ 第 80 轮修：**显示顺序未必与树序同向**。
 *    `slotIndexOf` 一直是按"兄弟在排列轴上的坐标递增＝树序"推的，但**鱼骨图的下支是镜像的**
 *    （`layoutFishbone` 里下支的 `off` 取负、兄弟从下往上堆）⇒ 树序第 1 个在屏幕上反而**更靠下**。
 *    后果不是"排序略有偏差"，而是**原地长按也判成没回到原位**：
 *    `same` 算成 false ⇒ 松手时明明没动却会走一次 `moveNodeTo` 并弹「已调整顺序」。
 *    判据先实测这一批兄弟在排列轴上的坐标是升还是降（`asc`），再决定比 `>=` 还是 `<=`。
 *
 * ⚠️ 下标口径：**从列表里剔除被拖节点自己之后**的插入位 ——
 *    与 `store.moveNodeTo({ index })` 的约定一致（那边先摘掉自己再直接 splice，
 *    不做"原位置在前／在后"的补偿，两边必须同口径）。
 *    `same` 用同一口径判：插回自己原来占的那一位 ⇒ 位置其实没变，
 *    松手应当什么都不做、也不弹 toast。
 *
 * ⚠️ 锚点 `at` 是**手指（指针）位置**（★ 第 92 轮 · 路线 A），与 `pickParentId` 同一个锚点。
 *    旧版收的是"浮动节点的左上角"：那会让"节点越宽、手感越偏"，而且与
 *    `pickParentId` 的宿主判定对不齐 —— 判据与落位必须是同一个锚点，否则
 *    "看起来插在它前面、松手却排到末尾"。
 */
function slotIndexOf(parentKids, L, dragId, at, slotAxis) {
  const axis = slotAxis === 'x' ? 'x' : 'y';
  /* ⚠️ 比较用**字典序**（排列轴 → 另一轴），不能只看排列轴那一维：
     鱼骨图里上下两支的累加轴是分开的，`n1` 与 `n2` 的 `x` **完全相同**（都是主脊右起第一个基点），
     只看 x 根本分不出谁在前 ⇒ "原地长按"会被算成插到别人前面（`same=false`），
     松手就会莫名其妙地重排一次。用另一根轴破平局正好对上"上支在上、下支在下"的显示顺序。
     ⚠️⚠️ 第 92 轮：基准从**左上角**改成**中心** —— 这是本轮最关键的一处对齐。
        锚点现在是指针位置，而 `hostOf` 判"落在宿主的哪一端"用的是 `t = (p - top) / h`
        ⇒ **上半 ⇒ 插在它前面、下半 ⇒ 插在它后面**。若这里还拿左上角当界，
        指针压在宿主**上半部分**时会得出"已经越过它的顶边 ⇒ 排到它后面"，
        与 `hostOf` 的结论**正好相反** —— 那正是"判据与落位两套口径"的老病。
        （中心为界 ⇔ 上/下半 ⇔ 与 `hostOf` 同一句话。）
     ⚠️ 与 `zoneMapOf` 里 `monoOf` 的 `kOf` **基准不同是刻意的**：那边判的是**顺序**
        （整体平移不改变单调性，用哪个基准都一样），这边判的是**锚点落在谁前谁后**，
        必须以中心为界才能与 `hostOf` 同口径。 */
  const kOf = function (r) {
    /* ⚠️ 锚点 `at` 只有 `x/y`（没有 `w/h`）—— 直接算 `r.x + r.w / 2` 会得到 **`NaN`**，
       于是 `cmp` 的结果全是 `false`、`findIndex` 找不到、`idx` 一路掉到末位
       （第 92 轮实测：① 那 180 项全报 `same=false`，父节点却是对的 —— 症状很像
       "判断对了一半"，其实只是这一处的 `NaN`）。有尺寸才算中心，没有就按点用。 */
    const cx = (r.w === undefined) ? r.x : r.x + r.w / 2;
    const cy = (r.h === undefined) ? r.y : r.y + r.h / 2;
    return axis === 'y' ? [cy, cx] : [cx, cy];
  };
  const gk = kOf(at);
  const cmp = function (a, b) { return a[0] !== b[0] ? (a[0] - b[0]) : (a[1] - b[1]); };

  const kids = (parentKids || []).filter(function (id) { return !!L[id]; });
  const from = kids.findIndex(function (id) { return id === dragId; });   // 原位置（含自己）
  const order = kids.filter(function (id) { return id !== dragId; });     // 摘掉自己之后的列表

  /* 显示顺序是升还是降（见函数头那段"鱼骨图下支镜像"）——
     两维都相等（＝ 两个兄弟的矩形完全重合）不可能发生，所以字典序不会出现"分不出大小"。 */
  let asc = true;
  for (let i = 1; i < kids.length; i++) {
    if (cmp(kOf(L[kids[i]]), kOf(L[kids[i - 1]])) < -0.5) { asc = false; break; }
  }

  let idx = order.findIndex(function (id) {
    const c = cmp(kOf(L[id]), gk);
    return asc ? (c >= 0) : (c <= 0);
  });
  if (idx < 0) idx = order.length;
  return { index: idx, same: from >= 0 && idx === from };
}

/** 「落位标记」离兄弟节点边缘多远（画布坐标）—— 只用于首／末那一端，中间的缝取中点 */
const SLOT_GAP = 8;

/**
 * **落位标记**在画布坐标里的位置（★ 第 211 轮 · P0-3）——"松手后会排在第几位"。
 *
 * ⚠️ 它**不是**第 68 轮用户明确删掉的那条"同级插入竖线"：
 *    · 竖线表达的是**过程**："手指现在压在哪两个兄弟之间"；
 *    · 这枚标记表达的是**结果**："松手后确定排在第 k 位"，与"黄框＝确定的父"同一层级。
 *    所以它是一个**点**（圆点上带序号），不是一条贯穿的线 —— 不要再把线搬回来。
 *
 * 输入：
 *   · `kids`  候选父节点的孩子 id 列表（**含被拖节点自己**，与 `slotIndexOf` 同口径）；
 *   · `index` `slotIndexOf` 给的插入位（已剔除自己之后的下标）；
 *   · `axis`  排列轴（`zones[parentId].slot`）。
 * 输出：`{x, y}`（画布坐标）或 `null`（没有任何别的孩子 ⇒ 只有唯一位置，画了也没信息）。
 *
 * ⚠️ 显示顺序可能与树序相反（鱼骨图下支是镜像的，见 `slotIndexOf` 函数头）——
 *    这里必须和它用同一个 `asc` 判定，否则标记会画到"对称的另一端"。
 */
function slotMarkOf(L, kids, dragId, index, axis) {
  const ax = axis === 'x' ? 'x' : 'y';
  const all = (kids || []).filter(function (id) { return !!L[id]; });
  const list = all.filter(function (id) { return id !== dragId; });
  if (!list.length) return null;
  const kOf = function (r) { return ax === 'x' ? (r.x + r.w / 2) : (r.y + r.h / 2); };
  let asc = true;
  for (let i = 1; i < all.length; i++) {
    if (kOf(L[all[i]]) - kOf(L[all[i - 1]]) < -0.5) { asc = false; break; }
  }
  /* 视觉顺序（屏幕上前 → 后）与树序的换算：镜像支里"树序第 0 位"在最下方 */
  const vis = asc ? list.slice() : list.slice().reverse();
  const k = Math.max(0, Math.min(vis.length, asc ? index : (list.length - index)));
  const a = k > 0 ? L[vis[k - 1]] : null;
  const b = k < vis.length ? L[vis[k]] : null;
  if (a && b) {
    /* 中间：落在两颗兄弟之间的缝的正中，另一轴取两者中心的平均 */
    return {
      x: ax === 'x' ? ((a.x + a.w) + b.x) / 2 : ((a.x + a.w) / 2 + (b.x + b.w) / 2) / 2,
      y: ax === 'x' ? ((a.y + a.h) / 2 + (b.y + b.h) / 2) / 2 : ((a.y + a.h) + b.y) / 2
    };
  }
  const r = a || b;
  if (!r) return null;
  const before = !a;                       // 落在第一个之前
  return {
    x: ax === 'x'
      ? (before ? r.x - SLOT_GAP : r.x + r.w + SLOT_GAP)
      : (r.x + r.w / 2),
    y: ax === 'x'
      ? (r.y + r.h / 2)
      : (before ? r.y - SLOT_GAP : r.y + r.h + SLOT_GAP)
  };
}

/* ★ 覆盖率兜底的门槛 —— 候选节点被被拖节点盖住的面积占比。
   取 0.85 而不是 1：节点有 8px 圆角，视觉上"完全盖住"时，圆角那一点像素永远盖不满；
   取 1 会让"明明整个盖住了"判不出来。0.85 又足够高 —— 只擦到一个角（≤15%）不会误吸。 */
const COVER_MIN = 0.85;

/**
 * 拖拽的**判定点** —— ★ 第 212 轮：**被拖节点的左边缘中点**。
 *
 * 返回画布坐标下的 `{x, y}`（没有 `w/h`）。
 *
 * ── 这一格为什么会换三次口径 ────────────────────────────────────────────
 *   第 92 轮：判定点 ＝ **手指点**。⇒ 抓左边和抓右边能判成两个不同的父节点，用户说
 *            "不知道系统拿哪个位置在判"，作废。
 *   第 211 轮：改成 **节点中心**。逻辑最干净（点与节点永远重合），但真机露了两个毛病：
 *            ① **压字**：14px 的指示环压在节点正中，读作"字中间有个圈"；
 *            ② **自己盖自己**：节点比目标大时，点必然被自己的本体围在中间，
 *               用户看不见它落在目标的哪儿 —— 而"看得见"正是这一枚点存在的全部理由。
 *   第 212 轮（本版）：**左边缘垂直中点**。
 *            ① 圆心落在左边缘上 ⇒ 半径 5.5px 只伸进节点 5.5px，
 *               而节点内边距是 11px ⇒ **一个字都不压**；
 *            ② 一半在节点外 ⇒ 任何缩放下都看得见，且**指向明确**（拖到谁左边就是谁）；
 *            ③ 与腾讯文档同侧（它家思维导图一律向右生长，判定基点就是左中）。
 *
 * ── 这个点只管"找父"，不管"排第几" ───────────────────────────────────
 *   `pickParentId` 收它，`slotIndexOf` **不再收它**（收节点中心，见 `findDrop`）：
 *     找父 ＝"我的光标指着谁"（点在边缘，指得准）；
 *     排位 ＝"我这个整体落在这排的哪个位置"（必须对称，否则兄弟沿 x 排的格式
 *             ——组织结构图一级、鱼骨图主干——会带着半个节点宽的系统偏差）。
 *   第 92–211 轮"两处必须共用同一个锚点"那条约束，到此只对**找父**成立。
 *
 * ⚠️ 参数 `pr`（当前父节点矩形）**保留但不再参与计算** —— 它曾经决定"朝哪条边取中点"。
 *    判定点若跟着父节点方向换边，同一棵树左右两半的手感就互为镜像（用户第一次反馈
 *    "判断不清晰"就是这个）。保留签名是为了不动 `beginDrag` / 判据的调用点。
 * ⚠️ 左中是**恒定**的：`mindmap` 左支的父节点在右边，判定点照样在左边 —— 宁可"背对父节点"，
 *    也不要"每个分支一个方向"。用户能预期比几何最优更重要。
 */
function anchorOf(r, pr) {   // eslint-disable-line no-unused-vars
  if (!r) return null;
  return { x: r.x, y: r.y + r.h / 2 };
}

/**
 * **覆盖率兜底** —— 判定点没压到任何节点，但被拖节点**整个把某个节点盖住了**时，
 * 承认"你就是想挂到它上面"（★ 第 212 轮）。
 *
 * 为什么必须有它：判定点挪到左边缘之后，一个 176px 宽的节点盖住 92px 宽的目标时，
 * 判定点落在目标**左边 88px** 的空白处 —— `hostOf` 看不见目标，`pickParentId` 也判不到，
 * 结果"明明整个盖住了却不认"。而"大节点盖小节点"恰恰是用户抱怨的原始场景。
 *
 * 判据：`交集面积 / 候选面积 ≥ COVER_MIN`（被盖住的比例，不是 IoU —— 大盖小时 IoU 天然很小，
 * 用它会把"完全覆盖"判成"没盖住"）。命中多个时取**中心离得最近**的那个。
 *
 * ⚠️ 只在"主判定一个都没中"时调用（见 `findDrop`），**不参与主路径** ——
 *    这样 211 轮那套主规则一个字都不用动，风险锁在这条兜底里。
 * ⚠️ 它天然连续（按面积算，不是按点算），所以不会像单点判定那样"扫过节点时一路跳空"。
 */
function coverOf(L, cands, dr, minRatio) {
  if (!dr) return null;
  const lim = (typeof minRatio === 'number') ? minRatio : COVER_MIN;
  let best = null, bestD = Infinity;
  const cx = dr.x + dr.w / 2, cy = dr.y + dr.h / 2;
  (cands || []).forEach(function (id) {
    const r = L[id];
    if (!r) return;
    const iw = Math.min(dr.x + dr.w, r.x + r.w) - Math.max(dr.x, r.x);
    const ih = Math.min(dr.y + dr.h, r.y + r.h) - Math.max(dr.y, r.y);
    if (iw <= 0 || ih <= 0) return;
    if ((iw * ih) / Math.max(1, r.w * r.h) < lim) return;
    /* 比"中心离得近"——用平方距离，省一次开方（`dist2` 住在渲染段，这里在它前面） */
    const ex = cx - (r.x + r.w / 2), ey = cy - (r.y + r.h / 2);
    const d = ex * ex + ey * ey;
    if (d < bestD) { bestD = d; best = id; }
  });
  return best;
}

/* ★ 本轮：以上那两张「写死的列坐标表」整块撤掉了 ——
   现在每种格式自己算列（见下面的 layoutHoriz / layoutMindmap），
   所以「三列用设计稿坐标、四列压缩另一套」这种双轨制没有了。 */

/* 卡内上下两条浮带 —— 排版把内容夹在 [padT, 画布高 − padB] 里，免得节点压在浮条底下：
     · 上：脑图级工具栏（56 高 · 贴顶 16，见 .mm-top）⇒ 72，再留一段呼吸 ＝ 88（横）/ 82（竖）
     · 下：节点操作浮条（56 高 · 贴底 16，见 .mm-float-wrap）⇒ 72，
       再加上拖拽浮标会从节点往上飘 36 ＝ 108 */
const PAD = {
  land: { t: 88, b: 108, x: 40 },
  port: { t: 82, b: 108, x: 16 }
};

/* ==========================================================================
   节点尺寸（★ 第 67 轮：**按字数换行** ＋ 宽高随内容 —— 推翻 66 轮的"单行＋省略号"）

   66 轮走的是「一律单行、超出交给省略号」，方向不对：真机长文本被吃掉一半，
   而脑图里的字恰恰是最不能丢的。这一轮按参考版的口径重做：

     根               每行最多 10 个字
     一级             每行最多 20 个字     （★ 244 轮翻倍：原 10）
     二级及以下       每行最多 40 个字     （★ 244 轮翻倍：原 20）
     超出就换行；节点宽 ＝ 最长那一行、高 ＝ 行数 × 行高
     **文字必须全部显示**，不出现省略号

   「字」按**显示宽度**折算：1 个 CJK ＝ 1 em，半角按字面 0.5~0.6 em。
   于是 10 个汉字正好一行，而 `Scrm的本质` 这类中英混排能多塞两个半角 ——
   用户说的"10 个字"本来就是这个意思，不必再写一套半角计数。

   ⚠️ 折行只在 JS 里做**一次**，结果 `lines[]` 直接下发到 DOM（每行一个 <text>，
      wxss 给 white-space:nowrap）。让渲染层自己去折的话，它折的位置和 JS 估宽
      算出来的高度对不上，必然出现"字被切掉"或"底下空一大截"。
   ⚠️ NODE_PAD.x 要比 wxss 的 padding **大 1px**（13 / 12）：估宽是近似的，
      留一点余量兜住字体差异，宁可节点略宽一丢丢，也别让最后半个字掉出去。
   ⚠️ LH 必须与 wxss 里 `.mm-node-t` 的 line-height **逐档对齐**（那里写的是 px）。
   ========================================================================== */
const MM_FS = [17, 15, 14, 14, 14, 14];   // 根 / 一级 / 二级起（第 6 层沿用末档）
const LH = 1.4;                            // 行高系数

/* 每行最多几个「字」（全角宽）—— 根 10 ／ 一级 20 ／ 二级及以下 34
   ★★ 第 244 轮：一级与二级及以下**各翻一倍**（原 10 ／ 20）。用户口径：
      "很多节点信息都是语音转文本，文字有点多，目前的最大宽度不友好"。
      这轮**没有**新造一个 max-width 常量 —— 宽度天花板原本就是"每行字数 × 字号 ＋ 内边距"，
      翻倍只动这一行。根节点按用户口径**不动**（它是全图锚点，宽了会把两侧分支整体推散）。
   ★★ 第 275b 轮：二级及以下 **40 → 34**。用户口径（逐字）：「由于加载了图片显得节点有点宽，
      二级节点的宽度在稍微缩小一些，但是也要比一级节点大」。
      ⇒ 上限 586 → **502**（横屏口径 34×14＋26；竖屏 500），仍是一级（326）的 **1.54 倍**，
        "比一级大"这条守住了；而挂了图的宽节点不再是一块 560 宽的图板。
      ⚠️ 只动这一档，根 / 一级一个字不动 —— 用户点名的是"二级节点"，
        而且这两档一变，`fitViewOf` 的初视图会连带重排（244 轮的教训）。
   ⚠️ 副作用（必然、非 bug）：长文本节点真的变宽了 ⇒ `fitViewOf` 的初视图会比原来缩得更狠
      （竖屏 768 宽的画布上最明显）。这是"少折行"的代价，**别为初视图好看把上限收回去** ——
      用户要的是读得全，不是一屏塞下全图。 */
const WRAP_EM = [10, 20, 34, 34, 34, 34];

/* 节点内边距：x 比 wxss 的 padding 大 1px（估宽余量），y 决定单行时那点呼吸感 */
const NODE_PAD = { land: { x: 13, y: 10 }, port: { x: 12, y: 9 } };

/* 太短的文本（"是""否"）也要有个像样的方块，不瘦成一条 */
const NODE_MIN_W = [104, 92, 72, 72, 72, 72];

/* ==========================================================================
   ★★ 275 轮 · 节点挂图（用户口径：「脑图的节点增加挂载图片功能，每个节点只能挂载一张
   图片，脑图原点不能挂载图片」）

   ★★ 275b 轮改形态（用户 2026-10-26 第 2 条）：「节点中显示图片应该完整显示，相当于
   **宽度固定，高度按照图片自适应**」。
   ── 改前（275 初版）是「通栏横条 · 高固定 96 · `aspectFill` 顶部裁切」——
      人的头像、票据的半截边都被切掉了，用户不接受裁切。
   ── 现在：图块宽 ＝ 节点内容宽（这就是"宽度固定"那一根轴），**高按图片自身比例算**
      （`imageRatio` ＝ 宽/高，挂图时由 `wx.getImageInfo` 现读、存进树里）。
      `metricsOf` 算出来的 `imgH` 与渲染层行内 `height` 是**同一个数** ⇒ 图不会被裁、
      节点也不会"底下空一截"。
   ── 上下两条硬夹（看着像多余，其实是防"节点被一张图拉成一屏高"）：
      · `PIC_MAX_H = 200`：竖图（手机截图 ≈ 0.46 宽高比）按内容宽算能到 380 高。
        夹住之后**不是裁图**，而是把图块**宽度反算窄一点、居中**（见 `metricsOf`）——
        所以"完整显示"这条永远成立，只是竖图会比节点窄。
      · `PIC_MIN_H = 96`：超宽图（全景/长截图横放）不至于细成一条线。
   ⚠️ 比例缺失（胶囊转脑图过来的老数据没有 `imageRatio`）⇒ 走 `PIC_AR_DEF`（4:3）。
      此时图块比例与真图未必一致 ⇒ 渲染层用 `aspectFit`（**宁可留细边，绝不裁**）。
   ⚠️ 另两个数必须与渲染层**成对**：
      · `PIC_GAP` —— 文字与图之间那道缝，加进 `metricsOf` 的高度里；
      · `PIC_MIN_W` —— 有图的节点**最小宽**。不抬的话：`NODE_MIN_W` 最窄那档是 72，
        减掉两侧内边距只剩 50 宽 ⇒ 一张 50 宽的小图，什么都看不出来。
   ⚠️ 图片是**节点内容**、不是浮层：点它 ＝ 点节点（用户第 2 条「点击图片和点击节点一个效果」）
      ⇒ 它**不挂任何自己的事件**，也**没有**"看大图"角标（画布本身能放大）。
   ========================================================================== */
const PIC_MIN_H = 96;
const PIC_MAX_H = 200;
const PIC_GAP = 8;
const PIC_MIN_W = 176;
/* 没有比例信息时的兜底宽高比（4:3 横向）—— 与"胶囊转过来的图"那一档对应 */
const PIC_AR_DEF = 4 / 3;

/** 节点图上存的宽高比（宽/高）；越界或缺失一律回兜底 —— 坏数据不该让整张图排歪 */
function picArOf(node) {
  const v = Number(node && node.imageRatio);
  return (isFinite(v) && v >= 0.2 && v <= 5) ? v : PIC_AR_DEF;
}

/**
 * 图块几何（设计稿 px）：**宽撑满节点内容宽，高按比例**；高了就把宽度反算窄、居中。
 * @return {number} `{ w, h }`
 */
function picBoxOf(contentW, ar) {
  const cw = Math.max(1, Math.round(contentW));
  const w = Math.min(cw, Math.round(PIC_MAX_H * ar));
  const h = Math.max(PIC_MIN_H, Math.min(PIC_MAX_H, Math.round(w / ar)));
  return { w: w, h: h };
}

/* 兄弟子树之间留多少 —— 这是"不重合"的**唯一**旋钮，比写死行高可靠得多 */
const V_GAP = { land: 12, port: 10 };
const H_GAP = { land: 46, port: 30 };      // 横向族：层与层之间
const H_GAP_MM = { land: 40, port: 22 };   // 思维导图：两侧都要塞，列距收一点
const H_GAP_ORG = { land: 20, port: 14 };  // 组织结构图：同级方块之间
const ORG_V = { land: 52, port: 44 };      // 组织结构图：层与层之间（要容下折线条）
const TREE_IND = { land: 26, port: 20 };   // 树形图 / 时间轴：子节点相对父总线再右移多少
/* ---- 鱼骨图（★ 第 77 轮按参考图第二次重排，四条口径别单独往回改）----
   ⚠️ 73 轮那版把「一级的整棵子树」当成一块**贴在主脊上**，于是：
      一级节点散在块里、二级排在横向列上、骨线短得只有 190px。
      参考图（用户第 77 轮放大截图）根本不是这样，实测三条：
        ① 一级节点在骨线的**远端**，直接顶到上下两端；
        ② 二级**串在骨线上**（实测三个二级的左缘与骨线差 −5.8 / +6.2 / +8.7 px）；
        ③ 三级往下是**逻辑图**（右生长的多列树）。 */
const FISH_GAP_X   = { land: 40, port: 28 }; // 同侧相邻**骨线**之间让开多少
const FISH_HEAD    = { land: 44, port: 32 }; // 根右缘 → 第一根骨线的基点
const FISH_SPINE   = 34;                     // 主脊到最近内容（上支块底 / 下支块顶）的竖向让位
const FISH_STUB    = 22;                     // 骨线 → 二级近脊边 的水平短枝
/* ⚠️ 骨线斜率必须住在**常量段**（不能挪到 `boneLink` 上面去）：
   `工具/check_mindmap_layout.js` 的切片范围是「`const CANVAS =` 到那条『渲染』分隔注释」，
   放到连线段就出了切片范围 ⇒ 无头校验会直接 `FISH_SLOPE is not defined` 抛错
   （真机不报，因为同模块作用域仍在；但回归会红，而且红得莫名其妙）。
   ⚠️ 写这条注释时别把那两条切片标记原样抄进来 —— 里面的星号斜杠会**提前闭合本注释**。 */
const FISH_SLOPE   = 0.5;                    // 骨线水平跨度 ÷ 纵向距离（≈ 63° 的斜角）

function oOf(land) { return land ? 'land' : 'port'; }
function dOf(d, arr) { return Math.max(0, Math.min(d, arr.length - 1)); }
function fsOf(d) { return MM_FS[dOf(d, MM_FS)]; }

/**
 * 单个字符占几个 em。中文字体下的近似值 ——
 * 不用 measureText 是因为小程序里它只能**异步**拿（createSelectorQuery），
 * 而排版必须在一次同步计算里出全部坐标。
 *
 * ⚠️ 中点 `·`(U+00B7) 与圆点 `•`(U+2022) 必须按 **1 em** 算 ——
 *    它们的码点在西文区，看着像半角，但中文字体里渲染的是全角宽。
 *    按 0.42 估会少算约 8px，节点正好卡在"差一点放不下"上，
 *    于是满屏一级节点变成「B · …」（第 66 轮首次核验踩到的就是这个）。
 *
 * ⚠️ **拉丁字母必须按上限估，不能按"看着挺窄"估**（第 67 轮核验踩到的）：
 *    老值 A-Z 0.64 / a-z 0.52 是按平均字宽拍的，但 `M`≈0.83、`w`≈0.72、
 *    小写均值≈0.55 —— 一圈下来「…导出的 Markdown 层级永远正」这行估 278px、
 *    实渲 285px，**少算 7px**，正好把内边距吃掉 3px。
 *    估宽宁可略宽（节点宽一丢丢看不出来），也不能少算（少算就是"差一点放不下"）。
 *    ⇒ 现取 Inter/Helvetica 的**上沿**值。
 */
function emOf(ch) {
  const c = ch.charCodeAt(0);
  if (c >= 0x2E80) return 1;                       // CJK / 全角标点
  if (c === 0xB7 || c === 0x2022) return 1;        // · / •（中文字体里占全角）
  if (c === 32) return 0.30;                       // 空格
  if (c >= 48 && c <= 57) return 0.60;             // 0-9
  if (c >= 65 && c <= 90) return 0.74;             // A-Z
  if (c >= 97 && c <= 122) return 0.58;            // a-z
  return 0.55;                                     // 其余半角标点
}

function textEm(s) {
  s = String(s == null ? '' : s);
  let em = 0;
  for (let i = 0; i < s.length; i++) em += emOf(s[i]);
  return em;
}

/* 不能落在行首的标点（简易禁则）：宁可让它把上一行多撑一点点，
   也别让它孤零零起一行 —— 中文折行少了这一条，读起来会"毛"。 */
const NO_HEAD = '，。、；：？！）〉》」』】”’%·,.!?;:)]}>';

/**
 * 折行：按「每行最多 maxEm 个全角宽」贪心切；文本里已有的 `\n` 先当硬换行切开。
 * 返回行数组 —— 它同时是**渲染内容**和**算宽算高的依据**，两者同源才不会打架。
 */
function wrapText(text, maxEm) {
  const out = [];
  String(text == null ? '' : text).split('\n').forEach(function (raw) {
    if (!raw) { out.push(''); return; }
    let cur = '', em = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i], e = emOf(ch);
      if (cur && em + e > maxEm + 0.001 && NO_HEAD.indexOf(ch) < 0) {
        out.push(cur); cur = ''; em = 0;
      }
      cur += ch; em += e;
    }
    out.push(cur);
  });
  return out.length ? out : [''];
}

/**
 * 一个节点的度量：折行 → 行数定高、最长一行定宽；挂了图就再长高一块图。
 * **没有 wMax**：宽度天花板天然就是"每行字数上限 × 字号 ＋ 内边距"，
 * 所以永远不会出现"放不下 ⇒ 省略号"。
 *
 * ★★ 275／275b 轮：`node.imageUri` 非空 ⇒
 *   · 定宽：先由**图**反推一个"自然宽"（`picNatW`，见下面 276 那段），再与文字宽取大；
 *   · 再由**内容宽 ÷ 图片宽高比**定图块高（`picBoxOf`）
 *     —— 高 ＝ 行高×行数 ＋ 内边距 ＋ `imgH + PIC_GAP`；
 *   · 最小宽抬到 `PIC_MIN_W`（否则窄节点上的图是一条看不清的瘦条）；
 *   · ★ 276：再抬到 `picNatW + 两侧内距` —— 短文字的节点也被图撑开，
 *     图拿到的尺寸与长文字节点一致（用户口径：「只要图片，节点就被撑开」）。
 *   · `m.img` 原样带下去（**相对 uri**）—— 拼完整地址只在 `buildNodes` / `ghostPayload`
 *     这两处渲染出口做，排版层不许出现域名（排版是纯函数，判据也拿它当纯函数）。
 *   · `m.imgW` / `m.imgH` 一并算好下发：渲染层行内 `width/height` 用的就是这两个数，
 *     与这里的高度账**同源** ⇒ 差 1px 就是"图被裁一条"或"底下空一截"。
 *     ⚠️ 渲染层的 `<image>` 仍是 `aspectFit` —— 比例缺失（兜底 4:3）时宁可留细边，绝不裁。
 */
function metricsOf(node, land, d, level) {
  const lines = wrapText(node && node.text, WRAP_EM[dOf(level, WRAP_EM)]);
  const fs = fsOf(level);
  const pad = NODE_PAD[oOf(land)];
  let maxEm = 0;
  lines.forEach(function (l) { const e = textEm(l); if (e > maxEm) maxEm = e; });
  const lineH = Math.round(fs * LH);
  const img = node && node.imageUri ? String(node.imageUri) : '';
  const ar = picArOf(node);
  /* ★★ 276 轮（用户 2026-10-27）：「只要有图片，节点就被撑开到最大宽度，这样可以保证
     图片的显示」——原话是"撑到最大宽"，但**无条件撑到满行宽**（二级 502）在竖图上是灾难：
     手机截图 ar≈0.46 只能拿到 92 宽，502 宽的卡片里一条细线居中，两边各空 192。
     ⇒ 真正要保的不是"节点多宽"，而是"**图能拿到它该有的尺寸**"。所以按图反推节点宽：
       `picNatW = min(该档满行宽, PIC_MAX_H × 比例)` —— 图块的「自然宽」；
       节点宽至少 = `picNatW + 两侧内距`。
     · 满行宽是**上限**：再宽就要折行，图也不该比文字能占的地方还宽。
     · `PIC_MAX_H × 比例`：高不超上限反算出来的宽（275b 的夹值口径，同一根轴）。
     · 于是短文字的节点也会被图撑开，图拿到与长文字节点**完全一致**的尺寸；
       长文字的节点本来就比这宽 ⇒ 一个像素都不变。
     · 顺带消掉 275 的"空白带"：宽度既然按比例反算，`h = w / ar` 天然落在 [96, 200] 里，
       `PIC_MIN_H` 那道地板不再被触发（超宽图 5:1 以上才会碰到，那是真·全景）。 */
  const capW = Math.round(WRAP_EM[dOf(level, WRAP_EM)] * fs);
  const picNatW = img ? Math.min(capW, Math.round(PIC_MAX_H * ar)) : 0;
  let wMin = NODE_MIN_W[dOf(level, NODE_MIN_W)];
  if (img) wMin = Math.max(wMin, PIC_MIN_W, picNatW + pad.x * 2);
  const w = Math.max(wMin, Math.round(maxEm * fs) + pad.x * 2);
  /* ⚠️ 图块几何必须在 `w` 定下来之后算（它吃的是内容宽）—— 顺序反了就会拿上一版宽度
     去算高，症状是"文字少一个字的节点，图矮了 3px"。 */
  const pic = img ? picBoxOf(w - pad.x * 2, ar) : { w: 0, h: 0 };
  return {
    lines: lines,
    depth: level,
    lineH: lineH,
    img: img,
    imgW: pic.w,
    imgH: pic.h,
    w: w,
    h: lines.length * lineH + pad.y * 2 + (img ? pic.h + PIC_GAP : 0)
  };
}

/** 一次排版里所有节点的度量。wrapText 别反复调 —— 每次重排都全算一遍很浪费 */
function metricsMap(root, land) {
  const M = {};
  (function walk(n) {
    const lv = n.level || 0;
    M[n.id] = metricsOf(n, land, lv, lv);
    (n.children || []).forEach(walk);
  })(root);
  return M;
}

/**
 * 可见树 —— 把 `collapsed` 节点**下面那一窝**剪掉，返回一棵新树（★ 第 70 轮）。
 *
 * 为什么必须"先剪出来"、而不是在每处 walk 里各写一句 `if (n.collapsed) return`：
 *   排版（M／L）、连线、命中检测、拖拽落点**四处**问的是同一件事。各写一句的结果
 *   必然是"某处漏了" —— 症状是折叠节点的连线还画着、或者隐藏节点还能被点中/被当落点。
 *   收成一份之后这四处置身于**同一棵树**上，漏不掉。
 *
 * ⚠️ 返回的是**拷贝**（只复制到可见那一层），所以 `findNode(vt, id)` 拿到的是副本：
 *    只读用。要改内容一律走 `state.tree` 那条路（`setNodeCollapsed` / `updateNode` …）。
 * ⚠️ 折叠节点自己**留在树上** —— 它要画、要能被选中、要挂那枚"折叠了多少个"的圆形数字；
 *    被剪掉的是它的 `children`。
 */
function visibleTree(root) {
  if (!root) return null;
  const kids = root.collapsed ? [] : (root.children || []);
  return Object.assign({}, root, { children: kids.map(visibleTree) });
}

/** 这棵子树底下有几个叶子 —— 思维导图拿它决定"一级分支走左还是走右" */
function leafCount(node) {
  const ch = node.children || [];
  if (!ch.length) return 1;
  let s = 0;
  ch.forEach(function (c) { s += leafCount(c); });
  return s;
}

function padOf(land) { return PAD[oOf(land)]; }

function rectOf(id, x, y, w, h) {
  return {
    id: id, x: Math.round(x), y: Math.round(y), w: w, h: h,
    cx: Math.round(x + w / 2), cy: Math.round(y + h / 2)
  };
}

/** 把一批**相对坐标**的块整体落到画布上（cascade / treeCascade 的出口都走它） */
function placeAll(rows, out, ox, oy) {
  Object.keys(rows).forEach(function (id) {
    const r = rows[id];
    out[id] = rectOf(id, ox + r.x, oy + r.y, r.w, r.h);
  });
  return out;
}

/* ---------------- 自动排版 ---------------- */

/* ==========================================================================
   自动排版 · 六种格式（★ 第 67 轮：高度改成逐节点实际值，"不重合"由累加保证）

   66 轮的行高是**按层写死**的（每层一个 h）。节点改成一到三行之后那条立刻塌：
   同一层里三行节点和一行节点一样高，兄弟必然互相压。

   这一轮换口径 —— **每放完一棵子树，就把它的实际底边当作下一个兄弟的顶边**：

       子树顶 → 子树底 → ＋间距 → 下一个兄弟的顶 → …

   父节点回头落在自己那批子节点的纵向中心；万一父节点比子节点加起来还显眼
   （折行多、方框高），就把探出去的那截也算进包络里，必要时整支下推。
   于是"兄弟不重合"是**算出来的**，不是靠调行高调出来的。

   六种格式（★ 逐个对着参考图校准过形态与连线）：
     mindmap   思维导图   —— 根居中，一级分支按叶子数**对称分到左右两拨**，各自向外（贝塞尔）
     logic     逻辑图     —— 根在左、纵向居中，全部向右展开（贝塞尔）
     tree      树形图     —— 根在左上，**总线往下拉**、子节点逐层向右缩进（直角短枝）
     org       组织结构图 —— 根在顶部居中，一条横向总线挂下每一支，逐层向下（直角折线）
     timeline  时间轴     —— 根在顶部，一条**竖向主轴**往下，一级节点左右交替挂载
     fishbone  鱼骨图     —— 鱼头在左，一条横向主脊往右，一级节点上下交替斜插

   ⚠️ 节点允许摆到画布之外（树太宽 / 太深时）。这不是 bug：画布本来就能拖能缩，
      硬把二十几个节点压进一屏只会让每个节点小到读不出字。
   ========================================================================== */

/**
 * 横向级联（相对坐标）：node 摆在 x=0 / y=0，后代逐层向右，兄弟按**子树实际高**往下堆。
 *
 * `xOf(depth, w, pr)` 给出某一层节点的 x，`pr` ＝ **父节点的 `{x, w}`**（根为 `undefined`）。
 * ★ 第 96 轮起 `pr` 是必要输入：横向族分化为两派 ——
 *   ① **贴父列**（`parentFn`，逻辑图 ＋ 思维导图）：`x = 父右缘 ＋ 列距`，
 *      同一个父的孩子天然左边缘齐、不同父的各走各的（与 `treeCascade` 口径一致）；
 *   ② **层对齐列**（`colFn`，时间轴）：`x = 该支"每层最宽"累加` —— 时间轴的参考图
 *      就是"各支列不对齐、支内对齐"，故**保留旧口径不动**。
 *   镜像族（思维导图左支）自己把父的左缘取负方向。返回整块高度（node 顶边为 0）；
 *   全部相对坐标写进 rows。
 */
function cascade(node, depth, M, xOf, gapY, rows, pr) {
  const m = M[node.id], ch = node.children || [];
  /* ★ 第 96 轮：自己的 x 提前算一次（旧写法在叶子/非叶子两处各调一次 `xOf`）。
     提前算的另一个理由是**贴父列**（`parentFn`）要看父的 x —— 父的 x 与本节点无关，
     在孩子递归之前就已经确定，所以这里能安全地把它交给 `mine` 往下传。 */
  const mx = xOf(depth, m.w, pr);
  if (!ch.length) {
    rows[node.id] = { x: mx, y: 0, w: m.w, h: m.h };
    return m.h;
  }
  const mine = { x: mx, w: m.w };
  let cur = 0;
  ch.forEach(function (c) {
    const h = cascade(c, depth + 1, M, xOf, gapY, rows, mine);
    /* ★ 整支下移到当前游标 —— 少了这一步，所有兄弟子树都会原地叠在 y=0 上。
       （treeCascade 里有同一段 mv，两处必须成对存在。） */
    (function mv(n) {
      rows[n.id].y += cur;
      (n.children || []).forEach(mv);
    })(c);
    cur += h + gapY;
  });
  cur -= gapY;

  const first = rows[ch[0].id], last = rows[ch[ch.length - 1].id];
  let y = (first.y + first.h / 2 + last.y + last.h / 2) / 2 - m.h / 2;
  if (y < 0) {                       // 父比子还高 ⇒ 整支下推，父顶边归 0
    const dy = -y;
    (function lift(n) {
      (n.children || []).forEach(function (c) { rows[c.id].y += dy; lift(c); });
    })(node);
    cur += dy;
    y = 0;
  }
  rows[node.id] = { x: mx, y: Math.round(y), w: m.w, h: m.h };
  const lb = rows[ch[ch.length - 1].id];
  return Math.max(cur, lb.y + lb.h, y + m.h);
}

/**
 * 树形 / 时间轴族（相对坐标）：node 摆在 (0,0)，**总线**从它底边中心往下拉，
 * 每个子节点从总线上横向伸一枝出去、再往下堆。返回整块高度。
 *
 * `side` = +1 子节点在右，-1 在左（时间轴的左半侧、镜像分支都用它）。
 */
function treeCascade(node, depth, M, indX, gapY, side, rows) {
  const m = M[node.id], ch = node.children || [];
  rows[node.id] = { x: 0, y: 0, w: m.w, h: m.h };
  if (!ch.length) return m.h;
  const bus = m.w / 2;                    // 总线恒在节点横向中心（对齐参考图）
  let cur = m.h + gapY, bot = m.h;
  ch.forEach(function (c) {
    const cm = M[c.id];
    const cx = side > 0 ? bus + indX : bus - indX - cm.w;
    const h = treeCascade(c, depth + 1, M, indX, gapY, side, rows);
    (function mv(n) {
      rows[n.id].x += cx;
      rows[n.id].y += cur;
      (n.children || []).forEach(mv);
    })(c);
    cur += h + gapY;
    bot = cur - gapY;
  });
  return bot;
}

/** 某棵子树自己的"列坐标"（每层最宽 ＋ 列距累加）——depth0 那一层为 0 */
function colFn(node, depth0, M, gapX) {
  const cw = [];
  (function walk(n, d) {
    const i = d - depth0;
    cw[i] = Math.max(cw[i] || 0, M[n.id].w);
    (n.children || []).forEach(function (c) { walk(c, d + 1); });
  })(node, depth0);
  const colX = [0];
  for (let i = 1; i < cw.length; i++) colX[i] = colX[i - 1] + cw[i - 1] + gapX;
  return function (d) {
    return colX[Math.max(0, Math.min(d - depth0, colX.length - 1))];
  };
}

/**
 * ★ 第 96 轮 · **贴父列**：每个节点从**自己父节点的右边缘 ＋ 列距**起算。
 *
 * 取代逻辑图原先的 `colFn`（＝"该层最宽的节点"决定整层列坐标）。旧口径下同层左边缘
 * 被强行拉到一条竖线上：同一层的父节点**宽窄不一样**时，窄的那支会被推到最宽者的右边
 * ⇒ 父子之间拖出一条长连线，整幅图读着"僵硬"（用户第 96 轮的原话）。
 * 贴父之后**同一个父的孩子仍然左边缘齐**（天然成立），不同父的各走各的 ——
 * 这跟 `treeCascade`（树形图 / 组织结构图）本来就是同一句话，六种格式里只剩时间轴
 * 还在用 `colFn`（它的参考图本就是"支内对齐、支间不对齐"）。
 *
 * ⚠️ 深度越大，各支的起跑差会**累积**（每层都加一次"父宽之差"）—— 这是贴父的固有代价，
 *    换来的是"父子紧贴、连线短"。若哪天觉得深了太散，再谈要不要按层收敛。
 */
function parentFn(gapX) {
  return function (d, w, pr) {
    return pr ? (pr.x + pr.w + gapX) : 0;
  };
}

/**
 * 逻辑图：根在左、纵向居中，全部向右展开（★ 第 96 轮：列坐标改**贴父**）
 *
 * `colFn` → `parentFn` 换掉的只是"同层左边缘要不要强行对齐"这一条：
 * 旧口径按该层**最宽**的节点取列，于是同一层里父节点宽窄不同时，窄的那支被推到
 * 最宽者的右边、父子之间拖出长连线（用户第 96 轮反馈的"僵硬"）。
 * **纵向（y）与连线样式一处未动。**
 */
function layoutLogic(root, land, M) {
  const cv = land ? CANVAS.land : CANVAS.port;
  const p = padOf(land), s = oOf(land);
  const rows = {};
  const h = cascade(root, 0, M, parentFn(H_GAP[s]), V_GAP[s], rows);
  const avail = Math.max(60, cv.h - p.t - p.b);
  return placeAll(rows, {}, p.x, p.t + Math.max(0, (avail - h) / 2));
}

/** 树形图：根在左上，总线往下拉、子节点逐层向右缩进 */
function layoutTree(root, land, M) {
  const p = padOf(land), s = oOf(land);
  const rows = {};
  treeCascade(root, 0, M, TREE_IND[s], V_GAP[s], 1, rows);
  return placeAll(rows, {}, p.x, p.t);
}

/**
 * 组织结构图（★ 第 80 轮重排）：**根在顶部居中 → 一级节点横向排开（横向总线挂下来）
 * → 一级往下一律走树形图的级联**（每个一级节点自己起一棵 `treeCascade`：
 * 总线从它底边中点往下、后代逐层右缩进）。
 *
 * 为什么一级往下要改：旧写法是"每一层占一行、同级方块并排"，
 * 于是 6 个三级节点平铺在**同一行**上 ⇒ 整幅宽 3141px，每条文字都被拉到读不成句。
 * 用户第 80 轮的口径是"一级节点以后的节点连接样式应该是类似于树形图的模式，
 * 这样文字就不会在横向过分展开了" —— 同一支的节点**竖着堆**，
 * 宽度只跟「深度 × 缩进」有关，与"这一层有几个节点"无关。
 *
 * ⚠️ 排版与连线必须**成对**改：连线那边 `linkPath` 对 `fmt === 'org'` 也是
 *    「根→一级走 `elbowTB`、一级往下走 `treeLink`」。只改一边会出现
 *    "节点已经缩进到右下，线却从正上方兜下来"。
 * ⚠️ 一级节点在**自己那一块里横向居中**（不是贴左缘）—— `treeCascade` 的总线挂在
 *    节点自己的中轴上，贴左缘会让总线跟着偏到块的左边，整支看着像被"斜着拽"。
 */
function layoutOrg(root, land, M) {
  const cv = land ? CANVAS.land : CANVAS.port;
  const p = padOf(land), s = oOf(land);
  const rm = M[root.id];
  const kids = (root.children || []).filter(function (k) { return !!M[k.id]; });
  const gapX = H_GAP_ORG[s], gapY = ORG_V[s], indX = TREE_IND[s];

  /* ---- ① 每个一级节点自己量一块（相对坐标 ＋ 块宽）---- */
  const blocks = kids.map(function (k) {
    const rows = {};
    const h = treeCascade(k, 1, M, indX, V_GAP[s], 1, rows);
    let w = M[k.id].w;
    Object.keys(rows).forEach(function (id) {
      if (rows[id].x + rows[id].w > w) w = rows[id].x + rows[id].w;
    });
    return { k: k, rows: rows, w: w, h: h };
  });

  /* ---- ② 沿横向累加摆块（块与块之间只留 `H_GAP_ORG`）----
     ★★ 275 轮修（本轮挂图顶出来的**既有缺陷**）：
     `treeCascade` 的相对坐标原点在**父的左缘**，而下面放置时一级节点要在这个块里**居中**
     —— 于是它的**子节点整体右移**了 `over = (块宽 − 父宽)/2`（左半边那圈留白）。
     旧式按 `块宽` 直接累加 ⇒ 这块的节点会**溢出块右缘** `over` 那么多，
     去压右邻块那个一级节点。无图时同层高度差只有几像素、`over` 是零头，看不出来；
     一挂图，同层高差上百 ⇒ 矮分支的子节点整块压上去（竖屏 + 组织结构图实测 5～11px）。

     ⇒ 修法是**把 `over` 让进块间距**（不是把块撑宽）：下一块从"本块最右**可能**到达的位置"
        再让一个 `H_GAP_ORG` 开始。这样 ① 块宽、`kx` 的居中、`H_GAP_ORG` 三个数**一个都没动**，
        图只变宽 Σover（本工程的样例图 2267 → 约 2400，6%），而"父居中于子树"的形态照旧。
     ⚠️ 别改成 `块宽 = 2·right − own`（那是"父居中的合法块宽"）：样例图会从 2267 涨到 3254
        —— 每块左右两侧对称留白，整张图松得像散架（试过，一眼就不对）。 */
  const overOf = function (b) { return Math.max(0, (b.w - M[b.k.id].w) / 2); };
  let cur = 0;
  blocks.forEach(function (b) { b.ox = cur; cur += b.w + gapX + overOf(b); });
  /* `cur` 里最后那一段是 `gapX ＋ over`：`gapX` 不属于任何一块，`over` 属于（最右可能到达处） */
  const total = Math.max(blocks.length ? (cur - gapX) : rm.w, rm.w);
  let deepH = 0;
  blocks.forEach(function (b) { if (b.h > deepH) deepH = b.h; });
  const blockH = rm.h + gapY + deepH;

  const availH = Math.max(60, cv.h - p.t - p.b);
  const oy = p.t + Math.max(0, (availH - blockH) / 2);
  const availW = Math.max(120, cv.w - p.x * 2);
  const ox = p.x + Math.max(0, (availW - total) / 2);

  const out = {};
  /* 根：居中于**整块内容**（不是画布）—— "根落在自己那些子孙中间"，与旧口径一致 */
  out[root.id] = rectOf(root.id, ox + (total - rm.w) / 2, oy, rm.w, rm.h);

  blocks.forEach(function (b) {
    const kx = ox + b.ox + (b.w - M[b.k.id].w) / 2;   // 一级节点在自己那块里居中
    const ky = oy + rm.h + gapY;
    out[b.k.id] = rectOf(b.k.id, kx, ky, M[b.k.id].w, M[b.k.id].h);
    Object.keys(b.rows).forEach(function (id) {
      if (id === b.k.id) return;                      // 一级节点自己已经放过（居中版）
      const r = b.rows[id];
      out[id] = rectOf(id, kx + r.x, ky + r.y, r.w, r.h);
    });
  });
  return out;
}

/** 时间轴：根在顶部，竖向主轴往下，一级节点左右交替挂载 */
function layoutTimeline(root, land, M) {
  const cv = land ? CANVAS.land : CANVAS.port;
  const p = padOf(land), s = oOf(land);
  const out = {};
  const rm = M[root.id], kids = root.children || [];
  const rootX = Math.round(cv.w / 2 - rm.w / 2);
  out[root.id] = rectOf(root.id, rootX, p.t, rm.w, rm.h);
  if (!kids.length) return out;

  const busX = rootX + rm.w / 2;               // 主轴：从根的中心往下
  const indX = TREE_IND[s], gapY = V_GAP[s];
  const blkGap = land ? 36 : 28;
  let cur = p.t + rm.h + (land ? 34 : 26);
  kids.forEach(function (k, i) {
    const side = (i % 2 === 0) ? 1 : -1;       // 左右交替
    const km = M[k.id];
    const rows = {};
    const bh = treeCascade(k, 1, M, indX, gapY, side, rows);
    const offX = side > 0 ? busX + indX : busX - indX - km.w;
    Object.keys(rows).forEach(function (id) {
      const r = rows[id];
      out[id] = rectOf(id, offX + r.x, cur + r.y, r.w, r.h);
    });
    cur += bh + blkGap;
  });
  return out;
}

/**
 * 鱼骨图（★ 第 77 轮按参考图**第二次**重排）：鱼头在左，主脊向右贯穿；
 * **每根骨 ＝ 一条从主脊斜拉到一级节点的直线** —— 一级落在骨线**远端**
 * （上支顶到上沿、下支顶到下沿），二级**沿骨线串**，三级往下回归**逻辑图**。
 *
 * 三条口径（照用户第 77 轮的放大截图逐条实测校准，别单独往回改）：
 *
 *   ① **一级一律在骨线远端＋全体共用一条远端线** —— 用户原话「一级标题是直接到上下两端的顶部的」。
 *      ⇒ 上支全体 `y = 远端线上沿`、下支全体 `y + h = 远端线下沿`。
 *      ⚠️ 第 77 轮第一版这里错了两次，都靠 `工具/render_fishbone.py --verify` 抓出来：
 *         ① 叶子一级（没有二级可串）当时被"贴主脊放"，与带子树的一级不在一条线上；
 *         ② 下支的二级子树当时**朝下**堆 ⇒ 堆到了比一级更低处，而骨线是从主脊
 *            向下拉到一级 ⇒ 二级根本不在骨线经过的地方。正解是**下支镜像向上堆**。
 *      ⚠️ 第 78 轮补：这两条"远端线"是**内容的上／下沿（自量高）**，不是画布上下沿 ——
 *         见 ② 那一大段。拿画布高当容器会让大树的主脊跑到画布外、下支骨线方向翻转。
 *
 *   ② **二级串在骨线上** —— 「二级全部都是在一级和原点的直线连线上分布」。
 *      骨线是直线 ⇒ `ribX(y) ＝ 一级.cx − |y − 一级近脊边| × FISH_SLOPE`，
 *      二级左边 ＝ `ribX(cy) ＋ FISH_STUB`。实测参考图三个二级的左缘与骨线
 *      只差 −5.8 / ＋6.2 / ＋8.7 px。
 *      ⚠️ 这条公式在 `boneLink` / `ribStub` 里**各重算一次**，改斜率必须三处同时改。
 *
 *   ③ **三级往下 ＝ 逻辑图** —— 每个二级自己起一棵 `cascade` 多列树；列坐标由
 *      `colFn` **按各自子树单独算**，所以不同二级的列不对齐（参考图就是这样）。
 *
 * ⚠️ **主脊位置 ＝ `内容上沿 ＋ 上支深度 ＋ FISH_SPINE`**（不是画布中心、也不是中点）。
 *    参考图实测：上支骨长 999px、下支 43px ⇒ 主脊落在 **89% 高**处。这条"跟着上支走"
 *    的规律同时解释了两件事：小树主脊近中线、大树主脊被顶到下方，且**永远不越界**。
 * ⚠️ 上支 / 下支**各占一条横向累加轴**：两支分居主脊两侧，
 *    横向重合也不会打架；共用一条轴只会让图宽凭空翻倍。
 */
function layoutFishbone(root, land, M) {
  /* ⚠️ 这里**故意不取 `CANVAS`** —— 鱼骨图是自量高的（见 ②），画布尺寸只影响左右留白。 */
  const p = padOf(land), s = oOf(land);
  const out = {};
  const rm = M[root.id], kids = root.children || [];
  const V = V_GAP[s], HG = H_GAP[s];

  /* ---- ① 每支量深度：偏移以**一级顶边**为原点（正 ＝ 往下）。
     上支一级在块顶、子树往下堆；下支一级在块**底**、子树**往上**堆（镜像）
     —— 关键就在这个负号：骨线是从主脊向下拉到一级的，二级必须落在
     一级与主脊**之间**才可能"串在骨线上"。 */
  const B = kids.map(function (k, i) {
    const up = (i % 2 === 0);
    const km = M[k.id];
    const items = [];
    (k.children || []).forEach(function (j) {
      const sub = {};
      const H = cascade(j, 1, M, colFn(j, 1, M, HG), V, sub);
      let W = 0;
      Object.keys(sub).forEach(function (id) { W = Math.max(W, sub[id].x + sub[id].w); });
      items.push({ j: j, jm: M[j.id], sub: sub, H: H, W: W, jy: sub[j.id].y, off: 0 });
    });
    let cur = 0;
    items.forEach(function (it) {
      it.off = up ? (km.h + V + cur) : -(V + cur + it.H);
      cur += it.H + V;
    });
    /* 块相对一级顶边的范围 [hi, lo]（lo ＝ 最深那条边） */
    let hi = 0, lo = km.h;
    items.forEach(function (it) {
      if (it.off < hi) hi = it.off;
      if (it.off + it.H > lo) lo = it.off + it.H;
    });
    return { k: k, up: up, km: km, items: items, hi: hi, lo: lo, h: lo - hi };
  });

  /* ---- ② 主脊 ＝ 「上支铺到底」的位置 —— **自量高，画布高度不参与** ----
     ⚠️ 第 78 轮**第二次**改（两次旧写法见 git）。判据来自参考图的定量勘定：
        参考图 1473×1212 里，主脊是**水平线**、落在 y=1077（＝ **89% 高**），
        根（左端那颗）就在主脊上；一条长骨从主脊 (320,1077) 斜拉到顶部一级 (820,78)
        —— 斜率 496/996 = **0.498**（＝ `FISH_SLOPE` 0.5）。**上支骨长 999px、下支只 43px**。
     ⇒ 规律不是"主脊居中"，而是**主脊跟着上支的深度走**：
        · 上支一级的**顶边** ＝ 整幅内容的上沿；
        · 主脊 ＝ 上支铺到最深那条边，再让 `FISH_SPINE`；
        · 下支一级的**底边** ＝ 主脊再往下让 `dnD + FISH_SPINE` ⇒ 即内容下沿。
        上支越深主脊越靠下（参考图 89%）；两支一样深时主脊自然回到中线。
     ⚠️ 上一版把远端线钉死在 `p.t` / `cv.h − p.b`、主脊取中线 ⇒ 大树直接崩：
        主脊被算到画布外（`ref` 树 952 而画布只 722），**下支的骨线方向整个翻转**。
        ⇒ 鱼骨图**绝不能用画布高当容器**，装不下要交给 `fitViewOf` 去缩，不能让布局自己挤。
        ⚠️ 用户口径「一级标题直接到上下两端的顶部」＝ 在**内容坐标系**里成立
        （`fitViewOf` 缩放后正好落在视口上下沿），不是"离画布上沿 0px"。 */
  const deepen = function (u) {
    let m = 0;
    B.forEach(function (b) { if (b.up === u && b.h > m) m = b.h; });
    return m;
  };
  const upD = deepen(true), dnD = deepen(false);
  const topLine = p.t;                                   // 内容上沿 ＝ 上支一级顶边
  const spineY = Math.round(topLine + upD + FISH_SPINE); // 上支铺到底 ⇒ 主脊
  const dnFar = Math.round(spineY + dnD + FISH_SPINE);   // 内容下沿 ＝ 下支一级底边
  out[root.id] = rectOf(root.id, p.x, spineY - rm.h / 2, rm.w, rm.h);
  if (!kids.length) return out;

  /* ---- ③ 落位：骨线基点沿主脊累加（上/下两条轴各走各的） ---- */
  const gapX = FISH_GAP_X[s], SLOPE = FISH_SLOPE, STUB = FISH_STUB;
  const x0 = p.x + rm.w + FISH_HEAD[s];
  const cur = [x0, x0];

  B.forEach(function (b) {
    const km = b.km, bi = b.up ? 0 : 1;
    const base = cur[bi];
    /* 一级顶边：上支顶边贴内容上沿；下支让**底边**贴内容下沿 */
    const top = b.up ? topLine : (dnFar - km.h);
    const eb = b.up ? (top + km.h) : top;            // 一级的**近脊边** y
    const run = Math.abs(spineY - eb) * SLOPE;       // 骨线的水平跨度
    /* 一级左边：让骨线基点落在 base；但别把节点推到上一支身上 */
    const kx = Math.max(base, Math.round(base + run - km.w / 2));
    const kcx = kx + Math.round(km.w / 2);
    out[b.k.id] = rectOf(b.k.id, kx, Math.round(top), km.w, km.h);

    let right = kx + km.w;
    b.items.forEach(function (it) {
      const gy = top + it.off;                         // 该二级块的顶边
      const cy = gy + it.jy + it.jm.h / 2;             // 二级节点的纵向中心
      const ribX = kcx - Math.abs(cy - eb) * SLOPE;    // 骨线在该 y 处的 x
      const gx = Math.round(ribX + STUB);
      Object.keys(it.sub).forEach(function (id) {
        const r = it.sub[id];
        out[id] = rectOf(id, gx + r.x, Math.round(gy + r.y), r.w, r.h);
      });
      if (gx + it.W > right) right = gx + it.W;
    });
    cur[bi] = right + gapX;
  });
  return out;
}

/** 思维导图：根居中，一级分支按叶子数对称分到左右两拨，各自向外展开 */
function layoutMindmap(root, land, M) {
  const cv = land ? CANVAS.land : CANVAS.port;
  const p = padOf(land), s = oOf(land);
  const out = {};
  const rm = M[root.id], kids = root.children || [];
  if (!kids.length) {
    out[root.id] = rectOf(root.id, cv.w / 2 - rm.w / 2, cv.h / 2 - rm.h / 2, rm.w, rm.h);
    return out;
  }

  /* 两拨怎么分：谁那支叶子少就往谁那边放 —— 比"对半切"稳得多。
     对半切会把一整棵大树全塞到一侧，另一侧空一片、这一侧挤成疙瘩。 */
  const items = kids.map(function (k, i) { return { k: k, i: i, n: leafCount(k) }; });
  const bySize = items.slice().sort(function (a, b) { return b.n - a.n; });
  const left = [], right = [];
  let wl = 0, wr = 0;
  bySize.forEach(function (o) {
    if (wr <= wl) { right.push(o); wr += o.n; } else { left.push(o); wl += o.n; }
  });
  const byIdx = function (a, b) { return a.i - b.i; };
  left.sort(byIdx); right.sort(byIdx);

  /* ★ 第 96 轮 · **贴父**：每个节点从**自己父节点的边缘**起算，同层不再共用一条列线。
     （旧口径是两侧共用一份"每层最宽"的列坐标 ⇒ 同层左边缘被拉到一条竖线上。）
     与逻辑图同轮换口径，理由同 `parentFn` 的函数头。 */
  const gap = H_GAP_MM[s];
  const xR = function (d, w, pr) { return pr ? (pr.x + pr.w + gap) : 0; };
  /* ⚠️ 左支的镜像轴是**根节点自己的中轴** —— 贴父后这一点**自动成立**（`pr` 一路传下来）。
     旧写法 `-colX[d] - w` 是从"根左缘"往外量：`colX[1] = 根宽 + gap`，于是左边第一列
     离根的间隙是 `根宽 + gap`（实测 196 ＋ 40 ＝ **236**），而右边只有 `gap`（**40**）——
     用户第 80 轮反馈的"左右两边与一级节点的连线长度和线样式都不一样"就是这一条：
     贝塞尔一端横跨 236px、另一端 40px，一条像长 S、一条几乎直线。
     贴父后：右支 `根右缘 ＋ gap`、左支 `根左缘 − gap` ⇒ **两侧间隙严格相等**。 */
  const xL = function (d, w, pr) { return pr ? (pr.x - gap - w) : -w; };

  /* ⚠️ 一级节点的 `pr` 必须是**根**：`build` 是逐支独立的坐标系，根在 x=0。 */
  const rootPr = { x: 0, w: rm.w };

  const build = function (list, xOf) {
    const rows = {};
    let cur = 0;
    list.forEach(function (o) {
      const sub = {};
      const bh = cascade(o.k, 1, M, xOf, V_GAP[s], sub, rootPr);
      Object.keys(sub).forEach(function (id) {
        rows[id] = { x: sub[id].x, y: sub[id].y + cur, w: sub[id].w, h: sub[id].h };
      });
      cur += bh + V_GAP[s];
    });
    return { rows: rows, h: Math.max(0, cur - V_GAP[s]) };
  };
  const R = build(right, xR), L = build(left, xL);

  const H = Math.max(R.h, L.h, rm.h);
  const avail = Math.max(60, cv.h - p.t - p.b);
  const midY = p.t + Math.max(0, (avail - H) / 2) + H / 2;
  const rootX = Math.round(cv.w / 2 - rm.w / 2);
  out[root.id] = rectOf(root.id, rootX, midY - rm.h / 2, rm.w, rm.h);
  placeAll(R.rows, out, rootX, midY - R.h / 2);
  placeAll(L.rows, out, rootX, midY - L.h / 2);
  return out;
}

/** 格式 → 排版函数（加一种格式 ＝ 上面加一个 layoutXxx ＋ 这里加一行） */
function layoutOf(root, landscape, format, M) {
  if (!root) return {};
  const MM = M || metricsMap(root, landscape);
  switch (format) {
    case 'org': return layoutOrg(root, landscape, MM);
    case 'tree': return layoutTree(root, landscape, MM);
    case 'timeline': return layoutTimeline(root, landscape, MM);
    case 'fishbone': return layoutFishbone(root, landscape, MM);
    case 'logic': return layoutLogic(root, landscape, MM);
    case 'mindmap':
    default: return layoutMindmap(root, landscape, MM);
  }
}


/* ---------------- 渲染 ---------------- */

/* ---------------- 折叠徽标（★ 第 70 轮 / 第 252 轮统一口径） ----------------
   节点被「收起」之后，它那一侧挂一枚**圆形数字**，数字 ＝ 这一支藏着多少个后代。

   ★★ 第 252 轮 · 用户口径（逐字）：
      「这个节点展开时，它和子节点的连线从哪里出发，收起时就应该显示在哪里。」
   ⇒ 挂侧**不再**是「我站在父节点的哪一边」（第 70 轮的老口径 `foldZoneOf`），
      而是**这个节点的出边**（它到自己子节点的那一跳）从哪条边出发。
      老口径在"同向展开"的格式里多数时候碰巧一致，但漏掉两种情况 ——
      而这两种正好就是用户说的"乱"：

        ① 它拿 `|dx|` 与 `|dy|` **比大小选轴**。可父子之间的**竖向**偏移通常远大于
           横向层距（节点高 38～44、V_GAP 10～12 ⇒ dy ≈ 45，而 H_GAP_MM 竖屏只有 22）
           ⇒ 思维导图**深处**的节点被判成"子节点在下方"，徽标挂到底边中点、
             压在下方兄弟身上。用户看到的「有时在节点**下方**」就是这一条。
        ② 组织结构图的**一级节点横向排开**（同 y、H_GAP_ORG 只有 14～20）⇒ dy = 0
           ⇒ 判成左右 ⇒ 徽标挂到侧面，而它们的连线明明是**从底边中点**垂下去的。
           用户看到的「有时在节点**左右两侧**」就是这一条。

   ⇒ 现在按**格式**定轴、按**当前这一刻的坐标**定左右/上下（见 `foldSideOf`）：
        mindmap   根 → 右；其余看"我在根的中轴哪一侧"（＝ `cascade` 的 xL / xR 那一侧）
        logic     一律**右**（`parentFn` 全部向右长）
        tree      一律**下**（`treeLink` 起点 ＝ 父**底边中点**）
        org       一律**下**（根→一级 `elbowTB`、一级往下 `treeLink`，起点都是底边中点）
        timeline  一律**下**（同上）
        fishbone  根 → 右（主脊从根右缘出去）；一级 → **朝主脊**（上支就下、下支就上）；
                  二级起 → 右（三级由 `cascade` 向右展开）
   ⚠️ 徽标**不参与排版占位** —— 它落在族间空隙里，不写进 L。
      写进去会让"零重合"断言把它算成一个节点，也会让拖拽把它当落点。
   ⚠️ 它也只是**指示**，不可点（收起/展开都有专门的按键）—— 故 pointer-events: none。 */
const FOLD_D = 20;      // 圆形徽标直径（与 .mm-fold 的宽高成对；252 轮由 22 收到 20，见下）
const FOLD_GAP = 6;     // 左右族：与节点侧边的间隙（那一侧是空的，放心外推）
/* ★ 252 轮：**上下族反过来"吃进"节点 2px**。
   竖族的兄弟间距只有 V_GAP 10/12，徽标往外推 6 就会压住下一个兄弟；
   收小到 20 ＋ 吃进 2 ⇒ 圆只露 8（竖屏留 2、横屏留 4），而吃进去的 12px 全落在
   内边距（9～10）与行框底部那 ~3px 空白里 ⇒ **碰不到文字**。
   ⚠️ 尺寸从 22 收到 20 就是为这条让路：22 的时候外露 9、竖屏只剩 1px，
      真机上两枚圆和方块看着"粘在一起"（出图 `.tmp-verify/fold252-*-port.png` 可见）。 */
const FOLD_KISS = 2;

/**
 * 每个**有子节点**的节点，它的**出边**落在哪条边 —— 折叠徽标的挂侧（★ 第 252 轮）。
 *
 * 这就是用户那句口径的代码化：「展开时它和子节点的连线从哪出发，收起时就挂哪」。
 * 判据分两段：**按格式定轴**（这一族是横长还是竖长），**按坐标定方向**。
 *
 * ⚠️⚠️ 为什么不看子节点坐标：折叠节点在**可见树**里 `children` 已被剪空，
 *    根本没有子节点可量 —— 第 70 轮因此退化成"我站在父的哪一边"，于是踩了两个坑，
 *    详见上面 `FOLD_D` 那段注释开头的 ①②。
 * ⚠️⚠️ 为什么右侧/上下要按**当前坐标**现算、不能按"展开时的样子"记：
 *    `layoutMindmap` 的左右分拨是按**可见树**的 `leafCount` 分的 —— 收起一支之后
 *    这一支可能整体换到另一侧。徽标必须跟着**现在画出来的**那个节点走，
 *    否则会出现"节点在右、徽标在左"这种比原来更怪的状态。
 * ⚠️ 传进来的 `root` 必须是**完整树**（`this._tree`，不是 `_vt`）：
 *    只有完整树才认得"它原本有子节点"，`L` 才是可见树的排版（坐标就是屏幕上那几个数）。
 *
 * @param root   完整树
 * @param L      可见树的排版结果（`layoutOf(vt, …)`）
 * @param format 六种格式之一
 * @return       id → `'l' | 'r' | 't' | 'b'`（只给 L 里有的节点；**叶子不给**）
 */
function foldSideOf(root, L, format) {
  const out = {};
  if (!root || !L) return out;
  const fmt = format || 'mindmap';
  const rr = L[root.id];
  const baseCx = rr ? rr.x + rr.w / 2 : 0;   // 思维导图：根的中轴（左支/右支的分界）
  const spineY = rr ? rr.y + rr.h / 2 : 0;   // 鱼骨图：根就画在主脊上（见 layoutFishbone）

  (function walk(n, d) {
    const r = L[n.id];
    /* ⚠️ 判"有没有子"用**完整树**的 `n.children`，不是 L —— 折叠节点的子被剪掉了 */
    if (r && n.children && n.children.length) out[n.id] = sideFor(r, d);
    (n.children || []).forEach(function (c) { walk(c, d + 1); });
  })(root, 0);
  return out;

  /** 单个节点的出边侧 —— 每一条都对应 `linkPath` 里同名的那个分支 */
  function sideFor(r, d) {
    /* 逻辑图：`parentFn` 全部向右长 ⇒ 连线一律从**右缘中点**出发 */
    if (fmt === 'logic') return 'r';
    /* 树形图 / 时间轴：`treeLink` 起点 ＝ 父**底边中点** */
    if (fmt === 'tree' || fmt === 'timeline') return 'b';
    /* 组织结构图：根→一级是 `elbowTB`（底中），一级往下是 `treeLink`（也是底中） */
    if (fmt === 'org') return 'b';
    if (fmt === 'fishbone') {
      /* 根：主脊从它右缘往右贯出去（`decorLines`） */
      if (d === 0) return 'r';
      /* 一级：骨线（`boneLink`）从**近主脊那条边**的中点出发
         —— 上支的一级在脊上方 ⇒ 朝下；下支镜像 ⇒ 朝上。 */
      if (d === 1) return (r.y + r.h / 2) < spineY ? 'b' : 't';
      /* 二级及以下：三级由 `cascade` 向右展开，走 `elbowLR` ⇒ 右缘中点 */
      return 'r';
    }
    /* 思维导图（默认）：根的两侧都开 ⇒ 单枚徽标兜底挂右（数字是两支的总数）；
       其余看它落在根中轴的哪一侧 —— `cascade` 的 xL / xR 保证同一支同向 */
    if (d === 0) return 'r';
    return (r.x + r.w / 2) < baseCx ? 'l' : 'r';
  }
}

/**
 * 侧 → 绝对定位 style（★ 第 252 轮改：上下族改为"吃进节点 2px"）。
 * ⚠️ 左右族外推 `FOLD_GAP`、上下族吃进 `FOLD_KISS` —— 两档不同**不是笔误**，理由见常量段。
 */
function foldStyleOf(g, pos) {
  const h = FOLD_D / 2;
  if (pos === 'l') return 'left:' + Math.round(g.x - FOLD_GAP - FOLD_D) + 'px;top:' + Math.round(g.y + g.h / 2 - h) + 'px;';
  if (pos === 'r') return 'left:' + Math.round(g.x + g.w + FOLD_GAP) + 'px;top:' + Math.round(g.y + g.h / 2 - h) + 'px;';
  if (pos === 't') return 'left:' + Math.round(g.x + g.w / 2 - h) + 'px;top:' + Math.round(g.y + FOLD_KISS - h) + 'px;';
  return 'left:' + Math.round(g.x + g.w / 2 - h) + 'px;top:' + Math.round(g.y + g.h - FOLD_KISS - h) + 'px;';
}

/**
 * 节点层：位置来自排版结果 L，**文字行来自度量 M**（★ 第 67 轮）。
 *
 * ⚠️ 折行结果一定要**下发到 DOM**，不能让 wxss 再折一次：
 *    行高、节点高都是按 JS 折出来的行数算的，渲染层要是自己折成另一个行数，
 *    轻则底部空一截、重则最后一行被容器裁掉（"文字必须全部显示"当场失效）。
 *    所以每行是一个独立 <text>，wxss 给 `white-space: nowrap` 钉住。
 *
 * ★ 第 70 轮新增两个入参（第 252 轮改名 / 换数据源）：
 *   · `sides`  `foldSideOf` 的结果（id → `'l'|'r'|'t'|'b'`）—— **出边方向**就是挂侧，
 *     见 `foldSideOf` 的函数头。老写法传的是 `zoneMapOf` 的结果，252 轮已废弃。
 *   · `foldOf` id → 后代数 —— 从**完整树**数出来（见 refresh）。
 *     ⚠️ 不能在函数里对 `n.children` 现数：传进来的 n 是**可见树**的节点，
 *        它被折叠剪过，`countNodes` 只能数到 1（＝"折叠了 1 个"永远不涨）。
 */
function buildNodes(root, sel, L, M, sides, foldOf) {
  const rows = [];
  (function walk(n) {
    const g = L[n.id], m = M && M[n.id];
    if (g && m) {
      const row = {
        id: n.id,
        lines: linesPayload(m),
        /* ★★ 275 轮：节点挂图 —— `m.img` 是**相对 uri**，这里才拼成完整地址。
           ⚠️ 没图就是空串（`wx:if` 拿掉那一段，不留一个空盒子 —— 空盒子会吃掉 8px 的
              `margin` 而不显示任何东西，节点看起来"凭空多了道缝"）。
           ★ 275b：`imgW` / `imgH` 是排版层算好的**图块几何**（设计稿 px），渲染层直接写进
              行内 `width/height` —— 图块高与节点盒高同源，裁切/空档才不会出现。 */
        img: m.img ? api.fileUrl(m.img) : '',
        imgW: m.imgW || 0,
        imgH: m.imgH || 0,
        /* ★★ 199 轮：`fresh` ＝ 这枚节点是**刚从胶囊转过来**的、用户还没选中过它。
           ⚠️ 取值直接是节点上的 `flash`（服务端写、`POST /mindmaps/:id/seen` 清），
              **不要**在这里按 `createdAt` 或"是不是叶子"现算 —— 状态是跨端的。
           ⚠️ 位置在 `sel` **之后**：两个类同特异性（各 (0,1,0) 挂在同一个元素上），
              靠 wxss 里的先后定输赢 —— `.mm-node.sel` 排在 `.mm-node.fresh` 之后 ⇒ 选中赢。
              （正常路径下两者不会同时出现：选中那一刻 `markNodesSeen` 已经把标记清掉了。） */
        cls: 'lv' + Math.min(n.level || 0, 3) + (n.id === sel ? ' sel' : '') + (n.flash ? ' fresh' : ''),
        style: 'left:' + g.x + 'px;top:' + g.y + 'px;width:' + g.w + 'px;height:' + g.h + 'px;'
      };
      const fold = n.collapsed ? ((foldOf && foldOf[n.id]) || 0) : 0;
      if (fold > 0) {
        row.fold = fold > 99 ? '99+' : String(fold);
        row.foldStyle = foldStyleOf(g, (sides && sides[n.id]) || 'r');
      }
      rows.push(row);
    }
    (n.children || []).forEach(walk);
  })(root);
  return rows;
}

/** 度量里的行数组 → wxml 能挂 wx:key 的形状（`{i, t}`；纯字符串数组没法防重复行） */
function linesPayload(m) {
  const out = [];
  if (m && m.lines) m.lines.forEach(function (t, i) { out.push({ i: i, t: t }); });
  return out;
}

/**
 * 拖动体（＝节点本体）的渲染载荷 —— `beginDrag` / `updateDrag` **必须共用这一处**。
 *
 * ⚠️ 第 67 轮踩到的真 bug：`setData({dragGhost: …})` 是**整体替换**这个键（不是深合并），
 *    于是两处各写一份载荷时，后一次一旦漏掉了 `lines`，模板里
 *    `wx:for="{{dragGhost.lines}}"` 就没得渲染 —— 症状是**拖动体一跟手，文字当场消失**
 *    （拎起来那一瞬间还有字，手指一动就空了）。
 *    而且这条缺陷**断言查不出来**：`dragGhost` 仍然是个真对象、拖动体照常在动。
 *    同理可推：凡是"同一块数据分两处下发"的地方，都要收成一个构造函数。
 */
function ghostPayload(M, id, level, style) {
  const m = M && M[id];
  return {
    lines: linesPayload(m),
    /* ★★ 275 轮：拖动体也带图 —— 拎起来那一刻节点长什么样，跟着手指走的那块就该长什么样。
       少这一行不会报错，只会"一拎起来图就消失"（与 67 轮 lines 丢失是同一类静默缺陷）。
       ★ 275b：`imgW` / `imgH` 与节点层同源（同一份 `M`），否则拖动体的图与节点上的不一样大。 */
    img: m && m.img ? api.fileUrl(m.img) : '',
    imgW: (m && m.imgW) || 0,
    imgH: (m && m.imgH) || 0,
    cls: 'lv' + Math.min(level || 0, 3),
    style: style
  };
}

/* ==========================================================================
   连线层（★ 按格式分派；第 67 轮按参考图重新校准）

   连线只表达**父子关系**（严格树：没有自由连线，FR-7.3）。

   六种格式各有各的走法：
     mindmap   贝塞尔曲线（父近侧边 → 子近侧边，控制点落在中点竖线上）
     logic     同上（参考图里逻辑图也是曲线，不是直角折线）
     tree      直角短枝：父**底边中心**垂下一根总线，再横伸到子节点
     timeline  与 tree 同一套（它的"竖轴"就是根的总线，一级节点左右各挂一枝）
     org       直角折线：父底中 → 中点横向转折 → 子顶中（同一层的兄弟共用那条横线，天然成总线）
     fishbone  主脊 ＋ 骨：根 → 一级是斜线，一级往下回归 tree 的直角短枝

   ⚠️ 节点层在 .links **之后**渲染 ⇒ 节点方块盖在连线上面：
      所以直线族"画到节点中心"是安全的（压住的那一段看不见），
      折线族仍按边缘起笔 —— 它的横向段若从中心出发会横穿整个方块。
   ========================================================================== */
const CORNER = 6;      // 折角圆角半径；两轴间距不够时按比例收缩，退化为直线

/* ==========================================================================
   连线配色（★ 第 66 轮）

   参考版那条线是**中性灰、细**：压在浅灰节点旁边不抢戏。
   原来用的 #D3D7E0 偏蓝灰 —— 白底上看着"塑料"，节点改成中性灰底之后更明显。
   ⚠️ 选中态**不再**把「根→选中节点」那条路径染黄（参考版选中时线不变色，
      指认交给节点自己的白底＋黄框），所以 buildLinksUri 不需要 sel 参数了。
   ========================================================================== */
/* ★★★ 186 轮（深色模式）：换色**不能留在模块级常量里** ——
   本文件是"拼 SVG 串"的纯函数集，而主题是**运行期会变**的（切主题不重启、不重建）。
   把颜色钉成常量 ⇒ 切主题后连线还是浅色那一支（深灰线画在深色画布上 ≈ 看不见）。
   ⇒ `LINK_C` 保留为**浅色基线**（`工具/render_mindmap.js` 会 `api.LINK_C` 取它出图，
      判据也拿它对撞），真正上线那两处改成读 `linkC()`。

   ⚠️⚠️ `linkC()` 里**必须自己把 `require` 包在 try 里**、且回落 `LINK_C`：
      本文件顶部那段注释写着"无头判据是按**源码切片**跑的，切片里不许出现 wx / require"
      —— 切片在 `vm` / `new Function` 里执行时没有 `require`，直接引用会 ReferenceError。
      包起来之后：**上线**（有 require）拿到主题色；**判据**（无 require）拿到浅色基线
      ⇒ 那一批 `check_mindmap_*` 的结果与改前**逐值一致**，不用改一个数。
      这也顺便保证了 `utils/theme.js` 自己的约定（Node 桩环境安全）不会在这里被破坏。 */
const LINK_C = '#C8C8CC';      // 普通父子连线（**浅色基线**；上线路径请用 linkC()）
function linkC() {
  try {
    const t = require('./theme');
    if (t && typeof t.linkColor === 'function') return t.linkColor();
  } catch (e) { /* 无头切片：没有 require ⇒ 回落浅色基线（与改前逐值相同） */ }
  return LINK_C;
}
const LINK_W = 1.6;
/* ★ 第 68 轮：拖拽预览折线改成**拖拽标记蓝**（原来品牌黄）。
   参考图里"将挂到这儿"的框与线**同色同粗细**，且不跟着光标走 ——
   它指的是**父节点**，不是手指。粗细给 2 比普通线（1.6）略重一档就够，
   参考图里那根蓝线并没有明显比灰线粗（3 会显得"另画了一条主题线"）。 */
const LINK_HL_W = 2;

/**
 * 树形 / 时间轴族（直角短枝）：父节点**底边中心**就是总线，从那里垂到子节点的纵向中心，
 * 再横着伸到子节点的近侧边 —— 拐角带圆角。
 *
 * 同一批兄弟共用同一条竖直总线（父节点中心只有一根），看起来就是参考图里
 * "一根杆挂着几枝"的样子；因为父节点只有一个、中心只有一个，总线自动重合。
 */
function treeLink(a, b) {
  const bx = a.x + a.w / 2;
  const y1 = a.y + a.h, y2 = b.y + b.h / 2;
  const side = b.cx >= a.cx ? 1 : -1;
  const ex = side > 0 ? b.x : b.x + b.w;          // 子节点近侧边
  if (y2 <= y1 + 1) return 'M' + bx + ' ' + y1 + ' L' + ex + ' ' + y2;
  const dx = Math.abs(ex - bx);
  const r = Math.min(CORNER, dx, (y2 - y1) / 2, 12);
  if (r < 1.5) return 'M' + bx + ' ' + y1 + ' L' + bx + ' ' + y2 + ' L' + ex + ' ' + y2;
  return 'M' + bx + ' ' + y1 +
    ' L' + bx + ' ' + (y2 - r) +
    ' Q' + bx + ' ' + y2 + ' ' + (bx + side * r) + ' ' + y2 +
    ' L' + ex + ' ' + y2;
}

/** 直角折线（上下族）：父底中 → 中点横向转折 → 子顶中 */
function elbowTB(a, b) {
  const x1 = a.x + a.w / 2, y1 = a.y + a.h;
  const x2 = b.x + b.w / 2, y2 = b.y;
  const my = y1 + (y2 - y1) / 2;
  const r = Math.min(CORNER, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2);
  if (Math.abs(x2 - x1) < 1 || r < 1) return 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2;
  const s = x2 > x1 ? 1 : -1;
  return 'M' + x1 + ' ' + y1 +
    ' L' + x1 + ' ' + (my - r) +
    ' Q' + x1 + ' ' + my + ' ' + (x1 + s * r) + ' ' + my +
    ' L' + (x2 - s * r) + ' ' + my +
    ' Q' + x2 + ' ' + my + ' ' + x2 + ' ' + (my + r) +
    ' L' + x2 + ' ' + y2;
}

/**
 * 鱼骨图的「骨」：从主脊上的一点**斜拉**到一级节点的**近主脊那条边**。
 *
 * ⚠️ 终点不能取节点中心（旧写法）：斜线会钻进方块正中间，看起来像把节点插穿了；
 *    参考图里骨线止于节点边缘 —— 上支止于底边中点、下支止于顶边中点。
 * ⚠️ 水平跨度**随纵向距离变化**（斜率恒定），近的骨短、远的骨长，一排看过去呈扇形散开；
 *    旧写法定死 52px 让所有骨线等长，整排像一列竖直的平行线，"斜插"感全没了。
 * ⚠️ 上下两支共用一个 `FISH_SLOPE`，方向由**几何**定（`b.cy < a.cy` 即上支）——
 *    与 `linkPath` 一样不猜层号，换方向、改层数都不会走错。
 * ⚠️ `FISH_SLOPE` 的**定义在常量段**（`layoutFishbone` 上面那簇 FISH_* 里）——
 *    挪到这儿会让无头校验的切片取不到它，见那边的注释。
 */
/* ⚠️ 第 77 轮去掉了 73 轮那对 `FISH_DX_MIN/MAX` 夹紧：那时骨线顶多 190px，
   因为一级节点就贴在主脊边上。现在一级在骨线**远端**，跨度就是整支的高度，
   夹一下会算出个错的基点 ⇒ 骨线从半空中斜拉下来，和二级串的短枝也接不上。
   ⚠️ `FISH_SLOPE` 的值必须与 `layoutFishbone` 里摆二级用的同一个 —— 三处（含 ribStub）。 */
function boneLink(a, b) {
  const up = b.cy < a.cy;
  const ey = up ? (b.y + b.h) : b.y;          // 近主脊那条边
  const ex = b.x + b.w / 2;
  const dx = Math.abs(a.cy - ey) * FISH_SLOPE;
  return 'M' + r2(ex - dx) + ' ' + r2(a.cy) + ' L' + r2(ex) + ' ' + r2(ey);
}

/**
 * 骨线 → 二级的**水平短枝**（★ 第 77 轮新增）。
 *
 * 二级不挂在**父节点**上，而是挂在父节点那条**骨线**上 —— 参考图里骨线从
 * 一级的底边中心一路斜下来，二级从骨线上横着伸一截出去。所以这一跳要画的是
 * 「骨线在该 y 处的点 → 二级左缘」这一条横线，**不是**从一级方块本身出发。
 *
 * ⚠️ `ribX` 与 `layoutFishbone` 摆位时**同一式**（只是那里用 `km`、这里用 rect）：
 *    换向 / 改层数都不会走错，因为朝向由**几何**定（子在上 ⇒ 用父的顶边当近脊边）。
 */
function ribStub(a, b) {
  const childAbove = b.cy < a.cy;
  const eb = childAbove ? a.y : (a.y + a.h);            // 父的近脊边
  const ex = a.x + a.w / 2;
  const ribX = ex - Math.abs(eb - b.cy) * FISH_SLOPE;
  return 'M' + r2(ribX) + ' ' + r2(b.cy) + ' L' + r2(b.x) + ' ' + r2(b.cy);
}

/**
 * 直角折线（左右族）：父**近侧边中点** → 横 → 竖总线 → 横 → 子**近侧边中点**。
 *
 * ⚠️⚠️ 第 80 轮补**方向**：这一条原本是只为"子节点在右边"写的
 *    （`x1 = a.x + a.w` / `x2 = b.x` / `mx = x1 + …`）。思维导图的**左支**把它接上之后，
 *    `gap = x2 − x1` 是负的 ⇒ 落进 `gap < 2` 那一支 ⇒ 变成"从父节点**右缘**直连子节点**左缘**"
 *    的一条**斜直线**，整条线横穿父节点本身（出图上是一根从左支一直拉到右支的长斜线）。
 *    ⇒ 朝向一律**看几何**（`b.cx >= a.cx`），与 `treeLink` / `curveLR` / `boneLink` 同一个口径。
 *    鱼骨图的三级往下、逻辑图的二级往下都是 `dir=1`，行为与改前逐像素一致。
 */
const BUS_GAP = 14;           // 总线离父节点近侧边多远
function elbowLR(a, b) {
  const dir = b.cx >= a.cx ? 1 : -1;
  const x1 = dir > 0 ? a.x + a.w : a.x;
  const x2 = dir > 0 ? b.x : b.x + b.w;
  const y1 = a.cy, y2 = b.cy;
  const gap = dir > 0 ? (x2 - x1) : (x1 - x2);
  if (gap < 2) return 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2;
  const mx = x1 + dir * Math.min(BUS_GAP, gap / 2);
  if (Math.abs(y2 - y1) < 1.5) return 'M' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2;
  const r = Math.min(CORNER, Math.abs(y2 - y1) / 2, Math.abs(mx - x1), Math.abs(x2 - mx));
  const s = y2 > y1 ? 1 : -1;
  if (r < 1) {
    return 'M' + x1 + ' ' + y1 + ' L' + mx + ' ' + y1 + ' L' + mx + ' ' + y2 + ' L' + x2 + ' ' + y2;
  }
  return 'M' + x1 + ' ' + y1 +
    ' L' + (mx - dir * r) + ' ' + y1 + ' Q' + mx + ' ' + y1 + ' ' + mx + ' ' + (y1 + s * r) +
    ' L' + mx + ' ' + (y2 - s * r) + ' Q' + mx + ' ' + y2 + ' ' + (mx + dir * r) + ' ' + y2 +
    ' L' + x2 + ' ' + y2;
}

/** 曲线（思维导图 / 逻辑图）：三次贝塞尔，两个控制点落在中点竖线上 ⇒ 出枝柔和但不甩出去 */
function curveLR(a, b, dir) {
  const x1 = dir > 0 ? a.x + a.w : a.x;
  const x2 = dir > 0 ? b.x : b.x + b.w;
  const y1 = a.y + a.h / 2, y2 = b.y + b.h / 2;
  const mx = x1 + (x2 - x1) / 2;
  return 'M' + x1 + ' ' + y1 + ' C' + mx + ' ' + y1 + ' ' + mx + ' ' + y2 + ' ' + x2 + ' ' + y2;
}

/**
 * 装饰线（★ 第 67 轮只剩鱼骨图有）：那条**横向主脊**。
 * 时间轴的主轴**不需要**了 —— 它的"主轴"就是根节点自己的总线（见 treeLink）：
 * 一级节点在左右两侧各挂一枝，合起来自然就是一根竖轴，多画一笔反而会重。
 */
function decorLines(root, land, L, fmt) {
  if (fmt !== 'fishbone') return [];
  const r0 = L[root.id];
  const kids = root.children || [];
  if (!r0 || !kids.length) return [];
  /* ★ 第 73 轮改口径：主脊**贯穿整幅图**（旧写法只画到"最后一个一级节点的中心"）。
     一级节点永远落在各自分支的**最左**端，所以旧口径下主脊从第一支起就停住了：
     右边几条分支的骨线看起来像从半空中斜拉下来，参考图里主脊是一根通到底的脊。 */
  let maxX = r0.x + r0.w;
  Object.keys(L).forEach(function (id) {
    const r = L[id];
    if (r.x + r.w > maxX) maxX = r.x + r.w;
  });
  return ['<path d="M' + r2(r0.x + r0.w) + ' ' + r2(r0.cy) + ' L' + r2(maxX + 24) + ' ' + r2(r0.cy) +
    '" fill="none" stroke="' + linkC() + '" stroke-width="' + LINK_W + '"/>'];
}

/**
 * 一对父子之间的连线形状（按格式分派 ＋ 按几何**方向**决定朝向）。
 * 朝向不去猜"这是第几层"，而是直接看两块的相对位置 ——
 * 于是思维导图的左右两侧、时间轴的左右两半、鱼骨图的上下两支共用同一段代码。
 *
 * `opt` 由 `buildLinksUri` 的 walk 按**深度**下传（第 80 轮统一成两枚开关）：
 *   · `deep` ＝ 不是「根 → 一级」那一跳 —— 六种格式里只有思维导图/逻辑图/组织结构图
 *     会用到它，三者的口径见下面各自的注释。
 *   · `bone` / `rib` ＝ 只给鱼骨图用的两档（第 77 轮拆的，别再合回一档）：
 *     `bone` 根 → 一级 … 斜插的**骨线**（一条从主脊通到一级底边中心的长直线）
 *     `rib`  一级 → 二级 … 从**骨线**上横伸出去的**短枝**（二级挂在骨线上，不挂在父节点上）
 */
function linkPath(a, b, fmt, opt) {
  if (!a || !b) return '';
  const deep = !!(opt && opt.deep);
  /* 组织结构图（★ 第 80 轮）：**根 → 一级还是横向总线**（`elbowTB`），
     一级往下一律换成树形图那一套直角短枝（`treeLink`）——
     用户口径「一级节点以后的节点连接样式应该是类似于树形图的模式，这样文字就不会在横向过分展开了」。
     连线口径必须与 `layoutOrg` 的排版口径**成对**（那边也是一级往下改成逐个 `treeCascade`），
     单改一边会出现"节点在左、线从右边绕过来"。 */
  if (fmt === 'org') return deep ? treeLink(a, b) : elbowTB(a, b);
  if (fmt === 'fishbone') {
    if (opt && opt.bone) return boneLink(a, b);
    if (opt && opt.rib) return ribStub(a, b);
    return elbowLR(a, b);
  }
  if (fmt === 'tree' || fmt === 'timeline') return treeLink(a, b);
  /* 思维导图 / 逻辑图（★ 第 80 轮）：**根 → 一级仍是贝塞尔**（用户口径：除了原点与一级节点的
     连线，其他都要直角带圆角），一级往下换 `elbowLR`（父近侧边中点 → 横 → 竖总线 → 横 → 子近侧边中点）。
     ⚠️ 这里**不能**用 `treeLink`：那是"从父节点**底边中点**往下"的走法，
        对左右生长的格式会把总线画到父节点正下方、和兄弟列叠在一起。
        `elbowLR` 才是左右族的直角圆角走法（同一父的多个子节点天然共用一条竖总线）。 */
  return deep ? elbowLR(a, b) : curveLR(a, b, b.cx >= a.cx ? 1 : -1);
}

/**
 * 连线层的**渲染盒**（★ 第 67 轮补）= 画布矩形 ∪ 所有节点矩形 ＋ 48px 余量。
 *
 * 为什么非要有它：连线是一张 **SVG 背景图**，而最外层 `<svg>` 会建立一个 viewport、
 * **默认把超出部分裁掉**。第 67 轮起排版**明确允许节点摆到画布之外**
 * （"树太宽 / 太深时不硬把二十几个节点压进一屏"），于是原来那句
 * `width=cv.w height=cv.h` 会把**一半以上节点的连线静默剪掉**：
 *
 *   | 格式 | 节点包围盒 | 旧的 SVG 视口 | 落在画布外的节点 |
 *   |---|---|---|---|
 *   | tree | 40,88 → 750,1362 | 1168×722 | **11 / 21** |
 *   | org | 40,148 → 3045,554 | 1168×722 | **14 / 21** |
 *   | timeline | −1,88 → 1196,1432 | 1168×722 | **13 / 21** |
 *   | fishbone | 40,71 → 2986,631 | 1168×722 | **14 / 21** |
 *
 * ⚠️ 这个缺陷**数值断言查不出来** —— 矩形确实不重合、文字确实装得下、
 * `<path>` 也确实都在 SVG 源码里（实测 `paths:20` 一条不少），只是画到了视口外面。
 * **只有看图才看得见**（症状是"总线只画了一半"）。
 *
 * 顺带白拿一个好处：背景图原来是按 1168×722 栅格化的（要铺 3000px 宽的图 ⇒
 * 有效分辨率只剩 0.39 倍），现在按包围盒栅格化，连线基本是 1:1，**更锐**。
 *
 * `extra` 用来把拖拽高亮那两个矩形一并并进来（那一层只有一条线，盒越小越省）。
 */
function renderBoxOf(L, cv, extra) {
  let x0 = 0, y0 = 0, x1 = cv.w, y1 = cv.h;
  const eat = function (r) {
    if (!r) return;
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  };
  Object.keys(L || {}).forEach(function (id) { eat(L[id]); });
  (extra || []).forEach(eat);
  const P = 48;
  const bx = Math.floor(x0 - P), by = Math.floor(y0 - P);
  return { x: bx, y: by, w: Math.ceil(x1 + P) - bx, h: Math.ceil(y1 + P) - by };
}

/** 渲染盒 → 图层行内 style。⚠️ 必须与 SVG 的 viewBox 用**同一个盒**，错一个数连线的位置就整体偏掉 */
function boxLayerStyle(b) {
  return 'left:' + b.x + 'px;top:' + b.y + 'px;width:' + b.w + 'px;height:' + b.h + 'px;';
}

/**
 * 连线层（DOM 那一层）。`sel` 已不再参与（见文件里 LINK_C 那段注释）。
 * 返回 `{uri, box}` —— 2 个值必须一起用（`uri` 里的 SVG 以 `box` 为 viewBox，
 * 图层的 left/top/width/height 也得是 `box`）。
 */
function buildLinksUri(root, land, L, format) {
  if (!root) return { uri: '', box: null };
  const cv = land ? CANVAS.land : CANVAS.port;
  const fmt = format || 'mindmap';
  const box = renderBoxOf(L, cv);

  const paths = decorLines(root, land, L, fmt);
  /* ⚠️⚠️ 第 79 轮修：这里原来写的是 `})(root);` —— **只传了一个参数**，
     `d` 是 `undefined` ⇒ `d === 0` / `d === 1` 恒为假 ⇒ 鱼骨图的三档连线
     全部落到兜底的 `elbowLR`。症状：**节点位置全对、连线全是直角折线**，
     真机上一整幅看起来是组织结构图而不是鱼骨图，而所有数值断言（只查节点坐标）
     一条不红。改任何"按深度分档"的逻辑时，先确认 IIFE 把初始深度传进去了。 */
  (function walk(node, d) {
    (node.children || []).forEach(function (c) {
      const a = L[node.id], b = L[c.id];
      if (a && b) {
        /* 鱼骨图分三档：根→一级是"骨"、一级→二级是"骨线上的短枝"、再往下是逻辑图走法。
           ⚠️ 靠**深度**分档（不靠几何）：同一条骨上的二级与一级是父子，但二级不在骨线的
              延长线上"更远"的那侧，按几何判会判反。
           ⚠️ 第 80 轮起再补一枚 `deep`（＝ 不是"根 → 一级"那一跳）：思维导图/逻辑图/
              组织结构图三种格式用它把"一级往下"换成直角圆角连线，细节见 `linkPath`。 */
        const bone = (fmt === 'fishbone' && d === 0);
        const rib = (fmt === 'fishbone' && d === 1);
        paths.push('<path d="' + linkPath(a, b, fmt, { bone: bone, rib: rib, deep: d > 0 }) +
          '" fill="none" stroke="' + linkC()
          + '" stroke-width="' + LINK_W + '" stroke-linecap="round"/>');
      }
      walk(c, d + 1);
    });
  })(root, 0);

  /* 路径一律写在**画布坐标**里，靠 viewBox 平移到渲染盒 —— 这样排版层不用关心这件事 */
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + box.w + '" height="' + box.h
    + '" viewBox="' + box.x + ' ' + box.y + ' ' + box.w + ' ' + box.h + '">'
    + paths.join('') + '</svg>';
  return { uri: 'data:image/svg+xml,' + encodeURIComponent(svg), box: box };
}

/**
 * 拖动预览线（★ 第 66 轮新增；第 68 轮改口径；**第 69 轮改色 ＋ 起点挪到框的外缘**）——
 * 只画「将要挂到谁身上」这一条：**候选父节点的近侧边 → 浮动节点**，品牌黄。
 *
 * ⚠️ `fromRect` 必须由调用方传**框**（父节点外扩 `PARENT_PAD`），不能传节点本身：
 *    框比节点大 3px，线若从节点边缘出发，左端就落在**框的内侧**、像从框里钻出来 ——
 *    用户第 69 轮反馈的"连接线穿透了上一级节点"就是它。
 * ⚠️ 第 68 轮口径变化：起点由"手指底下的节点"改成**浮动节点的父节点** ——
 *    这条线的**终点永远咬住浮动节点的近侧边**、起点咬住高亮那个父节点，
 *    手指在节点里怎么晃它都不动（它表达的是"位置关系"，不是"落点光标"）。
 *
 * 单独一层（.mm-links-hl）压在整个画布**最上面**：
 * 普通连线被节点方块盖住是好事（省得算交点），这条高亮线被盖住就白画了。
 */
function buildDragLinkUri(fromRect, toRect, land, fmt, deep) {
  if (!fromRect || !toRect) return { uri: '', box: null };
  const cv = land ? CANVAS.land : CANVAS.port;
  /* 形状沿用这个格式自己的走法（组织结构图竖直折线、树形/时间轴直角短枝、
     思维导图与逻辑图贝塞尔）—— 落点提示的"手感"与图本身一致才不会突兀。
     ⚠️ 第 80 轮补 `deep`：预设的父子关系**天然是"一级往下"那一跳**，所以预览线也按
        `deep` 走（思维导图/逻辑图 ⇒ 直角圆角；组织结构图 ⇒ 直角短枝）。
        唯一例外是候选父节点**正好是根**时（思维导图/逻辑图的根→一级仍是贝塞尔），
        由调用方把 `deep` 传 false 压回来 —— 否则"预览一条折线、放手变一条曲线"。 */
  const d = linkPath(fromRect, toRect, fmt || 'mindmap',
    { deep: deep === undefined ? true : !!deep });
  /* ⚠️ 与主连线层同一个坑：这一条线可能从**画布外**的目标节点拉过来（目标在图上、
     而图比画布大），固定 1168×722 的视口会把它剪掉 ⇒ 用「画布 ∪ 这两个矩形」当渲染盒 */
  const box = renderBoxOf({ a: fromRect, b: toRect }, cv);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + box.w + '" height="' + box.h
    + '" viewBox="' + box.x + ' ' + box.y + ' ' + box.w + ' ' + box.h + '">'
    + '<path d="' + d + '" fill="none" stroke="' + DRAG_C + '" stroke-width="' + LINK_HL_W
    + '" stroke-linecap="round"/></svg>';
  return { uri: 'data:image/svg+xml,' + encodeURIComponent(svg), box: box };
}

/* ---------------- 视口工具 ---------------- */

/**
 * .mm-viewport 的 transform：**先平移、后缩放**，原点锁在左上角。
 * 于是「画布坐标 c → 容器坐标 l」就是 l = t + sv·c，反算一次减法除即可 ——
 * 不用去踩 transform-origin 默认居中带来的那层偏移。
 */
function stageStyleOf(sv, tx, ty) {
  return 'transform:translate(' + tx + 'px,' + ty + 'px) scale(' + sv + ');';
}
function clampView(v) { return Math.max(VIEW_MIN, Math.min(VIEW_MAX, v)); }
/* ★★ 2026-10-24（复审 P2-14）：「适应屏幕」专用 —— 地板是 `VIEW_FIT_MIN` 而不是 `VIEW_MIN`。 */
function clampViewFit(v) { return Math.max(VIEW_FIT_MIN, Math.min(VIEW_MAX, v)); }
function r2(v) { return Math.round(v * 100) / 100; }
function dist2(ax, ay, bx, by) { return Math.sqrt((ax - bx) * (ax - bx) + (ay - by) * (ay - by)); }

/**
 * 视图自适应（★ 第 67 轮新增）：算出让**整幅图**落在画布里的 {sv, tx, ty}。
 *
 * 为什么需要它：节点改成"按字数折行、文字全部显示"之后，图的体积只增不减 ——
 * 一棵 21 节点的树横着能铺到 3000+ px，而画布只有 1168。开图若还是 100%，
 * 用户第一眼只看到左上角一块，会以为图坏了。
 *
 * ⚠️ 只**缩**不**放**：内容本来就装得下时一律回到 100%（放大到 1 以上没意义，
 *    那只会把够看的图撑出屏幕，还得用户自己缩回来）。
 *
 * ⚠️ **顶 / 底两条"安全带"必须留**（同日走查补的）：顶部工具栏与底部节点浮条
 *    是**浮在画布上的固定屏幕尺寸**元素，**不跟着 sv 缩放** ——
 *    第一版只留 `MARGIN = 24`，于是顶部锚定的三种格式（树形图 / 组织结构图 / 时间轴）
 *    **根节点正好落在工具栏底下**，逻辑图 / 时间轴最下面那个节点压在浮条上。
 *    ⇒ 高度可用区改成 `cv.h − SAFE_T − SAFE_B`，纵向居中也在这一带里做。
 *    （左右没有固定尺寸的浮层，所以横向仍用 `MARGIN`。）
 */
/* ★ 两条工具条的**真实几何** —— 与 `components/mod-mindmap/mod-mindmap.wxss` 逐值对应。
     `.mm-top`        : top 4 ＋ 高 56 ⇒ 底边 **60**（可见块底边 52）
     `.mm-float-wrap` : 贴底 4 ＋ `.mm-float` 高 56 ⇒ 占高 **60**（可见块底边 52）
     （两条都没有横竖屏覆盖，是唯一几何来源。）

   ★★ 253 轮 **60 → 44 / 16 → 10**（《脑图工具栏位置方案》"外壳减重 + 改角"）：
        那轮把两条工具栏从"上下通栏居中的胶囊"改成"右上 / 左下贴角的一排裸键" ——
        胶囊底、描边、大阴影全撤，键的视觉底色收进 32×32 的 `.fb-tile`，热区仍是 44×44
        ⇒ 整条高度就只剩一颗键的 44；贴边同时从 16 收到 10。
        安全带因此 84 → **62**。
   ★★★ 254 轮 **44 → 66**：用户口径「上下两组操作栏应该整体加大 50%」。
        热区 44 → 66、视觉块 32 → 48、图标 24 → 36、间距 4 → 6、竖线 17 → 26，
        全部 ×1.5；**贴边 10 不动**。
        ⇒ SAFE_T / SAFE_B = 10 ＋ 66 ＋ 8 = **84**。
   ★★★ 255 轮 **66 → 56 / 10 → 0**：用户口径「1.5 倍又有点大了，稍微再缩小一点」
        ＋「上按键区的右侧和上侧、下按键区的左侧和下侧离画布边框的间隔稍微有点大，
          需要减小一下并统一」。
        热区 66 → 56、视觉块 48 → 40、图标 36 → 30、间距 6 → 5、竖线 26 → 21；
        贴边 **热区贴到 0**（top/bottom/left/right 四边同值）。
        ⇒ SAFE_T / SAFE_B = 0 ＋ 56 ＋ 8 = **64**。
        ⚠️ 为什么 BAR_GAP 是 0 而不是 8：用户比的是**看得见的那块**到画布边的距离 ——
          热区透明、块在热区里居中内缩 (56−40)/2 ＝ 8 ⇒ 热区贴 0 时可见块离边正好 8，
          与左上比例胶囊（贴 8）**完全同值**。若把热区贴 8，块离边就成 16，
          左上那枚只会是 8 ⇒ 一左一右又差一档，用户这次抱怨的正是这个"没统一"。
   ★★★ 256 轮 **BAR_GAP 0 → 4**：用户口径「四边的边距从 8 改为 12，目前又有点太小了」。
        键的尺寸 / 间距 / 分组一个字没动，只把整条往里挪 4
        ⇒ 可见块离边 ＝ 4 ＋ (56−40)/2 ＝ **12**（左上胶囊同步 8 → 12，四边同值）。
        ⇒ SAFE_T / SAFE_B = 4 ＋ 56 ＋ 8 = **68**。
        ⚠️ 这条 4 仍然不能跟"可见块离边 12"混着读：4 是**热区**的贴边量（中间量），
          用户量的是看得见的那 40 方块 —— 255 轮就在这上面算反过一次（把 8 当成热区贴边）。

   ⚠️⚠️ **条高 56 → 60 是第 81 轮「触控放大」改的**（圆钮 40→44 / 图标 20→24 /
        内边距 8→10），那轮只动了 wxss，这两条安全带**没有跟着动** ——
        于是 84 的构成从当初的「底边 72 ＋ 呼吸 12」变成了「底边 76 ＋ 呼吸 8」。
   ★ 2026-10-15 复核后**有意保持 84 不动**（用户拍板）：84 > 76，节点**不会**被
     工具条压住，真机观感也验过；补回 12 呼吸要把 SAFE 抬到 88，会让「适应屏幕」
     的初视图整体再缩 4px，属**没必要的视觉变动**。
     ⇒ 那轮只把**账算清**（拆成具名算式、注释与真值同步），数值一字不改。
   ⚠️ 日后若条高再变，**不要只改 wxss** —— 底线由 `工具/check_safe_band.js` 盯住：
     它会解析这里的算式与 wxss 的 `.mm-top` / `.mm-float-wrap` 真值绑对，
     一旦「条高变了而 SAFE 没跟」（＝ 内容会被浮层压住）立刻报红。 */
const BAR_H = 56;                        // 工具条条高（`.mm-top` / `.mm-float` 同高）—— 253: 60→44｜254: 44→66｜255: 66→56
const BAR_GAP = 4;                       // 热区到画布边的距离（四边同值；可见块实际离边 12 ＝ 4 ＋ (56−40)/2）
const BAR_BREATH = 8;                    // 安全带在条外再多留的呼吸（原设计 12，条高升至 60 后被动收成 8）
const SAFE_T = BAR_GAP + BAR_H + BAR_BREATH;   // = 68，顶部工具栏
const SAFE_B = BAR_GAP + BAR_H + BAR_BREATH;   // = 68，底部节点浮条
function fitViewOf(L, land) {
  const cv = land ? CANVAS.land : CANVAS.port;
  const ids = Object.keys(L || {});
  if (!ids.length) return { sv: 1, tx: 0, ty: 0 };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  ids.forEach(function (id) {
    const r = L[id];
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  });
  const MARGIN = 24;                                    // 左右留一点呼吸
  const k = Math.min(
    (cv.w - MARGIN * 2) / (x1 - x0),
    (cv.h - SAFE_T - SAFE_B) / (y1 - y0)
  );
  /* 装得下 ⇒ 原样。此时排版自己的 PAD（横 t88 / b108）本来就比安全带更宽，不必换算 */
  if (k >= 0.999) return { sv: 1, tx: 0, ty: 0 };
  /* ★★ 2026-10-24（复审 P2-14）：这里原来过的是 `clampView(k)`（地板 0.2）——
     需要 12% 才装得下的树会被抬回 20%，"适应屏幕"永远差一截。改用 fit 专用地板。 */
  const sv = clampViewFit(k);
  const availH = Math.max(1, cv.h - SAFE_T - SAFE_B);
  return {
    sv: sv,
    tx: (cv.w - (x1 - x0) * sv) / 2 - x0 * sv,
    ty: SAFE_T + Math.max(0, (availH - (y1 - y0) * sv) / 2) - y0 * sv
  };
}

/** 把一个排版矩形转成行内 style（pad 用来给「将成为子节点」的描框留出余量） */
function boxStyle(r, pad) {
  const p = pad || 0;
  return 'left:' + r2(r.x - p) + 'px;top:' + r2(r.y - p) + 'px;width:' + r2(r.w + p * 2) +
         'px;height:' + r2(r.h + p * 2) + 'px;';
}

/**
 * 同一个矩形，换算到**卡片容器坐标**（★ 第 212 轮）—— 给"候选父节点框"用。
 *
 * 为什么它得从画布坐标挪出来：`.mm-viewport` 上挂着 `transform`，它自己就是一个
 * **层叠上下文** ⇒ 里面任何 `z-index` 都压不过 viewport 外面的 `.mm-ghost`（21）。
 * 而"候选父节点变了色却看不见"正是本轮要修的毛病，所以那枚黄框只能搬到 viewport **外面**，
 * 与拖动体平级，才能把 `z-index` 排在它上面。
 *
 * 换算就是 `.mm-viewport` 的那条 `translate(tx,ty) scale(sv)`：
 *   容器坐标 ＝ `tx + sv × 画布坐标`（尺寸同理乘 `sv`）。
 * ⚠️ `tx / ty / sv` 必须取**当前这一帧**的值（拖拽中画布可能被自动平移/缩放）。
 */
function boxStyleInCard(r, pad, tx, ty, sv) {
  const p = pad || 0;
  const s = (typeof sv === 'number' && sv > 0) ? sv : 1;
  return 'left:' + r2(tx + s * (r.x - p)) + 'px;top:' + r2(ty + s * (r.y - p))
    + 'px;width:' + r2(s * (r.w + p * 2)) + 'px;height:' + r2(s * (r.h + p * 2)) + 'px;';
}

/**
 * 拖动体（＝节点本体）在**容器坐标**下的行内 style（★ 第 66 轮）。
 * width/height 给的是**画布尺寸**，靠 transform:scale(sv) 缩到容器上的实际大小 ——
 * 于是 padding / 圆角 / 字号 / 省略号全都自动跟着缩放，不用按 sv 重算一遍。
 */
function ghostBoxStyle(lx, ly, r, sv) {
  return 'left:' + r2(lx) + 'px;top:' + r2(ly) + 'px;width:' + r2(r.w) + 'px;height:' + r2(r.h) +
         'px;transform:scale(' + r2(sv) + ');transform-origin:0 0;';
}

/**
 * **判定点小圆点**在**容器坐标**下的行内 style（★ 2026-10-09）。
 * 只给 `left / top`（＝圆心落点），半径靠 wxss 的负 margin 抵消 —— 见 `.mm-anchor-dot`。
 *
 * ⚠️ 为什么不把它塞进 `.mm-ghost` 里跟着 `scale(sv)` 一起缩：它是一枚**指示器**
 *    （读作光标，告诉用户"系统拿这个点去找父节点"），恒定屏幕尺寸才看得清 ——
 *    缩到 0.5 时 14px 会变成 7px、放到 2.5 时又会肿成 35px 压在节点上。
 *    所以它单独一层，只做**位置**换算、不做尺寸缩放。
 * ⚠️ 位置由三段相加，缺一不可：
 *    `origin`（拖动开始时节点左上角在容器里的基准）
 *    ＋ `delta`（本帧的容器位移，＝手指总位移）
 *    ＋ `sv × (a0 − 节点左上角)`（判定点在节点内的偏移 —— **只有这一段吃缩放**）。
 * ⚠️ `dragSrc` / `dragScope` 挂的是**画布坐标**（父层 `.mm-viewport` 已有 transform），
 *    而拖动体与这个小圆点挂的是**容器坐标**（`.mm-card` 直下）。两套别写串。
 */
function dotStyleOf(origin, delta, r, a0, sv) {
  return 'left:' + r2(origin.x + delta.x + sv * (a0.x - r.x)) + 'px;top:'
    + r2(origin.y + delta.y + sv * (a0.y - r.y)) + 'px;';
}


/* ==========================================================================
   ★★ 171 轮新增 —— **只读视图**（「待办详情 · 关联脑图」卡里那张整图）
   ========================================================================== */

/* 只读卡四周的呼吸（px）—— 只读卡的底色是纯白，图贴着边沿会显得"塞住了"。
   取 10：与卡内其它内边距（12/14）同档，不另起一套。 */
const RO_PAD = 10;

/**
 * **节点**的包围盒（不比画布、不留余量）—— 只读卡"按内容缩放"要的就是它。
 *
 * ⚠️ 别拿 `renderBoxOf` 的结果来缩：那个盒子是"**画布 ∪ 节点** ＋ 48"，
 *    画布本身 1168×722 就比一棵小树大得多 ⇒ 按它算出来的倍率会把图缩成一小撮
 *    （实测 4 个节点的树：旧算法 sv=0.29、图只占卡面一小块；按节点包围盒才是"铺满"）。
 *    详情页那边**要的正是画布盒**（画布尺寸固定、图小就是图小），两处口径不同、
 *    别互相迁就。
 */
function contentBoxOf(L) {
  const ids = Object.keys(L || {});
  if (!ids.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  ids.forEach(function (id) {
    const r = L[id];
    if (r.x < x0) x0 = r.x;
    if (r.y < y0) y0 = r.y;
    if (r.x + r.w > x1) x1 = r.x + r.w;
    if (r.y + r.h > y1) y1 = r.y + r.h;
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * 让一个矩形**整幅装进** `vw × vh`，四周留 `pad` 呼吸（只缩不放）。
 *
 * 与 `fitViewOf` 的差别只有一处：那边按"画布 − 顶部工具栏 − 底部浮条"算安全带，
 * 因为脑图详情画布上浮着两条固定尺寸的工具条；只读卡里**一个浮层都没有**，
 * 所以这里直接拿整块容器当可用区。
 *
 * ⚠️ 只**缩**不**放**（`k ≥ 1` 时回到 100%）：放大会把内容糊掉、也失去"看全貌"的意义。
 * ⚠️ 这里**不套 `VIEW_MIN`（0.2）**：那是"交互画布别缩到没法操作"的地板，
 *    而只读卡的唯一诉求就是**整幅装进去** —— 套上地板，组织结构图/树形那种"竖长"的图
 *    会缩不够（20 个节点实测 0.2 时仍高 270 ＞ 卡的 220）⇒ 上下被 `overflow:hidden` 切掉，
 *    恰好破坏"看全貌"这条唯一的承诺。只留一个防 0 的极小值。
 */
function fitBoxInto(b, vw, vh, pad) {
  if (!b || b.w <= 0 || b.h <= 0) return { sv: 1, tx: 0, ty: 0 };
  const p = pad || 0;
  const aw = Math.max(1, vw - p * 2), ah = Math.max(1, vh - p * 2);
  const k = Math.min(aw / b.w, ah / b.h);
  const sv = (k >= 0.999) ? 1 : Math.max(0.04, k);
  return {
    sv: sv,
    tx: p + (aw - b.w * sv) / 2 - b.x * sv,
    ty: p + (ah - b.h * sv) / 2 - b.y * sv
  };
}

/** 后代总数（含自己）—— `readOnlyView` 数折叠徽标用。
 *  ⚠️ 与 `store.countNodes` **同义**，但它必须是**纯函数**：本模块不许 require store
 *     （那会把一整包 store 拖进无头切片，判据脚本就跑不起来了）。 */
function countSub(n) {
  if (!n) return 0;
  let c = 1;
  (n.children || []).forEach(function (k) { c += countSub(k); });
  return c;
}

/**
 * ★★ **只读视图** —— 待办详情「关联脑图」卡里那张整图。
 *
 * 与 `mod-mindmap.refresh()` 的渲染段**同源同码**：同一份 `metricsMap` / `layoutOf` /
 * `buildNodes` / `buildLinksUri` ⇒ 形状、字号、底色、连线走法**逐值相同**。
 * 差别全是**减法**，一条"新画法"都没有：
 *   · 不做手势 —— 不接管 touch / wheel / mouse，节点上的 `sel` 恒为空串；
 *   · 不自适应"浮层安全带" —— 只读卡里没有工具栏与浮条（见 `fitBoxInto`）；
 *   · 画布尺寸由**调用方**给（卡内实测宽高），而不是 `CANVAS`；
 *   · 折叠徽标照画（它说的是"这一支里还藏着几个"），但**不可点**。
 *
 * ⇒ 用户口径：「和脑图详情的区别是这个窗口看脑图无法移动脑图位置、无法编辑、
 *    也不能缩放，就是单纯的看」。
 *
 * @param root   完整树（`store.ensureTree(id)`）
 * @param format 六种格式之一（`store.formatKeyOf(m)`）
 * @param opt    `{ landscape, w, h }` —— w/h 是**卡内实测**的宽高（px）
 * @return       `{ nodes, linksUri, linksStyle, vpStyle, sv, box }`；树空时返回 null
 */
function readOnlyView(root, format, opt) {
  const o = opt || {};
  const land = !!o.landscape;
  const cv = land ? CANVAS.land : CANVAS.port;
  const vw = Math.max(1, o.w || cv.w);
  const vh = Math.max(1, o.h || cv.h);
  if (!root) return null;

  const fmt = format || 'mindmap';
  const vt = visibleTree(root);                      // 折叠态照剪（与详情页同一棵）
  const M = metricsMap(vt, land);
  const L = layoutOf(vt, land, fmt, M) || {};
  if (!Object.keys(L).length) return null;

  /* 折叠徽标：挂侧 ＝ **出边方向**（`foldSideOf`，与详情页同一口径），数字从**完整树**数
     —— 与 refresh() 那几行同一个口径，理由见 `foldSideOf` 的函数头。 */
  const foldCount = {};
  (function walkFold(n) {
    if (n.collapsed) foldCount[n.id] = Math.max(0, countSub(n) - 1);
    (n.children || []).forEach(walkFold);
  })(root);
  const foldSides = foldSideOf(root, L, fmt);

  const box = renderBoxOf(L, cv);
  const cb = contentBoxOf(L);
  const v = fitBoxInto(cb, vw, vh, RO_PAD);

  return {
    /* `sel` 传空串 ⇒ 一个选中态都不渲染（只读：没有"当前选中"这回事） */
    nodes: buildNodes(vt, '', L, M, foldSides, foldCount),
    linksUri: buildLinksUri(vt, land, L, fmt).uri,
    linksStyle: boxLayerStyle(box),
    /* 变换层的尺寸 ＝ 渲染盒；transform 与详情页**同一个函数**（先平移、后缩放，原点锁左上角） */
    vpStyle: 'width:' + box.w + 'px;height:' + box.h + 'px;'
      + stageStyleOf(r2(v.sv), r2(v.tx), r2(v.ty)),
    sv: r2(v.sv),
    box: box,
    content: cb
  };
}

module.exports = {
  CANVAS: CANVAS,
  MM_CHROME_H: MM_CHROME_H,
  MM_CHROME_H_LAND: MM_CHROME_H_LAND,
  syncPortCanvasH: syncPortCanvasH,
  syncLandCanvasH: syncLandCanvasH,
  VIEW_MIN: VIEW_MIN,
  /* ★★ 2026-10-24（复审 P2-14）：「适应屏幕」的专用下限 ＋ 对应的钳制函数。
     组件那一侧要靠它把 fit 出来的低比例**原样应用**（`applyView` 的第四个参数）。 */
  VIEW_FIT_MIN: VIEW_FIT_MIN,
  clampViewFit: clampViewFit,
  VIEW_MAX: VIEW_MAX,
  HOLD_MS: HOLD_MS,
  DRAG_PX: DRAG_PX,
  TAP_PX: TAP_PX,
  TAP_MS: TAP_MS,
  PAN_STEP: PAN_STEP,
  ZOOM_STEP: ZOOM_STEP,
  WHEEL_K: WHEEL_K,
  DRAG_C: DRAG_C,
  PARENT_PAD: PARENT_PAD,
  DROP_TOL: DROP_TOL,
  DROP_STEP: DROP_STEP,
  EDGE_PX: EDGE_PX,
  SCOPE_PAD: SCOPE_PAD,
  ADD_TEXT: ADD_TEXT,
  VOICE_SEC: VOICE_SEC,
  VOICE_SEND_SEC: VOICE_SEND_SEC,
  VOICE_RESTART_GAP: VOICE_RESTART_GAP,
  VOICE_UP_MS: VOICE_UP_MS,
  VOICE_STUB: VOICE_STUB,
  fmtSec: fmtSec,
  REC_IN_TOOLS: REC_IN_TOOLS,
  isDevtools: isDevtools,
  rectWithCx: rectWithCx,
  ZONE_GAP_MIN: ZONE_GAP_MIN,
  dropBoxOf: dropBoxOf,
  zoneMapOf: zoneMapOf,
  hostOf: hostOf,
  pickParentId: pickParentId,
  slotIndexOf: slotIndexOf,
  slotMarkOf: slotMarkOf,
  SLOT_GAP: SLOT_GAP,
  anchorOf: anchorOf,
  coverOf: coverOf,
  COVER_MIN: COVER_MIN,
  PAD: PAD,
  MM_FS: MM_FS,
  LH: LH,
  WRAP_EM: WRAP_EM,
  NODE_PAD: NODE_PAD,
  NODE_MIN_W: NODE_MIN_W,
  /* ★ 275b：图块几何的三个常量 —— 判据靠它们与 wxss / 行内 style 对撞 */
  PIC_MIN_H: PIC_MIN_H,
  PIC_MAX_H: PIC_MAX_H,
  PIC_GAP: PIC_GAP,
  PIC_MIN_W: PIC_MIN_W,
  PIC_AR_DEF: PIC_AR_DEF,
  picBoxOf: picBoxOf,
  V_GAP: V_GAP,
  H_GAP: H_GAP,
  H_GAP_MM: H_GAP_MM,
  H_GAP_ORG: H_GAP_ORG,
  ORG_V: ORG_V,
  TREE_IND: TREE_IND,
  FISH_GAP_X: FISH_GAP_X,
  FISH_HEAD: FISH_HEAD,
  FISH_SPINE: FISH_SPINE,
  FISH_STUB: FISH_STUB,
  FISH_SLOPE: FISH_SLOPE,
  oOf: oOf,
  dOf: dOf,
  fsOf: fsOf,
  emOf: emOf,
  textEm: textEm,
  NO_HEAD: NO_HEAD,
  wrapText: wrapText,
  metricsOf: metricsOf,
  metricsMap: metricsMap,
  visibleTree: visibleTree,
  leafCount: leafCount,
  padOf: padOf,
  rectOf: rectOf,
  placeAll: placeAll,
  cascade: cascade,
  treeCascade: treeCascade,
  colFn: colFn,
  parentFn: parentFn,
  layoutLogic: layoutLogic,
  layoutTree: layoutTree,
  layoutOrg: layoutOrg,
  layoutTimeline: layoutTimeline,
  layoutFishbone: layoutFishbone,
  layoutMindmap: layoutMindmap,
  layoutOf: layoutOf,
  FOLD_D: FOLD_D,
  FOLD_GAP: FOLD_GAP,
  FOLD_KISS: FOLD_KISS,
  foldSideOf: foldSideOf,
  foldStyleOf: foldStyleOf,
  buildNodes: buildNodes,
  linesPayload: linesPayload,
  ghostPayload: ghostPayload,
  CORNER: CORNER,
  LINK_C: LINK_C,
  LINK_W: LINK_W,
  LINK_HL_W: LINK_HL_W,
  treeLink: treeLink,
  elbowTB: elbowTB,
  boneLink: boneLink,
  ribStub: ribStub,
  BUS_GAP: BUS_GAP,
  elbowLR: elbowLR,
  curveLR: curveLR,
  decorLines: decorLines,
  linkPath: linkPath,
  renderBoxOf: renderBoxOf,
  boxLayerStyle: boxLayerStyle,
  buildLinksUri: buildLinksUri,
  buildDragLinkUri: buildDragLinkUri,
  stageStyleOf: stageStyleOf,
  clampView: clampView,
  r2: r2,
  dist2: dist2,
  SAFE_T: SAFE_T,
  SAFE_B: SAFE_B,
  fitViewOf: fitViewOf,
  boxStyle: boxStyle,
  boxStyleInCard: boxStyleInCard,
  ghostBoxStyle: ghostBoxStyle,
  dotStyleOf: dotStyleOf,
  fitBoxInto: fitBoxInto,
  contentBoxOf: contentBoxOf,
  countSub: countSub,
  RO_PAD: RO_PAD,
  readOnlyView: readOnlyView
};
