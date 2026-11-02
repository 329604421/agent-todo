import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ApiException } from './api-exception';

/**
 * Prisma 客户端 —— 全局单例（NestJS 的 DI 保证只 new 一次）。
 *
 * ⚠️ 一个容易被忽略的资源事实（§4.8.3）：**Prisma 的 query engine 是独立进程**，
 *   比纯 Node 进程更吃内存。2核2G 的机器上余量本来就只有 ~800 MB，
 *   所以 `connection_limit` 要显式收在个位数（默认按 CPU 核数算，在这个量级毫无必要）。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Prisma');

  constructor() {
    super({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  }

  async onModuleInit(): Promise<void> {
    // @ts-expect-error 事件签名由 Prisma 运行时提供
    this.$on('warn', (e: any) => this.logger.warn(typeof e === 'string' ? e : e?.message));
    // @ts-expect-error 同上
    this.$on('error', (e: any) => this.logger.error(typeof e === 'string' ? e : e?.message));

    await this.$connect();
    this.logger.log('数据库连接就绪');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * ★★ 用户隔离的**唯一入口**（§7.2 —— 本期最高风险点）。
   *
   * 多用户共用一套后端时，「查到别人的数据」（IDOR）是这类项目最经典的漏洞：
   * **它不会报错，只会安静地串数据**。所以：
   *   · 不带 `userId` 的 `findUnique` 一律**禁用**；
   *   · 查、改、删全部先走这里定位。
   *
   * 三种结果刻意分开：
   *   · 不存在            → `2002`（前端按「记忆失效」处理：清记忆 + 弹列表抽屉）
   *   · 存在但属于别人     → `2003`（前端同样按记忆失效处理，但**服务端要记日志**）
   *   · 属于自己          → 返回原始行
   *
   * @param delegate 任意带 `findUnique` 的 Prisma 模型代理（`this.prisma.todo` 这种）
   */
  async owned<T = any>(delegate: any, id: string, userId: string, label = '资源'): Promise<T> {
    if (!id) throw ApiException.badParam('缺少 id');
    const row = await delegate.findUnique({ where: { id } });
    if (!row) throw ApiException.notFound(`${label}不存在`);
    if (row.userId !== userId) throw ApiException.forbidden();
    return row as T;
  }
}
