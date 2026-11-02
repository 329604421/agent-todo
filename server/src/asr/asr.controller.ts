import { Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthUser, CurrentUser } from '../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../common/auth/jwt-auth.guard';
import { AUDIO_MAX_BYTES } from '../common/constants';
import { AsrService } from './asr.service';

/**
 * `POST /api/v1/asr` —— 语音识别（§6.8.1）。
 *
 * ★★★ 这个 `FileInterceptor` 里**没有 `storage` 选项**，这不是漏写：
 *   multer 不指定 storage 时用的就是 **`MemoryStorage`** —— 音频只作为内存 Buffer 存在，
 *   请求结束即释放。**这就是"服务端不保存录音"的实现本体**。
 *   千万别顺手改成 `diskStorage`，那会让整条"不保存录音"的承诺当场失效。
 *
 * ★ 前端走 `wx.uploadFile`（音频是二进制，`wx.request` 面向 JSON）。
 *   微信后台的 `uploadFile` 合法域名要单独配置。
 *
 * ★ nginx 的 `client_max_body_size` 必须 ≥ 4m：
 *   本项目**音频**上限 3 MB（mp3 @48kbps / 60s ≈ 360 KB，余量 6 倍），
 *   而**图片**上限 1 MB ⇒ 取 4m 同时覆盖两者。
 *   ⚠️ 漏改这一条的表现是：语音上传直接 `413`，**而小程序侧看不出原因**。
 */
@Controller('asr')
@UseGuards(JwtAuthGuard)
export class AsrController {
  constructor(private readonly asr: AsrService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // ★ 不写 storage —— 默认即 MemoryStorage。见类注释，别改。
      limits: { fileSize: AUDIO_MAX_BYTES, files: 1 },
    }),
  )
  recognize(@CurrentUser() me: AuthUser, @UploadedFile() file: any, @Body('format') format?: string) {
    /**
     * `VoiceFormat` 的取值口径 —— 两个来源，**优先显式字段**：
     *   ① 前端随 `wx.uploadFile` 的 `formData.format` 明确带上（推荐，最不容易错）；
     *   ② 退回按上传文件名的后缀猜（`rec.mp3` → `mp3`）。
     * ⚠️ 无论走哪条，它都与腾讯云的 `VoiceFormat` **必须严格一致**，
     *   填错报 `InvalidParameterValue.ErrorInvalidVoiceFormat`（而且它在腾讯云侧是"参数错误"，
     *   在本项目里其实**是后端 bug** —— 见 asr.service 的错误映射表）。
     */
    const fmt = String(format || '').trim() || String(file?.originalname || '').split('.').pop() || 'mp3';
    return this.asr.recognize(me.userId, file?.buffer, fmt);
  }
}
