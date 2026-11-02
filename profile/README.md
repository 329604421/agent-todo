<!--
  个人主页 README —— 用于仓库 329604421/329604421（仓库名必须与用户名一致，GitHub 才会渲染成主页）。
  图片走官网绝对地址；若域名变更，只需替换下方 img 链接。
-->

### 杜春生 · 产品经理 / 独立开发者

我在做一件事：**把「人怎么跟 Agent 交接工作」这件事做成可以日常用的工具。**

不是让 AI 多写几行代码，而是解决交接前的那段混乱 —— 现场的需求散在口头、聊天记录和截图里，方案只存在脑子里，交给 Agent 的时候只剩一句"帮我改一下"。

---

## 现在在做什么

### Agent-ToDo · 为前沿部署工程师做的多项目工作台

服务对象是 **FDE（Forward Deployed Engineer，前沿部署工程师）**：人在客户现场，需求来自不同角色，几条业务线同时推进。

产品只有一条主线 —— **记下来 → 选项目 →（可选）挂脑图 → 复制走人**。

- **手机只做接住**：整屏闪念胶囊，底部「说」「写」。现场不要求你当场归类
- **平板做整理**：胶囊转待办、挂项目、标紧急度；脑图拆需求、决策与验收口径
- **PC 端做派活**：导出 Markdown，带上待办正文、图片链接、脑图层级与客户原话，整段交给 Agent

关键判断是**不替人做优先级**，只把判断需要的上下文留在原处。切换回来时不用重建一次现场。

<p>
<a href="https://todo.memorymap.cn"><img alt="Agent-ToDo" src="https://img.shields.io/badge/Agent--ToDo-多项目工作台-111111?style=flat-square"></a>
<a href="https://github.com/329604421/agent-todo"><img alt="repo" src="https://img.shields.io/badge/repo-agent--todo-2D3748?style=flat-square"></a>
<a href="https://todo.memorymap.cn/manual.html"><img alt="manual" src="https://img.shields.io/badge/手册-十章节-07C160?style=flat-square"></a>
</p>

<img src="https://todo.memorymap.cn/img/pad-01-overview.jpg" width="640" alt="Agent-ToDo 概览页">

---

## 两个在跑的小项目

| 项目 | 一句话 | 站点 |
|---|---|---|
| **好运夹 goodluck+** | 双色球 / 大乐透的购彩账本：拍照或扫码录入、自动兑奖、热力图回看 | [lottery.memorymap.cn](https://lottery.memorymap.cn) |
| **摇头晃脑** | Rokid Glasses 上的头控游戏合集，用头部姿态当唯一输入 | [shake.memorymap.cn](https://shake.memorymap.cn) |

这两个和 Agent-ToDo 共用一套方法：**先做简单方案跑起来，再逐轮打磨边界**。

---

## 技术方向

```
微信小程序（原生 WXML/WXSS/JS）   ── 三端同源：手机 / 平板 / PC
NestJS · Prisma · MySQL           ── 单机自托管，按客户独立部署
LLM 工程化                        ── 提示词增强、语义转脑图、结构化输出校验
头控 AR（Rokid AIUI）             ── 单绿透明显示，IMU 姿态映射成光标
AI 辅助研发流程                    ── 需求文档 → 判据 → 变异测试 → 真机走查
```

我没有把自己限定在某一层：一个功能从需求文本、视觉令牌、交互细节、接口契约到部署脚本，通常是我一个人从头走到尾。所以更在意**边界情况**和**不会报错的错**。

---

## 几条做事的原则

**上下文比记录重要。** 待办列表到处都是，缺的是"上次停在哪、为什么这样定"。所以每个输入都要有固定位置。

**独立部署不是洁癖。** 每个客户一套实例与数据库 —— 软件功能背后的变更需求才是企业真正的资产，共用一套等于把资产混在一起。

**不静默降级。** 语音识别没配就报"未配置"，别返回空串让人以为识别不准；拉不到后端就清空成真的空，别拿演示数据冒充真数据。界面上的假话比报错更难查。

**验证要能证伪。** 编译通过不等于渲染正确，判据自己也会坏。所以每条新判据都要配一次"它确实会红"的反向验证。

**文案是界面的一部分。** 句末不加句号、同一个量只有一种写法、中文不用 `ch` 量宽度 —— 这些不是排版偏好，是"用户读到什么"本身。

---

## 最近

- Agent-ToDo 官网改成产品首页 + 独立手册双页，36 张真实界面截图逐屏讲清每个按钮
- 语义转脑图上线：一段现场记录直接生成可编辑的脑图结构
- 在做：MCP 连接服务（让本地 Agent 按项目读取待办）、客户侧反馈入口

---

## 联系

- 站点：[todo.memorymap.cn](https://todo.memorymap.cn) · [memorymap.cn](https://memorymap.cn)
- 想聊 Agent 工作流、FDE 场景，或需要某一版的代码，扫码私信

<img src="https://todo.memorymap.cn/img/official-account-qr.jpg" width="132" alt="公众号二维码">
