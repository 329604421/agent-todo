import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ClientId } from '../../common/client-id.decorator';
import { CAPSULE_SOURCES, IMAGE_URI_RE, TODO_IMAGE_MAX, URGENCIES } from '../../common/constants';
import { TodoImageDto } from '../../todos/dto/todo.dto';

/** `POST /capsules` —— ★ `text` **允许空串**（识别未回时就是空串，需求 §7.1 明确） */
export class CreateCapsuleDto {
  /** 客户端自带 id（可选）—— ★ 这条尤其要紧：胶囊是"张口就来"，
   *  识别文本回来时要能**立刻**写回同一条，中间不能有一次 id 替换 */
  @ClientId()
  id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: '胶囊文字最长 2000 字' })
  text?: string;

  /** 一期前端恒传 `voice`；留 `text` 是为了将来有手打入口时不用改契约 */
  @IsOptional()
  @IsIn(CAPSULE_SOURCES as unknown as string[], { message: 'source 取值不合法' })
  source?: string;

  /**
   * ★★ 263 轮（清单 H1）· 挂一张图 —— `POST /files` 返回的**相对 uri**。
   *
   * ⚠️ 只收相对路径，**不收完整 URL**：库里落 URL 的话，域名一换全库的图就都是死链
   *   （§4.5 的同一条纪律，`TodoImage.uri` 也守着它）。拼 URL 是客户端的显式动作。
   * ⚠️ `@MaxLength(512)` **必须 ≤ 列宽**（`image_uri` 就是 `VARCHAR(512)`）——
   *   超一格的后果是 Prisma 抛 P2000，前端看到的是 50000 而不是"图太长了"。
   * ⚠️ 归属校验（uri 必须带自己的 userId 前缀）在 `CapsulesService` 里做，
   *   因为那需要 `userId`，而 DTO 这一层拿不到（也不该去拿）。
   */
  @IsOptional()
  @IsString()
  @MaxLength(512, { message: '图片路径过长' })
  @Matches(IMAGE_URI_RE, { message: '图片路径不合法' })
  imageUri?: string;
}

/** `PATCH /capsules/:id` —— 就地改错字；★ **不得刷新 `createdAt`**（FR-9.4） */
export class UpdateCapsuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(2000, { message: '胶囊文字最长 2000 字' })
  text?: string;

  /**
   * 换图 / 撤图（263 轮）。
   * · 传 `null` ⇒ **撤掉这张图**（`@IsOptional()` 对 `null` 放行，Service 里显式写 `null`）；
   * · 不传（`undefined`）⇒ 一个字都不动；
   * · 传相对 uri ⇒ 换成这一张（上限 1 张，"选新的会替换掉当前的"）。
   * ⚠️ 三态必须分清：把"没传"当成"撤图"，会让每一次改错字都把图顺手删掉。
   */
  @IsOptional()
  @IsString()
  @MaxLength(512, { message: '图片路径过长' })
  @Matches(IMAGE_URI_RE, { message: '图片路径不合法' })
  imageUri?: string | null;
}

/** `DELETE /capsules` —— 批量删除（多选模式用），省掉 N 次请求 */
export class DeleteCapsulesDto {
  @IsArray()
  @ArrayNotEmpty({ message: '请至少选择一条' })
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids: string[];
}

/**
 * `POST /capsules/restore` —— ★★ 160 轮新增：批量**还原**已删除的胶囊。
 *
 * 形状与 `DeleteCapsulesDto` 逐字相同，**仍然单独一个类**：两者的校验消息不同
 * （"请至少选择一条"在还原那一侧读作"请先选中要还原的胶囊"），
 * 而且 `DeleteCapsulesDto` 将来若加了删除专属的约束（比如"最多删 500 条"之外的规则），
 * 不该顺带把还原也管住 —— 一个类管一件事。
 */
export class RestoreCapsulesDto {
  @IsArray()
  @ArrayNotEmpty({ message: '请先选中要还原的胶囊' })
  @ArrayMaxSize(500)
  @IsString({ each: true })
  ids: string[];
}

/**
 * `POST /capsules/:id/promote-to-todo`
 *
 * ★ 多选合并：前端在胶囊列表里选中 N 条后只提交**一个**待办（表单里只有一个文本框，
 *   用户看到的就是"合并成一条"），所以路由上的 `:id` 只是**锚点**，
 *   真正要一起删掉的是 `capsuleIds`。两者取并集，都只认自己的胶囊。
 */
export class PromoteToTodoDto {
  /** 客户端自带 id（可选）—— 与 `POST /todos` 同一条理由：
   *  前端是**乐观更新**（本地先建好、id 已经拿去渲染了），服务端必须用同一个 id，
   *  否则本地那条待办的所有后续写操作都会打在服务端不存在的 id 上（`2002`）。 */
  @ClientId()
  id?: string;

  /** 一并消费掉的其它胶囊（多选合并时用）；不传即只消费路由上那一条 */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  capsuleIds?: string[];

  @IsString()
  projectId: string;

  /** 关联脑图（可选，表单里那一行）—— 必须属于同一个项目，否则按"没填"处理 */
  @IsOptional()
  @IsString()
  mindmapId?: string;

  @IsIn(URGENCIES as unknown as string[], { message: '紧急程度取值不合法' })
  urgency: string;

  /** 用户在表单里可能改过文本；不传则用胶囊原文 */
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  text?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(TODO_IMAGE_MAX)
  @ValidateNested({ each: true })
  @Type(() => TodoImageDto)
  images?: TodoImageDto[];
}

/** `POST /capsules/promote-to-mindmap` */
export class PromoteToMindmapDto {
  @IsString()
  @IsNotEmpty({ message: '请选择目标脑图' })
  mindmapId: string;

  @IsArray()
  @ArrayNotEmpty({ message: '请至少选择一条' })
  @ArrayMaxSize(500)
  @IsString({ each: true })
  capsuleIds: string[];
}

/**
 * `POST /capsules/to-mindmap-ai` —— **语义转脑图**（★ 280 轮）。
 *
 * 与上面那条的区别：这条路**不指定目标脑图**，服务端自己建一张新的（先占位、再生成）。
 *
 * ⚠️ `capsuleIds` 的上限 20 与 `MindmapAiService.MAX_CAPSULES` **必须一致**：
 *    DTO 这一层拦"请求太大"，服务层拦的是"合并后内容太长"，两者不是一回事。
 *    这里写死 20 而不是引常量，是因为 DTO 只该依赖 `common/constants` 里的枚举；
 *    判据 `check_mindmap_ai280` 有一条对撞：两处的数字必须相等。
 */
export class ToMindmapAiDto {
  /** 客户端自带 id（可选）—— 与 `POST /todos` 同一条理由：前端乐观更新时已经拿它渲染了卡。
   *  服务端认同一个 id ⇒ 连点两次不会建出两张卡（幂等，见 `MindmapAiService.accept`）。 */
  @ClientId()
  id?: string;

  @IsArray()
  @ArrayNotEmpty({ message: '请至少选择一条胶囊' })
  @ArrayMaxSize(20, { message: '一次最多 20 条' })
  @IsString({ each: true })
  capsuleIds: string[];
}
