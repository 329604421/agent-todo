/**
 * 导航落点判定 —— FR-8（★ V8 新增）
 *
 * 规则（FR-8.1 一句话）：
 *   三个内容模块（项目 / 待办 / 脑图）的记忆各自独立。
 *   点导航 → 直接回你上次打开的那个详情；没有详情、或你已经在那个详情上 → 弹列表抽屉。
 *
 * ⚠️ 09-21 起没有「页面」了：五个模块都是常驻挂载的组件，切模块 ＝ 切壳页的 active。
 *    所以本模块只回答「该弹抽屉还是该切模块」，不再产出页面 url、不再碰 wx.reLaunch。
 *
 * 本模块只做「该走哪条路」的判定，不碰数据：
 *   planFrom(active, key) → { action:'drawer' | 'switch' | 'none', key }
 *   各页 onNav 直接调它；需要弹抽屉时回调对应组件的 openListDrawer(key)
 *
 * ⚠️ 概览 / 我的没有详情，点击直接切过去，不参与记忆机制（FR-8.4）。
 */

/** 五个模块（顺序 ＝ 底栏 / 导轨里的顺序） */
const MODULES = ['overview', 'project', 'todo', 'mindmap', 'mine'];

/** 有「列表 / 详情」二态的模块 */
const DETAIL_MODULES = ['project', 'todo', 'mindmap'];

/** 单页模块（无详情） */
const PLAIN_MODULES = ['overview', 'mine'];

function isModule(key) { return MODULES.indexOf(key) >= 0; }

/**
 * 判定一次导航点击：
 *   { action: 'drawer', key }  → 已经在这个模块上 → 弹列表抽屉（换一个）
 *   { action: 'switch', key }  → 切到该模块（壳页换 active）
 *   { action: 'none' }         → 已经在这一页，且是单页模块，什么都不做
 */
function planFrom(active, key) {
  if (!isModule(key)) return { action: 'none' };
  if (key !== active) return { action: 'switch', key: key };
  if (DETAIL_MODULES.indexOf(key) >= 0) return { action: 'drawer', key: key };
  return { action: 'none' };
}

module.exports = {
  MODULES: MODULES,
  DETAIL_MODULES: DETAIL_MODULES,
  PLAIN_MODULES: PLAIN_MODULES,
  isModule: isModule,
  planFrom: planFrom
};
