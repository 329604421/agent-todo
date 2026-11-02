# API

全局前缀 `api/v1`，正文 `application/json`，鉴权 `Authorization: Bearer <jwt>`（除 `/health`、`/auth/login`）。

统一响应：

```json
{ "code": 0, "message": "ok", "data": { } }
```

| code | 含义 |
|---|---|
| `0` | 成功 |
| `1001` | token 失效或未登录（前端会 `wx.login` 重试一次） |
| `1002` | openid 不在白名单（会同时写进待批列表） |
| 其他 | 业务错误，`message` 是可直接展示的中文提示 |

**没有"列表接口"**是刻意的：`GET /sync` 一次下发当前用户的全部数据，前端自己筛。理由是一期数据量在几百条量级，全量拉的体验远好于每个列表页各发一次请求再各自缓存 —— 也避免了"两个页面数据不一致"这类问题。

---

## 鉴权与账户

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/login` | 入参 `{ code }`（`wx.login` 拿的），返回 `{ token, me }`；开发环境可走 `DEV_OPENID` |
| GET | `/me` | 当前用户资料 |
| PATCH | `/me` | 改昵称 / 头像 |
| GET | `/sync` | **启动入口**。`{ serverTime, me, agents, tokenKeys, projects, todos, mindmaps, capsules, activity }` |

`serverTime` 用来校正"今天"—— 热力图的开周窗口跟系统当天走，设备时间不可信。

## 项目

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/projects` | 新建（名称允许重名） |
| PATCH | `/projects/:id` | 改名、备注、阶段、颜色、绑定 agent |
| POST | `/projects/:id/archive` | 归档 |
| POST | `/projects/:id/unarchive` | 取消归档 |
| GET | `/projects/:id/detail` | 项目详情聚合：待办、脑图、阶段、综合紧急度 |

项目不提供删除：删项目会让一批待办变成孤儿，所以 `Todo.projectId` 的外键是 `Restrict`。

## 待办

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/todos/:id` | 详情（含完整图片 URL） |
| POST | `/todos` | 新建；手动新建**不写** `flashAt` |
| PATCH | `/todos/:id` | 改正文、紧急度、关联脑图、图片 |
| POST | `/todos/:id/complete` | 完成（写 `completedAt` 与活跃度） |
| POST | `/todos/:id/reopen` | 取消完成（`completedAt` 置 null） |
| DELETE | `/todos/:id` | **软删**，只写 `deletedAt` |
| POST | `/todos/:id/restore` | 还原，一律回到未完成 |
| POST | `/todos/:id/seen` | 清掉 `flashAt`（用户真的打开了详情） |
| POST | `/todos/:id/capsules` | 关联胶囊（`{ ids: [] }`） |
| DELETE | `/todos/:id/capsules` | 取消关联 |

## 脑图

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/mindmaps/:id/tree` | 读整棵树 |
| PUT | `/mindmaps/:id/tree` | **幂等**覆盖整棵树；服务端校验单父、无环、不越级 |
| POST | `/mindmaps` | 新建 |
| PATCH | `/mindmaps/:id` | 改名、格式、项目、agent |
| POST | `/mindmaps/:id/seen` | 清掉 `flashAt` |
| DELETE | `/mindmaps/:id` | 删除 |
| GET | `/mindmaps/ai-pending` | 语义转脑图的进行中列表 |
| POST | `/mindmaps/:id/ai-retry` | 失败重试 |

声明顺序有意义：`/ai-pending` 必须排在 `/:id/tree` 之前，Nest 按声明顺序匹配路由。

## 闪念胶囊

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/capsules` | 新建（语音或文字，可带一张图） |
| PATCH | `/capsules/:id` | 改文字 |
| DELETE | `/capsules/:id` | 删单条（软删） |
| DELETE | `/capsules` | 多选删（入参 `{ ids: [] }`） |
| POST | `/capsules/restore` | 撤销删除 |
| POST | `/capsules/:id/promote-to-todo` | 单条转待办，写 `flashAt` 与 `consumedAt` |
| POST | `/capsules/promote-to-mindmap` | 多选直接生成脑图 |
| POST | `/capsules/to-mindmap-ai` | 多选语义转脑图（异步，先返回占位卡） |

多选只开放"删除"与"语义转脑图"；转待办只针对单条，因为还要补项目和紧急度。

## 资源与配额

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/files` | 上传图片（multipart）；类型嗅探不信任扩展名，超过 `UPLOAD_MAX_BYTES` 拒绝 |
| POST | `/asr` | 语音转文字；按人按日限流 |
| POST | `/agents` · PATCH `/:id` · DELETE `/:id` | Agent 套餐与配额 |
| POST | `/token-keys` | 新增模型 key（明文进、密文存、只回掩码） |
| PATCH | `/token-keys/:id` | 改厂商 / 换 key（不传 `apiKey` 表示不动原有的） |
| POST | `/token-keys/refresh` | 刷新余额 |
| DELETE | `/token-keys/:id` | 删除 |

## AI

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/ai/enhance` | 信息增强：重组待办表达。**结果不写回原待办**，需人工核对 |

未配置 `ARK_API_KEY` 时直接报「增强服务未配置」，不静默返回原文。

## 管理

需要额外的 `X-Admin-Token: <ADMIN_TOKEN>`；`ADMIN_TOKEN` 留空时整组接口返回 404（当作不存在）。

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/admin/pending` | 被 1002 拒过的人（拿 openid 用） |
| GET | `/admin/allowlist` | 白名单 |
| POST | `/admin/allowlist` | 加白名单 |
| DELETE | `/admin/allowlist/:openid` | 移出白名单 |

## 健康检查

```
GET /api/v1/health  →  { code: 0, data: { status: 'ok', version, time, uptime } }
```

返回里带 `version` 与 `time`：排查时最有用的一句就是"线上到底是哪一版、服务器时间对不对"。nginx 对这条单独放行，不经过限流。
