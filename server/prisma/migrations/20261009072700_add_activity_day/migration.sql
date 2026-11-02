-- 活跃度台账（agenttodo_activity_day）—— 热力图从「现算存量」改为「动作计数」
--
-- ★ 背景（2026-10-09 · 用户报「统计的是实时值，应该是一个统计值」）：
--   原热力图由前端遍历 `todos` / `capsules` 现算：删除待办、取消完成、胶囊被消费
--   都会让历史上的数字跟着缩水。这张表把「发生过多少次动作」独立存下来，只加不减。
--
-- ★ 纯新增表，不改任何既有表、不动任何既有数据（对线上是安全变更）。
--   历史回填由 `npm run backfill:activity` 单独执行（幂等，见该脚本注释）。
--
-- ★ SQL 由 `prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma`
--   生成后摘取，索引名 / 外键名与 Prisma 惯例逐字一致（避免以后 `migrate diff` 报漂移）。

-- CreateTable
CREATE TABLE `agenttodo_activity_day` (
    `user_id` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `created` INTEGER NOT NULL DEFAULT 0,
    `completed` INTEGER NOT NULL DEFAULT 0,
    `capsule` INTEGER NOT NULL DEFAULT 0,
    `updated_at` VARCHAR(191) NOT NULL,

    INDEX `agenttodo_activity_day_user_id_idx`(`user_id`),
    PRIMARY KEY (`user_id`, `day`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agenttodo_activity_day` ADD CONSTRAINT `agenttodo_activity_day_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `agenttodo_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
