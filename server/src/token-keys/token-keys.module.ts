import { Module } from '@nestjs/common';
import { TokenKeysController } from './token-keys.controller';
import { TokenKeysService } from './token-keys.service';

@Module({
  controllers: [TokenKeysController],
  providers: [TokenKeysService],
})
export class TokenKeysModule {}
