import { HttpException } from '@nestjs/common';
import { CODE } from './codes';

/**
 * 业务异常 —— 全项目**统一抛它**，不要抛通用 `Error`（§6.1）。
 *
 * 为什么单列一个类：
 *   · 通用 Error 会被兜底成 5000「服务开小差了」，而前端**不会自动重试** —— 
 *     一条"文字不能为空"的校验错误会以"服务器故障"的形式呈现，误导性极强；
 *   · 带上业务 `code` 之后，前端才能区分「参数错（内联报错）」「资源没了（走记忆失效）」
 *      「色被占了（提示占用者）」「没权限重登（重试一次）」这四种完全不同的处置。
 */
export class ApiException extends HttpException {
  readonly code: number;

  constructor(code: number, message: string, httpStatus = 200) {
    super(message, httpStatus);
    this.code = code;
  }

  static badParam(message = '参数不正确') {
    return new ApiException(CODE.BAD_PARAM, message);
  }

  static notFound(message = '资源不存在') {
    return new ApiException(CODE.NOT_FOUND, message);
  }

  /** ★ 越权：日志里单独记一条（§7.2 要求），返回值与 notFound 刻意**同形**，
   *  避免通过错误信息差异探测「某个 id 是否存在」 */
  static forbidden(message = '无权访问该资源') {
    return new ApiException(CODE.FORBIDDEN, message);
  }

  static conflict(message = '已被占用') {
    return new ApiException(CODE.CONFLICT, message);
  }

  static rejected(message = '当前状态不允许该操作') {
    return new ApiException(CODE.REJECTED, message);
  }

  static fileInvalid(message = '文件不符合要求') {
    return new ApiException(CODE.FILE_INVALID, message);
  }

  static server(message = '服务开小差了') {
    return new ApiException(CODE.SERVER, message, 500);
  }
}
