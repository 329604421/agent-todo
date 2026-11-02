/**
 * 表单抽屉（FR-3.6 创建 / FR-3.9 编辑 · D-4 定案）
 *
 * 位置：单独打开 ＝ L1 位（横 84,24 ／ 竖 16,24）；
 *       底下压着列表抽屉时右移 270 ＝ L2 位（横 354,24 ／ 竖 286,24）；
 *       ★ 45 轮：L2 位上面还压着一层（「待办表单 → 新建项目」）时再右移 270 ＝ L3 位（横 624,24）。
 *       一级被压着时会**侧转**（`turned`，rotateY 25° ＋ 不可点），二级不转。
 * 圆角 16 · 白底 ＋ 1px #E0E2E8 · 投影 −10 / 20 / 48 rgba(28,28,30,.28)（左向投影 ＝ 在上层）
 * 结构 ＝ 标题行 52（标题 15/500 ＋ 取消 12/500）＋ 表单区（可滚动 · gap 16）＋ 底部动作 56
 *
 * ★ 09-22 第四十二轮：无列表抽屉时自己带一层黑色半透遮罩（点它 ＝ 取消），
 *   与列表抽屉同款几何 —— 见同目录 wxss 的 .sd-mask。
 *
 * 七种 mode 共用一套壳：profile ／ todo ／ project ／ mindmap ／ agent ／ token ／ **export**。
 * 组件自己维护一份可编辑副本（v），选项数组复制到本地（o）以便就地改选中态；
 * 提交时把整份 v 抛给页面。
 *
 * ★ 09-22 第四十三轮：本组件曾同时承载**三级抽屉**（「关联脑图」的选项）——
 *   落位在上一级右侧，宽 260 · 投影更深 · z-index 94（高于 .sd 的 92）。
 *   ★★ 2026-10-23（247 轮）：**那一层已经删掉**（见下面 247 轮那段），
 *   `.sd3` 这套几何只剩「选择其他项目」一个实例在用（246 轮），样式没有变动。
 * ★ 09-22 第四十五轮：
 *   ① 新增 mode = **export**（详情页「适配 agent 文本」收进抽屉）：只读预览 ＋「不含图片」
 *      开关 ＋「复制到剪贴板」。预览与复制共用 `store.copyTodoText()`，看到的＝复制到的。
 *   ② `posClass` 由组件从 `offset` 现算（0/270/540 三档），模板不再写一串三元。
 *   ③ 三级在竖屏也开在表单右侧（见 wxss），选项改卡片式 ＋ 单选框。
 *
 * ★ 09-23 第八十二轮：**待办创建态不渲染「关联脑图」**（`editId` 为空即整块不出现）。
 *   ★★ 247 轮：编辑态也不渲染了 —— 整个字段与它那套三级态（`pickMap` / `mapRows` /
 *   `onOpenMap` / `onPickMindmap`）**一并删除**。详见下面那段。
 *
 * ★★ 2026-10-23 第二百四十七轮（用户口径）：**待办表单只管"标准信息"**。
 *   用户原话：「编辑弹窗中应该去掉图片和关联脑图的编辑，因为图片的调整和关联脑图本身
 *   就可以在详情页直接快速搞定，没必要在编辑弹窗中处理，编辑弹窗还是主要管待办的
 *   正文、所属项目这两个标准信息」。
 *   ⇒ 本文件删掉三族东西（**模板删块 ＋ 这里删实现**，两处必须成对，否则就是死代码）：
 *     ① 关联脑图：`data` 里的 `pickMap/mapRows/mapTitle/mapEmpty/mapName`、
 *        observer 里的复位、`nameIn/nameOf/mapRowsOf/mapCtx`、
 *        `onOpenMap/onCloseMap/onPickMindmap`；
 *        （⚠️ `onNewMindmap` 那个 **triggerEvent 留着**：它是五个模块都挂着的通用事件，
 *          删它要动五处 wxml，而"某个表单里再长出新建脑图"是个合理的将来 —— 留着无害，
 *          只是本轮起**没有入口会触发它**。）
 *     ② 图片：`imageRows()`、`onAddImage/onDelImage/onZoomImage`、
 *        `put()` 里那道 `imageRows()` 收口、`onSubmit` 里那道"有图没传完"的闸门；
 *     ③ `applyProject()` 里"换项目顺带清脑图关联"那一段（表单已经没有脑图这个键了）。
 *   ⚠️ **`imgpick` 这个 require 留着** —— 头像上传（`onPickAvatar`）还在用它。
 *   ⚠️ 与 `forms.js` 的联动是这次改动的命门：`values` 里不再有 `images` / `mindmapId`，
 *      所以 `forms.submit()` 必须改成"**有才写**"—— 否则编辑保存会把已入库的图清空
 *      （`v.images || []` 拿到的是空数组）／把已关联的脑图解掉。见那边两条注释。
 *
 * ⚠️ 42 轮·补二恢复了 store 的引用 —— 重置日的步进器要用 store 的纯函数，
 *   45 轮起导出预览还要用 copyTodoText / todoById。
 *   ★ 133 轮：那两行「月份 / 日期」收成**一行「日」** ⇒ 只用到 stepResetDay（daysInMonth /
 *     clampReset 已随月份一起下线，改为 store 内部函数）。
 */
const store = require('../../utils/store');
const api = require('../../utils/api');
const stage = require('../../utils/stage');
/* ★★ 230 轮：图片上传链路（`wx.chooseMedia` → `wx.compressImage` → `wx.uploadFile POST /files`
   → 相对 uri，技术文档 §9.5）**整条搬到 `utils/imgpick.js`** —— 详情页那一轮也要就地加图，
   两条链路共用一份（四条口径与档位都写在那个文件头，别在这里抄第二份）。
   ★★ 247 轮：待办表单不再有图片区，这里**只剩头像**（`onPickAvatar`）还在用它。
   ⚠️ 别因为它"只有一个调用点"就摘掉 —— `upload()` 的档位与失败表现都在那个文件里。 */
const imgpick = require('../../utils/imgpick');

function deepClone(o) { return JSON.parse(JSON.stringify(o || {})); }

/* ★★ 247 轮：`imageRows()` 与它下面那两段说明**整条删除** —— 待办表单不再渲染图片，
   这个"给每行补 `src`"的派生函数也就没有调用点了。
   ⚠️ 它守的那条口径（相对 uri 不能直接喂 `<image src>`，要看图那一刻现拼 `api.fileUrl()`）
      **没有失效**，只是搬到了详情页：`mod-todo.js` 的 `packDetail()` 里那一句
      `src: (store.isLoaded() && im.uri) ? api.fileUrl(im.uri) : ''` 就是同一个口径，
      闸门同样是 `isLoaded()`（判据 `check_source_guard.py` 的 G3c / G3e 守着那边）。 */

/* ==================== 待办内容输入框：随文字长高（★ 2026-10-09 第一百三十轮起） ====================
 *
 * 用户口径：「待办内容的输入框没有根据文本的长短去做高度的自动调节，应该是以当前的输入框
 * 高度作为最小高度，如果文本长度过长，高度会随之增加，最高增加到 2 倍最小高度」。
 * 覆盖两条路：**待办创建** 与 **闪念胶囊转待办** ——
 * 后者走 `forms.open(this, 'todo', '', { preset: { text } })`，是 **`setData` 预填**。
 *
 * ── 几何全部从 wxss 现推（这几个数**只写这一份**）──
 *   `.sd`          width 320（横/竖同值）· border 1×2             ⇒ 内容 318
 *   `.sd-body`     padding 0 14                                   ⇒ 内容 290
 *   `.sd-area-box` width:100% ⇒ 290 · border 1×2 ＋ padding 10×2  ⇒ **可用文字宽 268**
 *   font-size 14 · line-height 21px                               ⇒ 行盒 21
 *   padding 9×2 ＋ border 1×2 = 20                                ⇒ **行盒之外的固定占用**
 * ⚠️ 上面这几个数与 wxss 是**同一口径**：`工具/check_area_autogrow.js` 会**现读 wxss**
 *    复算一遍"可用文字宽"，对不上就报红（铁律 9：一个口径两个来源 ⇒ 必须跨文件现取现比）。
 *
 * ── ★★ 六轮到底在修什么（130 → 140 → 141 → 142 → 143 → 144）──────────────────────
 * 现象（用户每一轮反馈都一样）：创建待办 ／ 编辑待办 ／ 闪念胶囊转待办，正文框**停在默认高度**，
 *   字一多就在**框里自己滚**。口径先确认过：这三条其实是**同一个 `form-drawer` 的 `todo` mode、
 *   同一个正文框**（`mod-todo.wxml` 的 `todo-form` 一处管"记一条 / 编辑"两种 title，
 *   `capsule.wxml` 的 `cp-form` 管"转待办"）⇒ **一处修、三处同时好**。
 *
 * 计算侧早就排除了（131 轮就做过）：`areaH` 本身**完全正常** —— 离线探针实跑
 *   77 汉字 ⇒ 125 ／ 100 ⇒ 146 ／ 120 ⇒ 167 ／ 200+ ⇒ 封顶 208；`onText` 行为链也确实把
 *   `data.areaH` 改对了。⇒ **病根从来不在"算得对不对"，而在"算出来的数怎么落到屏幕上"。**
 *
 * ── ★★ 147 轮：**定案 —— 高度交回"普通 view"那一层，原生 textarea 只负责填满** ──────────
 * 本轮拿到**第一份真机读数**（144 轮那个临时取证口取的；★ 150 轮定案后该取证口已撤除）：
 *
 *     ohos / OpenHarmonyOS 7.0.0 ｜ areaH 104 ｜ 外框 87 ｜ 输入区 71
 *
 * ★ 这三个数一次把六轮的猜测钉死：
 *   · `areaH 104` —— **JS 侧完全正常**（这段文字 4 行 ⇒ 正好落在最小高度上，见下）。
 *   · `外框 87`   —— 但**屏幕上没有任何东西是 104**：外框只有 87。
 *   · `输入区 71` —— 最关键：内层下发的是 inline `min-height:84px`，实测只有 **71**
 *                    ⇒ **鸿蒙上原生 `textarea` 根本不认我们的 CSS 高度。**
 *   ⇒ 结论：**144 / 145 把高度"交回原生"是个错方向。**`auto-height` 一开，原生就自己
 *     说了算：它既**不认**我们下发的 `min-height` / `max-height`，**自己算出来的高又比它
 *     实际渲染的内容矮一行**（71 装不下 4 行 × 21 ＝ 84）⇒ "框比字矮、字被裁"。
 *     而 145 又把外框的高度整个撤掉 ⇒ 连原来那 104 的保底都没了 ⇒ **框从 104 掉到 87**，
 *     这正是用户说的「**越改越差**」。
 * ★ 六轮的共同教训（写最前面）：
 *   **"JS 算出来的高度写在哪一层"，比"JS 算得对不对"重要得多。**
 *   本工程里唯一**在所有平台都吃 CSS** 的东西是**普通 `<view>`**；原生组件（`textarea`）
 *   在鸿蒙上由原生层自己画、自己算高 —— 只有**关掉 `auto-height`** 时 CSS 高度才可能生效。
 * ★ 本轮结构（**高度的权威回到普通 view**，原生只负责填满）：
 *   · `.sd-area-box`（view）inline `min-height:{{areaH}}px` ＋ wxss `display:flex; flex-direction:column`
 *     —— **只托住、不夹住**（永远不写 `height` / `overflow`）⇒ **边框一定跟着 `areaH` 长**，
 *        这是"框跟着字长"里唯一在所有平台都成立的一层。
 *   · `.sd-area-in`（textarea）inline `height:{{areaH - 11}}px` ＋ wxss `flex:1 1 auto`
 *     —— 两道**独立**的高度来源（绝对 px 第一道、弹性拉伸第二道），都从 `areaH` 推出来：
 *        哪个平台认哪道就用哪道。**`auto-height` 本轮撤掉** —— 它正是"原生说了算"的开关。
 *   · `AREA_SAFE = AREA_LH + 8 = 29`：★ **150 轮起它还是"一个行盒的余量"**（不然换行那一下
 *     会闪一条滚动条）—— 详见下面 150 轮那段与常量本身的注释。
 * ⚠️ **别再打开 `auto-height`**（打开 ＝ 原生接管高度 ＝ 我们下发的数一律作废）；
 * ⚠️ **别给 `.sd-area-box` 加 `height` / `overflow`**（那会把"托住"变成"夹住"）；
 * ⚠️ 下限 104 / 上限 208 与 wxss 是**同一口径**：动这几个数先跑 `工具/check_area_autogrow.js`。
 *
 * ── ★★ 150 轮（下半场）：**留足一个行盒** —— 换行那一瞬间不许出现"内容 > 控件" ────────────
 *   用户口径：「持续输入文字时，如果换行会突然显示一下滚动条，然后输入框高度增加以后这个
 *   滚动条就没了」—— 高度长对了，剩下的是那**一帧**的闪现。
 *   成因：`areaH` 是从**上一个**文本长度算的，而原生在我们 setData 之前就已经按新文本重排
 *   ⇒ 那一帧"内容比控件高 ~11px"（平板 `s ≈ 0.84`、一个行盒 17.6 屏幕 px、旧余量只有 6.7px）。
 *   ★ 先试的是"把那条滚动条 CSS 收掉"（与 `.sd-body` / `.sd3-body` 同一招）
 *     —— 真机复核「**依旧还是会闪现一下滚动条**」⇒ **那条滚动条是原生控件自己画的**，
 *     不吃这套 CSS（和"原生不认我们的 CSS 高度"同源）。**别再把 CSS 当这个问题解。**
 *   ⇒ 改走结构：`AREA_SAFE` 提到 **一个行盒 ＋ 8**，让"内容 > 控件"这一瞬**根本不发生**。
 *   ⚠️ 余量长在控件**底部**（文字从控件顶部排），所以**外框下内边距 9 → 0** 把它买回来
 *     （`AREA_CHROME` 20 → 11）⇒ 框净增高只有 ~12px，不是 ~21px。这两笔账必须成对动。
 *   ⚠️ 别拿 `overflow` / `max-height` / `auto-height` 去"顺手补一刀"——
 *     这条链上前七轮全是这么死的（见下面的作废清单）。
 *
 * ── 历史：六轮各自改了什么（**全部作废**，留作"别再走回头路"的清单）──────────────
 * ★★ 前五轮其实是**同一招**：把我们算出来的 px **推**给某一行 DOM。
 *   130 轮：inline `style.height` 贴 textarea                            ⇒ 不长。
 *   140 轮：加固成 height / min-height / max-height **三条同值**贴 textarea ⇒ 还是不长。
 *   141 轮：外框搬到一个普通 `<view>` 上（**载体换对了**），但内层 textarea 又开回
 *           `auto-height` 并压了一条 `min-height` ⇒ 两股力量互相锁死，**仍然滚**。
 *   142 轮：拿掉 `auto-height`，外框 `height` ＋ 内层 `height:100%`          ⇒ 仍只在鸿蒙败。
 *   143 轮：把内层单位换成**绝对 px**（理由是"百分比鸿蒙不解析"）            ⇒ 用户复核**仍不长**。
 *   ⚠️ 五轮全败，说明问题不在"写法"，而在**"推"这个动作本身**：
 *      **WebView（IDE / PC）上推得动，鸿蒙上推不动** —— 用户第五轮把平台差异说死了。
 *
 * ── 144 轮（**已作废**）：换驱动方向 —— "不再推，让原生自己长" ────────────────────
 * 两条第一手证据（144 轮现查）：
 *   ① 官方 `scroll-view` 属性表：「**鸿蒙 OS 暂不支持 enhanced 及其相关的属性和方法**」。
 *   ② 社区鸿蒙专文《微信小程序组件 `<textarea>` 在鸿蒙系统中自适应高度兼容性问题》：
 *      「**手动粘贴长文本内容高度会自动撑开**」⇒ **原生 `auto-height` 在鸿蒙上是工作的**，
 *      不可靠的只是"内容清空后回缩"。⇒ **该用它，而不是绕开它。**
 * 结构（高度只有一个出口：里面那个原生控件自己）：
 *   · `.sd-area-box`（view）—— **没有任何高度**，纯外壳（边框/圆角/底色/内边距）；
 *     它的高**由里面的 textarea 撑开**（纯布局，最可靠的一层）。
 *   · `.sd-area-in`（textarea）—— **`auto-height`** 自己算高；
 *     模板另下发 inline `min-height:{{areaH - 20}}px`（**地板**）。
 * · `min-height` 是**地板**、不是主驱动：预填那一路（编辑待办 / 闪念胶囊转待办）`auto-height`
 *   不参与（它只认键盘）⇒ 由我们自己算的 `areaH` 顶住，一打开就是高的；
 *   打字那一路**取两者较大者**。
 *
 * ── 145 轮（**已作废**）：摘掉 144 那条 `max-height` 天花板（"越改越差"的中间站）──────
 * 用户第六次复核：「**依旧不行，越改越差了，有滚动条且都不能滚动了**」。
 * ★★ **"越改越差"这四个字就是本轮最有价值的一条证据**：144 轮**改变了真机行为**
 *   （143 是"有滚动条但能滚"，144 变成"有滚动条且不能滚"）⇒ 说明 144 轮动的那条机制
 *   **在鸿蒙上确实是生效的** —— 也就是 `auto-height`（原生自己算高）；
 *   反过来也印证了 **130–143 那种"推 px 给 DOM"连真机行为都改变不了**，所以五轮全败。
 * ★ 那么 144 错在哪：**错在给它加了一条 `max-height:188px`**。
 *   `auto-height` 的原生语义是"控件高 = 内容高 ⇒ 我永远不需要滚动"；
 *   我们在外面压一条 `max-height`，原生层并不知道 ⇒ **控件被夹在 188，可它自己的滚动条
 *   没有被启用** ⇒ 正好是用户看到的「有滚动条 且 都滚动不了」。
 * ★ 修法：**只留地板，摘掉天花板**（inline 与 wxss 两处都摘）。
 *   `min-height` 只会"托住"、永远不会"夹住" ⇒ **框一定长得起来**；
 *   且内容高 == 控件高 ⇒ **根本不会出现滚动条，也就没有"滚不动"这回事**。
 *   ⚠️ **不要再给内层加回 `max-height`**（144 轮的失败点）。
 * ★ 另：144 轮顺手摘掉的 `.sd-body` 的 `enhanced` / `show-scrollbar` **本轮已装回** ——
 *   对鸿蒙它是空转，对 WebView（IDE / PC）它却是实打实管事的那个属性；
 *   摘它 = "好的平台撤一处设置、坏的平台什么都没换"，是**只有风险没有收益**的改动。
 *   口径：**没有证据表明它有害之前，不动它。**
 * · `line-height: 21px` 保留（设计口径 = 14 × 1.5）；`areaH` 也是按 21px 行盒算的
 *   ⇒ 我们的地板与原生自己算出来的高度**天然同值**，不会互相打架。
 * · `bindlinechange="onLines"` 保留：原生报的**真实行数**（真机折行未必与我们的字符宽估算
 *   一致）会回写 `areaH`；原生给无效值时什么都不做。
 * · `disable-default-padding` ＋ wxss 里的 `padding:0` / `margin:0` 保留（去掉 textarea 自带
 *   内边距，保住"每行 19 字"的口径 —— 官方说它只作用 iOS，所以 wxss 另兜一层）。
 * · ⚠️ 不要再给外框加 `height` / `overflow:hidden`，也不要给内层加 `height`
 *   —— 一旦有了"我们推的高度"，就又回到 130–143。
 *
 * ── 上限（用户口径「最高 2 倍」）怎么落（★ 147 轮：**上限回来了，而且是自洽的**）────────
 *   `areaHByLines()` 仍封顶在 `AREA_MAX_H`（＝ 208 ＝ 2 × 104）。
 *   ★ 147 轮起内层是**我们给死的绝对 px**（`height:{{areaH - 11}}`，★ 150 轮 20 → 11）⇒ 到顶之后多出来的字
 *     由 textarea **在框内自己滚** —— 这正是"最高 2 倍"的字面实现。
 *   ⚠️ 与 144 去的差别：那条路是"原生自己长、我们在外面夹"（两者互斥，已用真机证过）；
 *      现在是"高度本来就由我们给" ⇒ 到顶＝滚动是**自洽**的，不会再出现"滚不动"。
 *   ⚠️ 若哪天要改成"无限撑开"（用户最近一句「多了就把整个容器撑开就可以了」的口径），
 *      只需把 `Math.min(AREA_MAX_H, …)` 那半句去掉 —— 但**那要用户拍板**
 *      （改的是设计口径，不是修 bug）。
 */
const AREA_MIN_H = 104;                 // 外框总高下限（＝"以当前高度为最小高度"）
const AREA_MAX_H = AREA_MIN_H * 2;      // 用户口径：最高 2 倍（★ 147 轮起＝"到顶就框内滚"的那条线）
const AREA_LH = 21;                     // 14px × 1.5
/**
 * ★★ 第一百五十轮：`20 → 11` —— **下内边距那 9px 让给了"一行余量"**（见下面的 `AREA_SAFE`）。
 * ＝ 上 padding 9 ＋ **下 padding 0** ＋ 上下 border 1×2。
 * ⚠️ 动这个数 ⇒ 三处必须同时改：模板的 `height:{{areaH - 11}}px`、wxss `.sd-area-box` 的 padding、
 *    wxss `.sd-area-in` 的兜底地板（104 − chrome）。判据会**现读 wxss 复算 chrome**，
 *    再与模板里那个数逐位比对，漏一处就报红。
 */
const AREA_CHROME = 11;
/**
 * ★★ 第一百五十轮：**留足一个行盒** → `8 → 29`（＝ `AREA_LH` 21 ＋ 原生内边距那份 8）。
 *
 * 用户口径：「**持续输入文字时，如果换行会突然显示一下滚动条，然后输入框高度增加以后这个
 * 滚动条就没了**」—— 那条滚动条是**换行那一瞬间**冒出来的，长高之后自己就没了。
 *
 * 为什么会闪：高度是**我们算的**，而 `areaH` 是从**上一个**文本长度推出来的 ——
 * 用户敲下"让这一行放不下"的那个字时，原生已经按新文本重排**并画出了滚动条**，
 * 我们的 `setData` 要**下一帧**才把框撑起来。平板 `s ≈ 0.84`：一个行盒 17.6 屏幕 px，
 * 而旧余量 8 只有 6.7px ⇒ 那一瞬内容比控件高 ~11px ⇒ 滚动条登场。
 *
 * ★★ 试过、且**真机否掉了**的一条路（别再走）：把滚动条用 CSS 收掉
 *   （`::-webkit-scrollbar` ＋ `scrollbar-width: none`，本组件另外两个 scroll-view 就是这么干的）。
 *   用户真机复核：「**依旧还是会闪现一下滚动条**」⇒ 那条滚动条是**原生控件自己画的**，
 *   不吃我们这套 CSS（与"原生不认我们的 CSS 高度"是同一个原因）。
 *   ⚠️ 那两条 CSS 仍**保留**（对 WebView / PC 侧照样管事），但**别再把它们当成这个问题的解**。
 *
 * ⇒ 只剩一条路：**让"内容 > 控件"这一瞬根本不发生** —— 原生控件任何时候都留足一个行盒。
 *   · 21 就够挡住换行；多留 8 是给原生自带那圈内边距的（`disable-default-padding` 官方只作用
 *     iOS、wxss 的 `padding:0` 也够不到原生层 —— 147 轮真机正是卡在"4 行差一点点"上）。
 *   ⚠️ 余量长在控件**底部**（文字从控件顶部往下排），所以框的下方会比上方空一档；
 *     为了让框别一下长高 21px，本轮把外框的**下内边距 9 让了出去**（`AREA_CHROME` 20 → 11）
 *     ⇒ 净增高只有 ~12px。⚠️ **那个下内边距是这笔账的另一半，别单独动它**。
 *   ⚠️ 到顶（`AREA_MAX_H`）之后余量会被多出来的行吃掉，再往上就轮到原生在框内滚 —— 那是**要的**行为。
 */
const AREA_SAFE = AREA_LH + 8;
const AREA_TEXT_W = 268;                // 可用文字宽
const AREA_FS = 14;                     // 字号（**设计 px**）
const AREA_EM = AREA_TEXT_W / AREA_FS;  // 一行放得下多少 em（≈ 19.14）

/**
 * ★★ 第一百四十七轮（下半场）· **本组件唯一一处「平台缩放补偿」**
 *
 * 整个 App 活在一层 `transform: scale(s)` 里（`.stage`，设计画布 1280×800 / 800×1280，
 * 真机 `s = min(vw/1280, availH/800, 1)`，见 `utils/stage.js`）。于是同一条链上出现两种尺子：
 *   · **普通 `<view>`**（外框 `.sd-area-box`）跟着缩放 —— CSS 里写的设计 px 到屏幕自动 ×s；
 *   · **原生 `<textarea>` 的字**不跟着缩放（本工程旧结论：原生组件不吃祖先 transform）
 *     ⇒ 写 14px 就真的是 **14 屏幕 px**，而不是 14 × s ≈ 11.8。
 *
 * 第二次真机读数（长按「待办内容」标签，平板 s ≈ 0.84）把这条钉死：
 *
 *     areaH 112 ｜ 外框 94 ｜ 输入区 78 ｜ 字数 65 ｜ 估行 4 ｜ 原行 4 ｜ 原高 84.2105…
 *
 *   · 外框 94 = 112 × 0.84 ／ 输入区 78 = 92 × 0.84 ⇒ **视图层整条都在按 s 缩**；
 *   · 原高 84.2105 = 4 × 21.0526 ⇒ **原生报的是"没缩过"的行高 21**；
 *   · 屏幕上第一行只排得下 **16 个汉字**（可用宽 225 屏幕 px ÷ 16 ≈ 14）⇒ **字确实没缩**。
 *   ⇒ 框（缩了）装不下字（没缩）⇒ 末行被裁。**这正是"七轮都改不对"的真因**：
 *     我们一直在调「把 px 推给谁 / 用什么单位推」，而 px 的单位从一开始就差了这一个 `s`。
 *
 * 修法：**只给原生 textarea 的"字属性"乘 s**（font-size ＋ line-height），让它回到周围
 * 已经缩过的文字那把尺子上：
 *   · 字 → 11.76 屏幕 px（＝ 设计稿 14）、行盒 → 17.64 屏幕 px（＝ 设计稿 21）；
 *   · 于是"一行排几个字"重新等于本文件 `AREA_EM` 的估算（268 ÷ 14 ≈ 19）⇒ **框高模型也准了**；
 *   · 高度那两条（外框 `min-height` / 内层 `height`）**仍是设计 px、不乘 s** ——
 *     视图层本来就按 s 缩，乘了反而缩两次。
 * ⚠️ 只对**原生控件**做这一步；普通 `<view>` 千万别跟着乘。
 * ⚠️ `s` 只在"打开抽屉"那一刻取一次（`stageScale()` 现读视口，IDE / 模拟器本就是 1）。
 */
function stageScale() {
  try {
    const f = stage.fit();
    return (f && f.scale) || 1;
  } catch (e) {
    return 1;                       /* 拿不到就按 1 办（此时与设计稿 1:1，行为=改动之前） */
  }
}
/** 设计 px → **原生控件该写的数**（＝ 设计 px × s），保留两位小数 */
function nativePx(designPx, s) {
  return Math.round(designPx * s * 100) / 100;
}

/**
 * 单个字符占几个 em —— ★ 口径**抄自 `mod-mindmap.js` 的 `emOf()`，值逐字相同**（传码点）。
 * 为什么不共用一份：脑图那份是**排版层的私有函数**（要在一次同步计算里出全部坐标），
 * 抠出来共享会动到它那一整套已定稿的判据；这里按本工程既有做法**手抄 ＋ 留名**，
 * 由 `check_area_autogrow.js` **现读两份源码**比对（值漂了就报红）。
 * ⚠️ 三条最容易改错的：中文字体里 `·`(U+00B7) / `•`(U+2022) 占**全角**；
 *    拉丁字母必须按**上沿**估（宁可略宽，少算就是"差一点放不下"）；空格 0.30。
 */
function areaEmOf(c) {
  if (c >= 0x2E80) return 1;                    // CJK / 全角标点
  if (c === 0xB7 || c === 0x2022) return 1;     // · / •（中文字体里占全角）
  if (c === 32) return 0.30;                    // 空格
  if (c >= 48 && c <= 57) return 0.60;          // 0-9
  if (c >= 65 && c <= 90) return 0.74;          // A-Z
  if (c >= 97 && c <= 122) return 0.58;         // a-z
  return 0.55;                                  // 其余半角标点
}

/**
 * 按可用宽折行之后有几行。
 * · `\n` **强制换行**（textarea 里就是硬回车）
 * · 代理对（emoji 等）按**一个字**算，别把高低位各算一个
 * · 放不下就先换行再放 —— 于是每行至多 `AREA_EM` 个 em（与浏览器折行同口径：不拆字）
 */
function areaLines(text) {
  const s = String(text == null ? '' : text);
  let lines = 1, w = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code === 10) { lines++; w = 0; continue; }
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) i++;   // 代理对 ⇒ 一个字
    const em = areaEmOf(code);
    if (w + em > AREA_EM) { lines++; w = 0; }
    w += em;
  }
  return lines;
}

/**
 * 由**行数**直接算高 —— 两个入口共用（★ 第一百四十轮拆出来的）：
 *   · `areaHOf(text)` —— 我们自己按可用文字宽折行（预填 / 打字都走这条）
 *   · `onLines()`     —— 原生 `<textarea>` 的 `bindlinechange` 报上来的**真实行数**
 *                        （真机折行未必与我们的字符宽估算一致，用它兜底）
 * ＝ clamp(最小, chrome ＋ 余量 ＋ 行数 × 行盒, 最大)；空文本 ⇒ 1 行 ⇒ 落在最小高度上。
 *
 * ★ 147 轮加进 `AREA_SAFE`；★★ 150 轮把它提到**一个行盒 ＋ 8**（＝ 29，用来挡住"换行那一瞬间"
 *   那条滚动条，理由见那个常量的注释）⇒ 中间几档比 130–146 各高 29px，
 *   但**下限仍是字面的 104**（空文本 / 1 行都落在它上面）。
 * ⚠️ 上限刻意取**字面的 2 倍 ＝ 208**：208 − 11 − 29 ＝ 168 ＝ **整 8 行**（★ 150 轮起正好落在
 *   行边界上 —— 框满时是"8 行文字 ＋ 一整行余量"，第 9 行进来把余量吃掉、**第 10 行起**才轮到
 *   原生在框内滚）。这是用户口径的字面值，**不是四舍五入写错**，别"顺手修正"。
 */
function areaHByLines(n) {
  const h = AREA_CHROME + AREA_SAFE + n * AREA_LH;
  return Math.max(AREA_MIN_H, Math.min(AREA_MAX_H, h));
}

/** 按正文文本算高 —— 模板贴的 `areaH` 平常由它出 */
function areaHOf(text) {
  return areaHByLines(areaLines(text));
}

Component({
  properties: {
    open: { type: Boolean, value: false },
    mode: { type: String, value: 'todo' },
    offset: { type: Number, value: 0 },
    turned: { type: Boolean, value: false },
    port: { type: Boolean, value: false },
    /**
     * 编辑态的对象 id —— 底部「删除」入口靠它判断要不要出现（空 ＝ 新建）。
     * ⚠️ 属性名不能叫 `id`：`id` 是 WXML 的内置属性（选择器用），
     *    写成 `id` 会被框架吞掉，`properties.id` 恒为空 —— 症状是「删除按钮永远不出现」。
     *    所以这里用 `editId`，模板里传 `edit-id`。
     */
    editId: { type: String, value: '' },
    title: { type: String, value: '' },
    submitLabel: { type: String, value: '保存' },
    /**
     * 底部那颗危险动作按钮的文字 —— 只有 `mode='project'` 用得上（传「归档项目」）。
     * ★ 55 轮：项目只归档不删（FR-2.9），所以 agent / token 的「删除」位在这里换个词复用；
     *   文案由页面传，组件不预设（哪一档语义由页面才知道：归档 / 取消归档……）。
     */
    dangerLabel: { type: String, value: '删除' },
    /**
     * ★★ 280 轮：**「完善态」开关** —— 只有"语义转脑图生成出来的卡，字段没填全"这一支为 true。
     *
     * ★★ 2026-10-27 用户口径调整后，它管的事只剩两件半：
     *   ① `canSubmit` 的**格式必填**（`v.format` 非空）；
     *   ② 标题「完善脑图信息」＋ 主键「保存」；
     *   ③ 不渲染删除键（`noDanger` 跟着它走）。
     *   「归属 agent」不再参与 —— 脑图的 agent 由项目决定，用户没得选（见 wxml 那条注释）。
     *
     * ⚠️⚠️ **绝不许把格式必填并进 `mode==='mindmap'` 的校验里**：所有历史脑图里
     *    "格式"这一档是用户真选过的（非空），但一旦哪天出现空值的老数据，并进去就会让
     *    那张图的「编辑脑图信息」保存键永远灰（＝把既有抽屉的能力削掉了）。
     *    开关必须跟着"这一份是不是完善态"走，不能跟着 mode 走。
     */
    requireAll: { type: Boolean, value: false },
    /**
     * ★★ 280 轮：**不渲染底部那颗危险键**（完善态专用）。
     * ⚠️ 为什么需要一颗显式开关：`.sd-del` 的 `wx:if` 原来只看 `mode`，
     *    传一个空 `dangerLabel` 是**藏不住**的（文案不参与那个判断）。
     *    279 轮刚在 `wx:else` 上踩过同款"静默改判"——凡是"显隐"都要有明确的开关，别靠内容推断。
     */
    noDanger: { type: Boolean, value: false },
    hint: { type: String, value: '' },
    /**
     * ★★ 2026-10-22：**这是"嵌套二级"表单**（由 `forms.openNested*` 打开）。
     * 语义只有一条：取消它 ＝ **回到上一层表单**（父草稿保留），不是"放弃填写"。
     * ⇒ 取消时**不问**「放弃填写？」。见 `onCancel` 与 `forms.closed().child` 的注释。
     * ⚠️ 不能用 `offset > 0` 推断：从列表抽屉点编辑落到 L2 位时 offset 也是 270，
     *    但那张的取消是真的关掉整张表单（该问就一定要问 —— 审查 P1-07 的第二个缺口）。
     */
    child: { type: Boolean, value: false },

    values: { type: Object, value: null },
    urgencies: { type: Array, value: [] },
    projects: { type: Array, value: [] },
    mindmaps: { type: Array, value: [] },
    nodes: { type: Array, value: [] },
    agents: { type: Array, value: [] },
    colors: { type: Array, value: [] },
    /* ★ 本轮：脑图格式的六个选项（带缩略图，源 `utils/formats.js`）—— 只有 mode='mindmap' 用得上 */
    formats: { type: Array, value: [] },
    /* ★★ 2026-10-12：模型厂商选项（源 `utils/vendors.js`）—— 只有 mode='token' 用得上。
       「模型厂商」字段**只能选、不能输**（用户口径「模型厂商改为下列菜单」），
       渲染复用 `sd-chips`（与「紧急程度」「项目节点」同款，单选在这个工程里只有这一种画法）。 */
    vendors: { type: Array, value: [] },

    /* ==========================================================================
       信息增强（★ 278 轮）—— 四个**只下行**的展示属性
       ==========================================================================
       ★ 为什么是 property 而不是组件自己 `setData` 的 data：
         · 请求由**页面**发（`mod-todo.js` 的 `onFormEnhance`）。组件被 `wx:if` 建/销，
           用户关掉抽屉后才回来的响应组件接不住 —— 而页面一直在。
         · 因此"结果"必须能从外面推进来，property 是唯一通道。
       ★★ 这四个**绝不许进 `observers`**：它们是"结果"，不是"输入"。
         一旦被 observe（例如顺手写一句 `'enhState': function(){...}` 去联动别的东西），
         就会和页面下发的 setData 形成自激 —— 171 / 173 轮在 `copied` 与 `expText` 上
         各踩过一次，症状是"数据在跳、界面偶尔闪"。
       ★ `enhState` 默认 `'loading'` 而不是 `''`：抽屉**一开就是生成中**（需求 4），
         没有 idle 态 —— 少一个状态，就少一条"开了却没显示动效"的路。 */
    /** 模型增强后的正文（done 态渲染；loading/error 时为空串） */
    enhText: { type: String, value: '' },
    /** `loading` | `done` | `error` —— 见上面注释：没有 idle */
    enhState: { type: String, value: 'loading' },
    /** error 态要显示的那句话（**必须是中文成因**，不是错误码 —— 错误码只进 console） */
    enhError: { type: String, value: '' },
    /** 回填器的一句报告（图片被挪到末尾 / 去重 / 次序乱了才有），空串 ⇒ 不渲染、不占高度 */
    enhNotice: { type: String, value: '' }
  },

  data: {
    v: {},
    o: { urgencies: [], projects: [], mindmaps: [], nodes: [], agents: [], colors: [], formats: [], vendors: [] },
    /**
     * 位置类（★ 45 轮）：0 → 一级位；270 → 二级位（右侧）；540 → 三级位（再右移 270）。
     * 45 轮起「待办表单 → 新建项目」是两级并排，所以位置不再只有两档。
     * 由组件自己从 `offset` 算，模板只贴类名 —— 免得模板里写一串三元。
     */
    posClass: '',
    /* ★★ 247 轮：`pickMap` / `mapRows` / `mapTitle` / `mapEmpty` / `mapName` 五个字段
       **整组删除** —— 它们是 43 轮那个「关联脑图 → 右侧三级抽屉」的状态，
       而待办表单 247 轮起不再有「关联脑图」这个字段（用户口径见文件头）。
       ⚠️ 与之相连的还有三处，一起走：`observers` 里的复位、`mapRowsOf/mapCtx/nameIn/nameOf`
          四个小工具、`onOpenMap/onCloseMap/onPickMindmap` 三个 handler。
       ⚠️ `onNewMindmap`（triggerEvent）**留着** —— 五个模块都绑着它，且"新建脑图"在别的
          表单里回来是合理的；本轮只是没有入口触发。
       ⚠️ 别把它们当成"以后还能用"留着：模板里一个调用点都没有，
          留着只会让下一个人以为表单还长着那个字段（本工程的老规矩：规则与调用点一起走）。 */
    /* ★★ 2026-10-23：「归属项目 / 所属项目」的第二层 —— **「选择其他项目」副弹窗**。
     *
     * 用户口径（第 246 轮）：
     *   ① 项目字段里**只列有颜色的项目**（无颜色的项目不进主列表）；
     *   ② 列表尾部两行：「选择其他项目」＋「新建项目」；
     *   ③ 「选择其他项目」点开右侧副弹窗（**样式照搬「关联脑图」那个三级**），
     *      里面**只列没有颜色的项目**；
     *   ④ 选中一个无颜色项目之后，那一行的文案换成项目名、整行跟着变黄底
     *      （＝ `.sd-row.on`，与有颜色的行选中时同一种画法），**右端的 `>` 保留**
     *      （示意"还能再改"）；
     *   ⑤ 回头再点某个有颜色的项目 ⇒ 这一行**退回「选择其他项目」且去掉黄底**。
     *
     * 为什么"只列有颜色的"：8 个色位是有限资源，有颜色的项目靠色点一眼认；
     *   无颜色的项目挤进同一列既不提供信息、又把抽屉撑长（一行一个最多 8 行＋两行入口）。
     *
     * ⚠️ 三个字段各管一件事，别合并成一个"当前选中"：
     *   · `pickProj`  —— 副弹窗开没开（只在点「选择其他项目」时为真）；
     *   · `projRows`  —— 副弹窗里的行（**只含无颜色项目**，带 `selected`）；
     *   · `otherName` —— 主列表那一行显示的项目名（**空串 ＝ 态 ⑤，显示「选择其他项目」**）。
     *     它同时是那一行黄底与否的唯一依据（模板 `{{otherName ? 'on' : ''}}`）——
     *     不给它再配一个 `otherOn` 布尔：两个字段表达一件事，迟早会不同步。
     */
    pickProj: false,
    projRows: [],
    otherName: '',
    /* ★ 45 轮：mode=export 的只读预览（＝ 复制出去的那一段，同一个纯函数算的） */
    expText: '',
    /**
     * ★★ 173 轮：「复制到剪贴板」的**成功态** —— 按钮自己变色。
     *
     * 用户口径：*「『复制到剪贴板』这个按钮点击之后应该给个变色作为提示，
     * 要不总觉得没有起作用」*。
     * 成因很清楚：这个动作的落点是**剪贴板**，界面上本来**一个字都不会变**
     * （预览文本原样躺着、开关原样躺着），全靠一句 toast 报信；
     * toast 一闪而过、又和「点了没反应」长得像，所以用户会反复点。
     * ⇒ 现在复制成功后**按钮自身**变成「`--success` 绿底 ＋ 墨勾 ＋『已复制』」，
     *   反馈落在**用户正在看的那颗键**上，不依赖 toast 的存活时间。
     *   （★ 当日返工：底色由深字档 `--success-t` 收回基色 `--success`、勾与字随之转墨 ——
     *    起因是用户口径「这个绿色，是不是和应用的已有配色体系有点偏差啊」；
     *    为什么必须连带换字色，逐条写在 wxss `.sd-submit.ok` 那段注释里。）
     *
     * ⚠️ 它**只活在当次打开期间**（用户口径：*「不用记住我是否已经导出，
     *   下次再进来重置即可」*）—— 不落 storage、不写进待办、关抽屉即复位。
     * ⚠️ 它**不进 `observers` 的依赖列表** —— 否则 `setData({copied})` 会把自己
     *   再触发一遍（171 轮「只读脑图量宽」那条收敛守卫是同一类坑；187 轮把它并进了
     *   `mod-todo.js` 的 `roW()`）。
     */
    copied: false,
    canSubmit: false,
    /**
     * ★★ 2026-09-30：**表单区（含原生输入控件）的渲染闸门**。
     * 它必须与 `v` 在**同一次 `setData`** 里置真 —— 原因见 `observers` 的注释。
     * 抽屉一关（`open` 转假）就复位，保证下一次打开又走一遍"创建即带值"。
     */
    vReady: false,
    /**
     * ★ 130 轮建立 · ★ 147 轮定稿：待办正文框的高度（px）—— 由 `areaHOf(v.text)` 算。
     * **它现在同时贴两处**（★ 147 轮，两道独立出口、同一个数）：
     *   · 外框 `.sd-area-box`（**普通 view**）：inline `min-height:{{areaH}}px` ← **权威**
     *   · 内层 `.sd-area-in`（textarea）：inline `height:{{areaH - 11}}px` ＋ wxss `flex:1 1 auto`
     *     ★ 150 轮：`20 → 11`（外框下内边距 9 → 0，把那 9px 让给"一个行盒的余量"）。
     * ⇒ 边框一定跟着它长（普通 view 在所有平台都吃 CSS）；
     *   内层两道来源（绝对 px / 弹性拉伸）哪个平台认哪道就用哪道。
     * ⚠️ **外框只写 `min-height`，永远不写 `height` / `overflow`** —— 只"托住"、不"夹住"；
     * ⚠️ **内层不许再出现 `auto-height`** —— 一开就等于把高度交回原生，我们下发的数全废
     *   （147 轮真机读数：下发的 84 被原生算成 71，框比字矮、字被裁）。
     * ⚠️ 这条高度一路从"贴原生 textarea"（130 / 140）、"外框 min-height ＋ 内层 auto-height"
     *   （141）、"外框 height ＋ 内层 height:100%"（142）、"外框 height ＋ 内层绝对 px"（143）、
     *   "摘掉 enhanced 交回 auto-height"（144）、"只留地板摘掉天花板"（145）
     *   走到现在 —— 中间五版全败，缘由见文件头；**别再打开 `auto-height`**。
     * ⚠️ 它**必须跟着 `v` 走**：抽屉打开时（含"闪念胶囊转待办"那条 `setData` 预填）
     *    在 observer 的**同一次 setData** 里算；打字时在 `put()` 里算。
     *    两处任一漏掉都只是"晚一帧"，但预填长文那一下最刺眼（框 4 行、字 8 行）。
     */
    areaH: AREA_MIN_H,
    /**
     * ★ 147 轮（下半场）：**原生 textarea 的字属性** —— 设计 px × 平台缩放 `s`。
     * 为什么单独摘出来：原生组件不吃祖先 `.stage` 的 `transform: scale(s)`，
     * `font-size` / `line-height` 必须自己乘一遍（成因与真机证据见 `stageScale()` 的注释）。
     * 只在**打开抽屉**那一次重算（`stage.fit().scale`）；IDE / 模拟器 s = 1
     * ⇒ 与 wxss 兜底值逐位相同 ⇒ **零回归**。
     */
    areaFs: AREA_FS,
    areaLh: AREA_LH
  },

  observers: {
    /**
     * ★★ 2026-09-30 修（**真机 bug**：「待办详情点编辑，待办信息没有填入输入框」）。
     *
     * 现象：抽屉正常打开、紧急程度与归属项目的选中态都对（它们也是 `v`/`o` 里的值！），
     *       **只有输入框是空的** —— 正文框里躺着 placeholder。
     *
     * 根因：`<textarea>` / `<input>` 是**原生组件**，`value` 属于"**初始内容**"语义 ——
     *   ① 抽屉关着时 `.sd` 整段被 `wx:if="{{open}}"` 抠掉；
     *   ② 点编辑 ⇒ 页面 `setData({form})` ⇒ 组件 property 变 ⇒ **这一段被立刻创建出来**，
     *      而此刻 `v` 还是空的（`data.v` 的初值 `{}`）；
     *   ③ 紧接着这个 observer 才 `setData({v})` —— **原生层吃不到后灌的 `value`**，
     *      框里就一直空着。
     *   ⇒ 同一次打开里，"值"比"控件的出生"晚了半拍。`<view>` 们（胶囊选中态、行黄底、
     *      打勾）不吃原生那一套，所以它们看着全对 —— 现场就是"只有输入框是空的"。
     *
     * ⚠️ **这个 bug 在开发者工具里验不出来**：模拟器的 `textarea` 走 Web 层，
     *    `setData` 之后 `value` 会正常更新；**只有真机走原生层**。
     *    本工程铁律「原生组件（`input`/`textarea`/`video`/`camera`/`map`）只有真机能判」，
     *    这是它的又一次应验 —— 所以判据只能落在**源码结构**上（见 `工具/check_source_guard.py`）。
     *
     * ✅ 修法只有一条：**让原生控件在"值已经就位"的那一次渲染里出生** ——
     *    加 `vReady`，与 `v` 在**同一次 `setData`** 里置上，模板里表单区 `wx:if="{{vReady}}"`。
     *    这正是本工程**已经验过**的写法，抄的是这两处：
     *      · 闪念胶囊编辑面板：`setData({ editId, editText })`（`capsule.js`）——
     *        面板 `wx:if="{{… && editId}}"`，`<textarea value="{{editText}}">`；
     *      · 脑图节点编辑浮条：`setData({ editId, editText })`（`mod-mindmap.js`）。
     *    两处都是"出现条件与值同一次 setData"，原生控件因此创建即带值（真机验过）。
     *
     * ★ 参数改用 observer 传进来的**新值**，不再读 `this.data` ——
     *   原生"监听器回调时 this.data 是否已更新"这件事平台没给出硬保证，
     *   而回调参数按文档就是新值。少一层时序依赖。
     */
    'open, mode, values, urgencies, projects, mindmaps, nodes, agents, colors, formats, vendors': function (
      open, mode, values, urgencies, projects, mindmaps, nodes, agents, colors, formats, vendors
    ) {
      if (!open || !values) {
        /* 抽屉关掉 ⇒ 收闸门，下次打开重新走"创建即带值"。
           ★ 130 轮：`areaH` 一并复位 —— 下一次打开会按新的正文重算，
             不复位就会"上一张待办是 8 行、这一张只有 1 行"时先画一帧旧高度。
           ★ 173 轮：`copied` 也在这里收 —— 「不记住是否已导出」的唯一落点就是这一句
             （关抽屉 ⇒ 成功态随组件一起消失，下次打开按钮回到「复制到剪贴板」）。 */
        if (!open && (this.data.vReady || this.data.copied)) {
          this.setData({ vReady: false, areaH: AREA_MIN_H, copied: false });
        }
        /* ★★ 2026-10-27（F12）：抽屉一关 ⇒ 在飞的头像上传作废、上传闸门复位。
           ⚠️ 不复位这里，一次"上传没回来就关抽屉"会让**下一次打开**的表单
              永远点不动保存（`_avUp` 还挂着 true）。 */
        if (!open) {
          this._avSeq = (this._avSeq || 0) + 1;
          this._avUp = false;
        }
        return;
      }
      const off = Number(this.properties.offset) || 0;
      /* ★★ 2026-10-22（审查 P1-06）：**每次"这张表单被重新装进来"都换一个会话号**。
         异步上传（头像 / 待办图片）的回调靠它判断"我还是不是当前这张表单的那一次"。
         ⚠️ 为什么敢每次都加：`put()` 只改 `data.v`、**不动 properties** ⇒ 用户打字不会
            走到这里；只有页面重新 `setData({form})`（打开 / 切换实体 / 提交后收回）才会，
            而那正是"旧回调必须失效"的时刻。
         ⚠️ 不要把它做成 `data` 字段：它不参与渲染，进 data 只会白多一轮 setData。 */
      this._sess = (this._sess || 0) + 1;
      /* ★ 147 轮（下半场）：平台缩放 —— 在"打开抽屉"这一下取一次真机值（由当前视口决定）。 */
      const sc = stageScale();
      const o = {
        urgencies: (urgencies || []).map(deepClone),
        projects: (projects || []).map(deepClone),
        mindmaps: (mindmaps || []).map(deepClone),
        nodes: (nodes || []).map(deepClone),
        agents: (agents || []).map(deepClone),
        colors: (colors || []).map(deepClone),
        formats: (formats || []).map(deepClone),
        vendors: (vendors || []).map(deepClone)
      };
      const v = deepClone(values);
      /* ★ 审查-02 B-2（2026-10-15）：记下「打开时那一份草稿」——
         唯一用途是 `isDirty()`（取消时判断"写过东西没有"）。
         ★★ 247 轮：原来这里还有一句 `v.images = imageRows(v.images)`（表单要显示已入库的图）
         —— 图片区删掉之后它没有调用点了，一起走。
         上面那条"两侧要同源"的纪律仍在：任何**派生字段**只要会进 `v`，就必须在记 `_initV`
         **之前**算好，否则会被 `isDirty()` 当成"用户改过"。
         ⚠️ 它**不进 data**（不需要渲染），放实例属性上最省 —— 也不会多触发一轮 setData。 */
      this._initV = deepClone(v);
      this.setData({
        v: v,
        o: o,
        vReady: true,                       /* ★ 与 v 同批 —— 模板靠它决定"现在才建原生控件" */
        /* ★ 130 轮：与 `v` **同批**下发高度 —— 预填长文（闪念胶囊转待办）一次到位，
           不会先按 104 画一帧再长高。 */
        areaH: areaHOf(v.text),
        /* ★ 147 轮（下半场）：原生 textarea 的字属性 —— 设计 px × s（理由见 `stageScale()`）。 */
        areaFs: nativePx(AREA_FS, sc),
        areaLh: nativePx(AREA_LH, sc),
        posClass: off === 540 ? 'o2' : (off ? 'o1' : ''),
        /* ★★ 247 轮：原来这里有五行 `pickMap / mapRows / mapTitle / mapEmpty / mapName`
           的复位 —— 脑图那一层删掉之后一起走（每次打开只需复位"这一层里还在的"）。 */
        /* ★★ 2026-10-23：项目字段的第二层（见 data 里 `pickProj` 的注释）——
           打开表单时副弹窗一定关着；`otherName` 按**这次的值**现算
           （编辑一条归属于无颜色项目的待办 ⇒ 那一行直接就是项目名 ＋ 黄底）。 */
        pickProj: false,
        projRows: [],
        otherName: this.otherNameOf(o.projects, v.projectId),
        expText: mode === 'export' ? store.copyTodoText(v.todoId, { noImage: !!v.noImage }) : '',
        /* ★ 173 轮：**每次打开都从"没复制过"起步** —— 与上面那句复位互为保险
           （关抽屉那一下已经被 `wx:if` 把整段拆了，这里再显式归零，
            防的是"同一颗抽屉不关、直接换 mode 重开"那条路）。 */
        copied: false,
        canSubmit: this.valid(mode, v)
      });

      /* ★★ 2026-10-24（复审 P1-04 · 后半）：**预览跟着树就绪更新**。
         ── 病根：`expText` 只在"打开抽屉"这一下算一次。若这条待办的脑图树还没拉回来
            （从没打开过那张图 / 刚刷新过），预览里就只有正文；树随后加载完成，
            **预览不会补上**，用户看到的和剪贴板里拿到的都少一半，而且没有任何提示。
         ── 现在：导出态发现"有脑图但树未就绪"就补一次 `loadTree()`，回来后按**当前**
            这一张表单重算预览。
         ⚠️ 两道守卫防串台：`_sess`（form-drawer 自己的表单会话号 —— 关掉 / 换一条后
            旧回调必须失效）、`data.v.todoId`（还是不是同一条待办）。
         ⚠️ 用 `treeReady()` 而不是"有没有 tree"：`ensureTree()` 造的占位树也在。
         ⚠️ 失败不弹提示：复制那一刻 `pagebase.copyTodo` 会明说"只复制了正文"，
            这里再喊一次就是两条重复的话。 */
      if (mode === 'export' && v.todoId && store.isLoaded()) {
        const self2 = this;
        const sess = this._sess;
        const t0 = store.todoById(v.todoId);
        const mid = t0 && t0.mindmapId;
        if (mid && !store.treeReady(mid)) {
          store.loadTree(mid).then(function () {
            if (self2._sess !== sess) return;                    // 已经换了表单 / 关了
            if (!self2.data.v || self2.data.v.todoId !== v.todoId) return;
            self2.setData({
              expText: store.copyTodoText(v.todoId, { noImage: !!self2.data.v.noImage })
            });
          }, function () { /* 失败保持"只有正文"的预览，复制那一刻会明说 */ });
        }
      }
    }
  },

  methods: {
    /* ---------- 小工具 ---------- */
    /**
     * ★★ 2026-10-23：**「选择其他项目」那一行该显示什么** —— 空串 ＝ 显示占位文案。
     *
     * 只有"当前选中的那个项目**没有颜色**"时才给名字：那种项目在主列表里不出现
     * （主列表只列有颜色的），若不把名字挂到这一行上，用户就**看不到自己选了谁**
     * —— 「归属项目 / 所属项目」都是必填字段，界面上必须永远能读出当前值。
     * 有颜色的项目 / 空值 ⇒ 回空串 ⇒ 那一行退回「选择其他项目」的常态。
     *
     * ⚠️ 这里就是需求第 ⑤ 条（"重新选中其他有颜色的项目 ⇒ 该卡片重置"）的**唯一实现**：
     *   不是在 `onPickProject` 里手动清一次 —— 那种写法一旦新增别的入口就会漏。
     *   只要"名字从当前值现算"，重置就是天然成立的。
     */
    otherNameOf: function (list, pid) {
      if (pid === '' || pid === null || pid === undefined) return '';
      const hit = (list || []).filter(function (x) { return String(x.id) === String(pid); })[0];
      return (hit && !hit.tinted) ? hit.name : '';
    },
    /**
     * ★★ 2026-10-23：副弹窗的行 —— **只列没有颜色的项目**（`tinted` 为假）。
     * 与「关联脑图」三级那套 `mapRowsOf` 同一个形状（`{id, name, selected}`），
     * 所以两边共用一样的 `.sd3-item` 卡片样式。
     * ⚠️ 不在这里补"不关联 / 清空"行：项目是必填项，没有"不选"这个合法状态
     *   （脑图那个三级有「不关联」，是因为关联本身可空）。
     */
    projRowsOf: function (selId) {
      return (this.data.o.projects || [])
        .filter(function (p) { return !p.tinted; })
        .map(function (p) {
          return Object.assign({}, p, { selected: String(p.id) === String(selId) });
        });
    },
    valid: function (mode, v) {
      if (!v) return false;
      if (mode === 'profile') return !!(v.name && String(v.name).trim());
      if (mode === 'todo') return !!(v.text && String(v.text).trim());
      if (mode === 'project') return !!(v.name && String(v.name).trim());
      /* ★★ 280 轮：脑图多一条**只在完善态**生效的必填 —— **格式**。
         ★ 2026-10-27：原来这里还有「归属 agent」，已撤 —— agent 由项目决定，表单里没有这一项
           （`requireAll` 属性那条注释有完整理由）。空着判 agent 等于让用户去填一个看不见的字段。
         ⚠️ 不能无条件加 —— 它是"完善"这件事的定义：占位卡建出来时 `format=''`，
            用户选完就该能保存；而普通编辑态本来就不该被必填卡住。 */
      if (mode === 'mindmap') {
        if (!(v.name && String(v.name).trim() && v.projectId)) return false;
        if (this.properties.requireAll) return !!v.format;
        return true;
      }
      if (mode === 'agent') return !!(v.name && String(v.name).trim());
      /* ★★ 2026-10-12：token ＝ 厂商 ＋ API Key。
         ⚠️ key 只在**新建时必填**：编辑态留空表示"不换 key"（服务端只存密文，
            表单拿不回明文 —— 要求必填就等于逼用户每次编辑都重贴一遍 key）。 */
      if (mode === 'token') {
        if (!v.vendor || !String(v.vendor).trim()) return false;
        if (!this.properties.editId && !String(v.apiKey || '').trim()) return false;
        return true;
      }
      return true;
    },
    /** 改一个字段 ＋ 同步按钮可用态 */
    put: function (patch) {
      /* ★★ 247 轮：原来这里第一句是"改图片必过 `imageRows()`"的收口 —— 图片区删掉之后
         没有任何调用方会传 `images`，那句连同 `imageRows()` 一起走。
         ⚠️ 若将来表单重新长出图片字段，那条"派生字段必须在写进 `v` 的同一处算好"的规矩
            必须恢复：漏了它就会变成"新加的那张没有 src、旧的有"。 */
      const v = Object.assign({}, this.data.v, patch);
      const d = { v: v, canSubmit: this.valid(this.properties.mode, v) };
      /* ★ 130 轮：待办正文改了 ⇒ **同一次 setData** 里把高度也重算。
         分两次 setData 会让输入框"先按旧高度画、再跳一下"。 */
      if (this.properties.mode === 'todo' && patch && patch.text !== undefined) {
        d.areaH = areaHOf(v.text);
      }
      this.setData(d);
    },
    /** 就地改某个选项数组的选中态 */
    sel: function (listName, keyField, val) {
      const list = (this.data.o[listName] || []).map(function (it) {
        return Object.assign({}, it, { selected: String(it[keyField]) === String(val) });
      });
      const d = {};
      d['o.' + listName] = list;
      this.setData(d);
    },

    /* ---------- 输入 ---------- */
    onText: function (e) { this.put({ text: e.detail.value }); },
    /**
     * ★ 140 轮建立 · ★ 147 轮仍是**兜底**：原生 `<textarea>` 的**真实行数**回调
     * （`bind:linechange`，`detail.lineCount` / `lineHeight` / `height`）。
     * 只接在待办正文框上（`mode='todo'`）；取 `max(原生行数, 估算行数)` 再算高。
     * ★ 147 轮的定位：**行数只用来"把估少的那一截补回来"** ——
     *   估算按字符宽折行，真机字体度量未必一致（鸿蒙尤其可能与 WebView 不同），
     *   所以原生报了更大的行数时把 `areaH` 抬上去；绝不把已经算对的高度压小。
     * ⚠️ 147 轮起内层关了 `auto-height`，这个回调**在部分基础库上可能不再触发** ⇒
     *    它只是"锦上添花"，**不能**当唯一依据（主依据是我们自己的 `areaLines()`）。
     * ⚠️ 原生行数无效（0 ／ 空 ／ 该基础库不带这个回调）⇒ **什么都不做**（铁律：少算比多算严重）。
     */
    onLines: function (e) {
      if (this.properties.mode !== 'todo') return;
      const d = (e && e.detail) || {};
      /* ★ 147 轮：把原生**自己报的**行数留在实例上（不进 data、不触发渲染）——
         原生算出来的行数比我们的字符宽估算更贴近真机折行，取 max 时用得上。 */
      this._lc = Number(d.lineCount) || 0;
      const n = this._lc;
      if (n < 1) return;
      const est = areaLines(this.data.v && this.data.v.text);
      const h = areaHByLines(n > est ? n : est);
      if (h !== this.data.areaH) this.setData({ areaH: h });
    },
    onName: function (e) { this.put({ name: e.detail.value }); },
    onRemark: function (e) { this.put({ remark: e.detail.value }); },
    /* ★ 158 轮删除 `onQuotaLeft` —— agent 表单不再有「当前剩余」那一格（拿不到余额 API）。 */
    onMonthlyQuota: function (e) { this.put({ monthlyQuota: e.detail.value }); },

    /* ---------- 额度重置日：**只有「日」**一个步进器（★ 133 轮） ----------
     * 各家 agent 都按**自然月**重置 ⇒ 月份没有信息量，42 轮·补二那两行「月份 / 日期」收成一行。
     * 不用日期选择器（小程序的日历控件在平板上又大又难用），就一个整数、前后各一个「−／＋」。
     * · 日：1–31 **循环**（31 再 + 回 1；1 再 − 回 31）—— 本来就是每月重来，循环比顶住更顺
     * · 中间那个数**不可手输** —— 范围只有 1–31，循环最多点 15 下就到，
     *   换来的是完全不弹键盘、也不会输进非法值
     * ⚠️ 短月没有 31 号 ⇒ 「距离重置」按**该月最后一天**算（`store.daysUntilReset` → `resetAt`）。
     */
    onStepReset: function (e) {
      const d = Number(e.currentTarget.dataset.d) || 0;
      const v = this.data.v;
      this.put({ resetDay: store.stepResetDay(v.resetDay, d) });
    },
    /* ---------- Token API（★★ 2026-10-12 改造）----------
     * 「模型厂商」从**自由输入**改成**只能从菜单里选**（用户口径「模型厂商改为下列菜单」）——
     * 所以它走 `onPick*`（点胶囊，dataset 取值）而不是 `onXxx`（输入框 bindinput）。
     * 「API Key」是唯一的输入项：明文只在提交那一刻读出来交给 store，
     * **不进本地状态**（见 store.addTokenKey 的注释）。 */
    /**
     * ★ 2026-10-13（改造清单 R05 修）：**原来漏了 `this.sel(...)`** —— 它只 `put({vendor})`，
     * 而 `put()` 只改本地副本 `data.v`、不动 `o.vendors` ⇒ 行上的黄底与右侧的勾**一格都不动**。
     * 症状与 43 轮「归属项目选不动」**同一个 bug、同一条根因**（见 `onPickProject` 的长注释）：
     * 单选组必须「`sel()` 翻选项 ＋ `put()` 写值」**成对**。厂商选项的键是 `code`（见 `vendorOptions`）。
     */
    onPickVendor: function (e) {
      const v = e.currentTarget.dataset.v;
      this.sel('vendors', 'code', v);
      this.put({ vendor: v });
    },
    onApiKey: function (e) { this.put({ apiKey: e.detail.value }); },

    /* ---------- 头像（profile）---------- */
    /**
     * 从本地相册选一张 —— wx.chooseMedia 的 image ＋ album。
     *
     * ★ 本轮接后端：选完**先本地预览、再后台上传**（技术文档 §9.5）。
     *   · 上传成功 ⇒ `v.avatar` 换成**完整地址**（`api.fileUrl(uri)`）——
     *     它是给 `<image src>` 用的那种"能显示的值"，而 `store.updateMe()` 会从
     *     `/files/xxx` 里把**相对 uri** 反解出来入库（见 `store.toAvatarUri`）。
     *   · 上传失败 ⇒ 只提示，**不撤销**刚选的那张（用户已经选好了，抹掉更像"白点了"）。
     * ⚠️ `USE_MOCK = true` 时**一个字都不变**：本地临时路径直接用，不发请求。
     */
    onPickAvatar: function () {
      const self = this;
      /* ★★ 2026-10-27（全量检查 F12）· **头像的上传序号**。
         ── 病根：`_sess` 只挡"换了表单"，挡不住**同一张表单里连选两次图**：
            A（慢）和 B（快）都在飞，B 先回来把界面换成 B，A 后回来又盖成 A ——
            用户看到的是"我最后选的那张不是显示的这张"，而保存上去的是 A。
         ── 现在：每次选图 / 恢复默认都 `_avSeq += 1`，回调只认自己那一版。
         ⚠️ `_avSeq` 与 `_sess` 是**两级**：前者管同表单内的先后，后者管跨表单/重开。
           两个都要判，少一个就有一类交错能漏过去。 */
      const seq = this._avSeq = (this._avSeq || 0) + 1;
      /* ⚠️ `sess` 必须在**点开相册之前**取：选图期间表单可能被关掉 / 换成别的实体 */
      const sess = this._sess;
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album'],
        sizeType: ['compressed'],
        success: function (r) {
          const f = (r.tempFiles || [])[0];
          if (!f || !f.tempFilePath) return;
          if (self._sess !== sess) return;                /* 选图期间表单已经换人了 */
          if (self._avSeq !== seq) return;                /* 选图期间又选了一张 / 恢复了默认 */
          self.put({ avatar: f.tempFilePath });          // ① 先给用户看到自己那张
          if (api.useMock()) return;
          /* 上传中 ⇒ 资料表单**不许提交**（下面 `onSubmit` 的闸门读这个标记） */
          self._avUp = true;
          imgpick.upload(f.tempFilePath, function (uri, url) {
            if (self._avSeq === seq) self._avUp = false;
            if (self._sess !== sess) return;             /* 上传期间表单已经换人了 */
            if (self._avSeq !== seq) return;             /* 上传期间又选了一张 / 恢复了默认 */
            self.put({ avatar: url || api.fileUrl(uri) });   // ② 换成服务端地址
          }, function () {
            /* 失败也要放开闸门 —— 否则一次上传失败会把表单永久锁死 */
            if (self._avSeq === seq) self._avUp = false;
          });
        },
        fail: function () {}
      });
    },
    onResetAvatar: function () {
      /* ★ F12：恢复默认 ⇒ 在飞的那次上传作废（否则它回来又把旧图盖上去） */
      this._avSeq = (this._avSeq || 0) + 1;
      this._avUp = false;
      this.put({ avatar: '' });
    },

    /* ---------- 选择 ---------- */
    onPickUrgency: function (e) {
      const v = e.currentTarget.dataset.v;
      this.sel('urgencies', 'key', v);
      this.put({ urgency: v });
    },
    /**
     * 选脑图格式（★ 本轮）—— 与「项目色」「关联 agent」同一套写法：
     * 就地翻 `o.formats` 的 `selected` ＋ 把值写进 `v.format`。
     * 六个选项由 `store.mindmapFormatOptions()` 给，组件不认识它们是哪六种。
     */
    onPickFormat: function (e) {
      const key = e.currentTarget.dataset.v;
      this.sel('formats', 'key', key);
      this.put({ format: key });
    },

    /**
     * 选归属项目 —— ★ 43 轮：换了项目要顺手收掉不再成立的脑图关联。
     *   ★★ 247 轮：那条"收脑图关联"已经从**本表单里**撤掉了（表单不再有 `mindmapId` 这个键），
     *   但**规则本身仍然成立**，并且有两个地方在守它 —— 别以为它消失了：
     *     · `store.updateTodo()` 里那段"换项目 ⇒ 本地把跨项目的 `mindmapId` 置空"；
     *     · 后端 `PATCH /todos/:id` 的同一口径（候选只来自归属项目）。
     *   所以"在表单里换了个项目、保存后脑图关联没了"是**预期行为**，不是丢数据。
     *
     * ★★ 2026-09-30 修：**原来漏了 `this.sel(...)`** —— 于是「归属项目」看起来"选不动"。
     *    根因值得记一笔：其余四个单选组（紧急程度 / 项目节点 / agent / 项目色 / 格式）
     *    都是「`sel()` 翻选项 + `put()` 写值」两件事；唯独这里只做了 `put()`。
     *    而 `put()` 只改**本地副本 `data.v`**（`this.properties.values` 是页面的，
     *    不动它就不会触发 observers）⇒ 行上的黄底与右侧的勾**一格都不动**。
     *    实际值其实已经改了（提交会存对），但**界面上没有任何反馈**，
     *    用户唯一能得到的结论就是"切不了" —— 四个入口（待办新建/编辑、脑图新建/编辑）
     *    全走这一个 handler，所以一处漏改＝四个 bug 同时出现。
     *    ⚠️ 以后再加单选项，照抄别的组：`sel()` 与 `put()` 必须**成对**。
     */
    onPickProject: function (e) {
      this.applyProject(e.currentTarget.dataset.v);
    },

    /* ---------- 项目字段的第二层：副弹窗（★★ 2026-10-23）----------
     * 「选择其他项目」→ 右侧开一个**与「关联脑图」三级同款**的抽屉，
     * 里面只列没有颜色的项目；点一行即选中并自动收掉（不留「确定」，与设计定案 §4 一致）。
     * ★★ 247 轮：`.sd3` 这一档几何现在**只剩它一个实例**（脑图那层已删），
     *   所以它再也撞不到"两层副弹窗叠在一起"的问题 —— 下面那句互斥的写法随之简化。
     *
     * ⚠️ 两个入口（主列表的有颜色行 / 副弹窗的无颜色行）**必须走同一个 `applyProject`**：
     *   换项目要连带做的事不止"写值" —— 还要重算 `otherName`（那一行显示项目名还是占位文案）。
     *   任何一处各写一遍，第二次就会漏。
     */
    onOpenOtherProject: function () {
      const pid = (this.data.v && this.data.v.projectId) || '';
      this.setData({ pickProj: true, projRows: this.projRowsOf(pid) });
    },
    onCloseOtherProject: function () { this.setData({ pickProj: false }); },
    onPickOtherProject: function (e) {
      /* 「选中即回填、自动收掉」—— 收掉那一半在 `applyProject` 里统一做，这里不额外写 */
      this.applyProject(e.currentTarget.dataset.v);
    },
    /**
     * 换项目 —— **两个入口共用的唯一出口**。
     *
     * ★★ 2026-10-23：原来这段直接写在 `onPickProject` 里。本轮多出"副弹窗"这个入口，
     *   若各写一遍，"换项目要连带做的事"迟早只在一边成立
     *   （判据 G1c 守着"两个入口都走这里"）。
     * ★★ 247 轮：函数体里三样东西随"脑图字段"一起撤了 —— 收脑图关联（`mid`）、
     *   重算脑图行名（`mapName`）、重算三级标题（`mapCtx` 那个分支）。
     *   ⚠️ G1c 只关心"两个入口都走 `applyProject`"，与函数体内容无关 ⇒ 那条判据仍然有效。
     *
     * @param {string} pid 新项目 id
     */
    /**
     * 某个项目绑定的 agent id（没有绑定 ⇒ 空串）。
     *
     * ★★ 2026-10-27（用户口径）：脑图的「归属 agent」＝ **它所属项目的 agent**，
     *    所以这个值是"选项目"的**派生结果**，不是用户填的。
     * ⚠️ 数据源是 `o.projects`（`forms.projectOptions` 里一起带出来的），不再额外查 store ——
     *    表单里的选项数组必须与提交值同源，否则"选中的那行"和"存下的那个"可以不一致。
     */
    agentOfProject: function (pid) {
      if (!pid) return '';
      const hit = (this.data.o.projects || []).filter(function (x) {
        return String(x.id) === String(pid);
      })[0];
      return (hit && hit.agentId) || '';
    },

    applyProject: function (pid) {
      this.sel('projects', 'id', pid);
      /* ★★ 2026-10-27：脑图换项目 ⇒ 归属 agent 跟着换（同一次 `put` 里写，不留中间态）。
         不这么写就会出现"界面上项目已经是 A、提交的 agent 还是 B 那个"，
         而 B 可能已经和 A 毫无关系 —— 看到的 ≠ 存下的（49 轮那条纪律）。 */
      const patch = { projectId: pid };
      if (this.properties.mode === 'mindmap') patch.agentId = this.agentOfProject(pid);
      this.put(patch);
      this.setData({
        /* ★ 需求第 ④ / ⑤ 条的唯一落点：有颜色的项目 ⇒ 空串（退回「选择其他项目」）；
           无颜色的项目 ⇒ 项目名 ＋ 模板据此加 `.on`（黄底）。 */
        otherName: this.otherNameOf(this.data.o.projects, pid),
        /* ★ 副弹窗是"选一下就收"的单选层 ⇒ **两个入口都把它收掉**。
           别只让副弹窗那条路径收：主列表那一行被点到的前提是副弹窗的遮罩**已经不在**，
           它要还开着就说明状态已经不对了（真收一次比留着它更安全 —— 留着的后果是同一张
           抽屉里两处同时显示"当前值"，用户不知道该信哪个）。 */
        pickProj: false
      });
    },

    /* ★★ 247 轮：`onOpenMap` / `onCloseMap` / `onPickMindmap` 三条 handler **整组删除** ——
       它们是「关联脑图 → 右侧三级抽屉」那一层的入口，而那个字段已经不在本表单里了。
       ⚠️ 详情页的「关联 / 替换」走的是**另一条路**（`pagebase.openMapPicker()` +
          `drawer` 组件的 picker 态），与这里无关，那边一个字没动。 */
    onPickNode: function (e) {
      const v = e.currentTarget.dataset.v;
      this.sel('nodes', 'name', v);
      this.put({ node: v });
    },
    onPickAgent: function (e) {
      const v = e.currentTarget.dataset.v;
      this.sel('agents', 'id', v);
      this.put({ agentId: v });
    },
    /**
     * 选项目色 —— ★ 57 轮：被**别的项目**占用的那一行不可选（表单里已置灰）。
     * 守卫必须写在 handler 上：WXML 里没法"只给部分行摘掉 `catchtap`"，
     * 置灰只是观感，真正的闸门在这里。
     * ⚠️ `data-off` 绑的是布尔 —— 小程序把它原样传进 dataset，`true` 就是 `true`。
     */
    onPickColor: function (e) {
      const ds = e.currentTarget.dataset;
      if (ds.off) {
        wx.showToast({ title: '这个颜色已经被别的项目占用了', icon: 'none' });
        return;
      }
      const v = ds.v;
      this.sel('colors', 'key', v);
      this.put({ color: v });
    },

    /* ★★ 247 轮：`onAddImage` / `onDelImage` / `onZoomImage` 三条 handler **整组删除** ——
       待办表单不再有图片区（用户口径见文件头）。
       ⚠️ **图片这条链路没有消失，只是搬了家**：详情页「图片」卡有「＋ 添加图片 /
          从相册选择」（230 轮加）＋ 本轮新加的**逐张删除**（`mod-todo.js` 的 `onImgDel`），
          上传仍走同一个 `utils/imgpick.js`。
       ⚠️ 头像上传（`onPickAvatar`，就在上面）**没动** —— 它还是本组件唯一的 `imgpick` 用户。
       ⚠️ 顺带作废的还有 `onSubmit` 里那道「有图没传完就不许提交」的闸门：表单不再提交图片，
          那条判据永远为假。**它守的失效模式在详情页依然存在**（详情页是先上传成功才写库，
          本来就没有"写到库里的 uri 是空的"这条路径）。 */

    /* ---------- 导出（mode = export · ★ 45 轮）----------
     * 只读预览 ＋「不含图片」开关 ＋「复制到剪贴板」。
     * 预览与复制**共用 `store.copyTodoText()`** —— 改开关只重算预览；
     * 全程不改待办、不改脑图、不触发模型（FR-3.11 硬约束）。
     * ★★ 250 轮：**关联在这条待办上的闪念胶囊会自动并进来**（用户口径
     *   「胶囊信息还能合并到待办中进行导出」）—— 这一层一个字都不用改，
     *   注入点在 `store.copyTodoText()`（那里同时认识数据层与纯序列化）。
     *   ⚠️ 所以「不含图片」开关**不管胶囊**：它管的是图片，加胶囊没有开关。
     */
    onToggleNoImage: function () {
      const v = Object.assign({}, this.data.v, { noImage: !this.data.v.noImage });
      /* ★ 2026-10-13（改造清单 R06）：开关一动 ⇒ 预览文本重算 ⇒ 它**已经不是"已复制的那一份"**了
         ⇒ 必须把成功态 `copied` 收回去，否则按钮继续承诺"已复制"，而剪贴板里躺着旧内容。
         口径与 173 轮一致：`copied` 只表示**当前预览这一份**已经复制过。 */
      this.setData({
        v: v,
        expText: store.copyTodoText(v.todoId, { noImage: !!v.noImage }),
        copied: false
      });
    },
    /**
     * 一键复制 —— 带不带图片由开关定；有脑图 / 有关联胶囊时，
     * 复制的是「原文 ＋ 脑图 Markdown ＋ 闪念胶囊」（★★ 250 轮补上胶囊那一段）。
     *
     * ★★ 173 轮：成功后**按钮自己变色**（`copied` → `.sd-submit.ok`）。
     * toast 保留，但反馈不再只靠它 —— 详见 `copied` 字段上的注释。
     * ⚠️ 只在 `success` 里置位：剪贴板也可能失败（系统限制 / 权限），
     *   失败还点亮"已复制"就是**假反馈**，比没有反馈更糟。
     *
     * ★★ 278 轮：这颗键现在服务**两张抽屉** —— `export`（复制导出文本）与
     *    `enhance`（复制模型增强后的文本）。两者共用同一颗键是因为**动作完全一样**：
     *    都是"把眼前这段只读文本放进剪贴板"。差别只在取哪份文本、说哪句 toast。
     *    ⚠️ 别为 enhance 另造一颗键 —— 那会让两张抽屉的底部出现两种手感，
     *       而它们在同一屏上并排（左导出、右增强）。
     */
    onCopy: function () {
      const self = this;
      const v = this.data.v;
      const isEnh = this.data.mode === 'enhance';
      /* enhance 态还没出结果时不该能复制 —— 底部主键在这两个状态下也压暗（见 wxml 的 `.off`） */
      if (isEnh && this.data.enhState !== 'done') {
        wx.showToast({
          title: this.data.enhState === 'error' ? '增强失败了，请先重试' : '还在生成，请稍等',
          icon: 'none'
        });
        return;
      }
      const text = isEnh ? (this.data.enhText || '') : (this.data.expText || '');
      if (!text) {
        wx.showToast({ title: isEnh ? '增强结果为空' : '这条待办没有正文', icon: 'none' });
        return;
      }
      const t = store.todoById(v.todoId);
      wx.setClipboardData({
        data: text,
        success: function () {
          self.setData({ copied: true });
          wx.showToast({
            title: isEnh ? '已复制增强后的提示词'
              : ((t && t.mindmapId) ? '已复制 · 原文 ＋ 脑图 Markdown' : '已复制待办原文'),
            icon: 'none'
          });
        },
        fail: function () {
          /* 真失败要说出来 —— 否则用户拿到的是一份"以为复制了、其实没复制"的文本 */
          wx.showToast({ title: '复制失败，可长按上方文本手动选取', icon: 'none' });
        }
      });
    },

    /* ---------- 提示词增强（★ 278 轮）---------- */

    /**
     * 点「增强」。
     *
     * ★★ 组件**只发一个事件**，不自己发请求 —— 三条理由，缺一条都会引来麻烦：
     *   ① 需求写死了「**仅在用户点击时**由后台调用大模型」。请求若挂在这层，
     *      任何"抽屉重开 / 组件重建"都可能顺手再跑一次，而界面上看不出来（白烧 token）。
     *      判据 E4 守的就是这条：全工程 `api.enhancePrompt` 只有一个调用点，且不在
     *      `observers` / `attached` / `onLoad` 里。
     *   ② 组件会被 `wx:if` 建销。用户点完增强、等不及、关掉抽屉 —— 响应回来时这个
     *      实例可能已经没了，`setData` 打在一张死掉的实例上。页面一直在，接得住。
     *   ③ 抽屉几何（`formTurned` ＋ `form2`）是**页面级**状态。组件改不了自己旁边的
     *      那张抽屉 —— 它连"旁边有抽屉"这件事都不知道。
     *
     * ⚠️ 空文本不派事件：这里与 `onCopy` 是**同一条闸门**（都读 `expText`）。
     *    两条闸门一旦分叉，就会出现"预览是空的，但增强键亮着"，点下去白烧一次调用。
     */
    onEnhance: function () {
      if (!this.data.expText) {
        wx.showToast({ title: '这条待办没有正文', icon: 'none' });
        return;
      }
      this.triggerEvent('enhance', { values: deepClone(this.data.v) });
    },

    /**
     * 失败态里的「重试」——**复用同一个事件**，不另开一条路。
     *
     * ★ 为什么不给重试单独一个事件名：页面那边的处理必须**幂等**
     *   （已经在二层上就只重发请求、不重开抽屉），既然幂等，一个入口就够了。
     *   两个事件名 = 页面两份几乎相同的 handler = 总有一天只改了一份。
     */
    onEnhanceRetry: function () {
      this.triggerEvent('enhance', { values: deepClone(this.data.v) });
    },

    /* ---------- 动作 ---------- */
    /**
     * 底部「取消」。
     * ★ 审查-02 B-2（2026-10-15）：**分态** —— 不是所有取消都该问「放弃？」。
     *   · **嵌套二级**（`child`，`forms.openNested*` 开的那张）：
     *     取消的语义是「回上一层待办表单」，`forms.cancelOn` 会把父草稿原样还原
     *     ⇒ 这里问「放弃填写？」是**错的**（用户根本没放弃），直退。
     *     ★★ 2026-10-22：判据由 `offset > 0` 换成 `child` —— L2 位（列表抽屉上叠出来的
     *        那张）同样是 `offset > 0`，但它的取消是真丢草稿，必须问。见 `onCancel`。
     *   · **一级位 ＋ 空表单**：直退。两下点完的事，多一个弹窗只是啰嗦。
     *   · **一级位 ＋ 写过东西**：问一句，防手滑丢掉刚写的正文/选项。
     *   · **`mode='export'`**：它是**只读预览**（底键是「复制到剪贴板」），
     *     里面只有一颗「不含图片」开关 —— 切一下开关再关预览也要「放弃？」就很怪，直退。
     */
    onCancel: function () {
      /* ★★ 2026-10-22（审查 P1-07 第二处）：判据由 `offset > 0` 改成 **`child`**。
         ── 改前为什么错：`offset > 0` 有两种来源，语义完全不同 ——
            · 嵌套二级（`forms.openNested*` 开的）：取消 ＝ 回上一层，草稿还在 ⇒ 不该问；
            · **从列表抽屉点「编辑」落到的 L2 位**：取消 ＝ 真的关掉这张表单 ⇒
              写了半天的正文**无提示消失**（审查报告点名的"偏移表单跳过 dirty 提醒"）。
           两者改前共用 `offset > 0` 这一条豁免，于是第二种被第一种连累。
         ── 现在：`child` 只由 `forms` 给二级表单置真（见 `closed().child`），
            其余一律走"空表单直退 / 写过东西问一句"。
         ⚠️ `mode='export'` 仍然直退：它是只读预览（底键是「复制到剪贴板」），
            里面只有一颗「不含图片」开关，切一下开关再关预览要"放弃？"就很怪。
         ★ 278 轮补 `mode='enhance'`，同一个道理：那张也是**只读结果**（没有输入框，
            用户没东西可"放弃"）。它通常还带 `child=true`（走上面那条就退了），
            这里再列一次是**兜底** —— 万一哪天它被当成一级表单打开，也不该问"放弃填写？"。 */
      if (this.properties.child
        || this.properties.mode === 'export'
        || this.properties.mode === 'enhance'
        || !this.isDirty()) {
        this.triggerEvent('cancel');
        return;
      }
      const self = this;
      wx.showModal({
        title: '放弃填写？',
        content: '表单里已经写了一些内容，取消后不会保留。',
        confirmText: '放弃',
        cancelText: '继续填写',
        /* ★ 危险键的确认色一律走 `store.danger()`（P2-20 那条口径：全工程五处同源） */
        confirmColor: store.danger(),
        success: function (r) { if (r.confirm) self.triggerEvent('cancel'); }
      });
    },
    /**
     * 草稿是否已偏离「打开时那一份」。
     * ★ 审查-02 B-2：`_initV` 由 observer 在**打开抽屉**那次 `setData` 时记下（见那边注释），
     *   这里是唯一的读点。`JSON.stringify` 直接比 —— `v` 是纯数据（无函数 / 无 Date），
     *   且键顺序由 `forms.build()` 定死、`put()` 只改值不增删键 ⇒ 顺序稳定。
     * ⚠️ 比较**不做深挖**。★ 247 轮：原来这里举的反例是"`imageRows()` 算出来的 `src`
     *   两边一致，不会误报脏"—— 图片字段删掉之后它不再是例子，但规矩不变：
     *   **任何派生字段只要会进 `v`，就必须在记 `_initV` 之前算好**（见 observer 那段）。
     */
    isDirty: function () {
      let a, b;
      try {
        a = JSON.stringify(this.data.v == null ? null : this.data.v);
        b = JSON.stringify(this._initV == null ? null : this._initV);
      } catch (e) {
        /* 序列化失败（理论上不会）⇒ 当作"脏"，宁可多问一句，也不默默丢东西 */
        return true;
      }
      return a !== b;
    },
    /** 底部「删除」（仅编辑态出现）—— 具体确认与写库交给页面 */
    onDelete: function () { this.triggerEvent('delete', { id: this.properties.editId }); },
    /** 带出当前草稿 —— 建完项目后要回到这份草稿上，不能丢用户已经填的内容 */
    onNewProject: function () {
      this.triggerEvent('newproject', { values: deepClone(this.data.v) });
    },
    /**
     * 「＋ 新建脑图」（★ 49 轮）—— 与「＋ 新建项目」**同一条嵌套机制**：
     * 同样把当前草稿带出去（页面据此在右侧开脑图创建的主弹窗，建完把草稿还原回来）。
     * 页面收到后会用 `v.projectId` 预填脑图表单的「所属项目」。
     */
    onNewMindmap: function () {
      this.triggerEvent('newmindmap', { values: deepClone(this.data.v) });
    },
    onSubmit: function () {
      /* ★ 审查-02 B-1（2026-10-15）：**防重闸**。
         ── 为什么要有：提交是**同步**的（`forms.submitOn()` 当场返回 id，页面紧接着收抽屉），
            所以"连点两次建两条"的窗口只存在于**同一帧内的双击**（真机上很常见）。
         ── 为什么用 `setTimeout(…, 0)` 释放而不是"关抽屉才释放"：闸必须**自愈**。
            万一提交路径抛异常、抽屉没关，用户就被锁在"点不动"上；
            下一帧自动放开 ⇒ 最坏退回改前的行为，绝不会更糟。 */
      if (this._submitting) return;
      /* ★★ 247 轮：这里原来还有一道「附件闸门」—— 有图没传完就不许提交（审查-02 P1-06）。
         表单不再提交图片（也没有 `v.images` 这个键了）⇒ 那三十行连同 `badImgs` 一起删。
         ⚠️ 它守的那条失效模式（"界面上有图、库里 uri 是空的"）**没有跟着消失**，只是换了地方：
            详情页的加图是**上传成功才写库**（`mod-todo.onAddImage` 的成功回调里才 `applyImages`），
            结构上就没有"空 uri 落库"这一档。将来若给详情页加"先占位后回填"的乐观写法，
            就必须把同样的终态判据搬过去。
         ⚠️ 别把它当"多余的一道"删了就没记录 —— 这是本轮唯一一处**主动作废的守卫**，
            作废的理由是"对象不存在了"，不是"它不重要"。 */
      if (!this.data.canSubmit) {
        const mode = this.properties.mode;
        const v = this.data.v || {};
        let title;
        if (mode === 'token') {
          /* ★ 2026-10-13（改造清单 R07）：Token 是**厂商 ＋ Key** 两个必填。
             厂商有默认值（`vendorOptions` 取清单第一项）⇒ 新建时按不下去几乎总是**缺 Key**，
             旧文案却一律说「模型厂商名称不能为空」—— 指的**不是**真正缺的那个字段。按字段分档。 */
          title = (!v.vendor || !String(v.vendor).trim()) ? '请选择模型厂商' : '请输入 API Key';
        } else {
          const t = {
            profile: '用户名不能为空',
            todo: '先写点内容吧', project: '项目名称不能为空',
            mindmap: '名称与所属项目都要填', agent: 'agent 名称不能为空'
          };
          title = t[mode] || '还有必填项没填';
        }
        wx.showToast({ title: title, icon: 'none' });
        return;
      }
      /* ★★ 2026-10-27（全量检查 F12）· **头像还在上传就不许保存**。
         ── 病根：选完图立刻 `put({avatar: 本地临时路径})`，上传是异步的。
            这时候点保存，`store.updateMe()` 拿到的就是 `wxfile://…` 这种临时路径 ——
            它既存不进库、也不会自己好（数据层对临时路径有防护，结果就是"头像没换成"）。
         ── 现在：上传在飞 ⇒ 明说一句、不提交。上传失败会放开这道闸（见 `onPickAvatar`），
            不会把表单永久锁死。
         ⚠️ 只管 `profile`：别的表单没有头像这一项。 */
      if (this.properties.mode === 'profile' && this._avUp) {
        wx.showToast({ title: '头像还在上传，稍等一下', icon: 'none' });
        return;
      }
      /* ★ 审查-02 B-1：合闸（下一帧自动放开，见方法头注释） */
      this._submitting = true;
      const self = this;
      setTimeout(function () { self._submitting = false; }, 0);
      this.triggerEvent('submit', { values: deepClone(this.data.v) });
    }
  }
});
