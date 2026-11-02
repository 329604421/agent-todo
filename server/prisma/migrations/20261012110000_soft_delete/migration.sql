-- 逻辑删除（软删）—— 待办与闪念胶囊
--
-- ★ 背景（2026-10-12 · 用户口径）：
--   「优化一下待办信息和闪念胶囊的删除逻辑，需要将其改为逻辑删除，通过在数据库中
--     新增字段的形式来去区分正常和删除」
--   ⇒ 删除不再 `DELETE`，只盖一个时刻；前端据此提供「已删除」筛选与「还原」。
--
-- ★ 三列，两种语义（**待办只有软删，胶囊有两个不同的"消失原因"**）：
--   · `agenttodo_todo.deleted_at`     —— 软删；还原 = 置回 null
--   · `agenttodo_capsule.deleted_at`  —— 软删（**只有这一种进「已删除胶囊」列表**）
--   · `agenttodo_capsule.consumed_at` —— 被 `promote-to-todo` / `promote-to-mindmap`
--                                        消化掉。**刻意与软删分列**：用户明确
--                                        「只有手动删除才进「已删除胶囊」」——
--                                        若共用一个字段，还原一条已转成待办的胶囊
--                                        会让同一段内容在待办里出现第二遍。
--
-- ★ 纯新增列 + 新增索引，**不改任何既有列、不动任何既有数据**（对线上是安全变更）。
--   上线后**不需要回填**：所有既有行的新列都是 null ＝ 「正常」，语义与改前逐行一致。
--
-- ★ 索引口径：两张表各加一条 `(user_id, deleted_at)` —— `GET /sync` 与列表接口
--   都按 `userId + deletedAt IS NULL` 取数，这是本次改动之后**最高频**的过滤条件。
--   ⚠️ 唯一键 / 外键 / 既有索引一个都不动。
--
-- ★ SQL 由 `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma`
--   生成后摘取，索引名与 Prisma 惯例逐字一致（避免以后 `migrate diff` 报漂移）。

-- AlterTable · 待办：加软删列
ALTER TABLE `agenttodo_todo` ADD COLUMN `deleted_at` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `agenttodo_todo_user_id_deleted_at_idx` ON `agenttodo_todo`(`user_id`, `deleted_at`);

-- AlterTable · 胶囊：软删列 ＋ 消费列（两个"消失原因"分开）
ALTER TABLE `agenttodo_capsule` ADD COLUMN `deleted_at` VARCHAR(191) NULL,
    ADD COLUMN `consumed_at` VARCHAR(191) NULL;

-- CreateIndex
CREATE INDEX `agenttodo_capsule_user_id_deleted_at_idx` ON `agenttodo_capsule`(`user_id`, `deleted_at`);
