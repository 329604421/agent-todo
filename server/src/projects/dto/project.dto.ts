import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ClientId } from '../../common/client-id.decorator';
import { PROJECT_COLORS, PROJECT_NODES } from '../../common/constants';

/**
 * 项目创建 / 编辑入参（§6.4）。
 *
 * ★ `name` **可改、允许重名、无唯一校验** —— 需求原文如此。
 *   两个项目撞名后靠「颜色 ＋ 所属 agent」区分，所以颜色才是唯一性约束的载体。
 * ★ `color` / `agentId` 允许 null 与空串，两者同义（都表示"不关联"）。
 */
export class CreateProjectDto {
  /** 客户端自带 id（可选，让前端乐观更新能同步拿到 id）—— 见 common/client-id.decorator.ts */
  @ClientId()
  id?: string;

  /** 缺省 ⇒ 后端生成「未命名项目 N」（§6.4） */
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: '项目名最长 60 个字' })
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;

  @IsOptional()
  @IsIn(PROJECT_NODES as unknown as string[], { message: '项目节点取值不合法' })
  node?: string;

  /** 8 色槽位 key；null / '' ＝ 不着色（多个项目可以同时不着色） */
  @IsOptional()
  @IsIn(PROJECT_COLORS as unknown as string[], { message: '项目色取值不合法' })
  color?: string | null;

  /** 关联 agent；null / '' ＝ 不关联 */
  @IsOptional()
  @IsString()
  agentId?: string | null;
}

/** 编辑 —— 全可选；显式传 `null` 表示"清空该关联" */
export class UpdateProjectDto extends CreateProjectDto {}
