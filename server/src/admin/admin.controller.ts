import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { AdminTokenGuard } from '../common/auth/admin-token.guard';
import { PrismaService } from '../common/prisma.service';
import { nowStr } from '../common/time';

export class AddAllowlistDto {
  @IsString()
  @Length(10, 64, { message: 'openid 长度不对' })
  openid: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  note?: string;
}

/**
 * 管理接口（§7.3）—— **只有你知道**的那几个入口。
 *
 * ★ 加朋友的流程（这就是「待批列表」存在的全部理由）：
 *   ① 让朋友先打开一次小程序 → 他被 `1002` 拒绝，后端记一行；
 *   ② 你 `GET /admin/pending` 看到他的 openid；
 *   ③ `POST /admin/allowlist` 插进白名单 → 他再打开就能用。
 *
 *   没有这一步你**无从知道朋友的 openid 是什么** —— openid 只能由微信侧给出，不能手填。
 *
 * ★ 安全：用**独立的 `X-Admin-Token`**（环境变量），**绝不与非管理接口共用用户 token**
 *   —— 用户 token 会随小程序包分发到客户端。
 */
@Controller('admin')
@UseGuards(AdminTokenGuard)
export class AdminController {
  constructor(private readonly prisma: PrismaService) {}

  /** 被 1002 拒绝过、还没加白名单的人 */
  @Get('pending')
  async pending() {
    const rows = await this.prisma.pendingUser.findMany({ orderBy: { lastSeen: 'desc' } });
    const allowed = await this.prisma.allowlist.findMany({ select: { openid: true } });
    const allowedSet = new Set(allowed.map((a) => a.openid));
    return rows.map((r) => ({
      openid: r.openid,
      hitCount: r.hitCount,
      firstSeen: r.firstSeen,
      lastSeen: r.lastSeen,
      alreadyAllowed: allowedSet.has(r.openid),
    }));
  }

  @Get('allowlist')
  allowlist() {
    return this.prisma.allowlist.findMany({ orderBy: { createdAt: 'asc' } });
  }

  @Post('allowlist')
  async add(@Body() dto: AddAllowlistDto) {
    const openid = String(dto.openid).trim();
    const row = await this.prisma.allowlist.upsert({
      where: { openid },
      create: { openid, note: dto.note || '', createdAt: nowStr() },
      update: { note: dto.note || '' },
    });
    // 加进白名单之后，把它从待批列表里清掉（否则那张表会越看越乱）
    await this.prisma.pendingUser.deleteMany({ where: { openid } });
    return row;
  }

  @Delete('allowlist/:openid')
  async remove(@Param('openid') openid: string) {
    await this.prisma.allowlist.deleteMany({ where: { openid } });
    return { openid, deleted: true };
  }
}
