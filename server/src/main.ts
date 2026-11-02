import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';

import { AppModule } from './app.module';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { uploadRoot } from './common/upload';

const logger = new Logger('Bootstrap');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // ── 请求体 ────────────────────────────────────────────────────────────────
  // JSON 上限刻意保持小（64kb）：真正的业务载荷都是短文本。
  // 音频与图片走 multipart（multer 管），**不经过这里**，所以不担心 base64 塞 JSON（§6.8.1）。
  app.use(json({ limit: '64kb' }));
  app.use(urlencoded({ extended: true, limit: '64kb' }));

  // ── 统一出口（§6.1）────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // 丢掉 DTO 未声明的字段 —— 顺带挡掉客户端硬塞 userId 这类越权尝试
      transform: true,
      forbidNonWhitelisted: false, // 宽松点：多传字段只忽略，不报错（前端有时带冗余字段）
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  // nginx 在前面，真实 IP 在 X-Forwarded-For 里（限流与日志要用）
  app.set('trust proxy', 1);

  // ── 图片静态托管 ──────────────────────────────────────────────────────────
  // ⚠️ 生产环境**由 nginx 直出**（`location /files/` → alias `/data/uploads/`），
  //    这一段只为"本机不带 nginx 也能自测"而留。nginx 一旦命中 /files/，
  //    根本不会把请求转发到 Node，所以这两条路径不会同时生效。
  app.useStaticAssets(uploadRoot(), { prefix: '/files/', index: false, dotfiles: 'deny' });

  // ── 监听 ─────────────────────────────────────────────────────────────────
  const port = Number(process.env.PORT || 3000);
  // ★ 只监听 127.0.0.1：只有 nginx 能访问它（§4.7 闸门 3）。改成 0.0.0.0 等于把应用直接挂公网。
  const host = process.env.HOST || '127.0.0.1';
  await app.listen(port, host);

  logger.log(`Agent ToDo 后端已启动 → http://${host}:${port}/api/v1  (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
  logger.log(`图片目录 ${uploadRoot()} · 对外前缀 ${process.env.FILE_BASE_URL || '(未配置 FILE_BASE_URL)'}/files/`);
}

bootstrap().catch((e) => {
  logger.error('启动失败：' + (e?.stack || e?.message || e));
  process.exit(1);
});
