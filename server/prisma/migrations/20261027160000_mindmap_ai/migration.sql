-- 语义转脑图 · 脑图表的 AI 状态与「归属 agent」（★★ 280 轮 · 用户口径 2026-10-27）
--
-- ★ 需求与设计来源：`文档/Agent-ToDo-语义转脑图-方案设计-280.md` §8.1（v2 定稿）。
--   一句话：胶囊（单选/多选）→ 语义转脑图 → 占位卡 → 后台生成 → 落库 → 未完善则拦截。
--
-- ★ 六列新增 ＋ 一处放宽，**全部可空**（唯一被改的既有列是 `project_id` 去掉 NOT NULL）：
--   · `project_id`  NOT NULL → NULL
--       占位那一刻还没有项目归属（胶囊不带项目），用户完善时才填。
--       **历史行全是非 NULL ⇒ 语义与改前逐行一致**；放宽约束不需要回填，可逆
--       （回滚前先 `UPDATE … SET project_id=<某项目> WHERE project_id IS NULL`）。
--   · `agent_id`    归属 agent（`ON DELETE SET NULL`：删 agent 不该连带删脑图）
--   · `ai_state`    null/pending/done/failed/canceled；**null ＝ 普通脑图**（所有历史行）
--   · `ai_started_at` 受理时刻，启动清扫"卡住的任务"用
--   · `ai_error`    卡面一句话（≤200），**不存堆栈不存错误码**
--   · `ai_input`    重试用的输入快照，**同时是图片的真源**（存 `[{i,text,imageUri}]`）
--   · `flash_at`    刚转过来亮一次底色（与 `agenttodo_todo.flash_at` **同名同义**）
--
-- ★ 为什么不给 `ai_state` / `flash_at` 加索引（与 `capsule.todo_id` 那次相反）：
--   `GET /sync` 是**全量下发**、前端自己筛，二者都不进 WHERE —— 加了只是写放大。
--   与 `todo_flash` 那次"刻意不加索引"是同一条取舍。
--
-- ★ `ai_input` 用 TEXT（不是 VARCHAR(191)）：20 条胶囊合并后可能几千字，
--   VARCHAR(191) 会**静默截断**（MySQL 严格模式报错、非严格模式丢尾部），两种都不可接受。
--
-- ★ SQL 与 Prisma 惯例逐字一致（列名 snake_case、FK 名 `…_fkey`），避免以后
--   `prisma migrate diff` 报漂移。

-- AlterTable · 脑图：项目归属可空（占位时无项目）
ALTER TABLE `agenttodo_mindmap` MODIFY COLUMN `project_id` VARCHAR(191) NULL;

-- AlterTable · 脑图：归属 agent ＋ AI 状态五列
ALTER TABLE `agenttodo_mindmap` ADD COLUMN `agent_id` VARCHAR(191) NULL,
    ADD COLUMN `ai_state` VARCHAR(191) NULL,
    ADD COLUMN `ai_started_at` VARCHAR(191) NULL,
    ADD COLUMN `ai_error` VARCHAR(191) NULL,
    ADD COLUMN `ai_input` TEXT NULL,
    ADD COLUMN `flash_at` VARCHAR(191) NULL;

-- AddForeignKey · 归属 agent（删 agent 只解绑，不删图）
ALTER TABLE `agenttodo_mindmap` ADD CONSTRAINT `agenttodo_mindmap_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agenttodo_agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
