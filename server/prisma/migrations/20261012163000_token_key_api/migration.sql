-- 模型厂家 key：从「手填余额」改为「存 API key + 自动查余额」
--
-- ★ 背景（2026-10-12 · 用户口径）：
--   「在我的页面中，Token API 功能目前是个假的，我想将其功能实现：
--     ① 添加 api 时模型厂商限定为下拉菜单，目前只有 DeepSeek；
--     ② 调研一下获取当前余额需要填入什么信息，是 api key 吗（**是**）；
--     ③ 用户填入的这个 key 信息需要保存到用户表中进行记录；
--     ④ 用户点击进入「我的」页面后就触发查询动作，更新余额信息；
--     ⑤ 用户可以添加同一个模型厂商多个账号，应用就是查询显示余额。」
--
-- ★ 四列，三种语义：
--   · `api_key_cipher` —— 厂家 API key 的 AES-256-GCM **密文**（见 src/common/secrets.ts）。
--                         明文永不入库、永不出参；出参只给 `key_mask`。
--   · `key_mask`       —— 'sk-****abcd'。库里的**非敏感**副产物：列表直接用，省一次解密。
--   · `balance_at`     —— 余额**最后一次查询成功**的时间。与 `updated_at` 分开：
--                         `updated_at` 记「配置最后一次被改」，`balance_at` 记「数是什么时候的」——
--                         查询失败时**不写**它，于是卡片上的「更新于 X」不会撒谎。
--   · `last_error`     —— 最近一次查询失败的原因（成功时清空），供「我的」页显示失败提示。
--
-- ★ 纯新增列，**不改任何既有列、不动任何既有数据**（对线上是安全变更）。
--   上线后**不需要回填**：既有行的四个新列都是 null ＝ 「还没配 key、也还没查过」，
--   前端据此显示「待配置」，与改前的"手填余额"在语义上明确区分开。
--
-- ★ 索引不动：既有 `(user_id)` 已经覆盖「按用户取全部 key」这条唯一的查询路径。
--
-- ★ SQL 按 Prisma 惯例手写（列名 / 类型逐字对齐 schema.prisma，避免以后 `migrate diff` 报漂移）。

-- AlterTable · 模型厂家 key：加 key 密文 / 掩码 / 余额时间 / 失败原因 四列
ALTER TABLE `agenttodo_token_key` ADD COLUMN `api_key_cipher` VARCHAR(512) NULL,
    ADD COLUMN `key_mask` VARCHAR(64) NULL,
    ADD COLUMN `balance_at` VARCHAR(191) NULL,
    ADD COLUMN `last_error` VARCHAR(191) NULL;
