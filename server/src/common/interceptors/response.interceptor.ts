import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * 统一响应包装 —— `{ code: 0, message: 'ok', data: {...} }`（§6.1）。
 *
 * 单一出口的意义：前端只需要判 `code` 一个字段，不用同时处理 HTTP 状态码与业务码。
 * 业务错误由 `ApiExceptionFilter` 以同样的外形返回（只是 `code != 0`）。
 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiEnvelope<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiEnvelope<T>> {
    return next.handle().pipe(
      map((data) => ({
        code: 0,
        message: 'ok',
        // undefined 会从 JSON 里整个消失，前端拿到的是 `data` 字段缺失 —— 统一成 null 更好排查
        data: data === undefined ? null : data,
      })),
    );
  }
}
