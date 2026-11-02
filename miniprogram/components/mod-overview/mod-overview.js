/**
 * 概览（FR-5 · ★ V8 改造 · ★★ 09-23 第五十九轮专项）
 *
 * 只回答三个问题：我最近在记什么、各项目欠多少、我手上的额度还剩多少。
 *
 *   FR-5.1 活跃度日历：口径 ＝「待办创建 ＋ 待办完成 ＋ **胶囊创建**」——某日新建一条 +1、
 *         完成一条 +1、记一条闪念胶囊 +1（★ 第 97 轮扩为三源，详见 `utils/mock.js`
 *         的 `buildHeatmap()`）。
 *         ⚠️ D-6 落地要求：数据层各来源**分别计数**，
 *             格子强度 ＝ 三者之和（合值），且**查询时现算、不落库**。
 *             本期页面只画合值；选中格明细里三个数分开给。
 *   FR-5.2 项目待办统计：**复用项目卡片**（色点 / 节点 / agent / 四档条数 / 脑图数），
 *          四档条数必须全给（分数只承担排序）；排除已归档项目。
 *   FR-5.3 Agent 概况：手填字段 ＋「最后更新于」，超 7 天未更新则弱化。
 *   FR-5.4 明确取消：搜索功能、最近同步时间显示、agent 使用强度口径。
 *
 * 第五十九轮（用户 7 条走查意见）改了什么：
 *   · 三个区块子标题右侧的说明 / 计数灰字**全删**；`mock.HEATMAP.bands`（「0 条 / 1–2 条 / …」）
 *     随之失去落点 —— 数据留在 mock 里（那就是 5 档的口径本身），但不再往页面上送
 *   · 「待办创建与完成」→「活跃度日历」
 *   · 明细条去掉「已选中」，且**默认选中今天**（`store.ui.heatSelected` 由 `todayCell()` 给）
 *     ⇒ 点击不再支持"再点一下取消"，页面上没有空态
 *   · 「项目待办统计」撤掉「看全部待办」，改成项目卡网格（`store.overviewProjectCards`）
 *   · 「agent 额度」→「Agent 概况」，列出**全部** agent（`store.agentCardViews`）
 *   · 横屏下半区的两栏壳撤销 ⇒ 三个区块整宽堆叠，本页整页可滚（见 wxss 的 .ov-area）
 */
const store = require('../../utils/store');
const pub = require('../../utils/pagebase');

const CELL = 36;
const GAP = 6;
const VIEW = 1086;                 // 卡内 1128 ＝ 星期轴 36 ＋ gap 6 ＋ 视窗 1086
const WEEK_TOTAL = 30;

Component(pub.comp('overview', {
  data: {
    weekdays: [],
    weeks: [],
    heatColors: [],
    legend: [],
    scrollLeft: 0,
    sel: null,
    stats: [],
    agents: [],
    visibleWeeks: 26,
    totalWeeks: WEEK_TOTAL
  },

  onLoad: function () {
    this._fresh = true;
    /* ★★ 187 轮：`onLoad` 里**只留"一辈子只该算一次"的那一项** —— `weekdays` 是
       星期轴的七个字（一…日），它不随数据变、更不随主题变。
       其余全部交给 `refresh()`：包括**色卡**（见那边那条注释）。
       ⚠️ 别把这句话当成"纯整理"：色卡原来正落在这一句里，`onLoad` 一辈子只跑一次
          ⇒ 运行中切主题之后热力图仍是浅色那五格（187 轮用户报的那个 bug）。 */
    this.setData({ weekdays: store.state.heat.weekdays });
    this.refresh();
  },

  /** 热力格：强度只用合值（D-6：图上不做多序列）
   *  ★ 第 97 轮：数据源由 `state.heat.weeks`（开机快照）换成 `store.heatWeeks()`（现算）——
   *    旧那条路读的是基线，既没有真实计数也没有 `sum` / `level`。 */
  buildWeeks: function () {
    const sel = store.state.ui.heatSelected;
    return store.heatWeeks().map(function (w) {
      return {
        weekNo: String(w.weekNo),
        key: w.key,
        days: w.days.map(function (d) {
          return {
            weekNo: d.weekNo,
            dayIndex: d.dayIndex,
            level: d.level,
            created: d.created,
            completed: d.completed,
            capsule: d.capsule,
            sum: d.sum,
            label: d.label,
            sel: !!sel && sel.week === d.weekNo && sel.day === d.dayIndex
          };
        })
      };
    });
  },

  refresh: function () {
    /* ★★ 187 轮（用户口径「热力图中最少的那个配色相对来说有点太白了，这样在深色模式下
       就很亮」）—— 根因**不是色卡选错**，是**色卡没跟着主题换**：
       `legend` / `heatColors` 原先只在 `onLoad` 算一次，而 `onLoad` 一辈子只跑一次
       ⇒ 随系统切到深色之后，热力图仍然是浅色那五格，第 0 档（"最少"那一格）
       `#F1F2F5` 在深色卡面上几乎就是一块白 —— 最不活跃的那格反而最亮。
       ⇒ 色卡必须与其它颜色走**同一条 refresh 通道**：每一轮重算一次，主题变了就跟着变。
       ⚠️ 这是本页唯一一处"随主题变的颜色"，走的是与 `store.colorOf / urgencyOf`
          完全相同的口径（颜色只在 store 边界换、页面只管重新取一次）。
       ⚠️ 同族坑：**任何"进页面那一刻定格"的 data，只要它含有随主题/随数据变的值，
             就等于把它钉死**。判据 `check_round187.py` 的 A 组专门扫这条。 */
    const heatCells = store.heatLegend();
    this.setData({
      legend: heatCells,
      heatColors: heatCells,
      weeks: this.buildWeeks(),
      sel: this.selNow(),
      stats: store.overviewProjectCards(),
      agents: store.agentCardViews()
    });
  },

  /** 选中格明细：三个来源的数分开给（D-6）—— 待办创建 / 待办完成 / 胶囊创建 */
  selNow: function () {
    const cur = store.state.ui.heatSelected;
    if (!cur) return null;
    const d = store.heatDay(cur.week, cur.day);
    return d ? {
      label: d.label, week: d.weekNo,
      created: d.created, completed: d.completed, capsule: d.capsule, sum: d.sum
    } : null;
  },

  afterLayout: function () {
    this.syncHeat();
  },

  /**
   * ★★ 2026-10-27（全量检查 F25）· 记下用户滚到哪儿了 —— **只记、不 setData**。
   *
   * 每帧都 `setData({scrollLeft})` 会把正在滚的 `scroll-view` 打断（拖不动/回弹），
   * 而 `syncHeat()` 只需要"重排前用户在哪"这一个数。
   */
  onHeatScroll: function (e) {
    const d = (e && e.detail) || {};
    this._heatLeft = Math.max(0, Math.round(Number(d.scrollLeft) || 0));
  },

  /** 横屏 36 方格 / 视窗 1086（可见 26 周）；竖屏 45 方格 / 视窗 708（可见 14 周） */
  syncHeat: function () {
    const land = this.data.landscape;
    const cell = land ? CELL : 45;
    const view = land ? VIEW : 708;
    const step = cell + GAP;
    const content = WEEK_TOTAL * step - GAP;
    const max = Math.max(0, content - view);
    /* ★★★ 2026-10-27（F25）· **重排不再无条件把列表拽回最新端**。
     * ── 病根：`afterLayout → syncHeat` 每次都 `scrollLeft = content - view`。
     *    而壳页的 layout 在 PC 拖窗口 / 平板旋转 / 展开收起侧栏时都会触发模块重排
     *    ⇒ 用户正在看三周前的格子，窗口一动就被推回最右边，还得自己找回来。
     * ── 现在：**只有第一次**（还没初始化过）才落到最新端；之后保住当前位置，
     *    形态变了（方格大小变了）按比例换算，再夹进合法范围。
     * ⚠️ "回今天"这种业务动作将来要做的话，必须走**独立入口**显式设 `_heatLeft`＋
     *    重排 —— 不能靠"重排顺手回到最新"来兼职（那正是本条要消灭的行为）。 */
    let left;
    if (!this._heatInited) {
      left = max;
    } else if (this._heatStep && this._heatStep !== step) {
      left = (this._heatLeft || 0) * (step / this._heatStep);
    } else {
      left = this._heatLeft || 0;
    }
    left = Math.max(0, Math.min(max, Math.round(left)));
    this._heatInited = true;
    this._heatStep = step;
    this._heatLeft = left;
    this.setData({
      scrollLeft: left,
      visibleWeeks: Math.floor((view + GAP) / step)
    });
  },

  /**
   * 点热力块 → 选中它。
   * ★ 第五十九轮：**取消"点第二下取消选中"** —— 明细条默认就落在今天那一格，
   *   页面上不存在"未选中"的状态（留着取消，就会多出一条谁也没要求过的空态）。
   *   点已选中的那一格直接早退，不做无意义的 setData 重画。
   */
  onHeatTap: function (e) {
    const wk = Number(e.currentTarget.dataset.w);
    const d = Number(e.currentTarget.dataset.d);
    const cur = store.state.ui.heatSelected;
    if (cur && cur.week === wk && cur.day === d) return;
    store.state.ui.heatSelected = { week: wk, day: d };
    this.refresh();
  },

  /* ---------------- 跳转 ---------------- */

  /** 点项目卡 → 项目详情，并写项目模块记忆（FR-8） */
  onStatTap: function (e) {
    store.setMemory('project', e.currentTarget.dataset.id);
    this.gotoModule('project');
  },

  /**
   * 点 agent 卡 → 「我的」（FR-5.3：点 → 跳「我的」该 agent）。
   * ⚠️ 只是切模块，**没有**顺手打开那个 agent 的编辑抽屉 —— 抽屉实例在「我的」组件里，
   *    从概览直接开它得跨组件调方法。这条与项目页「切换项目」入口是同一批待办。
   * ★★ 2026-10-24（复审 P2-09）：**把 id 带过去**。改前这个 handler 连事件都不接，
   *    模板上那句 `data-id="{{item.id}}"` 白写 —— 点哪张卡结果都一样，
   *    用户得在「我的」里自己找刚才点的是哪一个。
   */
  onAgentTap: function (e) {
    const id = e && e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.id;
    this.gotoModule('mine', id ? { agentId: id } : null);
  }
}));
