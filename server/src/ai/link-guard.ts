/**
 * 链接护栏（★ 278 轮）。
 *
 * 治两个病，一味药：
 *   ① **保真**：`![图片 1](https://todo.example.com/files/8f3c…-2b1d.jpg)` 这种串，模型改写时
 *      极爱"顺手美化"——把域名补成 markdown 链接、把 UUID 截断、把整串换成一句
 *      「（此处有一张图片）」。而这段文本是要粘进 agent 输入框的，图丢了就是真丢了。
 *   ② **别让它读图**：模型看见 URL 里的文件名（`login-old.png`）会**凭空描述图的内容**
 *      （「图中展示了旧版登录页」）—— 用户没让它读图，它却写了一整句想象；
 *      而真要"读"，就得走多模态，一张图几百上千 token。这里一律不送。
 *
 * 做法：整串图片语法 → `[[图1]]`；裸链接 → `[[链接1]]`。模型**只看见占位符**，
 *      回来按编号换回原串。
 *
 * ⚠️ 为什么换**整串**而不是只换括号里的 URL：只换 URL 的话，回填要求模型把 `![]()` 的
 *    方括号圆括号也一字不动；它一旦写成「图片：<占位符>」，回填就只能在错位置塞一个裸 URL，
 *    **语法当场坏掉**。换整串 ⇒ 回填是"用原串覆盖占位符"，语法不可能坏（最坏是位置挪，见下）。
 *
 * ⚠️ 代价（认了）：`alt` 里的文字进不了模型视野**正文**，但它会以「图注」形式
 *    **挂在占位符里面**（P-8 拍板，见下）—— 既不破坏保真，又给模型留了判断归属的线索。
 *
 * ⚠️ P-8（10-27 拍板）：`alt` **条件化送**。
 *    默认序号（`图片1` / `胶囊图片 1`）**不送** —— 那是系统拍的序号，零信息量；
 *    用户自己起的名字（`识别失败截图`）**送**，因为它常常是模型判断"这张图配哪一段"的**唯一线索**
 *    （尤其 v3.2 之后位置完全交给模型判断，剥掉 alt 等于让它盲放）。
 *    形态：`[[图3｜识别失败截图]]` —— 图注**在占位符内部**，回填时整枚 token 被原串覆盖，
 *    所以它不可能漏进最终结果；模型把竖线后面整段删掉也照样能回填（RE_TOK 里那截是可选的）。
 *    为什么不做成"占位符外面另挂一句注解"：那需要二次清除，模型一旦改写注解就留下一句人话垃圾。
 *
 * ⚠️ 已知边界：输入正文里若本来就写着 `[[图1]]` 这类字样（现实中几乎不会），
 *    回填会把它当占位符。概率可忽略，不做额外转义 —— 加了转义反而让模型更容易看花。
 */

export type GuardKind = 'img' | 'url';

export interface GuardItem {
  kind: GuardKind;
  /** 原串，回填时**逐字**放回 */
  raw: string;
}

export interface Guarded {
  /** 送进模型的文本（URL 已全部变成占位符） */
  text: string;
  /** 编号（1 起）→ 原串。回填按下标取。 */
  map: GuardItem[];
}

export interface Restored {
  text: string;
  /** 模型没用上、被补到文末的条数（没丢，只是位置变了） */
  moved: number;
  /** 重复出现的占位符条数（已丢弃，只保留第一次） */
  dup: number;
  /** 模型瞎编的编号条数（已剥离） */
  ghost: number;
  /** 输出里占位符**相对顺序**被打乱的次数（相邻逆序对）。
   *  与 `moved` 是两个正交的量：
   *    · 几张图一起后移到末尾、顺序仍是 1→2→3 ⇒ moved>0、orderBroken=0（结构性搬运，可接受）
   *    · 图 3 排到了图 1 前面                     ⇒ orderBroken>0（真串位，R16）
   *  这是唯一"能机器验的串位信号"—— 相似度会误报，顺序不会。 */
  orderBroken: number;
}

/** 整串图片语法。
 *  ⚠️ `(?:\\\\.|[^\\]\\\\])*` 而不是 `[^\\]]*`：`markdown.js` 的 `altText` 会把用户图注里的
 *     `[` / `]` 转义成 `\\[` / `\\]`。用 `[^\\]]*` 时，一遇到 `\\]` 就以为 alt 结束，
 *     整条语法匹配不上 ⇒ **那张图的 URL 会原样漏进模型视野**（正是本文件要治的病）。
 *     允许反斜杠转义对之后，带方括号的图注也能被正常抽换。 */
const RE_IMG = /!\[(?:\\.|[^\]\\])*\]\([^)]*\)/g;

/** 裸链接。排除空白与成对括号，免得把中文句子里的括号一起吃进去。 */
const RE_URL = /https?:\/\/[^\s<>()（）【】"']+/g;

/** 把一条图片语法拆成 alt / href（`RE_IMG` 已保证形状合法）。 */
const RE_IMG_PARTS = /^!\[([\s\S]*)\]\(([\s\S]*)\)$/;

/** 系统拍的默认序号 —— 零信息量，不送。`图片1`（待办图）／`胶囊图片 1`（胶囊图，带空格） */
const RE_DEFAULT_ALT = /^(?:胶囊)?图片\s*\d+$/;

/**
 * 回填用的占位符识别，**故意写宽**：
 * 容忍空格、容忍全角冒号、容忍模型把「图」写成「图片 / 链接 / image / link」、
 * **容忍竖线后面那截图注被模型改写或整个删掉**（也容忍它把竖线换成冒号、或干脆折进 `[[图1:说明]]`）。
 * ⇒ **回填只看编号，不看前缀、不看图注** —— 编号才是真相。
 */
const RE_TOK = /\[\[\s*(?:图|图片|链接|image|img|link)\s*[:：]?\s*(\d+)\s*(?:[|｜:：][^\]\n]*?)?\s*\]\]/gi;

/** 一定不属于 URL 的收尾标点 */
const TAIL_PUNCT = /[，。；！？、,.!?;:]+$/;

/**
 * 图注提示（P-8）：把用户起的 alt 变成能安全塞进占位符的一小段字。
 *
 * 返回空串 ⇒ 不送（alt 为空，或只是 `图片2` / `胶囊图片 3` 这种系统序号）。
 * 返回非空 ⇒ 拼成 `[[图N｜这里]]`。
 *
 * ⚠️ 三个动作都是"让它塞得进方括号"，不是改写语义：
 *   ① 还原 `\[` `\]`（markdown 的转义逃生壳，对模型是噪音）；
 *   ② 剥掉 `[` `]` `|` `｜` 与换行 —— 任何一个都会把占位符截断，比不送更糟；
 *   ③ 截 24 字。图注是**判断题的题干**，不是正文，长了只会挤占模型的注意力。
 */
function hintOf(raw: string): string {
  const m = RE_IMG_PARTS.exec(raw);
  if (!m) return '';
  const a = m[1]
    .replace(/\\([\[\]\\])/g, '$1')
    .replace(/[\[\]|｜\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!a || RE_DEFAULT_ALT.test(a)) return '';
  return a.length > 24 ? a.slice(0, 24) + '…' : a;
}

export function extractLinks(src: string): Guarded {
  const map: GuardItem[] = [];
  let t = String(src || '');

  /* ⚠️ 顺序：**先图片、后裸链接**。反过来时裸链接规则会先咬住图片 URL 的尾巴，
     留下半截 `![图片 1](` —— 那是坏语法，比丢图更糟。 */
  t = t.replace(RE_IMG, (raw) => {
    map.push({ kind: 'img', raw });
    const hint = hintOf(raw);
    return `[[图${map.length}${hint ? '｜' + hint : ''}]]`;
  });

  t = t.replace(RE_URL, (raw) => {
    /* 中文句子里 `见 https://x.com/a。` 的句号不属于链接。
       只剥"一定不是 URL 一部分"的那几个收尾标点；更聪明的规则会吃掉真实路径。 */
    const tail = TAIL_PUNCT.exec(raw);
    const clean = tail ? raw.slice(0, -tail[0].length) : raw;
    if (!clean) return raw;
    map.push({ kind: 'url', raw: clean });
    return `[[链接${map.length}]]` + (tail ? tail[0] : '');
  });

  return { text: t, map };
}

export function restoreLinks(out: string, g: Guarded): Restored {
  const seen = new Set<number>();
  let dup = 0;
  let ghost = 0;
  /* ★ 占位符在输出里的**出现顺序**（只记编号与类别，不记像素位置）——
     用来算 `orderBroken`：结构可以重排，但"图 1 在图 2 前面"这件事不该变，
     它对应的是原文里"哪张图跟哪段内容"的先后关系。 */
  const order: { i: number; kind: GuardKind }[] = [];

  let text = String(out || '').replace(RE_TOK, (_m: string, d: string) => {
    const i = parseInt(d, 10) - 1;
    const hit = g.map[i];
    if (!hit) { ghost += 1; return ''; }        // 模型瞎编的编号：剥掉，别把 `[[图9]]` 交给用户
    if (seen.has(i)) { dup += 1; return ''; }   // 同一张图被写了两次：只留第一次
    seen.add(i);
    order.push({ i, kind: hit.kind });
    return hit.raw;
  });

  /* ★ 模型没用上的（被删、被合并、被它"整理"掉了）⇒ **一律补到文末**。
     这是"图片绝不丢失"的最后一道保险：宁可位置偏到最后，也不让用户的图凭空消失。
     ⚠️ 结构被允许重排之后，走到这一支的概率**明显高于**"必须原样保留结构"的极权版
        （模型越敢重组，越容易把占位符当噪音丢掉）。所以 notice 的措辞要写得像"请挪回去"，
        而不是像"出错了"。
     ⚠️ 按**原始顺序**、每张单独一行 —— 与导出物里"图片块独占一行"的排法一致。 */
  const lost = g.map.map((_v, i) => i).filter((i) => !seen.has(i));
  if (lost.length) {
    text = text.replace(/\s+$/, '') + '\n\n' + lost.map((i) => g.map[i].raw).join('\n');
  }

  /* ★ 补尾的图**不算** orderBroken —— 它们本来就落在最后，顺序与原始一致。
     真正要报的是"模型在正文里把图穿插错了次序"。

     ⚠️ **只跟同类比**（图对图、链接对链接）。这条是 13:34 真调一次之后加的：
        模型把裸链接内联写进了「范围与边界」那段（`严格参照 [[链接1]] 这份规范`），
        图则收在末尾的「参考材料」里 ⇒ 全局按编号比就报 `orderBroken=1`，
        可**输出其实完全正确**，用户却收到一句"请逐张核对图片是否挂在正确的内容旁"。
        跨类本来就没有"先后"可言（链接天然会被内联提前引用），比它只会制造狼来了。
     ⚠️ 记"同类上一次出现的编号"而不是"相邻两项"：中间插进一条链接时，
        `[图2, 链接1, 图1]` 这种真串位用相邻比会漏掉，用同类上一次比才抓得住。 */
  let orderBroken = 0;
  const lastOf = new Map<GuardKind, number>();
  for (const it of order) {
    const prev = lastOf.get(it.kind);
    if (prev !== undefined && it.i < prev) orderBroken += 1;
    lastOf.set(it.kind, it.i);
  }

  return { text, moved: lost.length, dup, ghost, orderBroken };
}

/** 拼一句给用户看的话。**全部正常时返回空串** —— 说「12 张图片都保留好了」纯属噪声。 */
export function buildNotice(r: Restored, g: Guarded): string {  const imgN = g.map.filter((x) => x.kind === 'img').length;
  if (!r.moved && !r.dup && !r.ghost && !r.orderBroken) return '';
  if (!imgN) return r.ghost ? '已清理输出里的无效占位符。' : '';
  /* ⚠️ 串位与补尾**必须分开说**，因为用户要做的事不一样：
     · 补尾 ⇒ 去文末把图挪回对应的位置（位置偏了，内容顺序是对的）
     · 串位 ⇒ 逐张核对哪张图属于哪段（顺序错了，不能靠"挪到末尾"修好）
     但**不能只报串位就 return**（13:34 真调那次踩到）：同一份输出里可能既有串位又有重复引用，
     先说一句"顺序不一致"就把"合并了 1 处重复引用"吞掉了 —— 而那条恰恰解释了
     用户会看到的一个空标签（`- 规范：` 后面什么都没有）。所以全部并进同一句。 */
  const bits: string[] = [];
  if (r.orderBroken) {
    bits.push(`${r.orderBroken} 处顺序与原文不一致，请逐张核对图片是否挂在正确的内容旁`);
  }
  if (r.moved) bits.push(`${r.moved} 张没跟上各自的内容，已统一放在文末，请按需挪回对应位置`);
  if (r.dup) bits.push(`合并了 ${r.dup} 处重复引用（同一张图被写了两次，标签可能因此变空）`);
  if (r.ghost) bits.push(`清理了 ${r.ghost} 个无效占位符`);
  /* ⚠️ 开头必须说"一张没丢"：用户看到"图片"两个字第一反应是"图没了"，得先把这句给他。 */
  return `${imgN} 张图片都没有丢 —— ${bits.join('；')}。`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ★★ 280 轮 ·「语义转脑图」的 B 通道：**文本里的链接**
 *
 * 与 278 的三处不同，动之前先读：
 *
 * ① **前缀一律 `[[链接N]]`，绝不出现 `[[图N]]`**。
 *    278 的 `extractLinks()` 把图片语法映射成 `[[图N]]` —— 那个名字在本功能里
 *    **被 A 通道占用了**（胶囊自己挂的那张图，`Capsule.imageUri`，根本不在文本里）。
 *    两套编号共用一个前缀 ⇒ 回填时 `[[图1]]` 到底指"胶囊图"还是"文本里手打的图"，
 *    无从区分，**必然挂错，且不会报错**。所以这里另开一个函数，而不是给
 *    `extractLinks` 加参数 —— 加参数会让 278 那条路径也跟着暴露在"前缀可配"的风险里。
 *
 * ② **图片语法与裸链接都归到同一个编号空间**（都叫 `[[链接N]]`）。
 *    因为二者的落点相同：节点的 `remark`（见 mindmap-md.ts）。278 要区分
 *    `img`/`url`，是因为回填时要决定"能不能当图显示"；这里不显示，只贴原串。
 *
 * ③ **不送图注**。`hintOf()` 的 P-8 图注是给"模型判断这张图配哪一段"用的；
 *    本功能里模型只负责把这段文字归位，图注（`alt`）本来就在同一段里。
 *    多送一截只会挤占 24 字的节点额度。
 *
 * 顺序仍然是**先图片后裸链接**（反了会留下半截 `![图片 1](`，那是坏语法）。
 * ══════════════════════════════════════════════════════════════════════════ */

/** B 通道的一条原串。`i` 从 1 起，与提示词里 `[[链接N]]` 的编号一致。 */
export interface TextLinkItem {
  i: number;
  raw: string;
}

/**
 * 把一段文本里的链接/图片语法全部换成 `[[链接N]]`。
 *
 * @param startAt 起始编号（默认 1）。
 *   多段胶囊合并时要**跨段连续编号**：第 2 段里第一个链接如果又从 1 开始，
 *   回填时 `[[链接1]]` 会命中第 1 段的原串 —— 于是"链接挂到别的段落上"，不报错。
 *
 * ⚠️ 与 `extractLinks()` **共用 `RE_IMG` / `RE_URL` / `TAIL_PUNCT`**（同一份定义，
 *    不是抄一遍）：哪天要支持新的链接形态，改一处两条路都跟上。
 */
export function extractTextLinks(src: string, startAt = 1): { text: string; map: TextLinkItem[] } {
  const map: TextLinkItem[] = [];
  const base = Math.max(1, Math.floor(Number(startAt) || 1));
  let t = String(src || '');

  /* ⚠️ 顺序：先图片、后裸链接（理由见文件头 278 那段，同一条坑） */
  t = t.replace(RE_IMG, (raw) => {
    map.push({ i: base + map.length, raw });
    return `[[链接${base + map.length - 1}]]`;
  });

  t = t.replace(RE_URL, (raw) => {
    const tail = TAIL_PUNCT.exec(raw);
    const clean = tail ? raw.slice(0, -tail[0].length) : raw;
    if (!clean) return raw;
    map.push({ i: base + map.length, raw: clean });
    return `[[链接${base + map.length - 1}]]` + (tail ? tail[0] : '');
  });

  return { text: t, map };
}

/**
 * ★ 分通道取词器（280 轮）：**只认一种前缀**。
 *
 * 278 的 `RE_TOK` 同时认「图 / 图片 / 链接 / image / img / link」—— 那是**故意写宽**的，
 * 因为 278 只有一个编号空间，认错了也能回填。
 * 「语义转脑图」有两个编号空间（胶囊图 / 文本链接），**用宽正则就会互相吞**：
 * `[[链接3]]` 被当成图去查快照，查不到就 ghost 剥掉 —— 症状是"用户粘的链接凭空消失"，
 * 而日志里只有几个 ghost 计数。
 *
 * ⚠️ 每次调用返回**新实例**：带 `g` 的正则是有状态的（`lastIndex`），
 *    共享一个实例会让"上一处匹配到的位置"影响下一处（这类 bug 只在多节点时偶发）。
 */
export function tokenRe(kind: 'img' | 'link'): RegExp {
  const prefix = kind === 'img' ? '(?:图|图片|image|img)' : '(?:链接|link|url)';
  /* 这一截与 `RE_TOK` 的正文部分**逐字相同**（容错空格、全角冒号、可选图注、竖线）。
     判据 `check_mindmap_ai280` 有一条对撞：两处的前缀集合必须一致。 */
  return new RegExp(`\\[\\[\\s*${prefix}\\s*[:：]?\\s*(\\d+)\\s*(?:[|｜:：][^\\]\\n]*?)?\\s*\\]\\]`, 'gi');
}
