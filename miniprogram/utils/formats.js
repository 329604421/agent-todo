/**
 * 脑图格式目录（★ 本轮新增 · FR-7.6）
 *
 * 一张脑图的**排版格式** —— 六种，决定「节点怎么摆、连线怎么走」。
 * 数据层只存一个 key（`mindmap.format`），排版算法在 `components/mod-mindmap/mod-mindmap.js`，
 * 这个文件只负责**目录与缩略图**这一层，供三处共用：
 *   · 脑图新建 / 编辑表单里的「格式」字段（components/form-drawer）
 *   · 脑图列表抽屉卡片上的格式名（utils/drawers）
 *   · 核验脚本切格式（`mod-mindmap.setFormat()`）
 * ⚠️ ★ 第 81 轮：画布顶部那个**「格式」主弹窗（components/format-drawer）已取消** ——
 *   用户口径「原有的'格式'及其抽屉取消，编辑中本身就有格式调整功能」。
 *   ⇒ 格式的**用户侧唯一入口**是上面那条「脑图表单里的格式字段」；
 *     组件目录 `components/format-drawer/` 已移入归档（不是删除）。
 * ⇒ 加一种格式 = 这里加一行 ＋ mod-mindmap 里补一个 layout，别处都不用动。
 *
 * ⚠️ 缩略图是**现算的 SVG data-URI**（与画布连线层 `buildLinksUri` 同一个套路）——
 *   小程序里没有 DOM，图标只能走 <image src>；现算的好处是不用往 assets 里塞 6 张 png，
 *   也不会有"换配色忘了换图"的问题。
 * ⚠️ 缩略图画的是**结构示意**（谁跟谁连、往哪个方向展开），不是真实节点数 ——
 *   它要在 48×34 里被认出来，所以只放 1＋3 / 1＋4 个方块。
 *   ★ 六张图的形状**必须与实装的排版/连线口径一致**，校准工具见下方「缩略图」段。 */

/** 六种格式 —— `key` 是存储值，一旦定下不要改（改 key 等于把老数据全变成未知格式） */
const LIST = [
  { key: 'mindmap',  label: '思维导图',   desc: '根节点居中，分支向左右两侧分布' },
  { key: 'logic',    label: '逻辑图',     desc: '根在左，子节点向右逐层展开' },
  { key: 'org',      label: '组织结构图', desc: '根在上，子节点向下分层展开' },
  { key: 'tree',     label: '树形图',     desc: '根在左上，子节点向右缩进分层' },
  { key: 'timeline', label: '时间轴',     desc: '根在顶，一级节点沿竖轴左右交替' },
  { key: 'fishbone', label: '鱼骨图',     desc: '鱼头在左，主脊向右，上下交替斜插' }
];

/** 新建脑图的默认格式 —— 用户口径「默认为标准脑图」，即六个格式里的第一个 */
const DEFAULT_KEY = 'mindmap';

/* ==========================================================================
   缩略图（48 × 34 · 结构示意 · ★ 第 74 轮按实装口径重新校准）
   ==========================================================================

   ⚠️ 这六张是**照着排版与连线口径手绘的示意**，不是排版结果的等比缩小
      （缩略图要在 48×34 里被认出来，节点一律画成小方块、根一律 12×6）。
      所以校准判据是：【拓扑 / 展开方向 / 连线走法】三件事必须与实装一致。
      ★ 校准工具 = `工具/render_thumbs.js`：左＝真实排版（同款小树跑 layoutOf），
        右＝缩略图 6× 并排。**改过任何一个 layoutXxx / linkPath 之后都要重跑它。**

   同一张图两处展示、缩放比差很多，形状必须"粗"到最小那档还认得出：
     · form-drawer 脑图表单的格式字段 … 48×34
     · drawer 脑图列表卡的格式气泡 …… **20×14** ← 最严苛，只靠**整体轮廓**认
   （★ 第 81 轮：原来还有第三处「format-drawer 格式弹窗 48×34」，那个弹窗已取消。）

   连线四种走法，与 `linkPath` 的分派**一一对应**（改实装就要回来改这里）：
     curveLR → mindmap / logic   三次贝塞尔，两个控制点都落在**水平中点**上
     elbowLR → tree / timeline   父底中竖落，拐圆角后横到子节点**近侧边**
     elbowTB → org               父底中竖落 → 横向总线 → 再竖落到子节点**顶中**
     line    → fishbone 的「骨」 从**主脊**斜拉到一级节点的**近脊边**（不钻中心）；
                                   一级再往下的二级**横伸短枝挂在骨线上**，三级起走 elbowLR

   ⚠️ 第 74 轮校准出的四处偏差（旧图 → 现图）：
      logic    旧画成直角折线 …… 实装是**贝塞尔曲线**（曲线并成一束再散开）
      tree     旧是"根在左中 + 斜直线" … 实装是**根在左上 · 竖总线 · 直角短枝 · 向右缩进**
      timeline 旧是**横轴**、里程碑挂在轴下 … 实装是**竖轴 · 一级左右交替**
      fishbone 旧把鱼头画在**右**边、骨线一律朝左 … 实装**鱼头在左**、骨线一律**朝右**斜插
   ========================================================================== */

/* ★★ 审查-02 P1-16（2026-10-14）：三色**改为按当前主题现取** ──────────────
   照 `mindmap-core.js` 的 `linkC()` 先例：`try { require('./theme') }` 包住主题出口，
   拿不到（Node 切片 / 旧宿主）回落浅色基线 ⇒ 判据侧零改动、浅色逐值不变。
   为什么必须改：缩略图原先是**模块加载时算一次**的常量，颜色钉死 —— 深色模式打开
   脑图列表抽屉 / 编辑抽屉时，主墨根块（#1C1C1E）画在 #202123 卡底上对比 ≈ 1.06
   （等于没有），白叶块成一粒粒白点，整张小图读不出结构。
   ⚠️ 三个 `C_*` 由 `const` 改 `let`：`thumbs()` 每次按主题重新赋值再用（见下），
      六张图的坐标一个都没动。 */
let C_LINE = '#C7CAD5';   // 连线灰（与画布连线层的中性灰同源）
let C_ROOT = '#1C1C1E';   // 根节点＝主墨实心
let C_LEAF = '#FFFFFF';   // 其余节点＝白底描边
/* ⚠️ 根**有意**用主墨而不是品牌黄（画布上根是黄实心）：它在列表卡上只有 20×14，
   而那一格正是偏黄的卡面，黄块压黄底会糊掉；主墨在三种底色上都立得住。 */

/** 当前主题下的三色；无 `wx` / 无 theme 模块 ⇒ 回落浅色基线 */
function palette() {
  try {
    const t = require('./theme');
    if (t && typeof t.thumbColors === 'function') return t.thumbColors();
  } catch (e) { /* Node 切片 / 旧宿主：保持浅色基线 */ }
  return { line: C_LINE, root: C_ROOT, leaf: C_LEAF };
}

const ROOT_W = 12, ROOT_H = 6;   // 根节点尺寸（对应画布上"根最大"的层级感）
const LEAF_W = 10, LEAF_H = 5;   // 其余节点尺寸
const R_ELBOW = 2;               // 折线拐角半径

/** 坐标取一位小数 —— 手写坐标难免有 8.5 / 26.5 这种，全量小数会把 data-URI 撑长 */
function nz(v) { return Math.round(v * 10) / 10; }

function box(x, y, w, h, fill, stroke) {
  const s = stroke === false ? '' : ' stroke="' + (stroke || C_LINE) + '" stroke-width="0.7"';
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h +
         '" rx="1.4" fill="' + fill + '"' + s + '/>';
}
function wire(d) { return '<path d="' + d + '" fill="none" stroke="' + C_LINE + '" stroke-width="1"/>'; }
function line(x1, y1, x2, y2) { return 'M' + nz(x1) + ' ' + nz(y1) + ' L' + nz(x2) + ' ' + nz(y2); }

/** 曲线（mindmap / logic）—— 与 `curveLR` 同式：控制点落在水平中点 ⇒ 中间近乎竖直 */
function curve(x1, y1, x2, y2) {
  if (Math.abs(y1 - y2) < 0.5) return line(x1, y1, x2, y2);
  const mx = nz((x1 + x2) / 2);
  return 'M' + nz(x1) + ' ' + nz(y1) + ' C' + mx + ' ' + nz(y1) + ' ' + mx + ' ' + nz(y2) +
         ' ' + nz(x2) + ' ' + nz(y2);
}

/** 直角短枝（tree / timeline）—— 与 `treeLink` 同式：竖落 → 圆角 → 横走 */
function elbowLR(bx, y1, ex, y2) {
  const s = ex > bx ? 1 : -1, v = y2 > y1 ? 1 : -1;
  if (Math.abs(ex - bx) < 0.5) return line(bx, y1, bx, y2);
  const r = Math.min(R_ELBOW, Math.abs(ex - bx), Math.abs(y2 - y1));
  return 'M' + nz(bx) + ' ' + nz(y1) +
    ' L' + nz(bx) + ' ' + nz(y2 - v * r) +
    ' Q' + nz(bx) + ' ' + nz(y2) + ' ' + nz(bx + s * r) + ' ' + nz(y2) +
    ' L' + nz(ex) + ' ' + nz(y2);
}

/** 直角折线（org）—— 与 `elbowTB` 同式：竖落 → 横向总线 → 竖落 */
function elbowTB(x1, y1, x2, y2) {
  if (Math.abs(x2 - x1) < 0.5) return line(x1, y1, x2, y2);
  const s = x2 > x1 ? 1 : -1, my = nz((y1 + y2) / 2);
  const r = Math.min(R_ELBOW, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2);
  return 'M' + nz(x1) + ' ' + nz(y1) +
    ' L' + nz(x1) + ' ' + nz(my - r) +
    ' Q' + nz(x1) + ' ' + my + ' ' + nz(x1 + s * r) + ' ' + my +
    ' L' + nz(x2 - s * r) + ' ' + my +
    ' Q' + nz(x2) + ' ' + my + ' ' + nz(x2) + ' ' + nz(my + r) +
    ' L' + nz(x2) + ' ' + nz(y2);
}

function uri(inner) {
  return 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="34" viewBox="0 0 48 34">' + inner + '</svg>'
  );
}

/* 六张缩略图 —— **按当前主题现算**（三色签名没变就复用上一次的结果，不重复拼 data-URI）。
   ★ 审查-02 P1-16：原先这里是**模块级常量** ⇒ 主题切了也不会变（深色下读不出结构）。
   ⇒ 现在每次 `list()` / `byKey()` 都过一道这里；浅色下重建出的字符串与改动前**逐字节相同**。 */
let _THUMB = null;
let _THUMB_SIG = '';

function thumbs() {
  const p = palette();
  const sig = p.line + p.root + p.leaf;
  if (_THUMB && _THUMB_SIG === sig) return _THUMB;
  C_LINE = p.line; C_ROOT = p.root; C_LEAF = p.leaf;
  _THUMB_SIG = sig;
  _THUMB = {
    /* 思维导图：根**居中**，一级按叶子数分成两列（左 2 右 2），曲线向两侧外扩 */
    mindmap: uri(
      wire(curve(18, 17, 13, 8.5)) + wire(curve(18, 17, 13, 25.5)) +
      wire(curve(30, 17, 35, 8.5)) + wire(curve(30, 17, 35, 25.5)) +
      box(3, 6, LEAF_W, LEAF_H, C_LEAF) + box(3, 23, LEAF_W, LEAF_H, C_LEAF) +
      box(35, 6, LEAF_W, LEAF_H, C_LEAF) + box(35, 23, LEAF_W, LEAF_H, C_LEAF) +
      box(18, 14, ROOT_W, ROOT_H, C_ROOT, false)
    ),
    /* 逻辑图：根在左（纵向居中），一级在**同一列**（层坐标）上下排开，曲线并成一束再散开
       ★ 第 76 轮：整幅**水平居中** —— 旧图根 x=2、叶 x=21 ⇒ 内容 2–31、中心 16.5，
         比画布中心 24 偏左 7.5px（六张里唯一一张偏的）。现整体右移 7.5：
         内容 9.5–38.5、中心 24。⚠️ 只挪 x，y 本来就在中（5–29、中心 17 = 34/2）。 */
    logic: uri(
      wire(curve(21.5, 17, 28.5, 7.5)) + wire(curve(21.5, 17, 28.5, 17)) + wire(curve(21.5, 17, 28.5, 26.5)) +
      box(28.5, 5, LEAF_W, LEAF_H, C_LEAF) + box(28.5, 14.5, LEAF_W, LEAF_H, C_LEAF) + box(28.5, 24, LEAF_W, LEAF_H, C_LEAF) +
      box(9.5, 14, ROOT_W, ROOT_H, C_ROOT, false)
    ),
    /* 组织结构图：根在顶、对着**子节点跨度**居中，横向总线把三支挂到下一层 */
    org: uri(
      wire(elbowTB(24, 8, 8, 24)) + wire(elbowTB(24, 8, 24, 24)) + wire(elbowTB(24, 8, 40, 24)) +
      box(3, 24, LEAF_W, LEAF_H, C_LEAF) + box(19, 24, LEAF_W, LEAF_H, C_LEAF) + box(35, 24, LEAF_W, LEAF_H, C_LEAF) +
      box(18, 2, ROOT_W, ROOT_H, C_ROOT, false)
    ),
    /* 树形图：根在**左上**，竖总线从根底中垂下，一级逐级**向右缩进**、直角短枝 */
    tree: uri(
      wire(elbowLR(17, 8, 27, 12.5)) + wire(elbowLR(17, 8, 27, 19.5)) + wire(elbowLR(17, 8, 27, 26.5)) +
      box(27, 10, LEAF_W, LEAF_H, C_LEAF) + box(27, 17, LEAF_W, LEAF_H, C_LEAF) + box(27, 24, LEAF_W, LEAF_H, C_LEAF) +
      box(11, 2, ROOT_W, ROOT_H, C_ROOT, false)
    ),
    /* 时间轴：根在**顶部**，竖轴往下，一级**左右交替**挂载
       （⚠️ 旧图是横轴、里程碑挂在轴下 —— 与实装差得最远的一处） */
    timeline: uri(
      wire(elbowLR(24, 9, 29, 12.5)) + wire(elbowLR(24, 9, 19, 20)) + wire(elbowLR(24, 9, 29, 27.5)) +
      box(29, 10, LEAF_W, LEAF_H, C_LEAF) + box(9, 17.5, LEAF_W, LEAF_H, C_LEAF) + box(29, 25, LEAF_W, LEAF_H, C_LEAF) +
      box(18, 3, ROOT_W, ROOT_H, C_ROOT, false)
    ),
    /* 鱼骨图（★ 第 77 轮重画）：主脊横贯；**两根长骨**从主脊斜拉出去，
       一级节点落在骨线**远端**（上支顶到上沿、下支顶到下沿）；
       二级**串在骨线上**（横伸短枝），三级起再往右生长。
       ⚠️ 与 73 轮那版的差别：骨线是**长直线**（不再是从主脊斜插一小截），
          一级在**骨线尽头**（不再贴主脊），二级挂在**骨线上**（不再挂父节点）。 */
    fishbone: uri(
      wire(line(12, 17, 47, 17)) +
      wire(line(15, 17, 26, 5)) + wire(line(28, 17, 39, 29)) +
      wire(line(20.5, 11, 23, 11)) + wire(line(33, 11, 35.5, 11)) +
      wire(line(33.5, 23, 37, 23)) +
      box(35.5, 8.5, LEAF_W, LEAF_H, C_LEAF) + box(23, 8.5, LEAF_W, LEAF_H, C_LEAF) +
      box(37, 20.5, LEAF_W, LEAF_H, C_LEAF) +
      box(21, 0, LEAF_W, LEAF_H, C_LEAF) + box(34, 29, LEAF_W, LEAF_H, C_LEAF) +
      box(1, 14, ROOT_W, ROOT_H, C_ROOT, false)
    )
  };
  return _THUMB;
}

/* ---------------- 对外 ---------------- */

/** 六种格式（带缩略图）—— 每次都返回新对象，调用方随手改 selected 不会污染目录 */
function list() {
  const T = thumbs();
  return LIST.map(function (f) {
    return { key: f.key, label: f.label, desc: f.desc, thumb: T[f.key] || '' };
  });
}

/** 取一种格式；key 认不出来（老数据 / 手改）一律落到默认格式，不让画布空着 */
function byKey(key) {
  const T = thumbs();
  const hit = LIST.filter(function (f) { return f.key === key; })[0];
  const f = hit || LIST[0];
  return { key: f.key, label: f.label, desc: f.desc, thumb: T[f.key] || '' };
}

function defaultKey() { return DEFAULT_KEY; }
function labelOf(key) { return byKey(key).label; }

module.exports = {
  list: list, byKey: byKey, labelOf: labelOf,
  defaultKey: defaultKey, DEFAULT_KEY: DEFAULT_KEY
};
