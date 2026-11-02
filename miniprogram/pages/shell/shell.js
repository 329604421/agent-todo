/**
 * 壳页 —— 全应用唯一的页面（09-21 起）
 *
 * 为什么要壳页：
 *   老结构是「五个页面 + wx.reLaunch 切换」。reLaunch 会关掉全部页面再重建目标页：
 *     · 屏幕上必然先白一下（新页面要从零编译、布局、渲染）
 *     · 底栏是页面里的组件，跟着被销毁重建 —— 黄色滑块每次都从零开始，做不出滑动
 *   改成壳页后：
 *     · 模块组件**挂载一次后常驻**，切模块只改一个行内 display ⇒ 视图不重建，白屏消失
 *     · 底栏 / 导轨只有一份实例，滑块位置是连续的 ⇒ 点一下就能看到它滑过去
 *   ⚠️ 「常驻」不等于「启动就全挂」：五个模块是**首次切到时才挂**（懒挂载，见 switchTo）。
 *      启动时全挂的话，首帧之后 60ms 会来一次四棵视图树的批量渲染，
 *      在真机上正好落在「内容刚出来」那一下 —— 表现为启动后抖动，比白屏更难解释。
 *      挂上之后就不再销毁：回头看已访问过的模块是纯 display 切换，零重建。
 *
 * 壳页负责：
 *   · 方向判定（stage.fit）→ 写 stage / stage-wrap 的行内样式，并把 landscape 传给五个模块
 *   · 骨架与外壳：stage-wrap / stage / app、左导轨 72、底部导航 88、悬浮 Logo
 *   · 导航落点（FR-8）：交给 utils/nav.planFrom 判定「弹抽屉」还是「切模块」
 *   · 跨模块跳转：模块 triggerEvent('goto') → 这里 switchTo
 *   · ★ 本轮（FR-9）：两处品牌块 → 「闪念胶囊」入口；胶囊回灌的三态落到 capBrand / capClock
 *
 * ★★ 本轮（手机端）：「手机 / 平板」与「横竖屏」是两个**正交**开关（见 stage.js 的
 *   PHONE_MAX_SHORT）。手机端这一期**只有闪念胶囊**：
 *     · 不挂任何模块（五个 `.modwrap` 全不渲染）⇒ 省掉五棵视图树的实例化；
 *     · 不渲染左导轨 / 底部导航 / 右下悬浮块（那三样都是"五个模块"的导航，
 *       只有一个功能时它们全是空壳）；
 *     · 只留 `[品牌栏] + [胶囊]`，胶囊底部三键换成录音条（见 capsule.wxml 的 `phone`）。
 *   ⚠️ 「手机端只有胶囊」**不是**靠 `active` 停在某模块实现的 —— 那种做法会把
 *      胶囊的开关挂在"当前在哪个模块"上，将来一改导航就散。这里是**骨架级**的：
 *      手机端压根没有模块容器。
 */
const stage = require('../../utils/stage');
const nav = require('../../utils/nav');
const store = require('../../utils/store');
/* ★★ 126 轮：刷新失败要把它翻成"一句可执行的话"（`netHint` 的单一真源在 api.js） */
const api = require('../../utils/api');
/* ★★ 186 轮（深色模式）：壳页是**唯一的挂载点** —— `.theme-dark` 由它挂到根节点上 */
const theme = require('../../utils/theme');

const MODULES = nav.MODULES;

/**
 * 初始方向：在 Page 构造时同步探一次。
 * 不这么做的话 data 里只能写死一个默认值，竖屏下首帧会先造出一个马上要被 wx:if 销毁的
 * nav-rail（含 5 张 SVG），横屏同理多发一次 bottom-nav —— 白付一次组件实例化。
 */
const INIT_LAND = stage.orientation() === 'land';

/**
 * 初始「是不是手机」—— 同样在 Page 构造时同步探一次（理由同上：别让首帧先造
 * 出一个马上要被 wx:if 销毁的 nav-rail / bottom-nav）。
 * ⚠️ 传 {} 空对象不行（那是"没有视口"）⇒ 用 stage.phone() 自读视口。
 */
const INIT_PHONE = stage.phone();

/**
 * 初始主题 —— 与上面两个同一套理由：**在 Page 构造时同步探一次**。
 * `theme.current()` 是同步读宿主主题的（见 utils/theme.js），所以这里拿到的就是
 * 首次渲染该用的那个值 ⇒ 不存在"先画浅色、再切深色"的那一帧（设计稿 §6.2 的硬要求）。
 * ⚠️ 读不到（旧宿主 / 未开 darkmode）⇒ `theme.isDark()` 恒为 false ⇒ 没有 `.theme-dark`
 *    ⇒ 走的还是原来那套浅色令牌，视觉与适配前逐像素一致。
 */
const INIT_DARK = theme.isDark();

/** 五个挂载位的行内 display —— 只留当前模块可见，其余 display:none（行内优先级最高） */
function visOf(active) {
  const v = {};
  MODULES.forEach(function (k) { v[k] = k === active ? '' : 'display:none;'; });
  return v;
}

/**
 * 「已挂载」开关 —— 首屏只挂当前模块（概览），其余四个等用户第一次切过去时再挂。
 * 这样启动时只渲染用户真正看到的那一棵视图树；挂过的模块不再销毁（见 switchTo）。
 */
function mountOf(active) {
  const v = {};
  MODULES.forEach(function (k) { v[k] = k === active; });
  return v;
}

Page({
  data: {
    active: 'overview',
    landscape: INIT_LAND,
    /* ★ 手机端：短边 < 600（见 stage.js）。手机端**只有闪念胶囊**，
       不挂五个模块、不渲染导轨 / 底栏 / 悬浮块。 */
    phone: INIT_PHONE,
    /* ★★ 186 轮：深色开关 —— 只给根节点换类名（`.theme-dark`），
       令牌表在 `app.wxss`，**只写一份**。切换时还要把已挂载的视图重画一遍
       （理由见 `onTheme`：数据侧的颜色是行内 hex，不走 CSS 令牌）。 */
    dark: INIT_DARK,
    stageStyle: '',
    stageWrapStyle: '',
    vis: visOf('overview'),
    mounted: mountOf('overview'),
    /* ★ 本轮（FR-9）：两处品牌块的三态 —— 'logo' ／ 'mic' ／ 'rec'（见 nav-rail.js 的注释）。
       初值恒为 'logo'：胶囊抽屉默认关着，而"关着"就是"显示品牌图"这件事本身。 */
    capBrand: 'logo',
    capClock: '',
    /* ★★ 2026-10-24（复审 P2-02）：**首屏到底在哪一档** —— 只有它说"完了"才收起加载提示。
       为什么需要：`app.startup()` 一进来就 `wipeToEmpty()`（这是对的，绝不拿演示数据顶首屏），
       而 `GET /sync` 是异步的 ⇒ 从首帧到快照回来之间，五个模块画的是**自己的空态**。
       弱网下那几秒里，用户看到的是"还没有数据 + 去新建"的引导 —— 而事实上数据可能一大堆，
       很容易读成"我的东西被清空了"，甚至照着引导重复建一条。
       ⚠️ 判据只看 `app` 的启动回执（`whenSettled`），不看"有没有数据"：
          `store.isLoaded()` 在启动失败时恒为 false，拿它当判据会让提示永远挂着。
       ⚠️ mock / 走查态也必须能收起来：`whenSettled` 是**无条件**回调的那条路，
          `whenBooted` 在 mock 档压根不触发（见 app.js 的 `shouldRepaint`）。 */
    booting: true
  },

  onLoad: function () {
    this._ready = false;
    /* ★★ 186 轮（深色模式）：主题变化**只做两件事**，不重启、不重新登录、不销毁模块、
       不刷新业务数据、不打断录音、不清未保存表单（设计稿 §「切换只改外观」的硬要求）：
         ① 换根节点的 `.theme-dark` ⇒ WXSS 那一整套令牌跟着换（纯 CSS，零 JS 代价）；
         ② 把**已挂载的视图**重画一遍 ⇒ 数据侧那些**行内 hex**（项目八色 / 紧急四档 /
            热力图 5 档 / 脑图连线）跟着换。它们不走 CSS 令牌，只换 ① 会留下一屏"底色变了、
            色点还是浅色那套"的错色。
       ⚠️ 走 `repaintAll()` 而不是 `refreshData()`：前者**只重画、不发请求**
          （`onDataRefreshed` ＝ 重建开着的列表 ＋ 各模块 refresh），
          正是"切主题不该碰数据"这条口径的落点。
       ⚠️ 回调引用挂在 `this` 上：`onUnload` 要能原样摘掉（不能写成匿名函数，
          否则页面退了它还留在订阅表里，下次 setData 打在一个已销毁的页面上）。
       ⚠️ `splash` / `icon` 各自订阅、各自重绘（开屏是画布、图标是换 SVG 文件，
          都拿不到 CSS 令牌）—— 那两处**不归壳页管**。 */
    const self = this;
    this._onTheme = function () { self.onTheme(); };
    theme.subscribe(this._onTheme);

    /* ★ 本轮：数据在别处被删掉时的**唯一**通知口（技术文档 §9.4 的 `2002` 通路）。
       记忆由 `store` 自己清（它才知道三个 id 还能不能在数组里找到），
       壳页只负责"重画" —— 与 `whenBooted` 同一个收口。
       ⚠️ 用 `relayoutAll + showActive` 而不是直接 `switchTo`：那个已经不存在的详情
          会在下一轮 `show()` 里走"记忆失效 → 弹列表抽屉"的既有分支，**不在这里复制一份**。 */
    store.onDataGone(function () {
      const p = getCurrentPages();
      const page = p[p.length - 1];
      if (!page || !page.relayoutAll) return;      // 页面已经退了（比如从胶囊那一屏离开）
      page.relayoutAll();
      page.showActive();
    });

    /* ★★ 2026-10-24（复审 P2-01）：**写操作整块回滚之后，把视图重画一遍**。
       ── 改前：`store` 失败时只做 `restore(快照)` ＋ 一句"保存失败，已还原"，
          **没有任何人通知视图** ⇒ 界面上那颗"已完成"的勾、刚归档走的卡片还留着，
          提示却说已经还原 —— 用户不知道该信哪个（复审把这条列在"反馈可信"里）。
       ── 现在：store 新增 `onRollback` 订阅口，只在这种"我替你撤回来了"的场合发一次；
          壳页按"数据换了一份"处理（与 `onDataGone` 同一个出口）。
       ⚠️ 成功**不订阅**：绝大多数调用方自己就会 `refresh()`，统一重画会白付一次 setData，
          还会打断正在输入的表单。
       ⚠️ 回调引用挂在 `this` 上、`onUnload` 原样摘掉 —— 与主题订阅同一条纪律。 */
    this._onRollback = function () {
      const p = getCurrentPages();
      const page = p[p.length - 1];
      if (!page || !page.relayoutAll) return;
      page.relayoutAll();
      page.showActive();
    };
    store.onRollback(this._onRollback);
  },

  onUnload: function () {
    if (this._onTheme) theme.unsubscribe(this._onTheme);
    this._onTheme = null;
    if (this._onRollback) store.offRollback(this._onRollback);
    this._onRollback = null;
  },

  /**
   * ★★ 186 轮 · 主题变了（宿主发的，或 `App.onShow` 前台复核补的，见 utils/theme.js）。
   *
   * 这是"**低层定义、高层执行**"：`theme.js` 只负责"主题从 A 变成 B 了吗"，
   * 至于"变了之后要重画哪些东西"由这里决定（别的订阅者管自己：splash / icon）。
   *
   * ⚠️ 这里**不碰** `stage` / `phone` / `landscape`：主题与画布几何正交
   *    （183–185 轮那套 `scale` 推导一个字都不该因为换色而变）。
   */
  onTheme: function () {
    const dark = theme.isDark();
    if (dark === this.data.dark) return;      // 去重（`theme.js` 已经去过一次，这里再兜一层）
    const self = this;
    this.setData({ dark: dark }, function () {
      self.repaintAll();
    });
  },

  onReady: function () {
    const self = this;
    /* 首屏：算一次骨架 → 布局落定后把当前模块「激活」一次（等价原页面的 onShow）
       ⚠️ 第一个参数是视口，回调必须走第二个形参 —— 传成第一个会让 fit() 拿到一个函数。 */
    this.layout(null, function () {
      self._ready = true;
      self.showActive();
    });
    /* ★ 本轮：`GET /sync` 的快照回来的那一下要**再画一遍**。
       首屏用的是 mock 种子数据（`store.boot()` 是异步的，不等它），
       快照灌进 `store` 之后视图手上的还是旧数组 ⇒ 不重画就是"明明登录了却一直显示演示数据"。
       ⚠️ 用 `relayoutAll()` 而不是只刷当前模块：它是"所有已挂载视图各重排一次"的既有出口
          （概览的热力滚动位、我的的诊断面板都挂在这上面），且 `phone` 分支也已在里面收口。 */
    const app = getApp();
    /* ★★ 2026-10-24（复审 P2-02）：启动链路**尘埃落定**（成功 / 失败都算）就收起加载提示。
       ⚠️ 与下面 `whenBooted` 是两件事，别合并：
          · `whenSettled` —— **无条件**回调一次，只用来关"正在同步"；
          · `whenBooted` —— 只在"该重画"时回调（mock / 回落档不走），负责灌数据后重画。
          合并的后果是 mock 档永远收不起那条提示。 */
    if (app && app.whenSettled) {
      app.whenSettled(function () {
        if (self.data.booting) self.setData({ booting: false });
      });
    }
    if (app && app.whenBooted) {
      app.whenBooted(function () {
        self.relayoutAll();
        self.showActive();
        /* ★★ 154 轮 · **手机端必须额外走一次 `repaintAll()`** ──────────────────
         * 用户口径（2026-10-10）：*「手机端刚进来还是空数据，要下拉才能拉到数据库的数据」*。
         *
         * 根因：冷启动这条"数据到位"的通知在手机端**被整条挡掉了** ——
         *   `relayoutAll()` 的手机分支只调 `cap.bootPhone()`，而它落到 `_bootPhone()`
         *   的幂等守卫 `if (this.data.open) return;`；`attached` 早就在开屏时
         *   把 `open` 置了 true（103 轮"开机即开"）⇒ 这一次什么都没做，
         *   **没人再读一遍 store** ⇒ 列表停在首帧那份**空数组**上。
         *   （首帧为什么必然空：`app.startup()` 一进来就 `wipeToEmpty()`。）
         *   能救回来的只有 `cap.refresh()`，而手机端调它的唯一入口是 `repaintAll()`。
         * ⇒ 这一行就是那条断线。`repaintAll()` 在手机端**只读内存、不发请求**
         *   （发请求的是 `refreshData()`）⇒ 补它**不会**让冷启动多发一个 `GET /sync`，
         *   128 轮"首屏那次刻意跳过 `refreshOnShow`"的口径仍然成立。
         * ⚠️ 顺序：`relayoutAll()` 在前（它负责开屏与摆滚动位），本行在后（把数据读进来）。
         * ⚠️ 别把它改成无条件调：非手机端那条口径是 `relayoutAll + showActive`（127 轮），
         *    已经是对的；`repaintAll()` 在那边会逐模块 `onDataRefreshed()`，是另一条路。
         * ⚠️ 也别改成 `refreshData()`：那会与 `boot()` 并发抢同一个 `GET /sync`。 */
        if (self.data.phone) self.repaintAll();
      });
    }
  },

  onShow: function () {
    stage.note('show');
    const self = this;
    /* ★★ 128 轮 · 「回到这一屏就拉一次」的首屏判据 —— **必须在这里同步定下来**。
       ⚠️ 不能挪进 `layout` 的回调里判（那是 setData 之后，而 setData 的回调
          与 `onReady` 谁先谁后**不确定**：onShow 那次 setData 若排在 onReady 之后，
          回调里看到的就不再是首屏了）。详见 `refreshOnShow` 的注释。 */
    const firstShow = this._shown !== true;
    this._shown = true;
    this.layout(null, function () {
      if (self._ready) self.showActive();
      if (!firstShow) self.refreshOnShow();
    });
  },

  /** Page.onResize(res)：官方尺寸变化通道，优先取 res.size */
  onResize: function (res) {
    stage.note('onResize', res);
    this.layout(stage.viewportFromResize(res));
  },

  /**
   * 方向自适应：横 1280×800 ／ 竖 800×1280。
   * landscape 通过 property 下发给五个模块；模块内部的 syncHeat / 脑图排版靠它。
   * 布局落定（setData 回调）后再让五个模块各重排一次 —— 方向没变时不触发 property
   * observer，所以这一次显式重排是必要的。
   */
  layout: function (vp, cb) {
    const st = stage.fit(vp);
    const self = this;
    /* 幂等短路：onShow 在 onReady 之前，两次算出来的骨架是同一套（同一视口、同一次登录态）。
       没有这段的话每次进入页面都要连做两次「改方向相关字段」的整页 setData，
       白付一次重渲染。方向真的变了 / 首次没有样式时才走完整路径。
       ★ 手机端：`phone` 必须一起比 —— 它变了要整页换骨架，比"没变"的代价大得多。 */
    const same = st.landscape === this.data.landscape &&
                 st.phone === this.data.phone &&
                 st.style === this.data.stageStyle &&
                 st.wrapStyle === this.data.stageWrapStyle;
    if (same) {
      this.relayoutAll();
      if (cb) cb();
      return;
    }
    this.setData({
      landscape: st.landscape,
      phone: st.phone,
      stageStyle: st.style,
      stageWrapStyle: st.wrapStyle
    }, function () {
      self.relayoutAll();
      if (cb) cb();
    });
  },

  /** 五个模块各重排一次（概览的热力滚动位、我的的诊断面板都挂在这上面）
   *  ★ 手机端没有模块 ⇒ 直接返回（`compOf` 本来也会逐个返回 null，但那要 selectComponent
   *    五次，白跑；这里是骨架已知为空时的短路）。 */
  relayoutAll: function () {
    /* ★★ 103 轮：手机端唯一要"重排"的是胶囊 —— 它那一屏是**开机即开**的
       （没有"打开抽屉"这个动作），而"开"这件事**不能只靠组件的 `attached`／
       `observers.phone`**：
         · `attached` 可能发生在 `phone` 还是 false 的时候（先按平板挂载、再切手机）；
         · `observers.phone` 只在**值变了**才响 —— 首次就是 `true` 时它一声不响。
       ⇒ 页面这里每跑一次就顺手调一次胶囊的 `boot()`（幂等，见组件里的注释）。
         这是"谁掌握 `phone`、谁负责通知"的收口：`phone` 由壳页算出，就让壳页说。 */
    if (this.data.phone) {
      const cap = this.selectComponent('#cap');
      if (cap && cap.bootPhone) cap.bootPhone();
      return;
    }
    const self = this;
    MODULES.forEach(function (k) {
      const c = self.compOf(k);
      if (c && c.relayout) c.relayout();
    });
  },

  /* ---------------- ★★ 126 轮 · 手动刷新 ----------------
   * 用户口径（2026-10-08）：*「当前小程序前端缺少刷新机制，这导致我在手机端操作完后，
   * 在 pc 端和平板端都看不到数据，而且页面也没有地方来触发接口刷新」*。
   *
   * 背景：本项目是「**启动时一次全量快照 ＋ 之后全靠单实体增量写**」（技术文档 §6.2）。
   * 好处是平时不用轮询；代价是**多设备之间互不知情** —— A 端写进去的东西，
   * B 端内存里那份快照里根本没有，界面自然什么都不会变。缺的正是这条"再拉一次"的路。
   *
   * 触发点四处，全部收口到 `refreshData()` 这一个入口：
   *   · **主导航**（横屏左导轨 / 竖屏底栏）点任何一项 —— 含"就在当前模块再点一次"。
   *   · **品牌块**（导轨底部 / 竖屏悬浮块）—— 点开闪念胶囊也算一次"我现在要动数据了"。
   *   · **手机端胶囊列表下拉到顶** —— 手机没有导航可点，下拉就是它的那次刷新（见 capsule）。
   *   · **手机端回到这一屏**（`onShow`，★ 128 轮）—— 用户口径「用户进入该页面也需要
   *     触发刷新」。手机端唯一的那一屏就是胶囊 ⇒ 切回前台就是"进入该页面"。
   *     ⚠️ 首屏那一次**刻意跳过**（启动链路已经在拉，见 `refreshOnShow`）。
   */

  /**
   * 拉一次最新快照并**把所有已挂载的视图重画一遍**。
   *
   * ⚠️ 刻意**不阻塞导航**：调用方（`onNav`）先做导航动作（同步、立刻有反馈），
   *    再叫这里。数据回来后 `repaintAll()` 把内容换成新的 —— 用户看到的是
   *    "切过去 → 内容闪一下变成最新的"，而不是"点一下 → 转圈 1 秒 → 才切"。
   *    刷新期间手上那份旧数据照常可读，这也是它比"先转圈再切"更好的地方。
   *
   * @param {object} [opts] `{ silent:true }` ⇒ 失败不弹 toast
   * @returns {Promise} 重画完成的回执（手机端胶囊下拉要等它来收指示器）
   */
  refreshData: function (opts) {
    const self = this;
    const silent = !!(opts && opts.silent);
    /* 并发去重：连点几下只跑一趟重画（`store.refresh()` 那一层还会再把请求也去一次重） */
    if (this._refreshing) return this._refreshing;

    this._refreshing = store.refresh().then(function (r) {
      self._refreshing = null;
      self.repaintAll();
      /* ⚠️ 只报**失败**：成功时静默 —— 每次点导航都弹一个"已更新"是噪音，
         而"内容自己变新了"本身就是最好的回执。失败必须说（见 `netHint` 的分档）。 */
      if (!r.ok && !silent) {
        wx.showToast({ title: api.netHint(r), icon: 'none', duration: 2200 });
      }
      return r;
    }, function (e) {
      self._refreshing = null;
      if (!silent) wx.showToast({ title: api.netHint(e), icon: 'none', duration: 2200 });
    });
    return this._refreshing;
  },

  /**
   * ★★ 128 轮 · 手机端「**进入这一屏就拉一次**」。
   *
   * 用户口径：*「目前仅仅是下拉增加了数据刷新功能，用户进入该页面也需要触发刷新」*。
   *
   * ── "进入该页面"在手机端等于什么 ──────────────────────────────────────
   * 手机端**只有闪念胶囊这一屏**（骨架即如此，见文件头）：它不是"打开抽屉"，
   * 而是"这一屏本来就是它"。所以"进入该页面"＝**回到前台**，
   * 落点就是 `onShow`（首次那一次由启动链路负责，见下）。
   * ⚠️ 平板 / PC **不在这里刷**：它们有导航可点（126 轮已收口），
   *    而用户这一轮点名的验收面只有手机端 —— 顺手改别的端＝替用户改口径。
   *
   * ── 为什么首屏那次要跳过（不是"忘了"）──────────────────────────────
   * 冷启动已经在拉了：`app.startup()` → `store.boot()`，回来的回调走 `whenBooted`
   * → 壳页 `relayoutAll + showActive`（127 轮修好的那条）。
   * 不跳过的话，冷启动会**同时**发两个 `GET /sync` —— `boot()` 与 `refresh()`
   * 是两个函数，各自的并发守卫挡不住对方。
   * ⇒ 由 `onShow` 里那个 `firstShow` 拦住（**在 layout 之前同步判定**，
   *   理由见那边的注释：setData 回调与 `onReady` 的先后不确定）。
   *
   * ⚠️ 别把判据改成 `store.isLoaded()`：那是"这份数据来自后端"，不是"这是首屏"。
   *    `boot()` 失败（弱网 / 后端抖 / 域名没加白）时它一直是 false
   *    ⇒ 用户切回来**永远不刷** —— 而那恰恰是最需要刷的时候。
   * ⚠️ 也别用 `this._ready` 当判据：它在 `onReady` 的 layout 回调里才置真，
   *    而 onShow 首屏那次 setData 的回调可能排在它**之后** ⇒ 首屏会漏刷一次
   *    （"首屏多发一个请求"与"首屏该发的没发"是同一处时序写错的两个方向）。
   *
   * ── 失败为什么要弹 toast（这里不传 silent）──────────────────────────
   * 下拉刷新失败有自己的载体（指示器会写"同步失败"）；这一条**没有任何可见载体**
   * （页面没跳、内容没动）⇒ 不弹一句就成了"切回来什么都没发生"。
   */
  refreshOnShow: function () {
    if (!this.data.phone) return;
    this.refreshData();
  },

  /**
   * 数据换了一份之后，让**每一个已挂载的视图**按新数据重画一遍。
   * ⚠️ 手机端没有模块容器 ⇒ 只叫胶囊（它那一屏**就是**全部内容）。
   * ⚠️ 只遍历 `MODULES` —— 没挂载过的模块 `compOf()` 返回 null，跳过即可：
   *    它们将来首次挂载时会带着新数据渲染，这里不用管。
   */
  repaintAll: function () {
    if (this.data.phone) {
      const cap = this.selectComponent('#cap');
      if (cap && cap.refresh) cap.refresh();
      return;
    }
    const self = this;
    MODULES.forEach(function (k) {
      const c = self.compOf(k);
      if (!c) return;
      /* 模块自己的 `onDataRefreshed`（pagebase 基座提供）＝ 重画详情 ＋ 重建开着的列表弹窗 */
      if (c.onDataRefreshed) c.onDataRefreshed();
      else if (c.refresh) c.refresh();
    });
  },

  compOf: function (key) { return this.selectComponent('#m-' + key); },

  /**
   * 当前模块「被激活」：刷新数据 + 首次落地且无记忆时自动弹列表抽屉（FR-8.2）
   * ★ 手机端没有当前模块 ⇒ 什么都不做。
   */
  showActive: function () {
    if (this.data.phone) return;
    const c = this.compOf(this.data.active);
    if (c && c.show) c.show();
  },

  /* ---------------- 导航落点（FR-8） ---------------- */

  onNav: function (e) {
    const key = e.detail && e.detail.key;
    /* ⚠️ 这一句是**必须**的（126 轮补）：`planFrom()` 对不认识的 key 也回 'none'，
       少了它，任何一个脏 key 都会平白发一次刷新请求。 */
    if (!nav.isModule(key)) return;
    const p = nav.planFrom(this.data.active, key);

    /* ① 先把导航动作做完 —— 同步执行 ⇒ 点下去立刻有反馈，不等网络 */
    if (p.action === 'drawer') {
      /* 已经在这个模块上、再点一次 → 弹列表抽屉换一个 */
      const c = this.compOf(key);
      if (c && c.openListDrawer) c.openListDrawer(key);
    } else if (p.action === 'switch') {
      this.switchTo(key);
    }
    /* ★★ `action === 'none'`（在「概览」/「我的」这类**没有详情**的模块上再点一次）
       **也照样往下走刷新** —— 用户口径是"点击功能菜单时重新刷新数据"，
       而"再点一下当前这一项"恰恰是多设备同步时最顺手的那次刷新动作
       （这两页没有列表弹窗可弹，原先这里直接 return，等于点了没反应）。
       代价为零：`planFrom` 本来就是为"抽屉 vs 切模块"设计的，刷新与它正交。 */

    /* ② 再拉一份最新快照并把视图重画一遍（异步；见 `refreshData` 的注释） */
    this.refreshData();
  },

  /**
   * 切模块：只改 active 与五个挂载位的 display，不重建任何视图。
   * 首次切到某模块时顺带把它挂上（懒挂载）—— 与 display 合并成**一次** setData，一次渲染。
   * 挂载是「一次付出、之后常驻」：回头再切到它只走 display，零重建、不白屏。
   * 刚挂上的模块要显式 relayout 一次：
   *   ① 组件的 landscape property observer 在挂载瞬间会被页面的 attached 守卫拦掉；
   *   ② show() 只刷新数据，标题提示条（syncTip）要等 afterLayout 才对齐。
   */
  switchTo: function (key, after) {
    if (!nav.isModule(key)) return;
    /* ★★ 2026-10-24（复审 P2-09）：`after` ＝ "切完（或本来就在这儿）之后再做这件事"。
       唯一用户是 `onGoto` 的"定位到某张 agent 卡"：模块可能是这次才挂上的，
       裸调 `compOf()` 会拿到 null（挂载要等 setData 回调）。 */
    if (key === this.data.active) {
      if (typeof after === 'function') after();
      return;
    }
    const self = this;
    const isNew = !this.data.mounted[key];
    const patch = { active: key, vis: visOf(key) };
    if (isNew) {
      const m = Object.assign({}, this.data.mounted);
      m[key] = true;
      patch.mounted = m;
    }
    this.setData(patch, function () {
      const c = self.compOf(key);
      if (c) {
        if (isNew && c.relayout) c.relayout();
        if (c.show) c.show();
      }
      if (typeof after === 'function') after();
    });
  },

  /** 模块内部要跳别的模块时（点一条待办 → 待办详情 …） */
  onGoto: function (e) {
    const key = e.detail && e.detail.key;
    if (!key) return;
    /* ★★ 2026-10-24（复审 P2-09）：**把上下文一起带过去**。
       目前只有 `agentId`（概览 / 项目的 agent 卡 → 我的）。改前这里把 `detail` 整个丢了，
       于是"点不同卡结果都一样"。 */
    const aid = (e.detail && e.detail.agentId) || '';
    const self = this;
    this.switchTo(key, function () {
      if (!aid) return;
      const mod = self.compOf(key);
      if (mod && mod.focusAgent) mod.focusAgent(aid);
    });
  },

  /* ---------------- 闪念胶囊（★ 本轮 · FR-9） ----------------
   * 壳页在这一块只做两件事：把"品牌块被点了"转给胶囊，把胶囊的状态转给品牌块。
   * 状态机本身（开抽屉 / 起录 / 停录 / 收气泡）全在 capsule 组件里，**这里不复制一份**。
   * 背景：82 轮曾把品牌块定为纯装饰（用户口径「点击品牌 logo 均不触发待办创建」）——
   * 那条口径仍然成立（它确实不再创建待办）；本轮给它换了个动作：**接住一段口播**。
   */

  /**
   * 点品牌块（横屏导轨底部 / 竖屏右下悬浮块，两处同一个出口）。
   * 一颗键承担三种状态，正是 `toggleRecord()` 那三行：
   *   抽屉关着 → 开抽屉（图标随即变麦克风）／ 抽屉开着 → 开始录音 ／ 录音中 → 停。
   * ⚠️ 录音中这一次点击**通常到不了这里** —— 胶囊会先铺一层全屏停止层把它接走
   *    （用户口径「录音过程中，单击屏幕任何位置均停止录音」）。这里不省，
   *    是因为那层只在抽屉开着且 `recPhase` 非空时才铺；少一条路径就会有一个"点了没反应"的死角。
   */
  onBrand: function () {
    const c = this.selectComponent('#cap');
    if (c && c.toggleRecord) c.toggleRecord();
    /* ★★ 126 轮：点品牌块 ＝ 打开闪念胶囊 ⇒ **这也是"我要用数据了"的一次宣告**，
       顺手把最新快照拉回来（用户口径把这一条与点导航并列点名）。
       打开胶囊本身是同步的、不受这里影响；数据回来后 `repaintAll()` 会把那份列表
       换成最新的 —— 正好覆盖"在手机上说了一条、坐到平板前点开胶囊看不到"这个场景。
       ⚠️ 这里**不传 silent**：失败要说（`netHint` 分档，见 `refreshData`）。
       录音中再点（＝停录）同样会走这里，也照样是安全的：
       重画只换列表数据，不碰录音器与气泡的升起状态机。 */
    this.refreshData();
  },

  /**
   * ★★★ 274 轮 · 点「写」那颗（竖屏 `.fab-write` ／ 横屏 `.rail-write`，同一个出口）。
   *
   * ── 为什么先开抽屉、再开面板 ──────────────────────────────────────────────
   * 创建副抽屉是**挂在胶囊组件里的一个 fixed 层**，它的渲染条件是
   * `(phone || open) && compose`（见 capsule.wxml）—— 抽屉关着时它根本不渲染。
   * 而用户点这颗键的意图是"记一条"（不是"打开胶囊"），所以这里必须自己把
   * 抽屉先打开，否则就是"点了没反应"。
   * ⚠️ 已经开着就**别再调 `openCapsule()`**：它会 `refresh()` ＋ 滚到顶 ＋ 把
   *    `delMode` / `multi` / `selIds` 归零 —— 用户在多选态里记一条，回来发现
   *    选择全没了，那不是他要的。
   * ⚠️ 不在这里 `refreshData()`（与 `onBrand` 不同）：写一条**不读**新数据，
   *    保存之后 `store.addCapsule()` 会在本地乐观插入、组件自己 `refresh()`。
   *    多拉一次快照只会在面板开着的时候把列表换一遍，白白让底下那屏闪一下。
   */
  onWrite: function () {
    const c = this.selectComponent('#cap');
    if (!c) return;
    /* ★ 274b：录音中这一下不归它管（模板那颗已在 `rec` 态收掉，这里挡的是"从别处调进来"）。
       与 `onTapBubble` 开头那道 `if (this.data.recPhase) return;` 是同一条纪律：
       置灰 / 不渲染只是观感，方法自己得扛得住。 */
    if (c.data && c.data.recPhase) return;
    if (!c.data || !c.data.open) {
      if (c.openCapsule) c.openCapsule();
    }
    if (c.openCompose) c.openCompose();
  },

  /**
   * 胶囊把状态回灌（★ 单向：胶囊是唯一真相，壳页只是它的一个显示屏）。
   * 三态由 `open` 与 `phase` 两个字段现算，**不另存一份**：
   *   phase === 'rec'  → 'rec'（倒计时）
   *   否则 open        → 'mic'（等你说话）
   *   否则             → 'logo'
   * ⚠️ 别在这里做防抖 / 缓存比较：`recstate` 每秒一次（倒计时），
   *    而 setData 同一个值本来就不会重渲染 —— 自己加一层比较只会多一个能跑偏的地方。
   */
  onCapRec: function (e) {
    const d = (e && e.detail) || {};
    this.setData({
      capBrand: d.phase === 'rec' ? 'rec' : (d.open ? 'mic' : 'logo'),
      capClock: d.clock || ''
    });
  },

  /**
   * 胶囊「转到脑图」成功之后叫一声（★ 第八十六轮）—— 由壳页把它落到**脑图模块的视图**上。
   *
   * 为什么必须由壳页转发：脑图和胶囊是两个平级组件，谁也不该去 `selectComponent` 对方
   *   （那是一条绕过壳页的暗线，模块一多就会缠成网）。壳页本来就是唯一知道"五个模块都在哪"的那一层。
   *
   * 用户口径（2026-09-27）两句话，在脑图那一侧是**同一件事**：
   *   · 「选中的不是当前开着的脑图 ⇒ 打开选中脑图」——"换人"那一步（`setMemory`）胶囊已经做完了，
   *     而脑图模块的 `refresh()` 本来就是"按当前记忆重画" ⇒ 这一次 refresh 顺带把画面切到那张图；
   *   · 「选中的就是当前脑图 ⇒ 重新刷新当前脑图」——记忆没换人，同一次 refresh 把新节点画出来。
   *   ⇒ 这里**不分叉**。分叉意味着壳页自己再读一遍 FR-8.4 的记忆、再判一次"是不是当前那张"，
   *     两个真源迟早会对不上；而且判错了就是"该切没切 / 该刷没刷"。
   *   ⇒ 事件里的 `mid` 只是回执信息（便于日后定位是哪张图触发的），**这里不据它做判断**。
   *
   * ⚠️ 这里**刻意不做 `active === 'mindmap'` 的短路**。看着像能省一次排版，实际是拿
   *   "壳页切模块时一定会调 show()"这个实现细节当契约 —— 而本轮这个 bug 恰恰就是
   *   "恰好没有人刷新"造成的（用户此刻就站在脑图模块上，`active` 没变 ⇒ 没人调 `show()`）。
   *   再省掉一条刷新路径，等于把同一类问题请回来。无条件刷的代价只有一个：
   *   脑图模块不在前台时白算一次 layout —— 无害，它 `refresh()` 里的 `measure()`
   *   有 `if (r && r.width)` 守卫，量不到（display:none ⇒ 宽 0）就不动 `_card`。
   * ⚠️ 模块还没挂载时 `compOf` 返回 null ⇒ 什么都不做，这也是对的：
   *   它下次挂载时的 `show()` 会带着刚写进去的记忆渲染，结果一样。
   */
  onCapMapped: function () {
    const c = this.compOf('mindmap');
    if (c && c.refresh) c.refresh();
  }

  /* ★ 第八十二轮的两条旧口径，位置留在这里免得后来人翻不到：
     ① 品牌块不再触发"创建待办" —— 创建待办已由「待办列表主弹窗」底部那颗「＋ 创建待办」承担；
        本轮唯一的变化是给它接上了「闪念胶囊」，**没有**把创建待办还回去。
     ② 47 轮那条"有列表主弹窗先收掉 / 有表单则 no-op"的优先级规则一并作废 ——
        品牌块不再与那两张弹窗抢同一个动作。 */
});
