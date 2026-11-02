import { Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { CODE } from '../common/codes';
import { AUDIO_MAX_BYTES } from '../common/constants';
import { PrismaService } from '../common/prisma.service';
import { todayStr } from '../common/time';
import { assertSize } from '../common/upload';

// 官方 Node SDK —— 它的依赖体积不小，但"少犯一次签名的错"比省几 MB 重要（§6.8.1 第 8 条）
const tencentcloud = require('tencentcloud-sdk-nodejs-asr');
const AsrClient = tencentcloud.asr.v20190614.Client;

/**
 * 语音识别（腾讯云「一句话识别」· §6.8.1）
 *
 * ★★ 四条「不落盘」硬约束 —— 这一节的全部技术含量就在这里：
 *   ① multer 用 **`memoryStorage`**（见 `asr.controller.ts`：不指定 storage 即为 MemoryStorage）
 *      ⇒ 音频只作为内存里的 Buffer 存在，请求结束即释放。**这一条是"不保存录音"的实现本体**；
 *   ② 调腾讯云必须用 **`SourceType = 1`（语音数据直传）**，**绝不用 `SourceType = 0`**
 *      —— `SourceType=0` 要求音频**公网可下载**，那必然要落盘或传 COS 并生成可访问 URL，
 *      **与"不保存录音"直接矛盾**；
 *   ③ **日志里禁止出现音频内容 / base64** —— 一条 60s 音频的 base64 ≈ 480 KB，
 *      会把日志撑爆；更要紧的是**它就是用户的口述内容**。这里只记 bytes / duration / requestId；
 *   ④ 体积在**三道**设限（nginx 4m / multer / 应用层 3 MB）。
 *
 * ★ 三个入口共用一个接口（不要做三个）：待办录入 `FR-3.1` / 脑图节点语音键 `FR-7.3`↳① /
 *   胶囊口播 `FR-9.7` —— 三者的差别**全在前端**（回填到哪、什么动画）。
 */
@Injectable()
export class AsrService {
  private readonly logger = new Logger('ASR');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 识别一段音频。
   * @param buffer 音频字节（**只在内存里**，函数结束即失去引用）
   * @param format 小程序录音的 `format`（'mp3' | 'aac' | 'wav' | 'pcm'）
   * @returns `{ text, duration }`
   */
  async recognize(userId: string, buffer: Buffer, format: string) {
    if (!buffer || !buffer.length) throw ApiException.badParam('没有收到音频数据');
    assertSize(buffer.length, AUDIO_MAX_BYTES, '音频');

    // ★★ 顺序是有意的：**配置检查在前、扣配额在后**，别调换。
    //    密钥没配是一个**部署问题** —— 此时一次外部请求都没发出去，腾讯云侧一分额度没动。
    //    若先扣配额，配错的服务器会在 50 次之后对所有用户回「今天的额度已用完」，
    //    而其实一次识别都没发生 ⇒ 一个纯配置错误被伪装成"额度用尽"，排查方向直接跑偏。
    const voiceFormat = normalizeFormat(format);
    const client = this.client();

    await this.consumeQuota(userId);

    // ★ 日志**只记元信息**，绝不记音频内容（硬约束 ③）
    const started = Date.now();

    try {
      const res: any = await client.SentenceRecognition({
        ProjectId: 0,
        SubServiceType: 2, // 2 = 一句话识别
        EngSerViceType: process.env.ASR_ENGINE || '16k_zh',
        // ★★ 这条不许改（硬约束 ②）
        SourceType: 1,
        // ⚠️ 必须与小程序录音的 `format` **严格一致**，填错报 ErrorInvalidVoiceFormat
        VoiceFormat: voiceFormat,
        // Node 的 base64 **默认不带换行** ✅（官方要求"不可带有回车换行符"）
        Data: buffer.toString('base64'),
        // ⚠️ **是 base64 编码之前的字节数**，不是编码之后的长度 —— 这是最容易填错的一个参数
        DataLen: buffer.length,
        // 口播待办场景：过滤标点与语气词，否则待办文字会又长又乱
        FilterPunc: 2,
        FilterModal: 2,
        // 阿拉伯数字智能转换（"三点半"→"3点半"）。默认就是 1，显式写上以免依赖默认值
        ConvertNumMode: 1,
      });

      const text = String(res?.Result || '');
      const duration = Number(res?.AudioDuration || 0);

      this.logger.log(
        `识别成功 bytes=${buffer.length} fmt=${voiceFormat} duration=${duration}ms 耗时=${Date.now() - started}ms requestId=${res?.RequestId || '-'}`,
      );

      return { text, duration };
    } catch (e: any) {
      const errCode = e?.code || e?.ErrorCode || '';
      const requestId = e?.requestId || e?.RequestId || '-';

      // ★ 错误级别日志 —— **仍然只记元信息**（bytes / requestId），不记音频
      this.logger.error(
        `识别失败 code=${errCode} bytes=${buffer.length} fmt=${voiceFormat} requestId=${requestId}`,
      );

      throw mapAsrError(errCode);
    }
  }

  /**
   * 按 userId 的**日配额**（§6.8.1 铁律 ③）。
   *
   * ★ 为什么必须做：腾讯云侧的 **30 次/秒是账号级**限频 —— 一个人（或一段脚本）刷
   *   就能把**全账号** 5000 次/月的免费额度打光，而额度耗尽是**直接失败不扣费**，
   *   表现是所有入口「点了没反应」。
   *   这里的软上限（默认 50 次/天）对 1–5 人是绰绰有余的量级。
   */
  private async consumeQuota(userId: string): Promise<void> {
    const limit = Number(process.env.ASR_DAILY_LIMIT || 50);
    if (limit <= 0) return; // 0 或负数 ＝ 关闭配额（仅调试）

    const day = todayStr();
    const row = await this.prisma.asrQuota.findUnique({ where: { userId } });

    if (!row || row.day !== day) {
      await this.prisma.asrQuota.upsert({
        where: { userId },
        create: { userId, day, used: 1 },
        update: { day, used: 1 },
      });
      return;
    }

    if (row.used >= limit) {
      throw new ApiException(CODE.REJECTED, '今天的语音识别额度已用完，明天再试');
    }

    await this.prisma.asrQuota.update({ where: { userId }, data: { used: { increment: 1 } } });
  }

  /** SDK 客户端 —— 懒建一次（构造它不便宜，但比每个请求都建划算得多） */
  private _client: any = null;
  private client(): any {
    if (this._client) return this._client;

    const secretId = process.env.TENCENT_SECRET_ID || '';
    const secretKey = process.env.TENCENT_SECRET_KEY || '';
    if (!secretId || !secretKey) {
      // ★★ 安全铁律 1：密钥**只存服务端**（小程序包体可解包 ⇒ 下发即公开发布）。
      //    这里直接报配置错，而不是"悄悄降级成一个假的识别结果"—— 静默失败更难查。
      throw ApiException.server('语音识别未配置（缺 TENCENT_SECRET_ID / TENCENT_SECRET_KEY）');
    }

    this._client = new AsrClient({
      credential: { secretId, secretKey },
      region: process.env.ASR_REGION || 'ap-shanghai',
      profile: {
        httpProfile: {
          endpoint: 'asr.tencentcloudapi.com',
          reqTimeout: Number(process.env.ASR_TIMEOUT_MS || 10000),
        },
      },
    });
    return this._client;
  }
}

/** 小程序录音 format → 腾讯云 `VoiceFormat`（必须严格一致，否则 ErrorInvalidVoiceFormat） */
function normalizeFormat(format: string): string {
  const f = String(format || 'mp3').toLowerCase();
  if (f === 'pcm') return 'pcm';
  if (f === 'wav') return 'wav';
  if (f === 'aac') return 'aac';
  if (f === 'm4a') return 'm4a';
  return 'mp3';
}

/**
 * 腾讯云错误码 → 业务异常（§6.8.1 第 6 张小表）。
 * ⚠️ 一律**不重试** —— 重试会重复消耗额度，而额度耗尽后不会悄悄扣费、只会直接失败。
 */
function mapAsrError(code: string): ApiException {
  switch (code) {
    case 'FailedOperation.UserNotRegistered':
      // 服务没在控制台开通 —— 这是**运维问题**，后端日志里有 requestId 可查；前端按"识别失败"降级
      return new ApiException(CODE.REJECTED, '语音识别暂不可用');
    case 'FailedOperation.UserHasNoAmount':
    case 'FailedOperation.UserHasNoFreeAmount':
      return new ApiException(CODE.REJECTED, '本月语音识别额度已用完');
    case 'InvalidParameterValue.ErrorVoicedataTooLong':
      return new ApiException(CODE.REJECTED, '录音过长，请分两段');
    case 'InvalidParameterValue.ErrorInvalidVoiceFormat':
      // ★ 这属于**后端 bug**（小程序 format 与 VoiceFormat 没对齐），不是用户的问题
      return new ApiException(CODE.REJECTED, '语音识别暂不可用');
    default:
      return new ApiException(CODE.REJECTED, '语音识别失败，请重试或直接手打');
  }
}
