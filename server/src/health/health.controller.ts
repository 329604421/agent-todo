import { Controller, Get } from '@nestjs/common';
import { nowStr } from '../common/time';

/**
 * `GET /api/v1/health` —— 部署自检与外部拨测用（§10.4 / §10.6）。
 *
 * ★ 返回里带 `version` 与 `time`：排查时最有用的一句就是"线上到底是哪一版、
 *   服务器时间对不对" —— 时间字段还能顺带证明时区口径没被改坏。
 */
@Controller('health')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      version: process.env.APP_VERSION || '1.0.0',
      time: nowStr(),
      uptime: Math.round(process.uptime()),
    };
  }
}
