-- 闪念胶囊 ↔ 待办的**关联**（★★ 248 轮 · 用户口径 2026-10-23）
--
-- ★ 需求原文（六条里落在数据库上的三条）：
--   ② 「点击『+选择胶囊』弹出选择胶囊的抽屉……可多选卡片，底部按键为『取消』『保存』」
--   ③ 「关联后，胶囊卡片就在待办详情页以卡片形式显示，一行可以展示多个卡片……
--      可以取消关联」
--   ④ 「在建立关联时，胶囊信息需要从闪念胶囊中移除（**和转脑图、转待办后的胶囊列表
--      数据的操作一致**）」
--   ⑤ 「如果待办和胶囊解除关联信息，该信息会回到闪念胶囊列表，但是这个过程不算新增胶囊，
--      不计入概览统计，此时胶囊信息的创建时间为解除关联的时间，胶囊信息最开始的创建时间
--      无需保存」
--
-- ★ 只加一列 `agenttodo_capsule.todo_id`（可空）＋ 一条复合索引。
--   · `NULL`      ＝ 没有关联（**所有既有行都是这一档** ⇒ 语义与改前逐行一致）
--   · 非 NULL     ＝ 关联在这条待办上；同时 `consumed_at` 非空（从正常列表消失，
--                    与"转待办 / 转脑图"同一套可见性口径 —— 详情见 schema 里的长注释）
--
-- ★ 纯新增可空列 ＋ 一条索引，**不改任何既有列、不动任何既有数据**（对线上是安全变更）。
--   上线后**不需要回填**：既有胶囊本来就没有关联。
--
-- ★ 为什么要索引（与 `flash_at` 那次"刻意不加索引"的取舍相反）：
--   `GET /sync` 要按它挑出"关联在待办上的那批"（正常列表看不到它们，但待办详情要显示），
--   `DELETE /todos/:id/capsules` 也要按它过滤 ⇒ 它真的进 WHERE 条件。
--
-- ★ SQL 与 Prisma 惯例逐字一致（列名 snake_case、类型 VARCHAR(191)、FK 名 `…_fkey`），
--   避免以后 `prisma migrate diff` 报漂移。

-- AlterTable · 胶囊：加"关联到哪条待办"
ALTER TABLE `agenttodo_capsule` ADD COLUMN `todo_id` VARCHAR(191) NULL;

-- CreateIndex · 按用户 ＋ 关联挑出"挂在待办上的胶囊"
CREATE INDEX `agenttodo_capsule_user_id_todo_id_idx` ON `agenttodo_capsule`(`user_id`, `todo_id`);

-- AddForeignKey · 指向待办（`ON DELETE SET NULL` 只是数据安全网：本工程的待办是软删，
--   真删走不到这里；软删**不解绑**，还原之后详情页还是原来那几张胶囊）
ALTER TABLE `agenttodo_capsule` ADD CONSTRAINT `agenttodo_capsule_todo_id_fkey` FOREIGN KEY (`todo_id`) REFERENCES `agenttodo_todo`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
