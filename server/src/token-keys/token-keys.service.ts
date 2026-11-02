import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { PrismaService } from '../common/prisma.service';
import { decryptSecret, encryptSecret, looksLikeKey, maskKey } from '../common/secrets';
import { tokenKeyOut } from '../common/shape';
import { nowStr } from '../common/time';
import { CreateTokenKeyDto, UpdateTokenKeyDto } from './dto/token-key.dto';
import { vendorOf, VendorSpec } from './vendors';

/**
 * 模型厂家 key（§6.8 · `D-8`）
 *
 * ⚠️ 与 agent 额度是**两件事**（设计定案 §86 脚注）：
 *   · 这一块 ＝ 你在模型厂家**自己开通的 key** 的余额 —— 有公开接口，**能自动查**；
 *   · agent 额度 ＝ 订阅配额，平台没有接口 —— 仍是手填。
 *
 * ★★ 2026-10-12 起这一块是真功能（此前为手填展示）：
 *   存 key（加密）→ 进「我的」页触发 `refresh()` → 服务端代查厂家余额 → 回写 → 前端展示。
 *   ❌ 前端**不直连**厂家：小程序请求域名必须在微信后台加白，且 key 会随包体公开。
 *   ⚠️ 服务端**不缓存**查询结果 —— 余额是"此刻的钱"，缓存只会让用户看到过期数；
 *      「别查太勤」由前端节流负责（见 `mod-mine` 的刷新间隔）。
 */

/** 单次余额查询的超时（ms）。厂家接口很轻，5 秒都算宽裕——超了就是网络/对方的问题 */
const QUERY_TIMEOUT_MS = 8000;

@Injectable()
export class TokenKeysService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateTokenKeyDto) {
    const vendor = this.requireVendor(dto.vendor);
    const key = this.requireKey(dto.apiKey);
    const now = nowStr();

    const row = await this.prisma.tokenKey.create({
      data: {
        // ★ 前端乐观更新时自带 id（可选）；不传就走 cuid 默认值
        id: dto.id || undefined,
        userId,
        vendor: vendor.code,
        /* 新建时还没有余额 —— 留 null（＝「待查询」），由紧随其后的 refresh 填上。
           ⚠️ 不要在这里"顺手查一次"：创建后前端马上会因进入页面触发 refresh，
              查两次既浪费又可能让两次结果互相覆盖。 */
        balance: null,
        apiKeyCipher: encryptSecret(key),
        keyMask: maskKey(key),
        balanceAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    return tokenKeyOut(row);
  }

  /** 改动配置即刷新 `updatedAt`；**换 key 会连带作废旧余额**（见下） */
  async update(userId: string, id: string, dto: UpdateTokenKeyDto) {
    await this.prisma.owned(this.prisma.tokenKey, id, userId, 'API');
    const data: any = { updatedAt: nowStr() };

    if (dto.vendor !== undefined) data.vendor = this.requireVendor(dto.vendor).code;

    if (dto.apiKey !== undefined) {
      const key = this.requireKey(dto.apiKey);
      data.apiKeyCipher = encryptSecret(key);
      data.keyMask = maskKey(key);
      /* ⚠️ 换了 key ⇒ 之前的余额、余额时间、失败原因**全部作废**：
         它们是**上一把 key 的账号**的数，留着就是"显示别人的钱"。
         置 null 之后卡片会退回「待查询」，下次进页面就能查到新 key 的数。 */
      data.balance = null;
      data.balanceAt = null;
      data.lastError = null;
    }

    const row = await this.prisma.tokenKey.update({ where: { id }, data });
    return tokenKeyOut(row);
  }

  async remove(userId: string, id: string) {
    await this.prisma.owned(this.prisma.tokenKey, id, userId, 'API');
    await this.prisma.tokenKey.delete({ where: { id } });
    return { id, deleted: true };
  }

  /**
   * 查该用户**全部** key 的余额并回写，返回最新列表（`POST /token-keys/refresh`）。
   *
   * ★ 并发查（`Promise.all`）：多个账号就是多个请求，串行会让"进页面等半天"，
   *   而它们之间毫无依赖。
   * ★ 一条失败**不影响**其它条 —— 每条的成败各自落回自己那一行。
   * ★ 返回**整份列表**（不是"改了哪几条"）：前端拿到就能整份替换，
   *   省掉"逐条合并"那套容易漏字段的逻辑。
   */
  async refresh(userId: string) {
    const rows = await this.prisma.tokenKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });

    const settled = await Promise.all(
      rows.map(async (row) => {
        const r = await this.queryBalance(row);
        const data: any = {};
        if (r.balance !== undefined) {
          data.balance = r.balance;
          data.balanceAt = nowStr();
          data.lastError = null;
        } else {
          /* ⚠️ 失败时**只写 `lastError`**：
             · 不动 `balance`   —— 上次查到的数仍是有信息量的（"上次是 128.40"）；
             · 不动 `balanceAt` —— 「更新于 X」必须说真话（这个数确实是那时候的）。 */
          data.lastError = r.error || '查询失败';
        }
        return this.prisma.tokenKey.update({ where: { id: row.id }, data });
      }),
    );

    return settled.map(tokenKeyOut);
  }

  /* ==================== 内部 ==================== */

  /** 厂商标识必须在白名单里 —— 前端是引导，这里才是边界 */
  private requireVendor(code: string): VendorSpec {
    const v = vendorOf(code);
    if (!v) throw ApiException.badParam('不支持的模型厂商');
    return v;
  }

  /** API Key 的粗校验 —— 只挡明显的手滑（真正的判据是"能不能查到余额"） */
  private requireKey(raw: string): string {
    const key = String(raw == null ? '' : raw).trim();
    if (!looksLikeKey(key)) throw ApiException.badParam('请填写有效的 API Key');
    return key;
  }

  /**
   * 查一条记录的余额。
   *
   * @returns `{ balance }` 成功（单位：**分**）／ `{ error }` 失败（**给用户看的一句话**）
   *
   * ⚠️ 失败措辞是**产品文案**，不是日志：要能直接进卡片提示，且必须区分开
   *    「你的 key 不对」与「我们/网络出问题」—— 前者用户能自己修，后者只能等。
   */
  private async queryBalance(row: any): Promise<{ balance?: number; error?: string }> {
    const vendor = vendorOf(row.vendor);
    if (!vendor) return { error: '不支持的模型厂商' };
    if (!row.apiKeyCipher) return { error: '未配置 API Key' };

    let key: string;
    try {
      key = decryptSecret(row.apiKeyCipher);
    } catch {
      /* 密钥换了 / 密文损坏 —— 这是**运维问题**，不是用户填错了，措辞上要分开 */
      return { error: '密钥不可用，请重新填写 API Key' };
    }

    const fetchFn: any = (globalThis as any).fetch;
    if (typeof fetchFn !== 'function') return { error: '服务端缺少查询能力' };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), QUERY_TIMEOUT_MS);
    try {
      const res = await fetchFn(vendor.balanceUrl, {
        method: 'GET',
        headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
        signal: ctl.signal,
      });

      /* 401/403 ⇒ key 无效：这是用户能自己修的那一类，文案要直说 */
      if (res.status === 401 || res.status === 403) return { error: 'API Key 无效或已失效' };
      if (res.status === 429) return { error: '查询太频繁，稍后再试' };
      if (!res.ok) return { error: '厂家接口返回 ' + res.status };

      let json: any = null;
      try {
        json = await res.json();
      } catch {
        return { error: '厂家返回内容无法解析' };
      }

      const cents = vendor.parseBalance(json);
      if (cents === null || cents === undefined) return { error: '厂家返回的余额格式无法识别' };
      return { balance: cents };
    } catch (e: any) {
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.name || '')));
      return { error: aborted ? '查询超时' : '连不上厂家接口' };
    } finally {
      clearTimeout(timer);
    }
  }
}
