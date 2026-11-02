import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ApiException } from '../common/api-exception';
import { CODE } from '../common/codes';
import { nowStr } from '../common/time';
import { PrismaService } from '../common/prisma.service';
import { WxService } from '../common/wx.service';
import { urlFor } from '../common/upload';

/** 登录返回体（与 §6.3 的 `POST /auth/login` 出参逐字一致） */
export interface LoginResult {
  token: string;
  expiresIn: number;
  user: { id: string; nickname: string; avatar: string; avatarUrl: string };
}

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger('Auth');

  /** 「开放期」这条警告只打一次 —— 否则每个用户登录都刷一行，真出事时反而看不见 */
  private warnedOpenAll = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly wx: WxService,
  ) {}

  /**
   * 启动时把「白名单开没开」说清楚。
   *
   * ★ 为什么值得单列一条启动日志：`.env` 是应用自己用 dotenv 读的，**PM2 的
   *   `--update-env` 对 `.env` 里的键不起作用**（`/proc/<pid>/environ` 里根本看不到它们）。
   *   于是"我把开关改成 false 了，怎么还开着"这类问题**没有任何直接证据可查**，
   *   只能靠猜。有这一行之后：`pm2 logs` 里看一眼就知道当前是哪个态。
   */
  onModuleInit(): void {
    if (allowAnyUser()) {
      this.warnedOpenAll = true;
      this.logger.warn(
        '⚠️ ALLOW_ANY_USER=true —— 白名单校验已关闭：任何登录都会自动建号（临时开放期）',
      );
    } else {
      this.logger.log('白名单校验已启用（ALLOW_ANY_USER 未开启）');
    }
  }

  /**
   * 微信登录链路（§7.1 时序图）：
   *   `wx.login` 的 code → code2session 换 openid → **查白名单** → upsert User → 签发 JWT。
   *
   * ★ 白名单这一步不能省（§7.3）：不做的话，任何打开小程序的人都会自动注册并占用你的库；
   *   一旦被刷还会有内容安全风险。被拒的人会被记进「待批列表」——
   *   否则你无从知道朋友的 openid 是什么（openid 只能由微信侧给出，不能手填）。
   */
  async login(code: string): Promise<LoginResult> {
    const openid = await this.resolveOpenid(code);

    if (allowAnyUser()) {
      // ★ 开放期（ALLOW_ANY_USER=true，见下方说明）：不校验白名单，来者不拒
      await this.admitOpenly(openid);
    } else {
      const allowed = await this.prisma.allowlist.findUnique({ where: { openid } });
      if (!allowed) {
        await this.recordPending(openid);
        // 前端据此显示「暂无使用权限」页，**不重试**
        throw new ApiException(CODE.NOT_ALLOWED, '暂无使用权限');
      }
    }

    const now = nowStr();
    const user = await this.prisma.user.upsert({
      where: { openid },
      create: { openid, nickname: '我的工位', createdAt: now, updatedAt: now },
      update: { updatedAt: now },
    });

    const token = await this.jwt.signAsync({ sub: user.id, openid: user.openid });
    const expiresIn = parseExpiresIn(process.env.JWT_EXPIRES_IN || '7d');

    this.logger.log(`登录成功 user=${user.id} openid=${maskOpenid(openid)}`);

    return {
      token,
      expiresIn,
      user: {
        id: user.id,
        nickname: user.nickname,
        avatar: user.avatar || '',
        avatarUrl: urlFor(user.avatar),
      },
    };
  }

  /**
   * 换 openid。
   *
   * ★ `DEV_OPENID`：**仅非生产环境**生效的本机调试通道 —— 设了它就不打微信接口，
   *   直接用这个 openid 登录（方便本地把整条链路跑通、做接口自测）。
   *   生产环境该变量即使存在也被忽略，不会成为一条后门。
   */
  private async resolveOpenid(code: string): Promise<string> {
    const devOpenid = process.env.DEV_OPENID || '';
    if (devOpenid && process.env.NODE_ENV !== 'production') {
      this.logger.warn(`⚠️ DEV_OPENID 生效（仅调试）：openid=${maskOpenid(devOpenid)}`);
      return devOpenid;
    }
    if (!code) throw ApiException.badParam('缺少登录凭证 code');
    const r = await this.wx.code2session(code);
    // session_key 拿到即弃：本项目不解密任何东西（§7.1 要点 4）
    return r.openid;
  }

  /**
   * 开放期的准入 —— 不校验白名单，但**顺手把 openid 写进白名单**。
   *
   * ★ 为什么仍要写白名单（这是这个开关唯一"以后不会踩"的保障）：
   *   等哪天把 `ALLOW_ANY_USER` 关回去，**已经来过的朋友不会突然被 1002 挡在门外**。
   *   否则你得手工补一遍 openid —— 而 openid 你自己根本拿不到（只能由微信侧给出）。
   * ★ note 固定为 `auto`：日后在 `GET /admin/allowlist` 里能一眼分清
   *   "开放期自动进来的"与"我手工加的"。
   */
  private async admitOpenly(openid: string): Promise<void> {
    if (!this.warnedOpenAll) {
      this.warnedOpenAll = true;
      this.logger.warn(
        '⚠️ ALLOW_ANY_USER=true —— 白名单校验已关闭，任何登录都会自动建号（仅限临时开放期）',
      );
    }
    try {
      await this.prisma.allowlist.upsert({
        where: { openid },
        create: { openid, note: 'auto', createdAt: nowStr() },
        update: {},
      });
    } catch (e: any) {
      // ★ 加白失败**不能**挡住登录：开放期的本意就是"来者不拒"。
      //   万一真挡了，用户看到的会是 5000，而真实原因只是一次无关紧要的 INSERT 失败。
      this.logger.warn(`开放期写白名单失败（不影响本次登录）：${e?.message || e}`);
    }
  }

  /** 被 1002 拒绝的人记一行 —— 你据此把朋友的 openid 插进白名单（§7.3） */
  private async recordPending(openid: string): Promise<void> {
    const now = nowStr();
    try {
      await this.prisma.pendingUser.upsert({
        where: { openid },
        create: { openid, hitCount: 1, firstSeen: now, lastSeen: now },
        update: { hitCount: { increment: 1 }, lastSeen: now },
      });
    } catch (e: any) {
      this.logger.warn(`记录待批用户失败：${e?.message || e}`);
    }
    this.logger.warn(`拒绝未在白名单的 openid=${maskOpenid(openid)}`);
  }
}

/**
 * ★★ `ALLOW_ANY_USER`（.env，默认关）—— **临时开放注册**。
 *
 *   短期给朋友用时打开：跳过白名单，任何人登录都自动建号（各自一份独立数据，
 *   因为 Project/Todo/Mindmap/Capsule 全部带 `userId` 外键）。
 *   关掉就回到 §7.3 的严格白名单 —— 不用改代码，`pm2 reload` 即可。
 *
 * ⚠️ 只认**布尔字面量** `true`（**大小写不敏感**，`True`/`TRUE` 都算）；
 *    `1` / `yes` / `on` / 留空 一律**不算**开着：
 *    宁可多打四个字母，也不要出现"以为关着、其实开着"这种只有出事才知道的状态。
 */
function allowAnyUser(): boolean {
  return String(process.env.ALLOW_ANY_USER || '').trim().toLowerCase() === 'true';
}

/** openid 只打前 6 位（§7.4 第 10 条：日志脱敏） */
export function maskOpenid(openid: string): string {
  const s = String(openid || '');
  return s.length <= 6 ? s + '***' : s.slice(0, 6) + '***';
}

/** '7d' / '12h' / '3600' → 秒 */
function parseExpiresIn(v: string): number {
  const m = /^(\d+)\s*([smhd])?$/.exec(String(v).trim());
  if (!m) return 7 * 24 * 3600;
  const n = Number(m[1]);
  const unit = m[2] || 's';
  return n * ({ s: 1, m: 60, h: 3600, d: 86400 } as Record<string, number>)[unit];
}
