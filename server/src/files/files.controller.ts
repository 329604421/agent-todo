import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { IMAGE_MAX_BYTES } from '../common/constants';
import { FilesService, imageFileFilter } from './files.service';

/**
 * `POST /api/v1/files` —— 图片上传（§6.8）。
 *
 * ★ 前端走 `wx.uploadFile`（不是 `wx.request`）⇒ **微信后台的 `uploadFile` 合法域名要单独配一次**
 *   （它与 `request` 是分开的两类，二级域名也不支持泛域名，必须精确添加）。
 *
 * ★ 存储用 multer 的**默认存储 ＝ MemoryStorage**：图片只作为内存里的 Buffer 存在，
 *   写盘由我们按 §4.5 的目录约定自己做（这样文件名与目录结构完全可控，不用 multer 的 diskStorage
 *   去猜路径）。体积上限同时交给 multer（`limits.fileSize`）与业务层各判一次。
 */
@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private readonly files: FilesService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // 不指定 storage ⇒ 用 multer 默认的 MemoryStorage
      limits: { fileSize: IMAGE_MAX_BYTES, files: 1 },
      fileFilter: imageFileFilter,
    }),
  )
  upload(@CurrentUser() me: AuthUser, @UploadedFile() file: any) {
    return this.files.saveImage(me.userId, file);
  }
}
