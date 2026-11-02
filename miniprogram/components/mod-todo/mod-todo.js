/**
 * 待办模块（★ V8 新增页面 · FR-3.8 待办详情页）
 *
 * 形态：列表 ／ 详情 二态（FR-8）
 *   · 点导航「待办」→ 有记忆就直接看那条详情；没记忆 → 空态 ＋ 自动弹列表抽屉
 *   · 在详情里再点一次「待办」→ 弹列表抽屉换一条
 *   · 创建 / 编辑 / 导出 走表单抽屉（FR-3.6 / FR-3.9 / FR-3.11 · D-4 定案）
 *
 * ★ 09-22 第四十三轮（待办页专项）—— 这一页的重心变了：
 *   · **补回详情顶栏**（标题＝文本首行 ＋ 紧急程度徽章 ＋ 完成态）。
 *   · **删掉「紧急程度」四档可点选择器**（"编辑页感"的根因），改档统一走「编辑」。
 *   · **新增「交给 agent 的文本」**：原文 ＋ 关联脑图序列化 Markdown 的拼接结果 ＋ 一键复制
 *     （FR-3.11）。这是本产品的主出口 —— 用户复制走人，粘贴给 agent。
 *   · 操作栏收敛成 完成 / 编辑 / 删除，一律 44 高（P-6 触控目标）。
 *
 * ★ 09-22 第四十四轮：
 *   · 顶栏卡片搬进第一个区块（「待办原文」→「待办信息」）；卡内「待办列表」按钮删掉。
 *   · 「交给 agent 的文本」→「适配 agent 文本」，搬到操作区下方整宽。
 *   · 「关联脑图」无关联时整块不渲染；操作栏完成键标签固定「完成」。
 *
 * ★ 09-22 第四十五轮（第三批 7 条走查）：
 *   · **「待办信息」两张卡合并成一张**：详情头的标题本来就是正文首行，两张卡是同一段话出现
 *     两遍。现在正文直接住在详情头里（卡内滚动、可长按选中），页面上不再有第二个「原文」。
 *   · **页内的「适配 agent 文本」整块搬进抽屉**：它成了一段长预览＋开关＋按钮，摆在详情页
 *     末尾既喧宾夺主又让页面像工作台；改成**导出抽屉**（`form-drawer` 的 mode=export），
 *     操作区补一颗「导出」按钮 —— 详情页负责"看"，带走文本这件事走抽屉。
 *   · 待办表单里点「新建项目」改为在右侧开**第二个表单抽屉**（form2），本层侧转不可点。
 *
 * ★ 09-23 第八十二轮（第六批 5 条）：
 *   · **区块顺序**（用户口径）：待办信息 → 所属项目 → 图片 → 关联脑图 → 操作。
 *   · 「所属项目」从一行字升级成**项目详情那张「基础信息」卡**（皮肤住 app.wxss，两页共用）。
 *   ★★ 第一百六十二轮：那张卡与项目详情**同步重排** —— 卡内原来"一排四格"改成
 *      **两个带小标题的组**（「项目概要」在上前、「所属 agent」在后下），
 *      概要三数（未完成待办 / 已完成待办 / 项目脑图）改走 `store.projectSummary()` 这一处真源。
 *   · 「关联脑图」常显 ＋ 「关联 / 查看」两颗键；「关联」开 `drawer` 主弹窗（含「＋ 新建脑图」）。
 *   · 待办列表主弹窗底部补「＋ 创建待办」；待办**创建**表单里删掉「关联脑图」字段。
 *   · 品牌 logo（横屏导轨底部 / 竖屏右下）不再触发创建待办（`pagebase.onBrand` 已删）。
 *
 * 详情页结构（第八十二轮起）：
 *   单栏 760（竖屏 768），不再分 col-main / col-side：
 *     待办信息 → 所属项目 → 图片 → 关联脑图 → 操作
 *   抽屉：待办列表（主）／ 脑图选择（主）／ 导出（export）／ 待办表单（L1 → L2）
 *
 * 横屏：内容 1168，单栏靠左（76 轮之前是 左主区 flex:1（≈700）＋ 右栏 456）
 * 竖屏：竖向堆叠（DOM 顺序＝阅读顺序），内容宽 768
 *
 * ★★ 2026-10-12 第一百七十轮（用户在真机上走查后提的两条 · 口径详见 wxml 顶部注释）：
 *   · 「关联脑图」的卡面重做 —— **整张脑图**顶上来（`utils/mindmap-preview.js` 按真实树
 *     现算的只读 SVG，不可缩放 / 不可编辑），「查看」键撤掉、「关联」在有图时叫「替换」、
 *     空态那颗键从"卡内小键 28"升到"**卡内大键 40**"（`app.wxss` 的 `.tb-btn.lg`）。
 *   · 新增 `ensureMindmapTree()` —— 卡上要画的是"**真树**"，而这棵树在真数据态是按需拉的。
 *
 * ★★ 2026-10-12 第一百七十一轮（用户否掉了 170 轮那条实现路线 · 口径详见 wxml 顶部注释）：
 *   · 用户原话：「**不用再进行 svg 转换，就是将思维导图显示在里面就可以了**，和脑图详情的
 *     区别是这个窗口看脑图**无法移动脑图位置、无法编辑、也不能缩放**，就是单纯的看」。
 *   · ⇒ 170 轮那个"另画一张简化 SVG"（`utils/mindmap-preview.js`）**整条撤掉**
 *     （文件移入 `归档/`），改成**直接把脑图画布的内容层搬进来**：
 *     度量 / 排版 / 连线取 `utils/mindmap-core.js`（**脑图模块 require 的也是它**），
 *     节点皮肤取 `components/mod-mindmap/mm-canvas.wxss`（两个组件各自 @import）。
 *     "同一种画法"因此是**同一份实现**，不是"照着描得像"。
 *   · 新增 `paintMindmap()` ＋ `measureCard()`：只读整图要按"整幅装进卡内"算倍率，
 *     而卡内宽度横屏一档、竖屏一档（187 轮定死为**设计宽** `728` / `736`）。
 *
 * ★★ 2026-10-13 第一百八十七轮（用户真机走查：切到待办详情时"关联脑图"那块**抖动/闪烁**）：
 *   · 根因两条，都在"图比卡片晚一帧"上：
 *     ① `packDetail()` 里 `view` 恒为 `null`，真值由 `setData` **回调**里补画
 *        ⇒ 每一轮 `refresh` 都会先落地一帧"卡里没有 `.ro-canvas`"的版式（卡内少 240px、
 *        下面几块整体上移），下一帧图到了再撑回来。切一次模块闪一次，就是这么来的。
 *     ② 量到的宽是**屏幕物理像素**，而它是设计宽 × `s`（`.stage` 的 `transform: scale(s)`）
 *        ⇒ 排版按物理像素算、再被外层缩一次，图会小 `s` 倍，且首帧兜底档与它差得远 ⇒ 多跳一次。
 *   · ⇒ ①  `view` 改由 `packDetail()` **同步**算（`readOnlyView()` 本来就是同步纯函数）；
 *          ②  `.ro-canvas` **恒占位**（`wx:if` 下移到 `.ro-vp` 层，见 wxml）；
 *          ③  `measureCard()` 量到后 **÷ `s`** 换回设计宽；兜底档补上原先漏算的 4px 边框
 *              ⇒ 首帧即终版、正常情况下**一次都不重画**；
 *          ④  转屏走 `afterLayout()`（重排那条路不刷数据），方向换了先作废 `_roW` 再重画。
 */
const store = require('../../utils/store');
const pub = require('../../utils/pagebase');
const forms = require('../../utils/forms');
const api = require('../../utils/api');
/* ★★ 230 轮：详情页「图片」卡里那颗「从相册选择 / ＋ 添加图片」走的链路 ——
   与表单抽屉**同一份实现**（230 轮把三条私有函数从 form-drawer 提到 `utils/imgpick.js`）。 */
const imgpick = require('../../utils/imgpick');
/* ★★ 187 轮：上游缩放 `s` —— 量 `.ro-canvas` 时要把**屏幕物理像素**换回**设计宽**，
   而 `.ro-canvas` 长在 `.stage` 的 `transform: scale(s)` 里 ⇒ `s` 只能从 `stage` 问。
   ⚠️ 这条依赖**不是新加的**：`mindmap-core.js` 顶层就 require 了 `stage`
      （`syncPortCanvasH` / `syncLandCanvasH` 在模块加载时各跑一次）⇒ 它本来就在链上。 */
const stage = require('../../utils/stage');
/* ★★ 171 轮：脑图的**纯核心**（`utils/mindmap-core.js`）—— 与脑图模块**同一份**实现。
   「关联脑图」卡里那张只读整图走它的 `readOnlyView()`：形状 / 字号 / 底色 / 连线走法
   与脑图详情逐值相同，差别只有三条减法（不能移 / 不能编 / 不能缩）。 */
const mmc = require('../../utils/mindmap-core');

/* 只读画布的两条尺寸（★ 171 轮；★★ 187 轮改宽度口径）——
   · `RO_H` ＝ 卡内高度（≡ `mod-todo.wxss` 的 `.ro-canvas { height: 240px }`，**两处成对**）；
   · 宽度**必须按卡内真实宽算**：横屏平板与竖屏差一档，写死任何一档都会在别的档上
     "图没铺满"或"图被切掉"。
     ── 单位是**设计宽**，不是屏幕像素（★★ 187 轮修）：`.ro-canvas` 长在 `.stage` 的
        `transform: scale(s)` 里，`boundingClientRect` 给的是**物理像素** ⇒ 物理 ÷ s
        才是设计宽。171/186 那两版把物理宽直接喂给 `readOnlyView(w)`，等于"按屏幕像素排版、
        再被外层缩一次" ⇒ **图比该有的小 s 倍**（s＝1 的机器上恰好一模一样，所以一直没露）。
        同一条换算在 `mod-mindmap.measure()` 里早就写着（`s = r.width / (w * sv)`），照抄它的口径。
   · `RO_W_FALLBACK` 是**量到之前**第一帧用的估计值 —— 与实测同单位（设计宽），
     两者只差几像素的边框（见下），所以正常情况下**第一帧就是终版、一次都不重画**。
   ⚠️ 兜底值必须与 `.side-card` 的**内容宽**同源，算式（横屏 760 / 竖屏 768 是单栏设计宽）：
        `.split` 760（竖屏 768）− 卡边框 2 − 卡内边距 28 − 画布边框 2
        ⇒ 横屏 **728**、竖屏 **736**。
      171 轮写的 732/740 漏了"卡边框 ＋ 画布边框"那 4px（差 0.5%，肉眼看不出来，
      但会让首帧与实测差 >1px ⇒ 白白多一次重画）。 */
const RO_H = 240;
const RO_W_FALLBACK = { land: 728, port: 736 };

/**
 * ★★ 2026-10-23（247 轮追加）：在一串**图片行**里找"屏幕上被点的那一张"的**下标**。
 *
 * 用户口径：「已将添加完成的图片，点击右上角的『移除』按钮后，**总是第一次点击并确定移除后
 * 仍然没有反应，再次操作的时候才起效**」。
 *
 * ── 根因（整条链都在代码里，不是偶发） ───────────────────────────────
 * ① 后端 `imageRows()` 明写「**id 一律由服务端生成，不采信客户端传的 id**」，而且
 *    `PATCH /todos/:id` 里图片是 `deleteMany ＋ create`（整批重建）⇒ **每写一次，全部图片行的 id 换一批**。
 * ② 前端 `onAddImage` 先落一个**本地 id**（`'i' + Date.now()`）好让界面立刻出格，
 *    再发 PATCH；回执走 `queue()` 的 `mergeOne()` ⇒ store 里那条被换成服务端版本（id 已换）。
 * ③ `mergeOne()` **不通知任何组件重画** ⇒ `this.data.detail` 里还留着旧 id。
 * ④ 于是"加完图立刻点 ✕"：拿**旧 id** 去 store 的新数组里找 → 一个都不匹配 →
 *    走"已被别处移走"那条**静默分支**（`refresh()` 一下就返回）⇒ 肉眼看**完全没反应**。
 *    而那一下 `refresh()` 正好把 `detail` 重建成新 id ⇒ **第二次点才生效**。
 *    （这就是"总是第一次不灵"的来路：每次写库都会让 detail 的 id 落后一版。）
 *
 * ── 结论：拿 `uri` 当身份 ────────────────────────────────────────────
 * `uri` 在服务端只是**原样回存**（`uri: String(img.uri || '').trim()`），加图 / 删图 / 换序都不变
 * ⇒ 它在"详情快照"与"store 真值"两侧永远一致。只有 `uri` 为空的行（mock 占位 / 还没传完）
 * 才退回比 id —— 那时必须要求 id 非空，否则两串 `undefined` 会相等、认错第一张。
 *
 * ⚠️ 只返回**第一个**命中：同一次上传两张一样的图时 uri 可能撞（极少），
 *    用 `filter` 会一次删两张 —— 用户只点了一下。
 */
function findImage(list, want) {
  if (!want || !list || !list.length) return -1;
  let i;
  if (want.uri) {
    for (i = 0; i < list.length; i++) {
      if (String(list[i].uri) === String(want.uri)) return i;
    }
  }
  const hasId = !(want.id === undefined || want.id === null || want.id === '');
  if (hasId) {
    for (i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(want.id)) return i;
    }
  }
  return -1;
}

Component(pub.comp('todo', {
  data: {
    detail: null,
    imgOpen: false,
    imgIndex: 0,
    /* ★★ 248 轮：闪念胶囊的**全文查看层**（点详情页那张胶囊卡打开）。
       ⚠️ 与上面 `imgOpen` 是两套，不合并：一个看的是图（能左右翻、有 n/N 角标），
          一个看的是一段文字（单条、不可翻）—— 形状不同，硬合并会让两边都长出
          用不上的分支。 */
    capOpen: false,
    capIndex: 0,
    /* ★ 45 轮：待办表单里点「新建项目」时，项目表单落在**第二层**（form2），
       本层待办表单侧转（formTurned）—— 与「项目列表 → 新建项目」同款观感。 */
    form2: forms.closed(),
    formTurned: false,
    /* ★★ 278 轮：信息增强的**展示态** —— 四个字段原样下发给 form2（`mode='enhance'`）。
       ⚠️ 为什么放在页面而不是组件：组件被 `wx:if` 建/销，用户关掉抽屉后响应才回来时
          组件已经没了；页面一直在，接得住（详见 form-drawer.js 的 `onEnhance` 注释）。
       ⚠️ `state` 初值就是 `'loading'`：抽屉一开就是生成中，没有 idle 态。
       ⚠️ 这四个字段**不进任何 observer**（组件侧也一样）—— 它们是"结果"不是"输入"。 */
    enhView: { text: '', state: 'loading', error: '', notice: '' }
  },

  refresh: function () {
    const id = store.memoryOf('todo');
    const t = id ? store.todoById(id) : null;

    /* 记忆失效（被删了）→ 清空记忆，页面回空态（FR-8.4） */
    if (id && !t) store.clearMemory('todo');

    const cur = store.todoById(store.memoryOf('todo'));
    const self = this;
    /* ★★ 199 轮：**打开详情 ⇒ 「刚转过来」提示消失**（用户口径：
       「用户在打开这个待办详情……后，这个提示消失」）。
       ★ 落点选在这里（而不是 `onDrawerPick` / `onTodoOpen` 那些入口）有两个理由：
         ① 本函数是"**详情真的出现在屏上**"的**唯一**出口 —— 抽屉里点一条、
            项目页点卡片跳过来、壳页按记忆恢复、撤销后重画，全都汇到这里；
            挂在入口上就会漏（这个工程已经因为"同一个动作有两个入口"踩过好几次）。
         ② 幂等：`markTodoSeen` 自己判 `flashAt`，没有提示时立刻返回、一个请求都不发
            ⇒ 每次 `refresh()` 都调它是安全的。
       ⚠️ 顺序：**先清、后 `setData`** —— 这一帧渲染出来的详情就已经是"看过"之后的样子
          （列表要等下一次重画才褪色，那正是"我进过详情"这个事实的回执）。 */
    if (cur && cur.flashAt) store.markTodoSeen(cur.id);
    /* ★★ 187 轮：方向与 `_roW` 必须同档 —— 横屏 728 / 竖屏 736 是两个值，
       方向换了，上一版量到的那个数就**不能再喂给 `readOnlyView()`**（会得到"图偏小"
       或被切），所以在这里作废、退回本方向的兜底档；真值由紧随的 `measureCard()` 补。
       ⚠️ 与 `afterLayout()` 里那一段是**同一件事的两个入口**（转屏走重排、切模块走刷新），
          两处都要有：只在其中一处做，另一个入口就会带着旧方向的值把图画错。 */
    const land = !!this.data.landscape;
    if (this._roLand !== land) { this._roLand = land; this._roW = null; }
    /* ★★ 187 轮：图**和卡片同一帧出**（消除"该区域闪烁"，用户 187 轮口径）。
       ── 171/186 那两版是"先落地一帧**没有图**的卡（`view` 恒为 null），回调里再补画"：
          每一轮 `refresh` 都先渲染一版"卡里没有 `.ro-canvas`"的版式 —— 卡内少 240px、
          下面几块整体上移，下一帧图到了再撑回来 ⇒ 肉眼就是一次抖动/闪烁。
       ⇒ `view` 改由 `packDetail()` **同步**算好（`mmc.readOnlyView()` 本来就是同步纯函数；
          宽度吃 `this._roW` 这份实测缓存，没量过就用兜底档）⇒ 第一帧就有图。
       ⚠️ 回调里**只剩量宽这一件事**：`createSelectorQuery` 天生异步。
          `paintMindmap()` 不再无条件下发，只在"量到的宽与刚画用的不一致"时被
          `measureCard` 叫一次（收敛守卫，见那边注释）。
       ⚠️ 别退回去用 `setTimeout(0)` 代替回调：回调保证渲染层已经吃下这一批数据。 */
    this.setData({ detail: cur ? this.packDetail(cur) : null }, function () {
      self.measureCard();
    });
    this.ensureMindmapTree(cur);
  },

  /**
   * ★★ 170 轮：「关联脑图」卡里要画**整张脑图** ⇒ 这棵树的"真数据"必须先到位。
   *
   * 与 `mod-mindmap.refresh()` 是**同一条口径**（那边那段注释更全，两处一起看）：
   *   · 判断"要不要拉"**只认 `store.treeReady(mid)`**，不看 `state.tree[mid]` 在不在 ——
   *     `ensureTree()` 造的"只有根节点"的占位树也住在 `state.tree` 里，拿它当依据会被挡死，
   *     症状是"永远只有根节点"。
   *   · 只在**真数据态**才拉（`store.isLoaded()`）：mock 与"连不上后端"两种情况下，
   *     本地种子就是权威，一个请求都不该发。
   *   · ⚠️ 失败**不重画**：`loadTree()` 拉失败时不标 `treeReady`；如果这里照样 `refresh()`，
   *     每次刷新都会"再拉一次 → 再失败 → 再重画" ⇒ **死循环**。
   *   ⚠️ 顺带一条：这条请求**不是**在 `packDetail()` 里发的 —— 那是纯装配函数
   *      （只把 store 的现状翻译成一份可渲染的 data），不该有副作用。
   */
  ensureMindmapTree: function (t) {
    const mid = t && t.mindmapId;
    if (!mid || !store.isLoaded() || store.treeReady(mid)) return;
    const self = this;
    store.loadTree(mid).then(function () {
      /* 二次校验：拉回来时用户可能已经切到别的待办了（那时不该替他重画） */
      const cur = store.todoById(store.memoryOf('todo'));
      if (store.treeReady(mid) && cur && cur.id === t.id) self.refresh();
    });
  },

  /**
   * 只读整图这一版用的**设计宽**：实测缓存（`_roW`）优先，没量过就用兜底档。
   *
   * ★★ 187 轮：把"取宽"独立成一个出口 —— 因为**三个调用点**都要用它：
   *   · `packDetail()`（第一帧同步出图）、
   *   · `paintMindmap()`（量到新宽之后重画）、
   *   · `measureCard()` 的收敛守卫（"量到的"与"刚画用的"比的就是它）。
   *   三处各写一遍"`_roW` 优先、兜底在后"那半句条件式，迟早漏改一边（171 轮只有一个调用点，
   *   "第一帧"与"守卫"那两条路当时还都不存在）。
   *   ⚠️ 本段注释**不要写出那句 `return` 表达式的字面量** —— 判据 D2 用 `indexOf`/正则找它，
   *      注释里先出现一次，锚就会跟着一起命中（187 轮实测：N9 变异因此变假绿）。
   *
   * ⚠️ `_roW` 与 `this.data.landscape` **必须同方向**才有效 —— 横屏 728 / 竖屏 736 是两档，
   *    方向换了就得作废（`_roLand` 就是记这个的，见 `refresh` / `afterLayout`）。
   */
  roW: function () {
    return this._roW || (this.data.landscape ? RO_W_FALLBACK.land : RO_W_FALLBACK.port);
  },

  /**
   * ★★ 187 轮：把「关联脑图」卡里那张**只读整图**的载荷算出来（**纯读、不量 DOM**）。
   *
   * 整张图**一行都不在这里画** —— 全部交给 `mmc.readOnlyView()`（＝脑图模块自己那套
   * 度量 / 排版 / 连线，同一个模块文件）。这里只负责备齐它的三个输入（树 / 格式 / 画布尺寸）。
   *
   * ⚠️ 闸门是 `store.treeReady(mid)`：`ensureTree()` 会现造一棵**只有根节点**的占位树，
   *    照它画出来是孤零零一个黑块 —— 那比"空着"更像出错（与 170 轮同一条取舍）。
   *    真树由 `ensureMindmapTree()` 拉回来，拉到了它会再 `refresh()` 一次。
   * ⚠️ `sel` 由 `readOnlyView` 写死传空串 ⇒ 卡上永远没有"当前选中"这回事
   *    （只读：没有可操作的对象，就不该有选中态）。
   * ⚠️ 这里**不量 DOM**：`boundingClientRect` 是异步的，量完这一帧早过去了。
   *    宽度只读 `_roW` 缓存 / 兜底档；真正的测量在 `measureCard()`，量到新值再由它回调重画。
   *    这条分工同时保住了两件事：`packDetail()` 是纯装配、且**第一帧就有图**。
   */
  roView: function (m) {
    if (!m || !store.treeReady(m.id)) return null;
    const mm = store.mindmapById(m.id);
    return mmc.readOnlyView(store.ensureTree(m.id), store.formatKeyOf(mm), {
      landscape: !!this.data.landscape, w: this.roW(), h: RO_H
    });
  },

  /**
   * 量到新宽度之后的那一次重画 —— **只改 `detail.mindmap.view` 这一个字段**，
   * 不重建整张详情（重建会把别的区块一起重渲一遍，白白多一帧）。
   */
  paintMindmap: function () {
    const d = this.data.detail;
    const m = d && d.mindmap;
    if (!m) return;
    this.setData({ 'detail.mindmap.view': this.roView(m) });
  },

  /**
   * ★★ 171 轮：量一次 `.ro-canvas` 的**真宽**，与刚画用的那版不一致才重画。
   * ★★ 187 轮：量到的值要**除以上游缩放 `s`** 换成设计宽。
   *
   * 为什么非要量：只读整图是按"整幅装进卡内"算倍率（`fitBoxInto`）的，而卡内宽横屏一档、
   * 竖屏一档，写死任何一档都会在别的档上"图没铺满"或者"图被切掉"。
   * `mod-mindmap.measure()` 量画布矩形也是同一个理由。
   *
   * ⚠️⚠️ **必须 ÷ s（187 轮修）**：`boundingClientRect` 给的是**屏幕物理像素**，
   *    而 `.ro-canvas` 长在 `.stage` 的 `transform: scale(s)` 里 ⇒ 物理宽 ＝ 设计宽 × s。
   *    直接拿物理宽去排版 ＝ "按屏幕像素画一遍、再被外层缩一次"，图会小 s 倍
   *    （平板竖屏 s≈0.93 ⇒ 小 7%；s＝1 的机器上恰好一模一样，所以一年多没暴露）。
   *    同一条换算 `mod-mindmap.measure()` 里早就写着（`s = r.width / (w * sv)`），口径一致。
   *
   * ⚠️ **收敛守卫**（比 `roW()` ＝ 刚画那一版用的宽）：一致就一个字节都不动。
   *    没有它就会变成 `setData → 量 → setData → …` 的自激循环（每一帧都重算一遍
   *    整棵树的排版与 SVG）。这个坑与 `ensureMindmapTree` 那条"失败不重画"同族。
   *    ⚠️ 兜底档与实测**同单位**（都是设计宽）、只差几像素边框 ⇒ 正常情况下量到的
   *       与刚画的一致，**一次都不重画**。171/186 那两个兜底值漏算了 4px 边框，
   *       会让每台设备白白多跳一次（187 轮一并修正，见 `RO_W_FALLBACK`）。
   * ⚠️ 量不到（模块不在前台 / 卡片还没铺开 ⇒ 宽 0）**直接返回**，等下一次 `refresh`
   *    再说 —— 不要拿 0 去算倍率（`fitBoxInto` 里 `b.w / 0` 会得到 `Infinity`）。
   * ⚠️ `stage.fit()` 只在这条测量路径上调（一次测量一次），不进 `refresh` 的热路径；
   *    末尾的 `|| 1` 兜住"拿不到视口"的极端情况 —— 除以 0/NaN 会把整张图毁成空白。
   */
  measureCard: function () {
    const self = this;
    const q = this.createSelectorQuery();
    q.select('.ro-canvas').boundingClientRect();
    q.exec(function (res) {
      const r = res && res[0];
      if (!r || !r.width) return;
      const s = stage.fit().scale || 1;
      const w = r.width / s;                    // 物理像素 → 设计宽
      if (Math.abs(w - self.roW()) < 1) return;
      self._roW = w;
      self.paintMindmap();
    });
  },

  /**
   * ★★ 187 轮：方向 / 尺寸变了 ⇒ 卡内设计宽也变了（横屏 728 / 竖屏 736 两档）
   * ⇒ 上一版量到的 `_roW` **立刻作废**，并重画一次那张只读图。
   *
   * 为什么必须有这一段：`landscape` 变化走的是**重排**那条路（壳页对五个模块各调一次
   * `relayout()`），而**不刷新数据** —— 没有它的话，转屏之后卡片里那张图会一直停在
   * "按另一个方向的宽度算出来"的那一版（图偏小或溢出被切），直到用户切走再切回来。
   *
   * ⚠️ 顺序不能反：先作废 + 重画（用新方向的兜底档算出**对的**一版），
   *    再测量（量到与兜底差 <1px 就什么都不做；差得多就再修一次）。
   * ⚠️ 这一段是**叠加**在基座那个空 `afterLayout` 之上的（`pub.comp()` 两边都跑）。
   */
  afterLayout: function () {
    const land = !!this.data.landscape;
    if (this._roLand !== land) {
      this._roLand = land;
      this._roW = null;
      this.paintMindmap();
    }
    this.measureCard();
  },

  packDetail: function (t) {
    const u = store.urgencyOf(t.urgency);
    const p = store.projectById(t.projectId);
    const c = p && p.color ? store.colorOf(p.color) : null;
    const m = t.mindmapId ? store.mindmapById(t.mindmapId) : null;
    /* ★★ 248 轮：「闪念胶囊」区块的数据 —— 关联在**这条待办上**的那几枚。
       ⚠️ 数据源必须是 `store.capsulesOfTodo(t.id)`，**不是** `store.capsules()`：
          后者是"还没被整理的"正常名单，关联过来的那批恰恰已经被移出去了
          （用户口径第 4 条：关联时从闪念胶囊列表移除，与转脑图 / 转待办一致）。
       ⚠️ 卡片装配走 `store.capsuleCardView()` —— 与「选择胶囊」抽屉里那批**同一份实现**
          （正文 ＋ 截到分钟的时间），两处各拼一份就等着漂。
       ⚠️ 取一次、用两次（数组 + 条数）：`capsulesOfTodo` 内部要 filter ＋ sort，
          在这里调两遍就是白排两次序。 */
    const caps = store.capsulesOfTodo(t.id).map(store.capsuleCardView);
    /* ★ 82 轮：「所属项目」升级成项目详情那张「基础信息」卡 ⇒ 这里把那张卡要的数一次备齐。
       口径**全部来自 store**，与项目页同一个真源（`projectSummary` / `agentById` /
       `quotaLowOf` / `resetInOf`）—— 两页各算一遍迟早会漂。
       ★★ 162 轮：卡上那排数拆成了**两个组**（「项目概要」／「所属 agent」）⇒ 字段也跟着分组，
          项目概要那三个数一律取自 `store.projectSummary()`（唯一真源，见 store.js 那条注释）。
       ⚠️「未完成 / 已完成」两数都**不含已删除**（`projectSummary` 内部已滤）。 */
    const a = p && p.agentId ? store.agentById(p.agentId) : null;
    const sum = p ? store.projectSummary(p.id) : null;
    return {
      id: t.id,
      text: t.text,
      urgency: u,
      done: !!t.done,
      /* ★★ 160 轮：这一条是不是**已删除**（逻辑删除）。详情页三处读它：
         ① 头部徽章（已删除 / 已完成 互斥）；
         ② 操作区走哪一支（只有「还原」）；
         ③ 几个 handler 的守卫（编辑 / 导出 / 完成 都不接已删除的）。
         ⚠️ 判据走 `store.isDeletedTodo()`，这里**不读** `t.deletedAt` ——
            软删的两种写法（时刻串 / 布尔）只在那一个函数里认。 */
      deleted: store.isDeletedTodo(t),
      /* ⚠️ 页面直接显示这两个串 ⇒ 必须 `atMin()` 截到分钟（存储是秒精度）。 */
      createdAt: store.atMin(t.createdAt),
      completedAt: store.atMin(t.completedAt || ''),
      /* ★★ 2026-09-30 修：每张图补一个 `src`（**能直接喂给 `<image>` 的完整地址**）。
         原来只带了 `uri`（相对路径，形如 `1/202610/ab12.jpg`），模板又只画了
         一个 album 占位图标 ⇒ 详情页永远看不到图（用户口径「详情中也显示不出来图片」）。
         ⚠️ 这里拼完整地址是**合规的**：列表 / sync 一律只给相对 `uri`，只有"真的要看图"
            的这一处才现拼（§6.2 红框，别把这个习惯挪到列表渲染里去）。
         ★★ 闸门是 `store.isLoaded()`（真快照灌进来了没有）而**不是** `api.useMock()`：
            连不上后端时 mock 种子的 uri 是
            `https://example.com/...`，拿开关当闸门就会给它拼出 src ⇒ 占位块变成一张
            空的裂图，既不像 mock 也不像真数据。同款说明见 form-drawer 的 `imageRows()`。
         ★ 2026-09-30 补：默认档（`_fallback = false`）下"连不上后端"会**清空内存**
            ⇒ 那种情况压根没有 uri；这条现在落在**回落档**（出图 / 走查）。
            ⚠️ 闸门的语义不变：`isLoaded()` 问的永远是「这份数据是不是后端来的」。 */
      images: (t.images || []).map(function (im, i) {
        return {
          id: im.id, label: im.label, uri: im.uri, no: i + 1,
          src: (store.isLoaded() && im.uri) ? api.fileUrl(im.uri) : ''
        };
      }),
      imgCount: (t.images || []).length,
      mindmap: m ? {
        id: m.id, name: m.name, nodes: m.nodes, depth: m.depth,
        updated: store.dateOf(m.updatedAt),
        /* ★★ 171 轮：这张图的**只读整图**载荷（`{nodes, linksUri, linksStyle, vpStyle}`）。
           ★★ 187 轮：**就地算**（`this.roView(m)`），不再给 `null` 占位等下一帧补画。
           理由见 `refresh()` 那段：`view` 留空 ⇒ 每切一次模块就闪一帧"没有图"的卡。
           ⚠️ "纯装配函数不许量 DOM"这条口径**没有破**：量 DOM 依然是 `measureCard()` 的事，
              `roView()` 只读 `_roW` 缓存/兜底档 + 现算（`readOnlyView` 是纯函数）。
           ⚠️ 170 轮的 `prev`（现算 SVG 的 data-URI）**已整条撤掉** —— 那套走的是
              `utils/mindmap-preview.js`（已移入归档），与画布不是同一份实现。 */
        view: this.roView(m)
      } : null,
      project: p ? {
        id: p.id, name: p.name, node: p.node, archived: store.isArchived(p),
        color: c ? c.main : store.noneColor(),
        remark: p.remark || '',
        /* —— 「项目概要」组：这个项目自己的三个数 —— */
        openCount: sum.open,
        doneCount: sum.done,
        mindmapCount: sum.mindmap,
        /* —— 「所属 agent」组：这条待办所属项目关联的 agent ——
           ⚠️ 没关联时 `agentName` 为空串 ⇒ 模板走那句灰字（**不画**灰块）；
              下面三个「—」是兜底值，正常路径读不到（模板里那块灰块在 `wx:if` 内）。 */
        agentName: a ? a.name : '',
        resetIn: a ? (store.resetInOf(a) || '未填') : '—'
        /* ★★ 163 / 164 轮：撤 `quotaLeft` / `quotaLow` / `monthlyQuota` ——
           163 撤「当前剩余」，164 再撤「每月套餐」（用户只看「agent 名称 ＋ 距离重置天数」），
           卡面那格数只剩这一格，与项目页基础卡**同一排数、同一个 store 真源**。
           ⚠️ 上面那个 `'—'` 兜底**留着**：字段形状与项目页一致（同一张卡长在两页），
              只是模板里 `wx:if="{{detail.project.agentName}}"` 挡在前面 ⇒ 正常路径读不到。 */
      } : null,
      /* ★★ 248 轮：「闪念胶囊」区块 —— 关联到这条待办上的那几枚（卡片：正文 ＋ 时间）。
         ⚠️ 用户口径第 3 条「卡片信息只能查看不能编辑」：这里**不产出任何可编辑入口**
            （没有 `editing` / `onChange` 之类），要改内容只能去闪念胶囊里改。
         ⚠️ 与「图片」「关联脑图」两个区块**同一条守卫**：已删除的待办不渲染 ✕ 与
            「+选择胶囊」（那一档只有「还原」，见 wxml）。 */
      capsules: caps,
      capCount: caps.length
    };
  },

  autoDrawer: function () { this.autoDrawerFor('todo'); },

  /* ---------------- 详情头 ---------------- */

  /**
   * 点空态按钮 → 弹列表抽屉。
   * ★ 44 轮删掉了详情头里的「待办列表」按钮、45 轮又合并掉了标题，
   *   所以页内**没有**列表入口了 —— 列表入口只有一条（FR-8.2）：成为详情后再点一次导航。
   *   空态那块仍留一个显式按钮，否则空屏上无处可点。
   */
  onTitleTap: function () { this.openListDrawer('todo'); },

  /* ---------------- 关联脑图 / 所属项目 跳转 ---------------- */

  /**
   * 去脑图模块看这张图。
   * ★★ 170 轮起这是**唯一**的入口 —— 卡里那张整图直接绑它（「查看」键已撤）。
   * ⚠️ 守卫留着：`detail.mindmap` 为空时（没关联 / 树没到位）不该把人带走。
   */
  onGoMindmap: function () {
    if (!this.data.detail || !this.data.detail.mindmap) return;
    const id = this.data.detail.mindmap.id;
    /* ★★ 280 轮：第三处入口（待办详情 → 关联脑图）也要过闸门。
       ⚠️ 不能只拦脑图列表 —— 用户从待办详情点关联的脑图，走的正是这一条，
          漏了它，闸门等于不存在。 */
    if (this.guardMindmapOpen(id)) return;
    store.setMemory('mindmap', id);
    this.gotoModule('mindmap');
  },

  onGoProject: function () {
    if (!this.data.detail || !this.data.detail.project) return;
    store.setMemory('project', this.data.detail.project.id);
    this.gotoModule('project');
  },

  /**
   * 「关联 / 替换」—— 打开**脑图选择主弹窗**（★ 82 轮 · ★★ 170 轮只改了文案）
   *
   * 用户口径「点击关联按钮后弹出脑图选择抽屉（该选择抽屉是直接在左侧展开，因此需要一个
   * 主抽屉，和待办编辑抽屉出发的脑图选择不一致）」。所以这里用的是 `drawer` 组件
   * （kind=mindmap，宽 320），**直接落在左侧 L1 位**，而不是表单里那个 260 宽的三级副弹窗。
   *
   * 关闭 / 选完之后的收尾都在 `pagebase.onDrawerPick`（picker 态）里 ——
   * 组件的选择事件与普通列表是同一条 `bind:pick`，靠 `drawer.picker` 区分该"切模块看"
   * 还是"回填到这条待办"。
   *
   * ★★ 170 轮：**只有文案变了**，这条路一个字节都没动 —— 有图时那颗键写「替换」，
   *   点的还是同一个 `openMapPicker()`。用户口径「关联的按钮其实不是关联了，应该改为替换」：
   *   已经挂着一张图时"关联"读起来像"再加一张"，而这一步实际是"另选一张"。
   *   ⚠️ 别顺手在这里加"先清空再选"的分支 —— 收尾那条
   *      `store.updateTodo(tid, { mindmapId: mid || null })` 本来就是**赋值**不是追加，
   *      换一张与挂第一张走的是同一条写路径。
   */
  onLinkMindmap: function () {
    if (!this.data.detail) return;
    this.openMapPicker();
  },

  /**
   * ★★ 2026-10-23（第 247 轮 · 用户口径）：**取消关联** —— 把这条待办的 `mindmapId` 清空。
   *
   * 用户原话：「关联完脑图之后也没法取消关联，这两个流程要整理一下」。
   * ── 为什么不做成"picker 抽屉里加一行『不关联』"：
   *    那张抽屉是 `drawer` 组件的**列表类**装配（`drawers.build('mindmap')`），它的每一行
   *    都对应一张真脑图（`pick` 事件把 `id` 交回页面）。往行数据里塞一条"不是脑图"的哨兵，
   *    等于让这个组件在两种语义之间打架 —— 表单里那个三级抽屉当年能这么做，是因为它
   *    自带一套 `mapRows`（已经随 247 轮一起删了）。
   * ── 为什么是**这一颗**而不是把「替换」改成"点已选中的那张就取消"：
   *    隐式取消（再点一次已选项 ＝ 不选）在单选组里成立，但这里"已选中的那张"是画在
   *    卡里的整幅图、点它是**去看它**（171 轮口径）—— 两种语义压在同一个目标上，
   *    用户没法预判。显式一颗键最省解释。
   * ── 确认框是要的：取消关联不改脑图本身（`store.updateTodo` 只清这一条待办的指针），
   *    但用户"我那张图呢？"的疑问必须当场答掉 —— 文案里写清"脑图不会被删除"。
   * ⚠️ 走 `store.updateTodo` 而不是另开接口：`mindmapId` 本来就在 `UpdateTodoDto`
   *    的白名单里（关联也是走它），清空只是同一个字段的另一个值。
   * ⚠️ 传 `null` 不传 `''`：与 `pagebase._pickForTodo()` 里 `mid || null` 同口径，
   *    后端那一列是"可空外键"，空串会被 Prisma 当成一个非法 id。
   */
  onUnlinkMindmap: function () {
    const d = this.data.detail;
    if (!d || !d.mindmap) return;
    if (d.deleted) return;                     /* 已删除那一档只有「还原」，模板也不渲染这颗键 */
    const self = this;
    wx.showModal({
      title: '取消关联这张脑图？',
      content: '只解除这条待办与它的关联，脑图本身不会被删除。',
      confirmText: '取消关联',
      success: function (r) {
        if (!r.confirm) return;
        const t = store.todoById(d.id);
        if (!t) { wx.showToast({ title: '这条待办已经不在了', icon: 'none' }); return; }
        store.updateTodo(d.id, { mindmapId: null });
        wx.showToast({ title: '已取消关联', icon: 'none' });
        self.refresh();
      }
    });
  },

  /* ---------------- 操作区（★★ 160 轮：三态） ----------------
   *
   * 用户口径：*「未完成状态下有『完成』『导出』『编辑』『删除』按钮；已完成状态下有
   * 『导出』『还原』（点击还原更改状态为未完成）『删除』按钮，已删除状态下只有
   * 『还原』（点击还原状态为未完成）」*。
   *
   * ⇒ 三套按钮集合（模板那三支 `wx:if/wx:elif/wx:else`），**每颗键只做一件事**：
   *   未完成 → 完成 / 导出 / 编辑 / 删除；已完成 → 导出 / **还原** / 删除；
   *   已删除 → **只有还原**。
   * ⚠️ 关键的一处**行为变更**：那颗「完成」**不再是切换键**（原来已完成时再点＝撤回）。
   *    撤回从它身上摘出来，交给新加的「还原」（与已删除那一档**同一个词、同一个去向**）。
   *    理由：一颗键同时是"做"与"撤"，用户得先抬头读徽章才知道此刻按下去是哪个方向。
   */

  /**
   * 「完成」—— **只在未完成那一档渲染**。
   * ⚠️ 两道守卫（`done` / `deleted`）不是摆设：本模块之外还能经 `pagebase.onTodoMenu`
   *    的「⋯」菜单调 `store.toggleTodo()`（那条路是等价的另一个入口），
   *    而这里要保证"从详情页的完成键"走过去时，**方向永远是"完成"**。
   */
  onToggleDone: function () {
    const d = this.data.detail;
    if (!d || d.done || d.deleted) return;
    store.toggleTodo(d.id);
    wx.showToast({ title: '已完成', icon: 'none' });
    this.refresh();
  },

  /**
   * ★★ 160 轮：「还原」—— **已完成**与**已删除**两档共用这一颗（同一个词、同一个去向：
   * 都回到「未完成」）。
   *
   * ⚠️ 两档走的是**两个不同的 store 动作**，别在这里合并成一句：
   *   · 已删除 ⇒ `store.restoreTodo(id)` —— 清掉 `deletedAt`，**同时把状态写成未完成**
   *     （用户 2026-10-12 拍板「一律回到未完成」）。它是一条独立接口
   *     （`POST /todos/:id/restore`），不能塞进通用编辑：`UpdateTodoDto` 是白名单，
   *     `deletedAt` 会被静默剥掉。
   *   · 已完成 ⇒ `store.toggleTodo(id)`（`done → open`，同时置空 `completedAt`）——
   *     与「取消完成」是同一件事，只是换了个说得清方向的词。
   * ⚠️ 判据顺序**必须先看 `deleted`**：一条已删除的待办可能同时还是 `done`（软删不碰
   *    status），先判 `done` 就会走成"撤回完成"——状态回到未完成、但**还在已删除名单里**，
   *    用户会看到"点了还原，它没回来"。
   */
  onRestore: function () {
    const d = this.data.detail;
    if (!d) return;
    if (d.deleted) {
      store.restoreTodo(d.id);
      wx.showToast({ title: '已还原为未完成', icon: 'none' });
    } else if (d.done) {
      store.toggleTodo(d.id);
      wx.showToast({ title: '已还原为未完成', icon: 'none' });
    } else {
      return;                       // 未完成那一档没有这颗键（从别处调进来时安静退出）
    }
    this.refresh();
  },

  /**
   * ★ 45 轮：**导出** —— 打开导出抽屉（`form-drawer` 的 mode=export，二级抽屉形态）。
   * 里面是「原文 → 空行 → 关联脑图 Markdown」的只读预览（文本保真，一个字的改写都不许）
   * ＋「不含图片」开关 ＋「复制到剪贴板」。预览与复制共用同一个纯函数
   * `store.copyTodoText()`，所以**看到的＝复制到的**。
   * ⚠️ ★★ 160 轮：已删除那一档**不渲染这颗键**，这里再挡一道 —— 导出本身是纯本地的
   *    （不发请求），挡它是因为"已删除的详情页只有一颗还原"是用户明确的版式口径，
   *    多一条能被调到的路，迟早有人从别处把它接回来。
   */
  onExport: function () {
    const d = this.data.detail;
    if (!d || d.deleted) return;
    this.openForm('export', d.id);
  },

  /* ==========================================================================
     提示词增强（★ 278 轮）
     ========================================================================== */

  /** 「信息增强」抽屉还开着吗 —— 所有迟到的响应都要先过这一关 */
  enhAlive: function () {
    const f2 = this.data.form2;
    return !!(f2 && f2.open && f2.mode === 'enhance');
  },

  /**
   * 点「增强」→ 右侧开「信息增强」抽屉 ＋ 开始生成。
   *
   * ★★ 三条纪律，每条都对应一个已经踩过的坑：
   *   ① **幂等**：`enhance` 事件有两个来源（底部「增强」键、失败态的「重试」），
   *      它们走**同一个 handler**。已经在二层上时只重发请求、**不重开抽屉** ——
   *      重开会把 `enhView` 复位、还会再叠一次 `formTurned`，观感上是"闪一下"。
   *   ② **竞态**：用户连点两次「重试」，两个响应回来的顺序不保证。用 `_enhSeq`
   *      递增序号，只有**最后一次**的响应能落地；旧的直接丢弃（不 setData）。
   *   ③ **迟到响应**：用户点完增强、等不及、关掉抽屉 —— 响应回来时二层已经不在了。
   *      过 `enhAlive()` 就丢掉：既不打在一张已收起的抽屉上，也不在下次打开时
   *      "凭空出现上次的结果"（那会让人以为这次没调模型）。
   *
   * ★ 文本取的是**与导出预览同一个纯函数** `store.copyTodoText()` ——
   *   用户增强的就是他在左边看到的那一份，一个字都不多不少（判据 E6）。
   *   「不含图片」开关也一起传：用户勾了不带图，增强的输入里就不该有图。
   */
  onFormEnhance: function (e) {
    const self = this;
    const v = (e && e.detail && e.detail.values) || {};
    const todoId = v.todoId || (this.data.detail && this.data.detail.id) || '';
    /* ★★★ 2026-10-27（全量检查 F13）· **重试必须沿用首次那次的"含不含图"**。
       ── 病根：首次按父层（导出抽屉）的 `noImage` 取正文；可重试发生在二层，
          事件带上来的是**二层自己的** values（`openNestedEnhance` 写死的 false）
          ⇒ 用户首次勾了"不含图片"，重试却把图带上去了 —— 输入与左侧预览不一致。
       ── 现在：第一次进来把父层的值记在 `_enhNoImage`，之后的每一次重试都用它。
       ⚠️ 记在实例上而不是 data：它不参与渲染；而且二层关闭后下次进来会被重新赋值。 */
    const alive = this.enhAlive();
    if (!alive) this._enhNoImage = !!v.noImage;
    const noImage = alive ? !!this._enhNoImage : !!v.noImage;
    const text = todoId ? store.copyTodoText(todoId, { noImage: noImage }) : '';

    if (!text) {
      wx.showToast({ title: '这条待办没有正文', icon: 'none' });
      return;
    }

    /* ① 开二层（幂等）—— 导出抽屉在 L1（offset 0），二层落在 270 那一档 */
    if (!alive) {
      forms.openNestedEnhance(this, todoId, (this.data.form && this.data.form.offset) || 0, noImage);
    }

    /* ② 进 loading。**每次都复位** —— 重试时不能让上一轮的结论留在屏上 */
    this.setData({ enhView: { text: '', state: 'loading', error: '', notice: '' } });

    /* ③ 竞态守卫 */
    const seq = (this._enhSeq || 0) + 1;
    this._enhSeq = seq;

    api.enhancePrompt(text).then(function (r) {
      if (self._enhSeq !== seq || !self.enhAlive()) return;
      const out = (r && r.text) || '';
      if (!out) {
        /* 后端已经保证"空结果 ⇒ 5000 报错"，走到这里说明回了 200 但内容为空 ——
           仍然按失败处理，不要把空串当结果（用户会以为模型就这水平）。 */
        self.setData({ enhView: { text: '', state: 'error', error: '增强结果为空，请重试', notice: '' } });
        return;
      }
      self.setData({
        enhView: { text: out, state: 'done', error: '', notice: (r && r.notice) || '' }
      });
    }).catch(function (err) {
      if (self._enhSeq !== seq || !self.enhAlive()) return;
      /* ⚠️ 错误码只进 console，界面上只给**中文成因**（全工程口径）。
         `netHint` 已经把 biz / timeout / network / auth 四类翻成人话了。 */
      console.error('[enhance]', err && err.code, err && err.message);
      self.setData({
        enhView: {
          text: '', state: 'error',
          error: api.netHint(err) || '增强失败了，请稍后重试',
          notice: ''
        }
      });
    });
  },

  /** 编辑 —— 同上：已删除的挡在门外（后端 `PATCH /todos/:id` 本轮起也会拒绝它） */
  onEdit: function () {
    const d = this.data.detail;
    if (!d || d.deleted) return;
    this.openForm('todo', d.id);
  },

  /**
   * 删除 —— ★★ 160 轮起是**逻辑删除**：确认文案必须跟着改（改前那句"删除后不可恢复"
   * 现在是**假话**），并且要说清"去哪儿找回来"。
   *
   * ⚠️ 删完仍然是**空态 ＋ 自动弹列表抽屉**（FR-8.2 场景表最后一行）—— 这一条没变：
   *    记忆里的那条已经不在了（`store.removeTodo` 会清 `ui.todoId`），
   *    详情页该回空态。用户要找回它就走「筛选 → 已删除」——
   *    那句话必须写进确认框，否则他只知道"能还原"，不知道从哪进去。
   */
  onDelete: function () {
    const self = this;
    wx.showModal({
      title: '删除这条待办？',
      content: '删除后本模块回到空态。它不会消失：在待办列表的「筛选 → 已删除」里可以还原；它关联的脑图不会被删。',
      confirmText: '删除',
      confirmColor: store.danger(),
      success: function (r) {
        if (!r.confirm) return;
        store.removeTodo(self.data.detail.id);
        self.setData({ detail: null });
        self.refresh();
        /* 删掉当前详情 → 空态 ＋ 自动弹列表抽屉（FR-8.2 场景表最后一行） */
        self.openListDrawer('todo');
      }
    });
  },

  /* ---------------- 图片（★★ 230 轮：详情页就地加图） ----------------
   * 用户口径（230 轮）：「目前添加图片的操作只能在待办编辑抽屉中看到，在详情页没法顺畅地
   * 添加图片」⇒「图片」区块**常显**，卡里直接能加一张：
   * 空态是「一句虚线说明 ＋ 整宽大键」（与「关联脑图」无关联态同一套），
   * 有图时在格子末尾补一块「＋ 添加图片」（与表单里那块 `.sd-img-add` 同族皮肤）。
   *
   * 与表单抽屉里那一颗**同一条链路**（`utils/imgpick.js`）：
   *   `wx.chooseMedia` → `wx.compressImage` → `wx.uploadFile POST /files` → 相对 uri。
   * 差别只有"结果落到哪"：
   *   · 表单抽屉 —— 落进本地编辑副本，等用户按「保存」才提交；
   *   · 详情页   —— **立刻落库**（`store.updateTodo`）：这里没有"保存"这个动作，
   *                用户点了相册就期望它已经在待办上了。
   *
   * ⚠️ 传上去的是**相对 uri**（§6.2），`src` 由 `packDetail()` 现拼 —— 不要在这里把
   *    完整地址存进 store（下一次 `sync` 就分不清"存的是 uri 还是 url"）。
   * ⚠️ `api.useMock()` 那一档**不弹系统面板**（开发者工具里那是微信自己的选择器，自动化
   *    脚本点不到 —— 第 70 轮"录音授权弹窗带全屏暗遮罩、核验图全废"是同一类坑），
   *    与表单抽屉一样直接补一格占位。
   * ⚠️ 已删除的待办**不加**（后端 `PATCH /todos/:id` 也会拒）。守卫写在这里而不是只靠
   *    模板不渲染：模板那边管"看不看得见"，这里管"能不能真的写进去"。
   */
  onAddImage: function () {
    const d = this.data.detail;
    if (!d) return;
    if (d.deleted) { wx.showToast({ title: '已删除的待办不能再加图片', icon: 'none' }); return; }

    const self = this;
    const raw = store.todoById(d.id);
    const base = (raw && raw.images) || [];

    if (api.useMock()) {
      /* mock 档是同步的（没有并发窗口），照旧用起手那一刻的 `base` —— 出图/走查形态不变 */
      self.applyImages(d.id, base.concat([{ id: 'i' + Date.now(), label: '相册图片 ' + (base.length + 1), uri: '' }]));
      return;
    }

    /* 进度提示**必须挂在"真的开始上传"那一刻**（`onStart`），不许挂在这一步之前。
       ⚠️⚠️ 230 轮真机走查实锤：先 `showLoading` 再弹相册 ⇒ 用户一点取消，
          `wx.chooseMedia` 的 fail 分支按设计静默返回、`onFail` 也不会来
          ⇒「上传中」永远不消失（只有真选中图时才被收掉）。
       现在的顺序：选图（系统面板，此时屏上没有任何我们的提示）→ 选中后 `onStart` 挂 loading
       → 失败 `onFail` 收 / 成功 `cb` 收，**两条路都收**。 */
    /* ★★ 2026-10-24（复审 P2-07）：**进度条按"还在传的张数"计数，末一张结束才收**。
       ── 改前：每次成功 / 失败都直接 `wx.hideLoading()`。这条路挂的是 `mask:false`
          （刻意允许继续点「＋」），所以两张并发时**第一张先回来就把提示关掉了**，
          第二张还在传 —— 用户以为都好了，可能再点一次；反过来，全局 `hideLoading`
          是单例，还可能顺手关掉别的流程（比如正在保存）的提示。
       ── 现在：组件自己记在途张数，0 → 1 时开、回到 0 时才关。
       ⚠️ 减一必须放在回调的**第一行**：下面两条都会 early return（待办被删 / 已删除），
          放在后面会让计数永远减不掉，进度条再也不消失。
       ⚠️ `bump()` 写成**函数声明放在调用之后**（靠提升生效）：230 轮那条规矩是
          "`wx.showLoading` 只能出现在 `imgpick.pickAndUpload(` 之后"，
          判据 `check_detail_image_round230.js` 的 E9 按源码顺序钉着它 ——
          把它塞到上面当 `const` 会让那条判据（以及它守着的真机症状）重新退回红。
          语义完全等价：三个回调都在选图之后才执行，那时函数早就定义好了。 */
    imgpick.pickAndUpload(function (uri) {
      bump(-1);
      /* ★★ 2026-10-22（审查 P2-09）· **回调里现读最新图片集**，不再用起手时的 `base`。
         ── 改前：`base` 在**开始上传之前**就截了一张快照，成功后写回的是
            `base.concat([新的])` ⇒ 两张并发上传时，后完成的那次会把先完成的那张
            **整条覆盖掉**（测试实测 `writes=[[first],[second]], final=[second]`）。
            这条路的 loading 是 `mask:false`，本来就不挡住继续操作。
         ── 现在：以 store 里的现状为底（`applyImages` 是整体赋值语义 ⇒ 必须这样拼）。
         ⚠️ 还要确认"这条待办还在、还没被删"：上传那几秒里用户可能已经删掉它，
            往一条已删除的待办上写图片会被后端拒（`PATCH` 对已删除的返回失败），
            而本地那一下又会闪出图片 —— 两个结果都对不上，干脆不写。
         ⚠️ 标签按**当前**数量现算：改前用起手时的 `base.length + 1`，并发时会两张都叫
            「相册图片 1」。 */
      const latest = store.todoById(d.id);
      if (!latest) { wx.showToast({ title: '这条待办已经不在了', icon: 'none' }); return; }
      if (store.isDeletedTodo(latest)) {
        wx.showToast({ title: '已删除的待办不能再加图片', icon: 'none' });
        return;
      }
      const cur = latest.images || [];
      self.applyImages(d.id, cur.concat([{ id: 'i' + Date.now(), label: '相册图片 ' + (cur.length + 1), uri: uri }]));
      wx.showToast({ title: '已添加图片', icon: 'none' });
    }, function () {
      bump(-1);
    }, function () {
      bump(1);
    });

    /* 在途张数 ±1 —— 见上面那段注释（放在调用之后是**故意的**，别往前提）。 */
    function bump(n) {
      self._upPending = Math.max(0, (self._upPending || 0) + n);
      if (n > 0 && self._upPending === 1) wx.showLoading({ title: '上传中', mask: false });
      else if (n < 0 && self._upPending === 0) wx.hideLoading();
    }
  },

  /**
   * 把"这条待办的全部图片"写回去 —— **一次写、一处写**。
   * ⚠️ 是**整体赋值**不是追加：`store.updateTodo` 发的 `PATCH` 里 `images` 落库时
   *    "这份数组就是全部" ⇒ 调用方必须把「已有的 ＋ 新的」拼好再交进来。
   */
  applyImages: function (id, images) {
    store.updateTodo(id, { images: images });
    this.refresh();
  },

  /**
   * ★★ 2026-10-23（第 247 轮 · 用户口径）：**逐张移除一张图片**。
   *
   * 用户原话：「目前添加完图片之后没法取消……这两个流程要整理一下」——
   * 230 轮只给了"加"，没给"减"：加错了、加重复了，用户唯一的出路是去编辑抽屉
   * （而那个里现在已经没有图片了，见 form-drawer.wxml）。
   *
   * ── 三条实现口径 ─────────────────────────────────────────────
   * ① **按身份找，不按索引**：确认框是异步的（用户可能想一会儿），这几秒里
   *    别的入口（例如又加了一张）会把数组挪位 —— 拿 `detail.images[i]` 的下标去删，
   *    删掉的可能是另一张。所以进确认框前就把那一张**取出来**，回来按身份找。
   *    ⚠️★ 身份的选法 247 轮追加时改过一次（**别再改回去**）：原来比 `id`，
   *       而后端每次 PATCH 都整批重建图片行、id 必换，`mergeOne()` 换完又不通知重画
   *       ⇒ `detail` 里的 id 恒落后一版 ⇒ **第一次点必打空、第二次才生效**
   *       （用户报的就是这个）。现在比 `uri`（服务端原样回存、永不改），详见 `findImage()`。
   * ② **写之前现读 store**（与 `onAddImage` 的成功回调同一条纪律）：确认框这段窗口里
   *    用户可能已经删掉整条待办 ⇒ 往一条不存在的待办上写图片只会静默失败。
   * ③ **写库走 `applyImages` 这唯一的出口**（整体赋值语义），不在这里另写一份 patch。
   *
   * ⚠️ 后端**不会**删磁盘上那个文件（`PATCH /todos/:id` 只覆盖 `images` 数组），
   *    所以文案只说"从这条待办里移除"，不承诺"文件已删除" —— 说大了就是假话。
   * ⚠️ 已删除的待办：模板已经不渲染那颗 ✕，这里再挡一道（"看不看得见"与"能不能真写进去"
   *    是两件事，与 `onAddImage` 同一条）。
   */
  onImgDel: function (e) {
    const d = this.data.detail;
    if (!d) return;
    if (d.deleted) { wx.showToast({ title: '已删除的待办不能再改图片', icon: 'none' }); return; }
    const i = Number(e.currentTarget.dataset.i);
    const img = (d.images || [])[i];
    if (!img) return;

    const self = this;
    wx.showModal({
      title: '移除这张图片？',
      content: '只从这条待办里移除，其他待办不受影响。',
      confirmText: '移除',
      confirmColor: store.danger(),
      success: function (r) {
        if (!r.confirm) return;
        const t = store.todoById(d.id);
        if (!t) { wx.showToast({ title: '这条待办已经不在了', icon: 'none' }); return; }
        if (store.isDeletedTodo(t)) {
          wx.showToast({ title: '已删除的待办不能再改图片', icon: 'none' });
          return;
        }
        const cur = t.images || [];
        /* ★★ 按 uri 找（见 `findImage`）：detail 与 store 的 id 可以不同源，uri 一定同源。
           ⚠️ 只删**命中那一张**（slice 拼），不用 `filter` —— 两张同名 uri 会被一次删光。 */
        const k = findImage(cur, img);
        /* 找不到（并发下这张真的已经被别处移走了）⇒ 只重画，不写库 */
        if (k < 0) { self.refresh(); return; }
        const next = cur.slice(0, k).concat(cur.slice(k + 1));
        self.applyImages(d.id, next);
        wx.showToast({ title: '已移除图片', icon: 'none' });
      }
    });
  },

  /* ---------------- 图片查看层 ---------------- */

  onImgOpen: function (e) {
    this.setData({ imgOpen: true, imgIndex: Number(e.currentTarget.dataset.i) || 0 });
  },
  onImgClose: function () { this.setData({ imgOpen: false }); },
  onImgStep: function (e) {
    const d = e.currentTarget.dataset.d;
    const n = this.data.detail.imgCount;
    let i = this.data.imgIndex + (d === 'next' ? 1 : -1);
    if (i < 0) i = n - 1;
    if (i >= n) i = 0;
    this.setData({ imgIndex: i });
  },

  /* ================= 闪念胶囊（★★ 248 轮） =================
   *
   * 用户口径（2026-10-23）：
   *   ① 「待办详情中增加『闪念胶囊』模块，样式类似于图片和关联脑图，需要有『+选择胶囊』」
   *   ② 「点击『+选择胶囊』弹出选择胶囊的抽屉（主抽屉），卡片显示当前胶囊列表卡片，
   *      可多选卡片，底部按键为『取消』『保存』，无胶囊新增按钮」
   *   ③ 「关联后，胶囊卡片就在待办详情页以卡片形式显示，一行可以展示多个卡片，
   *      卡片信息只能查看不能编辑，可以取消关联」
   *   ④ 「在建立关联时，胶囊信息需要从闪念胶囊中移除」（服务端同一个事务里做）
   *   ⑤ 「解除关联……该信息会回到闪念胶囊列表，这个过程不算新增胶囊，不计入概览统计，
   *      此时胶囊信息的创建时间为解除关联的时间」
   *
   * ── 这一组方法与「图片」那一组的分工（读之前先分清）──────────────
   *   · 图片：`onAddImage` / `onImgDel` —— 图是**这条待办自己的内容**，
   *     增删都落 `PATCH /todos/:id` 的 `images` 数组。
   *   · 胶囊：`onPickCapsule` / `onCapConfirm` / `onUnlinkCapsule` —— 胶囊是**别人的记录**，
   *     只是"挂"在这里；增删走 `POST/DELETE /todos/:id/capsules`，
   *     胶囊本体不动（除了 `todoId` / `consumedAt` / `createdAt` 三个字段）。
   *   ⇒ 两条路**不能合并**：图片的"删"是真的从这条待办的内容里拿掉，
   *     胶囊的"取消关联"是把它**放回闪念胶囊列表**（用户口径第 5 条）。
   */

  /**
   * 「+选择胶囊」—— 打开**胶囊选择主抽屉**（宽 320 · 左侧 L1 位 · 多选）。
   *
   * ⚠️ 开抽屉这件事收在 `pagebase.openCapsulePicker()`：抽屉数据的装配（`drawers.build`）
   *    与"哪些抽屉互相排斥"（`drawerFilterOpen` 要收掉）都是页面层的职责，
   *    组件只管"用户点了这个动作"。与「关联脑图」那颗键同一条分工
   *    （`onLinkMindmap` → `pagebase.openMapPicker`）。
   * ⚠️ 守卫写在**这里**也写在模板（`wx:if="{{!detail.deleted}}"`）——
   *    模板管"看不看得见"，这里管"能不能真的走到"，与 `onAddImage` 同一条。
   */
  onPickCapsule: function () {
    const d = this.data.detail;
    if (!d) return;
    if (d.deleted) { wx.showToast({ title: '已删除的待办不能再关联胶囊', icon: 'none' }); return; }
    this.openCapsulePicker();
  },

  /**
   * 抽屉里**点一张卡** ＝ 选中 / 取消选中（多选态：不关抽屉，见 `drawer.onPick`）。
   *
   * ⚠️ 选中集合以**对象**记（`{ [id]: true }`）：wxml 只能 `pickMap[it.id]` 下标取值，
   *    `array.indexOf()` 在模板里用不了（本工程没有 wxs）。
   * ⚠️ 每次都新建一个对象再 setData：原地改 `this.data.drawer.pickMap` 小程序**不会**
   *    认为属性变了（同一引用），症状是"点了没反应"。
   */
  onCapMark: function (e) {
    const id = e.detail && e.detail.id;
    if (!id) return;
    const map = Object.assign({}, (this.data.drawer && this.data.drawer.pickMap) || {});
    if (map[id]) delete map[id];
    else map[id] = true;
    this.setData({ 'drawer.pickMap': map });
  },

  /**
   * 抽屉底部「保存」—— 把这批胶囊**关联**到当前这条待办。
   *
   * ⚠️ 一次 `store.linkCapsulesToTodo()`：本地乐观标掉 ＋ **一条**请求
   *    （服务端在同一事务里写 `todoId` / `consumedAt` 并刷待办 `updatedAt`）。
   *    绝不能写成"逐条 updateTodo ＋ removeCapsules"—— 那会让"关联成功但气泡还在"
   *    变成可能（与 `promoteCapsulesToTodo` 那条"不能拆成建 ＋ 删"同一条纪律）。
   * ⚠️ 收抽屉走 `closeListDrawer()`（它会顺手 `refresh()`），这里**不再**重复 refresh。
   */
  onCapConfirm: function (e) {
    const d = this.data.detail;
    const ids = (e.detail && e.detail.ids) || [];
    if (!d || !ids.length) return;
    store.linkCapsulesToTodo(d.id, ids);
    this.closeListDrawer();
    wx.showToast({ title: '已关联 ' + ids.length + ' 条胶囊', icon: 'none' });
  },

  /** 抽屉底部「取消」—— 这一轮的选择不算数（`pickMap` 随抽屉一起丢掉，不必单独清） */
  onCapCancel: function () {
    this.closeListDrawer();
  },

  /**
   * **取消关联**（详情页胶囊卡右上角那颗 ✕）。
   *
   * 用户口径第 5 条：解除之后胶囊**回到闪念胶囊列表**，且
   * 「这个过程不算新增胶囊，不计入概览统计，此时胶囊信息的创建时间为解除关联的时间」。
   * ⇒ 确认框里必须把这两件事说清楚（尤其"回到列表末尾"：用户会去列表里找它，
   *   不说的话他按原来的时间往上翻，会以为丢了）。
   *
   * ⚠️ 按 **id** 取，不按下标（与 `onImgDel` 同一条）：确认框是异步的，
   *    这几秒里别处可能又增删了一条，下标会错位。
   * ⚠️ 已删除的待办不渲染这颗 ✕，这里再挡一道。
   */
  onUnlinkCapsule: function (e) {
    const d = this.data.detail;
    if (!d) return;
    if (d.deleted) { wx.showToast({ title: '已删除的待办不能再改胶囊', icon: 'none' }); return; }
    const id = e.currentTarget.dataset.id;
    const cap = (d.capsules || []).filter(function (x) { return String(x.id) === String(id); })[0];
    if (!cap) return;

    const self = this;
    wx.showModal({
      title: '取消关联这条胶囊？',
      content: '它不会被删除：会回到闪念胶囊列表的末尾，创建时间按这次解除关联重新记。',
      confirmText: '取消关联',
      success: function (r) {
        if (!r.confirm) return;
        const t = store.todoById(d.id);
        if (!t) { wx.showToast({ title: '这条待办已经不在了', icon: 'none' }); return; }
        if (store.isDeletedTodo(t)) {
          wx.showToast({ title: '已删除的待办不能再改胶囊', icon: 'none' });
          return;
        }
        store.unlinkCapsulesFromTodo(d.id, [id]);
        wx.showToast({ title: '已取消关联', icon: 'none' });
        self.refresh();
      }
    });
  },

  /**
   * 点胶囊卡 ＝ **看全文**（用户口径第 3 条「只能查看」—— 不是"能编辑"，也不是"没反应"）。
   *
   * 卡面正文封 3 行（与选择抽屉同一档），一条长口播在网格里读不全；
   * 这里复用图片那套 `.viewer` 皮肤（黑遮罩 ＋ 圆角卡），只是内容换成一段文字。
   * ⚠️ 不做左右翻：胶囊之间**没有顺序关系**（列表是"什么时候说的"，
   *    这里挂的是"哪几条"，用户不会按"上一张/下一张"想问题）。
   */
  onCapOpen: function (e) {
    this.setData({ capOpen: true, capIndex: Number(e.currentTarget.dataset.i) || 0 });
  },
  onCapClose: function () { this.setData({ capOpen: false }); },

  /**
   * ★★ 263 轮（清单 H4）· 点胶囊全文里那张图 ⇒ **看大图**。
   *
   * 与 `components/capsule` 的 `onPreviewImg` **同一个读法**（`wx.previewImage`，
   * `urls` 只放这一张）—— 清单明写"不要自建灯箱"：手势、返回键、深色底全都归微信管。
   * ⚠️ 模板上是 `catchtap`：这一层外面就是 `viewer-mask`（点它关弹窗），
   *    不 `catch` 的话点图 = 关掉弹窗，图永远看不到。
   */
  onCapViewImg: function (e) {
    const src = (e && e.currentTarget && e.currentTarget.dataset.src) || '';
    if (!src) return;
    wx.previewImage({ urls: [src], current: src });
  }
}));
