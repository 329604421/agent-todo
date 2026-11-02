/**
 * 我的模块（FR-6 · ★ V8 改造 · ★★ 09-22 第四十二轮专项）
 *
 * 页面从上到下的三块：个人资料 ／ Agent ／ Token API。
 *
 * 第四十二轮改了什么（对齐当轮 11 条走查意见）：
 *   · 个人资料：标题右侧不再有「改个称呼」；卡内只有 头像 ＋ 用户名，右侧一个「编辑」
 *     ⇒ 走**标准表单抽屉**（mode 'profile'），可改用户名、可从相册选头像
 *   · Agent：副标去掉；卡上不再有彩色圆点、「当前」标签、⋯、过期提醒；只剩「编辑」
 *   · Token API：副标去掉；卡上不再有圆点、「已连接」、备注、「手动维护」；
 *     「余额偏低」改为按余额现算（< ¥10）
 *   · 两处区块脚注（写给评审看的那两句）与空态里的解释文案一起删掉
 *
 * 第四十二轮·补（本次追加）：
 *   · agent 的额度重置记「重置日」（各家都按月重置）⇒ 卡片上换算成「距离重置 N 天」
 *   · agent 卡恢复「概览三数（当前剩余 ／ 距离重置 ／ 承担项目）＋ 关联项目气泡行」
 *   · 页底的「版本号 ＋ 更新日志」整行删除（诊断入口改挂页首区块标题）
 *   · profile / agent / token 三个抽屉去掉解释语句与「手动填」小字
 *
 * 第四十二轮·补二（本次追加，仍是「我的」页）：
 *   · agent 额度改按**积分**读 ⇒ 纯整数、无单位、无小数（提交时由 forms 的 intOf 取整）
 *   · 「额度偏低」跟着改看**比例**：当前剩余 ÷ 每月套餐 < 20%
 *     —— 单看一个数没法判断高低（1240 是高是低取决于套餐 2000 还是 5000）
 *   · 重置日不再让用户敲：表单里是 ± 步进器（不碰日历控件）；
 *     卡片上仍由 store.daysUntilReset 换算成「距离重置 N 天」
 *
 * ★ 第一百三十三轮（本次追加）：
 *   · 重置日**只剩「日」**（每月几号）—— 按自然月重置，月份没有信息量
 *     ⇒ 表单从「月份 / 日期」两行收成一行；数据层 'MM-DD' → 'DD'
 *   · 卡片这一层**一个字都不用改**：它只认 store.daysUntilReset 换算出的「N 天」
 *
 * 三条抽屉路径都走同一套壳 ⇒ 抽屉自带黑色半透遮罩（见 form-drawer）。
 * 卡片上删除入口取消后，agent / token 的删除收进**编辑抽屉**底部的「删除」。
 *
 * 形态：单页（无列表 / 详情二态），点导航直接进（FR-8.4）。
 * 屏幕方向诊断浮层保留 —— 只能真机验证，长按「个人资料」区块标题打开。
 */
const store = require('../../utils/store');
const pub = require('../../utils/pagebase');
const stage = require('../../utils/stage');
/* ★★ 2026-10-12：厂商标识 → 展示名（卡面上显示「DeepSeek」而不是库里那个 `deepseek`） */
const vendors = require('../../utils/vendors');
/* ★ 审查-02 P2-23：诊断面板要能报**当前主题** —— `utils/theme.js` 自带取色出口
   （`current()` / `isDark()`），不必经 store 再转一道。 */
const theme = require('../../utils/theme');

/* ---------------- 屏幕方向诊断（长按「关于」行打开） ----------------
 * 真机上「旋转了但布局没变」时，靠这张表定位断在哪一环：
 *   Page.onResize 恒为 0            → 页面级回调没来（多半 pageOrientation 没生效 ⇒ 小程序根本没旋转）
 *   wx.onWindowResize > 0 而前者为 0 → 只有全局兜底通道活着
 *   「当前视口」旋转前后不变         → 系统侧就没旋转（系统「自动旋转」未开 / 客户端方向锁）
 *   视口变了但「判定」没翻           → 强制方向开关没关，或判定基准有问题
 */
function fmtViewport(v) {
  if (!v) return '—';
  return v.w + ' × ' + v.h + '　（状态栏 ' + v.sb + ' · 胶囊右 ' + v.capRight + '）';
}

function fmtSize(s) {
  if (!s) return '';
  return Object.keys(s).map(function (k) { return k + '=' + s[k]; }).join('　');
}

/**
 * 原生胶囊 —— 竖屏品牌栏「与胶囊同行」全靠它。
 * ok=false 说明 wx.getMenuButtonBoundingClientRect() 没返回可用值，
 * 此时品牌行只能按「状态栏底 ＋ CAP_GAP_FALLBACK(8)」兜底，会与真机胶囊差几像素。
 */
function fmtCapsule(c) {
  if (!c) return '—';
  if (!c.ok) {
    return '⚠️ API 没返回，已兜底　→　画布 top ' + c.canvasTop + ' / h ' + c.canvasH;
  }
  const r = c.raw || {};
  return '✅ top ' + r.top + ' · h ' + r.height + ' · left ' + r.left +
         '　→　画布 top ' + c.canvasTop + ' / h ' + c.canvasH;
}

function buildDiag() {
  const p = stage.probe();
  const c = p.counters || {};
  const w = p.windowInfo || {};
  const d = p.device || {};
  const ab = p.appBase || {};
  /* ★ 审查-02 P2-23（2026-10-14）：真机排查深色问题的**第一步判据** ——
     "当前到底是不是深色、根节点那层 `.theme-dark` 有没有挂上、两边一致吗"。
     深色出问题（某块底没换过来）时先看这一行就能砍掉一半范围：
       · 两边都浅 / 都深 ⇒ 主题链路是好的，直接去看**那条规则本身**；
       · 两边不一致 ⇒ 问题出在"某一侧没跟上"（JS 侧或 WXSS 侧），不必再往下翻。
     ⚠️ `.theme-dark` 挂在**壳页根节点**上（见 `pages/shell/shell.js`），组件读不到 DOM 的
        类名，只能回读页面栈顶那页的 `data.dark` —— 它正是那个类的唯一真源（186 轮口径）。
     ⚠️ 非页面环境（核验脚本里跑）`getCurrentPages` 不存在 / 栈为空 ⇒ 如实报"读不到"。 */
  const thDark = theme.current() === 'dark';
  let mountKnown = false, mountDark = false;
  try {
    const pages = (typeof getCurrentPages === 'function') ? getCurrentPages() : [];
    const top = pages.length ? pages[pages.length - 1] : null;
    if (top && top.data && typeof top.data.dark === 'boolean') { mountKnown = true; mountDark = top.data.dark; }
  } catch (e) { /* 非页面环境 */ }

  const judge = [
    {
      k: '当前主题',
      v: theme.current() + '　·　根节点 .theme-dark：'
        + (mountKnown ? (mountDark ? '已挂' : '未挂') : '（读不到页面栈）')
        + (mountKnown ? (mountDark === thDark ? '　✅ 两边一致' : '　⚠️ 两边不一致') : '')
    },
    { k: '判定', v: (p.orientation === 'land' ? '横屏 land' : '竖屏 port') + '　·　scale ' + p.scale },
    { k: '当前视口', v: fmtViewport(p.nowViewport) },
    { k: '最近变化视口', v: p.lastViewport ? fmtViewport(p.lastViewport) : '（还没收到过尺寸变化事件）' },
    { k: '原生胶囊', v: fmtCapsule(p.capsule) }
    /* ★ 107 轮：原来这里还有一行「强制方向」—— 那条调试通道已整条删除
       （它会写 storage 残留态，让模拟器停在错的形态上）。
       现在形态只由真实视口决定，没有可显示的"强制值"。 */
  ];
  /* ★ 第五十八轮：竖屏三段高 ＋ 「品牌栏是否兜住品牌行」。
     真机复核「向上滚动时标题栏还会不会透出内容」就看这一行：
     品牌行底（＝ 胶囊底，画布坐标 capTop ＋ capH）必须 ≤ **品牌栏下沿**
     （＝ statusH ＋ titleH），否则品牌行会溢出到工作区 ——
     静止页表现为「间隙没了」、滚动页表现为「内容透过标题栏」。
     ⚠️ 六十三轮改口径：原来是拿 titleH 跟「减去状态栏占位的 品牌行底」比，
        判据没错、但两个数打印出来像自相矛盾（IDE 上读作「41 ≤ 品牌栏 40 ✅」）。
        现在两边都换成**画布里的绝对 y**，一眼能对上。 */
  if (p.port) {
    const cap = p.capsule || {};
    /* ★★ 2026-10-22（审查 P3-01）· **字段名过期导致诊断是假的**。
       ── 改前读的是 `p.port.titleH`，而 `stage.probe()` 自 204 轮起给的是
          `{statusH, capRowH, headH, workH, scrollH}` —— 根本没有 `titleH`（那是它改名前的旧名）。
          后果：`barBottom = statusH + undefined = NaN` ⇒ 诊断文字里出现 `undefined`、
          「品牌栏兜住品牌行」那一行永远显示 ⚠️，并附一句假的"会溢出到工作区"。
          一个**只会喊狼来了**的诊断面板，比没有诊断更费时间（用户会去查一个不存在的问题）。
       ── 现在：读 `capRowH`（＝品牌行/让位行，见 stage.portHeights 的命名说明），
          并且**先做数学校验**：三个数有一个不是有限数 ⇒ 明说"字段缺失"，
          不参与任何比较、也不报红 —— 让下一次字段改名表现为"面板说读不到"，而不是"几何坏了"。 */
    const sb = p.port.statusH;
    const row = p.port.capRowH;
    const okNum = isFinite(sb) && isFinite(row);
    const capBottom = (cap.canvasTop == null || cap.canvasH == null)
      ? null : cap.canvasTop + cap.canvasH;
    const barBottom = okNum ? sb + row : NaN;
    const okCap = !okNum || capBottom == null || barBottom >= capBottom;
    judge.push({
      k: '竖屏三段高',
      v: okNum
        ? '状态栏 ' + sb + '　品牌行 ' + row + '　工作区 ' + p.port.workH
        : '（读数缺失：statusH / capRowH 不是数 —— 检查 stage.probe() 的字段名）'
    });
    judge.push({
      k: '品牌行兜住胶囊',
      v: !okNum
        ? '—　（缺字段，跳过几何校验）'
        : (okCap ? '✅' : '⚠️') + '　胶囊底 ' + (capBottom == null ? '—' : capBottom) +
          (okCap ? ' ≤ ' : ' > ') + '让位段下沿 ' + barBottom +
          (okCap ? '' : '（会溢出到工作区）')
    });
  }
  const chans = [
    { k: 'Page.onResize', v: String(c.onResize || 0) + ' 次' },
    { k: 'wx.onWindowResize', v: String(c.windowResize || 0) + ' 次' },
    { k: 'onShow', v: String(c.show || 0) + ' 次' },
    { k: '最近来源', v: (c.lastSource || '—') + '　' + (c.lastAt || '') }
  ];
  let payload = '（还没收到过尺寸变化回调 —— 旋转一下再看）';
  if (c.lastRes) {
    const parts = [];
    if (c.lastRes.keys) parts.push('顶层 keys: ' + c.lastRes.keys.join(', '));
    if (c.lastRes.size) parts.push('size: ' + fmtSize(c.lastRes.size));
    if (c.lastRes.deviceOrientation) parts.push('deviceOrientation: ' + c.lastRes.deviceOrientation);
    if (c.lastRes.orientation) parts.push('orientation: ' + c.lastRes.orientation);
    if (c.lastRes.raw) parts.push('raw: ' + c.lastRes.raw);
    payload = parts.join('\n');
  }
  const env = [
    { k: '机型', v: ((d.brand ? d.brand + ' ' : '') + (d.model || '—')).trim() },
    { k: '平台 / 系统', v: (d.platform || '—') + '　' + (d.system || '') },
    { k: '窗口 API', v: 'windowWidth ' + (w.windowWidth || '—') + ' × ' + (w.windowHeight || '—') + '　DPR ' + (w.pixelRatio || '—') },
    { k: '基础库 / 客户端', v: (ab.SDKVersion || '—') + '　微信 ' + (ab.version || '—') }
  ];
  return { judge: judge, chans: chans, payload: payload, env: env };
}

/**
 * ★ 第五十五轮：本地那份 `amountOf` / `quotaRatio` 已提到 `utils/store`
 *   （`store.amountOf` / `store.quotaLowOf`）—— 「项目」页基础信息卡也要展示同一组
 *   「当前剩余 / 距离重置」，两处各写一份迟早会漂（额度是手填字符串，不是数）。
 *   token 的「余额偏低（< ¥10）」是 token 自己的口径，仍留在本组件里现算。
 */

Component(pub.comp('mine', {
  data: {
    me: null,
    agents: [],
    tokens: [],
    diag: null,
    /* ★★ 2026-10-24（复审 P2-09）：从概览 / 项目跳过来时要定位的那个 agent id */
    focusId: '',
    /* ★★ 2026-10-24（复审 P2-08）：**整批**余额刷新失败的说明。
       与每张卡自己的 `err`（那把 key 的问题）分开：这一条是"这次一个都没查回来"，
       放在区块头下面，不重复刷屏到每张卡上。 */
    tokenErr: ''
  },

  refresh: function () {
    const s = store.state;

    /* Agent：四个手填字段 ＋ 派生出来的「距离重置」「承担项目」与「最后更新于」
       ★ 第 63 轮：装配提到 store（`store.agentCardViews`）—— 概览新的「Agent 概况」
         要显示同一张卡，两边各拼一份必漂。 */
    const list = store.agentCardViews();
    /* ★★ 2026-10-24（复审 P2-09）：标出"刚才从别的模块点进来的那一张"。
       ⚠️ 比的是**字符串化之后**的 id：wxml 的 `data-id` 取出来是字符串，
       而 mock 种子里的 id 可能是数字 —— 直接 `===` 会让高亮永远不亮。 */
    const fid = String(this.data.focusId || '');
    const listMarked = fid
      ? list.map(function (a) { return Object.assign({}, a, { focus: String(a.id) === fid }); })
      : list;

    /* Token API：★★ 2026-10-12 起余额是**后端代查厂家接口**回来的（不再是手填）——
       页面这一层只做展示派生：
         · 「余额偏低」＝ 余额 < ¥10（口径不变，仍由本页现算）；
         · 「更新于 X」读 **`balanceAt`**（余额最后一次**查询成功**的时刻），
           ⚠️ 不是 `updatedAt` —— 那是"配置最后被改的时间"，用户改一下厂商名就会让
              所有卡片的时间跟着跳，而那个数其实一点没变新；
         · 两种"没有数"必须分开说（用户一眼要能看出自己该做什么）：
             `hasKey=false` ⇒ 「待配置」（**得去填一把 key**，是用户的动作）；
             `hasKey=true` 但没数 ⇒ 「待查询」（配好了、只是还没查回来，等下一次刷新）；
         · `lastError` 非空 ⇒ 单独一行红字说清原因（key 失效 / 查不到 / 超时）。
       ⚠️ 余额为空时**保留旧值**（后端失败时不覆盖余额），所以"有数 + 有错误"是合法组合。 */
    const tkList = s.tokenKeys.map(function (k) {
      const amt = store.amountOf(k.balance);
      const err = k.lastError || '';
      return {
        id: k.id,
        vendor: vendors.vendorName(k.vendor),
        balance: k.balance || '',
        low: amt !== null && amt < 10,
        hasKey: !!k.hasKey,
        keyMask: k.keyMask || '',
        /* 没数时显示哪一句：**没 key 优先**（那件事更前置，用户可以立刻处理） */
        pendingText: !k.hasKey ? '待配置' : '待查询',
        /* 「待配置」是"要你动手"，用警示色；「待查询」只是"还没回来"，用灰的 */
        pendingWarn: !k.hasKey,
        err: err,
        at: k.balanceAt ? store.atMin(k.balanceAt) : ''
      };
    });

    this.setData({
      me: s.me,
      agents: listMarked,
      tokens: tkList,
      diag: this.data.diag ? buildDiag() : null
    });
  },

  /**
   * ★★ 2026-10-24（复审 P2-09）：**从概览 / 项目的 agent 卡跳过来时定位到那一张**。
   *
   * ── 背景：改前两处入口都只 `gotoModule('mine')` —— `data-id` 白写在模板上，
   *    处理函数压根不接事件。点不同卡结果一模一样，用户还得在「我的」里自己找。
   * ── 现在：壳页把 `agentId` 带过来并调本方法 ⇒ 那张卡描一圈品牌黄、2.4 秒后自己褪掉。
   *
   * ⚠️ **只做高亮、不做自动滚动**：本页的滚动容器是 `.mi-area`（`overflow-y:auto` 的
   *    普通 view），WXML 没有"滚到某个子节点"的能力（那是 `scroll-view` 的
   *    `scroll-into-view`）。要真正自动滚到位，得把 `.mi-area` 换成 `scroll-view` ——
   *    那是"横屏双层裁剪"（复审 P1-08）那一批的结构改动，本轮不顺手做。
   *    现阶段至少保证：切过去之后**一眼看得出哪张是刚才点的那张**。
   */
  focusAgent: function (id) {
    if (!id) return;
    const self = this;
    if (this._ft) { clearTimeout(this._ft); this._ft = null; }
    this.setData({ focusId: String(id) }, function () { self.refresh(); });
    this._ft = setTimeout(function () {
      self._ft = null;
      self.setData({ focusId: '' }, function () { self.refresh(); });
    }, 2400);
  },

  /* ★ 44 轮：原来的 this.syncTip() 已随提示胶囊一起删除（基座不再有这个方法） */

  /**
   * ★★ 2026-10-12：**去查一次余额，查回来了就重画**。
   * 「进页面」与「刚保存完一条 key」两条路都走它。
   *
   * ★ 三件事分得很清：
   *   · **要不要真去查**由 `store.refreshTokenKeys()` 自己判 —— 一条 key 都没有、
   *     60 秒内刚查过、或上一次查询还在路上，它都会直接返回（口径见那个函数）；
   *   · 这一层只负责"**查回来了就重画一次**"：不重画的话，卡片上还是查之前那份数；
   *   · **失败不弹提示**。余额是辅助信息，为它打断用户不值当；失败原因由后端写进
   *     `lastError`，卡片上自己有位置显示（见上面 `tkList` 的 `err`）。
   *     ⚠️ 连"整个后端都连不上"时什么都不显示也是**有意**的：那一层
   *        `store.boot()` 已经提示过一次（"连不上 xxx"），不必在这儿再喊第二遍。
   *
   * @param {boolean} force 忽略 60 秒节流窗口
   */
  kickTokenRefresh: function (force) {
    const self = this;
    /* ★★ 2026-10-24（复审 P2-08）：**失败也要重画，并且要说出来**。
       ── 改前：`if (res.ok && !res.skipped) self.refresh();` —— 失败时什么都不做。
          store 明明回了 `{ok:false, message}`，而 `message` **没有任何消费者**：
          页面继续显示上一次的余额和"更新于 X"的时间，看起来就像"刚刚查过、数没变"。
          用户没有任何线索区分"查询失败 / 正在查询 / 余额没变"。
       ── 现在：成功清掉提示、失败写一条**区块级**说明（不打断操作、不弹窗），
          两种情况都重画。旧余额照旧保留（后端失败时不覆盖余额），只是不再冒充新值。
       ⚠️ 文案要带上"显示的是上次结果"这半句 —— 只说"查询失败"，
          用户会以为卡片上那个数是错的、或者是 0。 */
    store.refreshTokenKeys(force).then(function (res) {
      if (!res || res.skipped) return;
      if (res.ok) {
        if (self.data.tokenErr) self.setData({ tokenErr: '' });
      } else {
        self.setData({ tokenErr: (res.message || '余额查询失败') + '；下面显示的是上次查询结果' });
      }
      self.refresh();
    }, function () {
      /* store 那条链理论上永远 fulfill；留这一支是给"将来有人往上面加了一步会抛的代码"兜底 */
      self.setData({ tokenErr: '余额查询失败；下面显示的是上次查询结果' });
      self.refresh();
    });
  },

  /**
   * **刚进入本模块**（基座 `show()` 调）——
   * 用户口径：「用户点击进入『我的』页面后就触发查询动作，更新余额信息」。
   * 五个模块里只有这里实现了这个钩子，其余四个不实现就什么都不会发生。
   */
  onEnter: function () { this.kickTokenRefresh(false); },

  /**
   * **表单提交之后**（基座 `onFormSubmit` 调）—— 只认 token 表单。
   * 用户刚贴完 key / 换完 key，下一眼想看到的就是那个余额，而不是「待查询」。
   * ⚠️ 必须 `force`：这里要的是"现在立刻查"，不能被"进页面时刚查过"的节流吃掉；
   *    而且后端**换 key 时已经把旧余额清空了**，这一次不查，卡片会一直停在「待查询」。
   */
  afterFormSubmit: function () {
    const f = this.data.form;
    if (!f || f.mode !== 'token') return;
    this.kickTokenRefresh(true);
  },

  afterLayout: function () {
    if (this.data.diag) this.setData({ diag: buildDiag() });
  },

  /* ---------------- 个人资料（★ 42 轮：改走标准表单抽屉） ---------------- */

  /** 资料卡右侧的「编辑」→ 表单抽屉 mode='profile'（用户名 ＋ 头像） */
  onEditProfile: function () { this.openForm('profile', ''); },

  /* ---------------- agent 档案（全部手动维护 · FR-6.1） ---------------- */

  onNewAgent: function () { this.openForm('agent', ''); },

  onEditAgent: function (e) { this.openForm('agent', e.currentTarget.dataset.id); },

  /** 点 agent 卡上的项目气泡 → 去那个项目的详情（★ 42 轮·补：气泡行恢复） */
  onGoProject: function (e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    store.setMemory('project', id);
    this.gotoModule('project');
  },

  /* ---------------- 模型厂家 key（Token API · 全手填） ----------------
   * 和 agent 档案是同一套交互（新建 / 编辑都走表单抽屉），只是一条 key 不参与任何归属关系，
   * 所以删除不需要「关联置空」那一步。 */

  onNewToken: function () { this.openForm('token', ''); },

  onEditToken: function (e) { this.openForm('token', e.currentTarget.dataset.id); },

  /* ---------------- 编辑抽屉底部的「删除」（★ 42 轮） ----------------
   * 卡片上只留一个「编辑」按钮 ⇒ 删除入口收进抽屉底部，只在编辑态出现。
   * 两段确认文案的差别就在「会不会牵动项目」：删 agent 会把引用它的项目 agentId 置空，
   * 但项目一个都不删；删一条 key 不牵动任何东西（FR-6.1）。 */

  onFormDelete: function () {
    const f = this.data.form;
    const self = this;

    if (f.mode === 'agent') {
      const a = store.agentById(f.id);
      if (!a) return;
      const n = store.state.projects.filter(function (p) { return p.agentId === f.id; }).length;
      wx.showModal({
        title: '删除「' + a.name + '」？',
        content: '有 ' + n + ' 个项目关联着它。\n删掉之后这些项目的「关联 agent」会被清空，但项目本身一个都不会删。',
        confirmText: '删除',
        confirmColor: store.danger(),
        success: function (r) {
          if (!r.confirm) return;
          store.removeAgent(f.id);
          self.onFormCancel();          // 关抽屉 ＋ 恢复遮罩态 ＋ 刷新
        }
      });
      return;
    }

    if (f.mode === 'token') {
      const k = store.tokenKeyById(f.id);
      if (!k) return;
      /* ★★ 2026-10-12：两处随本轮改口径 ——
         ① 厂商显示名走 `vendorName()`（库里存的是 `deepseek` 这个 code，直接显示会露出内部标识）；
         ② 正文带上 **key 掩码**：同一个厂商可以有好几条（用户口径第 ⑤ 条），
            只说「删除 DeepSeek？」用户根本不知道删的是哪一条。
         ③ 补一句"余额数据一起消失" —— 删除会连带把这份余额档案清掉，这是用户该知道的。 */
      const name = vendors.vendorName(k.vendor);
      wx.showModal({
        title: '删除「' + name + '」？',
        content: (k.keyMask ? '这把 key 是 ' + k.keyMask + '。\n' : '') +
                 '它存下的余额数据会一起删掉，不影响任何项目或待办。',
        confirmText: '删除',
        confirmColor: store.danger(),
        success: function (r) {
          if (!r.confirm) return;
          store.removeTokenKey(f.id);
          self.onFormCancel();
        }
      });
    }
  },

  /* ---------------- 诊断浮层（长按「个人资料」区块标题打开） ----------------
   * ★ 42 轮·补：页底的「版本号 ＋ 更新日志」整行已删（用户要求去掉那两句文本），
   *   诊断入口随之从「长按整行」挪到页首的区块标题上 —— 位置固定、不在卡片里，不会误触。
   */

  onDiag: function () {
    this.setData({ diag: buildDiag() });
  },
  onDiagRefresh: function () {
    this.setData({ diag: buildDiag() });
  },
  onDiagClose: function () {
    this.setData({ diag: null });
  }
}));
