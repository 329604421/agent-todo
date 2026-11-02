import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ClientId } from '../../common/client-id.decorator';

/**
 * 模型厂家 key（§6.8 · Token API）。
 *
 * ★★ 2026-10-12 改造（用户口径「我想将其功能实现」）：
 *   · `vendor` 从**自由文本**收紧为**厂商标识**（白名单 `vendors.ts` 里的 `code`）——
 *     前端只给"选"、不给"输"，后端再独立校验一次；
 *   · 新增 `apiKey`（厂家 API key 明文）—— 服务端加密后入库，**永不回传**；
 *   · ❌ 去掉 `balance`（手填余额）：余额从本轮起由**查询**写入，表单不再有这一项。
 *     ⚠️ 老版本客户端仍可能发它 —— ValidationPipe 的 whitelist 会直接剥掉，不影响；
 *        数据层也不删既有余额值（`refresh` 会按查询结果覆盖它）。
 */
export class CreateTokenKeyDto {
  /** 客户端自带 id（可选）—— 见 common/client-id.decorator.ts */
  @ClientId()
  id?: string;

  /** 厂商标识（`deepseek`）—— 白名单校验在 service 里做（DTO 只管长度与类型） */
  @IsString()
  @MaxLength(32, { message: '厂商标识最长 32 个字' })
  vendor: string;

  /**
   * 厂家 API key（明文）。
   * ⚠️ 它只在**这一次请求**里出现：服务端加密成 `apiKeyCipher` 入库，出参只有 `keyMask`。
   */
  @IsString()
  @MaxLength(256, { message: 'API Key 最长 256 个字符' })
  apiKey: string;
}

export class UpdateTokenKeyDto {
  @IsOptional()
  @IsString()
  @MaxLength(32, { message: '厂商标识最长 32 个字' })
  vendor?: string;

  /**
   * 换一把 key —— **不传表示不动它**（不能传空串"清空"，那会造出一张永远查不到余额的记录）。
   * ⚠️ 换 key 会连带清掉旧余额、旧查询时间与旧失败原因（那把 key 的数已经没有意义了）。
   */
  @IsOptional()
  @IsString()
  @MaxLength(256, { message: 'API Key 最长 256 个字符' })
  apiKey?: string;
}
