-- CreateTable
CREATE TABLE `agenttodo_user` (
    `id` VARCHAR(191) NOT NULL,
    `openid` VARCHAR(191) NOT NULL,
    `nickname` VARCHAR(191) NOT NULL DEFAULT '我的工位',
    `avatar` VARCHAR(191) NULL,
    `created_at` VARCHAR(191) NOT NULL,
    `updated_at` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `agenttodo_user_openid_key`(`openid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenttodo_allowlist` (
    `openid` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NOT NULL DEFAULT '',
    `created_at` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`openid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenttodo_pending_user` (
    `openid` VARCHAR(191) NOT NULL,
    `hit_count` INTEGER NOT NULL DEFAULT 1,
    `first_seen` VARCHAR(191) NOT NULL,
    `last_seen` VARCHAR(191) NOT NULL,
    `note` VARCHAR(191) NOT NULL DEFAULT '',

    PRIMARY KEY (`openid`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenttodo_project` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `remark` VARCHAR(191) NOT NULL DEFAULT '',
    `node` VARCHAR(191) NOT NULL DEFAULT '构思期',
    `color` VARCHAR(191) NULL,
    `agent_id` VARCHAR(191) NULL,
    `archived_at` VARCHAR(191) NULL,
    `created_at` VARCHAR(191) NOT NULL,
    `updated_at` VARCHAR(191) NOT NULL,

    INDEX `agenttodo_project_user_id_archived_at_idx`(`user_id`, `archived_at`),
    UNIQUE INDEX `agenttodo_project_user_id_color_key`(`user_id`, `color`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenttodo_todo` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `mindmap_id` VARCHAR(191) NULL,
    `raw_text` VARCHAR(191) NOT NULL,
    `draft_text` VARCHAR(191) NULL,
    `urgency` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'open',
    `created_at` VARCHAR(191) NOT NULL,
    `completed_at` VARCHAR(191) NULL,
    `updated_at` VARCHAR(191) NOT NULL,

    INDEX `agenttodo_todo_user_id_project_id_idx`(`user_id`, `project_id`),
    INDEX `agenttodo_todo_user_id_updated_at_idx`(`user_id`, `updated_at`),
    INDEX `agenttodo_todo_user_id_created_at_idx`(`user_id`, `created_at`),
    INDEX `agenttodo_todo_user_id_completed_at_idx`(`user_id`, `completed_at`),
    INDEX `agenttodo_todo_mindmap_id_idx`(`mindmap_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenttodo_todo_image` (
    `id` VARCHAR(191) NOT NULL,
    `todo_id` VARCHAR(191) NOT NULL,
    `uri` VARCHAR(191) NOT NULL,
    `label` VARCHAR(191) NULL,
    `sort` INTEGER NOT NULL DEFAULT 0,

    INDEX `agenttodo_todo_image_todo_id_idx`(`todo_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenttodo_mindmap` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `project_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `format` VARCHAR(191) NOT NULL DEFAULT 'mindmap',
    `tree_json` JSON NOT NULL,
    `node_count` INTEGER NOT NULL DEFAULT 1,
    `depth` INTEGER NOT NULL DEFAULT 1,
    `created_at` VARCHAR(191) NOT NULL,
    `updated_at` VARCHAR(191) NOT NULL,

    INDEX `agenttodo_mindmap_user_id_project_id_idx`(`user_id`, `project_id`),
    INDEX `agenttodo_mindmap_user_id_updated_at_idx`(`user_id`, `updated_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenttodo_capsule` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `text` VARCHAR(191) NOT NULL DEFAULT '',
    `source` VARCHAR(191) NOT NULL DEFAULT 'voice',
    `created_at` VARCHAR(191) NOT NULL,

    INDEX `agenttodo_capsule_user_id_created_at_idx`(`user_id`, `created_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenttodo_agent` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `quota_left` INTEGER NULL,
    `monthly_quota` INTEGER NULL,
    `quota_reset_at` VARCHAR(191) NULL,
    `created_at` VARCHAR(191) NOT NULL,
    `updated_at` VARCHAR(191) NOT NULL,

    INDEX `agenttodo_agent_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenttodo_token_key` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `vendor` VARCHAR(191) NOT NULL,
    `balance` INTEGER NULL,
    `created_at` VARCHAR(191) NOT NULL,
    `updated_at` VARCHAR(191) NOT NULL,

    INDEX `agenttodo_token_key_user_id_idx`(`user_id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `agenttodo_asr_quota` (
    `user_id` VARCHAR(191) NOT NULL,
    `day` VARCHAR(191) NOT NULL,
    `used` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`user_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `agenttodo_project` ADD CONSTRAINT `agenttodo_project_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `agenttodo_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenttodo_project` ADD CONSTRAINT `agenttodo_project_agent_id_fkey` FOREIGN KEY (`agent_id`) REFERENCES `agenttodo_agent`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenttodo_todo` ADD CONSTRAINT `agenttodo_todo_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `agenttodo_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenttodo_todo` ADD CONSTRAINT `agenttodo_todo_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `agenttodo_project`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenttodo_todo` ADD CONSTRAINT `agenttodo_todo_mindmap_id_fkey` FOREIGN KEY (`mindmap_id`) REFERENCES `agenttodo_mindmap`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenttodo_todo_image` ADD CONSTRAINT `agenttodo_todo_image_todo_id_fkey` FOREIGN KEY (`todo_id`) REFERENCES `agenttodo_todo`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenttodo_mindmap` ADD CONSTRAINT `agenttodo_mindmap_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `agenttodo_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenttodo_mindmap` ADD CONSTRAINT `agenttodo_mindmap_project_id_fkey` FOREIGN KEY (`project_id`) REFERENCES `agenttodo_project`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenttodo_capsule` ADD CONSTRAINT `agenttodo_capsule_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `agenttodo_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenttodo_agent` ADD CONSTRAINT `agenttodo_agent_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `agenttodo_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `agenttodo_token_key` ADD CONSTRAINT `agenttodo_token_key_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `agenttodo_user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
