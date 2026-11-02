import { Injectable } from '@nestjs/common';
import { ApiException } from '../common/api-exception';
import { CODE } from '../common/codes';
import { ENHANCE_SYSTEM_PROMPT } from './prompt.enhance';
import { Guarded, Restored, buildNotice, extractLinks, restoreLinks } from './link-guard';

/** 读环境变量，缺了就当场失败（**不要**"缺 key 就降级返回原文" —— 那是静默错误）
 *  ★ 280 轮：改成 `export` ——「语义转脑图」那条链要读同一批 `ARK_*` 变量。
 *    共享这一个函数而不是各写一份，是因为 `ARK_MODEL` 的默认值一旦有两处，
 *    哪天换模型就一定会漏掉一处（而且漏掉那处只在"没配环境变量"时才现形）。 */
export function env(name: string, fallback = ''): string {
  const v = process.env[name];
  return (v === undefined || v === null ? fallback : String(v)).trim();
}

@Injectable()
export class AiService {
  /** 每用户最小间隔（毫秒）—— 单实例 pm2，内存 Map 就够；多实例时改 Redis */
  private static readonly GAP_MS = 3000;
  /** ⚠️ key 必须是 **string** —— `AuthUser.userId` 就是 string（见 current-user.decorator） */
  private readonly lastAt = new Map<string, number>();

  async enhance(userId: string, text: string): Promise<{ text: string; model: string; notice: string }> {
    const src = String(text || '').trim();
    if (!src) throw ApiException.badParam('没有可增强的内容');

    /* ★ 节流：连点 / 手抖重试不该变成两次计费。
       ⚠️ 用 `REJECTED`(2005) 而不是 5000：这是"当前不允许该操作"，前端按轻提示处理，
          而且**不自动重试**。 */
    const now = Date.now();
    const prev = this.lastAt.get(userId) || 0;
    if (now - prev < AiService.GAP_MS) throw ApiException.rejected('刚刚已经增强过一次，请稍候');
    this.lastAt.set(userId, now);

    const key = env('ARK_API_KEY');
    if (!key) {
      /* 配置缺失是**服务端事故**，报 5000（前端不自动重试），并在日志里喊清楚。
         绝不把原文当"增强结果"返回 —— 用户会以为模型就这水平。 */
      console.error('[ai] ARK_API_KEY 未配置');
      throw new ApiException(CODE.SERVER, '增强服务未配置，请联系管理员');
    }

    const base = env('ARK_BASE_URL', 'https://ark.cn-beijing.volces.com/api/v3');
    const model = env('ARK_MODEL', 'deepseek-v4-1-flash-261017');

    /* ★★ 抽换：发请求**之前**把图片语法与裸链接换成 `[[图N]]` / `[[链接N]]`。
       ⇒ 模型全程看不见任何 URL。三件事同时成立：图不可能被改写、模型无从"读图"、
         这一段还省了几百 token。回填在拿到结果之后（见本函数末尾）。 */
    const guarded: Guarded = extractLinks(src);
    if (guarded.map.length) {
      console.log('[ai] links guarded', guarded.map.length, 'chars', src.length, '->', guarded.text.length);
    }

    /* ★ 只有图（或只有链接）、几乎没有文字的待办：**不调模型**。
       实测这种输入模型只会输出一句"请查看 [[图1]]"之类的空话，用户白等十几秒、我们白付一次费用。
       判断放在抽换**之后**：此时图已经变成占位符，剥掉剩下的 `[[…]]` 才是"真正的文字量"。
       ⚠️ 阈值 8 是拍的：一个"改一下"都不止 3 个字，8 足够把"只有图"与"极短但有内容"分开。 */
    if (guarded.text.replace(/\[\[[^\]]*\]\]/g, '').trim().length < 8) {
      throw ApiException.badParam('这条待办几乎没有文字，增强帮不上忙，可直接复制原图链接');
    }

    const ctrl = new AbortController();
    /* ★ 50 秒：比前端的 55 秒短 —— 让**后端先超时**，前端拿到的永远是一条
       有成因的中文文案，而不是被微信掐断的 `request:fail timeout`。 */
    const timer = setTimeout(() => ctrl.abort(), 50_000);

    let resp: Response;
    try {
      resp = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${key}`,
        },
        signal: ctrl.signal,
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: ENHANCE_SYSTEM_PROMPT },
            /* ★⚠️ `content` 必须是**纯字符串**，绝不许写成数组（`[{type:'text'},{type:'image_url'}]`）。
               这是本功能的一条硬边界：这是**纯文本改写**，一旦有人往这里塞图片，
               等于每张图几百上千 token、还要模型去"看图" —— 用户明确不要这件事。判据 E11 就是守这个。 */
            { role: 'user', content: guarded.text },
          ],
          /* ★★ 关思考：这是"改写一段文本"，不需要推理。
             `reasoning_effort: 'none'` 是方舟给本模型族的关闭档。
             不关的话默认 `high`，一次改写要跑几千个思考 token —— 用户在那儿看转圈，
             我们这边按思考 token 计费。这是本方案**唯一一处必须显式调的参数**。 */
          reasoning_effort: 'none',
          /* 温度偏低：改写要稳，不要"每次都不一样" */
          temperature: 0.3,
          /* 非思考默认 8K；给 4K 足够（提示词里限了长度），超了截断而不是报错 */
          max_tokens: 4096,
          /* ★ 显式 false —— 需求要求非流式。方舟默认就是 false，
             但写出来，免得以后有人"顺手开流式"而前端根本没接。 */
          stream: false,
        }),
      });
    } catch (e: any) {
      clearTimeout(timer);
      const aborted = e && (e.name === 'AbortError' || /abort/i.test(String(e.message)));
      console.error('[ai] ark fetch failed', aborted ? 'timeout' : (e && e.message));
      throw new ApiException(CODE.SERVER, aborted ? '增强超时了，请稍后重试' : '增强服务暂时不可用');
    }
    clearTimeout(timer);

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      console.error('[ai] ark http', resp.status, body.slice(0, 500));
      throw new ApiException(CODE.SERVER, '增强服务暂时不可用');
    }

    const json: any = await resp.json().catch(() => null);
    const raw = json?.choices?.[0]?.message?.content;
    const out = cleanEnhanced(typeof raw === 'string' ? raw : '');
    if (!out) {
      console.error('[ai] empty enhancement, usage=', JSON.stringify(json?.usage || {}));
      throw new ApiException(CODE.SERVER, '增强结果为空，请重试');
    }

    /* ★★ 回填：占位符换回原串。`restoreLinks` 保证**一条都不会丢**（漏掉的补到末尾），
       所以这里不需要"图片少了就报错"那种分档 —— 最坏情况是位置挪了，由 notice 告知。 */
    const r: Restored = restoreLinks(out, guarded);
    const notice = buildNotice(r, guarded);
    if (r.moved || r.dup || r.ghost || r.orderBroken) {
      console.warn(
        '[ai] link restore',
        JSON.stringify({
          moved: r.moved,
          dup: r.dup,
          ghost: r.ghost,
          orderBroken: r.orderBroken,
          total: guarded.map.length,
        }),
      );
    }
    return { text: r.text, model, notice };
  }
}

/**
 * 输出清洗 —— 三个动作，缺一不可：
 *  ① 剥代码围栏：模型很爱把 Markdown 结果整段包进围栏（三个反引号 ＋ 语言名，实测高频）
 *  ② 剥首尾包裹引号：与 WorkBuddy 的 `stripWrappingQuotes` 同一招
 *  ③ trim ＋ 空判
 * ⚠️ **不做**"删掉第一行"这类猜测式清洗：那会吃掉真正的标题行。
 */
function cleanEnhanced(s: string): string {
  let t = String(s || '').replace(/^\uFEFF/, '').trim();
  const fence = /^`{3}[a-zA-Z]*\s*\n([\s\S]*?)\n?`{3}$/.exec(t);
  if (fence) t = fence[1].trim();
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  return t;
}
