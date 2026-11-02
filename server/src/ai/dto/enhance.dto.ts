import { IsString, MaxLength, MinLength } from 'class-validator';

export class EnhanceDto {
  /**
   * 要增强的文本（导出抽屉里那一份：原文 ＋ 脑图 Markdown ＋ 胶囊段）。
   *
   * ★ 下限 1：空串在业务上就是"没有可增强的内容"，让它走 2001 而不是白烧一次模型调用。
   *
   * ★★ 上限 **16000** 而不是方案初稿的 20000 —— 这条是被 `main.ts` 的
   *    `json({ limit: '64kb' })` 顶出来的，算一遍就清楚：
   *      · 中文在 UTF-8 里 3 字节 ⇒ 16000 字 ≈ 48 KB；
   *      · 导出物里还常有 emoji（4 字节/字）与 `![]()` 这些 ASCII；
   *      · JSON 外壳（`{"text":"…"}`）再加几十字节。
   *    取 16000 留出约 16 KB 余量。**别写成 20000** —— 那样"全是 emoji 的极端输入"
   *    会被 body-parser 直接 413，用户看到的是一个没有成因的失败，
   *    比"内容过长"这条明确文案糟得多。
   *    ⚠️ 前端阈值是 12000（判据 E14：前端必须 ≤ 后端），所以正常路径根本碰不到这里。
   */
  @IsString()
  @MinLength(1, { message: '没有可增强的内容' })
  @MaxLength(16000, { message: '内容过长，暂不支持增强' })
  text: string;
}
