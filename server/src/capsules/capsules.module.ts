import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { CapsulesController } from './capsules.controller';
import { CapsulesService } from './capsules.service';

@Module({
  /* ★ 280 轮：`POST /capsules/to-mindmap-ai`（语义转脑图的受理端）要注入
     `MindmapAiService` —— 它在 AiModule 里。没有循环依赖：AiModule 不认识胶囊模块。 */
  imports: [AiModule],
  controllers: [CapsulesController],
  providers: [CapsulesService],
})
export class CapsulesModule {}
