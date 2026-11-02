import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { PrismaService } from '../common/prisma.service';
import { meOut } from '../common/shape';
import { nowStr } from '../common/time';

export class UpdateMeDto {
  /** 用户名（必填语义由前端保证；这里限额与去空白） */
  @IsOptional()
  @IsString()
  @MaxLength(40, { message: '用户名最长 40 个字' })
  nickname?: string;

  /** 头像 —— 传上传接口拿到的**相对 uri**；空串表示恢复默认图标 */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  avatar?: string;
}

/** 个人资料（§6.3）· `D-9` 登记的两项 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async get(@CurrentUser() me: AuthUser) {
    const user = await this.prisma.user.findUnique({ where: { id: me.userId } });
    return meOut(user);
  }

  @Patch()
  async update(@CurrentUser() me: AuthUser, @Body() dto: UpdateMeDto) {
    const data: any = { updatedAt: nowStr() };
    if (dto.nickname !== undefined) {
      const name = String(dto.nickname).trim();
      // 前端「用户名（必填）」—— 空串落在后端就退回默认名，而不是存一个空名字
      data.nickname = name || '我的工位';
    }
    if (dto.avatar !== undefined) data.avatar = dto.avatar || null;

    const user = await this.prisma.user.update({ where: { id: me.userId }, data });
    return meOut(user);
  }
}
