/**
 * 静态演示数据 —— 对齐 需求说明书 V8 精简版 §7.1 主表。
 *
 * V8 相对 V7 的删减（都在这里体现）：
 *   ❌ TASK / QUESTION / DELIVERY_TREE —— 数据只可能来自采集链路（N-9）
 *   ⚠️ TOKENS 于 09-22 走查·十三回归，但**降级为纯手填**（09-22 第四十二轮再收紧为 厂家 / 余额 两项）：
 *      设计稿原写「余额自动查询」，那依赖采集链路，一期仍不通 ⇒ 只保留区块与字段形态。
 *   ❌ agent 的 projects / tasks / asks / syncedAt —— 同上
 *   ❌ 项目卡片五项采集统计 —— 同上
 *   ❌ mindmap.source —— FR-7.2 去掉了「来源」字段
 *   ✅ 新增 project.archivedAt —— FR-2.9 归档
 *   ✅ 新增 todo.createdAt / todo.completedAt 独立计数 —— FR-5.1 热力图口径（D-6）
 *   ✅ agent 改为纯手动维护字段：quotaLeft / monthlyQuota / quotaResetAt / updatedAt（FR-6.1 · 无 current、无 note）
 *   ✅ 第四十二轮·补二：agent 额度改按**积分**读 —— 纯整数、无单位、无小数
 *
 * 时间基座：今天 ＝ 2026-09-21（周一，ISO 第 39 周），热力图最近 30 周 ＝ W10–W39。
 */

/* ---------------- 项目 8 色（令牌板 10:1 段 · 8 个固定槽位） ---------------- */
const PROJECT_COLORS = [
  { key: 'qing',    name: '青',   main: '#0E9E8E', soft: '#E5F4F2' },
  { key: 'lv',      name: '绿',   main: '#3E9B4F', soft: '#E9F4EA' },
  { key: 'ganlan',  name: '橄榄', main: '#7E9B2C', soft: '#F2F5E2' },
  { key: 'zong',    name: '棕',   main: '#9A6B45', soft: '#F6EFE7' },
  { key: 'zi',      name: '紫',   main: '#8A63D2', soft: '#F1ECFA' },
  { key: 'pinhong', name: '品红', main: '#B85C9E', soft: '#F8ECF4' },
  { key: 'dian',    name: '靛',   main: '#6360C4', soft: '#EAEAF8' },
  { key: 'song',    name: '松',   main: '#1E7F8C', soft: '#E4F1F3' }
];

/* ---------------- 紧急程度四档（C13 定案） ---------------- */
const URGENCIES = [
  { key: 'urgent', name: '紧急',   main: '#E5484D', text: '#A3232A', soft: '#FDEDEE', weight: 5, dash: false },
  { key: 'mid',    name: '中等',   main: '#EF9F27', text: '#8A5A00', soft: '#FDF3E2', weight: 3, dash: false },
  { key: 'low',    name: '不紧急', main: '#378ADD', text: '#1F5189', soft: '#EAF2FB', weight: 1, dash: false },
  { key: 'hold',   name: '留置',   main: '#8E91A0', text: '#5A5D6B', soft: '#F3F4F6', weight: 0, dash: true }
];

/* ---------------- 项目节点四期（用户手动控制 · FR-2.3） ---------------- */
const PROJECT_NODES = ['构思期', '建设期', '迭代期', '暂停期'];

/* ---------------- Agent（FR-6.1 · 全部手动维护） ----------------
 * ★ 09-22 第四十二轮：agent 只保留四个手填字段 ——
 *     name / quotaLeft（当前剩余）/ monthlyQuota（每月套餐额度）/ quotaResetAt（额度重置）。
 *   ❌ 去掉 current（「当前 agent」概念整体取消，概览额度卡直接取列表第一个）
 *   ❌ 去掉 note（卡片与表单都不再出现备注）
 * ★ 09-22 第四十二轮·补：quotaResetAt 记「重置日」——
 *   各家都是按月重置，记年月日时分秒既没人看、手填还容易填错。
 * ★★ 133 轮：**连月份也去掉**，只留「日」（如 '01' / '30'）——
 *   既然按自然月重置，月份就是个常量，留着反而多一处能填错的地方
 *   （还要自己推"今年还是明年"）。见 store.resetDayOf / daysUntilReset。
 *   页面把它换算成「距离重置 N 天」（store.daysUntilReset）来展示。
 *   ⚠️ 本组两个种子换完**展示值一字未变**：a1 = 每月 1 号 ⇒ 10/1（10 天）、
 *      a2 = 每月 30 号 ⇒ 9/30（9 天）—— 与 42 轮那版 '10-01' / '09-30' 等价。
 * ★ 09-22 第四十二轮·补二：额度按**积分**记 ⇒ quotaLeft / monthlyQuota 都是**纯整数**，
 *   不带 ¥ / % 之类的单位，也不留小数（第四十二轮·补二 走查）。
 *   两个数配起来读才成立：「当前剩余 1240 / 每月套餐 2000」。
 *   「额度偏低」＝ quotaLeft ÷ monthlyQuota < 20%（见 mod-mine 的 quotaRatio）。
 * updatedAt 是唯一的自动写入字段，但它记的是「你上次手动改的时间」（FR-6.1）。
 * 今天 09-21：a1 已 9 天没更新 ⇒ 概览额度卡走「过期弱化」，用来演示 FR-5.3。
 */
const AGENTS = [
  {
    id: 'a1', name: 'WorkBuddy 主工位',
    quotaLeft: '1240', monthlyQuota: '2000',
    quotaResetAt: '01',
    updatedAt: '2026-09-12 20:10'
  },
  {
    id: 'a2', name: 'Claude Code',
    quotaLeft: '24', monthlyQuota: '200',
    quotaResetAt: '30',
    updatedAt: '2026-09-18 11:08'
  }
];

/* ---------------- 模型厂家 key（Token API · ★★ 2026-10-12 转真功能） ----------------
 * ⚠️ 与 agent 额度是**两件事**（设计定案 §86 脚注）：
 *   · 这一块 ＝ 你在模型厂家**自己开通的 key** 的余额 —— 有公开接口 ⇒ **真查**；
 *   · agent 额度 ＝ 订阅配额，平台没有接口 ⇒ 仍是手填。
 * ★★ 2026-10-12：`vendor` 从"手填厂家名"改成**厂商标识**（`utils/vendors.js` 的 `code`），
 *   余额也不再手填 —— 由后端代查厂家接口回写。新增四个字段：
 *   · `keyMask`   'sk-****4f2a' —— 掩码（明文 key 只存在后端，前端永远拿不到）
 *   · `hasKey`    有没有配 key（false ＝ 卡片显示「待配置」）
 *   · `balanceAt` 余额**最后成功查询**的时间（卡片「更新于 X」读它）
 *   · `lastError` 最近一次查询失败的原因（非空 ＝ 卡片显示失败提示）
 *
 * ★ 三条种子刻意摆出三种状态（出图 / 走查要一次看全）：
 *   k1 正常（余额充足）／k2 **余额偏低**（< ¥10，「余额偏低」标记靠它验）／
 *   k3 **还没配 key**（「待配置」态）。
 *   ⚠️ 三条**同厂商不同账号** —— 这正是用户要的形状：「可以添加同一个模型厂商多个账号」。
 */
const TOKEN_KEYS = [
  { id: 'k1', vendor: 'deepseek', balance: '¥ 128.40', keyMask: 'sk-****4f2a', hasKey: true,  balanceAt: '2026-09-20 09:12', lastError: '', updatedAt: '2026-09-20 09:12' },
  { id: 'k2', vendor: 'deepseek', balance: '¥ 8.60',   keyMask: 'sk-****9c07', hasKey: true,  balanceAt: '2026-09-18 21:40', lastError: '', updatedAt: '2026-09-18 21:40' },
  { id: 'k3', vendor: 'deepseek', balance: '',         keyMask: '',            hasKey: false, balanceAt: '',                 lastError: '', updatedAt: '2026-09-10 15:30' }
];

/* ---------------- 项目（FR-2.1–FR-2.9 · 用户自建分类容器） ----------------
 * 无 task / 提问 / 交付物；无采集统计；agentId 可空；archivedAt 空 ＝ 活跃。
 * p5 故意做成「已归档」，用来演示 FR-2.9 的筛选与取消归档。
 */
const PROJECTS = [
  {
    id: 'p1', name: '彩票小助手', color: 'qing', node: '迭代期', agentId: 'a1',
    remark: '小程序 ＋ 后端 ＋ Rokid 眼镜端三线并进。视觉规范先定稿，再进模块实现。',
    archivedAt: null, createdAt: '2026-08-02', updatedAt: '2026-09-17 14:02'
  },
  {
    id: 'p2', name: '摇头晃脑 AR', color: 'ganlan', node: '迭代期', agentId: 'a1',
    remark: '头控 AR 游戏，1 主 PRD ＋ 6 游戏子 PRD。',
    archivedAt: null, createdAt: '2026-07-18', updatedAt: '2026-09-18 19:40'
  },
  {
    id: 'p3', name: 'Agent ToDo', color: 'zi', node: '建设期', agentId: 'a1',
    remark: 'AI Task 工位的人因规划 / 调度 / 治理层。',
    archivedAt: null, createdAt: '2026-08-20', updatedAt: '2026-09-20 09:20'
  },
  {
    id: 'p4', name: 'rockchip 工具链', color: 'song', node: '迭代期', agentId: 'a2',
    remark: '板端工具链脚本集合。',
    archivedAt: null, createdAt: '2026-06-30', updatedAt: '2026-09-12 16:30'
  },
  {
    id: 'p5', name: 'WorkBuddy 数据探查', color: null, node: '暂停期', agentId: 'a1',
    remark: '本机会话数据探查与索引，暂停。',
    archivedAt: '2026-09-10 18:20', createdAt: '2026-05-11', updatedAt: '2026-09-10 18:20'
  }
];

/* ---------------- 待办（FR-3.1–FR-3.11 · 单级归属 ＋ 脑图协同） ----------------
 * 三个时间字段各司其职，一个都不能少：
 *   · createdAt   —— 创建。`sortTodos`（项目页：未完成优先 → 紧急度 → 创建时间）用它
 *   · completedAt —— 完成（取消完成必须置空，否则热力图会多出一条并不存在的完成记录 §7.2）
 *   · updatedAt   —— **最后被动过的时刻**（★ 44 轮补）。待办列表抽屉按它倒序，
 *                    卡上也显示它。原来只有前两个 ⇒「按更新时间排」根本无从排起。
 * 种子里刻意让 updatedAt 的顺序与 createdAt 的顺序**不一样** —— 这样排序有没有真的生效，
 * 一眼就能看出来（若两序相同，排序写错了也看不出来）。
 */
const TODOS = [
  {
    id: 'd1', projectId: 'p1', mindmapId: 'm1',
    text: '补齐 OCR 期号截断的兜底逻辑：识别结果不足 7 位时按当前年份补全前缀，写库前再校验一次。',
    urgency: 'urgent', done: false,
    createdAt: '2026-09-17 21:04', completedAt: null, updatedAt: '2026-09-21 18:20',
    images: [{ id: 'i1', label: '识别失败截图', uri: 'https://example.com/ocr-fail.png' }]
  },
  {
    id: 'd2', projectId: 'p1', mindmapId: 'm1',
    text: '购彩日历金额分档从 5 档细化到 7 档，把 50 元以上再拆细。',
    urgency: 'mid', done: false,
    createdAt: '2026-09-16 20:47', completedAt: null, updatedAt: '2026-09-19 08:30', images: []
  },
  {
    id: 'd3', projectId: 'p1', mindmapId: 'm1',
    text: '账本页支持按月导出 CSV 方便对账。',
    urgency: 'low', done: false,
    createdAt: '2026-09-14 16:20', completedAt: null, updatedAt: '2026-09-15 14:05', images: []
  },
  {
    id: 'd4', projectId: 'p1', mindmapId: 'm1',
    text: '考虑接入语音记账（先攒着，不急）。',
    urgency: 'hold', done: false,
    createdAt: '2026-09-11 10:05', completedAt: null, updatedAt: '2026-09-12 09:18', images: []
  },
  {
    id: 'd5', projectId: 'p2', mindmapId: null,
    text: 'AR 首页 8 方向图标做头动跟随的收敛测试。',
    urgency: 'mid', done: false,
    createdAt: '2026-09-15 19:12', completedAt: null, updatedAt: '2026-09-18 21:10', images: []
  },
  {
    id: 'd6', projectId: 'p2', mindmapId: null,
    text: 'HUD 状态文字在强光下的可读性复测（S2 / S3）。',
    urgency: 'urgent', done: false,
    createdAt: '2026-09-18 09:36', completedAt: null, updatedAt: '2026-09-20 22:40', images: []
  },
  {
    id: 'd7', projectId: 'p3', mindmapId: 'm4',
    text: '脑图气泡与项目气泡的形状区分：项目实心、脑图白底描边。',
    urgency: 'low', done: false,
    createdAt: '2026-09-13 15:10', completedAt: null, updatedAt: '2026-09-18 11:45', images: []
  },
  {
    id: 'd8', projectId: 'p3', mindmapId: null,
    text: 'agent 档案补齐「额度重置日」字段（先攒着）。',
    urgency: 'hold', done: false,
    createdAt: '2026-09-09 08:40', completedAt: null, updatedAt: '2026-09-10 16:40', images: []
  },
  {
    id: 'd9', projectId: 'p1', mindmapId: null,
    text: '热力图选中态改成 L 形括标，不换底色。',
    urgency: 'low', done: true,
    createdAt: '2026-08-28 11:02', completedAt: '2026-09-02 17:25', updatedAt: '2026-09-02 17:25', images: []
  },
  {
    id: 'd10', projectId: 'p1', mindmapId: 'm3',
    text: '按 V8 精简基线重新梳理一期验收清单。',
    urgency: 'mid', done: false,
    createdAt: '2026-09-20 10:15', completedAt: null, updatedAt: '2026-09-20 10:15',
    images: [
      { id: 'i2', label: '验收线草稿 1', uri: 'https://example.com/accept-1.png' },
      { id: 'i3', label: '验收线草稿 2', uri: 'https://example.com/accept-2.png' }
    ]
  },
  {
    id: 'd11', projectId: 'p5', mindmapId: null,
    text: '会话数据索引脚本迁到新机器（项目已归档，内容保留）。',
    urgency: 'low', done: false,
    createdAt: '2026-09-05 14:00', completedAt: null, updatedAt: '2026-09-21 09:05', images: []
  },
  /* ★ 第四十七轮补两条**更早**的种子（d12 / d13）：
     待办列表的「更新时间」筛选分「最近一周 / 一月 / 三月」三档，原来的种子最新到 09-21、
     最老只到 09-02 —— 三档里有两档的筛选结果完全一样，看不出区别。
     补一条 8 月（落在一月之外、三月之内）与一条 3 月（落在三月之外）之后，
     四档的实际条数才分得开：全部 13 ／ 一周 8 ／ 一月 11 ／ 三月 12。 */
  {
    id: 'd12', projectId: 'p1', mindmapId: null,
    text: '热力图第 38 周数据回填（7 月版，已被 9 月版取代）。',
    urgency: 'hold', done: true,
    createdAt: '2026-07-28 09:12', completedAt: '2026-08-05 15:30', updatedAt: '2026-08-05 15:30', images: []
  },
  {
    id: 'd13', projectId: 'p2', mindmapId: null,
    text: '旧版 3×3 九宫格首页的存档备份（已弃用，留档备查）。',
    urgency: 'hold', done: true,
    createdAt: '2026-03-10 11:20', completedAt: '2026-03-20 09:00', updatedAt: '2026-03-20 09:00', images: []
  },
  /* ★★ 第一百六十轮 · **已删除**的两条（逻辑删除 · `deletedAt`）：
     它们是「已删除」那一档唯一的演示数据 —— 那一档是**还原的唯一入口**，
     mock 态下若一条都没有，走查时既看不出这档长什么样、也试不了还原。

     两条**刻意一未完成一已完成**：证明"已删除"与 `done` 是**正交**的
     （删之前是未完成还是已完成，数据层照旧记着），所以这一档里两种卡都会出现；
     点「还原」**一律回到未完成**（用户 160 轮拍板），d15 就是用来验这一句的。

     ⚠️ `updatedAt` ＝ 删除时刻（`store.removeTodo()` 软删时同时刷它）⇒ 这一档实际是
        **按删除时间倒序**，刚删的排最前 —— 用户找它多半就在那一下之后。
     ⚠️ 时间刻意排在 09-21 / 09-20 附近（最近一周内）：这样切「最近一周」时它们不会被
        时间条件顺手排掉，"状态 ＋ 时间"两个条件是**同时**在生效的（能看出叠加效果）。
     ⚠️ 它们**不进活跃度台账**（见下面 `buildActivity`）—— 已删除的实体不该再贡献颜色，
        这也保证热力图演示形态与加法之前逐格一致。 */
  {
    id: 'd14', projectId: 'p1', mindmapId: null,
    text: '热力图 hover 提示改成跟手的小气泡（讨论后搁置，先删掉）。',
    urgency: 'low', done: false, deletedAt: '2026-09-21 20:15',
    createdAt: '2026-09-16 10:30', completedAt: null, updatedAt: '2026-09-21 20:15', images: []
  },
  {
    id: 'd15', projectId: 'p2', mindmapId: null,
    text: '头动跟随的阻尼系数从 0.6 调到 0.4（试过，结论是维持 0.6，这条作废）。',
    urgency: 'mid', done: true, deletedAt: '2026-09-20 18:42',
    createdAt: '2026-09-12 14:05', completedAt: '2026-09-19 11:20', updatedAt: '2026-09-20 18:42', images: []
  }
];

/* ---------------- 闪念胶囊（★ 本轮新增 · FR-9） ----------------
 * 用户「张口就来」的一段段口播 —— 在手机上先接住，等坐到平板 / PC 前再整理成
 * 一条待办、或脑图上的一个节点。
 *
 * 字段极简：只有「文本 ＋ 创建时间」（外加 `source` 记录它是口播还是手打）。
 * ⚠️ 列表顺序口径：**按创建时间正序**（越早越靠上）——
 *    它是一本流水账，与待办 / 脑图那两张按更新时间**倒序**的列表有意相反。
 * ⚠️「识别中」**不落库**：那句「语音识别中」只活在组件的状态里，识别文本回来就写进
 *    `text` —— 数据层不该知道"后端还没回"这件事（与热力图"当日值现算不落库"同一个道理）。
 */
const CAPSULES = [
  { id: 'c1', text: '票据录入那条链路，扫码入口先不接，先只做拍照和相册两个。', createdAt: '2026-09-19 08:12', source: 'voice' },
  { id: 'c2', text: '购彩日历的格子上，金额超过 50 的想加一个角标，不然一眼看不出大小。', createdAt: '2026-09-20 12:40', source: 'voice' },
  { id: 'c3', text: '账号合并只认 openid 这一条，手机号先不绑。', createdAt: '2026-09-20 22:05', source: 'voice' },
  { id: 'c4', text: '验收清单里「强光下 HUD 可读性」要单独占一条，上次就是这么漏掉的。', createdAt: '2026-09-21 08:31', source: 'voice' },
  /* ★★ 第一百六十轮 · 两条**不在正常名单里**的胶囊（`store.capsules()` 两条都滤掉）：

     ⚠️ 写的是**布尔**（`deleted` / `consumed`）而不是时刻串 —— 种子里这几条**绕过适配层**
        直接进 `state`（`state = clone(mock.CAPSULES)`），所以必须写成 `adaptCapsule()`
        出来的那个形状。写成 `deletedAt: '…'` 是**静默失效**：`isGoneCapsule()` 读布尔，
        于是这条会照旧躺在正常列表里（不会报错，只会看着像"删除没生效"）。

     · c5 —— **手动删除**的那条：进「已删除胶囊」列表（可还原）⇒ 那一档的演示数据；
     · c6 —— **被消化**的那条（转待办 / 转脑图走掉）：两个名单都不进。
       它在这份种子里是**刻意**留的"负样本" —— 走查时看不见它，但判据脚本能验
       "两个名单不互补"这条口径（用户口径：只有手动删除才进已删除列表）。
       ⚠️ 真接口下这种状态不存在于 `GET /sync` 的返回里（服务端只给 `consumedAt` 为空的），
          它是前端在「转待办 / 转脑图」成功后就地打上的（`markCapsulesLocal(..., 'consumed')`）。 */
  { id: 'c5', text: '（这条是演示数据）购彩日历的角标颜色想跟金额档位走，做完发现没必要，先删掉。', createdAt: '2026-09-18 09:05', source: 'text', deleted: true },
  { id: 'c6', text: '（这条是演示数据）把「热力图量程 10→50」记进待办 —— 已经转成待办走了，不再出现在胶囊里。', createdAt: '2026-09-17 20:40', source: 'voice', consumed: true }
];

/* ---------------- 脑图（FR-7.2 · 项目 1:N，每张可命名；无「来源」字段） ----------------
 * ★ 本轮补 `format` —— 一张脑图的**排版格式**（六种，目录见 utils/formats.js）。
 *   六张演示图**刻意各用一种**：这样进列表抽屉第一眼就能看出"格式"这一栏在筛什么，
 *   也让画布上那六套排版算法都有真实数据可跑。
 *   排序口径（本轮起）：列表按 `updatedAt` 倒序平铺 —— 故意让它与 id 顺序不一样
 *   （m3 最新、m5 最老），否则排序写错了也看不出来。
 */
const MINDMAPS = [
  { id: 'm1', projectId: 'p1', name: '票据录入链路', nodes: 10, depth: 3, format: 'logic',    updatedAt: '2026-09-16 21:04' },
  { id: 'm2', projectId: 'p1', name: '兑换规则与奖级', nodes: 8,  depth: 3, format: 'mindmap',  updatedAt: '2026-09-14 09:52' },
  { id: 'm3', projectId: 'p1', name: '验收清单',     nodes: 21, depth: 4, format: 'org',      updatedAt: '2026-09-20 09:20' },
  { id: 'm4', projectId: 'p3', name: '待办模块拆解', nodes: 7,  depth: 3, format: 'tree',     updatedAt: '2026-09-15 15:10' },
  { id: 'm5', projectId: 'p3', name: '设计令牌与组件', nodes: 11, depth: 3, format: 'timeline', updatedAt: '2026-09-13 08:40' },
  /* ★ 本轮新增：p2（摇头晃脑 AR）原来一张脑图都没有，「项目卡 → N 张脑图」那一栏恒为 0，
     补这张既让「鱼骨图」有演示数据，也让 p2 的脑图数不再是 0（0 与 1 的区别读者看得见）。 */
  /* ⚠️ 86 轮修正：这里原写 `nodes: 7`，但这棵树实际是 root ＋ 3 分支 ＋ 6 叶子 ＝ **10**。
     列表卡上的「N 个节点」直接显示这个字段 ⇒ 不修的话用户看到的是假的。
     顺手用 Node 把 6 张全核了一遍，只有这一张对不上（m1–m5 的 nodes/depth 都与树一致）。 */
  { id: 'm6', projectId: 'p2', name: '头控交互草稿', nodes: 10, depth: 3, format: 'fishbone', updatedAt: '2026-09-19 11:26' }
];

/**
 * 脑图结构 —— 严格树（每节点只允许一个父节点、不许自由连线，FR-7.3）。
 * 节点几何不再写死坐标：pages/mindmap 按树结构自动排版（见该文件 layoutLand / layoutPort），
 * 所以新建的脑图与手动加的节点都能落到画布上。这里五张图都给了内容，避免点到空白画布。
 */
const MINDMAP_TREE = {
  m1: {
    id: 'n0', text: '票据录入链路', remark: '', level: 0, kind: 'root',
    children: [
      {
        id: 'n1', text: '识别', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n1a', text: '拍照 / 相册 / 扫码 三个入口', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n1b', text: 'OCR 返回字段与置信度',       remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      },
      {
        id: 'n2', text: '修正', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n2a', text: '期号补齐到 7 位', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n2b', text: '号码红蓝分隔',   remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      },
      {
        id: 'n3', text: '入库', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n3a', text: '同票号去重',       remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n3b', text: '失败重试与人工兜底', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      }
    ]
  },
  m4: {
    id: 'n0', text: '待办模块拆解', remark: '', level: 0, kind: 'root',
    children: [
      {
        id: 'n1', text: '信息体', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n1a', text: '文字（必填）', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n1b', text: '图片（可选 · 相册）', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      },
      {
        id: 'n2', text: '归属与协同', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n2a', text: '项目（必填 · 单级）', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n2b', text: '脑图（可选 · 整张）', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      }
    ]
  },
  m2: {
    id: 'n0', text: '兑换规则与奖级', remark: '', level: 0, kind: 'root',
    children: [
      {
        id: 'n1', text: '兑奖期限', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n1a', text: '60 自然日内有效', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n1b', text: '超期视为弃奖',     remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n1c', text: '双色球 / 大乐透同规', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      },
      {
        id: 'n2', text: '兑付门槛', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n2a', text: '单注 < ¥1 万 → 彩票店',   remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n2b', text: '单注 ≥ ¥1 万 → 彩票中心', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      }
    ]
  },
  m3: {
    id: 'n0', text: '一期验收清单与上线前自检', remark: '', level: 0, kind: 'root',
    children: [
      {
        id: 'n1', text: 'A · 项目模块（创建与归档）', remark: '', level: 1, kind: 'branch',
        children: [
          {
            id: 'n1a', text: '创建：名称与颜色都可改', remark: '', level: 2, kind: 'branch',
            children: [
              { id: 'n1a1', text: '不需要和 agent 侧同步任务状态', remark: '', level: 3, kind: 'leaf', children: [] },
              { id: 'n1a2', text: '允许重名，重名时靠颜色与所属项目区分', remark: '', level: 3, kind: 'leaf', children: [] }
            ]
          },
          {
            id: 'n1b', text: '归档：只读且随时可取消归档，不做删除', remark: '', level: 2, kind: 'branch',
            children: [
              { id: 'n1b1', text: '归档后只读，不能再新增、改动或删除任何节点', remark: '', level: 3, kind: 'leaf', children: [] },
              { id: 'n1b2', text: '可随时取消归档，数据一条都不丢',           remark: '', level: 3, kind: 'leaf', children: [] }
            ]
          }
        ]
      },
      {
        id: 'n2', text: 'B · 待办模块（详情与表单）', remark: '', level: 1, kind: 'branch',
        children: [
          {
            id: 'n2a', text: '详情页：正文、图片、关联脑图与所属项目一屏可见', remark: '', level: 2, kind: 'branch',
            children: [
              { id: 'n2a1', text: '正文必填，图片可选且最多九张',        remark: '', level: 3, kind: 'leaf', children: [] },
              { id: 'n2a2', text: '可关联一张脑图与一个所属项目',        remark: '', level: 3, kind: 'leaf', children: [] }
            ]
          },
          {
            id: 'n2b', text: '表单抽屉：创建与编辑共用一套壳', remark: '', level: 2, kind: 'branch',
            children: [
              { id: 'n2b1', text: '创建：四个字段一屏填完，不跳步',              remark: '', level: 3, kind: 'leaf', children: [] },
              { id: 'n2b2', text: '编辑：改完立刻重排画布，不需要手动对齐位置',   remark: '', level: 3, kind: 'leaf', children: [] }
            ]
          }
        ]
      },
      {
        id: 'n3', text: 'C · 脑图模块（列表与画布）', remark: '', level: 1, kind: 'branch',
        children: [
          {
            id: 'n3a', text: '独立模块：列表态与画布态两个视图', remark: '', level: 2, kind: 'branch',
            children: [
              { id: 'n3a1', text: '列表态挑图、画布态改结构，两者互不打断', remark: '', level: 3, kind: 'leaf', children: [] }
            ]
          },
          {
            id: 'n3b', text: '严格树：每节点只有一个父节点，不留自由连线', remark: '', level: 2, kind: 'branch',
            children: [
              { id: 'n3b1', text: '不留自由连线，导出的 Markdown 层级永远正确', remark: '', level: 3, kind: 'leaf', children: [] },
              { id: 'n3b2', text: '导出时层级缩进必须正确',                     remark: '', level: 3, kind: 'leaf', children: [] }
            ]
          }
        ]
      }
    ]
  },
  m5: {
    id: 'n0', text: '设计令牌与组件', remark: '', level: 0, kind: 'root',
    children: [
      {
        id: 'n1', text: '颜色', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n1a', text: '主墨 ＋ 中性四阶', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n1b', text: '品牌黄（唯一强调色）', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n1c', text: '紧急程度四档', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      },
      {
        id: 'n2', text: '字体', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n2a', text: '七级字号层级', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n2b', text: '数字走 Inter', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      },
      {
        id: 'n3', text: '组件', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n3a', text: '待办卡', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n3b', text: '抽屉（列表 ／ 表单）', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      }
    ]
  },
  /* ★ 本轮新增：p2 的「头控交互草稿」—— 鱼骨图的演示数据。
     三根肋骨（对准 / 手势 / 反馈），每根再挂两个叶子，刚好把「主脊 ＋ 上下交替肋骨」跑满。 */
  m6: {
    id: 'n0', text: '头控交互草稿', remark: '', level: 0, kind: 'root',
    children: [
      {
        id: 'n1', text: '对准', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n1a', text: '准星恒居中', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n1b', text: 'IMU 噪声收敛', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      },
      {
        id: 'n2', text: '手势', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n2a', text: '单击＝进入瞄准', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n2b', text: '长按＝回首页', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      },
      {
        id: 'n3', text: '反馈', remark: '', level: 1, kind: 'branch',
        children: [
          { id: 'n3a', text: 'HUD 只留状态文字', remark: '', level: 2, kind: 'leaf', children: [] },
          { id: 'n3b', text: '强光下可读性复测', remark: '', level: 2, kind: 'leaf', children: [] }
        ]
      }
    ]
  }
};

/* ---------------- W1 热力图 · 最近 30 周（W10–W39 · FR-5.1） ----------------
 * ⚠️ D-6 落地要求：数据层把各来源**分别计数** ——
 *    `created`（待办创建）／ `completed`（待办完成）／ `capsule`（闪念胶囊创建），
 *    格子强度 ＝ 三者之和，且**查询时现算**，不落库。
 *    这里 HEATMAP.weeks[i].days[j] 就是按这个口径给出的原始数据。
 * ★ 第 97 轮：口径由「待办创建 ＋ 待办完成」扩为**三者之和**（新增胶囊）。
 *   理由：胶囊是本版新增的记录入口（`FR-9`）—— 用户张口就来一句就落一条，
 *   它同样是"这天有活动"的证据；漏掉会让最近这些天的热力**偏冷**
 *   （用户随手记的碎信息一条都进不来，热力图上却像那天什么都没干）。
 */
const WEEK_TOTAL = 30;
const DAY = 86400000;
const WEEK_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 取某时间戳所在周的**周一 0 点**（本地时区 —— 周一为一周之首，与热力图那 7 行轴同序） */
function mondayOf(ts) {
  const d = new Date(ts);
  const base = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return base - ((d.getDay() + 6) % 7) * DAY;
}
/** ISO 周号（含 1 月 4 日的那一周为第 1 周）—— 横轴刻度上印的就是它 */
function isoWeekNo(mondayTs) {
  const m = new Date(mondayTs);
  const thu = new Date(m.getFullYear(), m.getMonth(), m.getDate() + 3);  // 该周的周四定 ISO 年
  const firstMonday = mondayOf(new Date(thu.getFullYear(), 0, 4).getTime());
  return Math.round((mondayTs - firstMonday) / (7 * DAY)) + 1;
}

/**
 * ★ 第 97 轮：窗口**跟着系统当天走**（原来是写死的 `39` ／ `2026-09-21`）。
 *
 * 为什么必须改 —— 不改的话"把胶囊统计进去"在真机上**根本看不见**：
 *   新建记录的 `createdAt` 来自 `store.stamp()`＝ `new Date()`（**系统当前时间**），
 *   而窗口原来钉死在 2026-09-21 那一周 ⇒ 用户今天（09-28）记的胶囊、记的待办
 *   全部落在窗口**右侧之外**，热力图上一点反应都没有。
 *
 * ⚠️ 别把它改回常量，也别改成去读 `store.TODAY`：`TODAY` ＝ `2026-09-21` 是**种子数据的基准**
 *    （演示待办 / 脑图的时间都围着它写），它是"假今天"；而窗口服务于"**真今天记的东西要看得见**"。
 *    两者不同源是有意的 —— 种子数据可以永远停在 09-21，但窗口不能。
 *
 * ⚠️ 配套改动：`baseLoad` / `baseCapsules` 的第一个参数已由**绝对周号**改为**相对偏移**
 *    （`w = weekNo - LAST_WEEK_NO`，0 ＝ 最后一周、-1 ＝ 上一周）。
 *    不这么改的话，窗口每右移一周、整张热力图就会**换一副随机形状**（基线依赖周号），
 *    用户每周都会看到一张陌生的图。用相对偏移 ⇒ 窗口平移时形状**逐格不变**。
 */
const LAST_MONDAY = mondayOf(Date.now());
const LAST_WEEK_NO = isoWeekNo(LAST_MONDAY);

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(dt) { return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
function md(dt) { return pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }

/**
 * 确定性基线强度（0–9 的"当日待办活动量"），保证每次渲染一致。
 * @param {number} w **相对周偏移**（0 ＝ 窗口最后一周，-1 ＝ 上一周 …… 见 `LAST_MONDAY` 处的说明）
 *   ⚠️ 参数语义是「距今天的周数」而不是绝对 ISO 周号 —— 这样窗口平移时形状不变。
 */
function baseLoad(w, d) {
  const x = Math.sin(w * 12.9898 + d * 78.233 + 31.7) * 43758.5453;
  const f = x - Math.floor(x);
  if (w >= -2) return f < 0.40 ? 0 : (f < 0.70 ? 1 : (f < 0.90 ? 3 : 5));   // 最近三周偏冷
  if (f < 0.16) return 0;
  if (f < 0.40) return 2;
  if (f < 0.64) return 4;
  if (f < 0.86) return 6;
  return 9;
}

/**
 * 胶囊基线强度（0 / 1 / 2 条）—— ★ 第 97 轮新增。
 *
 * 与 `baseLoad` 的关系是「**另起一条序列**」而不是「从 load 里分一份」，两个理由：
 *   ① 语义：胶囊是**多加的一个入口**（用户以前不记，现在记了），不是把待办的量搬过来。
 *      从 load 里切会让待办侧凭空变少 —— 那是"记账搬家"，不是"统计新增"。
 *   ② 形态：口播是随手的，**不是每天都有** ⇒ 必须允许 0，且 0 要占多数。
 *      从 load 里按比例分的话，load=2 的日子会被 `ceil` 硬凑出 1 条，天天都"有胶囊"。
 *
 * ⚠️ 用**与 `baseLoad` 不同的**正弦系数，否则两条序列同步涨落（同一天要么都高要么都低），
 *    一眼就能看出是同一串伪随机数造的，热力图会显得太规整。
 *
 * @param {number} w **相对周偏移**（同 `baseLoad`，0 ＝ 窗口最后一周）
 *
 * 实测（30 周 × 7 ＝ 210 格，叠加真实数据后）：胶囊共 111 条、日均 **0.53** 条 ⇒
 *   分档分布 `{0: 39→23, 1: 48→46, 2: 58→66, 3: 62→66, 4: 3→9}`
 *   （左＝不含胶囊的参照，右＝含胶囊）——
 *   **只把原本全白的那 16 天点亮**，其余各档几乎不动 ⇒ 是"统计口径变全"，
 *   不是"整张图被调亮"。阈值再松就会让胶囊喧宾夺主（日均 > 0.7 时最深档翻倍）。
 *
 * ⚠️ 上面那份分布是**阈值 10 时代**测的，2026-10-10 量程抬到 50 之后**已过期**：
 *    这套种子的合值上限 ≈ 9 ＋ 2 ＝ **11**（见 `baseLoad`），新阈值下绝大多数格子
 *    只能落到第 1 档、少数第 2 档，**第 3／4 档全空** ⇒ mock 态（`USE_MOCK` /
 *    未接后端）的热力图会**整片偏浅**。这是"量程抬了、种子没抬"的必然结果。
 *    ⇒ 要恢复演示形态就得同步放大种子（`baseLoad` 与这里的返回值各 ×5 左右），
 *      但那会让 `设计/前端核验-V8/` 那批走查图整批变样，**属于另一个决定**。
 */
function baseCapsules(w, d) {
  const x = Math.sin(w * 41.7 + d * 19.3 + 2.1) * 43758.5453;
  const f = x - Math.floor(x);
  if (f < 0.62) return 0;
  if (f < 0.88) return 1;
  return 2;
}

/** 强度分档：合值（**待办创建 ＋ 待办完成 ＋ 胶囊创建**，第 97 轮起）→ 5 档（0 / 1-10 / 11-25 / 26-49 / ≥50）
 *
 * ★★ 2026-10-10：**量程由 10 抬到 50**（原 0 / 1-2 / 3-5 / 6-9 / ≥10）。
 *
 * 为什么改 —— 原阈值是按"日均三到五条"这个强度定的。用量长上来之后，
 *   十天半个月里**天天都是 10+ 条** ⇒ 整张图长期顶格，深浅层次消失
 *   （热力图看不出"哪天更忙"）。阈值是**绝对值**、不随用户自己的数据走，
 *   所以量程不够时只能手动抬。
 *
 * 怎么抬 —— 前四档按原倍率 **×5** 等比放大：
 *     1-2 → 1-10　·　3-5 → 11-25　·　6-9 → 26-45
 *   最深档门槛由"≥10"抬到"**≥50**"（用户给的数）。
 *   ★ 最后一步**不是**严格 ×5：6-9 ×5 ＝ 26-45，本应"≥46"，
 *     这里把第三档的上界一并放到 49，好让最深档恰好从 **50** 这个整数关口起。
 *     46-49 那一小段在实际分布里本来就落不进几格（210 格的尺度上，
 *     一格差 4 条肉眼看不出来），换来"最深色 ＝ 50 条以上"这句人话，值。
 *
 * ⚠️ 量程是**手动**的：真实用量再翻一倍，这张图会**再次顶格**，届时还得再来一次。
 *    想做成自适应的（按近 N 周的分位数动态定档）就**不再是"固定色卡"** ——
 *    那样同一格的颜色会随窗口漂移、跨时间不可比，是另一套取舍，别顺手改。
 * ⚠️ 与 `HEATMAP.bands` 是一对：**改任一方必须同时改另一方**（见下面那处注释）。
 * ⚠️ 判据侧有硬编码期望值：`工具/check_activity_round132.js` 的 E6e 组
 *    （`sum 10 ⇒ level 1`）。**再改量程记得同步那几条**，否则判据会红。
 */
function levelOf(sum) {
  if (sum <= 0) return 0;
  if (sum <= 10) return 1;
  if (sum <= 25) return 2;
  if (sum <= 49) return 3;
  return 4;
}

const HEATMAP = {
  weekStart: LAST_WEEK_NO - WEEK_TOTAL + 1,   // 现算；2026-09-28 ⇒ 11
  weekEnd: LAST_WEEK_NO,                      // 现算；2026-09-28 ⇒ 40
  weeks: [],
  weekdays: WEEK_CN,
  legend: ['#F1F2F5', '#FFF4C4', '#FFE07A', '#FFD02F', '#E5A400'],
  /* 分档说明（legend 的 tooltip 用）—— 这五条描述的是上面 `levelOf` 的**阈值本身**，
     ⚠️ 与 sum 由几部分组成无关：sum 的口径从两源扩到三源（第 97 轮）后这里**不用改**；
        但**阈值本身**一改（★ 2026-10-10 量程 10→50）这里就必须跟着改。
     ⚠️ 它与 `levelOf` 是一对：**改任一方必须同时改另一方**，否则 tooltip 说的区间
        和颜色实际对应的区间会对不上（这类"静默不一致"本工程踩过）。
     ⚠️ 当前页面**不显示**这五条（第 59 轮把图例右侧"分档 0 条 / 1–2 条 / …"删了），
        它只作 tooltip / 文案字段存在 —— 但**必须留着且必须准**：
        它是 `levelOf` 唯一的文字镜像，删了就没人能一眼校验阈值。 */
  bands: ['0 条', '1–10 条', '11–25 条', '26–49 条', '50 条以上']
};

/**
 * 生成 30 周的**基线**数据 —— ★ 第 97 轮起这里**不再叠加任何真实数据**。
 *
 * 真实计数（待办创建 / 待办完成 / 胶囊创建）由 `store.heatWeeks()` **查询时现算**叠加
 * （D-6 的硬要求：当日值现算、不落库）。所以 `days[]` 里只有基线值，
 * **没有 `sum` / `level`** —— 那两个量要等真实数据叠加完才算得准。
 *
 * ⚠️ 拆分前这里是「基线 ＋ TODOS ／ CAPSULES 叠加」，拆完对**启动那一刻**的结果完全等价
 *    （store 的 `todos` / `capsules` 初值就是这两份数据的 clone），
 *    但拆开之后"用户新记一条、热力图立刻 +1"才成为可能。
 */
/**
 * 30 周 × 7 的**日期骨架**生成器 —— ★ 第 113 轮提取，`HEATMAP`（伪随机基线）与
 * `emptyHeatmap()`（真接口下的零基线）**共用这一份**。
 *
 * ⚠️ 为什么必须共用而不是各写一份：骨架里有 5 个字段（`weekNo / dayIndex / date / mmdd / label`）
 *   和一处周偏离（`LAST_MONDAY`）是**推导出来的**。两份各写一次 ⇒ 哪天窗口口径一改，
 *   只有一处跟着动，另一处**静默错位**（热力图上表现为"零基线那张图和基线那张图对不上"，
 *   而且因为两张图不会同时出现在屏幕上，**肉眼永远发现不了**）。
 *
 * @param {Function} valueOf `(rel, dayIndex) => {created, completed, capsule}`
 *   `rel` 是**相对周偏移**（0 ＝ 窗口最后一周），不是绝对 ISO 周号。
 * @returns {Array} `[{weekNo, key, days: [...]}]`
 */
function buildHeatWeeks(valueOf) {
  const startMonday = LAST_MONDAY - (WEEK_TOTAL - 1) * 7 * DAY;
  const weeks = [];
  for (let wi = 0; wi < WEEK_TOTAL; wi++) {
    const rel = wi - (WEEK_TOTAL - 1);          // 相对周偏移：最后一周 ＝ 0（baseLoad 的口径）
    const weekNo = HEATMAP.weekStart + wi;
    const monday = startMonday + wi * 7 * DAY;
    const days = [];
    for (let d = 0; d < 7; d++) {
      const dt = new Date(monday + d * DAY);
      const date = ymd(dt);
      const v = valueOf(rel, d);
      days.push({
        weekNo: weekNo,
        dayIndex: d,
        date: date,
        created: v.created,
        completed: v.completed,
        capsule: v.capsule,
        mmdd: md(dt),
        label: date + ' ' + WEEK_CN[d]
      });
    }
    weeks.push({ weekNo: weekNo, key: 'w' + weekNo, days: days });
  }
  return weeks;
}

/* 伪随机基线填充：与第 97 轮之前的 `buildHeatmap` 逐格等价（重建时已比对过 JSON） */
HEATMAP.weeks = buildHeatWeeks(function (rel, d) {
  const load = baseLoad(rel, d);
  const created = Math.ceil(load * 0.45);
  return { created: created, completed: load - created, capsule: baseCapsules(rel, d) };
});

/**
 * ★★ 第 113 轮新增：**零基线** —— 真接口（`_mock === false`）下该用的那张热力图底图。
 *
 * 为什么必须存在：`HEATMAP` 上面那张是**伪随机造出来的"日常活跃度"**（`baseLoad` 的正弦取模），
 * 它的身份是**种子数据**（与 `TODOS` / `CAPSULES` 同级），不是"产品自带的一层底色"。
 * 而 30 周窗里 210 格有 **184 格非零**、合计 880 次活动 —— 全是假的。
 *
 * 原来的 bug：`store.hydrate()` 把 7 份 mock 种子（agents / tokenKeys / projects / todos /
 * mindmaps / capsules / tree）逐份清掉了，**唯独漏了 `state.heat`** ⇒ 真接口下热力图
 * ＝ **假基线 ＋ 真计数**：空库也满图颜色，用户会以为"清了库怎么还有数据"。
 *
 * 返回结构与 `HEATMAP` **完全同形**（页面 / `todayCell()` / 明细条都依赖它），
 * 只是每个计数都是 0；同样**不带 `sum` / `level`**（那两个量由 `store.heatWeeks()` 叠加真数据后才算得准）。
 */
function emptyHeatmap() {
  return {
    weekStart: HEATMAP.weekStart,
    weekEnd: HEATMAP.weekEnd,
    weeks: buildHeatWeeks(function () { return { created: 0, completed: 0, capsule: 0 }; }),
    weekdays: WEEK_CN,
    legend: HEATMAP.legend.slice(),
    bands: HEATMAP.bands.slice()
  };
}

/**
 * ★★ 2026-10-09：活跃度**台账**的演示种子 —— 与真库的 `agenttodo_activity_day` 同形。
 *
 * ── 它是什么 / 不是什么 ─────────────────────────────────────────────────
 *   ✅ 一份「**动作发生过几次**」的按日聚合：`{ 'YYYY-MM-DD': {created, completed, capsule} }`
 *      （`state.activity` 的形状，见 store.js）。
 *   ❌ 它**不是**"从 TODOS / CAPSULES 推出来的视图" —— 真库那份**推不出来**：
 *      删掉的待办、被取消的那次完成、转成待办后被消费的胶囊，实体都已经不在了，
 *      可它们确确实实发生过。这正是用户 2026-10-09 报的那个缺陷
 *      （"统计的是实时值"：删一条待办，历史那天的颜色跟着变浅）。
 *
 * ── 那 mock 这边为什么可以从实体推 ─────────────────────────────────────
 *   演示种子是**静态**的（没有删除 / 取消 / 消费的历史），所以在这份数据上
 *   "现存实体" 与 "发生过的动作"**恰好相等** ⇒ 推出来的结果与改动前逐格一致，
 *   走查图（`设计/前端核验-V8/`）的形态**一个像素都不变**。
 *   ⚠️ 别被这件事误导成"真数据也能这么算"—— 这正是本轮要修掉的错。
 */
function buildActivity(todos, capsules) {
  const map = {};
  const bump = function (ts, k) {
    const d = ts ? String(ts).slice(0, 10) : '';
    if (!d) return;
    const a = map[d] || { created: 0, completed: 0, capsule: 0 };
    a[k] += 1;
    map[d] = a;
  };
  /* ★★ 160 轮：**只由"还在的"实体推** —— 已删除的待办、已删除 / 已被消化掉的胶囊
     一律不贡献颜色（后端台账"只加不减"是一回事，但 mock 这边**没有历史**，
     拿现存实体推就必须按"现存"来推，否则与真库口径正好相反）。 */
  (todos || []).forEach(function (t) {
    if (t.deletedAt || t.deleted === true) return;
    bump(t.createdAt, 'created');
    bump(t.completedAt, 'completed');
  });
  (capsules || []).forEach(function (c) {
    if (c.deleted || c.consumed) return;
    bump(c.createdAt, 'capsule');
  });
  return map;
}

const ACTIVITY = buildActivity(TODOS, CAPSULES);

module.exports = {
  PROJECT_COLORS,
  URGENCIES,
  PROJECT_NODES,
  AGENTS,
  TOKEN_KEYS,
  PROJECTS,
  TODOS,
  /* ★ 本轮：闪念胶囊 —— 口播接住的那些碎信息（FR-9） */
  CAPSULES,
  MINDMAPS,
  MINDMAP_TREE,
  /* ★ 第 97 轮：热力图的**分档函数**由 store 现算时调用（那边叠加完真实数据要定档），
     所以必须导出 —— 阈值只有这一份，与 `HEATMAP.bands` 成对（见那边的注释）。 */
  levelOf,
  HEATMAP,
  /* ★★ 本轮：**零基线** —— 真接口下 `store.hydrate()` 用它替换掉伪随机基线（见那边注释）。 */
  emptyHeatmap,
  /* ★★ 2026-10-09：活跃度**台账**种子 —— 热力图的计数真源（真接口下由 `GET /sync`
     的 `activity` 给）。mock 态由上面 `buildActivity()` 从演示实体推出来，与改动前逐格等价。 */
  ACTIVITY
};
