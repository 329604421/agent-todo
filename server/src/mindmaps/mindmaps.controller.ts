import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { MindmapAiService } from '../ai/mindmap-ai.service';
import { CreateMindmapDto, MarkSeenDto, SaveTreeDto, UpdateMindmapDto } from './dto/mindmap.dto';
import { MindmapsService } from './mindmaps.service';

/**
 * 脑图（FR-7 · §6.6）
 *
 * 💡 删除确认框的「有几条待办关联着它」由**前端现算**，不需要接口 ——
 *   单人工具场景下加 `GET /mindmaps/:id/impact` 属于过度设计。
 */
@Controller('mindmaps')
@UseGuards(JwtAuthGuard)
export class MindmapsController {
  constructor(
    private readonly mindmaps: MindmapsService,
    /* ★ 280 轮：失败重试（只认 `ai_state='failed'`）＋ 轻量轮询口 */
    private readonly mindmapAi: MindmapAiService,
  ) {}

  /**
   * ★★ 280 轮：**语义转脑图的轮询口** —— 只回"还需要看一眼"的那几条
   *（生成中 / 失败 / 刚完成还没打开过）。
   *
   * ⚠️ 必须声明在 `@Get(':id/tree')` **之前**：Nest 按声明顺序匹配，
   *    虽然两者的路径段数不同（一段 vs 两段）本不会互抢，但"静态段先于带参段"
   *    是这张控制器一贯的读法 —— 将来有人把 `:id/tree` 改成 `:id` 时才不会踩。
   */
  @Get('ai-pending')
  aiPending(@CurrentUser() me: AuthUser) {
    return this.mindmapAi.pending(me.userId);
  }

  @Get(':id/tree')
  tree(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.mindmaps.tree(me.userId, id);
  }

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateMindmapDto) {
    return this.mindmaps.create(me.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: UpdateMindmapDto) {
    return this.mindmaps.update(me.userId, id, dto);
  }

  @Put(':id/tree')
  saveTree(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: SaveTreeDto) {
    return this.mindmaps.saveTree(me.userId, id, dto.treeJson);
  }

  /**
   * ★★ 199 轮：**「我看过这几枚节点了」** —— 清掉节点上的「刚转过来」标记。
   *
   * 触发时机：用户在画布上选中了那枚节点。
   *
   * ⚠️ 与 `PUT /tree` **有意分成两条路**：本路**不刷 `updatedAt`**。
   *   看一眼节点不等于改过这张图 —— 并进 `PUT /tree` 的话，
   *   "随手点一个节点"会让这张图在脑图列表里被顶到最前。
   */
  @Post(':id/seen')
  seen(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: MarkSeenDto) {
    return this.mindmaps.markSeen(me.userId, id, dto.nodeIds);
  }

  /**
   * ★★ 280 轮：**失败重试**（语义转脑图）。
   *
   * ⚠️ 只认 `ai_state='failed'`：`pending` 不许重试 —— 那会变成两个任务写同一行，
   *    而"谁后回来谁覆盖"在这种异步链路里是最难查的一类脏数据。
   * ⚠️ 重试用的是受理时存下的 `aiInput` 快照（含图的原串），**不需要重新选胶囊**。
   */
  @Post(':id/ai-retry')
  aiRetry(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.mindmapAi.retry(me.userId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.mindmaps.remove(me.userId, id);
  }
}
