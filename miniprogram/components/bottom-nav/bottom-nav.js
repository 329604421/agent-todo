/**
 * bottomNav · 竖屏底部导航（设计稿 727403959376047 组件 3:11）
 * 与横屏 nav-rail（3:186）同一套语义：选中 ＝ 品牌黄满染 #FFD02F。
 *
 * 09-21：选中态改成**一块会移动的黄色滑块**。滑块是同一个节点，只改 translateX，
 * 由 CSS transition 补间 —— 点一下能看见它从上一项滑到这一项。
 * 首帧不参与动画（anim=false），避免从 0 滑到初始位置那一下「假动」。
 */
const KEYS = ['overview', 'project', 'todo', 'mindmap', 'mine'];
const STEP = 160;                 // 800 / 5 —— 五项等分铺满整宽

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
    }
  },

  data: {
    items: [
      { key: 'overview', label: '概览', icon: 'overview' },
      { key: 'project', label: '项目', icon: 'project' },
      { key: 'todo', label: '待办', icon: 'todo' },
      { key: 'mindmap', label: '脑图', icon: 'mindmap' },
      { key: 'mine', label: '我的', icon: 'mine' }
    ],
    slabX: 0,
    anim: false
  },

  lifetimes: {
    attached: function () { this.moveTo(this.data.active); },
    ready: function () { this.setData({ anim: true }); }
  },

  methods: {
    moveTo: function (key) { this.setData({ slabX: indexOf(key) * STEP }); },

    onNav: function (e) {
      this.triggerEvent('navigate', { key: e.currentTarget.dataset.key });
    }
  }
});
