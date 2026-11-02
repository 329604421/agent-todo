import { Module } from '@nestjs/common';
import { AsrController } from './asr.controller';
import { AsrService } from './asr.service';

@Module({
  controllers: [AsrController],
  providers: [AsrService],
})
export class AsrModule {}
