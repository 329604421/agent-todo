# Agent-ToDo · 后端服务

NestJS 10 + Prisma 5 + MySQL 8。单进程跑在 nginx 后面，对外只暴露 443。

```
nginx ──► 127.0.0.1:3000  NestJS ──┬──► MySQL 8
        └── /files/ → alias 直出   ├──► 腾讯云一句话识别（语音）
                                   └──► 火山方舟（信息增强 / 语义转脑图）
```

---

## 目录

```
server/
├── src/
│   ├── main.ts              全局前缀 api/v1、统一响应、静态图片（本机自测用）
│   ├── app.module.ts        模块装配 + JWT 全局注册
│   │
│   ├── auth/                POST /auth/login（wx.login → openid → JWT）
│   ├── me/                  个人资料读写
│   ├── sync/                GET /sync —— 一次拉全量，前端的启动依赖它
│   ├── projects/            项目 CRUD、归档、详情聚合
│   ├── todos/               待办 CRUD、完成/重开、软删除与恢复、挂载胶囊
│   ├── mindmaps/            脑图 CRUD、整棵树读写的幂等落库、AI 生成状态
│   ├── capsules/            胶囊：单条转待办、多选删除、语义转脑图
│   ├── agents/              Agent 套餐与配额
│   ├── token-keys/          模型厂家 API key（加密入库，只回掩码）
│   ├── files/               图片上传（类型嗅探 + 尺寸上限）
│   ├── asr/                 语音识别（按人日限流）
│   ├── ai/                  ai.service 提示词增强 · mindmap-ai 语义转脑图 · link-guard 链接白名单
│   ├── admin/               白名单与待批列表（X-Admin-Token）
│   ├── health/              GET /health
│   └── common/
│       ├── api-exception.ts codes.ts filters/ interceptors/   统一错误与响应
│       ├── prisma.service.ts  全局 Prisma 连接
│       ├── time.ts tree.ts shape.ts activity.ts money.ts      时间/树/出入参/活跃度
│       ├── secrets.ts         AES-256-GCM 信封加密
│       ├── upload.ts          上传目录解析与校验
│       └── auth/              JWT 守卫、管理员守卫、当前用户装饰器
│
├── prisma/
│   ├── schema.prisma        12 张表（见 docs/data-model.md）
│   ├── migrations/          10 个迁移，入库，部署时 migrate deploy
│   ├── seed.ts              种子脚本
│   └── seed-data.json       演示数据（由前端 mock.js 导出的快照）
│
├── nginx/agenttodo.conf     站点 + 反代 + 静态 + 限流模板
├── scripts/backup.sh        数据库与图片的每日/每周备份
├── scripts/deploy.sh        一键发布（零交互，适配无 SSH 的运维通道）
├── ecosystem.config.js      PM2 进程配置（不含任何密钥）
└── .env.example             环境变量模板（唯一入库的配置样本）
```

---

## 本地起服务

```bash
npm install
cp .env.example .env      # 填 DATABASE_URL / JWT_SECRET / WX_*
npx prisma migrate deploy
npx prisma generate
npm run build
npm run seed              # 可选
npm start
```

`npm start` 跑的是 `dist/main.js`，所以**必须先 build**。开发时用 `npm run build:watch` 另开一个窗口。

健康检查：`curl http://127.0.0.1:3000/api/v1/health`

本机不想走微信登录时，`.env` 里设 `NODE_ENV=development` 与 `DEV_OPENID=seed-demo-openid`，`POST /auth/login` 会直接换 token。**生产环境 `DEV_OPENID` 必须留空**。

---

## 接口约定

所有响应统一外形，前端只判 `code`：

```json
{ "code": 0, "message": "ok", "data": { } }
```

- 成功：`code = 0`
- 业务错误：`code != 0`，`message` 是中文提示（错误码只进日志，不到前端堆栈）
- `1001`：token 失效，前端会 `wx.login` 重试一次

完整端点表见 [`../docs/api.md`](../docs/api.md)。

---

## 数据库

```bash
npx prisma migrate deploy   # 生产：只应用已存在的迁移，不生成新迁移
npx prisma migrate dev      # 开发：改完 schema 生成迁移
npx prisma studio           # 本地看数据（模型 key 列存的是密文，看不到明文）
```

三条来自真实事故的约束：

- **时间字段一律 `String('YYYY-MM-DD HH:mm:ss')`**。MySQL 的 `DateTime` + Prisma 按 UTC 解释，北京 0:00–8:00 的写入会整体错一天，而活跃热力正是按日聚合的
- **Prisma 的 `String` 默认映射 `VARCHAR(191)`** ⇒ DTO 上的 `@MaxLength` 不能超过列宽；`TEXT` 列不能带 `DEFAULT`
- **表名统一带 `agenttodo_` 前缀**，同实例上若有别的库/表不会串

---

## 发布

```bash
# 服务器上（一条命令、零交互）
/srv/agenttodo/deploy.sh

# 或手动，顺序不能变
mysqldump ... > backup.sql          # 1. 备份
npx prisma migrate deploy           # 2. 迁移
npx prisma generate                 # 3. 客户端
pm2 reload agenttodo                # 4. 平滑重启
curl -s localhost:3000/api/v1/health # 5. 健康检查
```

`deploy.sh` 里两条纪律：**先迁移、后发代码**（迁移必须是向后兼容的加字段，破坏性变更拆两次发布）；**发布前先 dump 一次**（成本 1 秒，收益是一次可回滚）。

`scripts/backup.sh` 做 L1 数据库（每日、留 7 份）与 L2 图片（每周、留 3 份）；L3 异地备份脚本做不了，需要自己挂对象存储或 rsync —— 那才是真正算数的一环。

---

## 安全底线

| 项 | 做法 |
|---|---|
| 监听地址 | `HOST=127.0.0.1`，只有 nginx 能访问；3306 与 3000 都不对外开放 |
| 密钥 | 全部走 `.env`（权限 600），`ecosystem.config.js` 里一个都不写 |
| 模型 key | `secrets.ts` 用 AES-256-GCM 加密入库，出参只有 `sk-****wxyz` |
| 上传 | 类型嗅探（不信任扩展名）+ 大小上限；`/files/` 这个 location 不配任何 CGI |
| 鉴权 | openid 白名单 + JWT；管理接口另需 `X-Admin-Token`，留空即整体 404 |
| 限流 | nginx 层对 `/auth/login` 与 `/asr` 单独限速，应用层再按人日限流 |
