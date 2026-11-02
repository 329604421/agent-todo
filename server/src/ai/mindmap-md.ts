/**
 * ★★ 280 轮 ·「语义转脑图」的 Markdown → 严格树 解析器（含占位符回填）
 *
 * 输入：模型返回的一段 Markdown（一棵树）
 * 输出：可以直接交给 `normalizeTree()` 的雏形树 ＋ 脑图名 ＋ 一份统计
 *
 * ── 四条设计前提，改之前先读 ────────────────────────────────────────────
 *
 * ① **它是 `小程序前端/utils/markdown.js` 里 `treeToMarkdown()` 的逆**。
 *    这是本方案能拿"往返一致"当**纯离线判据**的唯一理由
 *    （`parse(treeToMarkdown(T)) ≈ T` 可以完全离线跑、可以进 `--mutate`）。
 *    JSON 方案没有这"另一半" —— 验不出结构对不对。
 *    所以下面每一条解析规则都必须对着 `treeToMarkdown` 的产出形态写：
 *      · `#` … `######` ＝ mdLevel 0…5
 *      · 第 6 层起是 `'  '.repeat(mdLevel - 5) + '- '`
 *      · `remark` 导出成**节点下的一个正文段落**（标题行 → 空行 → remark → 空行）
 *    对应地：**正文段落一律归 `remark`**，绝不当节点（否则往返在"有备注的树"上必崩）。
 *
 * ② **`id` / `level` / `kind` 一律不在这里算**，交给 `normalizeTree()` 重算。
 *    自己再写一套迟早和它不一致（两套算法 = 两套真相）。
 *
 * ③ **三条"抛错语义"必须在这里先裁剪**（`common/tree.ts` 里都是 `throw`）：
 *    `TREE_MAX_DEPTH=12` / `TREE_MAX_NODES=2000` / `NODE_TEXT_MAX=2000`。
 *    不前置裁剪的话，一个 2500 字的长节点就让**整次生成失败**，
 *    而报错是"脑图结构不正确"这种看不出成因的话。
 *
 * ④ **图片只进 `imageUri` 字段、链接只进 `remark`**（275 轮铁律：节点图靠字段、
 *    不靠正文）。两条通道各有各的编号空间与正则，混用会"张冠李戴且不报错"。
 */

import { IMAGE_URI_RE } from '../common/constants';
import { NODE_IMAGE_MAX, NODE_TEXT_MAX, TREE_MAX_DEPTH, TREE_MAX_NODES } from '../common/tree';
import { TextLinkItem, tokenRe } from './link-guard';

/** 雏形节点 —— 只有四个字段（`id`/`level`/`kind` 由 `normalizeTree` 补） */
export interface MdNode {
  text: string;
  remark: string;
  imageUri?: string;
  children: MdNode[];
}

/** 图片快照的一条 —— 受理那一刻固化进 `Mindmap.aiInput`，后台**不能**回查胶囊 */
export interface SnapItem {
  /** 占位符编号（1 起，**图片序号**，不是胶囊序号） */
  i: number;
  /** 这条胶囊的原文（纯图节点要用它补名字） */
  text: string;
  /** 图片相对 uri（逐字搬运，不拼、不 encode） */
  imageUri?: string | null;
}

export interface RestoreCounts {
  /** 快照里**合法**的图（非法 uri 已剔除，见 `badUri`） */
  images: number;
  /** 挂到节点 `imageUri` 上的张数 */
  placed: number;
  /** 变成「附图」子节点的张数（一节点多图 / 补位） */
  child: number;
  /** 根节点上的图被下移的张数 */
  rootMoved: number;
  /** 模型把占位符删了、靠补位救回来的张数 */
  missing: number;
  /** 模型瞎编的编号（剥掉，不留在节点文本里） */
  ghost: number;
  /** 同一编号被写了两次（只留第一次） */
  dup: number;
  /** uri 形状非法/超长 ⇒ **只丢这张图**，不炸整棵树 */
  badUri: number;
  /** B 通道：回填进 remark 的链接条数 */
  linkPlaced: number;
  /** B 通道：模型丢掉的链接（补到原点 remark） */
  linkMissing: number;
  /** 正文段落被截断的次数（>500 字） */
  remarkCut: number;
  /** 节点文本被截断的次数（>2000 字） */
  textCut: number;
  /** 空标题节点被丢弃（子节点上提）的个数 */
  droppedEmpty: number;
  /** 第一个节点之前那一截"前言"的字数（丢掉了） */
  preface: number;
}

export interface BuildResult {
  tree: MdNode;
  /** 脑图名 —— **等于根节点文本**（同一条规则，不留两处显示差异） */
  name: string;
  /** 是否从 H1 取到名字（false ⇒ 用了兜底名，`remark` 里会说明原因） */
  fromHeading: boolean;
  counts: RestoreCounts;
}

/** 名字上限 —— 与 `CreateMindmapDto.name` 的 `@MaxLength(60)` 同值 */
export const MD_NAME_MAX = 60;
/** 正文段落（`remark`）长度上限 —— 备注不是正文，再长就该拆节点了 */
const REMARK_MAX = 500;
/** 「附图」子节点的文字里带多少原文 —— 12 字够看出是哪一条，又不至于和父节点撞脸 */
const PICK_SHORT = 12;
/** 纯图节点补名字时取多少原文 */
const PICK_TEXT = 24;

/** 行分类正则 */
const RE_ATX = /^(#{1,6})[ \t]*(.*)$/;
const RE_LIST = /^([ \t]*)(?:[-*+]|\d+[.)])[ \t]+(.*)$/;
const RE_QUOTE = /^[ \t]*>[ \t]?(.*)$/;
/** ATX 的收尾井号（`## 标题 ##`）—— 只有前面带空白的才算收尾，不能吃掉正文里的 `#` */
const RE_ATX_TAIL = /[ \t]+#+[ \t]*$/;

/** 表格行（`| a | b |`）—— 当正文处理，但要剥掉行首竖线，否则评论区一片 `|` */
const RE_TABLE = /^[ \t]*\|/;

/** 空白（含全角空格）—— `text.trim()` 不认全角空格，模型偶尔会用它填标题 */
function isBlank(s: string): boolean {
  return !String(s || '').replace(/[\s\u3000]+/g, '');
}

/** 截断到 n 个字符（按码点算，避免把 emoji 劈成两半） */
function cut(s: string, n: number): string {
  const arr = Array.from(String(s || ''));
  return arr.length <= n ? String(s || '') : arr.slice(0, n).join('');
}

/** 缩进折算成列数（tab = 4 列；只认深浅，不认具体字符） */
function indentCols(s: string): number {
  let n = 0;
  for (const ch of s) n += ch === '\t' ? 4 : 1;
  return n;
}

/**
 * 剥掉整篇的代码围栏。
 * 模型极爱把 Markdown 结果整段包进 ```markdown … ```（278 实测高频）。
 * ⚠️ 只剥"包住整篇的那一对"：中途的围栏按普通正文处理（见 `parseMarkdown`），
 *    因为本功能不需要保留代码块语义 —— 它要的只是"结构 + 内容不丢"。
 */
function stripOuterFence(src: string): { text: string; fenced: boolean } {
  const t = String(src || '').replace(/^\uFEFF/, '').trim();
  const m = /^`{3,}[a-zA-Z0-9_-]*[ \t]*\n([\s\S]*?)\n?`{3,}[ \t]*$/.exec(t);
  return m ? { text: m[1], fenced: true } : { text: t, fenced: false };
}

interface LineInfo {
  /** 'atx' 标题 / 'list' 列表 / 'text' 正文 */
  kind: 'atx' | 'list' | 'text';
  /** atx 的井号个数（1..6） */
  hashes: number;
  /** list 的缩进列数 */
  indent: number;
  /** 去掉标记之后的正文（未 trim） */
  body: string;
}

function classify(line: string): LineInfo {
  const raw = String(line || '').replace(/\r$/, '');
  if (isBlank(raw)) return { kind: 'text', hashes: 0, indent: 0, body: '' };

  /* 单独成行的围栏标记（``` 或 ```markdown）：**自己丢掉，里面的行按普通正文处理**。
     §6.6 的口径。⚠️ 不能整段跳过 —— 围栏里的内容就是树本身（模型爱包整篇），
     只丢标记才会既剥掉围栏、又不吃掉内容。 */
  if (/^[ \t]*`{3,}[a-zA-Z0-9_-]*[ \t]*$/.test(raw)) {
    return { kind: 'text', hashes: 0, indent: 0, body: '' };
  }

  const atx = RE_ATX.exec(raw);
  if (atx) {
    /* ⚠️ `#` 后面必须真的是"标题内容"：
       `#####` 这种纯井号行是分隔线/噪声 ⇒ body 为空，后面会被当空节点丢掉。
       而 `#TODO` 这类无空格写法**认**（模型偶尔漏空格，认它比丢一个节点好）。 */
    const body = String(atx[2] || '').replace(RE_ATX_TAIL, '').trim();
    return { kind: 'atx', hashes: atx[1].length, indent: 0, body };
  }

  const li = RE_LIST.exec(raw);
  if (li) {
    return { kind: 'list', hashes: 0, indent: indentCols(li[1] || ''), body: String(li[2] || '') };
  }

  const q = RE_QUOTE.exec(raw);
  if (q) return { kind: 'text', hashes: 0, indent: 0, body: String(q[1] || '') };

  if (RE_TABLE.test(raw)) {
    return { kind: 'text', hashes: 0, indent: 0, body: raw.trim().replace(/^\|+|\|+$/g, '') };
  }

  return { kind: 'text', hashes: 0, indent: 0, body: raw };
}

/**
 * Markdown → 雏形树（**不含**占位符回填）。
 *
 * 返回的 `tree` 里可能还带着 `[[图N]]` / `[[链接N]]` 字样 —— 那些由
 * `restorePlaceholders()` 统一剥离并按编号落到字段上（见该函数的注释）。
 */
export function parseMarkdown(md: string, fallbackName: string): {
  tree: MdNode;
  fromHeading: boolean;
  counts: Pick<RestoreCounts, 'droppedEmpty' | 'preface' | 'remarkCut' | 'textCut'>;
  /** 节点数超上限 —— 上层据此判"生成失败"（不是裁剪：2000 个节点的图人也读不了） */
  tooMany: boolean;
} {
  const { text: body } = stripOuterFence(md);
  const lines = body.split('\n').map(classify);

  /* ── 第一遍：找第一个**节点行**，决定"有没有 H1" ──────────────────────
     · 有 H1 ⇒ 它就是原点，H1 之前的内容是"前言"（模型的自言自语），丢掉；
     · 没有   ⇒ 原点用兜底名，所有节点从它下面开始挂
       （方案 §6.6：`##` 开头的第一个标题**原样留作一级子**，不为形状好看吃掉一个节点）。 */
  let firstAtxH1 = -1;
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (L.kind === 'text') continue;
    if (L.kind === 'atx' && L.hashes === 1 && !isBlank(L.body)) {
      firstAtxH1 = i;
    }
    break;
  }

  const fromHeading = firstAtxH1 >= 0;
  const root: MdNode = {
    text: fromHeading ? '' : (String(fallbackName || '').trim() || '语义转脑图'),
    remark: '',
    children: [],
  };

  const counts = { droppedEmpty: 0, preface: 0, remarkCut: 0, textCut: 0 };
  const stack: { rel: number; node: MdNode }[] = [{ rel: 0, node: root }];
  /* 列表缩进栈：`- ` 的层级只按**相对深浅**算（2/4 空格、tab 混用都能活）。
     这是 §6.6 里"压死最常见的解析崩溃源"那一条。 */
  const listStack: { cols: number; rel: number }[] = [];
  let lastNode: MdNode | null = fromHeading ? null : root;
  let started = false;   // 是否已经遇到第一个节点行
  let buf: string[] = [];
  let nodeCount = 1;
  let tooMany = false;

  const flushText = () => {
    if (!buf.length) return;
    const chunk = buf.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    buf = [];
    if (!chunk) return;
    if (!started && fromHeading) {
      /* 第一个节点（H1）之前的正文 ⇒ 前言，丢掉但要计数 —— 它常常是"以下是整理后的结构：" */
      counts.preface += chunk.length;
      return;
    }
    const host = lastNode || root;
    const merged = host.remark ? host.remark + '\n\n' + chunk : chunk;
    if (Array.from(merged).length > REMARK_MAX) counts.remarkCut += 1;
    host.remark = cut(merged, REMARK_MAX);
  };

  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];

    if (L.kind === 'text') {
      if (!isBlank(L.body)) buf.push(L.body.replace(/[ \t]+$/, ''));
      continue;
    }

    /* 走到这里一定是节点行 ⇒ 先把攒着的正文交给上一个节点 */
    flushText();

    if (isBlank(L.body)) continue;   // 空标题：不建节点（它的子节点会自然挂到上一个节点下）

    // ── 算"相对层级"（rel）──
    let rel: number;
    if (L.kind === 'atx') {
      /* 标题会开启新的一"段" ⇒ 列表缩进栈要清掉，否则后面第一个 `- ` 会拿
         "上一个标题下的列表缩进"来比深浅，层级直接偏掉。 */
      listStack.length = 0;
      const base = fromHeading ? 1 : 0;
      rel = L.hashes - base;
    } else {
      const prev = listStack.length ? listStack[listStack.length - 1] : null;
      if (!prev) {
        /* 第一个列表行：紧跟在**上一个节点**之下（`######` 之后接 `  - ` 就是"再深一层"）。
           ⚠️ 不要在这里压成 5：`treeToMarkdown` 里 mdLevel 6 是 `'  '.repeat(1) + '- '`，
              而 mdLevel 5 是 `######` —— **两者是不同层**，压平会让第 6、7 层整体上移，
              往返在那里断掉（且只在"超过 6 层"的树上断，平时看不出来）。 */
        const topRel = stack.length > 1 ? stack[stack.length - 1].rel : 0;
        rel = topRel + 1;
        listStack.push({ cols: L.indent, rel });
      } else if (L.indent > prev.cols) {
        rel = prev.rel + 1;
        listStack.push({ cols: L.indent, rel });
      } else if (L.indent === prev.cols) {
        rel = prev.rel;
      } else {
        // 变浅：回退到最近的、缩进不比自己深的那个列表层
        while (listStack.length > 1 && listStack[listStack.length - 1].cols > L.indent) listStack.pop();
        const hit = listStack[listStack.length - 1];
        rel = hit.cols === L.indent ? hit.rel : hit.rel + 1;
        if (hit.cols !== L.indent) listStack.push({ cols: L.indent, rel });
      }
    }

    /* ── 挂树：弹栈到"比我更浅的最近一个"，并强制不跳级 ──
       §6.6：跳级（`#` → `###`）补成"最近一个更高级节点的子节点"；层级最终由
       `normalizeTree` 重算，这里只要保证"父链合法、内容不丢"。 */
    if (rel <= 0) rel = 1;                       // 第二个 H1 起：降为原点的一级子节点
    /* ⚠️⚠️ 深度上限**必须夹在弹栈之前**（★ 280 自测发现：原来夹在后面，等于没夹）。
       ── 病根：`rel` 是被夹成了 11，但**父节点早就按原来的 12 选好了** —— 于是第 12 层
          挂在第 11 层下面、`rel` 都写 11，**深度照样一层层长下去**（40 层输入真出 40 层树）。
          `normalizeTree` 对 `level >= 12` 是**抛错**不是裁剪 ⇒ 整次生成失败，
          报错还是一句「脑图结构不正确」。
       ── 夹在前面为什么就够：夹完 `rel ≤ 11`，弹栈保证父的 `rel < rel ≤ 11`
          ⇒ 父最多 10，`top.rel + 1 ≤ 11`，下面那道"跳级拍平"不会再把它顶回 12。 */
    if (rel > TREE_MAX_DEPTH - 1) rel = TREE_MAX_DEPTH - 1;
    while (stack.length > 1 && stack[stack.length - 1].rel >= rel) stack.pop();
    const top = stack[stack.length - 1];
    if (rel > top.rel + 1) rel = top.rel + 1;    // 跳级 → 拍平

    let text = String(L.body || '').trim();
    if (Array.from(text).length > NODE_TEXT_MAX) {
      counts.textCut += 1;
      text = cut(text, NODE_TEXT_MAX);
    }

    /* 第一个 H1 就是原点本身（不新建节点，把内容填进去）。
       ⚠️ 这一步必须在 `nodeCount += 1` **之前** —— 原点不占"新建节点"的名额（初值已含它）。 */
    if (fromHeading && !started && L.kind === 'atx' && L.hashes === 1) {
      root.text = text;
      lastNode = root;
      started = true;
      continue;
    }

    if (nodeCount >= TREE_MAX_NODES) { tooMany = true; break; }
    nodeCount += 1;

    const node: MdNode = { text, remark: '', children: [] };
    top.node.children.push(node);
    stack.push({ rel, node });
    lastNode = node;
    started = true;
  }
  flushText();

  /* ── 丢弃"空标题"节点，子节点上提（不丢内容）──
     只在这一步丢：此时占位符还在文本里，`## [[图1]]` 不算空 ——
     等回填把它剥空之后，会用胶囊原文补名字（见 `restorePlaceholders`）。 */
  const prune = (n: MdNode): MdNode[] => {
    const kept: MdNode[] = [];
    for (const c of n.children) {
      const kids = prune(c);
      if (isBlank(c.text) && !c.imageUri) {
        counts.droppedEmpty += 1;
        kept.push(...kids);
      } else {
        c.children = kids;
        kept.push(c);
      }
    }
    return kept;
  };
  root.children = prune(root);

  /* 原点文本为空（H1 只有占位符 / 空字符串）⇒ 先兜底，回填后再定稿 */
  if (isBlank(root.text)) root.text = String(fallbackName || '').trim() || '语义转脑图';

  return { tree: root, fromHeading, counts, tooMany };
}

/* ══════════════════════════════════════════════════════════════════════════
 * 占位符回填 —— 两条通道，各用各的正则，各落各的字段
 *
 *   A 通道 `[[图N]]`   → 节点 `imageUri` 字段（**绝对不进文本**）
 *   B 通道 `[[链接N]]` → 节点 `remark`（`链接：<原串>`，换行分隔）
 *
 * ⚠️⚠️ 为什么不能共用一条宽正则（278 的 `RE_TOK`）：
 *    它同时认「图 / 图片 / 链接 / image / link」。两套编号在一个空间里 ⇒ 回填时
 *    `[[图1]]` 无法区分"胶囊挂的图"和"文本里手打的图"，**必然挂错且不报错**。
 *    更常见的症状是反过来的：`[[链接3]]` 被当成图去查快照，查不到就 ghost 剥掉
 *    ⇒ 用户粘的链接**凭空消失**，日志里只有几个 ghost 计数。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 剥离占位符之后，清掉残留的空格与孤立标点 */
function tidy(s: string): string {
  return String(s || '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。；：、！？,.;:!?）】」』])/g, '$1')
    .replace(/([（【「『])[ \t]+/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .trim();
}

/** 一条图片快照 → 「附图」子节点的文字 */
function pickLabel(s: SnapItem | undefined, idx: number): string {
  const t = s && s.text ? cut(String(s.text).replace(/\s+/g, ' ').trim(), PICK_SHORT) : '';
  return t ? `附图：${t}` : `附图 ${idx}`;
}

/**
 * 回填：把 `[[图N]]` / `[[链接N]]` 落到字段上，并保证**一张图都不丢**。
 *
 * 五步 ＋ 五种异常（方案 §6.9.4）：
 *   ① DFS 每个节点（**根要处理但根不收图** —— `normalizeTree` 对 `level===0` 是静默丢弃）
 *   ② 抓出占位符（分通道正则）
 *   ③ 剥离占位符 + tidy ⇒ 节点真正的文本
 *   ④ 第 1 个图号 → 本节点 `imageUri`；第 2..k 个 → 各建一枚「附图：…」子节点
 *   ⑤ 没出现过的图号 → 原点下「附图」分支（每张一枚子节点）
 */
export function restorePlaceholders(
  tree: MdNode,
  opt: { images?: SnapItem[]; links?: TextLinkItem[] },
): RestoreCounts {
  const counts: RestoreCounts = {
    images: 0, placed: 0, child: 0, rootMoved: 0, missing: 0, ghost: 0, dup: 0, badUri: 0,
    linkPlaced: 0, linkMissing: 0,
    remarkCut: 0, textCut: 0, droppedEmpty: 0, preface: 0,
  };

  /* ── 预处理快照：**先在门外验 uri**，不合格的只丢这张图 ──
     ⚠️ 这是本文件最重要的一道预检。`imageOf()`（common/tree.ts）对形状非法/超长是
        **`throw`** —— 一条脏 uri 会让"整次生成"失败，报错还是一句看不出成因的
        「节点图片路径不合法」。最容易踩的一类恰恰是**外链**：`urlFor()` 明确兼容
        `http(s)://`（库里历史上可能真躺着外链），而 `IMAGE_URI_RE` 不认冒号双斜杠。 */
  const snap = new Map<number, SnapItem>();
  const bad = new Set<number>();
  (opt.images || []).forEach((it) => {
    const i = Number(it && it.i);
    if (!i || i < 1) return;
    const uri = it && it.imageUri == null ? '' : String(it.imageUri).trim();
    if (!uri) return;                                   // 没图：不占编号
    if (uri.length > NODE_IMAGE_MAX || !IMAGE_URI_RE.test(uri)) {
      bad.add(i);
      counts.badUri += 1;
      return;
    }
    snap.set(i, { i, text: String(it.text || ''), imageUri: uri });
    counts.images += 1;
  });

  const linkMap = new Map<number, TextLinkItem>();
  (opt.links || []).forEach((it) => {
    const i = Number(it && it.i);
    if (!i || i < 1 || !it.raw) return;
    linkMap.set(i, { i, raw: String(it.raw) });
  });

  const usedImg = new Set<number>();
  const usedLink = new Set<number>();

  /** 建一枚「附图」子节点（一节点多图 / 补位都走它） */
  const addPicChild = (parent: MdNode, idx: number) => {
    const s = snap.get(idx);
    if (!s) return false;
    if (usedImg.has(idx)) { counts.dup += 1; return false; }
    usedImg.add(idx);
    const n: MdNode = { text: pickLabel(s, idx), remark: '', children: [] };
    if (s.imageUri) n.imageUri = s.imageUri;
    parent.children.push(n);
    counts.child += 1;
    return true;
  };

  /** 原点下的「附图」分支 —— 已存在就复用（**别建第二枚同名节点**） */
  const attachBranch = (idx: number) => {
    const s = snap.get(idx);
    if (!s) return;
    if (usedImg.has(idx)) { counts.dup += 1; return; }
    let host = tree.children.find((c) => c.text === '附图');
    if (!host) {
      host = { text: '附图', remark: '', children: [] };
      tree.children.push(host);
    }
    usedImg.add(idx);
    const n: MdNode = { text: pickLabel(s, idx), remark: '', children: [] };
    if (s.imageUri) n.imageUri = s.imageUri;
    host.children.push(n);
    counts.child += 1;
  };

  const appendRemark = (node: MdNode, line: string) => {
    const merged = node.remark ? node.remark + '\n' + line : line;
    if (Array.from(merged).length > REMARK_MAX) counts.remarkCut += 1;
    node.remark = cut(merged, REMARK_MAX);
  };

  /* ── ① DFS：先抓、再剥 ──
     ⚠️ 必须"先抓后剥"且**同一遍**做完：分开两遍时，一旦某处漏剥，
        节点文本里就会残留 `[[`，而它会原样进 `treeJson`、显示在画布上。 */
  const items: { node: MdNode; imgs: number[]; links: number[]; isRoot: boolean }[] = [];
  const walk = (node: MdNode, isRoot: boolean) => {
    const imgs: number[] = [];
    const links: number[] = [];
    /* ⚠️ **`text` 与 `remark` 都要扫**，这不是冗余：
       合并后的输入是"一段话 + 段末占位符"（`……删掉扫码入口 [[图1]]`），而模型把
       这段话落成什么形态是**不确定的** —— 可能变成一个节点标题，也可能变成节点下面的
       正文段落（§6.6 的"段落归 remark"规则正是后者的落点）。
       只扫 `text` 的后果是：一整类"图全进附图分支、并且 remark 里顶着 `[[图1]]` 字样"
       的输出 —— 用户看到方括号，日志里却是 `missing: N`（看起来像模型删了占位符）。
       第一次自测就是这么翻车的：`## 票据` 下一行正文里的 `[[图1]]` 根本没被抓到。 */
    const scan = (src: string) => {
      let t = String(src || '');
      t = t.replace(tokenRe('img'), (_m: string, d: string) => { imgs.push(parseInt(d, 10)); return ' '; });
      t = t.replace(tokenRe('link'), (_m: string, d: string) => { links.push(parseInt(d, 10)); return ' '; });
      return t;
    };
    const head = scan(node.text);
    const body = scan(node.remark);
    const hit = imgs.length + links.length > 0;
    /* ⚠️ 只有**确实剥过占位符**才做空格清理。
       对普通文本也跑一遍 `tidy` 等于擅自改写用户内容（`a b c  d` 的双空格会被压成一个），
       而那正是"文本保真"要守的东西，也是往返判据里 text 那一项的唯一依赖。 */
    let t = hit ? tidy(head) : String(head).trim();
    const rm = hit ? tidy(body) : String(body || '').trim();
    node.remark = rm;
    if (Array.from(t).length > NODE_TEXT_MAX) { counts.textCut += 1; t = cut(t, NODE_TEXT_MAX); }
    node.text = t;
    items.push({ node, imgs, links, isRoot });
    (node.children || []).forEach((c) => walk(c, false));
  };
  walk(tree, true);

  /* ── ④ 非根节点：第 1 张挂自己，其余建子节点 ── */
  const rootPending: number[] = [];
  for (const it of items) {
    if (it.isRoot) { rootPending.push(...it.imgs); continue; }
    /* ⚠️ 这里判"本节点还没挂图"而**不是**判下标 `k === 0`：
       `[[图99]] [[图1]]` 这种（前一个是瞎编的编号）会让 k=0 被 ghost 跳过，
       结果真正的那张图被"降级"成子节点 —— 位置偏了，而且不报错。
       "第 1 个**有效**编号挂本节点"才是方案的本意。 */
    it.imgs.forEach((idx) => {
      if (bad.has(idx)) return;                           // 已在预检计过，静默跳过
      const s = snap.get(idx);
      if (!s) { counts.ghost += 1; return; }              // 模型瞎编的编号：剥掉，不留方括号
      if (usedImg.has(idx)) { counts.dup += 1; return; }  // 同一编号写两次：只留第一次
      if (!it.node.imageUri) {
        it.node.imageUri = String(s.imageUri || '');
        usedImg.add(idx);
        counts.placed += 1;
      } else {
        addPicChild(it.node, idx);
      }
    });
  }

  /* ── 异常 1：根节点上的图**必须下移** ──
     ⚠️ `imageOf()` 对 `level===0` 是 `return ''`（静默丢弃、连日志都没有）。
        模型把带图那段直接当 H1 时，图会无声消失 —— 这是最隐蔽的一种丢图。 */
  rootPending.forEach((idx) => {
    if (bad.has(idx)) return;
    const s = snap.get(idx);
    if (!s) { counts.ghost += 1; return; }
    if (usedImg.has(idx)) { counts.dup += 1; return; }
    const target = tree.children.find((c) => !c.imageUri && c.text !== '附图');
    if (target) {
      target.imageUri = String(s.imageUri || '');
      usedImg.add(idx);
      counts.rootMoved += 1;
      counts.placed += 1;
    } else {
      attachBranch(idx);   // 一个空位都没有 ⇒ 建「附图」分支（宁可位置偏，不许丢图）
      counts.rootMoved += 1;
    }
  });

  /* ── ⑤ 没出现过的图号：一律补进原点的「附图」分支 ──
     278 的 `moved` 同款保险：模型把占位符删了/改了号，图也不能凭空消失。 */
  const lost = Array.from(snap.keys()).filter((i) => !usedImg.has(i));
  lost.forEach((idx) => {
    attachBranch(idx);
    counts.missing += 1;
  });

  /* ── 纯图节点补名字 ──
     剥离后文本为空的节点（`## [[图1]]`）在画布上是一个**空方块**，用户会以为生成失败。 */
  for (const it of items) {
    if (!isBlank(it.node.text)) continue;
    const first = it.imgs.find((i) => snap.has(i));
    const s = first ? snap.get(first) : undefined;
    const t = s && s.text ? cut(String(s.text).replace(/\s+/g, ' ').trim(), PICK_TEXT) : '';
    it.node.text = t || (first ? `附图 ${first}` : (it.isRoot ? tree.text : ''));
  }
  if (isBlank(tree.text)) tree.text = '语义转脑图';

  /* ── B 通道：链接一律进 `remark` ──
     ★ 为什么不是丢弃：本工程铁律"不许静默丢内容"；而 `remark` **有出口** ——
       `treeToMarkdown` 会把它导成节点下的正文段落，用户导出给 agent 时链接还在。
     ★ 为什么不是塞进 `text`：节点是标题，一串 URL 会把卡面撑爆（275 的原始教训）。 */
  for (const it of items) {
    it.links.forEach((idx) => {
      const hit = linkMap.get(idx);
      if (!hit) { counts.ghost += 1; return; }
      if (usedLink.has(idx)) { counts.dup += 1; return; }
      /* 同一节点里多条链接：**每个编号一行**（不合并成一行，否则导出时读不出哪条是哪条） */
      usedLink.add(idx);
      appendRemark(it.node, `链接：${hit.raw}`);
      counts.linkPlaced += 1;
    });
  }
  const lostLinks = Array.from(linkMap.keys()).filter((i) => !usedLink.has(i));
  if (lostLinks.length) {
    /* 模型丢了占位符 ⇒ 补到**原点**的 remark：整批材料的参考链接放根节点，语义最合理 */
    lostLinks.forEach((idx) => {
      const hit = linkMap.get(idx);
      if (!hit) return;
      appendRemark(tree, `链接：${hit.raw}`);
      counts.linkMissing += 1;
    });
  }

  return counts;
}

/**
 * 收尾：回填 ＋ 定名 ＋ **把"名称 == 原点文本"一次写死**。
 *
 * ★ 名称规则（方案 §6.7，三条都在这里落地，**不留第二处**）：
 *   · 有唯一 H1 ⇒ 名字 = 该 H1 正文，截到 60 字；
 *   · 没有 H1   ⇒ 名字 = 兜底名（含时间，能看出"哪一次"）；
 *   · H1 超 60  ⇒ 截断，**截掉的部分丢弃**（不塞 remark —— 那是标题，不是正文）。
 * ★ 为什么必须同一处：服务端 `update()` 的既有规则是"改名 ⇒ 根节点文本跟着改"，
 *   如果完成时留着全文，那么"卡上的名字（截断版）"和"画布上原点（全文）"会一直不一致，
 *   直到用户改一次名才归一。同一个东西的两处显示，必须一条规则。
 *
 * 单独导出的理由：**降级路径（先要 JSON）拿到的是树、不是 Markdown**，
 * 但它必须走同一套回填与定名 —— 否则两条路的产出规则会分叉。
 */
export function finalizeTree(
  tree: MdNode,
  opt: { fallbackName: string; images?: SnapItem[]; links?: TextLinkItem[] },
): BuildResult {
  const fallbackName = String(opt.fallbackName || '').trim() || '语义转脑图';
  const counts = restorePlaceholders(tree, { images: opt.images, links: opt.links });
  let name = String(tree.text || '').trim();
  if (!name) name = fallbackName;
  if (Array.from(name).length > MD_NAME_MAX) name = cut(name, MD_NAME_MAX);
  tree.text = name;
  return { tree, name, fromHeading: true, counts };
}

/** 一条龙：Markdown → 可落库的雏形树 ＋ 脑图名 */
export function buildTreeFromMarkdown(
  md: string,
  opt: { fallbackName: string; images?: SnapItem[]; links?: TextLinkItem[] } | string,
): BuildResult {
  const o = typeof opt === 'string' ? { fallbackName: opt } : opt;
  const fallbackName = String(o.fallbackName || '').trim() || '语义转脑图';

  const parsed = parseMarkdown(md, fallbackName);
  if (parsed.tooMany) {
    /* 节点数超上限：**判失败**而不是裁剪 —— 2000 个节点的图人也读不了，
       而"裁剪到 2000"会让用户以为模型就这水平。上层据此把卡转 failed。 */
    throw new Error(`模型返回的节点数超过 ${TREE_MAX_NODES}`);
  }

  const out = finalizeTree(parsed.tree, { fallbackName, images: o.images, links: o.links });
  out.fromHeading = parsed.fromHeading;
  out.counts.droppedEmpty += parsed.counts.droppedEmpty;
  out.counts.preface += parsed.counts.preface;
  out.counts.remarkCut += parsed.counts.remarkCut;
  out.counts.textCut += parsed.counts.textCut;
  return out;
}

/**
 * 降级路径：模型返回的 **JSON 树** → `MdNode`。
 *
 * 只在"Markdown 那一次解析不出来/为空"时用（见 `prompt.mindmap.ts` 的 `MINDMAP_JSON_PROMPT`）。
 * 失败返回 `null` —— 由上层把卡转 `failed`，**不要在这里猜**（猜出来的树比没有更糟）。
 *
 * ⚠️ 三处刻意宽容，因为模型的 JSON 不总是完美：
 *   · 剥围栏 / 前后废话（取第一个 `{` 到最后一个 `}`）；
 *   · `text` / `title` / `name` 三种键名都认（示例里写的是 `text`，它有时会换）；
 *   · 文本为空的节点 ⇒ **子节点上提**（与 Markdown 路径同一条口径，不丢内容）。
 */
export function parseJsonTree(raw: string): MdNode | null {
  let t = stripOuterFence(raw).text;
  const s = t.indexOf('{');
  const e = t.lastIndexOf('}');
  if (s < 0 || e <= s) return null;

  let obj: any;
  try {
    obj = JSON.parse(t.slice(s, e + 1));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;

  let n = 0;
  let tooMany = false;
  const conv = (o: any, depth: number): MdNode[] => {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return [];
    n += 1;
    if (n > TREE_MAX_NODES) { tooMany = true; return []; }
    const kids: MdNode[] = [];
    if (Array.isArray(o.children) && depth + 1 < TREE_MAX_DEPTH) {
      for (const c of o.children) kids.push(...conv(c, depth + 1));
    }
    const text = cut(String(o.text ?? o.title ?? o.name ?? '').trim(), NODE_TEXT_MAX);
    if (!text) return kids;                    // 空标题 ⇒ 子节点上提，不丢内容
    const remark = cut(String(o.remark ?? o.note ?? '').trim(), REMARK_MAX);
    return [{ text, remark, children: kids }];
  };

  const roots = conv(obj, 0);
  if (tooMany || !roots.length) return null;
  return roots[0];
}
