/**
 * navRail · 左侧图标导航（设计稿 3:186）
 * 宽 72 · 白底 ＋ 右侧 1px #E0E2E8 · 竖向 gap 8 · 上下 padding 20
 * 导航项 40 宽 × 48 高 · 圆角 12 · 图标 22 ＋ gap 4 ＋ 标签 10
 * 选中 ＝ 满染 #FFD02F，图标与标签同转 #1C1C1E；未选中图标 opacity 0.62
 * 底部品牌块 40×40 圆角 12（★ 第八十二轮曾是**纯装饰**；★ 本轮 FR-9 改回**可点** ——
 * 它是「闪念胶囊」的入口，与竖屏右下那颗悬浮块是同一件事的两个位置）
 *
 * 09-21：选中态改成**一块会移动的黄色滑块**（与竖屏底栏同款做法，方向改为纵向）。
 * 导轨项 40×48、项距 8 ⇒ 步长 56。首帧不参与动画（anim=false）。
 */
const KEYS = ['overview', 'project', 'todo', 'mindmap', 'mine'];
const STEP = 56;                   // 项高 48 ＋ 间距 8

function indexOf(key) {
  const i = KEYS.indexOf(key);
  return i < 0 ? 0 : i;
}

Component({
  properties: {
    active: {
      type: String,
      value: 'overview',
      observer: function (v) { this.moveTo(v); }
    },

    /**
     * 品牌块的状态（★ FR-9）—— 三态，值域就这三个：
     *   'logo' 抽屉关着（显示品牌图）
     *   'mic'  抽屉开着、还没录（显示**黑色麦克风** —— 形状与品牌块完全一致，只换图案）
     *   'rec'  录音中（块面上显示 60 秒倒计时 —— **纯秒数**：`60` → `1`，★ 第 89 轮口径，并开始闪烁）
     * ⚠️ 状态**由壳页下发**：唯一真相在 capsule 组件（见 capsule.js 的 `_emitState`）。
     *    导轨自己不猜 —— 它没有第二份能判断"抽屉开没开"的数据。
     */
    brandState: { type: String, value: 'logo' },
    /** 'rec' 时块面上那串**纯秒数**（`60` → `1`；★ 第 89 轮前是 'MM:SS' 的 `01:00`） */
    brandClock: { type: String, value: '' }
  },

  data: {
    items: [
      { key: 'overview', label: '概览', icon: 'overview' },
      { key: 'project', label: '项目', icon: 'project' },
      { key: 'todo', label: '待办', icon: 'todo' },
      { key: 'mindmap', label: '脑图', icon: 'mindmap' },
      { key: 'mine', label: '我的', icon: 'mine' }
    ],
    slabY: 0,
    anim: false
  },

  lifetimes: {
    attached: function () { this.moveTo(this.data.active); },
    ready: function () { this.setData({ anim: true }); }
  },

  methods: {
    moveTo: function (key) { this.setData({ slabY: indexOf(key) * STEP }); },

    onNav: function (e) {
      this.triggerEvent('navigate', { key: e.currentTarget.dataset.key });
    },

    /**
     * 品牌块 —— 闪念胶囊入口（★ FR-9）。
     * ⚠️ 这里**不做任何状态判断**：点一下就把"我被点了"抛给壳页，
     *    由壳页转给 capsule 的 `toggleRecord()`。理由与前一条同 ——
     *    组件不持有第二份真相，也就不会与胶囊自己那个状态机跑偏
     *    （三态各自的语义写在 capsule.js 的 `toggleRecord`，是一处）。
     */
    onBrand: function () {
      this.triggerEvent('brand');
    },

    /**
     * ★★★ 274 轮 · 品牌块**正上方那颗「写」**（用户口径第 2 条）。
     * 与 `onBrand` 同一条纪律：这里**不做任何事**，只把事件抛给壳页 ——
     * "打开创建面板"要动胶囊组件的状态，而导轨对它一无所知（壳页才是那个中介）。
     */
    onWrite: function () {
      this.triggerEvent('write');
    }
  }
});
