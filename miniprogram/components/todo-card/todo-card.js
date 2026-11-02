/**
 * todoCard · 待办卡片（V8 折叠态 · 设计稿 3:509）
 *
 * 白底 · 1px #E0E2E8 · 圆角 14 · padding 12/14 · 竖向 gap 10
 * 主行 ＝ 4×20 圆角 2 的紧急色条 ＋ 15 待办原文 ＋ 「⋯」更多
 * ★ 45 轮：卡片三段 —— 主行 ／ **标签行**（项目气泡带色点 ＋ 脑图气泡白底描边 ＋ 图片气泡）
 *   ／ **底行**（创建9-21 ｜ 未完成 ｜ 更新9-22）。与「待办列表抽屉」的卡同一套语言。
 *   状态徽章从标签行挪到底行：标签行只说"属于谁"，状态是时间性的。
 * ★ 46 轮：底行与抽屉同步收敛成两项 —— 左「更新于 2026-09-22 17:30」（全量时间）右「完成状态」。
 * 「留置」档 ＝ 灰边（C13 定案）
 * 已完成 ＝ 底色转灰 ＋ 标题划掉 ＋ 状态徽章转绿（不再整卡 opacity）
 * ★ 44 轮起带一层浅投影（`.tc` 白卡从浅底上托起来）
 *
 * V8 相对 V7 的变化：
 *   ❌ 去掉卡片内「就地展开四操作」—— 完整信息交给独立详情页（FR-3.8），
 *      四个操作（完成 / 编辑 / 复制 / 删除）交给「⋯」菜单与详情页操作区。
 *   ✅ 项目气泡新增「已归档」标注（FR-2.9：归档项目的待办照常显示，但要能看出来）。
 *
 * ★ 52+ 轮（项目页专项）：新增 `compact` **紧凑态** —— 项目页把待办铺成网格小卡
 *   （横屏一行 3–4 个 / 竖屏一行 2 个）。紧凑态只做三件事：
 *     ① `.tc.mini` 收内距、正文降到 14 并**夹三行**（同一行的卡要等高，正文长短不齐整片就是锯齿）；
 *     ② 「⋯ 更多」整颗不渲染 —— 那张网格的语义是"扫一眼还剩什么"，操作只有点圆圈完成；
 *     ③ 完成状态圆圈变成**可点的开关**（`catchtap` ⇒ 抛 `toggle`），点了直接勾掉。
 *   非紧凑态圆圈仍是纯展示，点它＝点卡片（行为与 47 轮一致）。
 *
 * ★★ 166 轮（用户口径 · 把"点一下就跑"改成"问一句再做"）：
 *   原话「点击那个圆圈的图标可以直接完成这个待办，但这个过程容易误操作……
 *   点击之后整个卡片被那个半透明给覆盖，然后整个卡片上层出现两个按钮，
 *   一个就是已完成、一个就是取消……避免点击一下不操作」。
 *   ⇒ 紧凑态点圆圈 **只把 `confirming` 置真**（卡片上浮出确认层），
 *     真正抛 `toggle` 的是层里那颗「已完成」；「取消」与"点层空白"都只关层。
 *
 *   · **状态住在组件里**（`data.confirming`），不进页面 props：
 *     确认是"这一张卡正在等你决定"，纯卡片内部事。页面因此**一个字段都不用加**，
 *     组件也仍然是通用的（将来别处用紧凑态，行为自动一致）。
 *     两张卡同时开着确认层互不干扰 —— 各自有各自的取消，不需要"全局唯一"那套。
 *   · ⚠️ **误触的落点只能是取消**：半透明层自己也是 `catchtap`（点空白＝取消）。
 *     它铺满整张卡，是误触概率最高的一层 ⇒ 必须落在"什么都不改"那一侧。
 *     （"点一下没反应"正是本轮要修的那件事，所以不能让它变成什么都不发生。）
 *   · ⚠️ `onOpen` 里补了一道 `confirming` 守卫：层虽有 `catchtap` 挡着，
 *     但守卫要挡的是"将来有人在层里再挂一颗会冒泡的元素"—— 那是一道便宜的保险。
 *   · ⚠️ 勾完/取消后**不用清 `confirming` 之外的东西**：卡片要么被页面重新喂数据，
 *     要么直接从网格里消失（`wx:for` 按 id 配对，实例随之销毁）。
 */
const store = require('../../utils/store');

Component({
  properties: {
    todo: { type: Object, value: null },
    /**
     * 隐藏「归属项目」气泡（★ 45 轮）。
     * 项目页的「本项目待办」里每条都由上方那个项目卡片收纳，再逐条挂一颗同名气泡是纯噪音；
     * 而待办列表抽屉里是跨项目流水，那颗气泡正是"属于谁"的答案 —— 所以做成开关而不是判断。
     * ⚠️ 卡片默认不隐藏；只有项目页传 true。
     */
    hideProject: { type: Boolean, value: false },
    /** ★ 52+ 轮：紧凑态（网格小卡）—— 见文件头 ①②③ */
    compact: { type: Boolean, value: false }
  },

  data: {
    /* ⚠️ 这两支是"数据到达前"的初值，`observers.todo` 一进来就覆写。
       ★ 审查-02 P1-17：初值也必须走 `store` 的**同一处色出口** —— 原先裸写
         `#8E91A0`，深色下 observer 尚未跑的那一帧会闪一下浅色点。 */
    u: { main: store.noneColor() },
    pname: '',
    pcolor: store.noneColor(),
    parchived: false,
    mname: '',
    imgCount: 0,
    at: '',
    cls: '',
    /** ★★ 166 轮：确认层是否展开（只对紧凑态有意义 —— 非紧凑态不会置真） */
    confirming: false
  },

  observers: {
    'todo': function (t) {
      if (!t) return;
      const u = store.urgencyOf(t.urgency);
      const p = t.projectId ? store.projectById(t.projectId) : null;
      const m = t.mindmapId ? store.mindmapById(t.mindmapId) : null;
      const c = p && p.color ? store.colorOf(p.color) : null;
      let cls = '';
      if (t.done) cls += 'done ';
      if (t.urgency === 'hold') cls += 'hold ';
      /* ★★ 199 轮：**「刚转过来」** —— 从胶囊转出来的那条带一层紫色填充，
         直到用户打开它的详情（`markTodoSeen`）或选中那枚脑图节点。
         ⚠️ 与 `done` / `hold` **都不冲突**：那两个一个改文字（转灰划掉）、一个改左条，
            而 `fresh` 只改**卡底与描边** —— 三者可以同时挂在一张卡上。
         ⚠️ 判据是 `flashAt` 非空，**不许**在这里用 `createdAt` 现算"多久算新"
            （那是前端缓存式判断，跨端会不一致；状态由服务端给）。 */
      if (t.flashAt) cls += 'fresh ';
      this.setData({
        u: u,
        pname: p ? p.name : '',
        pcolor: c ? c.main : store.noneColor(),
        parchived: store.isArchived(p),
        mname: m ? m.name : '',
        imgCount: (t.images || []).length,
        /* ★ 46 轮：底行只留更新时间，且走**全量时间**（2026-09-22 17:30）——
           与详情页「创建于 …」同一口径，也与待办列表抽屉同一口径。
           创建时间去掉：卡片列表是按更新时间倒序的一条流水，再摆一条创建时间就有两套时间轴。 */
        /* ⚠️ 卡片底行直接显示 ⇒ `atMin()` 截到分钟（存储是秒精度，见 store.stamp()）。 */
        at: store.atMin(t.updatedAt),
        cls: cls
      });
    }
  },

  methods: {
    /** 点卡片本体 → 进详情（FR-3.8）；列表抽屉里则由页面改成「切详情并关抽屉」 */
    onOpen: function () {
      /* ★★ 166 轮守卫：确认层开着的时候，卡片本体不是出口。
         层本身是 `catchtap`（冒泡到不了这儿），这道守卫挡的是"层里以后多挂一颗
         会冒泡的元素"—— 与其指望模板层永远记得写 catch，不如在这里钉一句。 */
      if (this.data.confirming) return;
      this.triggerEvent('open', { id: this.data.todo.id });
    },
    /** 「⋯」→ 页面弹操作菜单（完成 / 编辑 / 复制 / 删除） */
    onMenu: function () {
      this.triggerEvent('menu', { id: this.data.todo.id });
    },
    /**
     * 点完成状态圆圈
     *   · 非紧凑态（★ 52+ 轮）＝ 纯展示，等价于点卡片
     *     （圆圈是 catchtap，不显式转发就点不动了）
     *   · 紧凑态（★ 166 轮改）＝ **开确认层**，不再直接勾。
     *     ⚠️ 这里**不抛 `toggle`** —— 抛出去就回到"点一下就跑"的老毛病了。
     *        真正勾掉的动作在 `onCfYes`。
     */
    onToggle: function () {
      const id = this.data.todo.id;
      if (!this.data.compact) { this.triggerEvent('open', { id: id }); return; }
      this.setData({ confirming: true });
    },

    /**
     * ★★ 166 轮：确认层里那颗「已完成」—— 这才是真正勾掉的动作。
     * ⚠️ 先落到**本组件**里关层：抛给页面之后，卡片可能立刻从网格里消失
     *    （网格只铺未完成），实例被销毁 —— 再 `setData` 就晚了。
     */
    onCfYes: function () {
      const id = this.data.todo.id;
      this.setData({ confirming: false });
      this.triggerEvent('toggle', { id: id });
    },

    /**
     * ★★ 166 轮：关掉确认层（「取消」那颗键 **与** 半透明层自己共用这一条）。
     * ⚠️ 一个方法两个调用点是有意的：它们做的是**同一件事**（什么都不改地退回去），
     *    分成两个方法迟早会有一边被改歪（"点空白"与"点取消"从此行为不同）。
     * ⚠️ 不抛任何事件 —— 取消就是取消，页面不需要知道。
     */
    onCfCancel: function () {
      if (!this.data.confirming) return;
      this.setData({ confirming: false });
    }
  }
});
