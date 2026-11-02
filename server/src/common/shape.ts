import { urlFor } from './upload';

/**
 * 出参整形 —— 集中一处，避免"同一个实体在三个接口里字段不一致"。
 *
 * ★ 两条硬规则（都不是洁癖，各自对应一个真实故障）：
 *   ① **`GET /sync` 与列表接口只给图片的相对 `uri`，不给完整 `url`**（§6.2 红框）。
 *      理由在出口处再写一遍：sync 是"启动时一次"，若给了完整 URL，前端很容易顺手预加载图片 ——
 *      3 Mbps 下预取 20 张图要 16 秒。**只有 `GET /todos/:id` 给完整 url。**
 *   ② **`GET /sync` 与列表接口的脑图不带 `treeJson`**（§6.2）。
 *      树是唯一"体积随内容增长"的数据，且前端 mock 里本来就是元信息 / 树分开的两份结构。
 */

/** 统一时间序：sort 升序，同序按 id 稳定 */
function sortImages(images: any[]): any[] {
  return (images || [])
    .slice()
    .sort((a, b) => (a.sort || 0) - (b.sort || 0) || String(a.id).localeCompare(String(b.id)));
}

/** 待办 —— `withImageUrl` 只在**详情**接口传 true */
export function todoOut(t: any, withImageUrl = false) {
  return {
    id: t.id,
    projectId: t.projectId,
    mindmapId: t.mindmapId || null,
    text: t.text,
    draftText: t.draftText || null,
    urgency: t.urgency,
    status: t.status,
    createdAt: t.createdAt,
    completedAt: t.completedAt || null,
    updatedAt: t.updatedAt,
    /* ★★ 160 轮：**逻辑删除**时刻 —— `null` ＝ 正常。前端靠它把同一条待办分到
       「未完成 / 已完成 / 已删除」三档里（`adaptTodo()` → `deleted`）。
       ⚠️ 必须**出参**：`GET /sync` 要连已删除的一起给（否则「已删除」筛选无数据可列），
          而"这条还在不在"就只能由这个字段回答 —— 少了它，前端会把已删除的当成正常的。 */
    deletedAt: t.deletedAt || null,
    /* ★★ 199 轮：**「刚转过来」提示** —— `null` ＝ 无提示。
       只有 `promote-to-todo` 落下来的那条会带值；用户打开它的详情后由
       `POST /todos/:id/seen` 清回 null。前端据此给这张卡上一层"新到"填充色。
       ⚠️ 必须出参：`GET /sync` 是前端列表的**唯一数据源**，少了它提示就永远是"没有"。
          也正因为要走 sync，这个字段**不能**只活在前端缓存里（跨端会丢）。 */
    flashAt: t.flashAt || null,
    images: sortImages(t.images).map((i) => {
      const base = { id: i.id, uri: i.uri, label: i.label || '', sort: i.sort || 0 };
      return withImageUrl ? Object.assign(base, { url: urlFor(i.uri) }) : base;
    }),
  };
}

/** 脑图元信息 —— `withTree` 只在 `GET /mindmaps/:id/tree` 传 true */
export function mindmapOut(m: any, withTree = false) {
  const base: any = {
    id: m.id,
    projectId: m.projectId || null,
    /* ★ 280 轮：`''` 是**一档真实状态**（格式未设置），不是缺省值 —— 所以这里不能用
       `m.format || 'mindmap'` 把它兜底成「思维导图」，那会让占位卡显示假信息。 */
    format: m.format == null ? '' : m.format,
    /* ★ 280 轮：「归属 agent」—— 与 `projectOut` 同一条口径（有就透传、没有就 null）。
       注意它**不继承项目**：脑图自己那一列才是真源。 */
    agentId: m.agentId || null,
    /* ★ 280 轮：AI 处理状态。null ＝ 普通脑图（所有历史行）；前端据此画占位/失败态。
       ⚠️ 只出这三列：`aiStartedAt / aiError / aiInput` **不下发** ——
          前两个前端用不上，`aiInput` 含用户原文与图路径，绝不能进全量快照。 */
    aiState: m.aiState || null,
    flashAt: m.flashAt || null,
    name: m.name,
    nodeCount: m.nodeCount,
    depth: m.depth,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
  };
  if (withTree) base.treeJson = m.treeJson;
  return base;
}

export function projectOut(p: any) {
  return {
    id: p.id,
    name: p.name,
    remark: p.remark || '',
    node: p.node,
    color: p.color || null,
    agentId: p.agentId || null,
    archivedAt: p.archivedAt || null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function capsuleOut(c: any) {
  return {
    id: c.id,
    text: c.text || '',
    source: c.source,
    createdAt: c.createdAt,
    /* ★★ 160 轮：胶囊的**两个"消失原因"**，都是"非 null ⇒ 不进正常列表"：
       · `deletedAt`  —— 用户手动删掉 ⇒ 进「已删除胶囊」列表、可还原；
       · `consumedAt` —— 被转成待办 / 转到脑图 / **被关联到某条待办** 消化掉
                         ⇒ **不进**那个列表（用户口径），也不可还原
                         （内容已经在待办 / 脑图里了）。
       ★★ 248 轮：这三列**各答一个问题**，别拿其中一列去代另一列 ——
         · 在不在正常列表？ → `deletedAt || consumedAt`（前端 `isGoneCapsule()` 的唯一判据）
         · 挂在哪条待办？   → `todoId`（`null` ＝ 没关联）
         · 还能不能回列表？ → `todoId`（三种"消失"里只有"关联"可逆，清空它就回去了）
       ⚠️ 三个都必须出参。特别是 **`consumedAt` 非空 ≠ 不下发**：`GET /sync` 下发的是
          「正常 ＋ 手动删掉 ＋ **关联在待办上**」那批（判据见 `sync.service.ts` 的
          `OR: [{consumedAt: null}, {todoId: {not: null}}]`）⇒ **收到的一行
          `consumedAt` 完全可能非空**，拿它当"在列表里"的证据会错。
          少了 `todoId`，「关联在待办上的胶囊」在客户端就是一个查不到归属的孤儿。 */
    deletedAt: c.deletedAt || null,
    consumedAt: c.consumedAt || null,
    todoId: c.todoId || null,
    /* ★★ 263 轮（清单 H1）· 这一条挂的那张图 —— **相对 uri**（§4.5）。
       拼完整 URL 是客户端的显式动作（`api.fileUrl`），这一层不拼：
       域名一换，库里的 512 宽列就成了死链。
       ⚠️ 老数据这一列是 `NULL` ⇒ 出参 `null`（不是 `undefined`）：
          前端 `if (c.imageUri)` 两种都能挡，但"字段恒在"让判据能直接断它存在。 */
    imageUri: c.imageUri || null,
  };
}

export function agentOut(a: any) {
  return {
    id: a.id,
    name: a.name,
    quotaLeft: a.quotaLeft === null || a.quotaLeft === undefined ? null : a.quotaLeft,
    monthlyQuota: a.monthlyQuota === null || a.monthlyQuota === undefined ? null : a.monthlyQuota,
    quotaResetAt: a.quotaResetAt || null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

/**
 * 模型厂家 key（§6.8 · Token API）—— `balance` 单位是**分**（整数），前端负责格式化显示。
 * 存分不存元：浮点数在"余额"这种会被反复加减显示的数字上迟早出现 128.39999 这种脏值。
 *
 * ★★ 2026-10-12：余额改由**查询**写入，并新增四个字段 ——
 *   · `keyMask`    'sk-****abcd'。⚠️ **出参里没有、也永远不会有 `apiKeyCipher`**：
 *                  这个函数是唯一一道闸门，**在此处多写一行就是一次静默泄漏**。
 *   · `hasKey`     有没有配 key。它比 `keyMask` 更好用（掩码空串与"没配"要能区分开）。
 *   · `balanceAt`  余额**最后成功查询**的时间 —— 「更新于 X」说的是"数是什么时候的"。
 *   · `lastError`  最近一次查询失败的原因（成功时清空）—— 前端拿它显示失败提示。
 *                  ⚠️ 它是**给人看的一句话**，不是机器码；措辞在 service 里定。
 */
export function tokenKeyOut(k: any) {
  return {
    id: k.id,
    vendor: k.vendor,
    balance: k.balance === null || k.balance === undefined ? null : k.balance,
    keyMask: k.keyMask || '',
    hasKey: !!k.apiKeyCipher,
    balanceAt: k.balanceAt || null,
    lastError: k.lastError || null,
    createdAt: k.createdAt,
    updatedAt: k.updatedAt,
  };
}

export function meOut(u: any) {
  return {
    nickname: u.nickname,
    avatar: u.avatar || '',
    avatarUrl: urlFor(u.avatar),
  };
}
