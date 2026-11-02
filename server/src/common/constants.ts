/**
 * 口径常量 —— 需求里那些"写死"的取值域。
 *
 * ★ 为什么放在后端只是"取值域"而不是"业务算法"：
 *   §8.2 明确 **综合紧急度（5/3/1/0）只有前端一个合法来源**（`utils/mock.js` 的 `URGENCIES[].weight`），
 *   后端**不持有那份权重、不返回任何 score** —— 否则就是两份真源，改一处必漏另一处。
 *   这里只做 `urgency ∈ {urgent,mid,low,hold}` 的**入参校验**，不参与任何计算。
 */

/** 紧急程度四档 —— 仅用于校验入参（权重不在这里，见上方注释） */
export const URGENCIES = ['urgent', 'mid', 'low', 'hold'] as const;
export type Urgency = (typeof URGENCIES)[number];

/** 项目节点四期（FR-2.3） */
export const PROJECT_NODES = ['构思期', '建设期', '迭代期', '暂停期'] as const;

/** 脑图六格式 —— key 与 `小程序前端/utils/formats.js` 的 `LIST[].key` 逐字一致 */
export const MINDMAP_FORMATS = ['mindmap', 'logic', 'org', 'tree', 'timeline', 'fishbone'] as const;
export type MindmapFormat = (typeof MINDMAP_FORMATS)[number];
/** 新建脑图的默认格式 —— 与前端 `formats.DEFAULT_KEY` 同值 */
export const MINDMAP_DEFAULT_FORMAT = 'mindmap';

/** 项目 8 色槽位 key —— 与前端 `mock.PROJECT_COLORS[].key` 逐字一致 */
export const PROJECT_COLORS = ['qing', 'lv', 'ganlan', 'zong', 'zi', 'pinhong', 'dian', 'song'] as const;

/** 待办状态（D-3：用枚举而非布尔，二期可扩第三态） */
export const TODO_STATUS = ['open', 'done'] as const;

/** 胶囊来源 */
export const CAPSULE_SOURCES = ['voice', 'text'] as const;

/** 待办图片张数上限（§4.5） */
export const TODO_IMAGE_MAX = 9;

/** 图片体积上限 1 MB（§4.5） */
export const IMAGE_MAX_BYTES = 1024 * 1024;

/**
 * ★★ 263 轮：**图片相对 uri 的合法形状**（`<userId>/<YYYYMM>/<hex>.<ext>`，见 `relPathFor`）。
 *
 * 为什么要在入口就挡（而不是只信客户端）：
 *   ① 完整 URL（`https://…`）进库之后，`urlFor()` 会把域名再拼一次 ⇒ 死链；
 *   ② `../` 进库之后，`removeUpload()` 的路径穿越护栏会拒删，那个文件**永远删不掉**；
 *   ③ 这一列只在出参里回显、不进 WHERE —— 破了形状也**不会报错**，只会在某台设备上
 *      显示成一张裂图，排查成本极高。
 * ⇒ 用一条白名单正则把"只可能出现我们自己产出的形状"钉死在这里（与 `TodoImage.uri` 同一条）。
 * ⚠️ 首字符不许是 `.` 或 `/`：前者能拼出 `../`，后者会把路径拼成 `//files//…`。
 */
export const IMAGE_URI_RE = /^[A-Za-z0-9][A-Za-z0-9/_.-]*$/;

/** 音频体积上限 3 MB（§6.8.1；nginx 的 `client_max_body_size` 必须 ≥ 它，取 4m） */
export const AUDIO_MAX_BYTES = 3 * 1024 * 1024;

/** 每张闪念胶囊转到脑图时承载文本的那枚一级节点名 —— 与前端 `store.CAPSULE_HOST` 逐字一致 */
export const CAPSULE_HOST = '闪念胶囊';
