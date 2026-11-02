import { ApiException } from './api-exception';
import { CAPSULE_HOST, IMAGE_URI_RE } from './constants';

/**
 * 脑图严格树 —— 校验 ＋ 归一化 ＋ 派生值重算。
 *
 * ★ 为什么必须在服务端做一次（§5.3 红框）：
 *   前端已经保证了"单父 · 无环 · 不越级"，但**后端不能假设写入方永远守规矩**。
 *   一条带环 / 有重复 id 的树会让前端排版算法**死循环**（整个画布卡死，没有任何报错）。
 *   这是全项目唯一一处"善意假设会带来灾难性后果"的地方，所以校验要做得比前端更严。
 *
 * ★ `nodeCount` / `depth` **由服务端从树重算，不接受客户端传值**（§6.6）：
 *   它们是 `treeJson` 的派生冗余（列表卡显示"N 个节点"），
 *   一旦客户端传了个对不上的数，卡上显示的就是假的（86 轮就真实发生过一次种子数据写错）。
 */

/** 单棵树允许的最大节点数 —— 防"一条超大请求把前端排版循环拖死" */
export const TREE_MAX_NODES = 2000;
/** 最大层级 —— 六种排版算法在 4 层以上本来就读不清，这里只是护栏 */
export const TREE_MAX_DEPTH = 12;
/** 单个节点文本长度上限 —— 再长前端折行也放不下，且会把 sync/详情响应撑大（§4.3.3 带宽约束） */
export const NODE_TEXT_MAX = 2000;
/** 节点图片相对路径长度上限 —— 与 `Capsule.imageUri` 的列宽（`VARCHAR(512)`）同值 */
export const NODE_IMAGE_MAX = 512;

export interface TreeNode {
  id: string;
  text: string;
  remark: string;
  level: number;
  kind: 'root' | 'branch' | 'leaf';
  collapsed?: boolean;
  /** ★★ 275 轮：节点挂图 —— **图片相对 uri**（`<userId>/2026/10/xxx.jpg`），`undefined` ＝ 没挂。
   *
   *   · 口径与 `Capsule.imageUri` **完全同一套**（同样是一条相对路径、同样只存 1 张、
   *     同样用 `/files/<uri>` 拼完整地址）；
   *   · **根节点不许挂**（用户口径：「脑图原点不能挂载图片」）—— 见 `normalizeTree()`；
   *   · 与 `collapsed` / `flash` 同档：**可选的展示字段**，不进 `nodeCount` / `depth` 的算法。
   *
   *  ⚠️ 树的真源是 `Mindmap.treeJson`（JSON），所以加这个字段**不需要迁移** ——
   *     但**归一化必须认它**：`normalizeTree()` 是 `treeJson → TreeNode` 的唯一入口，
   *     漏了就等于"每次保存都把图整片抹掉"（与 199 轮 `flash` 踩的是同一个坑）。 */
  imageUri?: string;
  /** ★★ 275b 轮：那张图的**宽高比**（宽 ÷ 高）—— 前端"宽度固定、高度按图片自适应"要用它
   *  排版（`mindmap-core.js` 的 `picBoxOf`：图块高 ＝ 内容宽 ÷ 比例）。
   *
   *   · `undefined` / `0` ＝ **不知道**（老数据、胶囊转过来的图）⇒ 前端走 4:3 兜底；
   *   · 只在 `imageUri` 非空时有意义 —— `imageUri` 被清空时这里一并清掉（见 walk）；
   *   · 与 `imageUri` / `collapsed` / `flash` 同档：**可选的展示字段**，不进 `nodeCount` / `depth`。
   *
   *  ⚠️ 为什么不放在前端现算：排版层是**纯函数**（`metricsOf` 被判据当函数直接调），
   *     而"读图片像素尺寸"只有 `wx.getImageInfo` 能做（异步、依赖真实文件）。
   *     服务端也算不出来（没有图片本体）⇒ 只能由**挂图那一刻的前端**量好、随图一起存。
   *  ⚠️ 越界一律按"不知道"处理（不报错）：前端会 clamp 到兜底，坏数据不该让整张图排歪。 */
  imageRatio?: number;
  /** ★★ 199 轮：「刚转过来」提示 —— `true` ＝ 这枚节点是从胶囊转进来的、用户还没选中过它。
   *  由 `appendCapsuleChildren()` 写下、由 `POST /mindmaps/:id/seen` 清掉。
   *  ⚠️ 与 `collapsed` 同档：**可选的展示字段**，不进 `nodeCount` / `depth` 的算法。 */
  flash?: boolean;
  children: TreeNode[];
}

/** 新建脑图时的初始树 —— 与前端 `store.ensureTree()` 给的空树**逐字同形** */
export function emptyTree(name: string): TreeNode {
  return { id: 'n0', text: name || '未命名脑图', remark: '', level: 0, kind: 'root', children: [] };
}

let seq = 0;
/** 节点 id 生成 —— 时间戳 ＋ 进程内自增，避免同一毫秒内批量建节点时撞 id */
export function newNodeId(): string {
  seq += 1;
  return 'n' + Date.now().toString(36) + seq.toString(36);
}

export interface TreeCheckResult {
  tree: TreeNode;
  nodeCount: number;
  depth: number;
}

/** `normalizeTree()` 的可选校验开关 —— 只有**写入路径**（`PUT /tree`）需要传。 */
export interface NormalizeOpt {
  /**
   * ★★ 275 轮：节点图片的归属前缀，形如 `'<userId>/'`。
   *
   * 传了 ⇒ 每个 `imageUri` 必须**以它开头**（`relPathFor()` 产出的相对路径就是这个形状）。
   * 不传 ⇒ 只做形状校验（读改写路径：`markSeen` / `promote-to-mindmap` 的树本来就来自库，
   * 归属在写进来那一刻已经验过一次，不必每读一次再验）。
   *
   * ⚠️ 道理与 `CapsulesService.ownImage()` 逐字相同：别人的 uri 落到自己名下，
   *    等于给了"引用任意用户图片"的能力（`GET /files/<uri>` 是按路径直出的静态目录）。
   */
  ownPrefix?: string;
}

/**
 * 节点图片的归一化 ＋ 校验（`normalizeTree` 每一层都过它）。
 *
 * 三条口径：
 *   · **根节点一律不收**（用户口径「脑图原点不能挂载图片」）—— 这里是**丢弃**而不是抛错：
 *     前端根本不显示挂图入口，真带上来了多半是旧客户端 / 手工拼的包，静默忽略比
 *     "整棵树存不进去"宽容（且不会让一张图挂到不该挂的位置上）；
 *   · 空串 / `null` ⇒ 没挂图（字段整个不输出，与 `collapsed` / `flash` 同档）；
 *   · 有值 ⇒ 长度 ≤ 512（＝列宽）＋ 形状白名单 ＋ 归属前缀（传了才验）。
 */
function imageOf(raw: unknown, level: number, ownPrefix: string | undefined, path: string): string {
  if (level === 0) return '';
  const v = raw === undefined || raw === null ? '' : String(raw).trim();
  if (!v) return '';
  if (v.length > NODE_IMAGE_MAX) {
    throw ApiException.badParam(`节点图片路径过长（上限 ${NODE_IMAGE_MAX} 字符）：${path}.imageUri`);
  }
  if (!IMAGE_URI_RE.test(v)) {
    throw ApiException.badParam(`节点图片路径不合法：${path}.imageUri`);
  }
  if (ownPrefix && v.indexOf(ownPrefix) !== 0) {
    throw ApiException.badParam('图片不属于当前账号，请重新上传');
  }
  return v;
}

/** 节点图片宽高比的合法区间 —— 超出即"不知道"（不报错，前端走兜底） */
export const NODE_AR_MIN = 0.2;
export const NODE_AR_MAX = 5;

/**
 * ★★ 275b：宽高比归一化 —— 只在**有图**时收。
 *   · 非数字 / NaN / 越界 / ≤0 ⇒ `undefined`（＝ 不知道，前端按 4:3 兜底）；
 *   · 保留 3 位小数（前端 `picBoxOf` 只用它除一下，精度够且不会把 JSON 撑大）。
 * ⚠️ 与 `imageOf` **同进同退**：`imageUri` 被丢弃（根节点、空串）时这里也必须是 undefined
 *    —— 否则会留下一枚"没有图的图比例"，下一次挂图若忘写比例就会拿它去排版。
 */
function ratioOf(raw: unknown, image: string): number | undefined {
  if (!image) return undefined;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!isFinite(n) || n < NODE_AR_MIN || n > NODE_AR_MAX) return undefined;
  return Math.round(n * 1000) / 1000;
}

/**
 * 校验并归一化一棵树。
 * @throws ApiException(2001) —— 任何结构性错误
 */
export function normalizeTree(raw: unknown, opt?: NormalizeOpt): TreeCheckResult {
  const ownPrefix = opt && opt.ownPrefix ? String(opt.ownPrefix) : undefined;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw ApiException.badParam('脑图结构不正确（不是一棵树）');
  }

  const seen = new Set<string>();
  let nodeCount = 0;
  let maxDepth = 0;

  function walk(node: any, level: number, path: string): TreeNode {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw ApiException.badParam(`脑图结构不正确：${path} 不是节点对象`);
    }
    if (level >= TREE_MAX_DEPTH) {
      throw ApiException.badParam(`脑图层级超过 ${TREE_MAX_DEPTH} 层，请拆成多张图`);
    }

    // —— id：必须有、且整棵树内唯一（重复 id 会被前端当成"同一枚节点"，静默出错） ——
    let id = typeof node.id === 'string' ? node.id.trim() : '';
    if (!id) id = newNodeId();
    if (seen.has(id)) {
      throw ApiException.badParam(`脑图结构不正确：节点 id 重复（${id}）`);
    }
    seen.add(id);

    nodeCount += 1;
    if (nodeCount > TREE_MAX_NODES) {
      throw ApiException.badParam(`单张脑图最多 ${TREE_MAX_NODES} 个节点`);
    }
    if (level > maxDepth) maxDepth = level;

    const text = String(node.text == null ? '' : node.text);
    if (text.length > NODE_TEXT_MAX) {
      throw ApiException.badParam(`节点文字过长（上限 ${NODE_TEXT_MAX} 字）`);
    }

    const kidsRaw = node.children;
    if (kidsRaw !== undefined && kidsRaw !== null && !Array.isArray(kidsRaw)) {
      throw ApiException.badParam(`脑图结构不正确：${path}.children 不是数组`);
    }

    const children: TreeNode[] = [];
    if (Array.isArray(kidsRaw)) {
      for (let i = 0; i < kidsRaw.length; i++) {
        children.push(walk(kidsRaw[i], level + 1, `${path}.children[${i}]`));
      }
    }

    // —— 归一化：level / kind 一律由服务端按真实层级重算（不越级） ——
    const out: TreeNode = {
      id,
      text,
      remark: String(node.remark == null ? '' : node.remark),
      level,
      kind: level === 0 ? 'root' : children.length ? 'branch' : 'leaf',
      children,
    };
    // 折叠是"看图的姿势"，是可选的展示字段 —— 原样带上，但只认布尔
    if (typeof node.collapsed === 'boolean') out.collapsed = node.collapsed;
    /* ★★ 275 轮：节点挂图 —— 根节点丢弃、其余层原样带上（校验见 `imageOf()`）。
       ★ 275b：比例与图**同进同退**（`imageOf` 丢了图，这里也必须是 undefined）。 */
    const image = imageOf(node.imageUri, level, ownPrefix, path);
    if (image) {
      out.imageUri = image;
      const ar = ratioOf(node.imageRatio, image);
      if (ar !== undefined) out.imageRatio = ar;
    }
    /* ★★ 199 轮：「刚转过来」标记同样原样带上、同样只认布尔。
       ⚠️ 这条**不能省** —— `normalizeTree` 是**唯一**把 `treeJson` 转成 `TreeNode` 的入口，
          这里不认它，前端 `PUT /tree` 存回来的树经过一次归一化就会把标记**整片抹掉**
          （症状：转完脑图当时是亮的，一保存就全没了）。 */
    if (typeof node.flash === 'boolean') out.flash = node.flash;
    return out;
  }

  const tree = walk(raw, 0, 'root');
  return { tree, nodeCount, depth: maxDepth + 1 };
}

/**
 * 一条要转进脑图的胶囊 —— 文本 ＋ 它挂着的那张图（275 轮）。
 * ⚠️ 用对象而不是两个平行数组：两个数组长度一旦不一致，就会出现"张冠李戴"的图，
 *    而且**不会有任何报错**（图挂上了、只是挂错了节点）。
 */
export interface CapsuleSeed {
  text: string;
  /** 胶囊的 `imageUri`（相对路径）；`null` / 空串 ＝ 这条没挂图 */
  imageUri?: string | null;
  /** ★ 275b：这张图的宽高比。胶囊那一侧**当前没有**这个字段 ⇒ 实际总是 `undefined`
   *  ⇒ 节点上的图走 4:3 兜底（`aspectFit` 之下只是两边留细边，不会裁图）。
   *  留着这个口子是为了"胶囊哪天也存比例"时**不用再来改一遍转脑图这条链**。 */
  imageRatio?: number | null;
}

/**
 * 把若干条胶囊挂到「闪念胶囊」一级节点下（FR-9.6 的"转到脑图"）。
 *
 * 口径（与前端 `store.capsulesToMindmap()` **逐字一致**）：
 *   · 一级节点固定叫「闪念胶囊」，**已存在就复用**（第二次转不再建第二枚同名节点）；
 *   · 每条是它下面的一个**二级节点**（严格树，不越级）；
 *   · ★★ 275 轮：胶囊上的图**一并带过去**（用户口径「文字和图片一并转至脑图」）——
 *     一个胶囊仍对应一个节点，只是这个节点多了 `imageUri`；
 *   · 返回**实际写入的条数** —— 这是前端的判据：只有 `addedCount > 0` 才换 `ui.mindmapId`。
 *
 * @returns 实际写入的节点数（0 ＝ 一枚没写）
 */
export function appendCapsuleChildren(tree: TreeNode, items: CapsuleSeed[]): number {
  const list = (items || []).filter((it) => it && typeof it.text === 'string');
  if (!list.length) return 0;

  let host = (tree.children || []).find((c) => c.text === CAPSULE_HOST);
  if (!host) {
    host = { id: newNodeId(), text: CAPSULE_HOST, remark: '', level: 1, kind: 'branch', children: [] };
    tree.children = (tree.children || []).concat([host]);
  } else {
    host.children = host.children || [];
    host.kind = 'branch';
  }

  list.forEach((it) => {
    const leaf: TreeNode = {
      id: newNodeId(),
      text: it.text,
      remark: '',
      level: 2,
      kind: 'leaf',
      /* ★★ 199 轮：**只有这几枚新挂上去的叶子**带「刚转过来」标记。
         ⚠️ 复用到的那个「闪念胶囊」host 节点**不带**（它可能已经存在很久了，
            每次转胶囊都让它闪一下是错的 —— 用户这次转过来的是**那几条内容**）。
         ⚠️ 也别把标记下到 host 上再让前端"连子带父一起亮"：父节点在树上是一级、
            字号字重都更高一档，一亮就是"整个分支都新"，把真正新的那几条淹掉。 */
      flash: true,
      children: [],
    };
    /* ★★ 275 轮：图跟着文字一起走。归属不必再验（胶囊写进来那一刻 `ownImage()` 已验过），
       但**形状仍要过一遍** —— 一条脏 uri 落进树里，之后每次 `normalizeTree` 都会炸，
       整张图从此打不开（宁可这一次转失败、提示重来）。 */
    const img = imageOf(it.imageUri, 2, undefined, 'capsule');
    if (img) {
      leaf.imageUri = img;
      /* ★ 275b：比例与图同进同退（胶囊现在没有这个字段 ⇒ 恒 undefined ⇒ 前端兜底） */
      const ar = ratioOf(it.imageRatio, img);
      if (ar !== undefined) leaf.imageRatio = ar;
    }
    host!.children.push(leaf);
  });

  return list.length;
}

/** 数节点（导出/调试用；`normalizeTree` 内部已顺手算过，这里是独立出口） */
export function countNodes(node: TreeNode | null | undefined): number {
  if (!node) return 0;
  return 1 + (node.children || []).reduce((a, c) => a + countNodes(c), 0);
}

/** 树的深度（根＝1） */
export function depthOf(node: TreeNode | null | undefined): number {
  if (!node) return 0;
  if (!node.children || !node.children.length) return 1;
  return 1 + Math.max(...node.children.map(depthOf));
}
