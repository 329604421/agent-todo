import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { IMAGE_MAX_BYTES } from '../common/constants';
import { assertSize, isAllowedImage, saveImage, sniffImageExt, urlFor } from '../common/upload';

@Injectable()
export class FilesService {
  /**
   * 存一张图 —— 待办附图与用户头像**共用这一个接口**（§4.5）。
   *
   * ★★ 安全上三道（§7.4 第 6 条）：
   *   ① **按文件内容嗅探**判类型（`file-type` 读文件头），不只看扩展名 / mime ——
   *      客户端可以随便把 .exe 改名成 .jpg 并声明 `image/jpeg`；
   *   ② 文件名由**服务端**生成随机 ID（`relPathFor`），不用用户原始文件名
   *      —— 防路径穿越、防中文编码问题、防重名；
   *   ③ 体积三道设限：nginx `client_max_body_size 4m` → multer `limits.fileSize` → 这里再判一次。
   */
  async saveImage(userId: string, file: any) {
    if (!file || !file.buffer) throw ApiException.fileInvalid('没有收到文件');
    assertSize(file.buffer.length, IMAGE_MAX_BYTES, '图片');

    const ext = await sniffImageExt(file.buffer);
    if (!ext) throw ApiException.fileInvalid('只支持 jpg / png / webp 图片');

    const uri = await saveImage(file.buffer, userId, ext);
    return {
      id: uri, // uri 本身就是唯一标识（含随机 id），不必再回一次库
      uri,
      url: urlFor(uri),
      bytes: file.buffer.length,
    };
  }
}

/** multer 的 `fileFilter` —— 这一层只看 mime（客户端可伪造），真正裁决在 `sniffImageExt` */
export function imageFileFilter(_req: any, file: any, cb: (err: Error | null, ok: boolean) => void) {
  if (!isAllowedImage(file?.mimetype)) {
    cb(ApiException.fileInvalid('只支持 jpg / png / webp 图片'), false);
    return;
  }
  cb(null, true);
}
