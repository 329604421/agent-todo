/**
 * 选图 → 压缩 → 上传（技术文档 §9.5）—— **全工程只此一份**
 *
 * ★★ 230 轮：这两条链路原来是 `components/form-drawer/form-drawer.js` 里的**私有函数**
 *   （`pickOneImage` / `compressImage` / `uploadImage`）。用户口径「在待办详情页没法顺畅地
 *   添加图片」⇒ 详情页也要能加图，而"再抄一遍压缩档位与失败文案"正是本工程反复返工的那类事
 *   （171 轮为"两个画法"整条撤掉过一版）。⇒ 三条搬到这里，表单抽屉与详情页**共用**。
 *
 * 四条口径照抄技术文档 §9.5，别自行发挥：
 *   ① **压缩失败也照传原图**，由后端限额兜底（≤ 1 MB）。不要因为压缩失败就阻断录入 ——
 *      "这张图没传上去"比"这张图大了点"严重得多。
 *   ② **先本地预览、不等上传**：谁用谁负责（表单抽屉落在编辑副本里，详情页没有草稿态，
 *      走 `wx.showLoading` 顶住这一两秒 —— 见 `mod-todo.onAddImage`）。
 *   ③ **上传失败只提示、不撤销本地预览**。图还在，用户重选即可。
 *   ④ 入库的是**相对 uri**（`2026/10/xxxx.jpg`）；完整地址只在要看图的场合用
 *      `api.fileUrl()` 现拼 —— 否则 `sync` 会被"顺手全拼一遍然后预加载"（§6.2 红框）。
 *
 * ⚠️ `wx.chooseMedia` 会弹系统面板 ⇒ **自动化脚本点不到**（第 70 轮"录音授权弹窗带全屏
 *    暗遮罩、核验图全废"是同一类坑）⇒ mock / 出图那一档必须由调用方先分流，
 *    不要在这里判断 `api.useMock()`：两个调用方的 mock 兜底形态不一样。
 */
const api = require('./api');

/** 相册选一张（本地临时路径）。用户取消时**什么都不做**（不回调）；
 *  ★ 2026-10-27（全量检查 F29）：**权限被拒不再静默** —— 见下面 `fail` 里那段。
 *  ★★★ 302 轮：新增可选第二参 `opts`，只服务手机端「拍」那颗键 ——
 *      `opts.camera === true` ⇒ `sourceType: ['camera']` **直接拉起相机**，
 *      不弹"相册 / 拍照"那个二选一（用户口径：「点击『拍』后直接拉起用户摄像头」）。
 *      ⚠️ 默认仍是 `['album', 'camera']`：另外三个调用点（待办表单 / 待办详情 /
 *         胶囊面板挂图）要的正是"让用户自己挑"，改默认值等于替他们做了决定。 */
function pick(cb, opts) {
  const o = opts || {};
  wx.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType: o.camera ? ['camera'] : ['album', 'camera'],
    /* 后置摄像头：拍的是现场（票据 / 白板 / 屏幕），不是自拍 */
    camera: 'back',
    sizeType: ['compressed'],
    success: function (r) {
      const f = (r.tempFiles || [])[0];
      if (f && f.tempFilePath) cb(f.tempFilePath);
    },
    fail: function (e) {
      /* ★★ 2026-10-27（F29）· **取消 与 没权限 是两件事**。
         ── 改前一律静默。取消静默是对的（用户主动反悔，弹一句就是打扰）；
            而"相册/相机权限被拒"静默就成了死路：用户点了加图，界面毫无反应，
            他既不知道原因，也找不到补救的入口（微信里那次授权弹窗只出现一次）。
         ── 现在：只有 `errMsg` 明确是权限类才提示，并且**给一条去设置的路**。
         ⚠️ 判据是 `errMsg` 里的关键字（`auth` / `deny` / `permission`）：
            微信各端文案不完全统一，所以三个都认；认不出来就按"取消"处理 ——
            宁可少打扰，也不要因为文案变化把"取消"读成"失败"（230 轮那个坑的邻居）。
         ⚠️ 这条**不回调 `cb`、也不走 `onFail`**：调用方那套"必须先收 loading"的口径
            （见 `pickAndUpload` 的注释）一个字都不变。 */
      const msg = String((e && e.errMsg) || '');
      if (!/auth|deny|denied|permission/i.test(msg)) return;
      try {
        wx.showModal({
          title: '没法打开相册',
          content: '看起来没有相册或相机的使用权限。可以到设置里打开，再回来选图。',
          confirmText: '去设置',
          cancelText: '知道了',
          success: function (r) {
            if (r && r.confirm && typeof wx.openSetting === 'function') {
              try { wx.openSetting({}); } catch (err) { /* 老基础库没有就只留在提示 */ }
            }
          }
        });
      } catch (err) { /* 提示失败不该影响主流程 */ }
    }
  });
}

/**
 * 压缩（失败就给原图）。
 * ⚠️ `quality: 70` / `compressedWidth: 1600` 是需求 FR-3.1「上传前必须压缩」给的档位；
 *    基础库太老不认这个字段时会被忽略（不影响主流程）。
 */
function compress(filePath, cb) {
  if (typeof wx.compressImage !== 'function') { cb(filePath); return; }
  wx.compressImage({
    src: filePath,
    quality: 70,
    compressedWidth: 1600,
    success: function (r) { cb((r && r.tempFilePath) || filePath); },
    fail: function () { cb(filePath); }
  });
}

/**
 * 上传一张图 → `cb(相对 uri, 完整 url)`（`wx.uploadFile`，是**独立的一类合法域名**）。
 * `onFail` 可选：失败时**已经弹过 toast**，这里只给调用方一个"把 loading 收掉"的机会
 * （详情页要用；表单抽屉不传，行为与 230 轮之前逐字相同）。
 */
function upload(filePath, cb, onFail) {
  /* ⚠️ 顺序是「**先收 loading、再弹 toast**」，不许反。
     小程序里 loading 与 toast 共用同一个提示框实例 ⇒ 先 showToast 再 hideLoading，
     会把刚弹出来的失败原因一起关掉（用户眼里就是"什么都没说"）。 */
  const fail = function (msg) {
    if (typeof onFail === 'function') onFail();
    wx.showToast({ title: msg || '图片上传失败', icon: 'none' });
  };
  compress(filePath, function (p) {
    api.uploadImage(p).then(function (r) {
      const uri = (r && r.uri) || '';
      if (!uri) { fail('图片上传失败'); return; }
      cb(uri, (r && r.url) || api.fileUrl(uri));
    }, function (e) {
      fail((e && e.message) || '图片上传失败');
    });
  });
}

/**
 * 一步到位：选一张 → 上传 → `cb(uri, url)`。
 *
 * `onStart` 可选：**选完图、正要开始上传**那一刻调一次 —— 调用方用它挂进度提示。
 * `onFail`  可选：失败时**已经弹过 toast**，这里只给调用方一个"把 loading 收掉"的机会。
 *
 * ⚠️⚠️ **用户取消选图时两个回调都不走**（`chooseMedia` 的 fail 分支按设计什么都不做）
 *   ⇒ 任何"进度提示"都**只能挂在 `onStart` 上**，不许在调用本函数**之前**就 `showLoading`。
 *   230 轮真机踩过这个坑：详情页在选图之前先挂了「上传中」，用户一点取消，
 *   面板关掉、回调一个都不来 ⇒ **「上传中」永远不消失**（只有真选中了图才会被收掉）。
 */
function pickAndUpload(cb, onFail, onStart) {
  pick(function (p) {
    if (typeof onStart === 'function') onStart();
    upload(p, cb, onFail);
  });
}

/**
 * ★★ 275b · 读一张图的**像素比例**（宽/高）—— 节点挂图要"宽度固定、高度按图自适应"，
 *   而排版层是纯函数（拿不到也调不了 `wx.getImageInfo`）⇒ 比例必须**入库存下来**，
 *   排版时直接读 `node.imageRatio`（见 `mindmap-core.js` 的 `picBoxOf`）。
 *
 * `cb({ w, h, ar })`；读不到就 `cb(null)` —— **绝不因此中断上传**：
 *   比例只是排版的一个参数，缺了走 4:3 兜底（`aspectFit` 之下只是两边留细边，不会裁图）。
 * ⚠️ 取**原始临时文件**的比例就够：`compress()` 只按 `compressedWidth` 等比缩，比例不变。
 * ⚠️ 这是本地文件读取，不走网络；`getImageInfo` 对"非图片 / 已损坏"会直接走 fail。
 */
function sizeOf(filePath, cb) {
  const done = function (r) {
    if (typeof cb !== 'function') return;
    const w = Number(r && r.width) || 0;
    const h = Number(r && r.height) || 0;
    cb(w > 0 && h > 0 ? { w: w, h: h, ar: Math.round((w / h) * 1000) / 1000 } : null);
  };
  if (!filePath || typeof wx.getImageInfo !== 'function') { done(null); return; }
  try {
    wx.getImageInfo({ src: filePath, success: done, fail: function () { done(null); } });
  } catch (e) {
    done(null);
  }
}

module.exports = {
  pick: pick,
  compress: compress,
  upload: upload,
  pickAndUpload: pickAndUpload,
  sizeOf: sizeOf
};
