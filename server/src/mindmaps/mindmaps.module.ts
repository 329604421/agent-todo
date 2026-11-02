import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { MindmapsController } from './mindmaps.controller';
import { MindmapsService } from './mindmaps.service';

@Module({
  /* ★ 280 轮：`POST /mindmaps/:id/ai-retry`（语义转脑图重试）要注入 `MindmapAiService`。 */
  imports: [AiModule],
  controllers: [MindmapsController],
  providers: [MindmapsService],
})
export class MindmapsModule {}
