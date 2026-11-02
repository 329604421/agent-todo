/**
 * 项目模块（FR-2 · ★ V8 整页重写）
 *
 * 详情 ＝ ① 项目基础信息 ＋ ② 项目待办 ＋ ③ 项目脑图（FR-2.6）
 *   ❌ 去掉 V7 的两个视角（task ⇄ 提问与待办 ／ task ⇄ 交付物）、槽 1/2/3 骨架、
 *      交付树、信息面板、走廊 —— 全部依赖采集链路（N-9 / N-11）
 *
 * 处置 ＝ **归档**，不是删除（FR-2.9 / N-12）：
 *   归档后项目只读、不进项目列表默认视图与概览统计，但其下待办与脑图一条不动、照常可编辑。
 *   ★ 第五十五轮起入口分两处：**归档**在编辑抽屉底部（与 agent/token 的「删除」同位），
 *     **取消归档**在基础信息卡右端（归档态时那颗按钮由「编辑」变成它）。
 *
 * 布局（★ 09-23 第五十三轮 · 项目页专项 7 条）：
 *   三块**整宽竖向堆叠** —— 基础信息 → 项目待办（网格小卡）→ 项目脑图（网格小卡 · 最多三行）。
 *   横竖同一份 DOM，只有网格列数在 wxss 里换一档。
 *   ⚠️ 横屏原来的「左待办 ＋ 右 456 侧栏」split 已撤：待办 3–4 列 / 脑图 5–6 列的网格
 *      在 456 宽里排不下，而且侧栏只剩一张脑图卡时下方整片是白的。
 *
 * 第五十三轮七条（原口径，仍有效）：区块头右侧的说明小字与计数全删 · 编辑下沉卡内 ·
   「项目待办」「项目脑图」两个子标题 · 基础卡只报数 · 待办铺网格小卡
 *   （只放未完成，点圆圈直接勾掉）· 脑图铺网格小卡（默认三行，取最近更新）。
 *
 * ★ 第五十五轮（基础信息卡重排，用户口径）：
 *   · 卡内「···」撤掉、「管理 agent」这个标签去掉
 *   · 关联 agent 名 ／ 剩余额度 ／ 距离重置 ／ 待办数 ／ 脑图数 重排成
 *     「agent 名一行 ＋ 灰块四格」，参照「我的」页 agent 卡的「概览三数」（.ag-pair）
 *   · 派生口径（额度偏低 / 重置倒计时）统一走 store（quotaLowOf / resetInOf），
 *     与「我的」页同一个真源 —— 两页各写一份迟早会漂
 *
 * ★ 第五十六轮（用户口径四条）：
 *   ① 子标题「项目基础信息」→「基础信息」
 *   ② 名称前的色点加大到与名称**同高**（参照待办卡那条彩色竖条的取法，
 *      见 wxss 的 `.pdot-lg` / `.bs-name`：两者同写 18px）
 *   ③ 区块头右侧的「记一条」「新建脑图」两颗按钮撤掉 —— 待办走「项目待办列表」
 *      底部那颗「＋ 创建待办」（82 轮起；此前指的是悬浮 Logo 快捷键，已废）、
 *      脑图走脑图列表底部的创建键，这里不再开第二个入口
 *   ④ 项目列表主弹窗改版：标题「项目-N」＋「筛选」副弹窗（搜索 / 项目状态 / 节点 /
 *      关联 agent），卡片顶部那行「活跃 / 已归档」胶囊撤掉 —— 装配在 `utils/drawers.js`
 *
 * ★ 第一百五十六轮（用户口径 · 待办看板两处）：
 *   ① 卡内那排**紧急度统计**（原来是四段只读文字）改成**可点的筛选键** ——
 *      点某一档 ⇒ 网格只留该档的**未完成**待办，再点同一档 ⇒ 取消、回到全部。
 *      计数与筛选同源（`store.statOfProject` 本来就只数 `!done`）⇒ 不会自相矛盾。
 *   ② 底行右端「查看全部」→ **「已完成待办」**：点开 `scope.done` 的列表抽屉，
 *      **只列已完成的**（`utils/drawers.js` 的 `build` 认这个字段）。
 *   筛的落点只有一处（`refresh()` 里那一句 `open.filter`），`onUrgFilter` 只改状态。
 *
 * ★★ 第一百六十八轮（用户口径 · 项目脑图卡）：卡片「显示得太简单」——
 *    「最好在卡片左侧显示一个它的格式简图（就是思维导图、逻辑图、组织结构图的那个格式简图）
 *      ……然后里面的一些节点数 层数 更新时间也一起优化一下排版」。
 *   ⇒ ① 卡内改**横向**：左＝格式简图（`utils/formats.js` 现算的那六张结构示意，
 *         与「脑图表单 · 格式字段」同一张），右＝三行文字；
 *      ② 行首那枚 13px 的 `mindmap` 小图标**撤掉** —— 简图已经在说"我是哪种格式"；
 *      ③ 三件信息**分行**（原是一串"3 节点 · 2 层 · 10-12"）：名称 ／ 规模 ／ 时间，
 *         后两行深浅两级灰分出主次；
 *      ④ 装配改走 **`store.mindmapCardView()`**（脑图卡唯一真源）⇒ 与列表抽屉同源；
 *      ⑤ 网格列数 **6/3 → 4/2**（`MM_COLS_*` 与 wxss 的 `.mm-tile` 宽度档是一对）。
 *
 * ★★ 第一百六十九轮（用户口径 · 还是这张卡）：「简图高度稍微加大一下，因为右侧是三行文字，
 *    目前高度有点小了」＋「'更新于10-09' 太不正式了，需要改为'更新于2026年10月9日'」。
 *   ⇒ ① 简图 **48×34 → 56×40**（同一张源 SVG 放大显示，不改结构）——
 *         右侧是**三行**文字、图原来只有 34 高，被衬得太瘦；40 仍不撑高卡片
 *         （卡高一直是右侧文字块在定，图只是"填进去"）；
 *      ② 时间那件改走 **`store.cnDate()`** ＝'2026年10月9日'。
 *   ⚠️ 两处都只改这一个模块 ＋ store 里一个纯函数，没动 `todo-card`。
 */
const store = require('../../utils/store');
const pub = require('../../utils/pagebase');

/** 脑图网格：最多铺几行（用户第 7 条「默认只显示三行脑图卡片」） */
const MM_ROWS = 3;
/** 脑图网格列数 —— ⚠️ 与 wxss 里 `.mm-tile` 的宽度档位是一对，改一个必须改另一个。
 *  ★★ 168 轮：6/3 → **4/2**。卡里多了一张 56×40 的**格式简图**（见 wxml 那条注释），
 *    原来的 186px（横屏 6 列）扣掉图与间距后只剩 110px 给三行文字，太挤；
 *    减列后横屏 ≈284px、竖屏 ≈379px，最窄的手机档（横 184 / 竖 179）也放得下。 */
const MM_COLS_LAND = 4;
const MM_COLS_PORT = 2;

Component(pub.comp('project', {
  data: {
    project: null,
    /* ★ 审查-02 P1-17：色点走 `store` 色出口（原先是裸写 hex）。
       ⚠️ 原先这里还有一支 `psoft`（"色点背后那格圆底"）—— 审查-02 P2-31 查出它是**死字段**
          （`mod-project.wxml` 里没有任何元素消费那格圆底）⇒ 已删，别再补回来。 */
    pcolor: store.noneColor(),
    archived: false,

    /* ① 项目基础信息 —— ⚠️ 原先这里有一支 `stat`，审查-02 P2-31 查出是**死字段**（wxml 不读它），已删。
       真正用四档计数的是 `refresh()` 里的**局部** `stat`（喂给 `scoreOf()` 与 `urgChips`）。 */
    score: 0,
    totalCount: 0,      // 本项目待办**总数**（含已完成）
    mindmapCount: 0,    // 本项目脑图总数
    agent: null,

    /* ② 项目待办网格 —— 只放未完成 */
    openTodos: [],
    openCount: 0,     // 本项目**未完成**总数（网格的"全集"，与四档计数同源）
    shownCount: 0,    // 网格**此刻真的铺出来的**条数（有档位筛选时 = 某一档的条数）
    doneCount: 0,
    /* ★ 156 轮：紧急度档位筛选 —— `''` ＝ 全部（默认）。
       四颗胶囊的档名与条数（`urgChips`）由 `store.urgencyList()` 下发，不手抄中文名。 */
    urgFilter: '',
    urgChips: [],
    footStat: '',     // 底行左端文案（筛选态与全量态两句不同）
    gridEmpty: '',    // 网格空态文案（"筛空了"和"这个项目没有"两句不同）

    /* ③ 项目脑图网格 —— 取最近更新的、最多三行 */
    mindmapTiles: []
  },

  refresh: function () {
    const id = store.memoryOf('project');
    const p = id ? store.projectById(id) : null;

    /* 记忆失效 → 清空记忆、回空态（FR-8.4） */
    if (id && !p) store.clearMemory('project');

    const cur = store.projectById(store.memoryOf('project'));
    if (!cur) {
      /* ⚠️ `_pid` 一并复位：空态再回到某个项目时，上一次那个项目的档位筛选
         必须当作"新项目"处理（见下面那条刷新 `urgFilter` 的判断）。 */
      this._pid = null;
      this.setData({
        project: null, openTodos: [], mindmapTiles: [], agent: null,
        urgChips: [], urgFilter: '',
        openCount: 0, shownCount: 0, doneCount: 0, totalCount: 0, mindmapCount: 0,
        footStat: '', gridEmpty: ''
      });
      return;
    }

    const c = cur.color ? store.colorOf(cur.color) : null;
    const stat = store.statOfProject(cur.id);

    /* ⚠️ 这里**直接抛原始待办对象**，不要自己拼一个"精简版"。
       45 轮实测踩到：原来喂给 `todo-card` 的是 `{id, text, urgency, done, bar, mindmapName, at}`
       这样一个残缺对象 —— 而 todo-card 的观察者是按**原始字段**推导的
       （`projectId` / `mindmapId` / `images` / `createdAt` / `updatedAt`），
       于是项目页每张卡的项目气泡、脑图气泡、图片气泡**从来没渲染出来过**，
       「更新」那一栏显示的其实是 `createdAt`。现在一律抛原始对象，卡片自己推导，
       与「待办列表抽屉」完全同源。 */
    const all = store.sortTodos(store.todosOfProject(cur.id));
    const open = all.filter(function (t) { return !t.done; });

    /* ★★ 156 轮：紧急度档位筛选 ——
       ⚠️ 换项目就**清掉**：筛选是"此刻在看这一个项目"的状态，带着它跳到另一个项目
          会让人以为"这个项目只有这 N 条"。`_pid` 只在项目 id 变化时失配一次。
       ⚠️ 筛的是**未完成集合**（`open`）而不是 `all` —— 四档计数本来就是未完成口径
          （`store.statOfProject` 只数 `!done`），筛已完成的集合会让"格子写 3、点开 0 条"。
       ⚠️ 数组比较用 `===` 判断"同不同一条记录"就够：store 里的待办对象是**同一份引用**。 */
    const uf = (this._pid === cur.id) ? this.data.urgFilter : '';
    this._pid = cur.id;
    const shown = uf ? open.filter(function (t) { return t.urgency === uf; }) : open;

    /* 脑图：`mindmapsOfProject` 已按 updatedAt 倒序 ⇒「取最近更新的那几张」直接切片 */
    const mms = store.mindmapsOfProject(cur.id);
    const cols = this.data.landscape ? MM_COLS_LAND : MM_COLS_PORT;
    const a = cur.agentId ? store.agentById(cur.agentId) : null;

    this.setData({
      project: cur,
      pcolor: c ? c.main : store.noneColor(),
      archived: store.isArchived(cur),

      /* ⚠️ 原先这里还 setData 了一支 `stat`（以及 `psoft`）—— 审查-02 P2-31 查出 `data.stat` /
         `data.psoft` 都是**死字段**（wxml 不读）⇒ 已删；**局部** `stat` 变量照旧（下面要用）。 */
      score: store.scoreOf(stat),
      totalCount: all.length,
      mindmapCount: mms.length,
      /* 基础卡上那两格 agent 数据 —— 口径全部来自 store，与「我的」页 agent 卡同源
         （`quotaLow` 比例判红、`resetIn` 倒计时文案） */
      agent: a ? {
        id: a.id,
        name: a.name,
        resetIn: store.resetInOf(a)
        /* ★★ 163 / 164 轮：卡面那格数一路减到只剩「距离重置」——
           163 撤「当前剩余」（157 起它就没有填写入口 ⇒ 永远"未填"），
           164 再撤「每月套餐」（用户：「每月套餐不用显示了，就显示 agent 名称和距离重置天数」）。
           ⇒ `agent` 上只留 name ＋ resetIn（名字本身由模板那块灰底承载）。
           ⚠️ `store.quotaLowOf` / `a.monthlyQuota` **都没删** —— 「我的」/「概览」两张 agent 卡
              还在用（那边是本轮**没动**的两块）；本轮撤的是**这张卡上的展示**，不是那个数据字段。
           ⚠️ 名字那一格**不走兜底**：`agent` 为 null 时模板整块不画（走「未关联 agent」那句灰字），
              所以这里不需要 `|| '未填'` —— 兜底只该出现在"画了但可能空"的地方。 */
      } : null,

      openTodos: shown,
      openCount: open.length,
      shownCount: shown.length,
      doneCount: all.length - open.length,

      /* 四颗筛选胶囊：档名与键名都来自 `store.urgencyList()`（只有一份真源），
         条数取 `stat`（＝未完成口径的四档计数）—— 与网格筛的那一档**同源**。 */
      urgFilter: uf,
      urgChips: store.urgencyList().map(function (u) {
        return { key: u.key, name: u.name, n: stat[u.key] || 0 };
      }),

      /* 底行左端：筛选态必须改报"这一档几条"，否则左边写「未完成 5 条」、
         眼前只有 2 张卡，读起来像卡片丢了。 */
      footStat: uf
        ? (store.urgencyOf(uf).name + ' ' + shown.length + ' 条（未完成共 ' + open.length + ' 条）')
        : ('未完成 ' + open.length + ' 条 · 已完成 ' + (all.length - open.length) + ' 条'),

      /* 空态两种分开说：筛空了 ≠ 这个项目没有 —— 说反了用户会以为数据丢了。 */
      gridEmpty: open.length
        ? (store.urgencyOf(uf).name + '档暂时没有未完成的待办 —— 再点一下这颗按钮看全部')
        : '这个项目没有未完成的待办',

      /* ★★ 168 轮：脑图卡改「左格式简图 ＋ 右三行文字」——
         装配走 `store.mindmapCardView()`（★ 脑图卡的**唯一真源**，列表抽屉那张卡用的就是它）
         ⇒ 格式缩略图 / 节点数 / 层数 / 更新时间四处口径与抽屉**同源**，不再各拼各的。
         模板要的是"能直接画的四件"，所以这里只挑出来。
         ★★ 169 轮：时间那件由 `dateOf(...).slice(5)`＝'10-09' 换成 **`store.cnDate()`**
         ＝'2026年10月9日'（用户口径：「10-09 太不正式」）—— 格式收口仍在 store 里，
         这里只换一个调用点。 */
      mindmapTiles: mms.slice(0, cols * MM_ROWS).map(function (m) {
        const v = store.mindmapCardView(m);
        return {
          id: v.id,
          name: v.name,
          thumb: v.formatThumb,
          nodes: v.nodes,
          depth: v.depth,
          date: store.cnDate(v.updated)
        };
      })
    });
  },

  autoDrawer: function () { this.autoDrawerFor('project'); },

  /* ---------------- 顶栏 ---------------- */

  /* ⚠️ 已知缺口（第五十三轮未动）：本方法当前**没有任何模板绑定** ——
     项目页因此没有"点一下切项目"的等价入口，只能再点一次左导轨/底栏的「项目」。
     FR-8.2 允许这样做（已在详情时再点导航 → 弹列表抽屉）；要不要在页面上开一个入口
     由用户定。 */
  onTitleTap: function () { this.openListDrawer('project'); },

  onEdit: function () {
    if (this.data.archived) {
      wx.showToast({ title: '已归档的项目是只读的，先取消归档', icon: 'none' });
      return;
    }
    this.openForm('project', this.data.project.id);
  },

  /**
   * 基础信息卡右端那颗按钮（★ 55 轮：卡内只留**一颗**）——
   *   活跃态 ＝「编辑」→ 表单抽屉（归档入口在抽屉底部，见 onFormArchive）
   *   归档态 ＝「取消归档」→ 直接取回。为什么不是「编辑」一直配一颗「取消归档」：
   *     归档态本来就是只读的（FR-2.9 编辑入口置灰），那颗按钮留着也点不动，
   *     不如让它变成这一刻唯一有意义的动作。
   */
  onBasicAct: function () {
    if (this.data.archived) { this.doUnarchive(); return; }
    this.onEdit();
  },

  /**
   * 编辑抽屉底部的危险动作（★ 55 轮）—— 组件把「删除」位复用成「归档项目」
   * （`danger-label` 传的就是这四个字）。先收抽屉再弹确认层：
   * 确认层是系统模态，压在抽屉上会读成"抽屉里的一部分"。
   */
  onFormArchive: function () {
    this.onFormCancel();
    this.doArchive();
  },

  /** 归档确认层：先列影响面，并说清「内容不会被删除」（FR-2.9） */
  doArchive: function () {
    const self = this;
    const p = this.data.project;
    wx.showModal({
      title: '归档「' + p.name + '」？',
      content: '本项目下有 待办 ' + this.data.totalCount + ' 条 · 脑图 ' + this.data.mindmapCount + ' 张。\n\n' +
        '归档只是让它退出活跃视图：\n· 内容一条都不会删，归属关系也不变\n' +
        '· 有归档的入口，随时可以取消归档取回\n· 待办与脑图会继续出现在各自列表里，只是标上「已归档」',
      confirmText: '归档',
      success: function (r) {
        if (!r.confirm) return;
        store.archiveProject(p.id);
        wx.showToast({ title: '已归档 · 内容都在', icon: 'none' });
        self.refresh();
      }
    });
  },

  doUnarchive: function () {
    const self = this;
    store.unarchiveProject(this.data.project.id);
    wx.showToast({ title: '已取消归档，项目回到活跃视图', icon: 'none' });
    self.refresh();
  },

  /* ---------------- ① 项目基础信息 ---------------- */

  /** 整行点 → 去「我的」看这个 agent（★ 卡片右侧已无按钮，这一行是 agent 的唯一出口）
   *  ★★ 2026-10-24（复审 P2-09）：带上 `agentId` —— 与概览 agent 卡同一个口径，
   *     否则跳过去只会落在「我的」顶端，用户还得自己滚到那一张。 */
  onGoAgent: function () {
    if (!this.data.agent) {
      wx.showToast({ title: '这个项目还没关联 agent', icon: 'none' });
      return;
    }
    const id = this.data.agent.id;
    this.gotoModule('mine', id ? { agentId: id } : null);
  },

  /* ---------------- ② 项目待办 ---------------- */

  onTodoOpen: function (e) {
    store.setMemory('todo', e.detail.id);
    this.gotoModule('todo');
  },

  /**
   * 点小卡上的完成圆圈 → 直接勾掉（用户第 6 条）
   * 勾掉后这条就**离开**这张网格（网格只放未完成），同时底行「已完成」+1 ——
   * 卡片消失本身就是反馈，不再叠 toast。
   */
  onTodoToggle: function (e) {
    store.toggleTodo(e.detail.id);
    this.refresh();
  },

  /**
   * ★ 156 轮：四档计数 → **筛选键**。点某一档 ⇒ 网格只留该档的未完成待办；
   * 再点同一档 ⇒ 取消（回到全部）。"点亮的档位再点一下即取消"是这套控件的通用读法，
   * 不另立一颗「全部」——那一颗会跟四档挤在一排、还把"筛选"读成"第五个档位"。
   *
   * ⚠️ 只改 `urgFilter`，真正的筛在 `refresh()` 里做（单一落点，别在两处各筛一遍）。
   * ⚠️ `setData` 会**同步**更新 `this.data` ⇒ 紧接着调 `refresh()` 读到的已是新值；
   *    而 `_pid === cur.id` 不成立才会被 `refresh()` 清掉，这里改的档位不会自清。
   */
  onUrgFilter: function (e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ urgFilter: this.data.urgFilter === key ? '' : key });
    this.refresh();
  },

  /* ★ 56 轮：这里的「记一条」（`onQuickAdd`）与「新建脑图」（`onNewMindmap`）两颗按钮
     连同方法一起删掉（用户口径「待办有快捷键，脑图在脑图列表底部有创建按钮」）。
     ⚠️ 随之带走了一条守卫：归档项目不能新建脑图 —— 这条判断没有消失，只是**搬到了
        `utils/pagebase.js` 的 `onDrawerCreate`**（那条路径现在是唯一入口）。 */

  /**
   * ★ 156 轮：底行那颗由「查看全部」改成**「已完成待办」**（用户口径）——
   * 点开的是「已完成」那一档的列表抽屉，里面**只列已完成的**（见 `utils/drawers.js`）。
   *
   * ⚠️ `scope` 仍带 `projectId`（列表限死在本项目内）＋ `status: 'done'`（只列已完成）：
   *    两个字段是**正交**的 —— 一个管"哪个项目"，一个管"哪一半"。
   * ★★ 160 轮：第二项从 `done: true` 改写成 **`status: 'done'`** —— 待办状态本轮统一成
   *    三档一套词（`store.TODO_STATUSES`：open / done / deleted），装配口与筛选副弹窗共用
   *    同一个判定（`store.pickTodosByStatus`）。**同义留两套写法是本工程的已知坑。**
   * ⚠️ 创建入口没有跟着丢：那张抽屉底部仍是「＋ 创建待办」（`createLabel`），
   *    项目字段按 `scopeId` 预填 —— 这是本页"带着项目预填写一条"的唯一落点。
   */
  onViewDoneTodos: function () {
    this.openListDrawer('todo', { projectId: this.data.project.id, status: 'done' });
  },

  /* ---------------- ③ 项目脑图 ---------------- */

  onMindmapOpen: function (e) {
    const id = e.currentTarget.dataset.id;
    /* ★★ 280 轮：第二处入口 —— 与脑图列表、待办详情共用 `pagebase.guardMindmapOpen`
       （生成中 / 失败 / 字段未完善三档都不进画布）。闸门必须在**写记忆之前**。 */
    if (this.guardMindmapOpen(id)) return;
    store.setMemory('mindmap', id);
    this.gotoModule('mindmap');
  },

  /** 「查看全部」→ 本项目脑图列表（主弹窗里新建时项目字段按 scope 预填） */
  onViewAllMindmaps: function () {
    this.openListDrawer('mindmap', { projectId: this.data.project.id });
  }
}));
