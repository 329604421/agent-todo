import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { MindmapAiService } from './mindmap-ai.service';

/**
 * 大模型相关能力（278「提示词增强」＋ 280「语义转脑图」）。
 *
 * ★ `AiService`（278）：**零数据库依赖** —— 只做"文本进、文本出"，不碰库。
 * ★ `MindmapAiService`（280）：**要写库**（占位卡 ＋ 完成后回写树 ＋ 启动清扫），
 *   所以它注入 `PrismaService`（`CommonModule` 是 `@Global` 的，不必在这里 import）。
 *
 * 两者放进同一个模块，是因为它们共用同一批 `ARK_*` 环境变量与同一个 `env()`
 * （见 `ai.service.ts`）—— 分成两个模块只会让"模型配置"这件事有两处入口。
 */
@Module({
  controllers: [AiController],
  providers: [AiService, MindmapAiService],
  /* 只导出 `MindmapAiService`：`CapsulesController`（受理）与
     `MindmapsController`（重试）要用它，而 `AiService` 的入口只有自己的控制器。 */
  exports: [MindmapAiService],
})
export class AiModule {}
