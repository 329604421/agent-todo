import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';
import { ProjectsService } from './projects.service';

/**
 * 项目（FR-2 · §6.4）
 *
 * ❌ **不提供 `DELETE /projects/:id`** —— 需求 `N-12` 明确「只归档、不做级联删除」。
 *   **不加这个接口本身，就是对需求最可靠的遵守** —— 前端就算写错也删不掉。
 */
@Controller('projects')
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  create(@CurrentUser() me: AuthUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(me.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() me: AuthUser, @Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(me.userId, id, dto);
  }

  @Post(':id/archive')
  archive(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.projects.archive(me.userId, id);
  }

  @Post(':id/unarchive')
  unarchive(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.projects.unarchive(me.userId, id);
  }

  @Get(':id/detail')
  detail(@CurrentUser() me: AuthUser, @Param('id') id: string) {
    return this.projects.detail(me.userId, id);
  }
}
