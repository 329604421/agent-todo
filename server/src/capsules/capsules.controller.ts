import { Body, Controller, Delete, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { MindmapAiService } from '../ai/mindmap-ai.service';
import {
  CreateCapsuleDto,
  DeleteCapsulesDto,
  PromoteToMindmapDto,
  PromoteToTodoDto,
  RestoreCapsulesDto,
  ToMindmapAiDto,
  UpdateCapsuleDto,
} from './dto/capsule.dto';
import { CapsulesService } from './capsules.service';

/**
 * 闪念胶囊（FR-9 · §6.7）
 *
 * ⚠️ 路由顺序有讲究：`promote-to-mindmap` 是**不带 `:id`** 的 POST，
 *   而 `:id/promote-to-todo` 带。两者路径形状不同，不会互抢 ——
 *   但 `DELETE /capsules`（批量）与 `DELETE /capsules/:id`（单条）是同一个方法的两条路径，
 *   必须分别声明，且批量那条要放在**前面**（Nest 按声明顺序匹配）。
 */
@Controller('capsules')
@UseGuards(JwtAuthGuard)
export class CapsulesController {
  constructor(
    private readonly capsules: CapsulesService,
    /* ★ 280 轮：语义转脑图的受理端（建占位卡 ＋ 后台生成）在 AiModule 里，
       它要写库、要调模型，与"胶囊"本身是两个职责 —— 这里只借路由。 */
    private readonly mindmapAi: MindmapAiService,
  ) {}

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateCapsuleDto) {
    return this.capsules.create(me.userId, dto);
  }

  /** 批量删除 —— ⚠️ 声明位置要在 `:id` 之前 */
  @Delete()
  removeMany(@CurrentUser() me: AuthUser, @Body() dto: DeleteCapsulesDto) {
    return this.capsules.removeMany(me.userId, dto.ids);
  }

  /**
   * ★★ 160 轮：**批量还原**已删除的胶囊（逻辑删除的对侧动作）。
   *
   * ⚠️ 与上面那条同一条规矩：**静态段要先于带参段声明**。
   *   本路由形状是 `POST /capsules/restore`（与 `DELETE /capsules` 的批量那条对称），
   *   而下面 `POST :id/promote-to-todo` 带参 —— 两者路径形状不同不会互抢，
   *   但把静态段放前面是这张控制器一直遵守的读法（改的人一眼能看出优先级）。
   * ⚠️ 走 `POST` 不用 `PATCH`：它是"把这几条恢复出来"这个**动作**，
   *   与待办那边 `POST /todos/:id/restore` 同一族。
   */
  @Post('restore')
  restoreMany(@CurrentUser() me: AuthUser, @Body() dto: RestoreCapsulesDto) {
    return this.capsules.restoreMany(me.userId, dto.ids);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: UpdateCapsuleDto) {
    return this.capsules.update(me.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.capsules.remove(me.userId, id);
  }

  /** 转成待办 —— 创建待办 ＋ 删除胶囊在**同一事务** */
  @Post(':id/promote-to-todo')
  promoteToTodo(
    @CurrentUser() me: AuthUser,
    @Param('id') id: string,
    @Body() dto: PromoteToTodoDto,
  ) {
    return this.capsules.promoteToTodo(me.userId, id, dto);
  }

  /** 转到脑图 —— 追加节点 ＋ 删除胶囊在**同一事务**，返回 `addedCount` */
  @Post('promote-to-mindmap')
  promoteToMindmap(@CurrentUser() me: AuthUser, @Body() dto: PromoteToMindmapDto) {
    return this.capsules.promoteToMindmap(me.userId, dto);
  }

  /**
   * ★★ 280 轮：**语义转脑图** —— 把这几条胶囊交给模型重组成一张新脑图。
   *
   * 与 `promote-to-mindmap`（上面那条）的区别：
   *   · 那条是"把胶囊原样挂到**已有**脑图下"，一条胶囊 = 一个节点，不花钱；
   *   · 这条是"建一张**新**脑图、让模型按语义重组"，异步、计费、会失败。
   *
   * ★ 这个接口**只做受理**（建占位卡 ＋ 消费胶囊 ＋ 存图快照），
   *   **不 await 模型** —— 见 `MindmapAiService` 文件头。
   *   返回里带整张占位卡，前端可以直接插进列表（不用等一次 sync）。
   */
  @Post('to-mindmap-ai')
  toMindmapAi(@CurrentUser() me: AuthUser, @Body() dto: ToMindmapAiDto) {
    return this.mindmapAi.accept(me.userId, dto);
  }
}
