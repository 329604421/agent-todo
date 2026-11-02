# Agent-ToDo · 微信小程序前端

原生框架（WXML / WXSS / JS），**没有第三方 UI 库**，也没有 `miniprogram_npm` 依赖。所有组件、图标、主题令牌都在仓库里。

- 页面只有一个：`pages/shell/shell`。模块切换靠组件显隐，不靠路由栈
- 同一份代码跑三端：手机（只做接住）、平板、PC 端小程序
- 深色模式是跟随系统的，`page{}` 与 `.theme-dark` 两支令牌必须齐全

---

## 目录

```
miniprogram/
├── app.js                 启动：主题 → stage（形态）→ store.boot()
├── app.json               单页面 + 自定义导航 + 深色模式 + 录音授权说明
├── app.wxss               全局样式：设计令牌 + 三档骨架 + 通用组件样式
├── theme.json             导航栏与页面底色的浅/深两支（给宿主用）
├── project.config.json    工程配置（appid 为 touristappid 占位）
├── sitemap.json
│
├── pages/shell/           壳层：导航（手机底栏 / 平板两端 / PC 侧栏）+ 模块容器
│
├── components/
│   ├── mod-overview/      概览：活跃热力 + 跨项目待办统计
│   ├── mod-project/       项目：列表 / 筛选 / 详情
│   ├── mod-todo/          待办：列表 / 详情 / 导出
│   ├── mod-mindmap/       脑图：列表 / 画布 / 节点编辑 / 语音编辑（mm-canvas.wxss）
│   ├── mod-mine/          我的：资料 / Agent 配额 / Token API / 应用提示
│   ├── capsule/           闪念胶囊流（语音、文字、截图、左滑、长按导出）
│   ├── capsule-attach/    待办里挂载的胶囊片段
│   ├── todo-card/         待办卡片
│   ├── bottom-nav/ nav-rail/  手机底栏 / PC 侧栏
│   ├── brand-head/        顶部品牌条
│   ├── drawer/ form-drawer/   侧抽屉与表单抽屉
│   ├── splash/            开屏
│   └── icon/              图标组件（浅/深两套 SVG，按 tone 取色）
│
├── utils/
│   ├── api.js             唯一网络出口：token 注入、1001 静默重登、超时分类
│   ├── store.js           唯一内存状态 + 写台账（乐观更新 → 请求 → 失败回滚）
│   ├── mock.js            种子数据（走查 / 出图态用）
│   ├── stage.js           形态判定（手机 / 平板 / PC）与屏幕旋转
│   ├── theme.js           主题服务：图标资产、SVG、Canvas 这些 WXSS 表达不了的调色
│   ├── mindmap-core.js    脑图布局与树操作（父子关系、拖动改挂、键盘导航）
│   ├── forms.js drawers.js nav.js pagebase.js formats.js markdown.js imgpick.js vendors.js
│   └── …
└── assets/                图标（-b 为深色选中态，d- 为深色版）、品牌图、脑图连线
```

---

## 数据流

```
wx.login ──► POST /auth/login ──► token（storage）
                                     │
        GET /sync ───────────────────┘  一次拉全量：项目 / 待办 / 脑图 / 胶囊 / 活动
            │
        store.hydrate()  ──►  modules 渲染
            │
        用户操作 ──► store.xxx()  ──► 先改内存（乐观）──► 请求 ──► 失败回滚 + toast
```

三条约定：

1. **`utils/api.js` 是唯一网络出口**。其它文件一律不许直接 `wx.request`
2. **`utils/store.js` 是唯一状态源**。写操作都要过"写台账"，否则并发请求回包顺序会把界面改乱
3. **不在 api 层拼图片 URL**。列表给的是相对 `uri`，要看图时显式调用 `api.fileUrl()`

---

## 两个开关（不是一件事）

`utils/api.js` 顶部：

| 开关 | 默认 | 作用 |
|---|:--:|---|
| `_mock` | `false` | `true` = 全程走 `utils/mock.js`，**一个请求都不发、也不登录**。适合出图与走查 |
| `_fallback` | `false` | `true` = 拉不到后端时保留内存里的种子数据（"停掉后端也能出图"）。默认关闭：连不上就清空成真的空，并把成因说清 |

默认档守的是一句产品口径：**界面上只可能出现数据库里的数据**。拉不到就空着，不许拿演示数据冒充真数据 —— 否则"库是空的"和"根本没连上"在界面上长得一模一样。

---

## 本地开发

```bash
# 1. 导入
微信开发者工具 → 导入项目 → 选择本目录 → AppID 选「测试号」

# 2. 配后端地址
编辑 utils/api.js：
  const BASE = 'https://api.example.com/api/v1';
```

不连后端只想看界面：把 `let _mock = false` 改成 `true`。

连本机后端：

```js
// utils/api.js
const HOST_DEVICE = '192.168.1.100:3000';   // 你开发机的局域网 IP（ipconfig 看 WLAN）
```

同时 `server/.env` 里 `HOST=0.0.0.0`、`FILE_BASE_URL=http://192.168.1.100:3000` —— 后者漏了的话，上传的图在小程序里全是裂的。

真机 / 正式域名：微信后台要分别加白 `request`、`uploadFile`、`downloadFile`，二级域名不支持泛域名，必须精确添加。

---

## 改样式的几个坑（都是踩过的）

- **原生控件是替换元素**：`input` / `textarea` 不吃祖先的 `scale`，也不认 `box-sizing: border-box`。宽必须行内给 px，高度＝总高 − 20，`padding` / `border` 置 0
- **`animation: … both` 会把 `transform` 永久留在元素上**，子孙里有原生控件就画偏；编辑态一律 `animation: none`
- **`overflow: hidden` 的裁剪线是硬边界**：外扩阴影、呼吸光晕要有 ≥ 半径 + 1 的簇内距，且这段内距要算进容器宽度
- **`wx:else` 只认紧挨着的前一颗 `wx:if`**，中间插一个元素就静默改判
- **中文段落的宽度上限别用 `ch`**：1 个汉字约 2ch，`46ch` 在 12.8px 下只有 ~294px。靠宽度折行的文案末行必然出现孤字，定稿文案用 `<br>` 钉成短行更稳
- **底部留白 ≠ `padding-bottom`**：滚动容器里内容一溢出，最后一张卡会压在自己的内距上。用末尾占位块

## 验证

编译通过 ≠ 渲染正确。改完 `wxml` / `wxss` 请在开发者工具里真编译一遍（CLI 的编译命令有缓存假绿的问题），并在真机或模拟器上看实际效果；窄屏溢出要看 `clientWidth` 与 `scrollWidth` 是否相等，不要凭截图边缘判断。
