import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { PROJECT_COLORS, PROJECT_NODES } from '../common/constants';
import { PrismaService } from '../common/prisma.service';
import { mindmapOut, projectOut, todoOut } from '../common/shape';
import { nowStr } from '../common/time';
import { CreateProjectDto, UpdateProjectDto } from './dto/project.dto';

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger('Projects');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * `POST /projects` —— **无任何前置条件**（需求原文「无凭证、无 agent、无网络数据源」）。
   * 这是全产品里最轻的一个写操作：用户在待办表单里点「＋ 新建项目」就能瞬间建出来。
   */
  async create(userId: string, dto: CreateProjectDto) {
    const now = nowStr();
    const name = (dto.name || '').trim() || (await this.defaultName(userId));

    const row = await this.prisma.project.create({
      data: {
        // ★ 前端乐观更新时自带 id（可选）；不传就走 cuid 默认值。见 common/client-id.decorator.ts
        id: dto.id || undefined,
        userId,
        name,
        remark: dto.remark || '',
        node: dto.node || PROJECT_NODES[0],
        color: dto.color || null,
        agentId: await this.checkAgent(userId, dto.agentId),
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return projectOut(row);
  }

  /**
   * `PATCH /projects/:id`
   * ★ 项目名可改、**允许重名**；颜色的唯一性由数据库唯一索引兜底（§8.4）——
   *   冲突会以 `P2002` 冒出来，被全局异常过滤器翻译成 `2004`「该颜色已被其它项目占用」。
   *   这里**刻意不写"先查再写"**：那有竞态（两个请求同时发现没人占、同时写）。
   */
  async update(userId: string, id: string, dto: UpdateProjectDto) {
    const cur = await this.prisma.owned<any>(this.prisma.project, id, userId, '项目');

    const data: any = { updatedAt: nowStr() };
    if (dto.name !== undefined) {
      const name = String(dto.name).trim();
      if (!name) throw ApiException.badParam('项目名不能为空');
      data.name = name;
    }
    if (dto.remark !== undefined) data.remark = dto.remark || '';
    if (dto.node !== undefined) data.node = dto.node;
    if (dto.color !== undefined) {
      const c = dto.color || null;
      if (c && !(PROJECT_COLORS as readonly string[]).includes(c)) {
        throw ApiException.badParam('项目色取值不合法');
      }
      data.color = c;
    }
    /* ★★ 2026-10-27（用户口径）：脑图的「归属 agent」**由项目决定**。
       所以项目改绑 agent 时必须把该项目下所有脑图一起刷 —— 否则库里会一直漂着
       "项目已经是 A、脑图还挂在 B"（或还挂在 null），而 agent 的用量/额度是按 agent 归集的，
       那种数据谁来都解释不通。
       ⚠️ 只在**这一项真的变了**时才发第二条语句（拖动项目色、改名不该顺带改一遍几十张图）；
          两条包在同一个事务里，不会出现"项目改了、脑图没跟上"的中间态。 */
    let agentChanged = false;
    if (dto.agentId !== undefined) {
      data.agentId = await this.checkAgent(userId, dto.agentId);
      agentChanged = (data.agentId || null) !== (cur.agentId || null);
    }

    if (agentChanged) {
      const [, row] = await this.prisma.$transaction([
        this.prisma.project.update({ where: { id }, data }),
        this.prisma.mindmap.updateMany({ where: { projectId: id }, data: { agentId: data.agentId } }),
      ]);
      this.logger.log(`项目 ${id} 改绑 agent ⇒ 脑图归属已同步`);
      return projectOut(row);
    }

    const row = await this.prisma.project.update({ where: { id }, data });
    return projectOut(row);
  }

  /**
   * `POST /projects/:id/archive` —— 写 `archivedAt`，**零级联**（§8.3）。
   * 不迁移、不改 `projectId`、不删任何东西。归档后要"消失"的那四处（项目列表默认视图 /
   * 概览项目统计 / 待办表单项目选择器 / 脑图新建项目选择器）**过滤全在前端**。
   */
  async archive(userId: string, id: string) {
    const p = await this.prisma.owned<any>(this.prisma.project, id, userId, '项目');
    if (!p.archivedAt) {
      const now = nowStr();
      await this.prisma.project.update({ where: { id }, data: { archivedAt: now, updatedAt: now } });
      this.logger.log(`归档项目 ${id}`);
    }
    return projectOut(await this.prisma.project.findUnique({ where: { id } }));
  }

  /** `POST /projects/:id/unarchive` —— 数据一条都没动过，取消归档只是把时间戳清掉 */
  async unarchive(userId: string, id: string) {
    await this.prisma.owned(this.prisma.project, id, userId, '项目');
    const row = await this.prisma.project.update({
      where: { id },
      data: { archivedAt: null, updatedAt: nowStr() },
    });
    return projectOut(row);
  }

  /**
   * `GET /projects/:id/detail` —— 项目详情的三块内容**一次拿全**（§6.4）。
   *
   * 💡 归档确认层的"影响面"数字（待办 N 条 / 脑图 M 张）**不在这里算** ——
   *   前端本地已有全量数据，`store` 现算即可，多一个字段就多一份可能不一致的真源。
   */
  async detail(userId: string, id: string) {
    const project = await this.prisma.owned<any>(this.prisma.project, id, userId, '项目');

    const [todos, mindmaps, agent] = await Promise.all([
      /* ★★ 160 轮：**已删除的待办不出现在项目详情里** —— 项目页的待办看板、
         四档计数、"项目待办 N 条"都由前端从 `GET /sync` 现算，它们读的是
         `store.todosOfProject()`（那里已经滤掉了已删除）；这个接口是**同一个量的第二个出口**，
         两处口径必须一致，否则"项目详情说 5 条、列表只画出 4 条"。
         ⚠️ 与 `GET /sync` **有意不同**：sync 要带上已删除的（「已删除」筛选是还原入口），
            这里是"这个项目现在有什么"，已删除的不算。 */
      this.prisma.todo.findMany({
        where: { userId, projectId: id, deletedAt: null },
        include: { images: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.mindmap.findMany({ where: { userId, projectId: id }, orderBy: { updatedAt: 'desc' } }),
      project.agentId ? this.prisma.agent.findFirst({ where: { id: project.agentId, userId } }) : Promise.resolve(null),
    ]);

    return {
      project: projectOut(project),
      // 详情列表里的待办同样**不带完整图片 URL**（点进单条待办才给，见 §6.5）
      todos: todos.map((t) => todoOut(t, false)),
      mindmaps: mindmaps.map((m) => mindmapOut(m, false)),
      agent: agent
        ? { id: agent.id, name: agent.name }
        : null,
    };
  }

  /** 「未命名项目 N」—— N 取当前项目数 + 1（含已归档，避免和历史名字撞） */
  private async defaultName(userId: string): Promise<string> {
    const n = await this.prisma.project.count({ where: { userId } });
    return `未命名项目 ${n + 1}`;
  }

  /** agentId 归属校验：填了就必须是**自己的** agent，否则 2001（不要静默接受一个别人的 id） */
  private async checkAgent(userId: string, agentId?: string | null): Promise<string | null> {
    const aid = agentId ? String(agentId) : '';
    if (!aid) return null;
    const hit = await this.prisma.agent.findFirst({ where: { id: aid, userId } });
    if (!hit) throw ApiException.badParam('关联的 agent 不存在');
    return aid;
  }
}
