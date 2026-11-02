import { ArrayMaxSize, IsArray, IsDefined, IsIn, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';
import { ClientId } from '../../common/client-id.decorator';
import { MINDMAP_FORMATS } from '../../common/constants';
import { TREE_MAX_NODES } from '../../common/tree';

export class CreateMindmapDto {
  /** 客户端自带 id（可选）—— 见 common/client-id.decorator.ts */
  @ClientId()
  id?: string;

  @IsString()
  projectId: string;

  @IsOptional()
  @IsString()
  @MaxLength(60, { message: '脑图名最长 60 个字' })
  name?: string;

  @IsOptional()
  @IsIn(MINDMAP_FORMATS as unknown as string[], { message: '脑图格式取值不合法' })
  format?: string;
}

export class UpdateMindmapDto {
  @IsOptional()
  @IsString()
  @MaxLength(60, { message: '脑图名最长 60 个字' })
  name?: string;

  @IsOptional()
  @IsString()
  projectId?: string;

  /**
   * ★ 280 轮：「归属 agent」。
   *
   * ★★ 2026-10-27（用户口径变更）：**这个值服务端不再采信** —— 脑图的归属 agent
   *    由「所属项目」决定（用户原话："用户选择了归属项目就已经确定了归属 agent"）。
   *    字段保留只为**兼容还在传它的旧客户端**：`service.update` 会校验一遍越权
   *    （不属于本人的 agent 直接报错），然后**不写入** —— 真正的值由 `projectId`
   *    那一支按项目推导。前端新版本已经不再发它。
   *
   * ⚠️ **必须挂校验装饰器**，与 `SaveTreeDto` 同一条理由：`whitelist: true` 会把
   *    裸声明的字段整段剥掉 ⇒ `dto.agentId` 恒 `undefined` ⇒ 越权校验静默失效。
   *
   * 允许 `null`（`@IsOptional` 会放过它）。
   */
  @IsOptional()
  @IsString()
  agentId?: string | null;

  /* ★ 280 轮：`''` 是**合法的一档**（＝格式未设置），不是"没传"。
     为什么必须放行：语义转脑图的占位脑图 `format` 就是 `''`，
     完善抽屉若把当前值原样回传（表单初始值就是它），只收六档会直接报
     「脑图格式取值不合法」—— 用户点了保存却被告知自己的图不合法。 */
  @IsOptional()
  @IsIn([...MINDMAP_FORMATS, ''] as unknown as string[], { message: '脑图格式取值不合法' })
  format?: string;
}

/** `PUT /mindmaps/:id/tree` —— 只收 `treeJson`，**不收** nodeCount/depth（服务端重算，§6.6） */
export class SaveTreeDto {
  /**
   * ★★ 这里**必须**挂校验装饰器，不能只写 `treeJson: any;`。
   *
   *    `main.ts` 的 ValidationPipe 开了 `whitelist: true` —— 它会把**没有任何
   *    校验装饰器的字段整段剥掉**（本意是挡掉客户端硬塞的 `userId` 一类越权字段）。
   *    裸声明的话 `dto.treeJson` 恒为 `undefined`，一路传到
   *    `normalizeTree(undefined)` 就抛「脑图结构不正确（不是一棵树）」，
   *    于是 **`PUT /mindmaps/:id/tree` 永远失败，连合法树都存不进去**
   *    —— 也就是"画完脑图点保存，永远是保存失败"。
   *
   *    ⚠️ 这个 bug 靠负向断言是发现不了的：非法树本来就该被拒，
   *       "非法树被拒"这一条会一直是通过的。**必须先证明合法树能存进去。**
   *
   *    树的**结构合法性只由 `normalizeTree()` 一个人负责**（它能给出一句人话的错误），
   *    这里只设类型门槛，不重复实现一遍树校验。
   */
  @IsDefined({ message: '缺少 treeJson' })
  @IsObject({ message: 'treeJson 必须是一个对象' })
  treeJson: any;
}

/**
 * ★★ 199 轮：`POST /mindmaps/:id/seen` —— 清掉若干节点上的「刚转过来」标记。
 *
 * 触发时机：用户在画布上**选中**了那枚节点（＝"我看过它了"）。
 *
 * ⚠️ **必须挂校验装饰器**，与 `SaveTreeDto` 是同一条理由：
 *    `main.ts` 的 ValidationPipe 开了 `whitelist: true` —— 任何**没有校验装饰器**的字段
 *    会被整段剥掉。`nodeIds` 写成裸声明的话它恒为 `undefined`，
 *    于是"标记永远清不掉"，而且**不报错**（接口照常 200，只是什么都没变）。
 */
export class MarkSeenDto {
  /** 要清掉标记的节点 id 列表 —— 空数组合法（＝无操作，幂等） */
  @IsArray()
  @ArrayMaxSize(TREE_MAX_NODES, { message: '一次最多处理这么多节点' })
  @IsString({ each: true })
  nodeIds: string[];
}
