import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { SyncService } from './sync.service';

/** `GET /api/v1/sync` —— 全量快照（§6.2） */
@Controller('sync')
@UseGuards(JwtAuthGuard)
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get()
  snapshot(@CurrentUser() me: AuthUser) {
    return this.sync.snapshot(me.userId);
  }
}
