/**
 * 模块组件基座 —— 五个模块组件（概览/项目/待办/脑图/我的）共用的骨架逻辑。
 *
 * ── 09-21 架构调整：从「五页」改成「一壳 ＋ 五组件」 ──────────────────
 * 老做法：底部导航点击 → wx.reLaunch 切页。reLaunch 会关掉全部页面再重建目标页，
 *   屏幕必然先白一下，而且底栏组件每次都被销毁重建 ⇒ 黄色滑块无从谈起。
 * 新做法：
 *   pages/shell            唯一的页面：骨架（stage-wrap / stage / app）、品牌栏、
 *                          左导轨 / 底部导航 / 悬浮 Logo，以及五个模块组件的挂载点
 *   components/mod-*       五个模块，**常驻挂载**，切模块只切 display
 *   ⇒ 切页不重建视图，白屏消失；底栏只有一份实例，黄色滑块连续滑动
 *
 * 与「页面版」的三点差别：
 *   ① 方向由壳页统一判定，通过 property `landscape` 传进来（组件不再自己 fit）
 *   ② 组件只渲染 <main>；骨架与外框归壳页
 *   ③ 跨模块跳转 ＝ triggerEvent('goto')，由壳页处理（不再是 wx.reLaunch）
 *   ④ 页面的 onShow 拆成 show()，壳页在模块被激活时调用
 *
 * 弹窗体系（★ 47 轮起改称**主弹窗 / 副弹窗**，取代原来"一级 / 二级 / 三级抽屉"的说法）
 *   主弹窗 ＝ 宽 320、**可独立弹出**的抽屉（原「一级 ＋ 二级」）：
 *     · 列表类 3 种 —— 待办列表 / 脑图列表 / 项目列表（`drawer` 组件）
 *     · 表单类 7 种 —— 待办创建 / 脑图创建 / 项目创建 / agent 新增 / token api 创建 /
 *                      用户信息更改 / 导出（`form-drawer` 组件）
 *     两个主弹窗可以**同屏并排**：左边那个**偏转且不可点**（`drawerTurned` / `formTurned`），
 *     因为它们宽度一致，不偏转的话读作"一个被另一个盖住"。
 *   副弹窗 ＝ 宽 260、开在**父主弹窗右侧**的联动层（原「三级」）：
 *     · 关联脑图选择（在 form-drawer 内）· 待办筛选（在 drawer 内）
 *     它只承担选择 / 筛选这类联动，**从不独立弹出、也从不让父层偏转**
 *     —— 「一个主弹窗 ＋ 一个副弹窗」并排时两个都是正的。
 *
 * 收在这里的东西（与原页面基座一致）：
 *   · FR-8 导航落点（点导航 → 回上次详情 ／ 再点 → 弹列表抽屉）
 *   · 列表抽屉的开合、选中、新建 ＋ 列表的**筛选副弹窗**（★ 47 轮待办 ／ ★ 56 轮起项目也有）
 *   · 表单抽屉的开合、提交、取消、嵌套新建项目
 *   · 待办卡片的「⋯」操作菜单
 *   · 待办详情页的「关联脑图」—— 选择主弹窗（★ 82 轮）
 *
 * ★ 第八十二轮：`onBrand`（悬浮品牌块 ＝ 创建待办快捷键）整条删除 ——
 *   用户口径「点击品牌 logo 均不触发待办创建」。品牌块退回纯装饰，
 *   创建待办由「待办列表主弹窗」底部那颗「＋ 创建待办」承担。
 */
const store = require('./store');
const drawers = require('./drawers');
const forms = require('./forms');

/* ★★ 160 轮：`TODO_MENU` 这个常量**已删** —— 它是一条从来没有调用点的死字面量
   （`['完成 / 取消完成', '编辑', '复制为 Markdown', '删除']`），而本轮正好把
   "待办有哪些动作"重新定义成**按状态分档**（见 `mod-todo.js` 的操作区三态）。
   留着一份"旧的四动作清单"，下一个人读到只会以为那还是口径。 */

function base(active) {
  const data = {
    /* 本组件属于哪个模块（只用于「跨模块就该切过去」的判定，壳页另有自己的 active） */
    active: active,

    drawer: drawers.closed(),
    drawerTurned: false,
    /* ★ 47 轮：待办列表的**筛选副弹窗**开着没有（开合由页面控，副弹窗本体在 drawer 组件里） */
    drawerFilterOpen: false,
    form: forms.closed()
  };

  const methods = {
    /* ---------------- 生命周期（由壳页/组件生命周期驱动） ---------------- */

    /**
     * 模块被壳页激活时调用 —— 等价于原来页面的 onShow：
     * 刷新数据；若是「本次刚落地」且没有记忆，自动弹出列表抽屉（FR-8.2）。
     */
    show: function () {
      if (this.refresh) this.refresh();
      /* ★★ 2026-10-12：模块可选的「**刚进入本模块**」钩子。
         ── 「我的」页用它触发余额查询（用户口径：「用户点击进入『我的』页面后就触发查询动作」）。
         ⚠️ 必须放在 `refresh()` **之后**：onEnter 往往依赖"刚搬进视图的那份数据"
            （例如它有 key 才需要去查），顺序反了会读到上一帧的旧列表。
         ⚠️ 刻意做成**可选**（`if (this.onEnter)`）—— 五个模块里只有「我的」需要它，
            其余四个不实现就什么都不会发生，不必各自写一个空函数。
         ⚠️ 别把它并进 `refresh()`：`refresh()` 在方向变化 / 数据变更 / 关抽屉等
            十几个地方都会被调，那不是"进入本模块"，放进去会被反复触发。 */
      if (this.onEnter) this.onEnter();
      if (this._fresh) {
        this._fresh = false;
        if (this.autoDrawer) this.autoDrawer();
      }
    },

    /** 方向变化后重排（壳页在每次 layout 后对五个模块各调一次） */
    relayout: function () { this.afterLayout(); },

    /**
     * ★★ 126 轮 · **数据被整体刷新之后的唯一重画口**（由壳页在 `store.refresh()`
     * 回来之后逐个调，手机端那条路走胶囊自己的 `refresh()`）。
     *
     * ── 它与 `refresh()` 的分工（别把这两件事合并）──────────────────────────
     *   · `refresh()`（各模块自己的）—— "把 store 里**现在**有什么搬进视图"。
     *   · 本方法 —— 在那之上多做一件事：**把开着的列表主弹窗按新数据重建一遍**。
     *   用户口径（2026-10-08）：*「包括详情和列表弹窗」* —— 即"刷新"不能只刷背后那份
     *   详情，**眼前正开着的那张列表也必须是新的**；否则会出现"详情里的项目名变了、
     *   旁边开着的项目列表还是旧的"这种半新半旧的一屏。
     *
     * ⚠️ 重建抽屉时必须把三种印记**原样带回去**（与 `refreshListDrawer` /
     *    `afterTodoChange` 是同一条规矩，漏一条的症状写在下面）：
     *      · `turned` —— 被一张表单压着时的"侧转且不可点"；漏 ⇒ 它当场转正、还能点。
     *      · `scope`  —— "只列某个项目下的内容"（项目页那两颗「查看全部」）；
     *                    漏 ⇒ 列表静默变回全量（口径被换掉，最难查的一类）。
     *      · `picker` —— 待办详情里那张"选择关联脑图"；漏 ⇒ 点一条会**突然跳到脑图模块**
     *                    而不是挂到这条待办上。
     * ⚠️ **表单抽屉（`form` / `form2`）刻意不动**：用户可能正填到一半，
     *    重建会把草稿抹掉 —— 那不是刷新，是替他取消。表单里的选项值本来就取自
     *    `forms.build()` 的一次装配，刷新后要不要换由用户自己重开。
     */
    onDataRefreshed: function () {
      if (this.data.drawer && this.data.drawer.open) {
        /* ⚠️ 这里刻意整句写 `this.data.drawer.kind / .scope`（不用局部快照 `cur`）：
           `check_refresh_round126.js` 的 B4 断的是字面 `drawer.scope` ——
           "重画抽屉必须把 scope 带回、否则列表静默变回全量"这一条要能被原文搜到。 */
        const d = drawers.build(this.data.drawer.kind, this.data.drawer.scope);
        d.turned = this.data.drawerTurned;
        /* ★★ 2026-10-24（复审 P2-03）：**按类型分别处理，别一律当脑图 picker**。
           ── 改前：`if (this.data.drawer.picker) this.pickerDrawer(d);` ——
              `pickerDrawer()` 会无条件把 `d.picker` 写成 `'todo'`、把标题改成
              「选择关联脑图-N」。于是**胶囊多选抽屉**（`picker:'capsule'`）只要碰巧
              刷新一次（切导航 / 点品牌块 / 下拉），标题和语义都变成脑图选择器。
           ── 而且 `build('capsule')` 每次都给一份**空的** `pickMap` ⇒ 用户已勾的
              几枚一起被清掉，界面上"刚才勾的都白勾了"。
           ⇒ 现在：脑图 picker 仍走原路；胶囊 picker 保留标题 / 多选 / 确认键，
              并把旧 `pickMap` 按**新候选集**过滤后带回去（已不在名单里的才丢）。 */
        if (this.data.drawer.picker === 'todo') {
          this.pickerDrawer(d);
        } else if (this.data.drawer.picker === 'capsule') {
          const oldMap = this.data.drawer.pickMap || {};
          const alive = {};
          (d.groups || []).forEach(function (g) {
            (g.items || []).forEach(function (it) { if (oldMap[it.id]) alive[it.id] = true; });
          });
          d.pickMap = alive;
          d.picker = 'capsule';
        }
        this.setData({ drawer: d });
      }
      if (this.refresh) this.refresh();
    },

    /**
     * 基座这一层没有要重排的东西 —— 留空的钩子（`comp()` 会把它和模块自己的
     * afterLayout 叠加，两边都要跑）。★ 44 轮：原来的 syncTip 提示胶囊已整条删除。
     */
    afterLayout: function () {},

    /* ---------------- 跨模块跳转 ---------------- */

    /**
     * 切到另一个模块（由壳页执行）—— 取代原来的 wx.reLaunch
     * @param {string} key  模块键
     * @param {object} [extra] ★ 2026-10-24（复审 P2-09）：**跟着跳转走的上下文**。
     *        目前只有一个：`{ agentId }` —— 从概览 / 项目的 agent 卡跳到「我的」时，
     *        要能定位到"我刚才点的是哪一张"。改前只传 `key`，`data-id` 白写了。
     */
    gotoModule: function (key, extra) {
      const d = { key: key };
      if (extra && typeof extra === 'object') {
        Object.keys(extra).forEach(function (k) { if (extra[k] !== undefined) d[k] = extra[k]; });
      }
      this.triggerEvent('goto', d);
    },

    /* ---------------- FR-8：导航落点 ---------------- */

    /** 三个内容模块：有记忆 → 直接看详情；没记忆 → 空态 ＋ 自动弹列表抽屉 */
    autoDrawerFor: function (kind) {
      if (store.memoryOf(kind)) return false;
      this.openListDrawer(kind);
      return true;
    },

    /* ---------------- 列表抽屉 ---------------- */

    /**
     * 弹一张列表主弹窗
     * @param {string} kind  project | todo | mindmap
     * @param {object} [scope]  ★ 52+ 轮：`{ projectId }` ⇒ 只列这个项目下的内容
     *        （项目页的两颗「查看全部」用）。不传 ＝ 全量列表。
     *        ⚠️ scope 存在 `drawer.scope` / `drawer.scopeId` 里，**重建列表时必须原样带回去**
     *        （`refreshListDrawer` / `afterTodoChange`），否则「在这张列表里勾掉一条待办」
     *        会把作用域悄悄丢掉、列表当场变回全量。
     */
    openListDrawer: function (kind, scope) {
      const d = drawers.build(kind, scope);
      d.turned = false;
      this.setData({ drawer: d, drawerFilterOpen: false });
    },

    closeListDrawer: function () {
      this.setData({
        drawer: drawers.closed(), drawerTurned: false,
        drawerFilterOpen: false, form: forms.closed()
      });
      if (this.refresh) this.refresh();
    },

    onDrawerClose: function () { this.closeListDrawer(); },

    /* ---------------- 脑图选择主弹窗（★ 82 轮 · 待办详情的「关联」） ----------------
     * 用户口径「点击关联按钮后弹出脑图选择抽屉（该选择抽屉是直接在左侧展开，因此需要一个
     * 主抽屉，和待办编辑抽屉出发的脑图选择不一致）」。
     *
     * 所以它不是新组件、也不是表单里那个 260 宽的三级副弹窗，而是**同一份 `drawer` 装配**
     * （kind=mindmap）＋一个 `picker` 印记：
     *   · 位置：与其它主弹窗一样落在左侧 L1 位（横 x84 ／ 竖 x16）——
     *     "直接在左侧展开"就是它和三级副弹窗（贴在父层右侧 260 宽）最直观的差别。
     *   · 选中的含义不同：普通列表里点一条 ＝ "我要去看那张图"（写记忆 ＋ 切模块）；
     *     picker 里点一条 ＝ "把这条待办挂到那张图上"（回填 `mindmapId` ＋ 收起抽屉）。
     *     判别只看 `drawer.picker`，所以 `drawer` 组件一行都不用改。
     *   · 底部那颗「＋ 新建脑图」来自 mindmap 列表本来的 `createLabel`，picker 态下
     *     由 `onDrawerCreate` 接住 —— 建完**自动挂到这条待办上**（见 onFormSubmit）。
     *
     * ⚠️ `picker` 是**页面附加**在抽屉数据上的，`drawers.build()` 不认识它 ⇒
     *    任何"重建抽屉"的地方都必须重新贴上（`refreshListDrawer` / `onFormSubmit` 的
     *    回列表分支 / `afterTodoChange`）。漏一处的症状是：从 picker 的「＋ 新建脑图」
     *    回来之后，这张抽屉变回普通脑图列表 —— 点一条会**突然跳到脑图模块**，
     *    而不是挂到这条待办上。这就是下面 `pickerDrawer()` 存在的理由。
     */
    pickerDrawer: function (d) {
      const tid = store.memoryOf('todo');
      const t = tid ? store.todoById(tid) : null;
      d.picker = 'todo';
      /* ★★ 174 轮：标题改「**选择关联脑图-N**」—— 与其余四张列表同一读法
         （原来写的是空格分隔的「选择关联脑图 N」）。 */
      d.title = '选择关联脑图-' + (d.groups.length ? d.groups[0].items.length : 0);
      /* 当前挂着的那张在列表里打勾 —— 打开就知道"现在挂的是哪张"，不用退出去看详情 */
      d.activeId = (t && t.mindmapId) || '';
      /* ⚠️ 头部那颗「新建」**这里不再单独压** —— ★ 174 轮起 `drawers.build()` 对
         **带 scope 的脑图列表**就已经不给 `action`（项目脑图抽屉与这张 picker 是同一份
         装配），同一件事留两处写法正是本工程反复踩的坑（"同一种画法只有一份实现"）。
         创建入口只留底部那一颗「＋ 新建脑图」（`createLabel`）——
         用户口径「标题栏中的新建按钮应去掉（底部已有新建按钮）」。
         ⚠️ 若哪天 `drawers.build()` 给回 `action`，这里必须同时加回 `d.action = ''`
            （否则这张 picker 会跟着长出头部新建）。 */
      return d;
    },

    openMapPicker: function () {
      const tid = store.memoryOf('todo');
      const t = tid ? store.todoById(tid) : null;
      if (!t) return;
      /* ★★ 2026-10-24（复审 P2-04）：**已删除的待办不许再挑脑图**。
         ── 改前这条守卫只在「取消关联」那颗键上有（模板 `!detail.deleted` 挡着），
            「关联 / 替换」没有 ⇒ 已删除那一档点它仍能走完整套选择流程，
            最后 `updateTodo()` 被后端拒，再叠一条"保存失败已还原"。
         ── 模板那边已经把这颗键整个拿掉了（`wx:if`），这里补的是**方法层**的兜底：
            别的入口（将来的快捷键 / 菜单）调进来也不会发写请求。
         ⚠️ 不弹 toast：模板已经不可能渲染这颗键，能走到这里的基本都是代码路径，
            弹提示反而会在正常操作里冒出来一条莫名其妙的字。 */
      if (store.isDeletedTodo(t)) return;
      /* ⚠️ 候选**按归属项目过滤** —— 与 43 轮定下、至今有效的
         「关联脑图的候选只来自归属项目」是同一条规则（跨项目关联会让
         "这条待办挂在别的项目的脑图上"，读起来自相矛盾）。
         用 `build` 的第二参 `scope` 实现：它同时把底部那颗「＋ 新建脑图」的
         所属项目预填成这条待办的项目（见 onDrawerCreate）。 */
      const d = drawers.build('mindmap', t.projectId ? { projectId: t.projectId } : null);
      d.turned = false;
      this.setData({ drawer: this.pickerDrawer(d), drawerFilterOpen: false });
    },

    /**
     * ★★ 248 轮：「+选择胶囊」—— 弹出**胶囊选择主弹窗**（宽 320 · 左侧 L1 位 · **多选**）。
     *
     * 用户口径（2026-10-23）：「点击『+选择胶囊』弹出选择胶囊的抽屉（主抽屉），
     * 卡片显示当前胶囊列表卡片，可多选卡片，底部按键为『取消』『保存』，无胶囊新增按钮」。
     *
     * ── 与 `openMapPicker()` 的关系（两张 picker 长得像，别合并）──────────
     *   · 脑图 picker 是**单选**：点一条立刻回填并关抽屉（`_pickForTodo`）；
     *   · 胶囊 picker 是**多选**：点一条只记选中，收尾由底部「保存」一次性交上来
     *     （`mod-todo.onCapConfirm` → `store.linkCapsulesToTodo`）。
     *   ⇒ 判别由 `drawer.picker`（'todo' / 'capsule'）分流，组件只认 `multi`。
     *
     * ⚠️ 装配由 `drawers.build('capsule')` 给（标题 / 候选 / 空态 / 三颗多选开关）——
     *    这里**只做开**，一个字段都不补（与 `openListDrawer` 同一条纪律：
     *    抽屉数据只有一份真源，页面随手改一个字段就是第二个真源）。
     * ⚠️ 收掉筛选副弹窗：它与主弹窗是"同一层的展开"，两张同时开着会盖在一起。
     *    这一条与 `openForm()` 里的处理相同。
     */
    openCapsulePicker: function () {
      const tid = store.memoryOf('todo');
      const t = tid ? store.todoById(tid) : null;
      if (!t) return;
      const d = drawers.build('capsule');
      d.turned = false;
      this.setData({ drawer: d, drawerFilterOpen: false });
    },

    /** picker 里的选择 ＝ 回填这条待办的 mindmapId（不写记忆、不切模块） */
    _pickForTodo: function (mid) {
      const tid = store.memoryOf('todo');
      const t = tid ? store.todoById(tid) : null;
      if (t) {
        store.updateTodo(tid, { mindmapId: mid || null });
        wx.showToast({ title: mid ? '已关联脑图' : '已解除关联', icon: 'none' });
      }
      this.setData({ drawer: drawers.closed(), drawerTurned: false, drawerFilterOpen: false });
      if (this.refresh) this.refresh();
    },

    /** 选中一条：写记忆 → 关抽屉 → 同模块就地刷新；跨模块则交给壳页切过去 */
    onDrawerPick: function (e) {
      const id = e.detail.id;
      const kind = this.data.drawer.kind;
      /* ★ 82 轮：picker 态先分流 —— 它选的不是"要看哪张图" */
      if (this.data.drawer.picker === 'todo') { this._pickForTodo(id); return; }
      /* ★★ 280 轮：**脑图这一条要先过闸门**（生成中 / 生成失败 / 字段未完善都不许进画布）。
         放在"写记忆"之前 —— 记忆只在**真的能打开**时才写（§3.3 第 5 条）。 */
      if (kind === 'mindmap' && this.guardMindmapOpen(id)) return;
      store.setMemory(kind, id);
      this.setData({
        'drawer.open': false, drawerTurned: false,
        drawerFilterOpen: false, form: forms.closed()
      });
      if (this.data.active !== kind) { this.gotoModule(kind); return; }
      if (this.refresh) this.refresh();
    },

    /* ---------------- 脑图：能不能打开（★★ 280 轮） ----------------
     * 用户口径（需求第 7 条）：脑图的「归属项目 / 格式」必须有值 ⇒ 没填全的卡点进去
     * 只能进「完善脑图信息」。技术上 `formatKeyOf()` 会兜底、画布照样能画，所以这条
     * **纯业务规则**只能靠拦"开画布"那一步实现。
     * ★ 2026-10-27：原来还要求「归属 agent」，已撤 —— 用户口径"选了归属项目就已经确定了
     *   归属 agent"，agent 是项目的派生值，界面上没有这一项可填（见 store.projectAgentId）。
     *
     * ⚠️⚠️ **必须拦在"写记忆 / 开画布"这一处，不能只把卡片做成不可点** ——
     *    打开脑图的入口有三处（脑图列表抽屉 / 项目页脑图网格 / 待办详情的「关联脑图」），
     *    只在卡片上加个条件，换一个入口就绕过去了。三个入口都调这一个方法。
     *
     * 判据全在 `store.mindmapGateOf()`（与卡片上的 `incomplete` 同一个函数，不写第二套）。
     *
     * @returns {boolean} true ＝ **已经处理掉了**，调用方不要再写记忆 / 切模块
     */
    guardMindmapOpen: function (id) {
      const m = id ? store.mindmapById(id) : null;
      const gate = store.mindmapGateOf(m);
      if (gate === '' || gate === 'missing') return false;
      /* 生成中：`ensureTree()` 在本地树缺失时会造一棵"只有原点"的占位树 ⇒ 会画出一个
         写着脑图名的空方块，用户以为图就长这样（§7.3：打开详情 不可以）。 */
      if (gate === 'pending') {
        wx.showToast({ title: '模型正在处理，请稍后查看', icon: 'none' });
        return true;
      }
      /* 失败：卡里是空的，进去也只有原点。卡上那句「生成失败」已经说了实话。 */
      if (gate === 'failed') {
        wx.showToast({ title: '这张脑图没生成成功，删掉后可重新发起', icon: 'none' });
        return true;
      }
      /* 未完善：开「完善脑图信息」抽屉 —— **落位跟着用户从哪来**。
         ★★ 2026-10-27（用户口径）：从**脑图列表抽屉**里点那张卡 ⇒ 表单必须开在**列表右侧**
            （L2 位），列表同帧「侧转」＝ 示意不可点。理由是人因：用户刚在列表里点了一张卡，
            把列表整个收掉会让他丢失"我点的是哪一条"的上下文；并排 + 侧转才是
            "从这张卡长出来的面板"的读法（与「列表抽屉 → 新建」完全同一条观感）。
         ★ 从**项目页脑图网格 / 待办详情的「关联脑图」**点（没有列表抽屉可依赖）⇒ 照旧占主位（L1）。
         ⚠️ `offset` 必须**显式传**：不传的话 `openForm` 会按 `drawer.open` 现算 ——
            算出来的值默认是对的，但"列表开着却要主位"这类分支将来一旦出现就没法表达。
         ⚠️ `drawerTurned` 由 `openForm` 在 `listOpen` 时自动置 true（那边是唯一写入口），
            这里不要再 setData 一次 —— 两次写同一个键，后一次会把前一次覆盖成相反值。
         · `requireAll: true` ⇒ 标题/必填/无删除键，三件一起生效（agent 不再由用户选，见 forms.js） */
      const listOpen = !!this.data.drawer.open;
      /* ⚠️ 这里有一个**隐含前提**，写出来免得将来踩：`offset: 270` 成立的前提是
         "列表抽屉此刻在 L1（x 84/16）"。本项目里 `kind==='mindmap'` 会走到这里的
         只有两处，都在 L1：
           · 脑图模块自己的列表抽屉（`drawers.build('mindmap')`，不传 offset）
           · 待办详情的「选择关联脑图」——它虽然也开在 L1，但 `picker==='todo'`，
             在 `onDrawerPick` 开头就被分流到 `_pickForTodo` 了，根本走不到本函数。
         若将来有一张 kind 为 mindmap 的抽屉被开在 L2，这里必须改成"收掉抽屉、表单占主位"，
         否则两张主弹窗会**压在同一个格子里**（§5.5 第 341 行那条几何约束）。 */
      if (listOpen) {
        /* 副弹窗（列表筛选）占的正是 L2 位 ⇒ 必须让开，否则会和表单叠在一起 */
        if (this.data.drawerFilterOpen) this.setData({ drawerFilterOpen: false });
        this.openForm('mindmap', id, { offset: 270, requireAll: true });
        return true;
      }
      this.setData({ 'drawer.open': false, drawerTurned: false, drawerFilterOpen: false });
      this.openForm('mindmap', id, { offset: 0, requireAll: true });
      return true;
    },

    /* ---------------- 副弹窗：列表筛选（★ 47 轮待办 ／ ★ 56 轮起项目也有） ----------------
     * 副弹窗（260 宽，开在父主弹窗右侧）只做「选择 / 筛选」这类联动，不独立弹出。
     * 开合状态放在页面（＝受控），组件只负责抛事件 —— 这样「弹表单」时可以顺手把它收掉，
     * 不会出现"表单盖在副弹窗上"的层级打架。
     *
     * ★ 56 轮：组件改成**只抛 `{key, value}`**（key ＝ 存储字段名），页面按抽屉 kind
     * 派给 `setTodoFilter` / `setProjectFilter` —— 两张列表的筛选走同一条链路，
     * 组件里再没有"待办状态"这类具体条件。加一个筛条件只需动装配层。
     */
    onDrawerOpenFilter: function () { this.setData({ drawerFilterOpen: true }); },
    onDrawerCloseFilter: function () { this.setData({ drawerFilterOpen: false }); },

    /**
     * 筛选条件变了 —— 写 store → **重建整个列表抽屉**（左列表与副弹窗同一次 setData 一起更新，
     * 两边的选中态永远同源，不会出现"条件变了但左边没动"）。
     * @param {object} e.detail { key, value } —— key ∈ kw | status | projectId | range | node | agentId | format
     *
     * ★ 本轮：三张列表都接了筛选 ⇒ 这里从「project ／ 其余」两分支改成**按 kind 派发**。
     *    加第四张能筛的列表 = 下面加一行，组件与 wxml 一行都不用动。
     */
    onDrawerFilterChange: function (e) {
      const d = e.detail || {};
      const kind = this.data.drawer.kind;
      if (kind === 'project') store.setProjectFilter(d.key, d.value);
      else if (kind === 'mindmap') store.setMindmapFilter(d.key, d.value);
      else store.setTodoFilter(d.key, d.value);
      this.refreshListDrawer();
    },

    /** 「清除全部筛选」—— 三张列表各有各的默认值（待办＝全量；项目＝活跃视图；脑图＝全量） */
    onDrawerFilterReset: function () {
      const kind = this.data.drawer.kind;
      if (kind === 'project') store.resetProjectFilter();
      else if (kind === 'mindmap') store.resetMindmapFilter();
      else store.resetTodoFilter();
      this.refreshListDrawer();
    },

    /**
     * 按最新筛选条件重画列表抽屉（副弹窗保持打开 —— 用户是在里面连着调几个条件）。
     * ⚠️ 重建必须把 `scope` 一起带回去（`drawer.kind` 也一起）—— 抽屉里能开筛选的
     *    只有全量那两张，但方法本身不该假设 kind，否则以后给 scoped 列表加筛选会踩空。
     * ⚠️ ★ 82 轮：picker 印记也要一起带回去（否则在"选择关联脑图"里调一次筛选，
     *    这张抽屉就变回普通脑图列表，点一条会突然跳到脑图模块）。
     */
    refreshListDrawer: function () {
      const d = drawers.build(this.data.drawer.kind, this.data.drawer.scope);
      d.turned = this.data.drawerTurned;
      if (this.data.drawer.picker) this.pickerDrawer(d);
      this.setData({ drawer: d });
    },

    /* ---------------- 表单抽屉 ---------------- */

    openForm: function (mode, id, opts) {
      const listOpen = !!this.data.drawer.open;
      const explicit = opts && opts.offset !== undefined && opts.offset !== null;
      const offset = explicit ? opts.offset : (listOpen ? 270 : 0);
      /* ★★ 280 轮：`requireAll` 透传给装配层 —— 它决定"这是不是完善态"（标题 / 必填 /
         删除键 / agent 选项四件事）。不收在这里算：`forms.build` 才是造表单的那一处。 */
      forms.open(this, mode, id, {
        offset: offset,
        preset: opts && opts.preset,
        requireAll: opts && opts.requireAll
      });
      const patch = {};
      if (listOpen) patch.drawerTurned = true;
      /* 副弹窗不能和表单并存：表单落在 L2 位时正好会压在副弹窗的位置上 */
      if (this.data.drawerFilterOpen) patch.drawerFilterOpen = false;
      if (Object.keys(patch).length) this.setData(patch);
    },

    onFormCancel: function () {
      const self = this;
      forms.cancelOn(this, function () {
        /* ★★ 2026-10-22（审查 P1-07 的连带项）：**"表单还开着"就不要把抽屉转正**。
           取消嵌套二级时 `forms.cancelOn` 会把父表单还原（草稿还在）——
           改前这里无条件 `drawerTurned:false`，于是抽屉当场转正、还能点，
           而上面明明还压着一张表单（正是"侧转且不可点"要避免的那种层级错觉）。 */
        self.setData({ drawerTurned: !!(self.data.form && self.data.form.open && self.data.drawer.open) });
        if (self.refresh) self.refresh();
      });
    },

    onFormSubmit: function (e) {
      const self = this;
      /* ⚠️ 提交**之前**先记下"这一份是不是从脑图选择抽屉里开出来的创建表单" ——
         提交之后 form / form2 都被收掉了，那时候再读就晚了（★ 82 轮）。 */
      const top = (this.data.form2 && this.data.form2.open) ? this.data.form2 : this.data.form;
      const pickTodo = (top && top.mode === 'mindmap' && this._pickTodo) ? this._pickTodo : '';
      this._pickTodo = '';

      const id = forms.submitOn(this, e.detail.values, function () {
        const backToList = self.data.drawerTurned;
        self.setData({ drawerTurned: false });
        /* picker 场景下面会直接收掉抽屉（用户要看的是"这条待办现在挂着哪张图"），
           所以这里不再重建它 —— 重建再收是两次 setData，白闪一下。 */
        if (backToList && !pickTodo) {
          const d = drawers.build(self.data.drawer.kind, self.data.drawer.scope);
          d.turned = false;
          if (self.data.drawer.picker) self.pickerDrawer(d);
          self.setData({ drawer: d });
        }
        if (self.refresh) self.refresh();
      });

      /* ★ 82 轮：从「选择关联脑图」抽屉里新建的那张图 —— 建完**直接挂到这条待办上**，
         并把抽屉收起（回到详情，眼见的关联行立刻变成刚建的那张）。
         不这么做的话用户点完"新建"还得在列表里再找一遍刚建的图，多一次动作。
         ⚠️ 放在 `submitOn` 之后做：`id` 是它返回的，只有那之后才拿得到。 */
      if (pickTodo && id) {
        store.updateTodo(pickTodo, { mindmapId: id });
        this.setData({ drawer: drawers.closed(), drawerFilterOpen: false });
        wx.showToast({ title: '已新建并关联', icon: 'none' });
        if (this.refresh) this.refresh();
      }

      /* ★★ 2026-10-12：模块可选的「**表单提交之后**」钩子。
         ── 「我的」页用它把刚存的 key 立刻查一遍余额：用户贴完 key、点完保存，
            下一眼想看到的就是那个数，而不是「待查询」。
         ⚠️ 与 `onEnter` 一样是**可选**的 —— 其余四个模块不实现就什么都不会发生。
         ⚠️ 放在**所有分支之后**：不管这次提交走的是哪条路（回列表 / 关联脑图 / 普通保存），
            "表单已经提交了"对每个模块都是同一件事，不该被哪条分支吃掉。 */
      if (this.afterFormSubmit) this.afterFormSubmit(e);
    },

    /** 待办表单里的「＋ 新建项目」→ 右侧开**项目创建**主弹窗，建完把草稿还回来 */
    onFormNewProject: function (e) {
      forms.openNestedProject(this, e.detail.values, 'todo', this.data.form.id, this.data.form.offset);
    },

    /**
     * 待办表单里的「＋ 新建脑图」（★ 49 轮）—— 与「＋ 新建项目」同一条嵌套机制：
     * 右侧开**脑图创建**主弹窗（二级位），一级待办表单侧转不可点；建完回到待办表单、
     * 新脑图直接预选在「关联脑图」那一行。
     *
     * ⚠️ 把待办**已选的归属项目**带给脑图表单 —— 脑图的「所属项目」是必填，
     *    用户在待办里选好的那个才是他心里的归属。没选就**不传**，让 build 里的
     *    默认项目生效（传空串会把默认值抹掉，那一版连提交都过不去）。
     */
    onFormNewMindmap: function (e) {
      const v = (e.detail && e.detail.values) || {};
      forms.openNestedMindmap(this, e.detail.values, 'todo',
        this.data.form.id, this.data.form.offset,
        v.projectId ? { projectId: v.projectId } : null);
    },

    /* ---------------- 抽屉里的新建 ---------------- */

    /**
     * 抽屉底部的「＋ 新建 …」
     * ★ 52+ 轮：带作用域的抽屉（项目页「查看全部」）里新建时，把项目字段按 scope 预填 ——
     *   用户是从「某个项目的脑图列表」点进来的，新建的脑图当然该落在那个项目下。
     * ★ 56 轮补一道守卫：作用域指向的项目若**已归档**，这里必须拦住（FR-2.9 归档项目只读）。
     *   项目页那颗「新建脑图」撤掉之后，带 scope 的脑图列表底部这颗成了"在归档项目下
     *   新建脑图"的**唯一入口** —— 守卫不能跟着那颗按钮一起消失。
     * ★ 82 轮：待办列表底部也有了「＋ 创建待办」（`mode` 映射本来就覆盖 todo，
     *   带 scope 时项目字段同样按 scope 预填；归档项目的守卫也走上面同一段）。
     * ★ 82 轮 · picker：从「选择关联脑图」抽屉里点「＋ 新建脑图」时，建完要
     *   **自动挂到那条待办上** ⇒ 把待办 id 记进 `_pickTodo`，由 `onFormSubmit` 消化。
     *   所属项目按这条待办自己的项目预填（脑图的「所属项目」是必填，不能空）。
     */
    onDrawerCreate: function () {
      const kind = this.data.drawer.kind;
      const sid = this.data.drawer.scopeId;
      if (sid) {
        const p = store.projectById(sid);
        if (store.isArchived(p)) {
          wx.showToast({
            title: kind === 'mindmap' ? '已归档的项目不能再新建脑图' : '已归档的项目不能再加待办',
            icon: 'none'
          });
          return;
        }
      }

      if (this.data.drawer.picker === 'todo') {
        const tid = store.memoryOf('todo');
        const t = tid ? store.todoById(tid) : null;
        if (!t) return;
        this._pickTodo = tid;
        this.openForm('mindmap', '', t.projectId ? { preset: { projectId: t.projectId } } : null);
        return;
      }

      const mode = { project: 'project', todo: 'todo', mindmap: 'mindmap' }[kind] || 'todo';
      this.openForm(mode, '', sid ? { preset: { projectId: sid } } : null);
    },

    /* ---------------- 待办卡片 ---------------- */

    /** 点卡片 → 进待办详情（跨模块时交给壳页切到待办） */
    onTodoOpen: function (e) {
      const id = e.detail.id;
      store.setMemory('todo', id);
      this.setData({
        drawer: drawers.closed(), drawerTurned: false,
        drawerFilterOpen: false, form: forms.closed()
      });
      if (this.data.active !== 'todo') { this.gotoModule('todo'); return; }
      if (this.refresh) this.refresh();
    },

    /** 「⋯」→ 完成 / 取消完成 / 编辑 / 复制 / 删除（★ 见下面那条说明） */
    onTodoMenu: function (e) {
      const id = e.detail.id;
      const self = this;
      const t = store.todoById(id);
      if (!t) return;
      const done = !!t.done;
      const items = [done ? '取消完成' : '完成', '编辑', '复制为 Markdown', '删除'];
      /* ★★ 160 轮：这条菜单**只服务未删除的待办** —— 而且它现在是**唯一没有被模板接的
         菜单**（`todo-card` 会 `triggerEvent('menu')`，但五个模块的 wxml 里都没有
         `bind:menu`）。已删除的待办只出现在「待办列表 → 筛选 → 已删除」那一档，
         而抽屉那张卡是**手写卡、没有「⋯」**（它只有"点开看详情"）。
         ⇒ 已删除那条的所有动作都在**详情页的操作区**里（本轮改成只有一颗「还原」），
            这里不需要再补一支 —— 补了就是一段永远走不到的分支。
         ⚠️ 但**"完成 / 取消完成"这条切换语义与详情页已经不同**了：详情页本轮起
            「完成」只做完成、"撤回"由「还原」承担（见 `mod-todo.js` 的操作区三态）。
            这条菜单保留切换是**有意的**：它是列表侧的快捷菜单，两颗键的名字会自己变；
            真要统一的话应当先给它接上模板，那是另一件事。 */
      wx.showActionSheet({
        itemList: items,
        success: function (r) {
          if (r.tapIndex === 0) { store.toggleTodo(id); self.afterTodoChange(); return; }
          if (r.tapIndex === 1) { self.openForm('todo', id); return; }
          if (r.tapIndex === 2) { self.copyTodo(id); return; }
          self.confirmRemoveTodo(id);
        },
        fail: function () {}
      });
    },

    /**
     * 复制待办：带不带图片由「不含图片」开关兜底（C28 只能真机验）。
     *
     * ★★ 2026-10-22（审查 P2-10）· **复制前先把关联脑图的树拉到位**。
     * ── 改前：直接 `store.copyTodoText()`。而它只读 `state.tree[mid]`，
     *    树没加载时（刚刷新 / 从没打开过这张图）**静默只返回正文** ——
     *    用户以为交给 agent 的是"原文 ＋ 脑图"，实际只有一半，且**没有任何提示**。
     *    这是最坏的一种降级：看起来成功了。
     * ── 现在：有 `mindmapId` 且树未就绪 ⇒ 先 `loadTree()`：
     *    · 成功 ⇒ 照常复制（此时含脑图 Markdown）；
     *    · 失败 ⇒ **明说**"脑图没加载出来，只复制了正文"，不假装完整。
     * ⚠️ `treeReady` 而不是 `state.tree[mid]`：后者可能是 `ensureTree()` 造的
     *    "只有根节点"占位树，照它序列化会导出一棵假树（比缺内容更误导）。
     * ⚠️ 详情页那条导出抽屉**不在这里**：详情 `refresh()` 里已有
     *    `ensureMindmapTree()`（170 轮），打开详情就会把树拉回来 —— 那条路不需要再等一次。
     * ⚠️ mock / 未连后端（`!isLoaded()`）不发请求：本地种子就是权威（同 170 轮口径）。
     */
    copyTodo: function (id) {
      const self = this;
      wx.showActionSheet({
        itemList: ['含图片（图片存为完整链接）', '不含图片'],
        success: function (r) {
          const noImage = r.tapIndex === 1;
          const t = store.todoById(id);
          const mid = t && t.mindmapId;
          const doCopy = function (missTree) {
            const text = store.copyTodoText(id, { noImage: noImage });
            wx.setClipboardData({
              data: text,
              success: function () {
                wx.showToast({
                  title: missTree
                    ? '脑图没加载出来，这次只复制了正文'
                    : ('已复制待办原文' + (noImage ? '' : ' ＋ 脑图 Markdown')),
                  icon: 'none'
                });
                self.afterTodoChange();
              }
            });
          };
          if (mid && store.isLoaded() && !store.treeReady(mid)) {
            /* ★★ 2026-10-24（复审 P1-04）：**失败分支原来是不可达的**。
               `store.loadTree()` 拉失败时 **fulfill**（返回 `ensureTree()` 的占位树），
               所以 `.then(ok, fail)` 的第二个函数永远不会被调用 ⇒ 屏幕上照样提示
               "已复制待办原文 ＋ 脑图 Markdown"，而实际内容只有正文。
               ⇒ 判据从"Promise 成没成功"换成"**树到底就绪没有**"：`treeReady()` 是
                  `loadTree()` 自己也认的那面旗（只有真的和服务端对齐过才置真）。 */
            store.loadTree(mid).then(function () {
              doCopy(!store.treeReady(mid));
            }, function () {
              doCopy(true);
            });
            return;
          }
          doCopy(false);
        },
        fail: function () {}
      });
    },

  confirmRemoveTodo: function (id) {
    const self = this;
    wx.showModal({
      title: '删除这条待办？',
      /* ★★ 160 轮：删除改成**逻辑删除**之后，这条文案必须跟着改 ——
         改前那句"删除后不可恢复"**现在是假话**（它就在「筛选 → 已删除」里躺着，
         随时能还原）。文案里连"去哪儿找回来"一起说清：只说"可还原"而不给入口，
         用户会以为要去找客服。 */
      content: '删除后它不会消失：在待办列表的「筛选 → 已删除」里可以还原；它关联的脑图不会被删。',
      confirmText: '删除',
      confirmColor: store.danger(),
      success: function (r) {
        if (!r.confirm) return;
        store.removeTodo(id);
        self.afterTodoChange();
      }
    });
  },

    /** 待办被改动后的统一收尾：抽屉若开着要重建，详情若没了要走空态 */
    afterTodoChange: function () {
      const kind = this.data.drawer.kind;
      if (this.data.drawer.open) {
        /* ★ 52+ 轮：重建必须把 `scope` 一起带回去 —— 否则在项目页那张「项目待办」里
           勾掉 / 删掉一条，列表会当场变回全量（口径被悄悄换掉是最难查的一类问题）。
           ★ 82 轮：picker 印记同理（见 `pickerDrawer`）。 */
        const d = drawers.build(kind, this.data.drawer.scope);
        d.turned = this.data.drawerTurned;
        if (this.data.drawer.picker) this.pickerDrawer(d);
        this.setData({ drawer: d });
      }
      if (this.refresh) this.refresh();
    },

    /* ★ 44 轮：原来的「提示胶囊」整条删除 —— 用户口径「『点击遮罩任意处关闭』这个提示去掉」。
       它下面那两句（「点遮罩任意处关闭」／ 一级「侧转」＝ 不可点）本来就都是**解释说明**，
       与 43 轮清掉的子标题灰字、卡内说明是同一家族。 */

    /* ★ 第八十二轮：`onBrand`（悬浮品牌块 / 导轨 Logo ＝ 在当前模块里快速记一条待办）
       整条删除 —— 用户口径「点击品牌 logo 均不触发待办创建」。它连带作废的还有
       47 轮定下的那段优先级规则（① 有列表主弹窗先收掉 ② 有别的表单则 no-op ③ 否则直接弹），
       以及壳页 `onBrand` 与导轨 `bind:brand` 两处链路。 */
  };

  return { data: data, methods: methods };
}

/**
 * 造一个组件配置对象
 * @param {string} active 本组件属于哪个模块（overview / project / todo / mindmap / mine）
 * @param {object} cfg    **扁平配置**：data ＋ 本模块自己的方法（与旧的 make 同形，
 *                        内部会把 data 之外的所有键收进 methods）
 */
function comp(active, cfg) {
  const b = base(active);
  const c = cfg || {};

  const userMethods = {};
  Object.keys(c).forEach(function (k) {
    if (k === 'data') return;
    userMethods[k] = c[k];
  });

  const methods = Object.assign({}, b.methods, userMethods);

  /* 模块自己的 afterLayout（例如概览的 syncHeat、我的的诊断面板）与基座的 afterLayout
     是「叠加」关系，不是「覆盖」关系 —— 两个都要跑。
     （基座这一层 44 轮之后是空实现，但叠加机制要留着：以后基座再加公共重排就有地方落。） */
  const userAfter = userMethods.afterLayout;
  methods.afterLayout = function () {
    if (userAfter) userAfter.call(this);
    b.methods.afterLayout.call(this);
  };

  return {
    options: {
      /* 组件默认样式隔离 —— 让 app.wxss 与页面的全局样式也能作用到组件内部 */
      styleIsolation: 'apply-shared',
      addGlobalClass: true
    },

    properties: {
      /**
       * 屏幕方向，由壳页统一判定后传入。
       * ⚠️ 名字与原来的 data.landscape 一致 —— 这样组件内所有
       *    {{landscape}} / this.data.landscape 的写法一行都不用改。
       * 变化时：重排（syncHeat 等）＋ 重画（脑图节点是按方向排版出来的）。
       */
      landscape: {
        type: Boolean,
        value: true,
        observer: function () {
          if (!this._attached) return;
          this.afterLayout();
          if (this.refresh) this.refresh();
        }
      }
    },

    data: Object.assign({}, b.data, c.data || {}),

    lifetimes: {
      attached: function () {
        this._attached = true;
        this._fresh = true;               // 本次进入是否「刚落地」——决定要不要自动弹抽屉
        if (this.onLoad) this.onLoad();
      },
      /**
       * ★★★ 2026-10-27（全量检查 F16）· **销毁也走统一出口**。
       *
       * ── 病根：这个封装只映射了 `attached`，`detached` 一路没人接管。
       *    平时看不出问题（模块是 `display:none` 隐藏、并不销毁），但**手机 / 工作台
       *    形态切换**（`wx:if="{{mounted.x}}"`）会真的销毁重建 ——
       *    每次重建都重新 `wx.onKeyDown` 一遍，旧实例的回调却没人摘（`wx.onKeyDown`
       *    是全局的、可累加）⇒ 切二十次就有二十个键盘监听，其中一个还指着**已经销毁**的
       *    实例，按 Delete 时它照样去改一棵早就不在屏幕上的树。
       * ── 现在：`detached` 里给模块一个 `onDetach()` 出口（存在才调），
       *    并把 `_attached` 放下来 —— 基座自己的 `landscape` observer 也据此早退。
       * ⚠️ **幂等**：同一个实例不该被回收两次（`_detached` 标记），
       *    否则将来某个 onDetach 里放了"解绑 ＋ 释放"，重复跑会误伤重建后的新实例。
       * ⚠️ 调用包 try：某个模块的回收抛错不该连累其余（与 `emitRollback` 同一条纪律）。
       */
      detached: function () {
        this._attached = false;
        if (this._detached) return;
        this._detached = true;
        try { if (typeof this.onDetach === 'function') this.onDetach(); } catch (e) { /* 回收失败不影响销毁 */ }
      }
    },

    methods: methods
  };
}

module.exports = { comp: comp };
