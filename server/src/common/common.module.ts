import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { WxService } from './wx.service';

/**
 * 公共模块 —— 全局可注入的基础设施。
 *
 * @Global() 是为了让 `PrismaService` / `WxService` 不必在每个业务模块的 imports 里重复列一遍。
 * 这不是"图省事"：本项目有 10 个业务模块，逐个 import 只会让"少写了一个"变成
 * 运行时才暴露的 DI 错误（而且报错信息指向的是使用方，不是漏写方，很难查）。
 */
@Global()
@Module({
  providers: [PrismaService, WxService],
  exports: [PrismaService, WxService],
})
export class CommonModule {}
