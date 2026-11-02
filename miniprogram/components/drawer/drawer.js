/**
 * 列表类**主弹窗**（三模块共用一套壳 · FR-8.3）
 *
 * 横屏：320 × 768 @ x84 y16
 * 竖屏：320 × (--work-h-port − 18) @ x16, y = 状态栏 + 品牌栏（＝工作区顶边）
 *       ★ 63 轮：顶边不再"在遮罩里居中"，改为顶着品牌栏下沿 —— 否则会钻进系统状态栏。
 *       遮罩仍是 800 × 1192 @ (0,0)，从 y0 起把状态栏与品牌栏一起压暗。
 * 圆角 16 · 投影 0 12 32 rgba(28,28,30,.18)
 * 遮罩 #1C1C1E 35%，只压展示区（横屏 x 从 navRail 72 起、竖屏整宽，均不盖底部导航）
 * 结构 ＝ 标题行 52 ／ [筛选行 40（仅项目）] ／ 列表 ／ 底部动作 48
 *
 * ★ 第四十七轮 —— 弹窗体系的两层说法（取代原来"一级 / 二级 / 三级抽屉"）：
 *   · **主弹窗**：宽 320、**可独立弹出**。列表类 3 种（待办 / 脑图 / 项目）＋ 表单类 7 种
 *     （待办创建 / 脑图创建 / 项目创建 / agent / token / 用户信息 / 导出）。
 *     两个主弹窗可**同屏并排**，此时左侧那个**偏转且不可点**（`turned`）——
 *     两者等宽，不偏转就读作"一个盖住了另一个"。
 *   · **副弹窗**：宽 260、开在父主弹窗**右侧**的联动层，只做选择 / 筛选，
 *     **从不独立弹出，也从不让父层偏转**。本组件里就是「待办筛选」那一个（文件末尾）。
 *
 * turned：本层被同屏的**另一个主弹窗**压着时，自己「侧转」＝ 不可点
 *         绕左边缘 rotateY 25°、视距 1100 ⇒ 右缘 274、右缘高 1044，与右侧主弹窗留 12px 缝
 *         ⚠️ 副弹窗（筛选）开着时**不偏转** —— 副弹窗贴在右边是"同一层的展开"，不是"被压住"。
 *
 * 44 轮：
 *   · 待办抽屉去掉创建入口（头部 action 传空即不渲染 · 底部 dw-foot 对 kind==='todo' 整条不渲染）
 *     ⚠️ **82 轮已推翻后半句** —— 底部按钮改由 `createLabel` 决定是否渲染，
 *        待办那张现在有「＋ 创建待办」（品牌 logo 不再触发创建了，见 pagebase 头注释）。
 *   · 提示胶囊（.dw-tip）整条链路删除 —— 用户口径「『点击遮罩任意处关闭』这个提示去掉」
 *
 * 47 轮：
 *   · 待办标题改「待办-N」（N ＝ 当前列表条数）＋ 标题带右侧「筛选」按钮
 *   · 新增**筛选副弹窗**（宽 260，开在本抽屉右侧）：
 *     搜索 / 待办状态 / 所属项目 / 更新时间 —— 改任何一项都**即时联动**左侧列表，
 *     所以副弹窗里没有「确定」，只有一个「清除全部筛选」。
 *   · 列表卡的状态改**图标**（空心圆 ／ 圆圈含勾）；选中卡阴影调淡
 *
 * 56 轮（项目列表专项）：
 *   · 项目卡顶部那行「活跃 / 已归档」胶囊撤掉（用户口径「分页气泡去掉，只显示项目卡片」）
 *     ⇒ 组件里不再需要 `filter` / `filters` 两个 property 与 `onFilter` 这个方法。
 *   · 副弹窗改**数据驱动**：`tf.groups[]` 一组一组渲染，形状由装配层给
 *     （`chips` / `rows` 两种）。组件只做"把 grp.key ＋ 选中值抛出去"这一件事，
 *     不再认识"待办状态"或"所属项目"——加一个筛条件不用动这个文件。
 *
 * ★★ 195 轮（列表分页 · 待办那张）：
 *   · 新 property `pageSize`（0 ＝ 不分页，装配层给值）：默认只铺一屏 10 条，
 *     末尾一行「点击加载更多」，点一次多铺 10 条；铺完那行换成「已无更多信息」。
 *   · 实现落在 `data.view` —— 模板 `wx:for` 从 `groups` 改认它（wxml 里没法切片）。
 *     `pageSize === 0` 时 `view ≡ groups`（同一引用）⇒ 其余四张列表一字未改。
 *   · ⚠️ **只截看得见的条数**：标题那颗 `待办-N` 仍是全量 N（"这一档一共几条"与
 *     "现在铺了几条"是两件事）。
 *   ★ 195 轮**修订**（用户口径 2026-10-15：「别做成按键，就留文字；点击文字**或者再上滑
 *     列表**就可以触发加载」）⇒ ① 那行字撤掉按键外观（样式层，模板同时摘掉 `hover-class`）；
 *     ② 多一路触发：列表滚到底（`onListScroll` ＋ `onScrollLower`，见方法区的注释）。
 *  */
Component({
  properties: {
    open: { type: Boolean, value: false },
    kind: { type: String, value: 'project' },
    title: { type: String, value: '' },
    action: { type: String, value: '' },
    createLabel: { type: String, value: '' },
    /* 标题带右侧的「筛选」入口（只有待办 / 项目两张列表有；别的 kind 传空串即不渲染） */
    filterLabel: { type: String, value: '' },
    filterActive: { type: Boolean, value: false },
    /* 筛选副弹窗开着没有 —— 由**页面**控制（受控），组件只抛 openfilter / closefilter */
    filterOpen: { type: Boolean, value: false },
    /* 筛选副弹窗的全部行数据（store → drawers.build → 这里）：{ kw, ph, activeCount, groups } */
    tf: { type: Object, value: null },
    activeId: { type: String, value: '' },
    empty: { type: String, value: '' },
    groups: { type: Array, value: [] },
    port: { type: Boolean, value: false },     // 竖屏几何
    turned: { type: Boolean, value: false },   // 侧转 ＝ 不可点
    /* ★ 本轮（闪念胶囊）：**第二档**位置 —— 非 0 时右移 270（横 x354 ／ 竖 x286），
       数值与 form-drawer 的 `.sd.o1` 同规格。
       用途只有一个：闪念胶囊的「转到脑图」要把选择列表开在**胶囊抽屉右侧**（用户口径
       「右侧展开一个脑图列表选择抽屉」）⇒ 此时左边那张（胶囊）侧转不可点。 */
    offset: { type: Number, value: 0 },
    /* ★ 本轮（闪念胶囊）：**选中确认**模式 —— 填了字就在底部多一颗「确定」，
       且点条目**只记选中、不关抽屉**（闪念胶囊的「转到脑图」用它挑一张图）。
       空串 ＝ 旧行为：点一条 ＝ 直接去看那条 —— 三张列表的默认用法一行都不用改。 */
    confirmLabel: { type: String, value: '' },
    /* ★ 本轮：确认模式下**被点中的那一条**（受控 —— 页面记着、回传进来打高亮）。
       ⚠️ 与 `activeId` 分开：那个的语义是"现在挂着的 / 当前的那一条"（列表打开就知道
          "我在哪"），这个只是"这一轮的选择"，两者在同一个列表里会同时出现且含义不同。 */
    pickedId: { type: String, value: '' },

    /* ★★ 248 轮 · **多选确认态**（闪念胶囊的「选择胶囊」抽屉）：
       用户口径「可多选卡片，底部按键为『取消』『保存』」。
       · `multi`       —— 打开时点卡片只把"这一下选了谁"抛回页面（`markmulti`），
                          不关抽屉、也不走 `pick`（那个的语义是"我要去看那条"）；
       · `pickMap`     —— 选中集合 `{ [id]: true }`，**由页面受控回传**。
                          用对象不用数组：wxml 只能做 `pickMap[it.id]` 这种下标取值，
                          `array.indexOf()` 在本工程的模板里用不了（没有 wxs）。
       · `cancelLabel` —— 非空就在底部多一颗「取消」（＝什么都不做，直接关）。
       三者默认值都与"旧行为"逐字等价 ⇒ 其余四张列表的渲染与判定一个字不变。 */
    multi: { type: Boolean, value: false },
    pickMap: { type: Object, value: {} },
    cancelLabel: { type: String, value: '' },

    /* ★★ 195 轮 · **列表分页**（0 ＝ 不分页）
       用户口径（2026-10-14）：「已完成的待办在列表抽屉里显示的太多了，建议加上分页 ——
       默认显示 10 条，最后一条下方有个『点击加载更多』，点击之后再加载 10 条，
       所有都显示完成后显示『已无更多信息』」。
       ⇒ 值由装配层给（`utils/drawers.js` 只给待办那张 10；其余四张列表给 0 ＝ 旧行为）。
       ⚠️ 它只截**看得见的条数**：`title` 里那颗 `待办-N` 仍是**全量** N ——
          那一颗报的是"这一档一共几条"，与"现在铺了几条"是两件事，别合并。 */
    pageSize: { type: Number, value: 0 }
  },

  data: {
    /**
     * 搜索框里的文字（★ 47 轮）
     * ⚠️ `<input>` 是**受控**的，但只在"外部值 ≠ 本地值"时才回写 —— 每敲一个字都回写会让
     *    输入框失焦 / 光标跳回开头（小程序的老毛病）。敲键盘时页面重建的 `tf.kw` 与我们
     *    自己抛出去的值一致 ⇒ 判定不成立 ⇒ 不动输入框；只有「清除全部筛选」把它清空时才回写。
     */
    kwText: '',

    /* ★★ 195 轮 · 分页派生出来的**可见列表**（模板只认它）
       与 `groups` 同构，只是每组的 `items` 被截到 `page × pageSize` 那一条线；
       wxml 里没法切片，所以"截"这一步必须在 JS 里做完。
       ⚠️ 不分页（`pageSize === 0`）时它**就是 `groups` 本身**（同一个引用）⇒
          另外四张列表的渲染路径一字未改。 */
    view: [],
    /* 当前页码（1 起）——`onLoadMore` 加一，`groups` 一换回到 1 */
    page: 1,
    /* 还有没有下一屏（末尾那行「点击加载更多」的开关） */
    hasMore: false,
    /* 已经铺完了、而且**确实分过页**（底部那行换成「已无更多信息」）——
       ⚠️ 一共才 6 条的列表不挂这句：它一眼就看完了，"没有更多了"是废话 */
    allShown: false,

    /* ★★ 248 轮：多选态已选几条（派生自 `pickMap`，见 observers）——
       底部「保存」置灰的唯一判据。单选那几张列表读的是 `pickedId`，两套互不干扰。 */
    pickCount: 0
  },

  observers: {
    'open, tf': function () {
      if (!this.data.open) {
        if (this.data.kwText) this.setData({ kwText: '' });
        return;
      }
      const kw = (this.properties.tf && this.properties.tf.kw) || '';
      if (kw !== this.data.kwText) this.setData({ kwText: kw });
    },

    /* ★★ 195 轮：`groups` 一换就**回到第一页** —— 开抽屉 / 改一个筛条件 / 在列表里勾掉
       一条，页面都会重建这份数据；不回到第一页就会出现"筛完只剩 8 条、页码却停在第 3 页"
       的空白列表（看起来像"筛丢了"）。
       `pageSize` 跟着一起重建：装配层换档（比如将来给项目列表也打开分页）时不用再通知一次。 */
    'groups, pageSize': function () {
      /* ⚠️ 顺手把"用户滚过"那枚证据清掉（`_armed` —— 见 `onScrollLower`）：
         数据一换，列表就跳回顶部，上一轮攒下的"滚过"不再代表这一屏。 */
      this._armed = false;
      this.rebuildView(1);
    },

    /* ★★ 248 轮：多选态的"选了几条" —— 底部「保存」的置灰开关。
       模板里算不了 `Object.keys()`（本工程没有 wxs），必须在 JS 里派生一次。
       ⚠️ 只在**真变了**的时候 setData：`pickMap` 是受控对象，页面每点一下都会回传
          一个新对象，无条件下发等于每点一次多刷一次底部按钮。 */
    pickMap: function (map) {
      const m = map || {};
      let n = 0;
      Object.keys(m).forEach(function (k) { if (m[k]) n += 1; });
      if (n !== this.data.pickCount) this.setData({ pickCount: n });
    }
  },

  methods: {
    onClose: function () {
      this.triggerEvent('close');
    },
    onPick: function (e) {
      const id = e.currentTarget.dataset.id;
      /* ★★ 280 轮（用户 2026-10-27）· **锁住的卡不进入任何选中流程**。
         ── 为什么不在模板上用 `pointer-events: none` / 干脆不挂 `bindtap` ─────
         点了要**说一句为什么**（`locked` 事件把装配层那句话带出去，页面弹 toast）；
         整块失效就只剩"点了没反应"，用户会当成抽屉卡住了。
         ── 为什么组件自己**不弹** toast ────────────────────────────────────
         本工程组件一律不弹提示（文案归装配层 / 页面），组件只回答"这一下算不算数"。
         ── 闸门在这里、不在 `onConfirm` ─────────────────────────────────────
         选中集合（`markmulti`）/ 单选（`mark`）都不能把锁住的卡装进去 —— 装进去之后
         底部那颗键还亮着，用户点下去才被拦，等于白走一趟。
         ⚠️ `data-lock` 空串 ⇒ `dataset.lock === ''` ⇒ 走原路（其余三张列表没有这个 dataset，
            取到 `undefined`，同样走原路）。 */
      const lock = e.currentTarget.dataset.lock;
      if (lock) {
        this.triggerEvent('locked', {
          id: id, state: lock, tip: e.currentTarget.dataset.lockTip || ''
        });
        return;
      }
      /* ★★ 248 轮：**多选态**点一条只记选中、不关抽屉 —— 选中集合由页面受控回传
         （`pickMap`）。为什么不让组件自己存：底部「保存」要提交的是"整个集合"，
         而页面才是那个"知道选完往哪儿写"的一方（与 `pickedId` 同一条纪律）。 */
      if (this.properties.multi) { this.triggerEvent('markmulti', { id: id }); return; }
      /* ★ 本轮：确认模式下点一条**不关抽屉**，只把选中项抛回页面（页面受控回传 `pickedId`）。
         关不关由页面决定 —— 它才知道"选完之后还有没有别的动作"。 */
      if (this.properties.confirmLabel) { this.triggerEvent('mark', { id: id }); return; }
      this.triggerEvent('pick', { id: e.currentTarget.dataset.id });
    },
    /** 确认模式底部那颗「确定」—— 把当前选中项抛回页面（没选就什么都不做） */
    onConfirm: function () {
      /* ★★ 248 轮：多选态交出去的是**一批 id**（`ids`）；`id` 仍带上第一条，
         让 "只关心一条" 的调用方不必分支（当前没有这样的调用方，留着是为形状稳定）。 */
      if (this.properties.multi) {
        const map = this.properties.pickMap || {};
        const ids = Object.keys(map).filter(function (k) { return !!map[k]; });
        if (!ids.length) return;
        this.triggerEvent('confirm', { ids: ids, id: ids[0] });
        return;
      }
      const id = this.properties.pickedId || '';
      if (!id) return;
      this.triggerEvent('confirm', { id: id });
    },
    /**
     * ★★ 248 轮：底部那颗「取消」—— 语义是"这一轮的选择不算数"，与「关闭」不同：
     * 关闭是"看完了"，取消是"我改了主意"。组件只负责抛事件，关不关由页面决定
     * （页面还可能要顺手清掉 `pickMap`）。
     */
    onCancel: function () {
      this.triggerEvent('cancel');
    },
    onCreate: function () {
      this.triggerEvent('create');
    },

    /* ---------------- 列表分页（★★ 195 轮） ----------------
       唯一的写点：`view` / `page` / `hasMore` / `allShown` 四个值只在这里改
       （别处再写一遍迟早对不上 —— 本工程在"同一个量两处写法"上返工过好几次）。
       @param {number} nextPage 目标页码（1 ＝ 回到第一页） */
    rebuildView: function (nextPage) {
      const size = Number(this.properties.pageSize) || 0;
      /* ⚠️ 读 `properties.groups`（不是 `data.view`）—— 每次重建都从**全量**重算，
         否则第二屏会变成"在截过的结果上再截一段"。 */
      const groups = this.properties.groups || [];
      const page = Math.max(1, Number(nextPage) || 1);

      /* 不分页：整份照搬（同一引用），底部那两行也一起关掉 */
      if (!size) {
        this.setData({ view: groups, page: 1, hasMore: false, allShown: false });
        return;
      }

      /* 跨组计数：`pageSize` 说的是"**整张列表**先露几条"，不是"每组露几条"。
         待办那张只有一个组（分组在 44 轮就拍平成一条流水了），但 `view` 的形状对
         四张列表都成立 —— 不给自己留第二种读法。 */
      let budget = size * page;
      let total = 0;
      const view = groups.map(function (g) {
        const items = g.items || [];
        total += items.length;
        const take = budget > 0 ? items.slice(0, budget) : [];
        budget -= items.length;
        /* ⚠️ 被分页截空的组要打 `cut` 标记：模板里那句「这个分组下暂时是空的」
           只在**数据本身为空**时说，不然第二组会被读成"这个分组没有内容"（假的）。
           目前分页只开在待办那张（单组，撞不到），标记是给将来留的门。 */
        return Object.assign({}, g, { items: take, cut: take.length < items.length });
      });

      this.setData({
        view: view,
        page: page,
        hasMore: total > size * page,
        allShown: total > size && total <= size * page
      });
    },

    /** 末尾那行「点击加载更多」—— 点它多铺一屏（`pageSize` 条）
     *  ★ 195 轮修订：它已经**不是一颗键**（用户口径 2026-10-15：「别做成按键，就留文字」）
     *  ⇒ 样式撤底撤边；但**点击这件事没变**（行高 34、整行可点，删的只是外貌）。 */
    onLoadMore: function () {
      if (!this.data.hasMore) return;
      this.rebuildView((this.data.page || 1) + 1);
    },

    /* ---------------- 滚到底接着铺（★★ 195 轮修订 · 上滑那一路） ----------------
       用户口径（2026-10-15）：「点击文字**或者再上滑列表**就可以触发加载」。

       ⚠️ 为什么"滚到底"不能只挂 `bindscrolltolower` 一个事件：
          **内容还没撑满容器**时（iPad 上抽屉高、10 条待办占不满一屏），
          `enhanced` 的 `scroll-view` 首屏渲染就会自己触发一次 `scrolltolower` ——
          那一下会把 10 条一路自动铺到底，"默认 10 条"当场失效（而且用户根本没滑）。
          所以这一路**必须先拿一次"用户真的滚过"的证据**才算数：`onListScroll` 里
          见到 `scrollTop > 0` 才把 `_armed` 立起来；数据一换（observer）再放倒。
          ★ 与 capsule.js 那条同源经验："内容没撑满视口"是这一族事件的固有陷阱。
       ⚠️ `_armed` 放在**实例**上（`this._armed`）不进 `data`：它不参与渲染，
          进 data 只会白白多一次 setData。 */
    onListScroll: function (e) {
      if (e && e.detail && e.detail.scrollTop > 0) this._armed = true;
    },
    onScrollLower: function () {
      if (!this._armed) return;      // 用户没滚过 ⇒ 这一次是"内容没撑满"的自触发，不算
      this.onLoadMore();
    },

    /* ---------------- 副弹窗：列表筛选（★ 47 轮待办 ／ ★ 56 轮起项目也有） ----------------
       ★ 56 轮改数据驱动：组件不再认识具体的筛条件，只认识**两种形状** ——
         胶囊（`onPickChip`）与行（`onPickRow`）。组的键名（`data-k`）由装配层给，
         值（`data-v`）原样抛回页面，页面按抽屉 kind 派给对应的 store 写入函数。
         好处：加/改一个筛条件只动装配层，这个文件与 wxml 都不用碰。 */

    onOpenFilter: function () { this.triggerEvent('openfilter'); },
    onCloseFilter: function () { this.triggerEvent('closefilter'); },

    /** 关键词：边打边联动（每敲一个字都过一遍列表，本地数据量下比"回车才生效"直观） */
    onKwInput: function (e) {
      const v = e.detail.value || '';
      this.setData({ kwText: v });
      this.emit('kw', v);
    },
    onKwClear: function () {
      this.setData({ kwText: '' });
      this.emit('kw', '');
    },

    /* 两个"点一下就换"的形状 —— 都把新值抛给页面，由页面写 store 并重建列表抽屉，
       这样左右两边的选中态同源，不会出现"条件变了但左边没动"。 */
    onPickChip: function (e) {
      const ds = e.currentTarget.dataset;
      this.emit(ds.k, ds.v);
    },
    onPickRow: function (e) {
      const ds = e.currentTarget.dataset;
      /* ⚠️「全部」那一行在行数据里的 id 是哨兵 `__all`（`wx:key` 不能是空串），
         落到数据层要变回 '' —— 与三级抽屉「不关联」的 `__none` 同一个坑。
         （胶囊组的「全部」用的是 `'all'`，存储口径本来就是 'all'，不需要翻。） */
      const raw = ds.v;
      this.emit(ds.k, raw === '__all' ? '' : (raw || ''));
    },

    onResetFilter: function () { this.triggerEvent('filterreset'); },

    emit: function (key, value) {
      this.triggerEvent('filterchange', { key: key, value: value });
    }
  }
});
