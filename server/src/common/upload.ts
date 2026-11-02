import { Logger } from '@nestjs/common';
import { fromBuffer } from 'file-type';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { ApiException } from './api-exception';

/**
 * 图片落盘 —— 位置、命名与 URL 三条约定（§4.5）。
 *
 * ```
 * 存储路径  {UPLOAD_DIR}/{userId}/{yyyymm}/{imageId}.{ext}
 * 访问 URL  {FILE_BASE_URL}/files/{userId}/{yyyymm}/{imageId}.{ext}
 * 数据库存  只存**相对路径** `{userId}/{yyyymm}/{imageId}.{ext}`
 * ```
 *
 * ★★ 数据库里只存相对路径，完整 URL 由接口层现拼（§4.5 红框）。
 *    现在多写 3 行代码，将来换域名 / 换 CDN / 换 COS 时能省掉一次**不可逆**的全库订正。
 *
 * ★ 三条安全约定（§7.4 第 6 条）：
 *   ① 按**文件内容嗅探**判类型，不只看扩展名 / mime（客户端可以随便伪造）；
 *   ② 文件名由**服务端**生成随机 ID，不使用用户原始文件名（防路径穿越 / 中文编码 / 重名）；
 *   ③ 上传目录只由 nginx 静态直出，**不配任何 CGI**，不可执行。
 */
const logger = new Logger('Upload');

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** 允许的图片类型（嗅探白名单） */
export function isAllowedImage(mime: string | undefined): boolean {
  return !!mime && !!MIME_TO_EXT[mime];
}

export function uploadRoot(): string {
  return process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
}

/**
 * 用文件头嗅探真实类型。
 * @returns 'jpg' | 'png' | 'webp'；认不出来或不是图片 → null
 */
export async function sniffImageExt(buf: Buffer): Promise<string | null> {
  const t = await fromBuffer(buf);
  const ext = t ? MIME_TO_EXT[t.mime] : undefined;
  return ext || null;
}

function pad(n: number): string {
  return n < 10 ? '0' + n : '' + n;
}

/** 按 §4.5 的目录约定算相对路径 */
export function relPathFor(userId: string, ext: string): string {
  const d = new Date();
  const ym = d.getFullYear() + pad(d.getMonth() + 1);
  const id = crypto.randomBytes(12).toString('hex');
  // userId 是 cuid，只含字母数字 —— 再收一道，防止任何非预期字符进路径
  const safeUser = String(userId).replace(/[^A-Za-z0-9_-]/g, '');
  return `${safeUser}/${ym}/${id}.${ext}`;
}

/** 写盘；返回相对路径 */
export async function saveImage(buf: Buffer, userId: string, ext: string): Promise<string> {
  const rel = relPathFor(userId, ext);
  const abs = path.join(uploadRoot(), rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, buf);
  return rel;
}

/**
 * 拼完整 URL —— 只在**详情类**接口里用（列表 / `GET /sync` **只给相对 uri**）。
 * ⚠️ 这条纪律的理由是带宽（§4.3.3）：3 Mbps 下预取 20 张图要 16 秒，
 *   而 sync 是"启动时一次"，前端很容易顺手把 uri 全拼成 url 然后被预加载。
 */
export function urlFor(uri: string | null | undefined): string {
  if (!uri) return '';
  if (/^https?:\/\//i.test(uri)) return uri; // 兼容 mock 数据里的外链
  const base = (process.env.FILE_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/files/${uri}`;
}

/**
 * 删磁盘文件 —— **异步、失败只记日志、绝不阻塞响应**（§8.5）。
 * 一个文件删不掉不该让"删待办"这个动作失败（行已经删了，用户看到的是成功）。
 */
export async function removeUpload(uri: string | null | undefined): Promise<void> {
  if (!uri) return;
  if (/^https?:\/\//i.test(uri)) return; // mock 外链，不是我们的文件
  try {
    const root = path.resolve(uploadRoot());
    const abs = path.resolve(root, uri);
    // 路径穿越护栏：解析后必须仍在 uploadRoot 之内
    if (!abs.startsWith(root + path.sep)) {
      logger.warn(`拒绝删除越界路径：${uri}`);
      return;
    }
    await fs.unlink(abs);
  } catch (e: any) {
    if (e?.code !== 'ENOENT') logger.warn(`删除图片失败 ${uri}：${e?.message || e}`);
  }
}

/** 入参体积守卫（应用层这一道，multer 还有一道，nginx 还有一道 —— §6.8.1 约束 4） */
export function assertSize(bytes: number, max: number, label: string): void {
  if (bytes > max) {
    throw ApiException.fileInvalid(`${label}过大（上限 ${Math.round(max / 1024 / 1024)} MB）`);
  }
}
