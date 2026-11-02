import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';
import { ApiException } from '../api-exception';
import { CODE } from '../codes';

/**
 * 全局异常出口 —— 把一切异常翻译成 `{ code, message, data: null }`（§6.1）。
 *
 * 三级映射：
 *   ① `ApiException`     —— 业务错误，**HTTP 200** ＋ 自己的 code；
 *   ② `HttpException`    —— 框架抛的（校验管道 / 404 / 405…），映射成对应业务码，同样 **HTTP 200**
 *       （例：`ValidationPipe` 抛 BadRequest ⇒ 2001「参数不正确」，前端走内联报错而不是"服务故障"）；
 *   ③ 其它（Prisma 错误 / 未捕获异常）—— **HTTP 500 ＋ code 5000**，且**生产环境不返回堆栈**。
 *
 * ⚠️ 一条纪律（§7.2）：越权（`ApiException.forbidden`）的响应体与"资源不存在"**刻意同形**，
 *   只把差异写进**服务端日志** —— 否则攻击者能靠错误信息的差别探测某个 id 到底存不存在。
 */
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<any>();
    const where = `${req?.method || '-'} ${req?.originalUrl || req?.url || '-'}`;

    // ① 业务异常
    if (exception instanceof ApiException) {
      if (exception.code === CODE.FORBIDDEN) {
        // 越权尝试单独留痕（含发起人 userId，便于判断是"写错 id"还是"在扫 id"）
        this.logger.warn(`[越权] ${where} userId=${req?.user?.userId || '-'} ${exception.message}`);
      }
      res.status(exception.getStatus()).json({
        code: exception.code,
        message: exception.message,
        data: null,
      });
      return;
    }

    // ③ Prisma 的已知错误 —— 先于通用 Error 处理
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped = mapPrismaError(exception);
      if (mapped) {
        this.logger.warn(`[Prisma ${exception.code}] ${where} ${exception.message.split('\n')[0]}`);
        res.status(mapped.httpStatus).json({ code: mapped.code, message: mapped.message, data: null });
        return;
      }
    }

    // ② 框架抛的 HttpException
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const raw = typeof body === 'string' ? body : (body as any)?.message;
      const message = Array.isArray(raw) ? String(raw[0]) : String(raw || exception.message);

      // 500 及以上算系统级，保留 5xx；其余一律折成业务码 + HTTP 200
      const systemLevel = status >= HttpStatus.INTERNAL_SERVER_ERROR;
      res.status(systemLevel ? status : HttpStatus.OK).json({
        code: systemLevel ? CODE.SERVER : mapHttpStatus(status),
        message: systemLevel ? '服务开小差了' : message,
        data: null,
      });
      return;
    }

    // ③ 兜底：未捕获异常
    const msg = exception instanceof Error ? exception.message : String(exception);
    const stack = exception instanceof Error ? exception.stack : '';
    this.logger.error(`[未捕获] ${where} ${msg}`, stack);

    const isProd = process.env.NODE_ENV === 'production';
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: CODE.SERVER,
      // ★ 生产环境**不返回堆栈**（§7.4 第 12 条）
      message: isProd ? '服务开小差了' : msg,
      data: null,
    });
  }
}

function mapHttpStatus(status: number): number {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return CODE.BAD_PARAM;
    case HttpStatus.UNAUTHORIZED:
      return CODE.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return CODE.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return CODE.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return CODE.CONFLICT;
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return CODE.FILE_INVALID;
    default:
      return CODE.SERVER;
  }
}

/**
 * Prisma 错误 → 业务码。
 * ★ **P2002（唯一约束冲突）必须映射成 2004** —— 这是项目色唯一性的兜底路径（§8.4）：
 *   后端不用"先查再写"（那有竞态），而是让数据库唯一索引拦住，再把冲突翻译成人话。
 */
function mapPrismaError(
  e: Prisma.PrismaClientKnownRequestError,
): { code: number; message: string; httpStatus: number } | null {
  const target = (e.meta as any)?.target;
  const targetText = Array.isArray(target) ? target.join(',') : String(target || '');

  switch (e.code) {
    case 'P2002':
      if (targetText.includes('color')) {
        return { code: CODE.CONFLICT, message: '该颜色已被其它项目占用', httpStatus: 200 };
      }
      return { code: CODE.CONFLICT, message: '数据已存在，请换一个值', httpStatus: 200 };
    case 'P2003':
      return { code: CODE.BAD_PARAM, message: '关联的对象不存在', httpStatus: 200 };
    /**
     * ★★ 2026-10-20：**`P2000`（值超出列宽）必须映射**。
     *
     * 不映射的后果用户已经见过了（2026-10-20 报的"长语音 → 服务开小差了 → 文字消失"）：
     *   它落进「未捕获」兜底 ⇒ 500 / 5000「服务开小差了」，而前端拿到 5000 后**不重试、整块回滚**，
     *   用户唯一的损失是**那句口述彻底没了**（识别结果只存在于这一条 PATCH 里）。
     * 而这个错误其实是**参数问题**（正文超过列宽），该当 2001 报，把话说清楚。
     *
     * ⚠️ 与迁移 `20261020090000_text_width` 是一对：那边把正文列放到 TEXT（真因），
     *    这边保证**再出现同类超长**时用户看到的是人话（不再被读成"服务器挂了"）。
     */
    case 'P2000':
      return {
        code: CODE.BAD_PARAM,
        message: '内容太长，存不下了，请精简后再试',
        httpStatus: 200,
      };
    case 'P2025':
      return { code: CODE.NOT_FOUND, message: '资源不存在', httpStatus: 200 };
    default:
      return null;
  }
}
