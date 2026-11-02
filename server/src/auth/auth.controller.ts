import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

/**
 * 鉴权接口（§6.3）—— 全项目**唯一不需要 token** 的业务接口。
 * `POST /api/v1/auth/login`
 */
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.code);
  }
}
