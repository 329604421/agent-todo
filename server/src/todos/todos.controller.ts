import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { CreateTodoDto, LinkCapsulesDto, UpdateTodoDto } from './dto/todo.dto';
import { TodosService } from './todos.service';

/**
 * 待办（FR-3 · §6.5）
 *
 * ⚠️ 列表**没有** `GET /todos` —— 待办列表由 `GET /sync` 的全量数据在前端现算
 *   （排序、筛选、四档计数全是前端已有函数，后端重做就是引入第二份真源）。
 *   单条详情才有接口，且它是**唯一返回图片完整 URL 的地方**。
 */
@Controller('todos')
@UseGuards(JwtAuthGuard)
export class TodosController {
  constructor(private readonly todos: TodosService) {}

  @Get(':id')
  detail(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.todos.detail(me.userId, id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateTodoDto) {
    return this.todos.create(me.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: UpdateTodoDto) {
    return this.todos.update(me.userId, id, dto);
  }

  /**
   * ★★ 248 轮：**关联闪念胶囊**（一批）—— 用户口径第 2 / 4 条。
   *
   * 落在这里而不是 `/capsules` 控制器：它是"这条待办的内容多了一块"，
   * 与加图片（`PATCH /todos/:id`）同一族；胶囊那一侧在同一个事务里被标成"已消费"。
   * ⚠️ 与 `DELETE` 那条是**同一份入参**（`LinkCapsulesDto`，一批 id）——
   *    "关联"与"解除关联"是同一张名单上的两个方向，写成一个模子才不会被下一个人改歪
   *    （与胶囊的 `removeCapsules` / `restoreCapsules` 同一条口径）。
   */
  @Post(':id/capsules')
  linkCapsules(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: LinkCapsulesDto) {
    return this.todos.linkCapsules(me.userId, id, dto);
  }

  /** ★★ 248 轮：**解除关联**（一批）—— 胶囊回到闪念胶囊列表，`createdAt` 重置为此刻 */
  @Delete(':id/capsules')
  unlinkCapsules(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: LinkCapsulesDto) {
    return this.todos.unlinkCapsules(me.userId, id, dto);
  }

  @Post(':id/complete')
  complete(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.todos.complete(me.userId, id);
  }

  @Post(':id/reopen')
  reopen(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.todos.reopen(me.userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.todos.remove(me.userId, id);
  }

  /**
   * ★★ 160 轮：**还原**一条已删除的待办（逻辑删除的对侧动作）。
   *
   * ⚠️ 用 `POST` 而不是 `DELETE` 的反向动作（`PATCH`/`PUT`）：它是**一个动作**
   *   （"把这条恢复出来"），不是"改一个字段" —— 与 `complete` / `reopen` 同族，
   *   也与胶囊那边的 `POST /capsules/restore` 对称。
   * ⚠️ **声明位置在 `:id` 之外**（`/restore` 是独立子路径，不与 `@Delete(':id')` 冲突；
   *   但它与 `POST /todos` 是两条不同的路由，方法也不同，安全）。
   */
  @Post(':id/restore')
  restore(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.todos.restore(me.userId, id);
  }

  /**
   * ★★ 199 轮：**「我看过这条了」** —— 清掉「刚转过来」提示（`flashAt` → null）。
   *
   * ⚠️ 用 `POST` 而不是 `PATCH`：它是**一个动作**（过目），不是"改一个字段"
   *   —— 与 `complete` / `reopen` / `restore` 同族；前端因此也不必知道字段叫什么名字。
   * ⚠️ 它**不刷 `updatedAt`** ⇒ 不能顺手并进 `PATCH /todos/:id`（那条正是用来刷时间的）。
   */
  @Post(':id/seen')
  seen(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.todos.markSeen(me.userId, id);
  }
}
