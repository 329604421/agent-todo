import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { AiService } from './ai.service';
import { EnhanceDto } from './dto/enhance.dto';

/**
 * `POST /api/v1/ai/enhance` —— 提示词增强（★ 278 轮）。
 *
 * ★ 挂 `JwtAuthGuard`：这是一个**花钱的**接口（每次调用都是一次真实 token 计费），
 *   必须与其余业务接口同一道门。**绝不能因为"只是文本处理"就放成公开接口** ——
 *   公网上的 `POST /ai/enhance` 等于给所有人一个免费的模型代理。
 *
 * ★ 返回 `{ text, model, notice }`：`model` 回给前端只是为了让"日志里的模型"与
 *   "用户看到的"在排障时能对上，界面上不展示；`notice` 是回填器的报告（link-guard.ts），
 *   只在"图片被挪到末尾 / 去重 / 剥掉幽灵占位符 / 次序被打乱"时非空 ——
 *   正常情况是空串，前端不渲染、不占高度。
 *
 * ★ 不读写任何业务数据：整个功能是"读一段文本 → 调模型 → 回一段文本"，零副作用。
 *   所以这里没有事务、没有 prisma、没有 clientId（客户端幂等键）—— 它不产生持久化对象。
 */
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Post('enhance')
  enhance(@CurrentUser() me: AuthUser, @Body() dto: EnhanceDto) {
    return this.ai.enhance(me.userId, dto.text);
  }
}
