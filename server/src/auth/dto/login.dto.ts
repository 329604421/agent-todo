import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** `POST /auth/login` 入参（§6.3） */
export class LoginDto {
  /** `wx.login` 拿到的临时 code —— 只能用一次、5 分钟失效 */
  @IsString()
  @IsNotEmpty({ message: '缺少登录凭证' })
  @MaxLength(128)
  code: string;
}
