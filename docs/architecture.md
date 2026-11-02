# 架构

## 全景

```
微信小程序（原生）
  pages/shell ── 唯一页面，模块靠组件显隐切换
      │
      ├── utils/store.js   唯一状态源：内存数据 + 写台账（乐观更新 / 回滚）
      └── utils/api.js     唯一网络出口：token 注入、1001 静默重登、超时分类
      │
      │  HTTPS · JSON · Bearer JWT
      ▼
nginx
  ├── /                → 静态站（官网双页）
  ├── /files/*         → alias 直出图片（不经过 Node）
  ├── /api/v1/health   → 单独放行，给探活用
  └── /api/v1/*        → 127.0.0.1:3000
      │
      ▼
NestJS 10
  ┌─────────────────────────────────────────────────────┐
  │ 全局：ValidationPipe（whitelist）                    │
  │       ResponseInterceptor → { code, message, data }  │
  │       ApiExceptionFilter → 同外形返回错误            │
  ├─────────────────────────────────────────────────────┤
  │ auth → me → sync → projects → todos → mindmaps       │
  │ capsules → agents → token-keys → files → asr → ai    │
  │ admin → health                                       │
  ├─────────────────────────────────────────────────────┤
  │ Prisma 5 ──► MySQL 8      （表前缀 agenttodo_）       │
  │ 腾讯云 ASR / 火山方舟      （可选，缺配置时明确报错）  │
  └─────────────────────────────────────────────────────┘
```

## 一次请求的固定形状

1. nginx 终止 TLS，按 location 决定是直出静态、直出图片还是反代
2. Nest 全局 `ValidationPipe` 按 DTO 白名单裁字段 —— 客户端硬塞 `userId` 这类越权字段会被丢掉
3. 守卫校验 `Authorization: Bearer <jwt>`，把 `openid` 解出来放进 request
4. service 层所有查询都带 `userId` 条件（**没有任何跨用户的读路径**）
5. `ResponseInterceptor` 包成 `{ code: 0, message: 'ok', data }`
6. 业务错误抛 `ApiException`，由 filter 包成同外形、`code != 0` 的响应

错误码约定的目的只有一个：前端只判 `code` 一个字段，不用同时处理 HTTP 状态码和业务码。中文提示走 `message`，错误码与堆栈只进日志。

## 前端状态管理

`utils/store.js` 是唯一状态源，四千行里比较关键的是「写台账」：

```
用户操作 → 立刻改内存（界面秒响应）→ 记账 → 发请求
                                        ├─ 成功：用回包校正内存
                                        └─ 失败：按账回滚 + toast
```

为什么不用"先请求再改界面"：现场网络经常是 3 Mbps 且抖动，等回包再渲染会让人以为按钮没点上。为什么必须记账：并发请求的回包顺序不保证，不记账会出现"后发先至把界面改回旧值"。

## 四条影响全局的决策

### 时间用字符串，不用 DateTime

全库时间字段是 `String('YYYY-MM-DD HH:mm:ss')`。Prisma + MySQL 的 `DateTime` 按 UTC 解释，北京 0:00–8:00 写入的记录会整体错一天，而活跃热力正是按「日」聚合的。定长字符串顺带得到两个好处：字典序＝时间序，与 API 契约、前端切片天然一致。

### 图片只存相对路径

`TodoImage.uri` / `Capsule.imageUri` 存的是相对值，对外前缀由 `FILE_BASE_URL` 一处决定。换域名、上 CDN 都是单行改动，且可逆 —— 库里的数据不需要迁移。

配套约定：**列表接口不拼完整 URL**。`GET /sync` 下发的 `uri` 是相对值，要看图时前端显式调用 `fileUrl()`。这不是洁癖：3 Mbps 下预取 20 张图要十几秒，顺手全拼一遍等于让列表页拖着详情页的流量。

### 派生字段落库，但只在源头变更时刷新

`Mindmap.nodeCount` / `depth` / `agentId` 是派生值，服务端从树或项目重算，**客户端传值一律不采信**。三条写入路径（create / update / 项目改绑 agent）都必须触发刷新 —— 派生字段一旦漂移，界面上不会报错，只会安静地说假话。

同理，`Todo.flashAt`（"刚从胶囊转过来"的提示）必须落库而不是前端缓存：手机转过来、平板打开同一份数据，提示要在；平板看过之后，手机也不该再提示。前端缓存做不到跨端。

### 软删除

`DELETE /todos/:id` 不真删，只写 `deletedAt`；`POST /todos/:id/restore` 清回 `null` 并一律回到"未完成"。软删不碰 `status` / `completedAt`（"这条是什么状态"与"还在不在"是两件事），也不删磁盘图片。

## 外部依赖的失败策略

| 依赖 | 缺失/失败时 | 为什么不静默降级 |
|---|---|---|
| 微信 `code2session` | 超时 8s，报 1001 让前端重登 | 拿不到 openid 就没有身份，降级等于放行 |
| 腾讯云 ASR | 报「语音识别未配置」/「识别失败」 | 返回空串会被当成"识别不准"，排查方向全错 |
| 火山方舟 | 报「增强服务未配置」 | 悄悄返回原文，用户会以为模型没起作用 |
| 后端整体不可达 | 前端清空成真的空，并说清成因 | 拿演示数据顶上去，"库是空的"和"没连上"在界面上长得一模一样 |

## 代码边界

- `utils/api.js` 是唯一网络出口，其它文件不许直接 `wx.request`
- `utils/store.js` 是唯一状态源，组件不许各自缓存业务数据
- 后端 service 不直接拼 HTTP 响应，出参统一走 `common/shape.ts`
- 涉及加密只走 `common/secrets.ts`，不许在业务里另写一套
