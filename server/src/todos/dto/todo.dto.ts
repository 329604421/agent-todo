import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ClientId } from '../../common/client-id.decorator';
import { TODO_IMAGE_MAX, URGENCIES } from '../../common/constants';

export class TodoImageDto {
  /** 已通过 `POST /files` 上传拿到的**相对 uri** */
  @IsString()
  @MaxLength(300)
  uri: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  label?: string;

  @IsOptional()
  sort?: number;

  /** 兼容：前端从 mock 迁过来时可能带着旧 id；服务端一律重新生成，不采信 */
  @IsOptional()
  @IsString()
  id?: string;
}

export class CreateTodoDto {
  /** 客户端自带 id（可选）—— 见 common/client-id.decorator.ts */
  @ClientId()
  id?: string;

  @IsString()
  @MaxLength(2000, { message: '待办文字最长 2000 字' })
  text: string;

  @IsString()
  projectId: string;

  @IsIn(URGENCIES as unknown as string[], { message: '紧急程度取值不合法' })
  urgency: string;

  /** 协同关联，可空（FR-3.4）—— 非空时必须属于同一个 `projectId` */
  @IsOptional()
  @IsString()
  mindmapId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TODO_IMAGE_MAX, { message: `最多 ${TODO_IMAGE_MAX} 张图片` })
  @ValidateNested({ each: true })
  @Type(() => TodoImageDto)
  images?: TodoImageDto[];
}

/**
 * 编辑（§6.5）—— 全字段可选。
 *
 * ★ 两条联动规则必须实现（需求 `FR-3.9`）：
 *   ① 换 `projectId` 时，若原 `mindmapId` 不属于新项目 → **自动置空**；
 *   ② `mindmapId` 要清空时**必须传显式 `null`**，不能靠"字段缺失"表达清空
 *      —— 所以这里的 `mindmapId` 用 `IsOptional()`：`undefined` 跳过校验（＝不动它），
 *        `null` 也能通过（`IsOptional` 对 null 同样跳过）⇒ service 里再区分这两者。
 */
export class UpdateTodoDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: '待办文字最长 2000 字' })
  text?: string;

  @IsOptional()
  @IsIn(URGENCIES as unknown as string[], { message: '紧急程度取值不合法' })
  urgency?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  @IsOptional()
  mindmapId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TODO_IMAGE_MAX, { message: `最多 ${TODO_IMAGE_MAX} 张图片` })
  @ValidateNested({ each: true })
  @Type(() => TodoImageDto)
  images?: TodoImageDto[];
}

/**
 * ★★ 248 轮：**关联 / 解除关联闪念胶囊** 的入参（`POST` 与 `DELETE /todos/:id/capsules` 共用）。
 *
 * 用户口径（2026-10-23）：「点击『+选择胶囊』弹出选择胶囊的抽屉……**可多选卡片**，
 * 底部按键为『取消』『保存』」⇒ 一次交上来是一批 id。
 *
 * ⚠️ 上限 100：与"胶囊在一个时刻相对是少的"这条口径相称，同时挡住畸形请求。
 * ⚠️ 除了"是个字符串数组"之外**不做形态校验** —— 服务端只认"属于自己、还没被删 /
 *    还没被消费 / 还没被关联"的那些 id，传错了就是"关联 0 条"，不报错
 *    （与胶囊那边 `promoteToTodo` 同一条：前端拿着陈旧快照是常态）。
 */
export class LinkCapsulesDto {
  @IsArray()
  @ArrayMaxSize(100, { message: '一次最多关联 100 枚胶囊' })
  @IsString({ each: true })
  capsuleIds: string[];
}
