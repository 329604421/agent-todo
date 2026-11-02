-- 2026-10-20 · 文本列宽度修复（移动端长语音「服务开小差了」的根因）
--
-- 症状（用户 2026-10-20 报）：手机端录一段**较长**的语音 → 结束录音弹「服务开小差了」
--   → 识别出的文字先显示出来 → 过一会儿又消失 → 气泡退回「语音识别中」。
--
-- 根因链（四条，缺一不可）：
--   ① Prisma 的 MySQL provider 在**没有 `@db.*` 注解**时把 `String` 建成 `VARCHAR(191)`，
--      而胶囊 / 待办的 DTO 允许 2000 字 ⇒ 只要正文超过 191 个字符，MySQL 在 STRICT 模式下拒写。
--   ② 拒写抛的是 Prisma `P2000`（column too long），而 `api-exception.filter.ts` 的
--      `mapPrismaError()` 只认 P2002/P2003/P2025 ⇒ 落到「未捕获」兜底 ⇒ 500 + 5000
--      「服务开小差了」（生产环境不返回真因）。
--   ③ 前端 `store.queue()` 的失败分支是**整块回滚快照** ⇒ 那条胶囊的 `text` 退回空串。
--   ④ 模板按 `item.text || (failed ? '没听清…' : '语音识别中')` 渲染 ⇒ 空串 + 无 failed 标记
--      ＝ 「语音识别中」，而且 `_pending` 已删 ⇒ 它**不呼吸、永远钉在那儿**。
--
-- 为什么只在"长语音"上出现：短语音识别结果通常 < 191 字，写进去正好没超。
--
-- 一次把同类列全部放宽（都是"用户输入的正文"，DTO 上限都 > 191）：
--   capsule.text        2000 字上限 → TEXT
--   todo.raw_text       2000 字上限 → TEXT
--   todo.draft_text     2000 字上限 → TEXT
--   project.remark       500 字上限 → TEXT
--   user.avatar          300 字上限 → VARCHAR(512)（它是 uri，不是正文，不用 TEXT）
--
-- ⚠️ TEXT **不能有 DEFAULT**（MySQL 5.7 明确禁止；8.0.13+ 只支持表达式默认值），
--    所以这里不带 `DEFAULT ''`。三条写入路径（capsules.service.create /
--    todos.service.create / projects.service.create）**都显式传值**，不依赖默认值。
--    ⚠️ 以后新增写入路径必须显式给这几个字段，否则 STRICT 模式下会报
--    "Field 'xxx' doesn't have a default value"。

ALTER TABLE `agenttodo_capsule` MODIFY `text` TEXT NOT NULL;
ALTER TABLE `agenttodo_todo` MODIFY `raw_text` TEXT NOT NULL;
ALTER TABLE `agenttodo_todo` MODIFY `draft_text` TEXT NULL;
ALTER TABLE `agenttodo_project` MODIFY `remark` TEXT NOT NULL;
ALTER TABLE `agenttodo_user` MODIFY `avatar` VARCHAR(512) NULL;

-- 同一个隐患的第二处：DTO 允许 300 字，列只有 191（虽然 uri 现实中很短，但**声明与实现必须一致**，
-- 否则哪天换成长文件名 / 带前缀的 URI 就会静默炸在这一行上）。
ALTER TABLE `agenttodo_todo_image` MODIFY `uri` VARCHAR(512) NOT NULL;
