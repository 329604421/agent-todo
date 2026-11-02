/**
 * 表单抽屉的数据装配 —— 待办创建 / 编辑（FR-3.6 / FR-3.9 · D-4 定案走抽屉）
 * 另外顺手承载 个人资料 / 项目 / 脑图 / agent / token 的新建与编辑表单 —— 六者字段形态一致，共用一套壳。
 *
 * 位置：单独打开时落在 L1 位（横 84,24 ／ 竖 16,24）；
 *       若底下还压着一个列表抽屉，则右移 270 落在 L2 位（横 354,24 ／ 竖 286,24）。
 * —— 这就是 V8 文档里说的「列表抽屉里点编辑 → 叠加成既有 L1 → L2 两层几何」。
 *
 * ⚠️ 项目选择器里只列活跃项目：归档项目不出现（FR-2.9）。
 * ★ 09-22 第四十三轮（待办页专项）：① 全部 mode 的 `hint` 一律空串、抽屉里只留字段；
 *   ② 归属项目在选择器里改成**一行一个**（最多 8 个项目，胶囊会挤成两三行难认）；
 *   ③ 关联脑图改「选择行 ＋ 右侧三级抽屉」，选项按**归属项目**过滤（`mindmapOptions` 带 projectId）。
 * ★ 09-23 第五十七轮（项目表单专项）：
 *   ① 「关联 agent」由胶囊改**一行一个** —— 首行「不关联」是一次平等的选择，不是一个清空按钮；
 *   ② 「项目色」8 个颜色**各占一行**，同样带首行「不关联」；
 *   ③ 颜色被**别的项目**占用 ⇒ `off` 置灰不可选，行尾写明占用者（`store.projectOfColor`）；
 *      编辑时传 `selfId` 把自己排除在外。
 */
const store = require('./store');
/* ★★ 2026-10-12：模型厂商清单（Token API 的「模型厂商」字段只能从它里面选） */
const vendors = require('./vendors');

function closed() {
  return {
    open: false, mode: 'todo', offset: 0, title: '', submitLabel: '', id: '',
    values: null, urgencies: [], projects: [], mindmaps: [],
    /* ★ 本轮补 `formats`（脑图表单的格式字段）。
       ⚠️ 这张清单与下面 `FORM_ARRAYS` 必须对得上 —— 前者是"抽屉关着时的初值"，
          后者是"每个 mode 出栈前补齐"。两边都漏，组件会拿到 undefined。 */
    nodes: [], agents: [], colors: [], formats: [], vendors: [], hint: '',
    /* ★★ 280 轮：两个"开关"键，每条造表单的路径都必须带上（`undefined` 传给
       Boolean property 会变成 null 并在控制台刷 warn —— 本文件顶上那条注释的老坑）。
       · `requireAll` —— 必填规则按"是不是完善态"分流，见 `open()` 与 form-drawer 的 `valid()`
       · `noDanger`   —— 「完善脑图信息」不渲染删除键（§5.5 坑 2） */
    requireAll: false, noDanger: false,
    /* ★★ 2026-10-22：**这是不是"嵌套二级"表单**（审查 P1-07）。
       语义只有一句：取消它 ＝ **回到上一层表单**（父草稿原样保留），不是"放弃填写"。
       ⇒ form-drawer 的 `onCancel` 据此**跳过**「放弃填写？」确认；
         而 L1 / L2（从列表抽屉上叠出来的那张）仍然要问 —— 那一挡的取消是真的丢掉。
       ⚠️ 为什么不用 `offset > 0` 判：L2 位（从列表抽屉点编辑）的 offset 也是 270，
          但它不是嵌套、取消就是关掉整张表单（审查 P1-07 的第二个缺口）。
          位置与语义是两件事，必须各带一个字段。 */
    child: false
  };
}

/* ---------------- 选项装配（选中的那个直接标 selected，模板只做循环） ---------------- */

function urgencyOptions(sel) {
  /* ★★ 2026-10-22（审查 P2-03）：选项要多带 `text` / `soft` 两支 ——
     表单里紧急度的**选中态**已改成「浅底 ＋ 同色描边 ＋ 深字」，模板要用它们。
     数据源本来就有这两支（`mock.URGENCIES` 浅色 / `theme.URGENCY_DARK` 深色，
     见 `theme.urgency()`），只是这里原来只挑了 main ⇒ 模板拿到 undefined 会渲染成空色。
     ⚠️ 不要在这里"算一个更深的 main"：色板的口径在 `theme.js`／`mock.js`，
        这里只做形状转换（与 `vendorOptions` / `colorOptions` 同一条分工）。 */
  return store.urgencyList().map(function (u) {
    return {
      key: u.key, name: u.name, main: u.main,
      text: u.text || u.main, soft: u.soft || 'transparent',
      selected: u.key === sel
    };
  });
}

/**
 * 厂商选项 —— ★★ 2026-10-12（Token API）
 *
 * 「模型厂商」字段**只能选、不能输**（用户口径「模型厂商改为下列菜单」）。
 * 选项来自 `utils/vendors.js`，形状与 `nodeOptions` 一致（`{name, selected}`），
 * 模板复用同一个 `sd-chips` —— 项目里"单选"这一种交互**只有这一种画法**。
 * ⚠️ 选中匹配用 `code`（存库的稳定标识），不是 `name`。
 */
function vendorOptions(sel) {
  return vendors.vendorList().map(function (v) {
    return { code: v.code, name: v.name, selected: v.code === sel };
  });
}

/**
 * 项目选项（待办的「归属项目」／脑图的「所属项目」共用）——
 * ★★ 2026-10-23：**多带一支 `tinted`（这个项目有没有颜色）**。
 *
 * 起因（用户口径）：表单里最多 8 个活跃项目一行一个已经把抽屉撑得很长，
 * 而**只有着色的项目才需要"在这里一眼认出来"**（项目身份的唯一视觉载体就是那个色点）。
 * 无颜色的项目挤在同一列里既不提供信息、又把列表拉长 ⇒ 它们搬去
 * 「选择其他项目」的**副弹窗**（只列无颜色的，见 `form-drawer` 的 `pickProj`）。
 *
 * ⚠️ 判断依据必须是 **`store.colorOf(p.color)` 命中**，不是 `!!p.color`：
 *    色键在色表里被删过一轮时，`p.color` 有值但取不到色（`colorOf` 回 null）
 *    ⇒ 那一行会渲染成一个**空色点**。这种项目按"没有颜色"处理（进副弹窗），
 *    与列表卡 `packProjectCard` 的口径一致（那边也取不到色就退中性灰）。
 * ⚠️ 本数组仍然是**全量**（含无颜色的）：组件靠 `tinted` 分流，不在这里筛掉 ——
 *    `selected` 的语义、`sel()` 的就地翻牌、`backToParent` 的重算都按全量走，
 *    在这里筛会让"当前选中的那个无颜色项目"在选项里凭空消失。
 */
function projectOptions(sel) {
  return store.activeProjects().map(function (p) {
    const c = p.color ? store.colorOf(p.color) : null;
    return {
      id: p.id, name: p.name,
      color: c ? c.main : store.noneColor(),
      tinted: !!c,
      /* ★★ 2026-10-27：把项目绑定的 agent 一起抛出去 —— 脑图的归属 agent 由项目决定，
         选项目时要在**同一次 put** 里把它写进表单值（`form-drawer.applyProject`）。
         ⚠️ 选项数组是唯一数据源：不从 store 另查一次，否则"选中的那行"和"存下的那个"
            可能来自两个不同时刻（选项是 build 时拍下来的快照）。 */
      agentId: p.agentId || '',
      selected: p.id === sel
    };
  });
}

/**
 * 脑图选项 —— ★ 09-22 第四十三轮：每条带上 `projectId` 与 `nodes`
 *
 * 「关联脑图」在表单里已改成**选择行 ＋ 右侧三级抽屉**（设计定案 §4：三级装选项与详情），
 * 三级只列**归属项目下**的脑图，所以组件要能按 projectId 过滤 —— 这里把 projectId 一并抛出去。
 * 列表本身仍是全量（跨项目），过滤在组件里做（组件才知道用户当下选了哪个项目）。
 */
function mindmapOptions(sel) {
  const out = [{ id: '', name: '不关联', meta: '', projectId: '', nodes: 0, selected: !sel }];
  store.mindmapGroups().forEach(function (g) {
    g.items.forEach(function (m) {
      out.push({
        id: m.id, name: m.name, meta: g.project.name,
        projectId: g.project.id, nodes: m.nodes || 0,
        selected: m.id === sel
      });
    });
  });
  return out;
}

function nodeOptions(sel) {
  return store.projectNodes().map(function (n) { return { name: n, selected: n === sel }; });
}

/**
 * 关联 agent —— ★ 57 轮：**一行一个**（原来是与「项目节点」同款的胶囊）。
 * 理由和 43 轮把「归属项目」改成一行一个一样：**首行「不关联」本身是一次选择**
 * （用户口径「不选中为不关联」），塞在胶囊行里会被读成"清空按钮"；
 * 一行一个之后，「不关联 / WorkBuddy 主工位 / Claude Code」是三个平等的选项。
 *
 * ⚠️ 行数据的 `id` 是**存储值**（`''` ＝ 不关联），`uid` 只给 `wx:key` 用 ——
 *    `wx:key` 不接受空串（会报警告），所以首行必须有一个非空哨兵。
 *    这一条与三级脑图抽屉里「不关联」用 `__none` 是同一个坑。
 */
function agentOptions(sel, noNone) {
  /* ★★ 280 轮：`noNone` ＝ **这个字段是必填的** ⇒ 首行「不关联」整条不放。
     理由：那一行放进去是能选中的，可选完保存键永远是灰的 —— 界面允许一个
     走不通的选择，比"少一行"更让人困惑。（`requireAll` 的脑图 = 这种情形） */
  const out = noNone ? [] : [{ uid: '__none', id: '', name: '不关联', selected: !sel }];
  store.state.agents.forEach(function (a) {
    out.push({ uid: a.id, id: a.id, name: a.name, selected: a.id === sel });
  });
  return out;
}

/**
 * 项目色 —— ★ 57 轮：**8 个颜色各占一行**（原来是一排色胶囊，「无」挤在最前面）。
 * 与 agent 同一套读法：首行「不关联」是一次平等的选择，不是一个清空按钮。
 *
 * 每行的三种状态：
 *   · `selected` —— 当前项目用着这个色（右侧打勾）
 *   · `off`      —— **已被别的项目占用** ⇒ 置灰不可选，右侧写明被谁用了
 *                  （只写"不可用"会让人以为是 bug；写清占用者才是可自查的）
 *   · 其余       —— 可选
 *
 * @param {string} sel      当前选中色键
 * @param {string} selfId   正在编辑的项目 id（新建传 ''）—— 排除自己，否则编辑时会
 *                          把自己的颜色也判成"已被占用"
 */
function colorOptions(sel, selfId) {
  const out = [{ uid: '__none', key: '', main: store.noneColor(), name: '不关联', owner: '', off: false, selected: !sel }];
  store.colorList().forEach(function (c) {
    const owner = store.projectOfColor(c.key, selfId);
    out.push({
      uid: c.key, key: c.key, main: c.main, name: c.name,
      owner: owner ? owner.name : '',
      off: !!owner,
      selected: c.key === sel
    });
  });
  return out;
}

/* ---------------- 各模式的表单 ---------------- */

/**
 * @param {string} mode 'profile' | 'todo' | 'project' | 'mindmap' | 'agent' | 'token'
 * @param {string} id   有值 ＝ 编辑，空 ＝ 新建（profile 无 id，永远只有一份资料）
 * @param {number} offset 0 ＝ L1 位；270 ＝ L2 位（底下压着列表抽屉）
 */
function buildRaw(mode, id, offset) {
  const ui = store.state.ui;
  const off = offset || 0;

  /* ★ 09-22 第四十二轮 · 我的页专项：个人资料走标准表单抽屉
     只有两项 —— 用户名（必填）＋ 头像（相册选图，空 ＝ 默认图标）。 */
  if (mode === 'profile') {
    const m = store.state.me;
    return {
      open: true, mode: 'profile', offset: off, id: '',
      title: '编辑资料',
      submitLabel: '保存',
      /* ⚠️ 哪怕不显示也得给个空串：组件 property 声明的是 String，
         传 undefined 会变成 null，控制台每条都刷 warn（"expected <String> but get null"）。
         profile / agent / token 三个 mode 都不带说明文案，所以都显式给 ''。 */
      hint: '',
      values: { name: m.name, avatar: m.avatar || '' },
      nodes: [], colors: [], urgencies: [], projects: [], mindmaps: [], agents: []
    };
  }

  if (mode === 'project') {
    const p = id ? store.projectById(id) : null;
    const pid = id || '';
    return {
      open: true, mode: 'project', offset: off, id: pid,
      title: p ? '编辑项目' : '新建项目',
      submitLabel: p ? '保存' : '创建项目',
      /* ★ 43 轮：抽屉里只留字段，不留解释文字 —— 全部 mode 的 hint 一律空串 */
      hint: '',
      values: {
        name: p ? p.name : '',
        node: p ? p.node : store.projectNodes()[0],
        agentId: p ? (p.agentId || '') : '',
        remark: p ? p.remark : '',
        color: p ? (p.color || '') : ''
      },
      nodes: nodeOptions(p ? p.node : store.projectNodes()[0]),
      agents: agentOptions(p ? p.agentId : ''),
      /* ★ 57 轮：把 pid 传下去 —— 被别家占用的色置灰；编辑时自己那一格除外 */
      colors: colorOptions(p ? p.color : '', pid),
      urgencies: [], projects: [], mindmaps: []
    };
  }

  if (mode === 'mindmap') {
    const m = id ? store.mindmapById(id) : null;
    const defPid = (m && m.projectId) || ui.projectId || (store.activeProjects()[0] || {}).id || '';
    /* ★ 本轮：脑图表单从"只能改名"扩成"改信息"（名称 ／ 所属项目 ／ 格式）。
       新建时格式默认 = `formats.DEFAULT_KEY`（思维导图）—— 用户口径「默认为标准脑图」。
       ⚠️ 默认值走 `store.formatKeyOf(null)` 而不是硬写 'mindmap'：默认格式将来挪窝，
          只要改 utils/formats.js 那一行，这里自动跟上。
       ★★ 280 轮：**编辑态必须原样读 `m.format`，不许过 `formatKeyOf()`** ——
          后者对空串会兜底成默认键，于是「完善脑图信息」抽屉里会替用户勾上
          「思维导图」，而库里他从来没选过这个格式。空串就让它**一个都不勾**。
       ★★ 2026-10-27（用户口径）：**没有「归属 agent」这一项** —— 脑图的 agent 由项目决定。
          所以 `values.agentId` 是 `store.projectAgentId(defPid)` 算出来的派生值，
          不读 `m.agentId`：那张图属于哪个 agent，永远由它**现在**所属的项目说了算
          （历史行里存着的旧值若与项目不一致，以项目为准，保存时自然被纠正）。
          `agents: []` 是有意的：这块表单不再需要选项数组，省掉每次 build 都造一遍。 */
    const curFmt = m ? String(m.format || '') : store.formatKeyOf(null);
    const curAgent = store.projectAgentId(defPid);
    return {
      open: true, mode: 'mindmap', offset: off, id: id || '',
      title: m ? '编辑脑图信息' : '新建脑图',
      submitLabel: m ? '保存' : '创建脑图',
      hint: '',
      values: { name: m ? m.name : '', projectId: defPid, format: curFmt, agentId: curAgent },
      projects: projectOptions(defPid),
      formats: store.mindmapFormatOptions(curFmt),
      /* 脑图表单没有 agent 选择器（见上）—— `o.agents` 留空数组，模板不再循环它 */
      agents: [],
      nodes: [], colors: [], urgencies: [], mindmaps: []
    };
  }

  /* ★ 09-22 第四十二轮 · agent ＝ 手填字段
     name / monthlyQuota（每月套餐额度）/ quotaResetAt（额度重置日）
     ❌ 不再有「设为当前 agent」（概念整体取消）、不再有备注、不再有厂家色
     ❌ 关联项目不在这里维护 —— 一个项目归属哪个 agent，在项目自己的表单里选
     ★★ 158 轮：**再删掉 `quotaLeft`（当前剩余 / 余额）** —— WorkBuddy / Trae 都没有取余额的
        API（157 轮口径），手填的数只会过期误导；157 轮先把两张 agent 卡上的那一格撤了，
        本轮把**输入项**也收掉。⇒ `values` 与提交补丁都不再带这个 key
        （`updateAgent` 走 `Object.assign`，不带 key 就**不动**老值 ⇒ 历史数据不被清空）。
        ⚠️ 数据层的 `quotaLeft` 字段本身还在（`store.addAgent` / 后端 DTO 都没动）——
           项目详情页 / 待办详情页的「当前剩余」那两格还在读它，要不要一起收见 `待拍板与遗留.md`。
     ★ 补：抽屉里只留字段、不留解释文字 —— 43 轮起这条对**全部六个 mode** 成立（hint 一律空串）
     ★ 补二：额度是**积分**（纯整数、无单位）
     ★★★ 133 轮：重置日**只剩「日」**—— 各家 agent 都按自然月重置，月份没有信息量。
       表单里是一个 1–31 的循环步进器，数据层是 `'01'`–`'31'` 两位串
       （解析 / 合成在 store 的 resetDayOf / joinResetDay；42 轮那代的 month 字段已删） */
  if (mode === 'agent') {
    const a = id ? store.agentById(id) : null;
    const rd = store.resetDayOf(a ? a.quotaResetAt : '') || store.nextResetDay();
    return {
      open: true, mode: 'agent', offset: off, id: id || '',
      title: a ? '编辑 agent' : '新建 agent',
      submitLabel: a ? '保存' : '创建 agent',
      hint: '',
      values: {
        name: a ? a.name : '',
        monthlyQuota: a ? a.monthlyQuota : '',
        resetDay: rd
      },
      nodes: [], colors: [], urgencies: [], projects: [], mindmaps: [], agents: []
    };
  }

  /* mode === 'token'（模型厂家 key · ★★ 2026-10-12 转真功能）
     字段只剩两个：**模型厂商**（只能选，见 `vendorOptions`）＋ **API Key**。
     ❌ 「当前剩余额度」整格删掉 —— 余额从本轮起由后端代查厂家接口回写，不是手填的。
     ⚠️ 编辑态**不回填 API Key**：服务端只存密文、只回掩码 ⇒ 这里必然拿不到明文。
        所以编辑时输入框留空，`hint` 告诉用户"留空 ＝ 不换 key"
        （`submit` 那边靠"空串就不传 `apiKey`"落实，不会把已有 key 清掉）。 */
  if (mode === 'token') {
    const k = id ? store.tokenKeyById(id) : null;
    const selVendor = (k && k.vendor) || (vendors.vendorList()[0] || {}).code || '';
    return {
      open: true, mode: 'token', offset: off, id: id || '',
      title: k ? '编辑 API' : '添加 API',
      submitLabel: k ? '保存' : '添加',
      /* ⚠️ 43 轮的硬约定：**抽屉里只留字段**，解释说明小字一律不进 `hint`。
         "留空 ＝ 不换 key"这句话改由输入框的 `placeholder` 承担（见 form-drawer.wxml）——
         它是输入控件自己的一部分，不是一段额外的小字。 */
      hint: '',
      values: {
        vendor: selVendor,
        apiKey: '',
        /* 只给编辑态用：让表单能显示「当前：sk-****4f2a」 */
        keyMask: k ? (k.keyMask || '') : ''
      },
      vendors: vendorOptions(selVendor),
      nodes: [], colors: [], urgencies: [], projects: [], mindmaps: [], agents: []
    };
  }

  /* mode === 'export'（★ 09-22 第四十五轮）
     把「原文 → 空行 → 关联脑图 Markdown」的拼接结果交给用户带走（FR-3.11）。
     它原来长在详情页里（一整块预览 ＋ 开关 ＋ 按钮），第四十五轮收进抽屉 ——
     详情页负责"看"，带走文本走抽屉。
     抽屉只带一个待办 id：预览文本由组件用 `store.copyTodoText()` **现算**
     （与复制按钮同一个纯函数 ⇒ 看到的＝复制到的），不在这里算，避免两处各算一遍。 */
  if (mode === 'export') {
    const t = id ? store.todoById(id) : null;
    return {
      open: true, mode: 'export', offset: off, id: id || '',
      /* ★ 279 轮：抽屉标题「适配 agent 文本」→「**待办导出**」（用户口径）。
         旧标题是第四十五轮从详情页搬过来时的原话，读起来像一句"关于这个功能的说明"，
         不像一颗入口的名字；而它下面现在挂了两颗键（复制 / 增强），标题要说的是
         "这是什么操作"，不是"这段文本给谁用"。 */
      title: '待办导出',
      submitLabel: '复制到剪贴板',
      hint: '',
      values: { todoId: t ? t.id : '', noImage: false },
      nodes: [], colors: [], urgencies: [], projects: [], mindmaps: [], agents: []
    };
  }

  /* mode === 'enhance'（★ 278 轮）—— 「信息增强」二层抽屉
     它是导出的**只读下游**：文本由页面下发（`enh-text`），这里只负责"壳"——
     标题、底部键文案、以及 `values.todoId`（`onCopy` 要靠它认出这条待办，去说
     "原文 ＋ 脑图"还是"只原文"那句 toast）。
     ⚠️ **不在这里算文本**：增强结果来自后端，不在任何本地纯函数里。
     ⚠️ 也不复用 `mode==='export'` 的 build：那张要 `expText`（预览），这张不要 ——
        混用会让「打开增强抽屉」顺手算一遍导出文本（白算一次，还可能带出旧值）。 */
  if (mode === 'enhance') {
    const t = id ? store.todoById(id) : null;
    return {
      open: true, mode: 'enhance', offset: off, id: id || '',
      title: '信息增强',
      submitLabel: '复制到剪贴板',
      hint: '',
      values: { todoId: t ? t.id : id || '', noImage: false },
      nodes: [], colors: [], urgencies: [], projects: [], mindmaps: [], agents: []
    };
  }

  /* mode === 'todo'（默认）
     ★★ 2026-10-23（247 轮）：`values` 里**只剩三个标准信息**（正文 / 紧急程度 / 归属项目）。
     用户口径见 form-drawer.wxml 文件头：「编辑弹窗还是主要管待办的正文、所属项目这两个
     标准信息」—— 图片与关联脑图搬去详情页编辑（那边能加能删、能关联能取消关联）。
     ⚠️ **别顺手把 `images` / `mindmapId` 加回 `values` "反正提交时也不会动"**：
        它们一旦出现在 `v` 里，就会参与 `isDirty()`（用户什么都没改也被问「放弃填写？」），
        也会被 `put()` 的整份 `Object.assign` 一路带着走 —— 想让表单不碰某个字段，
        最省心的写法就是**让它压根不在 `v` 里**。 */
  const t = id ? store.todoById(id) : null;
  const defPid = (t && t.projectId) || ui.projectId || (store.activeProjects()[0] || {}).id || '';
  const defUrgency = (t && t.urgency) || 'mid';
  return {
    open: true, mode: 'todo', offset: off, id: id || '',
    title: t ? '编辑待办' : '记一条待办',
    submitLabel: t ? '保存' : '保存待办',
    hint: '',
    values: {
      text: t ? t.text : '',
      urgency: defUrgency,
      projectId: defPid
    },
    urgencies: urgencyOptions(defUrgency),
    projects: projectOptions(defPid),
    /* ★ `mindmaps` 这一项**保留**（表单已不渲染它）：`form-drawer` 的 property 与 observers
       里还有它，删掉就要同步改三处（property / observer 键串 / 五个模块的透传），
       而"多传一个没人用的空数组"没有任何代价。 */
    mindmaps: mindmapOptions((t && t.mindmapId) || ''),
    nodes: [], agents: [], colors: []
  };
}

/**
 * 表单数据的出口 —— ★ 本轮把「补空字段」从**七个分支各写一遍**收成一处。
 *
 * 为什么要补：`form-drawer` 的 property 都声明了类型（Array / Object），
 * 传到的是 `undefined` 会变成 `null`，控制台每条都刷 warn，而且 `wx:for` 直接报错。
 * 原来七个 mode 各在自己那段里手写一遍 `nodes: [], agents: [], colors: []`，
 * 结果**每次加字段都要改七处**（56 轮加 `colors` 时就是这么过来的），漏一处只在
 * 打开那个 mode 时才炸。现在只留这一张"必填清单"。
 *
 * ⚠️ 新增一个表单字段仍然要改**三处**：
 *    ① `closed()`（抽屉关着时的初值）② 下面这张清单（若它有默认空值）③ `form-drawer` 的模板。
 *    各页 wxml 的透传是在 `mod-*.wxml` 里加一个 `xxx="{{form.xxx}}"`，与 mode 无关。
 */
const FORM_ARRAYS = ['nodes', 'colors', 'urgencies', 'projects', 'mindmaps', 'agents', 'formats', 'vendors'];

function build(mode, id, offset) {
  const f = buildRaw(mode, id, offset);
  FORM_ARRAYS.forEach(function (k) { if (!f[k]) f[k] = []; });
  if (!f.values) f.values = {};
  return f;
}

/* ---------------- 提交 ---------------- */

/**
 * 额度是**积分**（★ 42 轮·补二）—— 提交时收一道口子：
 * 能抠出数字就取整（'1,240.6' → '1240'、'¥ 500.00' → '500'），
 * 抠不出（'已用完' 这类）就原样留着，不做破坏性处理。
 */
function intOf(s) {
  const str = String(s == null ? '' : s).trim();
  if (!str) return '';
  const m = /-?\d+(?:\.\d+)?/.exec(str.replace(/,/g, ''));
  return m ? String(Math.round(Number(m[0]))) : str;
}

/**
 * @returns {string} 受影响对象的 id（新建时是新 id）
 */
function submit(mode, id, v) {
  /* ★ 45 轮：导出抽屉不改任何数据 —— 它的「复制到剪贴板」由组件自己落剪贴板，
     这里必须**早退**，否则会掉进下面的 todo 兜底分支把数据写坏。
     ★ 278 轮：`enhance` 同理，而且更严格 —— 增强结果是"带走的一份文本"，**永不入库**
       （P-5：一次会话内的加工，不该产生新数据）。它连预览文本都不归这里管。 */
  if (mode === 'export' || mode === 'enhance') return id || '';
  if (mode === 'profile') {
    store.updateMe({ name: v.name, avatar: v.avatar || '' });
    return '';
  }
  if (mode === 'project') {
    if (id) { store.updateProject(id, { name: v.name, node: v.node, agentId: v.agentId || null, remark: v.remark, color: v.color || null }); return id; }
    return store.addProject({ name: v.name, node: v.node, agentId: v.agentId || null, remark: v.remark, color: v.color || null });
  }
  if (mode === 'mindmap') {
    /* ★ 本轮：编辑态从 `renameMindmap`（只管名字）换成 `updateMindmap`（可选补丁）——
       项目与格式也要能改，而 renameMindmap 会把项目名丢在原处不动。
       ⚠️ 三个字段一起传：表单里它们是同一次编辑的三项，用户没动的那两项值也没变，
          传回去等于什么都没做（updateMindmap 只在 `!== undefined` 时写），但会刷 updatedAt ——
          这是**有意**的（"改信息也是一次动过"，列表按更新时间倒序，它该往上跳）。 */
    /* ★★ 2026-10-27（用户口径）：**归属 agent 由项目推导** —— 提交时按 `projectId` 现算。
       ⚠️⚠️ **不要写 `|| v.agentId`**（这里原来有一版就是这么写的，是个真 bug）：
          user 把脑图从"项目 A（绑了 agent X）"换成"项目 B（没绑 agent）"时，
          `projectAgentId(B)` 返回空串 ⇒ 兜到 `v.agentId`（build 那一帧按 A 算的 X）
          ⇒ 把 A 的 agent 写到 B 名下的脑图上，正好造出这条规则要消灭的那种矛盾数据。
          项目没绑 agent ⇒ 这张图就该是"没 agent"，**没有第二种解释**。
       ⚠️ 与后端 `create` / `update` 那条推导是**同一条规则**、各写一次 —— 谁漏了都不会
          造出"项目是 A、agent 是 B"的矛盾数据（以项目为唯一真源）。 */
    const mmAgent = store.projectAgentId(v.projectId);
    if (id) {
      /* ★★ 280 轮：第四个字段 `agentId`。`updateMindmap` 是"有才写"，
         但这四项是同一次编辑的四项，一起传语义最清楚。 */
      store.updateMindmap(id, { name: v.name, projectId: v.projectId, format: v.format, agentId: mmAgent });
      return id;
    }
    return store.addMindmap(v.projectId, v.name, v.format, mmAgent);
  }
  if (mode === 'agent') {
    /* ★ 158 轮：补丁里**不再有 `quotaLeft`** —— 表单已删那一格（拿不到余额 API）。
       `updateAgent` 是 `Object.assign`，不带这个 key ⇒ 老值原样留着，不会被清成空串。 */
    const patch = {
      name: v.name,
      monthlyQuota: intOf(v.monthlyQuota),
      /* 表单里是「每月几号」这一个整数 ⇒ 拼回数据层的 'DD'（会夹进 1–31） */
      quotaResetAt: store.joinResetDay(v.resetDay)
    };
    if (id) { store.updateAgent(id, patch); return id; }
    return store.addAgent(patch);
  }
  if (mode === 'token') {
    /* ★★ 2026-10-12：两个字段一起走 —— `vendor` 是厂商标识（白名单里的 code），
       `apiKey` 是**明文**（后端加密入库）。
       ⚠️⚠️ `apiKey` 空串一律**不放进 patch**：`store.updateTokenKey` / 后端 DTO 都是
          "`undefined` ＝ 不动它"的语义。若在这里传个空串过去，
          保存一次「只改厂商」就会把用户已有的 key 清掉（下次进页面查不到余额，
          而用户根本没动过那一格）—— 这是本轮最容易写错的一处。 */
    const patch = { vendor: v.vendor };
    if (String(v.apiKey || '').trim()) patch.apiKey = String(v.apiKey).trim();
    if (id) { store.updateTokenKey(id, patch); return id; }
    return store.addTokenKey(patch);
  }
  /* todo
     ★★ 2026-10-23（247 轮）：**只有表单真的带了某个键，才把它写进补丁**。
     ── 为什么必须这么写（这是本轮最容易埋雷的一处）：
        待办表单 247 轮起不再编辑图片与关联脑图，`values` 里也就没有这两个键。
        若照旧写 `images: v.images || []` / `mindmapId: v.mindmapId || null`，
        **编辑保存一次就会把已入库的图片清空、把已关联的脑图解掉** —— 而且界面上
        什么都看不出来（表单里压根不显示这两样），下次进详情页才发现图没了。
     ── 用 `!== undefined` 而不是 `v.images ?` ：空数组是**合法的值**（"删光了"），
        不能被当成"没传"；而 `undefined` 才是"这一份表单不管这件事"。
     ── 反过来说：删掉 `images` 这个字段的**能力**还在（store / 后端都没动），
        只是现在没有任何 UI 会传它 —— 详情页的图片增删走 `mod-todo.applyImages()` 那条路。 */
  const patch = { text: v.text, urgency: v.urgency, projectId: v.projectId };
  if (v.mindmapId !== undefined) patch.mindmapId = v.mindmapId || null;
  if (v.images !== undefined) patch.images = v.images || [];
  if (id) {
    store.updateTodo(id, patch);
    return id;
  }
  return store.addTodo(patch);
}

/* ================= 页面侧控制器（各页共用，避免五份重复逻辑） ================= */

/**
 * 嵌套新建的表单暂存：在待办表单里点「＋ 新建项目 / ＋ 新建脑图」时记下待办草稿。
 *
 * ★★ 2026-10-24（复审 P1-05）：**从模块级单槽改成挂在页面实例上（`page._nested`）**。
 * ── 病根：五个模块是**常驻**的（壳页只切 `display`），而这份暂存原来全工程只有一份。
 *    在待办里打开「新建项目」→ 切到别的模块 → 在那个模块里开另一张表单，
 *    `open()` 会把它清空；可待办那边**两层 UI 还留在屏上**（它只是 display:none），
 *    等用户切回去提交子表单时，`nested` 已经是 null ⇒ 走普通关闭分支，
 *    **父草稿再也回不来**（用户看到的是"填了一半的待办连同新建的项目一起没了"）。
 * ── 现在：谁的表单谁记 —— `open()` / `openNested()` / `submitOn()` / `cancelOn()`
 *    都只读写 `page._nested`，跨模块互不干扰。
 * ⚠️ 仍然**不进 `data`**：它不参与渲染，进 data 只会白多一轮 setData，
 *    还会被 `setData` 的深拷贝语义无意改掉引用。
 */
function nestedOf(page) { return (page && page._nested) || null; }
function setNested(page, v) { if (page) page._nested = v; }

/**
 * 把 preset 回填抽成一处（★ 49 轮）—— `open()` 与**嵌套层**共用同一套。
 * ⚠️ 只改 `values` 是不够的：选项数组里的 `selected` 是 build 时算好的，
 *   values 变了不同步重算，界面上打勾的还是旧的那一项。
 */
function withPreset(f, preset) {
  if (!preset) return f;
  f.values = Object.assign({}, f.values, preset);
  if (f.mode === 'todo') {
    if (preset.projectId !== undefined) f.projects = projectOptions(preset.projectId);
    if (preset.mindmapId !== undefined) f.mindmaps = mindmapOptions(preset.mindmapId);
    if (preset.urgency !== undefined) f.urgencies = urgencyOptions(preset.urgency);
  }
  if (f.mode === 'mindmap') {
    if (preset.projectId !== undefined) {
      f.projects = projectOptions(preset.projectId);
      /* ★★ 2026-10-27：**归属 agent 不是"预设字段"，而是项目的派生值** ——
         预设里换了项目，agent 必须跟着换（同一个 `put`/同一次赋值里定下来，不留中间态）。
         原来这里有一行 `if (preset.agentId !== undefined) f.agents = agentOptions(...)`，
         随「脑图表单不再选 agent」一起撤掉了。 */
      f.values.agentId = store.projectAgentId(preset.projectId);
    }
    /* ★ 本轮：格式也能被预填（嵌套新建脑图时由上层带下来）—— 与项目同一套写法，
       否则界面上打勾的仍是「思维导图」，提交时却把 preset 的值写进去，读起来自相矛盾。 */
    if (preset.format !== undefined) f.formats = store.mindmapFormatOptions(preset.format);
  }
  if (f.mode === 'project') {
    if (preset.node !== undefined) f.nodes = nodeOptions(preset.node);
    if (preset.agentId !== undefined) f.agents = agentOptions(preset.agentId);
    /* ⚠️ 色表要带 `f.id`（编辑态才有）—— 否则编辑时自己那个色也会被算成"已被占用" */
    if (preset.color !== undefined) f.colors = colorOptions(preset.color, f.id);
  }
  return f;
}

/**
 * 打开表单抽屉
 * @param {object} page  Page 实例（需要 setData）
 * @param {string} mode  'profile' | 'todo' | 'project' | 'mindmap' | 'agent' | 'token'
 * @param {string} id    有值 ＝ 编辑，空 ＝ 新建
 * @param {object} opts  { offset: 0 ＝ L1 位 ／ 270 ＝ L2 位, preset, requireAll }
 *   ★★ 280 轮新增 `requireAll`：**"完善态"**（＝语义转脑图生成出来的卡，字段没填全）。
 *   一个开关同时管三件事，缺一件就是一个坑（§5.5）：
 *     ① 标题换「完善脑图信息」、主键「保存」
 *     ② `form-drawer.valid()` 追加**格式**必填
 *     ③ 不渲染「删除这张脑图」—— 走 `noDanger`，**不是**传空 `dangerLabel`：
 *        那颗键的 `wx:if` 只认 `mode`，空文案根本藏不住（279 轮 `wx:else` 那类"静默改判"）
 *   ★ 2026-10-27：原来还有第 ④ 件「agent 选项去掉『不关联』」—— 脑图表单已不再有 agent 这一项
 *     （agent 由项目决定），这一件随之作废。
 *   ⚠️ 其余行为一个字不动 —— **既有「编辑脑图信息」的能力不许被这道开关削掉**。
 */
function open(page, mode, id, opts) {
  const offset = (opts && opts.offset) || 0;
  /* ★ 49 轮补的一处旧漏：普通打开表单 = 清掉可能残留的嵌套暂存。
     嵌套态只由 openNested 置上、只由「提交二级 / 取消」清掉；
     若中途走的是别的路径（例如从列表抽屉点一条直接开表单），旧的 nested 会留到下一次提交，
     让一个**独立**的表单被当成"嵌套的二级"处理（拿回到一张莫须有的待办表单上）。
     ★ 2026-10-24：只清**本页**那份（`page._nested`）—— 别的模块正开着嵌套也不受影响。 */
  setNested(page, null);
  const f = withPreset(build(mode, id, offset), opts && opts.preset);
  page.setData({ form: applyFlags(f, opts) });
}

/**
 * ★★ 280 轮：两个"开关"键的**唯一写入口**（`open` / `backToParent` 共用）。
 *
 * 为什么要收成一处：这两颗键决定"这张表单是不是完善态"，而**每条**造表单的路径
 * 都会经过它 —— 少给一条，那条路径上要么必填悄悄松掉、要么删除键忽然冒出来。
 * 而且 `undefined` 传给 Boolean property 会变 null 并在控制台刷 warn（文件顶那条注释）。
 *
 * @param {object} f     已经 build 好的表单对象
 * @param {object} [opts] `{ requireAll }`；`noDanger` 跟着 `requireAll` 走（完善态没有删除）
 */
function applyFlags(f, opts) {
  f.requireAll = !!(opts && opts.requireAll);
  f.noDanger = f.requireAll || !!(opts && opts.noDanger);
  if (f.requireAll) {
    f.title = '完善脑图信息';
    f.submitLabel = '保存';
    /* ★★ 2026-10-27：agent 改由项目派生 ⇒ 这里只是**校一次**（`withPreset` / 回填可能刚动过
       `projectId`，而 `values.agentId` 是 build 时算的）。
       ⚠️ 原来这里有一行 `f.agents = agentOptions(..., true)`（完善态不给「不关联」那一行）——
          脑图表单已经**没有 agent 选择器**了，那行随它一起撤掉。 */
    if (f.mode === 'mindmap') f.values.agentId = store.projectAgentId(f.values && f.values.projectId);
  }
  return f;
}

/**
 * 嵌套新建（★ 45 轮：项目；★ 49 轮推广到脑图）——
 * 在待办表单里点「＋ 新建项目 / ＋ 新建脑图」，**在右侧开第二个表单抽屉**（`form2`）。
 *
 * 45 轮之前是「就地替换」：待办表单直接变成项目表单，用户填了一半的内容靠 `nested` 暂存、
 * 建完项目再还原。问题是替换那一瞬间看不出「我从哪来、建完回哪去」。
 * 现在改成两级并排 —— 待办表单留在 L1 并**侧转**（rotateY 25° ＋ 不可点），新建表单落在 L2；
 * 建完 / 取消都回到待办表单，草稿原样保留。观感与「项目列表抽屉 → 新建项目」完全一致。
 *
 * ⚠️ 竖屏只有 800 宽：一级 320 并上二级右移 270 已占到 x606，再并一级就出屏了。
 *    所以**竖屏、且待办表单已经在 L2 位上**时，退回旧的「就地替换」，这是空间限制下的兜底。
 *
 * @param {string} kind    'project' | 'mindmap' —— 决定建完回填父表单的哪个字段
 * @param {object} values  待办表单当前草稿（组件在 newproject / newmindmap 事件里带出）
 * @param {string} mode    父表单的 mode（现在都是 'todo'）
 * @param {string} id      父表单正在编辑的那条 id（新建时为空）
 * @param {number} offset  父表单当前落在哪一档（0 / 270）
 * @param {object} preset  二级表单的预填（建脑图要把待办已选的归属项目带过去）
 */
function openNested(page, kind, values, mode, id, offset, preset) {
  const cur = offset || 0;
  const two = !(!page.data.landscape && cur > 0);
  /* ★★ 280 轮：把**父层**的开关一并存进暂存 —— 二级建完 / 取消要回到父层，
     而父层可能是完善态（「完善脑图信息」里也有「＋ 新建项目」）。
     不存的话回来就变成普通编辑态（删除键冒出来、必填松掉）。 */
  const parentFlags = { requireAll: !!(page.data.form && page.data.form.requireAll) };
  setNested(page, {
    kind: kind, mode: mode || 'todo', id: id || '', offset: cur,
    values: values || null, two: two, requireAll: parentFlags.requireAll
  });
  /* ★★ 2026-10-22：二级表单要带上 `child: true`（父草稿要不要还原、取消要不要问，都看它）——
     两级并排与竖屏替换式**两条路都带**，否则其中一条会退回"取消即丢弃"的老行为。
     ★★ 280 轮：二级本身永远是**新建**表单（不是完善态）⇒ 开关显式给 false。 */
  if (two) {
    const f2 = withPreset(build(kind, '', cur + 270), preset);
    f2.child = true;
    page.setData({ formTurned: true, form2: applyFlags(f2, null) });
    return;
  }
  const f = withPreset(build(kind, '', cur), preset);
  f.child = true;
  page.setData({ form: applyFlags(f, null) });
}

/** 待办表单 → 「＋ 新建项目」 */
function openNestedProject(page, values, mode, id, offset) {
  openNested(page, 'project', values, mode, id, offset, null);
}

/**
 * 待办表单 → 「＋ 新建脑图」（★ 49 轮）—— 与建项目走同一条机制。
 * ⚠️ `preset` 只在待办**已经选了归属项目**时传：脑图的「所属项目」是必填，
 *    传空串会把 build 里算好的默认项目抹掉（那一版连提交都过不去）。
 *    这个判断放在 **pagebase**，这里只负责透传。
 */
function openNestedMindmap(page, values, mode, id, offset, preset) {
  openNested(page, 'mindmap', values, mode, id, offset, preset);
}

/**
 * 导出抽屉 → 「信息增强」二层（★ 278 轮）。
 *
 * 用户口径：点「增强」后**在右侧再弹一张主弹窗样式**的抽屉，左侧那张变成
 * 「不可点击的旋转示意态」—— 与 45 轮「待办表单 → 新建项目」是**同一套几何**：
 * `formTurned` 让 L1 侧转不可点，`form2` 落在 `cur + 270`（实测 354 / 286 那一档）。
 * ⇒ 一个新 px 都不用写，判据 E9 守的也是这条（`enh-*` / `.sd-alt` 里不许出现 `left:` / `width:`）。
 *
 * ★★ 与 `openNested` 的两处**刻意不同**：
 *   ① **恒并排**（不走"竖屏空间不足 ⇒ 就地替换"那条兜底）。原因：替换式会让导出抽屉**消失**，
 *      而这张二层的意义正是"和原文对照着看"。何况父层在 L1（offset 0）时
 *      320 ＋ 270 ＝ 590 < 750，竖屏也放得下。
 *   ② **不传 `values` 给父层回填**（只带 `todoId` 让 `onCopy` 认得这条待办）。
 *      增强不改任何字段，没有"回填"这回事 —— 见 `forms.submit('enhance')` 的早退。
 *
 * @param {string} todoId 这条待办的 id（`onCopy` 靠它决定 toast 说"原文＋脑图"还是"只原文"）
 * @param {number} offset 父层（导出抽屉）当前落在哪一档
 */
function openNestedEnhance(page, todoId, offset, noImage) {
  const cur = offset || 0;
  setNested(page, {
    kind: 'enhance',
    mode: 'export',
    id: todoId || '',
    offset: cur,
    /* ★★ 2026-10-27（全量检查 F13）· **「不含图片」要跟着父层走**。
       改前这里写死 `noImage: false`，于是"首次勾了不含图片 → 失败 → 重试"
       会改用带图的正文（重试发的就是这张子层自己的 values），
       与左边那份预览不一致。现在由调用方把父层当前值传进来；
       重试时 `mod-todo` 会取它自己记下的原值（不再读子层）。 */
    values: { todoId: todoId || '', noImage: !!noImage },
    two: true
  });
  const f2 = build('enhance', todoId, cur + 270);
  f2.child = true;
  page.setData({ formTurned: true, form2: applyFlags(f2, null) });
}

/** 当前处在最上层的表单 —— 嵌套建项目时最上层是 form2，其余情况都是 form */
function topForm(page) {
  const f2 = page.data.form2;
  return (f2 && f2.open) ? f2 : page.data.form;
}

/**
 * 回到父表单 —— **嵌套二级提交 / 取消共用的唯一出口**（审查 P1-07 抽出）。
 *
 * 为什么必须共用：提交二级时要回填新建出来的 id，取消二级时**什么都不回填**，
 * 但两者对父表单做的事**完全一样** —— 用 `build()` 重新装一遍父层，再把草稿盖回去，
 * 并按新 values 重算那三张"带选中态"的选项表（`selected` 是 build 时算好的，
 * 只改 values 不重算 ⇒ 界面上打勾的还是旧那一项，用户会以为没回来）。
 *
 * @param {object} back   `nested` 那份暂存（`{mode, id, offset, values}`）
 * @param {object} [patch] 要回填的字段（建完项目/脑图时用；取消时不传）
 */
function backToParent(back, patch) {
  const v = Object.assign({}, (back && back.values) || {}, patch || {});
  const next = build(back.mode, back.id, back.offset);
  next.values = v;
  if (next.mode === 'todo') {
    next.urgencies = urgencyOptions(v.urgency);
    next.projects = projectOptions(v.projectId);
    next.mindmaps = mindmapOptions(v.mindmapId);
  }
  /* ★★ 2026-10-23（本次顺手补齐的一处既有漏）：**脑图表单的父层也要重算**。
     ── 漏的是什么：`build('mindmap')` 里 `projects` 的选中态是按 `defPid`（默认项目）
        算的，而 `next.values` 已经被 patch 盖成新的 `projectId`。只改 values 不重算选项
        ⇒ 界面上的勾还停在旧项目上，提交的却是新项目（"看到的≠存下的"）。
        这条路径 ＝ 脑图表单里点「新建项目」→ 建完回到脑图表单（`openNested` 的 kind=project、
        mode=mindmap）—— 45 轮做项目嵌套时它只覆盖了 todo，脑图是 49 轮才接进来的，一直漏着。
     ── `format` 一并重算：与 49 轮那条"选项数组里的 selected 是 build 时算好的"同一条纪律。 */
  if (next.mode === 'mindmap') {
    next.projects = projectOptions(v.projectId);
    next.formats = store.mindmapFormatOptions(v.format);
    /* ★★ 2026-10-27：agent 跟着项目重算 —— 从「＋ 新建项目」回来时项目已经换了新的，
       agent 必须一起换（原来这行是 `next.agents = agentOptions(v.agentId)`，
       随「脑图表单不再选 agent」一遍撤掉）。 */
    next.values.agentId = store.projectAgentId(v.projectId);
  }
  /* ★★ 280 轮：父层如果是**完善态**，回来时还得是完善态 —— 否则用户在「完善脑图信息」
     里点了「＋ 新建项目」，建完（或取消）回到父层就变成「编辑脑图信息」：
     删除键冒出来、必填松掉、标题也换了。开关跟着 `nested` 那份暂存走（见 openNested）。 */
  return applyFlags(next, { requireAll: !!(back && back.requireAll) });
}

/**
 * 提交：写库 → 关抽屉 → 回调页面刷新
 * @returns {string} 受影响对象的 id
 */
/**
 * 提交当前表单（唯一的收口：校验 → 落库 → 收面板 → 回调）。
 *
 * @param {object} page 组件实例
 * @param {object} values 表单值
 * @param {Function} [after] 收完面板后的回调
 * @param {Function} [intercept] ★ 本轮新增（可选）—— **替换"落库"这一步**。
 *   `(mode, id, values) => ({id}) | null`：返回带 `id` 的对象即视为已落库；
 *   返回 `null` / `undefined` 则走原本的 `store` 通用写入。
 *   ★ 存在的唯一理由：**胶囊转待办必须走原子接口**（技术文档 §6.7）——
 *     "先 `addTodo` 再 `removeCapsules`"是两次独立请求，建待办失败而删气泡成功时
 *     那段口播就被无声地扔掉了。只有胶囊这一处会传它，其余调用方一个字都没变。
 */
function submitOn(page, values, after, intercept) {
  const f = topForm(page);
  let id;
  const hit = intercept ? intercept(f.mode, f.id, values) : null;
  if (hit && hit.id) id = hit.id;
  else id = submit(f.mode, f.id, values);

  /* ★★ 278 轮：`enhance` 的"提交"就是**复制**（组件里已经落完剪贴板），
     这里只负责把它收掉、回到左侧的导出抽屉。
     ⚠️ 必须在下面的嵌套回填**之前**早退：`openNestedEnhance` 也走 `_nested`，
        而回填逻辑认的是"kind 与 mode 相等"（`'enhance' === 'enhance'` 会命中），
        一旦落进去就会拿 `{ projectId, mindmapId }` 去 patch 一张导出抽屉 ——
        那是把待办表单的回填规则套到了预览抽屉上。 */
  if (f.mode === 'enhance') {
    setNested(page, null);
    page.setData({ form2: closed(), formTurned: false });
    if (after) after();
    return id;
  }

  /* 嵌套场景（★ 49 轮起 项目 / 脑图 两种都走这里）：
     刚建完二级 → 回到原来的待办表单，新建出来的那条**预选上**、草稿原样保留。
     · 建的是项目 ⇒ 回填 `projectId`，同时把 `mindmapId` 清掉 ——
       43 轮定过「归属项目一变，原来关联的脑图就悬空了」，这里换项目走的是同一条规则
       （此前只有组件里的 onPickProject 会清，绕过组件这条路径漏了）。
     · 建的是脑图 ⇒ 回填 `mindmapId`，并把脑图选项表重算，否则标题查不到名字、
       那一行还是「请选择」。 */
  const back0 = nestedOf(page);
  if (back0 && f.mode === back0.kind) {
    const back = back0;
    setNested(page, null);
    const patch = back.kind === 'mindmap'
      ? { mindmapId: id }
      : { projectId: id, mindmapId: '' };
    /* ★★ 2026-10-22：父层组装收进 `backToParent()`（与取消那条路**同一份**） */
    const next = backToParent(back, patch);
    /* two ＝ 两级并排：收掉二级（项目/脑图表单）、一级转回来；
       否则是竖屏空间不足的「就地替换」，同一个槽位直接覆盖即可。 */
    page.setData(back.two
      ? { form: next, form2: closed(), formTurned: false }
      : { form: next });
    if (after) after();
    return id;
  }

  const closing = { form: closed() };
  if (page.data.form2) { closing.form2 = closed(); closing.formTurned = false; }
  page.setData(closing);
  if (after) after();
  return id;
}

/**
 * 取消 —— **三种情形，两个去向**：
 *
 *   ① 二级开着（两级并排，`form2`）⇒ 只收二级、一级待办表单转回来，草稿原样保留；
 *   ② **竖屏替换式嵌套**（只有一个槽位，二级把一级顶掉了）⇒
 *      ★★ 2026-10-22 修（审查 P1-07，只读测试已复现）：**把父草稿还原回来**。
 *      改前这里只有 `nested = null` ＋ `form: closed()` —— 于是"待办表单里点＋新建项目，
 *      再点取消"把**整张待办表单连草稿一起关掉**（测试实测 `open=false, values=null`）。
 *      用户的读法永远是"我取消的是新建项目"，不是"我放弃那条待办"。
 *   ③ 普通表单 ⇒ 收掉（`child` 为假的那一层，是否防手滑由组件问「放弃填写？」）。
 *
 * ⚠️ 别把 ② 的还原写成"重新 open 一次"（`open()` 会清 `nested`、还会重置 offset）——
 *    那就是本函数正在做的这件事，绕一圈只会多一次 setData 和一个丢草稿的机会。
 */
function cancelOn(page, after) {
  /* ★ 45 轮：二级（嵌套建项目）开着时，取消**只收二级**，回到一级的待办表单 —— 草稿还在 */
  const f2 = page.data.form2;
  if (f2 && f2.open) {
    setNested(page, null);
    page.setData({ form2: closed(), formTurned: false });
    if (after) after();
    return;
  }
  /* ★★ 2026-10-22：替换式嵌套（②）—— 还原父表单与它的草稿 */
  const back = nestedOf(page);
  if (back) {
    setNested(page, null);
    page.setData({ form: backToParent(back) });
    if (after) after();
    return;
  }
  setNested(page, null);
  page.setData({ form: closed() });
  if (after) after();
}

module.exports = {
  build: build, submit: submit, closed: closed,
  open: open,
  openNestedProject: openNestedProject, openNestedMindmap: openNestedMindmap,
  /* ★★ 278 轮：「导出 → 信息增强」二层（另一套回填规则，见函数注释） */
  openNestedEnhance: openNestedEnhance,
  submitOn: submitOn, cancelOn: cancelOn
};


