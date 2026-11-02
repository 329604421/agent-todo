/**
 * utils/api.js —— Agent ToDo 的**唯一网络出口**。
 *
 * 设计依据：《技术开发文档-01 V1.2》§9.1。四条硬约定（都不是风格问题）：
 *
 * ① ★★ **两个开关（不是一个），见下方「开关」区**：
 *    · **`_mock`（数据源）** —— `true` ＝ 全程走 `utils/mock.js`，一个请求都不发。
 *      ⚠️ **这个开关本身必须留着**：`工具/` 下的全部核验脚本与出图脚本（`shoot_*.py` /
 *      `check_round*.py`）都吃那份种子数据，114 轮积累的核验能力靠它活着。
 *    · **`_fallback`（失败回落）** —— ★★ **默认 `false`**：连不上后端时**清空成空 ＋ 说清成因**，
 *      **绝不把演示数据冒充成真数据**（"只显示数据库数据"这条就落在它身上）。
 *      要回"停掉后端也能出图"的老口径 ⇒ 把它置 `true`（一行，见「开关」区注释）。
 *
 * ② **token 注入 ＋ `1001` 静默重登**：1001 时自动 `wx.login` 换 token 重试**一次**，
 *    再失败才把错误抛给调用方。
 *
 * ③ **`timeout: 15000`，且失败要区分「超时 / 网络 / 业务」三类**。
 *    §4.3.3 已测算：3 Mbps 下带图请求可能要几秒。超时的提示文案必须与业务错误不同
 *    —— 否则用户会以为"数据被拒了"，而其实只是网慢。
 *
 * ④ **不在本层拼图片 URL**。`GET /sync` 与列表接口给的是相对 `uri`，拼完整 URL 是
 *    调用方的**显式动作**（用下面的 `fileUrl()`），避免"顺手全拼一遍然后被预加载"
 *    —— 3 Mbps 下预取 20 张图要 16 秒（§6.2 红框）。
 */

/* ==================== 开关 ==================== */

/**
 * ★ ★★ **`_mock` —— 前端的数据源开关**（`技术开发文档-01 V1.2` §9.6）。
 *
 *   · `true`  —— 全部来自 `utils/mock.js`，**一个网络请求都不发、也不走登录**。
 *                 这是**出图 / 走查态**：`工具/` 下的全部核验与出图脚本
 *                 （`shoot_*.py` / `check_round*.py`）都吃这份种子数据。
 *   · `false` —— `wx.login` → `GET /sync` → `store.hydrate()`。
 *
 * ⚠️ 当前的初值是 **`false`（联调 / 上线态 · 2026-09-30 起）**，必须与下面 `BASE` 配套。
 */
let _mock = false;

/**
 * ★ ★★ **`_fallback` —— 「拉不到后端时，要不要拿演示数据顶上」**（2026-09-30 新增）。
 *
 *   · `false`（**默认 · 联调 / 上线态**）—— **不回落**：`store.boot()` 失败时调用
 *     `store.wipeToEmpty()` 把内存清成**真的空**（零基线 ＋ 空树 ＋ 无记忆），
 *     再把成因用 toast 说清。
 *     ★ 这条是为了守一句产品口径：**「界面上只可能出现数据库里的数据」** ——
 *       拉不到就空着，绝不许 demo 数据冒充真数据（不然"库是空的"与
 *       "根本没连上"在界面上长得一模一样，部署排障会被带偏）。
 *   · `true`（**老口径**）—— 失败后保持内存里的种子数据不动 ⇒
 *     「**停掉后端也能出图**」（README §3.4 那套走查姿势靠的就是它）。
 *     ⚠️ 要用那条姿势时**必须显式打开这里**，否则界面会是空的、出图会全废。
 *
 * 想彻底不走网络（连登录都不发）⇒ 那是 `_mock`，不是这里；两者别混。
 */
let _fallback = false;

function useMock() { return _mock; }
function setMock(v) { _mock = !!v; }
/** 失败是否回落成种子数据 —— 见上面 `_fallback` 的注释 */
function useFallbackMock() { return _fallback; }
function setFallbackMock(v) { _fallback = !!v; }

/* ==================== 基址 ==================== */

/**
 * 后端基址。★ 换成正式域名后，**微信后台要配三类域名**
 * （`request` / `uploadFile` / `downloadFile`），且**二级域名不支持泛域名、必须精确添加**。
 * 图片与 API 同域时可一鱼两吃（见 docs/deployment.md）。
 *
 * ★★ **两个 host 分开写，按运行环境自动挑**（2026-09-30 修 · 真机联调踩过的坑）：
 *   · IDE 模拟器与后端**同机** ⇒ `127.0.0.1` 就是后端，能连。
 *   · **真机 / 平板**下 `127.0.0.1` 指的是**设备自己** ⇒ 所有请求必然失败，
 *     而 `store.boot()` 失败会**静默回落 mock** ⇒ 现场症状正好是
 *     「推到平板还是演示数据、也没有登录」——
 *     看起来像"没接后端"，其实是"连不上后端"。所以这里按平台自动切，别再手动改来改去。
 *   · `HOST_DEVICE` 必须是**开发机的局域网 IP**（`ipconfig` 看 WLAN 那个），
 *     且要一起改 `server/.env`：`HOST=0.0.0.0` ＋
 *     `FILE_BASE_URL=http://<同一个 IP>:3000`（漏了后者 ⇒ 上传的图片全是裂的）；
 *     再放通防火墙 3000、设备与开发机连同一个 WiFi。
 *     换网络 / 换了 DHCP 给的 IP ⇒ **这两处都要跟着改**（一个在代码里、一个在 .env）。
 *
 * ⚠️ `http://` 明文请求依赖 `project.config.json` 的 `setting.urlCheck = false`（已配好）。
 *    真机上若仍被拦（报"不在以下 request 合法域名列表中"），把开发版调成
 *    **调试模式**（手机里右上角 `···` → 打开调试）—— 开发版开调试会跳过域名校验。
 */

/** 开发机局域网 IP（真机 / 平板联调用）—— 换成你自己机器的 IP（`ipconfig` 看 WLAN 那个） */
const HOST_DEVICE = '192.168.1.100:3000';
/** IDE 模拟器用（与后端同机） */
const HOST_DEVTOOLS = '127.0.0.1:3000';

/** 当前运行环境名（`devtools` / `ios` / `android` / `windows` / `mac` …） */
function platformName() {
  try { if (typeof wx.getDeviceInfo === 'function') return (wx.getDeviceInfo().platform || ''); } catch (e) { /* 老基础库 */ }
  try { return (wx.getSystemInfoSync().platform || ''); } catch (e) { return ''; }
}
/** ★ 在开发者工具里才走回环 —— 其余（真机 / 平板 / PC 端小程序）一律走局域网 */
function isDevtools() { return platformName() === 'devtools'; }

/**
 * ★★ **2026-10-08 已上线：走正式域名**（`api.example.com`）。
 *
 *   · 上线前这里是「按平台现算」的联调写法：
 *       `'http://' + (isDevtools() ? HOST_DEVTOOLS : HOST_DEVICE) + '/api/v1'`
 *     —— 它解决的是"真机上 127.0.0.1 指设备自己"那个坑（见下面 HOST_* 的注释）。
 *     要回到联调态，把下面这行换回那个表达式即可（HOST_* 两个常量都还在）。
 *   · 上线后**开发者也走正式域名**：微信后台已加白，开发者工具不必再关校验。
 *
 * ⚠️ **微信后台必须加白三类域名**（request / uploadFile / downloadFile 各一次）：
 *    二级域名要**单独添加**，小程序后台不支持泛域名。见 docs/deployment.md。
 * ⚠️ 换域名时**只改这一行**：`fileUrl()` 从 BASE 推导 origin，图片前缀会跟着变。
 */
const BASE = 'https://api.example.com/api/v1';

/** 图片完整地址 —— **只在详情 / 预览这类真的要看图的场合调用**，别在 sync 之后批量调 */
function fileUrl(uri) {
  if (!uri) return '';
  if (/^https?:\/\//i.test(uri)) return uri;   // 种子数据里的外链原样放行
  const origin = BASE.replace(/\/api\/v1\/?$/, '');
  return origin + '/files/' + uri;
}

/* ==================== token ==================== */

const TOKEN_KEY = 'agenttodo.token';

function token() {
  try { return (wx.getStorageSync(TOKEN_KEY) || '').trim(); } catch (e) { return ''; }
}
function setToken(t) {
  try { wx.setStorageSync(TOKEN_KEY, String(t || '')); } catch (e) { /* 存不下也不影响本次会话 */ }
}
function clearToken() {
  try { wx.removeStorageSync(TOKEN_KEY); } catch (e) { /* 同上 */ }
}

/* ==================== 错误 ==================== */

/**
 * 统一错误对象。
 * `kind` 决定提示文案（§9.1 第 3 点）：
 *   'timeout'  请求超时 —— 「网络不太好，稍后再试」
 *   'network'  连不上 / DNS / 断网 —— 「网络不太好，稍后再试」
 *   'biz'      后端明确回的业务错 —— 直接展示后端的 `message`（如「已被「青」占用」）
 *   'auth'     没登录 —— 需要重新走登录
 *
 * ★★ 2026-09-30：多带一个 `raw`（＝微信原始的 `errMsg`，如
 *    `request:fail url not in domain list` / `request:fail timeout`）。
 *    **只用于诊断**，不拿去给用户看。为什么必须留：真机 / 平板联调时，
 *    所有的连接失败都被归并成了同一句"网络不太好"，于是
 *      「域名没校验」（要在手机上打开调试）与
 *      「压根不在同一个网段」（要查 WiFi / 防火墙）
 *    在界面上**长得一模一样** —— 现场只能靠猜。带上原始 errMsg，
 *    `app.js` 就能把这两类分开说，省掉一整轮"改了再推一次试试"。
 */
function apiError(kind, code, message, raw) {
  const e = new Error(message || kind);
  e.kind = kind;
  e.code = code;
  if (raw) e.errMsg = String(raw);
  return e;
}

/* ==================== 失败提示（真机联调） ==================== */

/**
 * ★★ 把一次失败翻译成**一句可执行的话**（真机 / 平板联调专用，2026-09-30）。
 *
 * 为什么需要：真机连不上后端有**三种完全不同的成因**，而它们在小程序里的表现一模一样
 * （都是 `fail` 回调 ⇒ 都归到 `kind='network'`）：
 *   ① **域名没校验** —— 该域名不在微信后台「开发设置 → 服务器域名」里。
 *      真机：开发版 / 预览版可用「打开调试」跳过校验（手机右上角 `···` → 打开调试）；
 *            体验版 / 正式版**没有这个豁免**，只能回后台加白 —— 这是最容易漏的一环。
 *      ★★ 2026-10-08：`setting.urlCheck` 已改 `true`（上线后工具也走正式域名），
 *         于是**同一句原始错误在开发者工具里也会出现**；而工具里根本没有"右上角 `···`"
 *         这个入口 ⇒ 原先只有真机那一句，在工具里会把人指去点一个不存在的东西。
 *         原因在下面按 `isDevtools()` 分开给（这是打开 `urlCheck` 的连带改动）。
 *   ② **设备与开发机不在同一网段** —— 手机走的是蜂窝 / 另一个 SSID，`10.x` 直接不可达。
 *   ③ **TCP 到得了但没人应答** —— 后端没起 / 监听在回环 / 防火墙拦了 3000。
 * 三者的**处置完全不同**，所以这里必须分开说；否则现场只剩"连不上"三个字，
 * 只能靠"改一个、推一次、再看"来试。
 *
 * @param {object} e 错误对象（`{ kind, code, message, errMsg }`）——
 *                   也直接吃 `store.boot()` 的回执，两者字段同形。
 * @returns {string} 短提示（直接喂 `wx.showToast` 的 title，别超过 ~20 字）
 */
function netHint(e) {
  const raw = String((e && e.errMsg) || '');
  const kind = (e && e.kind) || '';
  const code = (e && e.code) || 0;
  /* 只留 host:port —— 提示里塞一整条 `…/api/v1` 会把 toast 挤爆 */
  const host = String(BASE).replace(/^https?:\/\//i, '').replace(/\/.*$/, '');

  /* 微信自己的原话，最准：`request:fail url not in domain list` */
  if (/not in domain list|url not in domain|合法域名/i.test(raw)) {
    /* ★ 分平台：同一句原始错误，两边的"下一步"完全不同（2026-10-08 修）——
     *   · 工具：根因只有一个 ⇒ 去微信后台加白该域名（工具里没有"右上角 ···"可点）。
     *   · 真机：先用「打开调试」当场解锁，再回后台加白。 */
    return isDevtools()
      ? '域名未校验：微信后台未加白该域名'
      : '域名未校验：手机右上角 ··· → 打开调试';
  }
  /* 白名单没开 = 正常业务结果，不是故障（说清"没开通"，别说"网络错误"） */
  if (code === 1002) return '这个账号还没开通';
  if (kind === 'auth' || code === 1001) return '登录失效，请重新进入小程序';
  /* ★★ 2026-10-22（审查 P3-03）· **两类宿主说两种话**。
     ── 改前："连接超时 api.example.com（同一 WiFi？）" / "连不上 …（同一 WiFi？防火墙？）"。
        那两句是**内网联调期**的前提（后端跑在开发机的 3000 端口），而 2026-10-08 起
        全端都走正式域名 `https://api.example.com` —— 用户看到"同一 WiFi？防火墙？"
        只会以为"我得连开发机的 WiFi"，而唯一正确的下一步是"检查网络后重试"。
     ── 现在：**开发者工具**保留 host 与"本机后端"的线索（那段信息只对开发者有用）；
        正式环境（手机 / PC 客户端）只说用户能做的事，host 也不再露出来（对用户无意义）。
     ⚠️ 判据只用 `isDevtools()`（平台事实），不加"调试开关"—— 一个可被打开的开关
        迟早会在出问题时停在错的那一档上（107 轮 `setForce` 的教训）。 */
  if (kind === 'timeout') {
    return isDevtools()
      ? '连接超时 ' + host + '（本机后端起来了吗）'
      : '连接超时，请检查网络后重试';
  }
  if (kind === 'biz') return (e && e.message) || '服务端拒绝了这次请求';
  if (kind === 'network') {
    return isDevtools()
      ? '连不上 ' + host + '（本机后端 / 域名校验？）'
      : '网络不太好，请检查网络后重试';
  }
  return (e && e.message) || '加载失败';
}

/**
 * ★★ 语音识别失败的翻译（2026-09-30）。
 *
 * 为什么单独一层：`POST /asr` 的失败有**四种成因**，而原来两个语音入口
 * （闪念胶囊口播 / 脑图节点语音键）都只弹一句「没听清」——
 * 于是一个"没连上后端"会被读成"识别不准"，用户只会反复重按，永远试不通。
 *
 * ⚠️ 顺序有意义：**录音器自己的报错排最前**（原因最确定），
 *    然后才是"没有音频文件"，最后才交给 `netHint()` 分档。
 *
 * ★★ 2026-09-30 修正：原来这里把"没有音频文件"一律解释成
 *    「开发者工具不真录音」—— 那是不准确的：**工具里是能录的**
 *    （`wx.getRecorderManager()` 走电脑麦克风），只是本工程为了不影响出图，
 *    用 `REC_IN_TOOLS = false` **主动关掉了**（见 `capsule.js` 那个常量）。
 *    所以工具里那一档要**说清"是我们关的、怎么打开"**，否则用户会一直以为设备不支持。
 *
 * @param {object} e        错误对象（`api.asr()` 的 reject 值）
 * @param {boolean} hasFile 有没有真的拿到录音文件（空串 ＝ 没有）
 * @param {string} [recErr] 录音器自身的 `errMsg`（`RecorderManager.onError` 给的）
 */
function asrHint(e, hasFile, recErr) {
  if (recErr) return '录音不可用：' + shortErr(recErr);
  if (!hasFile) {
    return platformName() === 'devtools'
      ? '工具默认不录音，要联调请把 REC_IN_TOOLS 改成 true（或上真机）'
      : '没听到声音，点开始后说一段话';
  }
  const msg = String((e && e.message) || '');
  /* `api.asr()` 在 filePath 为空时自己抛的那一条 —— 与上面的兜底同一件事 */
  /* ★ 2026-10-22（审查 P3-03）：原来这句是「按住多说一会儿」——
     而录音入口（手机底部录音条 / 平板悬浮块 / 脑图语音键）**都是"点一下开始、再点一下停"**，
     没有任何一处是长按。「按住」会把人教成一直按着屏幕，反而录不到。
     ⚠️ 工具里那一档不受影响（上面已按平台分叉）。 */
  if (/没有录到声音/.test(msg)) return '没听到声音，点开始后说一段话';
  return netHint(e);
}

/**
 * 把微信的原生 `errMsg` 压成一句短的（toast 一行放不下整串）。
 *
 * ★★ 2026-10-23（257）· **`error PCM` 这一档必须翻译，不能再吐英文码**。
 *    用户截图里的原话是「录音不可用: errType:1, err:error PCM」——那是
 *    `RecorderManager.onError` 的原始 `errMsg` 被末尾那条 `slice(0,24)` 截出来的。
 *    它的物理含义是**录音的 PCM 采集通道打不开**（拿不到原始音频）：
 *    · 官方社区同一条报错（`{"errCode":1,"errMsg":"errType:1, err:error PCM record callback"}`）
 *      的结论是"部分安卓机不能边录屏边录音"、"live-pusher 与录音冲突"——
 *      无论是哪一条，都是**麦克风被另一路采集占着**；
 *    · 它**不是**权限（那是 `auth deny` / `system permission denied`）、
 *      **不是**参数（那是 `format/sample invalid`）、更不是网络。
 *    所以"下一步"只有一句：把占着麦克风的那路关掉再试。
 *    ⚠️ `errType:\s*1` 也收：有的基础库只给 `errType:1` 不带 `error PCM` 字样。
 *    ⚠️ 顺序放在 `format|sample|invalid` **之前**：`error PCM record callback`
 *      里没有这几个词，但某些实现会给 `... PCM, invalid buffer`，先命中更准的那档。
 */
function shortErr(s) {
  const m = String(s || '');
  if (/auth deny|authorize/i.test(m)) return '麦克风没授权';
  if (/system permission/i.test(m)) return '系统没给麦克风权限';
  if (/error\s*PCM|PCM\s*record|errType:\s*1/i.test(m)) return '麦克风被占用，关掉录屏或通话再试';
  if (/occupied|in use|busy/i.test(m)) return '麦克风被占用';
  if (/format|sample|invalid/i.test(m)) return '录音参数不被支持';
  /* ★ 兜底也**不再吐英文**：`errMsg` 的原串留在 `console`（见两个组件的 onError），
     toast 只给用户能听懂的一句话 —— 报错本身不该成为第二个谜题。 */
  return '录音启动失败，重开小程序再试';
}

/* ==================== 请求层（内部） ==================== */

let _relogining = null;      // 并发 1001 时只登一次

/**
 * Promise 化 wx.request。
 * @param {string} method  GET / POST / PATCH / PUT / DELETE
 * @param {string} path    '/sync'（不含 /api/v1）
 * @param {object} [data]
 * @param {object} [opt]   { auth:false 不注入 token · retry:false 不自动重登 · timeout }
 */
function request(method, path, data, opt) {
  const o = opt || {};
  if (_mock) return Promise.resolve(null);

  return new Promise(function (resolve, reject) {
    const header = { 'content-type': 'application/json' };
    const tk = token();
    if (o.auth !== false && tk) header.Authorization = 'Bearer ' + tk;

    wx.request({
      url: BASE + path,
      method: method,
      data: data === undefined ? {} : data,
      header: header,
      /* ★ 15 秒：3 Mbps 下带图请求可能要几秒，给足余量 */
      timeout: o.timeout || 15000,
      success: function (res) {
        const body = res && res.data;
        if (!body || typeof body !== 'object') {
          reject(apiError('network', res && res.statusCode, '服务返回异常'));
          return;
        }
        if (body.code === 0) { resolve(body.data); return; }

        /* ★ 1001：token 失效 → 静默重登一次再重试。
           ⚠️ `retry:false` 防死循环（登录接口自己不带 auth，也不会走到这里）。 */
        if (body.code === 1001 && o.retry !== false && o.auth !== false) {
          reloginOnce().then(function () {
            request(method, path, data, Object.assign({}, o, { retry: false }))
              .then(resolve, reject);
          }, function () {
            reject(apiError('auth', 1001, body.message || '登录已过期'));
          });
          return;
        }
        reject(apiError(o.retry === false && body.code === 1001 ? 'auth' : 'biz', body.code, body.message));
      },
      fail: function (err) {
        const msg = String((err && err.errMsg) || '');
        reject(apiError(/timeout/i.test(msg) ? 'timeout' : 'network', 0,
          /timeout/i.test(msg) ? '请求超时' : '网络不太好', msg));
      }
    });
  });
}

/** 并发 1001 时合并成一次登录 */
function reloginOnce() {
  if (_relogining) return _relogining;
  _relogining = login().then(function (r) {
    _relogining = null;
    return r;
  }, function (e) {
    _relogining = null;
    throw e;
  });
  return _relogining;
}

/**
 * `wx.uploadFile`（图片 / 音频都走它）。
 * ⚠️ 它**不是** `wx.request`：`wx.request` 面向 JSON，而图片与音频是二进制。
 * ⚠️ 且微信后台的 `uploadFile` 合法域名与 `request` 是**分开的两类**，新域名各配一次。
 */
function upload(path, filePath, formData, opt) {
  const o = opt || {};
  if (_mock) return Promise.resolve(null);

  return new Promise(function (resolve, reject) {
    const header = {};
    const tk = token();
    if (o.auth !== false && tk) header.Authorization = 'Bearer ' + tk;

    wx.uploadFile({
      url: BASE + path,
      filePath: filePath,
      name: o.name || 'file',          // ★ 必须与后端 FileInterceptor 的第一个参数一致
      formData: formData || {},
      header: header,
      timeout: o.timeout || 30000,
      success: function (res) {
        let body = null;
        try { body = JSON.parse(res.data); } catch (e) { body = null; }
        if (!body) { reject(apiError('network', res && res.statusCode, '服务返回异常')); return; }

        if (body.code === 0) { resolve(body.data); return; }
        if (body.code === 1001 && o.retry !== false) {
          reloginOnce().then(function () {
            upload(path, filePath, formData, Object.assign({}, o, { retry: false })).then(resolve, reject);
          }, function () { reject(apiError('auth', 1001, body.message || '登录已过期')); });
          return;
        }
        reject(apiError('biz', body.code, body.message));
      },
      fail: function (err) {
        const msg = String((err && err.errMsg) || '');
        reject(apiError(/timeout/i.test(msg) ? 'timeout' : 'network', 0,
          /timeout/i.test(msg) ? '上传超时' : '网络不太好', msg));
      }
    });
  });
}

/* ==================== 鉴权 ==================== */

/**
 * 登录：`wx.login` 拿 code → 后端换 openid → 查白名单 → 签发 JWT。
 *
 * ⚠️ 三种失败要分开对待（后端 §6.3）：
 *   · `1002` **不在白名单** —— 这是**正常业务结果**，不是故障。前端要提示"暂未开放"
 *     而不是"网络错误"；同时后端会把 openid 记进待批列表，方便手动加白名单。
 *   · `1001` 不该出现在登录接口上（它本身就是发 token 的）。
 *   · 网络类失败 → 按"稍后再试"处理，可走 mock 兜底。
 *
 * @param {string} [devCode] 仅本机联调用：直接当 code 传（后端 DEV_OPENID 通道）
 */
function login(devCode) {
  if (_mock) return Promise.resolve(null);

  return new Promise(function (resolve, reject) {
    const doPost = function (code) {
      request('POST', '/auth/login', { code: code }, { auth: false, retry: false })
        .then(function (data) {
          if (data && data.token) setToken(data.token);
          resolve(data);
        }, reject);
    };

    if (devCode) { doPost(devCode); return; }

    wx.login({
      success: function (r) {
        if (!r || !r.code) { reject(apiError('network', 0, '登录凭证获取失败')); return; }
        doPost(r.code);
      },
      fail: function () { reject(apiError('network', 0, '登录凭证获取失败')); }
    });
  });
}

/** 已登录就返回现有 token，没有就登一次 */
function ensureLogin() {
  if (_mock) return Promise.resolve(null);
  if (token()) return Promise.resolve(token());
  return login().then(function () { return token(); });
}

/* ==================== 快照 ==================== */

/** ★★ `GET /sync` —— 全量快照。启动时一次拿全，之后全靠单实体增量写（§6.2） */
function sync() { return request('GET', '/sync'); }

/* ==================== 个人资料 ==================== */
function getMe() { return request('GET', '/me'); }
function updateMe(patch) { return request('PATCH', '/me', patch); }

/* ==================== 项目 ==================== */
function createProject(p) { return request('POST', '/projects', p); }
function updateProject(id, patch) { return request('PATCH', '/projects/' + id, patch); }
function archiveProject(id) { return request('POST', '/projects/' + id + '/archive', {}); }
function unarchiveProject(id) { return request('POST', '/projects/' + id + '/unarchive', {}); }
function projectDetail(id) { return request('GET', '/projects/' + id + '/detail'); }

/* ==================== 待办 ==================== */
/** ★ 全项目**唯一**返回图片完整 `url` 的接口（别的接口只给相对 `uri`） */
function getTodo(id) { return request('GET', '/todos/' + id); }
function createTodo(t) { return request('POST', '/todos', t); }
function updateTodo(id, patch) { return request('PATCH', '/todos/' + id, patch); }
function completeTodo(id) { return request('POST', '/todos/' + id + '/complete', {}); }
function reopenTodo(id) { return request('POST', '/todos/' + id + '/reopen', {}); }
function deleteTodo(id) { return request('DELETE', '/todos/' + id); }
/**
 * ★★ 160 轮：**还原**一条已删除的待办（逻辑删除的对侧动作）。
 *
 * ⚠️ `deleteTodo` 自本轮起是**软删**（后端只盖 `deletedAt`），所以这一条不是"撤销请求"，
 *   而是**另一个正常接口** —— 与 `complete` / `reopen` 同族（都是"改这条的状态"）。
 * ⚠️ 用 `POST` 而不是 `PATCH`：它表达的是"把这条恢复出来"这个**动作**。
 *   还原后状态**一律回到「未完成」**（用户口径，见后端 `TodosService.restore`）。
 */
function restoreTodo(id) { return request('POST', '/todos/' + id + '/restore', {}); }
/**
 * ★★ 199 轮：**「我看过这条了」** —— 清掉「刚转过来」提示（后端 `flashAt` → null）。
 *
 * ⚠️ 用 `POST` 而不是 `PATCH`：它是**一个动作**（过目），不是"改一个字段"
 *   —— 与 `complete` / `reopen` / `restore` 同族，前端因此也不必知道字段叫什么。
 * ⚠️ 后端**不刷 `updatedAt`** ⇒ 不能顺手并进 `updateTodo`（那条正是用来刷时间的）。
 * ⚠️ 幂等：本来没提示时后端回 `{cleared:false}` 而不是报错。
 */
function todoSeen(id) { return request('POST', '/todos/' + id + '/seen', {}); }

/* ==================== 脑图 ==================== */
/** ★ 树**按需拉取** —— 只有它给 `treeJson`（sync 刻意不给，见 §6.2） */
function getTree(id) { return request('GET', '/mindmaps/' + id + '/tree'); }
function createMindmap(m) { return request('POST', '/mindmaps', m); }
function updateMindmap(id, patch) { return request('PATCH', '/mindmaps/' + id, patch); }
function saveTree(id, treeJson) { return request('PUT', '/mindmaps/' + id + '/tree', { treeJson: treeJson }); }
function deleteMindmap(id) { return request('DELETE', '/mindmaps/' + id); }
/**
 * ★★ 199 轮：**「我看过这几枚节点了」** —— 清掉节点上的「刚转过来」标记。
 *
 * ★ 触发时机：用户在画布上**选中**了那枚节点。
 * ⚠️ 与 `saveTree` **有意分成两条路**：本路**不刷 `updatedAt`**。
 *   看一眼节点不等于改过这张图 —— 并进 `saveTree` 的话，"随手点一个节点"
 *   会让这张图在脑图列表里被顶到最前。
 * ★ 回执里带**清完之后的整棵树**（`treeJson`）⇒ 调用方以它为准对齐本地。
 */
function mindmapSeen(id, nodeIds) {
  return request('POST', '/mindmaps/' + id + '/seen', { nodeIds: nodeIds });
}

/* ==================== 闪念胶囊 ==================== */
function createCapsule(c) { return request('POST', '/capsules', c); }
function updateCapsule(id, patch) { return request('PATCH', '/capsules/' + id, patch); }
function deleteCapsule(id) { return request('DELETE', '/capsules/' + id); }
/** 批删 —— 多选模式用，比 N 次请求省得多（★★ 160 轮起后端是**软删**，可还原） */
function deleteCapsules(ids) { return request('DELETE', '/capsules', { ids: ids }); }
/**
 * ★★ 160 轮：**批量还原**已删除的胶囊（「已删除胶囊」列表的「还原」键）。
 *
 * ★ 与 `deleteCapsules` **严格对称**（同形状的 body、同样按数组收）——
 *   "删除"与"还原"是同一张名单上的两个方向，写成一个模子才不会被下一个人改歪。
 * ⚠️ 只有**手动删除**的那批能被还原：被 `promoteToTodo` / `promoteToMindmap`
 *   消费掉的胶囊后端标的是 `consumedAt`，压根不在可还原名单里（用户口径）。
 * ⚠️ 后端对"还原一条正常的胶囊"是**无操作**（不报错）⇒ 这里不必先自查。
 */
function restoreCapsules(ids) { return request('POST', '/capsules/restore', { ids: ids }); }
/** 转待办 —— ★ 后端是 `$transaction` 原子：建待办与删胶囊同生共死（§6.7） */
function promoteToTodo(capsuleId, payload) {
  return request('POST', '/capsules/' + capsuleId + '/promote-to-todo', payload);
}
/**
 * 转脑图 —— ★ 原子，且**必须看 `addedCount`**：
 * 需求明确「只有真的写进去了才换记忆」，判据是写入条数 `n > 0`。
 * 一枚都没落成时前端**不许**换 `ui.mindmapId`（§6.7）。
 */
function promoteToMindmap(mindmapId, capsuleIds) {
  return request('POST', '/capsules/promote-to-mindmap', { mindmapId: mindmapId, capsuleIds: capsuleIds });
}

/**
 * ★★ 280 轮：**语义转脑图** —— 把这批胶囊交给模型重组成一张**新**脑图。
 *
 * 与上面 `promoteToMindmap` 的三处不同，看完再改：
 *   ① **不指定目标脑图**：服务端自己建一张（先占位，后台生成完再填内容）；
 *   ② **是异步受理**：立刻返回一张「语义转脑中」的占位卡，模型在后台跑二十几秒；
 *   ③ **会失败**：失败时卡转「语义转脑图失败」、**胶囊自动回到列表**（服务端的责任）。
 *
 * @param {string[]} capsuleIds 选中的胶囊
 * @param {string} clientId 本地乐观 id（`uid('mm')`）—— 服务端认同一个 id ⇒ 连点两次
 *   不会建出两张卡。**必须给**，不然网络抖动重发一次就是两张空壳图（各计一次费）。
 * @returns {Promise<{mindmap:object, capsuleIds:string[], reused:boolean}>}
 *   `reused: true` 表示"这张卡早就在了"（幂等命中），前端**不要**再插一次、也不要再提示。
 */
function promoteToMindmapAi(capsuleIds, clientId) {
  if (_mock) return Promise.reject(apiError('biz', 0, '演示模式无法调用模型'));
  return request(
    'POST',
    '/capsules/to-mindmap-ai',
    { id: clientId || undefined, capsuleIds: capsuleIds },
    /* 它只做"建占位卡 ＋ 消费胶囊"，不等模型 ⇒ 正常一两百毫秒。
       给 20s 是给"库慢 / 冷启动"留余量，不是为了等生成。 */
    { timeout: 20000 }
  );
}

/**
 * ★★ 280 轮：语义转脑图**失败重试**（只认 `ai_state='failed'`）。
 * ★ 不需要重新选胶囊 —— 服务端存着受理时的输入快照（含那条胶囊挂的图）。
 */
function retryMindmapAi(id) {
  return request('POST', '/mindmaps/' + id + '/ai-retry', {});
}

/**
 * ★★ 280 轮：**语义转脑图的轮询口** —— 只回"还需要看一眼"的几张卡。
 *
 * ★ 为什么不用 `GET /sync`：sync 是**全量**快照（几百 KB）。为了看一张卡的状态
 *   每 3 秒拉一次全量，等于把"启动一次"的成本按轮询频率重复付。
 * @returns {Promise<{items:Array}>} 生成中 / 失败 / 刚完成还没打开过的那几条
 */
function mindmapAiPending() {
  return request('GET', '/mindmaps/ai-pending');
}

/* ==================== ★★ 248 轮：胶囊 ↔ 待办的关联 ====================
 * 用户口径（2026-10-23）第 2 / 3 / 4 / 5 条：待办详情里「+选择胶囊」多选关联、
 * 详情页以卡片展示、可取消关联；关联时胶囊从闪念胶囊列表移除（与转脑图 / 转待办一致）；
 * 解除关联后回到列表、创建时间重置为解除那一刻、**不计入概览统计**。
 *
 * ⚠️ 两条路都挂在 `/todos/:id/capsules` 上（不是 `/capsules/link-to-todo`）：
 *   它是"这条待办的内容多了一块"，与加图片（`PATCH /todos/:id`）同一族；
 *   而"把胶囊标成已消费"由服务端在**同一个事务**里做（与 promote-to-* 同一条纪律：
 *   分两次请求会留下"关联了但气泡还在列表里"的脏数据）。
 * ⚠️ 形状与胶囊那边的 `deleteCapsules` / `restoreCapsules` **严格对称**（一批 id）——
 *   "关联"与"解除关联"是同一张名单上的两个方向，写成一个模子才不会被下一个人改歪。
 */
function linkCapsules(todoId, capsuleIds) {
  return request('POST', '/todos/' + todoId + '/capsules', { capsuleIds: capsuleIds });
}
/**
 * 解除关联 —— ⚠️ 后端会**把 `createdAt` 覆盖成此刻**（用户口径「创建时间为解除关联的时间，
 * 最开始的创建时间无需保存」），所以本地那一刻的排序位置也会变：它排到列表**末尾**。
 * 顺带记一笔：这条路**不记活跃度台账**（"回到列表"不是"新接住一枚"）。
 */
function unlinkCapsules(todoId, capsuleIds) {
  return request('DELETE', '/todos/' + todoId + '/capsules', { capsuleIds: capsuleIds });
}

/* ==================== agent / 厂家 key ==================== */
function createAgent(a) { return request('POST', '/agents', a); }
function updateAgent(id, patch) { return request('PATCH', '/agents/' + id, patch); }
function deleteAgent(id) { return request('DELETE', '/agents/' + id); }

function createTokenKey(k) { return request('POST', '/token-keys', k); }
function updateTokenKey(id, patch) { return request('PATCH', '/token-keys/' + id, patch); }
function deleteTokenKey(id) { return request('DELETE', '/token-keys/' + id); }

/**
 * ★★ 查该用户**全部** key 的余额 —— 进入「我的」页时调用。
 *
 * ★ 用 `POST` 而不是 `GET`：它会**改数据**（服务端回写余额），不是幂等读取。
 * ★ 超时给 **20 秒**（比默认 15 秒长）：多个账号是并发查厂家接口，每个最多 8 秒，
 *   再加上排队/网络抖动，15 秒会有"明明能查出来却报超时"的边角。
 * ⚠️ **前端不直连厂家**：key 会随包体公开，且厂家域名不在微信白名单里。
 *    这条链路永远是「小程序 → 自己后端 → 厂家」。
 * @returns {Promise<Array>} 该用户最新的一整份 key 列表（含刚查到的余额）
 */
function refreshTokenKeys() {
  return request('POST', '/token-keys/refresh', {}, { timeout: 20000 });
}

/* ==================== 文件 ==================== */

/**
 * 上传图片。
 * ★ 全工程的图片链路（§9.5）：
 *   `wx.chooseMedia` → `wx.compressImage({quality:70, compressedWidth:1600})`
 *   → 本地预览（先给用户看，不等上传）→ 这里 → 拿到**相对 uri** 随待办一起提交。
 *
 * ⚠️ 压缩失败要**直接上传原图**，由后端限额兜底（≤1 MB，超出提示重选）——
 *    不要因为压缩失败就阻断用户录入。
 * ⚠️ 多图可并发，但 3 Mbps 带宽下**建议最多同时 2 个**，其余排队。
 */
function uploadImage(filePath) { return upload('/files', filePath, {}, { name: 'file' }); }

/* ==================== 语音识别（§6.8.1） ==================== */

/**
 * `POST /asr` —— 一句话识别。**一个接口服务三个前端入口**
 * （待办录入 / 脑图节点语音键 / 胶囊口播）。
 *
 * ★★ 四条必须守住的约定：
 *   ① `formData.format` **必须与录音参数严格一致**（mp3/16k/单声道）——
 *      填错不会报错，只会返回乱码或空串，症状很像"识别不准"。
 *      本项目两个录音点都用 `format: 'mp3'`。
 *   ② 音频上限 3 MB ⇒ nginx 的 `client_max_body_size` 必须 ≥ 4m。
 *      **漏改的症状是 413，而小程序侧只看到"识别失败"，看不出原因。**
 *   ③ **60 秒边界**：腾讯云一句话识别的接口上限也是 60s，与前端 `REC_MAX = 60` 顶格相撞
 *      ⇒ 建议前端收在 **59 秒**（见组件里 `REC_MAX` / `VOICE_SEC` 的注释）。
 *   ④ 服务端**不保存录音**（`memoryStorage` ＋ `SourceType=1`）⇒ 这里传完就不用管了，
 *      `tempFilePath` 由微信自己回收。
 *
 * @param {string} filePath 录音临时文件（`RecorderManager.onStop` 给的 `tempFilePath`）
 * @param {string} [format] 默认 'mp3'，须与录音 format 一致
 * @returns {Promise<{text:string, duration:number, requestId:string}>}
 */
function asr(filePath, format) {
  if (_mock) return Promise.resolve(null);
  if (!filePath) return Promise.reject(apiError('biz', 0, '没有录到声音'));
  return upload('/asr', filePath, { format: format || 'mp3' }, { name: 'file', timeout: 30000 });
}

/* ==================== 提示词增强（★ 278 轮） ==================== */

/**
 * 前端长度闸门（字符数）—— ★ 必须 **≤** 后端 `EnhanceDto` 的 `@MaxLength`（16000）。
 *
 * 为什么两条闸门都要有、且方向必须是"前端更严"：
 *   · 只有后端 ⇒ 用户等一次网络往返才被告知"太长了"，而且那时可能已经付了一次
 *     body 解析的成本（后端 json limit 64kb，超了是 413，连中文文案都没有）；
 *   · 前端更严 ⇒ 正常路径永远碰不到后端那道墙，后端那道只作为"绕过前端"的兜底。
 * ⚠️ 12000 是拍的：导出物 = 原文（≤2000）＋ 脑图 md ＋ 胶囊段，实测绝大多数在 3000 以内；
 *    真要超 12000，那已经不是"提示词"而是一份文档，模型改写的收益也到顶了。
 * ⚠️ 判据 E14 会读这两个数并比对方向 —— 改小的那个可以，改大到超过后端必须同时改后端。
 */
const ENHANCE_MAX_CHARS = 12000;

/**
 * `POST /ai/enhance` —— 把导出文本改写成更强的 agent 指令。
 *
 * ★★ **只在用户点「增强」那一刻调用一次**。这是需求里最硬的一条（"仅在用户点击时
 *    由后台调用大模型"），也是**判据 E4 守的东西**：全工程只有 `mod-todo.js` 的
 *    `onFormEnhance` 一处调它，且**不在 `observers` / `attached` / `onLoad` 里** ——
 *    否则"打开抽屉就自动烧一次 token"这种事会悄悄发生，界面上完全看不出来。
 *
 * ★ **非流式**：一次返回整段。所以 `timeout` 必须放大到 55s（默认 15s 一定会误判超时）——
 *   但**后端是 50s**，让后端先超时，用户拿到的永远是一条有成因的中文文案，
 *   而不是被微信掐断的 `request:fail timeout`。
 *
 * ★ 服务端负责：抽换图片链接 → 调方舟 → 回填 → 清洗。前端**原样**发预览里那一份文本，
 *   **不做任何预处理** —— 这样"看到的＝复制到的"那条承诺（FR-3.11）不被污染，
 *   抽换与回填也永远只有一处实现（互逆性可被 `restore(extract(x))===x` 长期守住）。
 *
 * @param {string} text 要增强的文本（＝ 导出预览那一份）
 * @returns {Promise<{text:string, model:string, notice:string}>}
 *   `notice` 是回填器的一句话报告，**多数时候是空串**（所有图都原位回填成功）；
 *   非空时前端渲染在结果顶部，不打断、不拦复制。
 */
function enhancePrompt(text) {
  if (_mock) return Promise.reject(apiError('biz', 0, '演示模式无法调用模型'));
  const s = String(text || '');
  /* ★ 超长直接拒（不发请求）—— 理由见 `ENHANCE_MAX_CHARS` 的注释 */
  if (s.length > ENHANCE_MAX_CHARS) {
    return Promise.reject(apiError('biz', 0, '内容过长，暂不支持增强'));
  }
  return request('POST', '/ai/enhance', { text: s }, { timeout: 55000 });
}

/* ==================== 管理接口 ==================== */
/*
 * `/admin/*`（待批列表、白名单增删）**刻意不在这里封装**。
 * 理由：它需要 `X-Admin-Token`，而这个 token 属于运维凭证 ——
 * 放进小程序包体就等于公开（包体可解包）。查待批列表请用 curl：
 *   curl -H "X-Admin-Token: $ADMIN_TOKEN" https://api.example.com/api/v1/admin/pending
 */

module.exports = {
  /* 开关与基址 */
  useMock: useMock,
  setMock: setMock,
  /* ★ 失败回落开关（默认 false ＝ 拉不到就清空，不拿演示数据顶） */
  useFallbackMock: useFallbackMock,
  setFallbackMock: setFallbackMock,
  BASE: BASE,
  /* ★ 诊断用：连不上后端时，日志/提示里要能说清"到底连的是哪个地址" */
  HOST_DEVICE: HOST_DEVICE,
  HOST_DEVTOOLS: HOST_DEVTOOLS,
  platformName: platformName,
  isDevtools: isDevtools,
  fileUrl: fileUrl,

  /* token */
  token: token,
  setToken: setToken,
  clearToken: clearToken,

  /* 鉴权 */
  login: login,
  ensureLogin: ensureLogin,
  sync: sync,

  /* 个人资料 */
  getMe: getMe,
  updateMe: updateMe,

  /* 项目 */
  createProject: createProject,
  updateProject: updateProject,
  archiveProject: archiveProject,
  unarchiveProject: unarchiveProject,
  projectDetail: projectDetail,

  /* 待办 */
  getTodo: getTodo,
  createTodo: createTodo,
  updateTodo: updateTodo,
  completeTodo: completeTodo,
  reopenTodo: reopenTodo,
  deleteTodo: deleteTodo,
  /* ★★ 160 轮：逻辑删除的对侧动作 —— 「已删除」待办详情的「还原」 */
  restoreTodo: restoreTodo,
  /* ★★ 199 轮：「我看过这条了」—— 清掉「刚转过来」提示（不刷 updatedAt） */
  todoSeen: todoSeen,

  /* 脑图 */
  getTree: getTree,
  createMindmap: createMindmap,
  updateMindmap: updateMindmap,
  saveTree: saveTree,
  deleteMindmap: deleteMindmap,
  /* ★★ 199 轮：「我看过这几枚节点了」—— 清掉节点上的「刚转过来」标记（不刷 updatedAt） */
  mindmapSeen: mindmapSeen,

  /* 胶囊 */
  createCapsule: createCapsule,
  updateCapsule: updateCapsule,
  deleteCapsule: deleteCapsule,
  deleteCapsules: deleteCapsules,
  /* ★★ 160 轮：与 `deleteCapsules` 严格对称的另一半 */
  restoreCapsules: restoreCapsules,
  promoteToTodo: promoteToTodo,
  promoteToMindmap: promoteToMindmap,
  /* ★★ 280 轮：语义转脑图（受理 ＋ 重试）—— 花钱接口，只在用户点「确定」/「重试」时调 */
  promoteToMindmapAi: promoteToMindmapAi,
  retryMindmapAi: retryMindmapAi,
  mindmapAiPending: mindmapAiPending,
  /* ★★ 248 轮：**关联 / 解除关联**（挂在待办侧，一批 id）—— 与上面两条 promote 的差别是
     "内容不搬家、只挂一处"：胶囊本身还在（`todoId` 记着挂在哪），解除之后就回列表。 */
  linkCapsules: linkCapsules,
  unlinkCapsules: unlinkCapsules,

  /* agent / 厂家 key */
  createAgent: createAgent,
  updateAgent: updateAgent,
  deleteAgent: deleteAgent,
  createTokenKey: createTokenKey,
  updateTokenKey: updateTokenKey,
  deleteTokenKey: deleteTokenKey,
  /* ★★ 2026-10-12：查全部 key 的余额（进「我的」页触发）—— 后端代查厂家接口 */
  refreshTokenKeys: refreshTokenKeys,

  /* 文件与语音 */
  uploadImage: uploadImage,
  asr: asr,
  /* ★★ 278 轮：提示词增强（花钱接口 —— 全工程只有点击「增强」那一处调它，判据 E4） */
  enhancePrompt: enhancePrompt,

  /* 错误判定 —— 给调用方分类提示用（§9.3 失败提示分级） */
  isAuthError: function (e) { return !!e && (e.kind === 'auth' || e.code === 1001); },
  isRejected: function (e) { return !!e && e.code === 1002; },
  isNetworkError: function (e) { return !!e && (e.kind === 'timeout' || e.kind === 'network'); },
  /* ★ 失败原因翻译成一句可执行的话（真机 / 平板联调）—— 见上面的 netHint 注释 */
  netHint: netHint,
  /* ★ 语音识别失败的翻译（四种成因分开说）—— 见上面的 asrHint 注释 */
  asrHint: asrHint
};
