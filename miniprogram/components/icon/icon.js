/**
 * 统一图标组件（24 枚同源几何，见 assets/icons/）
 * 尺寸档位照设计稿：22 主导航 / 20 顶栏图标按钮 / 16 内容区 / 14 密集区 / 12 卡内微标
 *
 * ── ★★ 186 轮（深色模式）：`prefix` 与 `tone` ──────────────────────────────
 * 本组件渲染的是 `<image src="…/x.svg">` —— SVG 里的颜色**硬编码在文件里**，
 * `<image>` 跨文档拿不到宿主的 CSS 变量、颜色也继承不了 ⇒ **染色这条路不通**。
 * 唯一的做法是「**同一几何、两份配色**」（同 94 轮 `w-*` 反白版的来路）：
 *   · 浅色版：`x.svg`（墨 `#1C1C1E`）
 *   · 深色版：`d-x.svg`（柔白 `#EEEDEA`）—— 由 `工具/gen_icon_dark.py` 生成
 * ⇒ 组件在运行期按当前主题决定挂哪一个前缀（`prefix` 进 `src` 表达式）。
 *
 * ⚠️ **不是所有图标都该跟着主题变亮** —— 这正是 `tone` 存在的理由：
 *   · `tone=''`（默认，**绝大多数**）：图标落在**随主题变暗**的面上（页底 / 卡 / 芯片 /
 *     选中行的暖底…）。浅色下这些面是亮的 ⇒ 墨色图标清楚；深色下这些面变暗 ⇒
 *     **必须换柔白版**，否则图标等于消失。
 *   · `tone='ink'`：图标落在**两个主题下都亮**的面上 —— 品牌黄 `--yellow`（恒值 `#FFD02F`）、
 *     或成功绿 `--success`（它的字色两个主题都取墨）。这类面上的图标
 *     **恒为墨色**，跟着主题变亮就是"黄底白图标"（对比度掉到 ≈1.6:1，读不出来）。
 *     当前只有四处：导轨滑块上的选中项图标、底栏滑块上的选中项图标、胶囊「还原 / 转到脑图」
 *     两颗黄键、导出键「已复制」那颗勾（黄 / 绿面）。
 *
 * ⚠️ `w-*` 名字**永不加前缀**：它本来就是反白版，且落在 `--solid`（深色下仍是深底）上
 *   ⇒ 两个主题下都对。给它再套一层 `d-` 只会去要一个不存在的文件（图上空白）。
 */
const themeMod = require('../../utils/theme');

Component({

  properties: {
    name: { type: String, value: '' },
    size: { type: Number, value: 16 },
    opacity: { type: Number, value: 1 },
    /* '' ＝ 跟着主题走（默认）｜ 'ink' ＝ 恒墨（画在品牌黄 / 成功绿这类"恒亮面"上） */
    tone: { type: String, value: '' }
  },

  data: {
    /* `/assets/icons/{{prefix}}{{name}}.svg` —— `''` 或 `'d-'`（见文件头） */
    prefix: ''
  },

  lifetimes: {
    /* 深色切换时**只改外观**：重新算前缀、必要才 `setData`，不重建、不动别的 data */
    attached: function () {
      /* ★ 审查-02 C-3（2026-10-15）：**订阅回调必须吞掉参数**。
         `utils/theme.js` 的 `notify()` 是 `fn(_theme)`（会传 `'light' | 'dark'`），
         而 `_sync` 的形参是 `(name, tone)` —— 原来直接 `this._sync.bind(this)` 当回调，
         一旦 `_sync` 改成"用回调传来的新值"，`'dark'` 就会被当成 `name`
         （图标名被顶掉 ⇒ **静默变成别的图标或空白**）。
         这里包一层显式不接参数 ⇒ 主题这条路永远走 `this.data`，与 observer 那条路分开。 */
      this._onTheme = function () { this._sync(); }.bind(this);
      themeMod.subscribe(this._onTheme);
      this._sync();
    },
    detached: function () {
      if (this._onTheme) themeMod.unsubscribe(this._onTheme);
    }
  },

  observers: {
    /* 名字或色调换了都要重算（列表里同一颗图标可能随选中态换 tone）。
       ★ 审查-02 C-3（2026-10-15）：**用回调传进来的新值**，不再读 `this.data` ——
       与 `form-drawer.js` 那条自立的纪律同一条理由：原生"回调时 `this.data` 是否已更新"
       平台没给硬保证，而回调参数按文档就是新值。少一层时序依赖。 */
    'name, tone': function (name, tone) { this._sync(name, tone); }
  },

  methods: {

    /** 当前该用的前缀。规则只有三条，顺序即优先级（见文件头） */
    _prefixFor: function (name, tone) {
      if (tone === 'ink') return '';                        // 恒亮面 ⇒ 恒墨
      if (name.indexOf('w-') === 0) return '';              // 反白版自己就是一份独立资产
      return themeMod.isDark() ? 'd-' : '';
    },

    /**
     * 重算前缀并按需 `setData`。
     * ★ 审查-02 C-3（2026-10-15）：`name` / `tone` **可选** ——
     *   · observer 那条路传**回调新值**（首选，见 `observers`）；
     *   · `attached` 与主题订阅那条路**不传参** ⇒ 回落到 `this.data`。
     * ⚠️ 判 `undefined` 而不是判假值：两个 property 的默认值都是 `''`，
     *    用假值判定会把"显式传空串"和"没传参"混成一件事。
     */
    _sync: function (name, tone) {
      const n = (name === undefined) ? (this.data.name || '') : (name || '');
      const t = (tone === undefined) ? (this.data.tone || '') : (tone || '');
      const p = this._prefixFor(n, t);
      if (p !== this.data.prefix) this.setData({ prefix: p });
    }
  }
});
