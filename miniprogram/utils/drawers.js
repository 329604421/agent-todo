/**
 * 列表类**主弹窗**的数据装配 —— 三模块共用一套形态（FR-8.3）
 *
 *   项目 / 待办 / 脑图 各一个 kind；页面只负责打开与收起，列表形态与文案都在这里定。
 *   几何沿用既有一级抽屉：横屏 320×768 @(84,16) ／ 竖屏 320×(--work-h-port − 18)
 *   @(16, 工作区顶边)（★ 63 轮：竖屏顶边从"遮罩内居中"改成顶着品牌栏下沿）。
 *
 *   ★ 第四十七轮 · 说法统一：宽 320、可独立弹出的这类抽屉统一叫**主弹窗**
 *     （与表单抽屉同一个层级）；宽 260、开在它右侧做联动的叫**副弹窗**
 *     —— 待办列表的「筛选」就是本轮新加的副弹窗，行数据在下面 `*RowsOf` 三支里。
 *
 * V8 相对 V7 的变化：
 *   · 去掉搜索行 —— 一期全是自建数据、量小，列表滚动即可（与 FR-5.4 取消概览搜索同一理由）
 *   · 项目卡改成「四档条数 ＋ 脑图数 ＋ agent 名」，去掉 task / 提问 / 交付三项采集统计
 *   · 项目卡新增「已归档」角标与活跃 / 已归档筛选（FR-2.9 / FR-2.10）
 *   · 待办卡去掉卡片内展开四操作（改由「⋯」菜单与详情页承担，FR-3.8）
 *
 * 82 轮（待办创建入口 · 本次）：
 *   · 待办列表主弹窗的**底部按钮回来了**（`createLabel = '创建待办'`）——
 *     44 轮撤掉它是因为当时"悬浮 Logo 在五个模块里都能记一条"，而那条件在 82 轮作废
 *     （用户口径「点击品牌 logo 均不触发待办创建」）⇒ 这张列表必须自己带创建入口，
 *     否则「从零记一条」这条链路只剩「先点导航 → 再点一次导航 → 拉到底」这种绕法。
 *   · 带作用域的「项目待办-N」同样吃这颗按钮：项目字段由 `scopeId` 预填
 *     （归档项目会被 `pagebase.onDrawerCreate` 的守卫拦住，FR-2.9）。
 *
 * 44 轮（待办列表抽屉）：
 *   · 待办改成**一条流水**、按更新时间倒序，完成态落在卡片上的状态图标
 *   · 待办抽屉**去掉创建入口**（底部按钮 ＋ 头部「记一条」），创建统一走悬浮 Logo
 *     ⚠️ 这条已被第 82 轮推翻，见上。
 *
 * 47 轮（待办列表 ＋ 筛选副弹窗）：
 *   · 标题改「**待办-N**」（N ＝ 当前列表条数）＋ 右侧「筛选」按钮
 *   · 列表走 `store.visibleTodosByUpdated()`（先筛后排），筛空时整组不返回
 *
 * 52+ 轮（项目页专项 · ★ 作用域）：
 *   · `build(kind, scope)` 新增第二参 `scope = { projectId }` —— 项目页的两颗「查看全部」
 *     用它把「项目待办-N」／「项目脑图 N」两张列表**限死在这一个项目内**；
 *     传空仍是全量列表 ⇒ 导航弹出的那张行为一字不改。
 *   · 作用域是**口径**不是**筛选**：带 scope 的待办列表不给「筛选」入口（否则范围会跑出项目）。
 *
 * 56 轮（项目列表专项）：
 *   · 项目标题改「**项目-N**」（N ＝ 当前列表条数），右侧的「新建」换「筛选」
 *     —— 创建入口留在底部那颗「＋ 新建项目」上（与待办抽屉"创建走悬浮 Logo"同一取舍）。
 *   · 项目卡顶部那行「活跃 / 已归档」胶囊**撤掉**（用户口径「顶部的分页气泡去掉，
 *     只显示项目卡片」），它的能力整个搬进筛选副弹窗的「项目状态」一组里 ——
 *     否则已归档项目在这张列表里将再也够不到（FR-2.9 要求归档必须可达）。
 *   · 筛选副弹窗改成**数据驱动**（`tf.groups`）：两个 kind 共用同一个模板，
 *     不再是谁有筛选就手抄一份 wxml（手抄的那份迟早漏一项）。
 */
const store = require('./store');

function closed() {
  return {
    open: false, kind: 'project', title: '', action: '', createLabel: '',
    /* 标题带右侧的「筛选」入口（没筛选的 kind 传空串即不渲染）＋ 副弹窗数据 `tf` */
    filterLabel: '', filterActive: false, tf: null,
    activeId: '', groups: [], empty: '',
    /* ★ 195 轮：列表**分页**（0 ＝ 不分页）—— 见下面 `build()` 里待办那一支 */
    pageSize: 0,
    /* ★ 52+ 轮（项目页专项）：作用域 —— `{ projectId }` 表示"只列这个项目下的内容"。
       项目页的「查看全部」走它；空 ＝ 全量列表（三模块默认入口）。 */
    scope: null, scopeId: '',
    /* ★ 82 轮：picker 态 —— 'todo' 表示"这张抽屉是在为某条待办挑关联脑图"。
       判别由页面做（`pagebase.onDrawerPick` / `onDrawerCreate`），组件不认识它。
       空串 ＝ 普通列表（点一条 ＝ 去看那条）。
       ★★ 248 轮：`'capsule'` ＝ "这张抽屉是在为某条待办挑闪念胶囊"（多选）。
       注意它**不是**靠 `picker` 字段让组件变形的 —— 组件认的是下面那三颗
       （`multi` / `cancelLabel` / `pickMap`）；`picker` 只给页面自己分流。 */
    picker: '',
    /* ★★ 248 轮：**多选确认**态（闪念胶囊的选择抽屉专用）。
       · `multi`        —— 点卡片只记选中、不关抽屉（`drawer.js` 的 `onPick` 分流）；
       · `cancelLabel`  —— 非空就在底部多一颗「取消」（多选必须有"什么都不做"的出口）；
       · `pickMap`      —— `{ [id]: true }` 选中集合。**用对象而不是数组**：
         wxml 只能做 `pickMap[it.id]` 这种下标取值，`array.indexOf()` 在模板里不可用
         （本工程没有 wxs，为这一处引一个不值得）。
       ⚠️ 三个默认值必须与"旧行为"逐字等价：空串 / false / 空对象 ⇒
          其余四张列表的模板判定与改前一个字都不差。 */
    multi: false, cancelLabel: '', pickMap: {}
  };
}

/**
 * 项目卡的装配 —— ★ 第 63 轮起**转调 `store.projectCardView`**，这里不再自己拼。
 * 原因：概览「项目待办统计」按 FR-5.2 要「复用项目卡片」，改成同一个形状之后
 * 两边各写一份就等着漂（改一边漏一边，本工程已踩过两次）⇒ 唯一真源收在 store，
 * 项目列表主弹窗与概览各取同一份。
 */
function packProjectCard(p) { return store.projectCardView(p); }

/**
 * 待办卡的装配（★ 44 / 45 / 46 轮）
 *   · 44 轮：列表按更新时间排成**一条流水**，完成态落在卡片的状态徽章上。
 *   · 45 轮：卡片改成三段 ——
 *       正文 ／ **标签行**（归属项目 ＋ 关联脑图）／ **底行**（创建9-21 · 未完成 · 更新9-22）。
 *     项目名与脑图名**各截 7 个可见字**（超出补省略号）：抽屉只有 320 宽，
 *     两个长名字挤一行会互相顶掉，谁也读不全。
 *   · 46 轮：底行收敛成两项 —— 左「**更新于 2026-09-22 17:30**」（全量时间，不再是 9-21 短写）
 *     右「完成状态」。创建时间去掉：列表已经是按更新时间倒序的一条流水，
 *     卡上再摆一条创建时间等于给了两套时间轴。
 *   · 54 轮：标签行补回**图片数**（`N 张图`）——
 *     详情页与项目页的卡都早有这一颗，只有抽屉这张手写卡漏了。
 */
function packTodoItem(t) {
  const u = store.urgencyOf(t.urgency);
  const p = store.projectById(t.projectId);
  const m = t.mindmapId ? store.mindmapById(t.mindmapId) : null;
  const c = p && p.color ? store.colorOf(p.color) : null;
  return {
    id: t.id,
    text: t.text,
    urgency: t.urgency,
    bar: u.main,
    done: !!t.done,
    /* ★★ 160 轮：这张卡是不是一条**已删除**的待办 —— 它只可能出现在「已删除」那一档里，
       卡片据此换一颗徽章（`.dw-td-del`）并把正文压灰。
       ⚠️ 判据走 `store.isDeletedTodo()`，不在这里读 `t.deletedAt`（全工程只认一种写法）。 */
    deleted: store.isDeletedTodo(t),
    projectName: p ? store.clip(p.name, 7) : '',
    projectColor: c ? c.main : store.noneColor(),
    projectArchived: store.isArchived(p),
    mindmapName: m ? store.clip(m.name, 7) : '',
    /* ★ 54 轮：图片数 —— 与 todo-card 的 `tchip.img`、详情页「图片 N」同一口径 */
    imgCount: (t.images || []).length,
    /* ★ 46 轮：**全量时间**（2026-09-22 17:30）—— 与详情页「创建于 …」同一口径
       ⚠️ `atMin()` 是这条口径的落点：存储是秒精度，不截会变成 17:30:41。 */
    updated: store.atMin(t.updatedAt),
    /* ★★ 199 轮：**「刚转过来」** —— 从胶囊转出来的那条带一层紫色填充，直到用户打开它的详情。
       ⚠️ 判据是 `flashAt` 非空（`adaptTodo()` 已把后端的 null 归一成空串）——
          不要在这里读 `createdAt` 或"多久之内"去现算：那是**前端缓存式**的判断，
          换一台设备打开就变样了，而这条状态是**跨端**的（用户 2026-10-15 明确要求落库）。 */
    fresh: !!t.flashAt
  };
}

/* ============ 筛选副弹窗的行数据（★ 47 轮待办 ／ ★ 56 轮起项目也有）============
 * 副弹窗只有 260 宽，所以形态只有三种，由 `tf.groups[].type` 决定：
 *   · `chips`       —— 胶囊，短标签（状态 / 时间 / 节点）；`wrap:true` 允许换行，
 *                      `fill:true` 则两两成行（`最近3个月` 比其余三个宽，四个排一行会把它挤掉）
 *   · `rows`        —— **一行一个**（所属项目 / 关联 agent）。跟表单里的「归属项目」同一个理由：
 *                      胶囊在这个宽度里会挤成两三行，认不出选的是哪个。
 * 组本身是**数据**不是模板 —— 两个 kind 共用同一份 wxml，谁也不必手抄一份
 * （手抄的那份迟早漏一项，这是我们在这个工程里已经踩过两次的坑）。
 *
 * 行数据的 value 口径（落到 `setXxxFilter` 的就是它）：
 *   · 胶囊组：`key` 直接就是存储值（'all' ＝ 不筛）
 *   · 行组：`id` 是**行**的 id；哨兵 `__all`（「全部」那一行）由组件翻成空串 ——
 *           `wx:key` 不能是空串，所以行数据里必须放一个非空哨兵
 */

/**
 * 待办状态 —— ★★ 160 轮改成**三档、且没有「全部」**（用户口径：
 * 「筛选弹窗中待办状态为"未完成""已完成""已删除"三个状态」）。
 *
 * 三档**互斥且完备**（每条待办恰好属于一档）⇒ 原来的 `all` 留着就会与"三档"打架。
 * ⚠️ 档名与中文名**从 `store.todoStatusOptions()` 来**（唯一真源），这里一个字不抄 ——
 *   加一档/改一次文案只动 store 那一处，副弹窗自动跟上（与 156 轮「urgChips 不手抄档名」同一条）。
 * ⚠️ 顺序由 store 决定：**默认档（未完成）排最前**（与 `pjStatusRowsOf` 的"默认项排最前"同一条原则）。
 */
function statusRowsOf(sel) {
  return store.todoStatusOptions().map(function (o) {
    return { key: o.key, label: o.label, selected: o.key === sel };
  });
}

/**
 * 所属项目 —— **只列有颜色的项目**（用户口径「有颜色的项目分列」），一行一个：
 * 色点 ＋ 名称 ＋ 该项目的待办条数。
 *   · 条数是为了「0 条」也能自证 —— 否则选中一个空项目会看着像筛选坏了。
 *   · 没有颜色的项目（如归档后的临时项目）不出现在这里；它们的待办仍在「全部」里，不会丢。
 * ⚠️「全部」那一行的 id 用哨兵 `__all` 而不是空串 —— `wx:key` 空值会报警告
 *    （与三级脑图抽屉里「不关联」用 `__none` 是同一个坑）。
 */
function projectRowsOf(sel) {
  /* ★★ 160 轮：「全部」那行的条数改用 `aliveTodos()` —— 原来读 `state.todos.length`，
     会把**已删除**的也算进来，于是"全部"比各行之和还大（下面每行读 `todosOfProject()`，
     它已经滤掉已删除）。两处口径必须一样，否则用户会看成"筛选坏了"。 */
  const rows = [{ id: '__all', name: '全部', color: '', count: store.aliveTodos().length }];
  store.activeProjects().forEach(function (p) {
    if (!p.color) return;
    const c = store.colorOf(p.color);
    rows.push({
      id: p.id, name: p.name, color: c ? c.main : store.noneColor(),
      count: store.todosOfProject(p.id).length
    });
  });
  return rows.map(function (r) {
    return Object.assign({}, r, { selected: String(r.id) === String(sel || '__all') });
  });
}

function rangeRowsOf(sel) {
  return [
    { key: 'all', label: '全部' },
    { key: 'w1', label: '最近一周' },
    { key: 'm1', label: '最近一月' },
    { key: 'm3', label: '最近3个月' }
  ].map(function (r) { return Object.assign({}, r, { selected: r.key === sel }); });
}

/* ---- 项目筛选的三组行（★ 56 轮）----
 * 位置关系：这一组原来是项目卡**顶部那行胶囊**（活跃 / 已归档），
 * 用户口径「顶部的分页气泡去掉，只显示项目卡片」⇒ 能力搬进副弹窗，
 * 一个不丢：状态 → 「项目状态」，另有新加的「节点」与「关联 agent」。
 */

/**
 * 项目状态 —— **默认项（活跃）排最前**。这条排法与待办那边「全部排最前」是同一条原则：
 * 副弹窗打开时被选中的那一项要在第一眼的位置，否则用户得先反问"为什么是这些"。
 */
function pjStatusRowsOf(sel) {
  return [
    { key: 'active', label: '活跃' },
    { key: 'archived', label: '已归档' },
    { key: 'all', label: '全部' }
  ].map(function (r) { return Object.assign({}, r, { selected: r.key === sel }); });
}

/** 节点 —— 「全部」＋ 四个节点值（真源 `projectNodes()`，不在这里手抄那四个词） */
function pjNodeRowsOf(sel) {
  const rows = [{ key: 'all', label: '全部' }];
  store.projectNodes().forEach(function (n) { rows.push({ key: n, label: n }); });
  return rows.map(function (r) { return Object.assign({}, r, { selected: r.key === sel }); });
}

/**
 * 关联 agent —— 一行一个（与「所属项目」同一形态）。行尾那个数字是"这个 agent 名下
 * 有几个项目"，让「0」也能自证（选中一个没项目的 agent 不会看着像筛选坏了）。
 * ⚠️ 存储口径是 `'all'`（`pFilter.agentId`），所以哨兵直接用 `'all'`，
 *    不像「所属项目」那样用 `__all`（那个字段的空值口径是空串）。
 */
function pjAgentRowsOf(sel) {
  const rows = [{ id: 'all', name: '全部', color: '', count: store.state.projects.length }];
  store.state.agents.forEach(function (a) {
    rows.push({
      id: a.id, name: a.name, color: '',
      count: store.state.projects.filter(function (p) { return p.agentId === a.id; }).length
    });
  });
  return rows.map(function (r) {
    return Object.assign({}, r, { selected: String(r.id) === String(sel || 'all') });
  });
}

/* ---- 脑图筛选的三组行（★ 本轮新增） ----
 * 顺序与待办那张同一条节奏：**胶囊 → 行 → 胶囊**（短的在上、高的在中、短的收尾）。
 */

/**
 * 所属脑图的项目行 —— 与待办的「所属项目」同一形态（色点 ＋ 名称 ＋ 条数），
 * 但条数数的是**脑图张数**：同一个"项目"在两张列表里报的是不同的东西，
 * 复用那一个函数会让待办那张列表的数字被脑图列表改掉。
 * ⚠️「全部」那一行的 id 用哨兵 `__all` —— `mFilter.projectId` 的空值口径是**空串**，
 *    `wx:key` 又不接受空串（与待办那张同一个坑）。
 */
function mmProjectRowsOf(sel) {
  const rows = [{ id: '__all', name: '全部', color: '', count: store.state.mindmaps.length }];
  store.activeProjects().forEach(function (p) {
    if (!p.color) return;
    const c = store.colorOf(p.color);
    rows.push({
      id: p.id, name: p.name, color: c ? c.main : store.noneColor(),
      count: store.mindmapsOfProject(p.id).length
    });
  });
  return rows.map(function (r) {
    return Object.assign({}, r, { selected: String(r.id) === String(sel || '__all') });
  });
}

/**
 * 格式 —— 六种 ＋「全部」。**行数据从 `store.mindmapFormats()` 来**，
 * 这里不手抄那六个中文名：加一种格式（`utils/formats.js` 加一行）这张副弹窗自动跟上。
 * 行尾的数字是"这个格式有几张" —— 让「0」也能自证，否则选中一个空的格式会看着像筛选坏了。
 * （胶囊组不带数量显示，所以数字挂在 label 里，与「全部」的写法一致。）
 */
function mmFormatRowsOf(sel) {
  const rows = [{ key: 'all', label: '全部' }];
  const list = store.mindmapFormats();
  const all = store.state.mindmaps;
  list.forEach(function (f) {
    const n = all.filter(function (m) { return store.formatKeyOf(m) === f.key; }).length;
    rows.push({ key: f.key, label: f.label + (n ? '' : ' 0') });
  });
  return rows.map(function (r) { return Object.assign({}, r, { selected: r.key === sel }); });
}

/* ---- 带 scope 的待办列表：标题与空态文案（★★ 160 轮）----
 * 三档各自的说法，键就是 `store.TODO_STATUSES` 的那三个词。
 * ⚠️ 这两张表**只管带 scope 的那张抽屉**（项目页的「已完成待办」这类"半列表"）：
 *    不带 scope 的待办列表，档位由筛选副弹窗表达（标题栏只报条数 ＋ 一颗「筛选 N」），
 *    文案不在这里。
 * ⚠️ 没给 status（＝不切）时两张表都取不到值 ⇒ 各自落到 156 轮那句老文案
 *    （「项目待办-N」／「这个项目还没有待办…」），行为与那一轮完全一致。
 */
const SCOPE_TODO_TITLE = {
  open: '未完成待办-',
  done: '已完成待办-',
  deleted: '已删除待办-'
};
const SCOPE_TODO_EMPTY = {
  open: '这个项目还没有未完成的待办',
  done: '这个项目还没有已完成的待办',
  deleted: '这个项目没有已删除的待办'
};

/** 装配一个列表主弹窗的数据
 * @param {string} kind  project | todo | mindmap
 * @param {object} [scope]  作用域 —— 两个**正交**字段，可单用也可并用：
 *        · `{ projectId }`（★ 52+ 轮）—— 把待办 / 脑图两张列表**限死在这一个项目内**；
 *        · `{ status }`（★★ 160 轮，取代 156 轮的 `done:true`）—— 待办列表**只列这一档**，
 *          取值就是 `store.TODO_STATUSES`（`open` / `done` / `deleted`），
 *          与筛选副弹窗那三档**同一套词**；不给 ＝ 不切（这个项目的全部**未删除**待办）；
 *        · 传空 ＝ 全量列表（点导航弹出的那张），行为与 47 轮完全一致。
 *   ⚠️ 作用域是**列表口径**、不是筛选条件 —— 待办那张带上 scope 之后「筛选」按钮整颗不渲染
 *      （筛选副弹窗里的「所属项目」会把范围放到本项目之外，两者语义打架）。
 */
function build(kind, scope) {
  const ui = store.state.ui;
  const scopeId = (scope && scope.projectId) || '';

  /* ★★ 248 轮：**选择胶囊**（待办详情页「+选择胶囊」开的主弹窗）——
   * 用户口径：「点击『+选择胶囊』弹出选择胶囊的抽屉（主抽屉），卡片显示当前胶囊列表卡片，
   * 可多选卡片，底部按键为『取消』『保存』，**无胶囊新增按钮**」。
   *
   * ── 为什么它也该走这份装配 ────────────────────────────────────────
   *   壳与其余四张列表**完全一样**（宽 320 主弹窗 / 标题行 / 卡片列表 / 底部动作区），
   *   差别只有三处，且全部由装配层给值（组件一行 kind 判定都不用加在壳上）：
   *     · `kind: 'capsule'` ⇒ 模板走胶囊卡那一支（见 drawer.wxml 的 D 段）；
   *     · `createLabel: ''` ⇒ **底部没有「＋ 新建」**（用户明写"无胶囊新增按钮"：
   *       胶囊是"接住"出来的，不是在这儿新建的；录音入口在闪念胶囊自己那儿）；
   *     · `multi` ＋ `cancelLabel` ＋ `confirmLabel` ⇒ 点卡片只记选中、底部「取消」「保存」。
   *
   * ⚠️ 候选是 `store.capsules()`（**正常名单**）—— 已经关联到某条待办、已被转成待办 /
   *    脑图、已被手动删除的那批**都不在**里面（三种都由 `isGoneCapsule()` 挡住）。
   *    这正是用户口径第 4 条要的："建立关联时，胶囊信息需要从闪念胶囊中移除"。
   * ⚠️ 排序跟胶囊列表**同一把尺**（创建时间正序）：在待办里挑胶囊时，用户脑子里的顺序
   *    就是他在闪念胶囊里看到的那一列（`store.capsules()` 已经排好，这里不许再排一次）。
   * ⚠️ 没有胶囊时给一句**说明**而不是留白：这句话是在告诉他"先去把想法记下来"，
   *    而不是"这个功能坏了"。
   */
  if (kind === 'capsule') {
    const caps = store.capsules();
    return {
      open: true, kind: 'capsule',
      scope: null, scopeId: '',
      title: '选择胶囊-' + caps.length,
      action: '',
      createLabel: '',
      filterLabel: '', filterActive: false, tf: null,
      activeId: '',
      empty: '闪念胶囊里还没有待整理的内容',
      pageSize: 0,
      groups: caps.length
        ? [{ key: 'g-all', label: '', dot: '', archived: false, items: caps.map(store.capsuleCardView) }]
        : [],
      picker: 'capsule',
      multi: true,
      cancelLabel: '取消',
      confirmLabel: '保存',
      pickMap: {}
    };
  }

  /* ★★ 160 轮：作用域里的"哪一半"从 156 轮的布尔 `done` 改成**三档 `status`**。
     两者说的是同一件事（"这个项目的哪一部分待办"），留两套写法迟早在某一处对不上
     （本工程在这类问题上已经踩过两次）⇒ 统一成与筛选副弹窗**同一套词**，判定也共用
     `store.pickTodosByStatus()`。
     ⚠️ 非法值一律当"不切"（＝ 156 轮「项目待办-N」那个口径），装配口不该因为一个错值
        就崩、或者列出别的东西来。 */
  const scopeStatus = store.isTodoStatus(scope && scope.status) ? scope.status : '';

  if (kind === 'project') {
    const f = store.projectFilter();
    const n = store.projectFilterCount();
    const list = store.visibleProjects();
    return {
      open: true, kind: 'project',
      scope: null, scopeId: '',
      /* ★ 56 轮：标题改「**项目-N**」（N ＝ 当前列表条数，与「待办-N」同一口径），
         右侧的「新建」换「筛选」—— 创建入口留在底部那颗「＋ 新建项目」上
         （与待办抽屉"创建走悬浮 Logo"是同一个取舍：一张列表里两颗键，"新建"与"筛选"
         同时挂着会让人以为筛选也是一种创建）。 */
      title: '项目-' + list.length,
      action: '',
      createLabel: '新建项目',
      filterLabel: n ? '筛选 ' + n : '筛选',
      filterActive: n > 0,
      tf: {
        kw: f.kw,
        ph: '搜项目名',
        activeCount: n,
        groups: [
          { key: 'status', label: '项目状态', type: 'chips', rows: pjStatusRowsOf(f.status) },
          { key: 'node', label: '节点', type: 'chips', wrap: true, rows: pjNodeRowsOf(f.node) },
          { key: 'agentId', label: '关联 agent', type: 'rows', rows: pjAgentRowsOf(f.agentId) }
        ]
      },
      activeId: ui.projectId,
      /* ★ 195 轮：项目列表**不分页**（`0`）—— 分页这一轮只开在待办那张（用户口径
         针对的就是"已完成的待办堆得太长"）；项目卡信息量大、条数天然少。 */
      pageSize: 0,
      /* 筛空 / 真的没有 / 只是活跃为空 —— 三件事分开说：
         第三种尤其重要（活跃一个都没有但确实有已归档项目时，说"还没有项目"是假话）。 */
      empty: n
        ? '没有符合条件的项目'
        : (store.archivedProjects().length
          ? '活跃项目一个都没有 —— 用「筛选」看已归档'
          : '还没有项目，点下面的按钮建一个'),
      groups: list.length
        ? [{ key: 'g-all', label: '', dot: '', archived: false, items: list.map(packProjectCard) }]
        : []
    };
  }

  /**
   * 待办列表抽屉（★ 44 轮改版 · 47 轮加筛选）
   *   · **一条流水**：不再分「未完成 / 已完成」两组 —— 分组的代价是刚勾掉的那条会立刻
   *     跳到下半屏，手会丢；现在按 `updatedAt` 倒序，勾完就停在你眼前。
   *   · 完成态改由**卡片自带的图标**表达（未完成＝空心圆／已完成＝圆圈含勾，47 轮起），
   *     标题只报条数。
   *   · **创建入口**：底部一颗「＋ 创建待办」（★ 82 轮恢复）——
   *     44 轮曾把它拿掉，理由是"悬浮 Logo 在五个模块里都能直接记一条，
   *     抽屉里再来一个只会叠出多层主弹窗"；82 轮用户口径「点击品牌 logo 均不触发待办创建」
   *     把那个前提推翻了 ⇒ 抽屉必须自己带创建入口，否则「从零记一条」再也没有落点。
   *     ⚠️ 头部「记一条」**仍然不给**（`action` 传空串）：标题带右侧留给「筛选」一颗，
   *        两张列表（待办 / 项目）的头右现在是同一套读法。
   *   · ★ 47 轮：标题改「**待办-N**」，N ＝**当前列表里的条数**（筛过就是筛后的数）——
   *     筛完一眼就知道还剩几条，"筛选有没有生效"不用去数卡片；右侧挂「筛选」按钮。
   *   · ★ 52+ 轮（项目页专项）：带 `scope.projectId` 时列表**限死在这个项目内**、
   *     标题改「**项目待办-N**」、**不给筛选入口**（口径固定，再筛就跑到项目外了）。
   *   · ★ 82 轮：**底部创建入口「＋ 创建待办」**（同时**推翻** 44 轮"抽屉不给创建入口"那条，
   *     理由见上；带作用域时同样给，项目字段按 scope 预填）。
   *   · ★ 156 轮：带 `scope.done` 时**只列已完成的**、标题改「**已完成待办-N**」
   *     （项目页底行那颗按钮从「查看全部」改名成「已完成待办」）。
   *   · ★★ 160 轮：`scope.done` **换成 `scope.status` 三档**（与筛选副弹窗同一套词），
   *     切的那一刀转调 `store.pickTodosByStatus()` —— 口径只有一份。
   *     ⚠️ 与 `projectId` 是正交的两个字段，可单用也可并用；
   *     ⚠️ 底部那颗「＋ 创建待办」**保留** —— 它是本项目"带着项目预填写一条"的唯一落点
   *        （82 轮那条理由没变）。所以这张抽屉的读法是"这一半待办 ＋ 在这里再记一条"。
   */
  if (kind === 'todo') {
    /* 基准数据 —— **两条路**（scope 是口径，不带筛选副弹窗那套条件）：
       · 带 scopeId（项目页那两张"半列表"）：按项目取，再只按 status 切一刀。
         ⚠️ 三档里只有「已删除」那一档要看得见已删除的，另两档读 `todosOfProject()`
            （它已经把已删除的滤掉了）。
       · 不带 scopeId 但给了 status（**全局某一档**）：src 用全量，切片交给
         `pickTodosByStatus()`（同样只有 `deleted` 档看得见已删除的）。
         ⚠️ 这一支**当前没有调用点**（项目页那两颗键都带 `projectId`，全局三档走筛选副弹窗），
            留着是因为标题那一行已经按 `scopeStatus` 分支了 —— 若列表这边不切，
            就成了"标题写着『已删除待办-10』、里面全是未完成的"这种**自相矛盾**的抽屉。
            宁可让这条路自洽，也不给将来留一颗只改标题不改内容的雷。
       · 两个都没有（导航弹出的那张）：整条走筛选出口，三档判定在 `filterTodos()` 里。 */
    const src = scopeId
      ? (scopeStatus === 'deleted'
        ? store.deletedTodos().filter(function (t) { return t.projectId === scopeId; })
        : store.todosOfProject(scopeId))
      : (scopeStatus ? store.state.todos : null);
    const all = src
      ? store.sortTodosByUpdated(store.pickTodosByStatus(src, scopeStatus))
      : store.visibleTodosByUpdated();
    const f = store.todoFilter();
    const n = scopeId ? 0 : store.todoFilterCount();
    return {
      open: true, kind: 'todo',
      scope: scope || null, scopeId: scopeId,
      /* ⚠️ `status` 那一支**写在最外层**：它比"哪个项目"更特殊 ——
         只给 `status:'done'` 不带 `projectId`（全局已完成）时标题也该读作「已完成待办-N」。 */
      title: (SCOPE_TODO_TITLE[scopeStatus] || (scopeId ? '项目待办-' : '待办-')) + all.length,
      action: '',
      createLabel: '创建待办',
      filterLabel: scopeId ? '' : (n ? '筛选 ' + n : '筛选'),
      filterActive: n > 0,
      tf: scopeId ? null : {
        kw: f.kw,
        ph: '搜待办关键词',
        activeCount: n,
        groups: [
          { key: 'status', label: '待办状态', type: 'chips', rows: statusRowsOf(f.status) },
          { key: 'projectId', label: '所属项目', type: 'rows', rows: projectRowsOf(f.projectId) },
          /* ★ 56 轮：组的键名 ＝ **存储字段名**（status / projectId / range / node / agentId），
             组件把它原样抛回来，页面按 kind 派给 `setTodoFilter` / `setProjectFilter`。 */
          { key: 'range', label: '更新时间', type: 'chips', wrap: true, fill: true, rows: rangeRowsOf(f.range) }
        ]
      },
      activeId: ui.todoId,
      /* ★★ 195 轮 · **列表分页**（用户口径 2026-10-14）：
         待办那几张列表（`待办-N` ／ `项目待办-N` ／ `已完成待办-N` ／ `已删除待办-N`）
         一屏先铺 10 条，末尾「点击加载更多」再铺 10 条，铺完换成「已无更多信息」。
         ⇒ 值从这里出（组件 `pageSize` 属性），四条列表同一套；别的 kind 一律 0。
         ⚠️ 这是**列表口径**、不是筛选条件，所以它跟着 kind 走、不进 `tf`。 */
      pageSize: 10,
      /* 筛空 ≠ 没有待办 —— 两句要分开说，否则用户会以为数据丢了。
         带 scope 时只有"这个项目这一档是空的"一种空态（它压根不可筛）。 */
      empty: scopeId
        ? (SCOPE_TODO_EMPTY[scopeStatus] || '这个项目还没有待办，点下面的按钮创建一条')
        /* ★ 「全局某一档」那一支（见上面 `src` 的说明）：空态也得跟着那一档说 ——
           否则会读到"还没有待办，点下面的按钮创建一条"（假的：待办多得很，只是这一档空）。
           ⚠️ 与项目那一支**故意不同字**：这里没有"这个项目"这个限定词。 */
        : (!n && scopeStatus
          ? '没有' + (scopeStatus === 'done' ? '已完成' : (scopeStatus === 'deleted' ? '已删除' : '未完成')) + '的待办'
          : (n
            /* 「已删除」那一档单独给一句：它是**还原的唯一入口**，用户开这一档就是来找东西的，
               报"没有符合条件的待办"会让人怀疑是筛选坏了。⚠️ 只在**只有状态这一项生效**时说
               （`n === 1`）—— 关键词/项目/时间也生效时，就是"条件凑不出结果"，与档位无关。 */
            ? (n === 1 && f.status === 'deleted' ? '没有已删除的待办' : '没有符合条件的待办')
            : '还没有待办，点下面的按钮创建一条')),
      /* 筛空时**整组不返回**：留一个空组会走到「这个分组下暂时是空的」那句，
         而 `.dw-empty` 只在 groups 为空时才渲染 */
      groups: all.length
        ? [{ key: 'g-all', label: '', dot: '', archived: false, items: all.map(packTodoItem) }]
        : []
    };
  }

  /* 脑图行（列表 ／ 项目页「查看全部」共用同一份装配 —— 只写一次，两处不会长歪）
     ★ 本轮：装配转 **`store.mindmapCardView`** —— 与 63 轮项目卡"转调 `store.projectCardView`"
     同一个理由：脑图卡现在同时出现在「脑图列表」与「项目页 → 查看全部」两处，
     各写一份就等着漂（改一边漏一边，本工程已踩过两次）。
     ⚠️⚠️ **这里不带 `lock`**（「转脑图」那条路才有，见 `buildMindmapPick`）：
        同一张脑图卡在**脑图模块的列表**里是"打开它"的入口，拦它的是 `guardMindmapOpen`
        那句 toast（页面侧，会告诉你"还在生成中"）。在这里顺手挂上锁，
        点了会被抽屉直接吞掉（`locked` 事件没人接）—— 症状正是"点了没反应"。 */
  function packMindmapItem(m) { return store.mindmapCardView(m); }

  /* ★ 52+ 轮（项目页专项）：项目页的「查看全部」—— 只列这个项目下的全部脑图。
     不再分组（组头本来就是在报"这是哪个项目的"）。
     ⚠️ 带作用域的列表**不给筛选**（作用域是口径不是筛选，再筛就跑到项目外了）——
        与待办那张同一条守卫。
     ★★ 174 轮（用户口径 · 与「选择关联脑图」两处一起对齐）：
       · 标题改「**项目脑图-N**」—— 四张列表里只有它写成空格分隔的「项目脑图 N」，
         其余（`项目-N` / `待办-N` / `项目待办-N` / `脑图-N`）一律是**横杠**收尾。
         同一套读法不留特例，否则"标题和计数之间"在两张抽屉里长得不一样。
       · **头部那颗「新建」拿掉**（`action: ''`）—— 用户口径「标题栏中的新建按钮应去掉
         （底部已有新建按钮）」。这张列表底部本来就有「＋ 新建脑图」（`createLabel`，
         项目字段按 `scopeId` 预填，见 pagebase），头部再来一颗是同一件事的第二个入口。
         ⚠️ **能力一个没少**：创建入口只剩一颗（底那颗），归档项目的守卫也照旧走
            `pagebase.onDrawerCreate` —— 那里读的是 `scopeId`，与头部那颗按钮无关。 */
  if (scopeId) {
    const ms = store.sortMindmapsByUpdated(store.mindmapsOfProject(scopeId));
    return {
      open: true, kind: 'mindmap',
      scope: scope || null, scopeId: scopeId,
      title: '项目脑图-' + ms.length,
      action: '',
      createLabel: '新建脑图',
      filterLabel: '', filterActive: false, tf: null,
      activeId: ui.mindmapId,
      empty: '这个项目还没有脑图，点下面的按钮新建一张',
      /* ★ 195 轮：脑图列表不分页（与项目列表同一条：这一轮只开待办那张） */
      pageSize: 0,
      groups: ms.length
        ? [{ key: 'g-0', label: '', dot: '', archived: false, items: ms.map(packMindmapItem) }]
        : []
    };
  }

  /**
   * 脑图列表主弹窗（★ 本轮改版）
   *   · **一条流水**：原来按项目分组（`mindmapGroups`），组内有序但整条列表不是全局有序，
   *     一眼扫下来读不出"我最近在写哪张"。用户口径「按更新时间倒序」⇒ 拍平成一条流水。
   *   · 项目身份改由**卡片自己带**（色点 ＋ 项目名 ＋ 已归档），所以不再需要组头。
   *   · 卡片补**格式**（缩略图 ＋ 中文名）—— 与「格式」主弹窗、表单里的格式字段同一份目录。
   *   · 标题改「**脑图-N**」（与「待办-N」「项目-N」同一口径），右侧「新建」换「筛选」
   *     —— 创建入口留在底部那颗「＋ 新建脑图」上（三张列表现在都是"标题 ＋ 筛选"）。
   *   · 筛空 ≠ 没有脑图 —— 两句分开说，否则用户会以为数据丢了。
   */
  const f = store.mindmapFilter();
  const n = store.mindmapFilterCount();
  const list = store.visibleMindmaps();

  return {
    open: true, kind: 'mindmap',
    scope: null, scopeId: '',
    title: '脑图-' + list.length,
    action: '',
    createLabel: '新建脑图',
    filterLabel: n ? '筛选 ' + n : '筛选',
    filterActive: n > 0,
    tf: {
      kw: f.kw,
      ph: '搜脑图名',
      activeCount: n,
      groups: [
        { key: 'format', label: '格式', type: 'chips', wrap: true, rows: mmFormatRowsOf(f.format) },
        { key: 'projectId', label: '所属项目', type: 'rows', rows: mmProjectRowsOf(f.projectId) },
        { key: 'range', label: '更新时间', type: 'chips', wrap: true, fill: true, rows: rangeRowsOf(f.range) }
      ]
    },
    activeId: ui.mindmapId,
    empty: n ? '没有符合条件的脑图' : '还没有脑图，点下面的按钮新建一张',
    /* ★ 195 轮：脑图列表不分页（与项目列表同一条：这一轮只开待办那张） */
    pageSize: 0,
    groups: list.length
      ? [{ key: 'g-all', label: '', dot: '', archived: false, items: list.map(packMindmapItem) }]
      : []
  };
}

/**
 * ★★ 280 轮 · 「选择脑图」抽屉里那张 **lead 卡**（语义转脑图）的 id。
 *
 * 用一个不可能与真脑图 id 撞的串当 id：它走的是同一套 `data-id` / `pickedId` 机制
 * （`drawer.onPick` 只认 `data-id`），所以**不需要给抽屉组件加"这张卡不是脑图"的概念** ——
 * 组件只负责报"选中了谁"，是不是脑图由胶囊那边判。
 */
const AI_PICK_ID = '__ai';

/** lead 卡的数据 —— 形态与脑图卡不同（没有项目 / 格式 / 节点数），所以自带一套字段 */
function aiPickItem() {
  return {
    id: AI_PICK_ID,
    lead: true,
    name: '语义转脑图',
    desc: '把选中的胶囊交给模型，按语义重组成一张新脑图'
  };
}

/**
 * ★★ 280 轮（用户 2026-10-27）· 「这张脑图为什么不能选」—— **唯一一份话术**。
 *
 * 两处会撞上它：抽屉里点了一张锁住的卡（`locked` 事件）、按下「确定」的那一帧发现
 * 靶子刚好变成不可选（`onMapConfirm` 的复检）。两处各写一句，迟早一句改了另一句没改。
 * ⚠️ 文案口径：说清"现在该干什么"，不报内部状态名（不写 `aiState` / `pending`）。
 */
const PICK_LOCK_TIP = {
  pending: '这张脑图还在生成中，稍后再选',
  failed: '这张脑图生成失败，重试生成后再选',
  incomplete: '这张脑图还没完善（归属项目 / 格式），完善后再选'
};

function pickLockTip(state) {
  return PICK_LOCK_TIP[state] || '这张脑图暂时不能选';
}

/**
 * 「选择脑图」抽屉的完整数据（**只有闪念胶囊那条路用**）。
 *
 * 为什么不直接复用 `build('mindmap')` 的返回值：
 *   · 要在**最前面**插一张 lead 卡（`build` 是给脑图模块的列表用的，那儿不该有这张）；
 *   · 一张脑图都没有时**仍然要有 lead 卡** —— 否则"新用户第一次用语义转脑图"
 *     会被一句"一张脑图都还没有"挡在门外，而那正是这个功能最该被用起来的时刻。
 *     ⇒ 所以 `groups` 恒有一组，空态文案传空串（`drawer` 判的是 `!groups.length`）。
 * ⚠️ 标题里的 `N` **不数 lead 卡**（它报的是"你有几张脑图"，与 `脑图-N` 同一条口径）。
 *
 * ★★ 280 轮（用户 2026-10-27）· **生成中 / 生成失败 / 未完善的图不能被选中**。
 *   它们**照旧画出来**（不过滤）：用户需要看见"我那张图正在生成中"——
 *   直接从列表里消失会读成"我刚建的那张没了"。
 *
 *   ⚠️⚠️ 锁**只在这一条路上加**（不放进 `packMindmapItem`）：同一张卡在脑图模块的
 *      管理列表里是"打开它"的入口，那里拦人的是 `guardMindmapOpen` 那句话；
 *      把锁挂到共用装配上，管理列表点一张生成中的卡会被抽屉吞掉（`locked` 没人接），
 *      症状是"点了没反应"—— 比原来那句 toast 还糟。
 */
function buildMindmapPick() {
  const d = build('mindmap');
  const raw = d.groups.length ? d.groups[0].items.slice() : [];
  const n = raw.length;
  /* 三个字段（模板与抽屉都只认这三个）：
       `lock`    状态键（'' ／ 'pending' ／ 'failed' ／ 'incomplete'）—— 模板据此压亮度、
                 抽屉据此决定"这一下算不算数"；
       `lockTip` 给用户看的那句话（点卡 / 按下「确定」时撞上都用它）；
       `lockTag` 卡面那枚 chip —— **只有「未完善」有**：生成中 / 生成失败底行
                 已经写着（"生成中，稍后查看" / "生成失败"），再补一枚就是同话说两遍。 */
  const items = raw.map(function (it) {
    const lock = store.mindmapPickLock(store.mindmapById(it.id));
    return Object.assign({}, it, {
      lock: lock,
      lockTip: lock ? pickLockTip(lock) : '',
      lockTag: lock === 'incomplete' ? '待完善' : ''
    });
  });
  /* lead 卡没有 `lock` 字段（它永远可选）—— `it.lock` 取到 `undefined` 就是"不锁"，
     不需要给它补一个假值（补了反而会让人以为它跟脑图卡共用同一套字段）。 */
  items.unshift(aiPickItem());
  return {
    open: true,
    title: '选择脑图 ' + n,
    groups: [{ key: 'g-all', label: '', dot: '', archived: false, items: items }],
    pickedId: '',
    empty: ''
  };
}

module.exports = {
  build: build, closed: closed, packTodoItem: packTodoItem, packProjectCard: packProjectCard,
  /* ★★ 280 轮：选择脑图（含语义转脑图那张 lead 卡）＋「为什么不能选」的唯一一份话术 */
  buildMindmapPick: buildMindmapPick, AI_PICK_ID: AI_PICK_ID,
  pickLockTip: pickLockTip
};
