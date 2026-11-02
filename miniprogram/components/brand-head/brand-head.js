/**
 * 让位段（204 轮 · 标题栏「滚出视口」）
 *
 * ── 它是什么 ───────────────────────────────────────────────────────────────
 * 一段**占位**，坐在各模块滚动容器的**第一个**位置，高度＝「状态栏 ＋ 品牌行」。
 * 内容首块从它下面开始 ——
 * ⇒ 首屏的让位高度就是「状态栏 ＋ 品牌行」（与 204 之前同一个量，只是归属换了）；
 * ⇒ 而它现在是**滚动内容的一部分**，手指上滑时跟着内容一起走掉，
 *    原先被它占住的那一段就还给了内容（这正是 204 轮要的"增大显示面积"）。
 * ★★ 206 轮：**横屏不挂这个组件了**（五个模块都写了 `wx:if="{{!landscape}}"`）——
 *    横屏让位整段撤掉，见下面「横屏」一节。
 *
 * ── 为什么是这个结构，而不是像 204 之前那样挂在壳页 ────────────────────────
 * 旧结构：`.app.port > .titlebar(固定) + .modwrap > .workarea(滚动)`。
 * `.titlebar` 是滚动容器的**兄弟** ⇒ 结构上就不可能跟着滚。
 * 本轮把「让位」搬进容器内部 —— **一份实现、五处实例**
 * （同 `bottom-nav` 那个模式），而不是在五个模块里各抄一份 logo 代码。
 *
 * ── 高度为什么是「盒高 ＝ headH」＋「负 margin」两件事（★★ 206 轮拆开）──────
 * 让位段是容器的**流内首项**，于是它和首块之间会**自动多出一个 `gap`**：
 *
 *     首块顶 ＝ 0(padding-top 归零) ＋ 盒高 ＋ margin-bottom ＋ gap
 *
 * 206 之前把 `− area-gap` 写在 **盒高**里（`盒高 = headH + headExtra − areaGap`），
 * 于是"缩间隙"和"压低盒高"成了同一个动作 —— overview／我的两页 `area-gap` 是 16，
 * 盒高只有 `headH − 4`、离组合标的可见笔画底只剩 **0.2px**，间隙一格都减不动。
 * 现在拆成：
 *     盒高          ＝ headH                       （只负责"装得下组合标"，余量恒 4.2px）
 *     margin-bottom ＝ headExtra − areaGap         （只负责"首块顶上移多少"，可为负）
 *     ⇒ 首块顶 ＝ headH ＋ headExtra
 *
 * 代入验算（IDE 值：状态栏 20 / 品牌行 40 / headH 60 / 容器 gap 16）：
 *   · 竖屏（headExtra 4）：60 ＋ (4 − 16) ＋ 16 ＝ **64** ≡ 60 ＋ 4 ✔
 *   · 手机（areaGap 0）  ：60 ＋ 12 ＋ 0        ＝ **72** ≡ 60 ＋ 12 ✔（与 204 逐像素相同）
 * ⚠️ 这就是为什么五个容器的 `padding-top` 都被改成了 0。**别把 padding 加回来** ——
 *    加了就是双份让位，首屏会往下坠一整段。
 * ⚠️ 也别改成 `position:absolute` + 让容器 padding 承担让位 —— 那样得给
 *    `.workarea` 加 `position:relative`，而它内部有 `.viewer`（待办图片查看器）
 *    这类靠"最近定位祖先"整屏铺开的覆盖层，加 relative 会把它们全都改基准。
 *
 * ── 横屏：整段不挂（★★ 206 轮）───────────────────────────────────────────
 * 横屏导航由左侧导轨承担（`.rail` 底部本身就有品牌块），再在左上角放一枚组合标
 * 就是同一个品牌露两次。204/205 的做法是"挂上但只留让位、不画图"；
 * 206 轮用户裁决「横版PC端的让位直接去掉试试，因为页面的工作区顶部也都有子标题」⇒
 * 五个模块统一改成 `wx:if="{{!landscape}}"`，**宿主都不进 DOM**。
 * ⚠️ 只把高度算成 0 是不够的：零高宿主仍是 flex 首项，会白占一个 gap（12px），
 *    首块顶停在 y12 —— 那就等于没撤干净（判据的 `--keephead` 负对照复现这一幕）。
 *
 * ── 主题 ──────────────────────────────────────────────────────────────────
 * 组合标是「黄底图标 ＋ **墨色**字标」，深色页底（#18191B）上墨色笔画对比只剩 1.02:1
 * ⇒ 深色必须换 `d-brand-lockup.png`（186 轮由 `工具/gen_brand_dark.py` 从同一张母版生成，
 *   **α 通道逐像素相同** ⇒ 几何与留白一点没动）。
 * 为什么不用"一个节点 ＋ 变量 src"：判据 `check_brand_logo_round135.py` 的 `slot_pairs`
 * 要从 wxml 里读出"这个槽位挂了哪张图"，变量化会让那一条读空。
 *
 * ⚠️ 两条 `wx:if` / `wx:else` **必须紧邻**（中间不许夹注释），见判据 `r_I`。
 */
const themeMod = require('../../utils/theme');

Component({

  properties: {
    /* 横屏不画 logo（只留让位）—— 见文件头「横屏为什么不渲染 logo」 */
    landscape: { type: Boolean, value: false }
  },

  data: {
    /* ★★ 2026-10-24（复审 P3-03）：**初值就取同步主题，不再从 `false` 起步**。
       ── 改前：`dark: false` ＋ `attached` 里 `_sync()` 纠正 ⇒ 理论上会补一帧。
          实际上 `attached` 与首帧渲染的先后**没有保证**：冷启动时组件是懒挂载的
          （壳页切到该模块才建），那一下的先手差别正好落在"首帧已经画出来"之后，
          表现为 logo 先以浅色版出现、再跳成深色版（深色主题下最明显）。
       ── 现在：与壳页 `INIT_DARK` 同一条口径 —— 模块求值时同步读一次宿主主题，
          首帧就是对的（`theme.isDark()` 是同步读宿主，不是异步查询）。
       ⚠️ `attached` 里那次 `_sync()` 仍然保留：它负责**运行中**的主题切换。 */
    dark: themeMod.isDark()
  },

  lifetimes: {
    /* 主题只改外观：重新取一次 boolean，必要才 setData。不重建、不动别的 data。
       ⚠️ 与 `components/icon` 同一条口径：订阅回调**显式不接参数**，
          主题这条路永远走 `this.data`（`notify()` 会传 `'light' | 'dark'`，
          直接 bind 会把主题串当参数喂进来）。 */
    attached: function () {
      this._onTheme = function () { this._sync(); }.bind(this);
      themeMod.subscribe(this._onTheme);
      this._sync();
    },
    detached: function () {
      if (this._onTheme) themeMod.unsubscribe(this._onTheme);
      this._onTheme = null;
    }
  },

  methods: {
    _sync: function () {
      const dark = themeMod.isDark();
      if (dark !== this.data.dark) this.setData({ dark: dark });
    }
  }
});
