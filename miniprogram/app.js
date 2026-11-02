/**
 * Agent ToDo · 小程序前端
 *
 * 数据来源有**两条**，由 `utils/api.js` 的**两个开关**决定：
 *   · `_mock = true`（**出图 / 走查态**）—— 全部来自 `utils/mock.js`，
 *     **不发起任何网络请求、不做登录**。
 *   · `_mock = false`（**默认 · 联调 / 上线态**）—— `wx.login` → `GET /sync` →
 *     灌进 `utils/store.js`。★ **拉不到后端时按 `_fallback` 分两档**：
 *       默认档（`false`）⇒ `store.wipeToEmpty()` **清空成空** ——
 *         「界面上只可能出现数据库里的数据」，**不拿演示数据冒充真数据**；
 *       回落档（`true`）⇒ 保持内存里的种子数据（"停掉后端也能出图"的老姿势）。
 * ⚠️ 开关**必须留着**：`工具/` 下的全部核验与出图脚本都吃 `utils/mock.js` 的种子 —— 见 api.js。
 *    当前处于**联调 / 上线态**（`_mock = false`、`_fallback = false`）⇒ 界面显示后端真数据，
 *    **空库时就是全空**（这才是「已清理」该有的样子）。
 */
const store = require('./utils/store');
const stage = require('./utils/stage');
const api = require('./utils/api');
/* ★★ 本轮（深色模式）：主题服务 —— 同步读宿主主题 ＋ 监听切换 ＋ 前台复核。
   它的调色板服务于"WXSS 表达不了"的那几类（图标资产 / 数据侧色值 / 脑图 SVG / 开屏 Canvas），
   见 utils/theme.js 的文件头。*/
const theme = require('./utils/theme');

App({
  globalData: {
    store: store,
    /** `store.boot()` 的结果 `{ ok, mock, code, message }`；未跑完时是 null */
    boot: null
  },

  onLaunch: function () {
    // 屏幕方向：注册全局兜底通道 wx.onWindowResize（Page.onResize 之外的第二条官方通道）。
    // 真正的旋转开关在 app.json 的 window.pageOrientation 与根级 resizable，不在代码里。
    // ★ 107 轮：原来这里还有一条"调试期强制方向"的通道（写 storage 的
    //   agent-todo-force-orientation），**已整条移除** —— 它是全局残留态，
    //   脚本跑完忘了清就会让模拟器停在错的形态上。现在形态**只由真实视口决定**。
    stage.init();
    /* ★★ 本轮（深色模式）：主题服务**同步**定一次宿主主题（`current()` 是同步的 ⇒
       首次渲染就是对的，不存在"先浅后深"那一帧），并注册 `wx.onThemeChange`。
       ⚠️ 必须在 `startup()` 之前 —— 后面的渲染链路（壳页 INIT_DARK、图标、开屏）
          都假定此刻主题已经确定。 */
    theme.init();
    this.startup();
  },

  /**
   * ★★ 本轮（深色模式）· **前台复核**。
   *
   * 为什么需要它：`wx.onThemeChange` 只在**小程序在前台**时送达。用户切到系统设置里
   * 改了主题再切回来，那条事件可能已经错过 ⇒ 界面停在旧主题上。
   * `onShow` 是"回到前台"的确定时点，在这里重读一次宿主主题即可补齐
   * （`refresh()` 内建去重：没变就什么都不做，不会白发通知/白重画）。
   *
   * ⚠️ 这里**不做任何业务动作**：不拉数据、不重建页面、不动录音与表单
   *   （与设计稿"主题事件不走数据刷新和页面重建链路"同一条）。
   */
  onShow: function () {
    theme.refresh();
  },

  /**
   * 启动流程（技术文档 §9.6 第 2 项）：`wx.login` → `GET /sync` → `hydrate()` → 通知重画。
   *
   * ★ 三条口径：
   *   ① **`USE_MOCK = true` 时整段是空操作** —— `store.boot()` 立即 resolve，
   *      一个请求都不发。这是核验脚本能继续跑的前提。
   *   ② **失败不静默**：`ok === false` 时**必须把成因说出来** —— 文案由 `api.netHint()`
   *      按成因分档（`1002` 是"没在白名单里"，属于**正常业务结果**，文案要说清）。
   *      ⚠️ 数据那一侧由 `store.boot()` 自己处置（默认档 ＝ **清空成空**，不是退回 mock 种子）
   *      ⇒ 这里**只管提示、不要再动数据**："空着 ＋ 说清为什么"就是完整的结果。
   *   ③ **不在 onLaunch 里等**：`onLaunch` 同步返回，页面该渲染就渲染；
   *      快照回来之后再让"已挂载的视图"重画一次（`whenBooted`）。
   *      反过来（先等数据再渲染）会在弱网下把首屏空白拉长到十几秒。
   *      ★ 2026-10-08：首屏那几百毫秒画的是**各模块自己的空态**（`startup()` 一进去就把
   *        内存清成真空 —— **仅默认档**，`_mock` / `_fallback` 任一开着都不清），
   *        **不是** `mock.js` 的演示数据 —— 见 `startup()` 里那段说明。
   *        同时 `startup()` 里**成功也要通知重画**（原来只有失败分支通知，见 `shouldRepaint()`）。
   *   ④ **`shouldRepaint(r)` 是"要不要重画"的唯一判据**（`startup` ／ `whenBooted` 共用）——
   *      它的真值表就是 `store.boot()` 四种回执的处置，别在调用点再写一遍判断。
   *
   * ★★ 2026-09-30 修（两处，都是**真机 / 平板**上暴露、开发者工具里看不出来的）：
   *    ① 原来这里写的是 `if (r.mock) return;` —— 而**失败回落**那一支
   *       也带着 `mock: true`（"当前显示的是 mock 数据"），于是**连不上后端 = 一声不响地
   *       退成演示数据**：真机 / 平板上看到的正是这个症状（"还是 mock、也没登录"），
   *       而屏幕上没有任何线索说明"请求其实失败了"。现在按 **`ok`** 分支 ——
   *       `ok` 为真才是"真的不用提示"（开关就是开着的）；为假一律把原因说出来。
   *    ② 提示**按成因分档**（原来一律"未连上后端"）。真机上
   *       「域名没校验」「设备不在同一网段」「后端没起 / 防火墙拦」三件事的处置完全不同，
   *       而它们在小程序里**长得一模一样**（都是 `fail`）⇒ 现场只能靠猜。
   *       现在 `api.netHint()` 会把微信的原始 `errMsg` 翻成一句可执行的话。
   */
  startup: function () {
    const self = this;

    /* ★★ 2026-10-08 修（首屏不再拿演示数据顶那几百毫秒）────────────────────
     * 病根：`utils/store.js` 的 `state` **初值**是 `mock.js` 的那份种子（那是给
     *   `工具/` 下的出图 / 核验脚本准备的），而 `GET /sync` 是**异步**的。
     *   于是从 `onLaunch` 到快照回来之间，屏幕上画的是**别人的演示数据**
     *   （"我的工位"＋一堆演示项目 / 待办），随后再跳变成本人的 —— 既闪，
     *   又违背本工程反复守的那句口径「**界面上只可能出现数据库里的数据**」
     *   （`_fallback = false` 专门为它存在，首屏这一处却漏了）。
     * 处置：真数据态下**启动第一件事就清成真空**（各模块渲染自己的空态），
     *   快照回来再由 `hydrate()` ＋ 下面的重画通知换成你的数据。
     *   ⚠️ 与 `boot()` 失败时走的是**同一条路**（`_load({}, false)`，幂等）
     *      ⇒ 这里清了、那边再清一次没有任何副作用。
     * ⚠️⚠️ **两个开关都要守，缺一不可**（这两条都是"清了就白屏"）：
     *   ① `_mock = true`（出图 / 走查态）—— 那份种子**就是**当前数据，不能清；
     *   ② `_fallback = true`（老口径"停掉后端也能出图"，README §3.4）——
     *      它的语义是"**连不上时保持内存里的种子**"，而首屏这一清发生在
     *      "连不连得上还不知道"之前 ⇒ 清掉之后 `boot()` 失败时**已经没有种子可保**
     *      ⇒ 出图态白屏。**只有默认档（`_fallback = false`）才允许先清**：
     *      那一档的口径本来就是"拉不到就空着，只显示库里的数据"。
     *      ⇒ 判据＝ `!_mock && !_fallback`，正好与 `store.boot()` 内部的处置**同源**。
     */
    if (!api.useMock() && !api.useFallbackMock()) store.wipeToEmpty();

    store.boot().then(function (r) {
      self.globalData.boot = r;
      /* ★★ 2026-10-24（复审 P2-02）：**先通知"启动已落定"**，再判断要不要重画。
         `whenSettled` 的唯一用途是让壳页收起"正在同步" —— 成功、失败、mock 都要收；
         而 `whenBooted`（下面那一行）只管"要不要把视图按新数据重画一遍"。
         ⚠️ 顺序不能反：`whenSettled` 的订阅者在回调里可能立刻 setData，
            必须让它们看到 `globalData.boot` 已经是这一份回执。 */
      self.globalData.boot = r;
      self.fireSettled(r);

      /* ★★ 2026-10-08 修 —— **本轮的症结就在这一行的位置上** ─────────────────
       * 原来这一行写在 `if (r.ok) return;` **后面**，于是：
       *   · 成功路径（＝**绝大多数情况**）被那个 `return` 提前截断
       *     ⇒ `fireBooted()` **永远不执行** ⇒ `whenBooted()` 里注册的回调
       *     一直躺在 `_bootWaiters` 里没人叫 ⇒ 视图**不重画**。
       *   · 失败路径反而会通知 —— 两端行为恰好**反了**。
       * 现场症状（用户 2026-10-08 报）：*「重新进入应用都会先显示 mock 数据，
       *   只有刷新之后才能显示数据库数据」* —— 快照其实**早就拉回来并灌进 store 了**
       *   （`hydrate()` 是同步的、就在 `boot()` 里），只是**没人告诉视图去重画**；
       *   126 轮加的"点导航 / 下拉即刷新"恰好成了唯一能触达重画的动作。
       * ⚠️ `whenBooted()` 里那条"已经灌完就同步调一次"的兜底**理论上能救**，
       *   但它要求页面创建得比一次网络往返还慢（`onReady` 晚于 `boot()` 完成）——
       *   实际永远走不到 ⇒ 这条链路**从来没有生效过**。
       * 判据收在 `shouldRepaint()` 里（与 `whenBooted()` 的同步分支共用同一个口径）。 */
      if (self.shouldRepaint(r)) self.fireBooted(r);

      if (r.ok) return;                         // ① 开关开着（mock 模式）或② 快照灌成功 —— 都不用提示
      /* ★ 把"连的是哪个地址 / 什么环境 / 原始错因"一起打进日志 ——
         真机联调时这一行基本直接给出答案（配合手机上「打开调试」看 vConsole）。 */
      console.warn('[AgentToDo] 启动失败 base=' + api.BASE +
        ' platform=' + api.platformName() + ' host_device=' + api.HOST_DEVICE +
        ' code=' + r.code + ' kind=' + r.kind + ' msg=' + r.message + ' raw=' + (r.errMsg || ''));

      /* ★★ 2026-09-30：提示按**成因**分档，不再一律"没连上"。
         真机 / 平板上「域名没校验」「不在同一网段」「后端没起 / 防火墙」三件事的
         处置完全不同，而它们原来的文案一模一样 ⇒ 现场只能靠猜。
         翻译逻辑收在 `api.netHint()`（单一真源），这里只负责弹出来。
         ⚠️ 用 **toast** 不用 modal：出图 / 走查脚本按 README §3.4 就是「保持联调态
            ＋ 把后端停掉」来跑的，那种状态下 `boot()` 必然失败；一条 modal 会全屏
            盖住截图（第 70 轮"录音授权弹窗把核验图全废"是同一类坑）。 */
      wx.showToast({ title: api.netHint(r), icon: 'none', duration: 4000 });
    });
  },

  /**
   * 注册"快照灌进来了、请重画"的回调（壳页用）。
   * ⚠️ 已经灌完了就**同步调一次** —— 壳页的 `onReady` 晚于 `onLaunch`，
   *    绝大多数情况下走到这里时启动流程已经结束，注册回调永远等不到通知。
   */
  whenBooted: function (fn) {
    if (typeof fn !== 'function') return;
    const done = this.globalData.boot;
    /* ⚠️ 判据必须与 `startup()` 里那条**完全同一个** —— 就是下面的 `shouldRepaint()`。
       两处各写一份必然漂移，而漂移的症状是"有时重画、有时不重画"，
       比"一律不重画"更难查（后者至少是稳定的）。 */
    if (done) {
      if (this.shouldRepaint(done)) { try { fn(done); } catch (e) { /* 重画失败不影响启动 */ } }
      return;
    }
    this._bootWaiters = this._bootWaiters || [];
    this._bootWaiters.push(fn);
  },

  /**
   * ★★ 这次启动结果**要不要**让已挂载的视图重画一遍 —— **本文件里唯一的判据**。
   *
   * 为什么必须收口：判据**用两处**（`startup()` 的异步通知、`whenBooted()` 的同步兜底），
   * 各处写一份就会漂移；而漂移的症状是"有时会重画、有时不重画"——比一律不重画更难查。
   *
   * 真值表（对应 `store.boot()` 的四种回执，见 `utils/store.js` 的 `boot()`）：
   *   · `{ok:true,  mock:false}` 快照灌成功     → **重画**（这是最常走的一条，原缺的就是它）
   *   · `{ok:false, mock:false, cleared:true}` 失败且已清空 → **重画**（界面要变成空态）
   *   · `{ok:false, mock:true}`   失败回落档（`_fallback=true`）→ **不重画**：内存里还是种子，
   *                              首屏画的就是它，重画是纯浪费
   *   · `{ok:true,  mock:true}`   `_mock=true`（出图 / 走查态）→ **不重画**：同上，
   *                              且"mock 零副作用"是 `工具/` 那套脚本的前提
   *   ⚠️ 别把判据写成 `!r.mock` 之外的形态：`mock` 是**三态**（`true` ／ `false` ／ 缺失），
   *      而 `mock` **缺失**时应当**重画**（那说明这个回执不是 `boot()` 给的，
   *      保守重画总比漏画安全）—— `r.mock !== true` 正好表达这个语义。
   *
   * @param  {object}  r `store.boot()` 的回执
   * @return {boolean}
   */
  shouldRepaint: function (r) { return !!r && r.mock !== true; },

  fireBooted: function (r) {
    const list = this._bootWaiters || [];
    this._bootWaiters = [];
    list.forEach(function (fn) {
      try { fn(r); } catch (e) { /* 单个订阅者出错不该拖垮其余的 */ }
    });
  },

  /**
   * ★★ 2026-10-24（复审 P2-02）：**启动彻底落定**的回调（成功 / 失败 / mock 都调一次）。
   *
   * 与 `whenBooted` 的差别只有一个、但很关键：它**不看 `shouldRepaint()`**。
   *   · `whenBooted` 管"数据到了，重画一下"—— mock / 回落档刻意不重画；
   *   · 本方法管"首屏的等待结束了"—— 那两种档同样结束了，也必须告诉壳页，
   *     否则"正在同步"的提示会一直挂在屏幕上（mock 态尤其明显：它其实一开始就是好的）。
   *
   * ⚠️ 已经落定了就**同步回调**（同 `whenBooted` 的理由：页面 onReady 通常晚于启动完成）。
   */
  whenSettled: function (fn) {
    if (typeof fn !== 'function') return;
    if (this.globalData.boot) {
      try { fn(this.globalData.boot); } catch (e) { /* 订阅者出错不影响启动 */ }
      return;
    }
    this._settleWaiters = this._settleWaiters || [];
    this._settleWaiters.push(fn);
  },

  fireSettled: function (r) {
    const list = this._settleWaiters || [];
    this._settleWaiters = [];
    list.forEach(function (fn) {
      try { fn(r); } catch (e) { /* 单个订阅者出错不该拖垮其余的 */ }
    });
  }
});
