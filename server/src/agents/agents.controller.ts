import { Body, Controller, Delete, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { AgentsService } from './agents.service';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';

/** agent（FR-6.1 · §6.8）—— 全部手动维护，没有采集链路 */
@Controller('agents')
@UseGuards(JwtAuthGuard)
export class AgentsController {
  constructor(private readonly agents: AgentsService) {}

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateAgentDto) {
    return this.agents.create(me.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: UpdateAgentDto) {
    return this.agents.update(me.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.agents.remove(me.userId, id);
  }
}
