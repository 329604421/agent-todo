import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { amountOf } from '../common/money';
import { PrismaService } from '../common/prisma.service';
import { agentOut } from '../common/shape';
import { nowStr } from '../common/time';
import { CreateAgentDto, UpdateAgentDto } from './dto/agent.dto';

@Injectable()
export class AgentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateAgentDto) {
    const now = nowStr();
    const row = await this.prisma.agent.create({
      data: {
        // ★ 前端乐观更新时自带 id（可选）；不传就走 cuid 默认值
        id: dto.id || undefined,
        userId,
        name: String(dto.name || '').trim() || '未命名 agent',
        quotaLeft: intOrNull(dto.quotaLeft),
        monthlyQuota: intOrNull(dto.monthlyQuota),
        quotaResetAt: dto.quotaResetAt || null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return agentOut(row);
  }

  /** `PATCH /agents/:id` —— ★ 保存时自动刷新 `updatedAt`（＝「最后更新于」，FR-6.1 唯一的自动字段） */
  async update(userId: string, id: string, dto: UpdateAgentDto) {
    await this.prisma.owned(this.prisma.agent, id, userId, 'agent');

    const data: any = { updatedAt: nowStr() };
    if (dto.name !== undefined) {
      const name = String(dto.name || '').trim();
      if (!name) throw ApiException.badParam('agent 名不能为空');
      data.name = name;
    }
    if (dto.quotaLeft !== undefined) data.quotaLeft = intOrNull(dto.quotaLeft);
    if (dto.monthlyQuota !== undefined) data.monthlyQuota = intOrNull(dto.monthlyQuota);
    if (dto.quotaResetAt !== undefined) data.quotaResetAt = dto.quotaResetAt || null;

    const row = await this.prisma.agent.update({ where: { id }, data });
    return agentOut(row);
  }

  /**
   * `DELETE /agents/:id` —— 被项目引用时 **`project.agentId` 置空、不级联删项目**。
   * 由数据库的 `onDelete: SetNull` 在 DB 层保证（§8.5），业务代码零行。
   */
  async remove(userId: string, id: string) {
    await this.prisma.owned(this.prisma.agent, id, userId, 'agent');
    await this.prisma.agent.delete({ where: { id } });
    return { id, deleted: true };
  }
}

/** 手填值 → 整数（解析不出给 null ＝「未填」，**不是 0**） */
function intOrNull(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = amountOf(v);
  return n === null ? null : Math.round(n);
}
