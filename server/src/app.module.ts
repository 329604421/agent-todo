import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';

import { CommonModule } from './common/common.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { MeModule } from './me/me.module';
import { SyncModule } from './sync/sync.module';
import { ProjectsModule } from './projects/projects.module';
import { TodosModule } from './todos/todos.module';
import { MindmapsModule } from './mindmaps/mindmaps.module';
import { CapsulesModule } from './capsules/capsules.module';
import { AgentsModule } from './agents/agents.module';
import { TokenKeysModule } from './token-keys/token-keys.module';
import { FilesModule } from './files/files.module';
import { AsrModule } from './asr/asr.module';
import { AiModule } from './ai/ai.module';
import { AdminModule } from './admin/admin.module';

@Module({
  imports: [
    // 环境变量（§10.2）：服务器上文件权限 600，且**不进 git**
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env'] }),

    // JWT 全局注册 —— 守卫在任意模块里都能拿到 JwtService
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        secret: cfg.get<string>('JWT_SECRET') || 'dev-only-secret-please-change',
        signOptions: { expiresIn: cfg.get<string>('JWT_EXPIRES_IN') || '7d' },
      }),
    }),

    CommonModule,
    HealthModule,
    AuthModule,
    MeModule,
    SyncModule,
    ProjectsModule,
    TodosModule,
    MindmapsModule,
    CapsulesModule,
    AgentsModule,
    TokenKeysModule,
    FilesModule,
    AsrModule,
    AiModule, // ★ 278 轮：提示词增强（POST /ai/enhance）。零数据库依赖。
    AdminModule,
  ],
})
export class AppModule {}
