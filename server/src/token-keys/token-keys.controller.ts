import { Body, Controller, Delete, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { CreateTokenKeyDto, UpdateTokenKeyDto } from './dto/token-key.dto';
import { TokenKeysService } from './token-keys.service';

/** 模型厂家 key（§6.8）—— ★ 2026-10-12 起余额是真查的（见 service 顶部说明） */
@Controller('token-keys')
@UseGuards(JwtAuthGuard)
export class TokenKeysController {
  constructor(private readonly keys: TokenKeysService) {}

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateTokenKeyDto) {
    return this.keys.create(me.userId, dto);
  }

  /**
   * ★★ 查该用户全部 key 的余额并回写 —— 进入「我的」页时由前端调用。
   *
   * ⚠️ 用 `POST` 而不是 `GET`：它会**改数据**（回写余额），不是幂等读取。
   * ⚠️ 不加节流：控制频率是前端的事（见 `mod-mine`），后端每次调用都真查 ——
   *    余额是"此刻的钱"，服务端缓存只会让用户看到过期数。
   */
  @Post('refresh')
  refresh(@CurrentUser() me: AuthUser) {
    return this.keys.refresh(me.userId);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: UpdateTokenKeyDto) {
    return this.keys.update(me.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.keys.remove(me.userId, id);
  }
}
