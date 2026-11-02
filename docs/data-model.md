# 数据模型

12 张表，全部带 `agenttodo_` 前缀；数据库列名 `snake_case`，Prisma 字段名 `camelCase`，API 出入参与前端零转换。

```
                 ┌──────────┐
                 │   User   │ openid 唯一
                 └────┬─────┘
      ┌──────────┬────┴────┬─────────┬──────────┬──────────┐
      ▼          ▼         ▼         ▼          ▼          ▼
  Project     Mindmap    Todo    Capsule     Agent    TokenKey / ActivityDay
      │          │         │
      ├──1:n─────┤         │
      │          └──1:n────┘  Todo.mindmapId 可空
      │
      └──1:n──► Todo ──1:n──► TodoImage
                   ▲
                   └── Capsule.todoId 可空（一个胶囊同时只挂一条待办）

  Allowlist / PendingUser / AsrQuota 独立，只按 openid 关联
```

---

## 用户与准入

### `agenttodo_user`

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | cuid | 主键 |
| `openid` | varchar 唯一 | 跨端身份唯一主键 |
| `nickname` | varchar | 默认「我的工位」 |
| `avatar` | varchar(512) 可空 | 相对路径 |
| `created_at` / `updated_at` | string | `YYYY-MM-DD HH:mm:ss` |

### `agenttodo_allowlist`

`openid`（主键）、`note`、`created_at`。一期是"我和几个朋友"，谁在白名单里谁能登录。`ALLOW_ANY_USER=true` 时新用户会自动写入，`note='auto'`。

### `agenttodo_pending_user`

被 `1002` 拒过的人：`openid`、`hit_count`、`first_seen`、`last_seen`、`note`。作用只有一个 —— 让你能拿到朋友的 openid 再加进白名单。

---

## 业务实体

### `agenttodo_project`

| 字段 | 说明 |
|---|---|
| `name` | **允许重名**，无唯一约束 |
| `remark` | text |
| `node` | 阶段：构思期 / 建设期 / 迭代期 / 暂停期（可编辑标签，不是流程引擎） |
| `color` | 8 色槽位 key，`null` = 不着色 |
| `agent_id` | 可空，绑定的 Agent |
| `archived_at` | `null` = 活跃，非空 = 已归档 |

索引：`(user_id, archived_at)`。

### `agenttodo_todo`

| 字段 | 说明 |
|---|---|
| `project_id` | **必填**，单级归属；`onDelete: Restrict` 是数据安全网，别改成 Cascade |
| `mindmap_id` | 可空，协同关联一张脑图 |
| `raw_text` | text，原文**永不覆盖** |
| `draft_text` | 改写版（一期不暴露 UI，字段保留） |
| `urgency` | `urgent` / `mid` / `low` / `hold` 四档 |
| `status` | `open` / `done` |
| `created_at` | 热力源① |
| `completed_at` | 热力源②，**取消完成必须置 null**，否则热力永久多一条不存在的完成 |
| `updated_at` | 列表抽屉排序依据 |
| `deleted_at` | 软删标记，`null` = 正常 |
| `flash_at` | 「刚从胶囊转过来」的提示时刻，只有 `promote-to-todo` 写它，只有 `POST /todos/:id/seen` 清它 |

索引：`(user_id, project_id)`、`(user_id, updated_at)`、`(user_id, created_at)`、`(user_id, completed_at)`、`(user_id, deleted_at)`、`(mindmap_id)`。

### `agenttodo_todo_image`

`todo_id`（Cascade）、`uri`（只要相对路径）、`label`、`sort`。

### `agenttodo_mindmap`

| 字段 | 说明 |
|---|---|
| `project_id` | **可空**：语义转脑图的占位卡还没有项目归属 |
| `agent_id` | 由 `Project.agentId` 推导，客户端传值不采信 |
| `name` | 改名允许 |
| `format` | `mindmap` / `logic` / `org` / `tree` / `timeline` / `fishbone`；空串 = 未设置 |
| `tree_json` | **严格树的唯一真源**，写入前校验单父 / 无环 / 不越级 |
| `node_count` / `depth` | 派生冗余，服务端从树重算 |
| `ai_state` | `pending` / `done` / `failed` / `canceled`；全空 = 普通脑图 |
| `ai_started_at` | 启动清扫"卡住的任务"靠它 |
| `ai_error` | 卡面一句话，**不存堆栈与错误码**，写前截断 200 字 |
| `ai_input` | 合并后的输入快照（含图片真源），成功后必须清空 |
| `flash_at` | 与 `Todo.flashAt` 同名同义 |

树必须是严格树的原因很直接：一条带环的树会让前端排版算法死循环。前端已经保证了，但服务端不能假设写入方永远守规矩。

### `agenttodo_capsule`

| 字段 | 说明 |
|---|---|
| `text` | text，识别未回时可为空串 |
| `source` | `voice` / `text` |
| `created_at` | 热力源③；列表按它**正序** |
| `image_uri` | 可空，相对路径 |
| `deleted_at` | 软删 |
| `consumed_at` | 已被转走（转待办 / 转脑图）的时刻，转走后从胶囊列表消失 |
| `todo_id` | 关联到待办时写入；**一个胶囊同时只挂一条待办** |

**胶囊表没有 `updated_at` / `completed_at`** —— 它只贡献"创建"这一个数。

### `agenttodo_activity_day`

主键 `(user_id, day)`，`day` 是 `YYYY-MM-DD`。三个计数：`created`（待办创建）、`completed`（完成动作次数，取消不回退）、`capsule`（胶囊创建）。热力图直接读这张表，不到业务表里现算。

### `agenttodo_agent`

`name`、`quota_left`、`monthly_quota`（分母，缺它就判不出"额度偏低"）、`quota_reset_at`（只记日 `01`–`31`，各家按自然月重置）。

### `agenttodo_token_key`

`vendor`、`balance`、`api_key_cipher`（AES-256-GCM 密文）、`key_mask`（`sk-****wxyz`）、`balance_at`、`last_error`。

**出参里永远没有 `api_key_cipher`**：往返只出现掩码。密文格式是自描述的 `v1.<iv>.<tag>.<data>`，将来换算法时新老密文能按前缀共存。

### `agenttodo_asr_quota`

主键 `(user_id, day)`，`used`。按人按日限流，防止一个人刷脚本把整月免费额度打光。

---

## 三条容易写错的约束

1. **时间字段一律 string**。任何地方改成 `DateTime` 都会让热力图整体错一天，且不会报错
2. **Prisma 的 `String` 默认映射 `VARCHAR(191)`**。DTO 的 `@MaxLength` 不能超过列宽；`TEXT` 列不能带 `DEFAULT`
3. **`Todo.completed_at` 可空且取消完成必须置 null**。`Capsule` 不许补 `updated_at` / `completed_at`
