/**
 * 脑图 ⇄ Markdown 序列化 —— FR-7.5（单独导出）与 FR-3.13（随待办复制）
 *
 * 三条硬约束（FR-7.5）：
 *   ① 导出只读、不改动脑图（纯函数：树 → 文本）
 *   ② 文本保真：节点文字原样输出，不改写、不补全、不加序号
 *   ③ 不做智能润色、不重排、不加引导语
 */

/** 节点 → 一行标题（按层级映射 # / ## / ### …） */
function heading(level, text) {
  const hashes = '#'.repeat(Math.min(level + 1, 6));   // 一级子节点 → ##
  return hashes + ' ' + text;
}

/**
 * 整棵树 → Markdown
 * @param {object} root   根节点
 * @param {object} opt
 *   opt.root   是否输出根节点（单独导出默认 false；随待办复制默认 true）
 *   opt.tasks  是否用待办清单格式 `- [ ]`
 *   opt.placeholder 是否输出前瞻占位节点（默认输出）
 *   opt.meta   是否附带任务元信息（默认不带）
 */
function treeToMarkdown(root, opt) {
  opt = opt || {};
  const outRoot = !!opt.root;
  const lines = [];

  function walk(node, mdLevel) {
    // 层级映射：超过 6 层退化为无序列表缩进（保证信息不丢）
    if (mdLevel <= 5) {
      lines.push(heading(mdLevel, node.text));
      if (node.remark) lines.push('');
      if (node.remark) lines.push(node.remark);
      if (opt.meta && node.task) lines.push('> ' + node.task);
      lines.push('');
    } else {
      const indent = '  '.repeat(mdLevel - 5);
      lines.push(indent + (opt.tasks ? '- [ ] ' : '- ') + node.text);
      if (node.remark) lines.push(indent + '  ' + node.remark);
    }
    (node.children || []).forEach(function (c) { walk(c, mdLevel + 1); });
  }

  if (outRoot) walk(root, 0);
  else (root.children || []).forEach(function (c) { walk(c, 1); });

  // 收紧多余空行
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * alt 文本净化 —— 图片说明要能安全地塞进 `![…](…)` 的方括号里。
 *
 * 两个真会破语法的字符：
 *   · `[` / `]` —— 方括号是图片语法的定界符，说明里带一个 `]` 就能把整行截断
 *     （用户的图片说明是自由文本，OCR 出来的内容里带括号很常见）；
 *   · 换行 —— 图片语法必须在一行内，换行会把后面的内容甩出语法。
 * 处理方式：换行压成空格、方括号转义。**不改写语义**，只做语法逃生。
 */
function altText(s, fallback) {
  const t = String(s == null ? '' : s)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\[|\]/g, function (m) { return '\\' + m; })
    .trim();
  return t || fallback;
}

/**
 * 复制待办 —— FR-3.13
 * 输出结构：待办原文（含图片）→ 空行 → 该脑图序列化出的 Markdown
 *           → 空行 → 关联的闪念胶囊（★★ 250 轮）
 * 协同场景下：根节点默认输出、整棵树不裁剪、追加而非融合（不去重、不改写）
 *
 * @param opt.capsules  关联在这条待办上的胶囊（**数组**）。
 *   每一项可以是三种写法，都要认（判据与老调用方各自在用其中一种）：
 *     · 纯字符串 ＝ 只要正文（250 轮的老形态）；
 *     · `{ text }` ＝ 正文；
 *     · `{ text, uri }` ＝ 正文 ＋ 挂的那张图（**277 轮**：`uri` 是库里存的**相对 uri**，
 *       由 `resolveHref` 拼成完整地址，与本函数对待待办图片的那条路完全一致）。
 *   由调用方从数据层挑好再传进来 —— 本文件不认识 store，也不认识 `todoId` 反查；
 *   传空数组/不传 ＝ 这一段整段不出现（既有调用方一个字都不用改）。
 * @param opt.imageUrl  图片地址解析器 `(uri) => href`。
 *   **默认恒等** —— 本文件保持零依赖、纯函数、可离线单测（改 `--mutate` 全靠这条）。
 *   真实调用方 `store.copyTodoText()` 注入 `api.fileUrl`，把库里存的**相对 uri**
 *   （`2026/10/ab12.jpg`）拼成完整 URL；不注入就是死链（225 轮修）。
 *   传 `null` = 明确"别解析，按库里存的吐"。
 */
function todoToMarkdown(todo, mindmapRoot, opt) {
  opt = opt || {};
  const parts = [];
  const resolveHref = (typeof opt.imageUrl === 'function')
    ? opt.imageUrl
    : function (x) { return x; };

  // ① 待办原文（原样，一个字不改）
  let body = todo.text || '';
  if (!opt.noImage && todo.images && todo.images.length) {
    const lines = [];
    todo.images.forEach(function (im, i) {
      /* ⚠️ 图片在数据层是**对象**（{ id, label, uri }），只有早期种子/外部数据
         才是裸链接串。按"是不是对象"分流，**不能按 uri 是否为空来判**：
         `form-drawer` 里上传中的占位图就是 `{ uri: '' }`，用 falsy 判断会退回
         对象本身，最后拼出 `![相册图片 1](https://…/files/[object Object])`
         —— 既不是死链也不是图，是**坏语法**（225 轮判据 A17 抓到的）。 */
      const raw = (im && typeof im === 'object') ? im.uri : im;
      if (!raw) return;                       // 没有地址 ⇒ 不产出坏语法
      const href = String(resolveHref(raw) || raw);
      /* ★ 225 轮：`label` 保真 —— 原来是硬编码的「图片N」，把详情页里那句
         「识别失败截图」这种说明整个丢掉。现在优先用 label，没有才退回序号。 */
      lines.push('![' + altText(im && im.label, '图片' + (i + 1)) + '](' + href + ')');
    });
    if (lines.length) body += '\n\n' + lines.join('\n');
  }
  parts.push(body);

  // ② 关联脑图（追加，不融合）
  if (mindmapRoot) {
    parts.push(treeToMarkdown(mindmapRoot, { root: true, tasks: false }));
  }

  /* ③ 关联的闪念胶囊（★★ 250 轮）
   *
   * 用户口径（2026-10-23）：「**胶囊信息还能合并到待办中进行导出**」。
   *
   * ── 三个决定，动之前先读 ────────────────────────────────────────────
   * ① **追加在脑图之后，不动既有两段的先后**：这个函数的纪律是"追加而非融合"
   *    （不去重、不改写、不重排），而「原文 → 脑图」这个顺序已经有人在依赖
   *    （225 轮那批判据钉的就是它）。插到中间 ＝ 改别人的既有契约。
   * ② **只带正文、不带时间**：正文那一段（`todo.text`）也不带创建时间 ——
   *    导出是「适配 agent 文本」，元信息进去只是噪声。胶囊走同一条口径，
   *    否则同一份文本里"有的段落带时刻、有的不带"，读起来像两个人写的。
   *    时间在详情页的卡片上（`.cap-time`）看得见，不必搬到这里。
   * ③ **空文本的胶囊不产条目**：详情页那格显示「（这条还是空的）」是**界面提示**，
   *    不是内容；带出去就是一行没有任何信息的 `-`。
   *    ★★ 277 轮补一句：**"空文本但有图"要产**（写成一整个 `- ![胶囊图片 N](…)`）——
   *    一张截图本身就是内容，扔掉它等于用户在待办里挂了图、导出却少一张。
   *    判据因此从"text 非空"改成"text 或 uri 有一个"。
   *
   * ⚠️ 多行胶囊：换行会破掉 `- ` 前缀 ⇒ 首行带 `- `、其余行缩进 2 空格
   *    （Markdown 列表的续行写法），文字一个字都不动（"文本保真"对胶囊同样成立）。
   * ⚠️ 空行**不缩进**（尾随两个空格既无用、又会被编辑器标红）。
   * ⚠️⚠️ **这一段故意不用 `#` 标题**（改之前先想清楚）：脑图的层级是
   *    `#` 根 → `##` 一级子 → `###` 二级…… 胶囊如果写成 `## 闪念胶囊`，
   *    在"既有脑图、又有关联胶囊"的待办上，它会被**读成脑图的第三/四个一级子节点**
   *    —— 这是给 agent 读的文本，标题层级就是结构信号，混进去等于给了错结构。
   *    所以改用「分隔线 ＋ 裸文本标签」：明确"以下换了一个来源"，又不占层级。
   *    始终用同一套（有没有脑图都一样），免得同一条待办两次导出格式不同。
   */
  const caps = (opt.capsules || []).map(function (c) {
    const isObj = !!c && typeof c === 'object';
    return {
      text: String((isObj ? c.text : c) || '').trim(),
      /* ★★ 277 轮：胶囊挂的那张图（相对 uri）。空串 ＝ 没挂。 */
      uri: String((isObj ? c.uri : '') || '').trim()
    };
  }).filter(function (c) { return !!(c.text || c.uri); });
  if (caps.length) {
    const lines = ['---', '', '闪念胶囊', ''];
    let picNo = 0;
    caps.forEach(function (c) {
      if (c.text) {
        const rows = c.text.split(/\r?\n/);
        lines.push('- ' + rows[0]);
        for (let i = 1; i < rows.length; i += 1) {
          lines.push(rows[i] ? '  ' + rows[i] : '');
        }
      }
      /* ★★ 277 轮（用户口径 2026-10-27 第 4 条）：「待办导出时，导出的 Markdown 中
         也要有胶囊挂载图片的链接」。
         ── 形状：与"正文续行"同一个缩进（2 空格）⇒ 图是**这一条胶囊的内容**，
            不是一条独立的胶囊。有图没字时（`text` 空）才写成 `- ![..]`，
            否则会留下一行没有主人的图。
         ── 地址走 `resolveHref`：与待办自己的图同一条（库里存相对 uri，
            不拼就是死链 —— 225 轮在待办正文上踩过，这里不许再踩一次）。
         ── 序号跨胶囊连续编（`胶囊图片 1／2／3`），与 `capsule.js` 的
            `onOpsExport()` 对多选胶囊的编号口径一致。 */
      if (c.uri) {
        picNo += 1;
        const href = String(resolveHref(c.uri) || c.uri);
        const pic = '![胶囊图片 ' + picNo + '](' + href + ')';
        lines.push((c.text ? '  ' : '- ') + pic);
      }
    });
    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n');
}

module.exports = { treeToMarkdown: treeToMarkdown, todoToMarkdown: todoToMarkdown };
