import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { ClientId } from '../../common/client-id.decorator';

/**
 * agent 手填字段（FR-6.1 · §6.8）
 *
 * ★ 额度是**积分**（纯整数、无单位）—— 但前端表单里是**手填的字符串**（'1240'、'¥ 500'），
 *   所以这里声明成 `string | number` 都收，在 service 里用与前端 `store.amountOf()`
 *   同一套口径解析成整数。两端解析口径不一致的症状是「填进去 1240，回来变成 null」。
 *
 * ⚠️ 更新 DTO **刻意不写成 `extends CreateAgentDto`**：
 *   TS 里要给继承来的字段加 `@IsOptional()` 就得用 `declare` 重新声明，
 *   而 `declare` 字段上挂装饰器在 TS 里是非法的（会编译报错）。两个 DTO 各写一遍更省事也更清楚。
 */
export class CreateAgentDto {
  /** 客户端自带 id（可选）—— 见 common/client-id.decorator.ts */
  @ClientId()
  id?: string;

  @IsString()
  @MaxLength(40, { message: 'agent 名最长 40 个字' })
  name: string;

  @IsOptional()
  quotaLeft?: string | number | null;

  @IsOptional()
  monthlyQuota?: string | number | null;

  /** ★ 只记**日**（如 `'15'`）—— 各家 agent 都按**自然月**重置，月份填了也没有信息量（133 轮） */
  @IsOptional()
  @IsString()
  @Matches(/^(0[1-9]|[12]\d|3[01])$/, { message: '额度重置日只填「日」，写成 01–31，如 15' })
  quotaResetAt?: string | null;
}

export class UpdateAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(40, { message: 'agent 名最长 40 个字' })
  name?: string;

  @IsOptional()
  quotaLeft?: string | number | null;

  @IsOptional()
  monthlyQuota?: string | number | null;

  @IsOptional()
  @IsString()
  @Matches(/^(0[1-9]|[12]\d|3[01])$/, { message: '额度重置日只填「日」，写成 01–31，如 15' })
  quotaResetAt?: string | null;
}
