# 部署

单机形态：nginx 终止 TLS 并直出静态与图片，Node 只监听回环，MySQL 只监听本机。

## 目录约定

```
/srv/agenttodo/
├── app/            代码 + dist + .env（权限 600）+ ecosystem.config.js
├── site/           静态站（官网双页 + img）
├── logs/           out.log / err.log / backup.log
├── backup/         db-YYYY-MM-DD.sql.gz · uploads-YYYY-MM-DD.tar.gz
└── verify/         第三方平台校验文件（MP_verify_*.txt 之类）
/data/uploads/     图片真身 —— 与 .env 的 UPLOAD_DIR、nginx 的 alias 三处必须逐字一致
```

`ecosystem.config.js` 里的 `cwd` 必须是**绝对路径**。`@nestjs/config` 按 `process.cwd()` 找 `.env`，写错了症状是"所有配置都取了默认值"，其中最危险的是 `JWT_SECRET` 落到开发用的默认串上。

## 首次部署

### 1. 系统

```bash
# Node 20 + MySQL 8 + nginx + pm2
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
npm i -g pm2
```

### 2. 数据库

```sql
CREATE DATABASE agenttodo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'agenttodo'@'localhost' IDENTIFIED BY '<强口令>';
GRANT ALL PRIVILEGES ON agenttodo.* TO 'agenttodo'@'localhost';
```

> 口令里若有 `@ : / ? #`，写进 `DATABASE_URL` 时必须 URL 编码，否则连接串会被解析错，报出来是"找不到主机"。

### 3. 代码与环境变量

```bash
cd /srv/agenttodo/app
npm ci
cp .env.example .env && chmod 600 .env
vi .env      # 填 DATABASE_URL / JWT_SECRET / WX_APPID / WX_SECRET / FILE_BASE_URL
```

密钥现生成，别复用示例：

```bash
openssl rand -hex 32     # JWT_SECRET
openssl rand -hex 32     # TOKEN_KEY_ENC_SECRET
openssl rand -hex 24     # ADMIN_TOKEN
```

云厂商与模型厂商的 key 用**子账号 + 最小权限**（例如只授 `asr:SentenceRecognition`）。主账号密钥泄露等于整个云账号沦陷。

### 4. 建表与构建

```bash
npx prisma migrate deploy
npx prisma generate
npm run build
npm run seed          # 可选，演示数据
```

### 5. 进程

```bash
pm2 start ecosystem.config.js --env production
pm2 save && pm2 startup      # 两句都要，否则重启后不会自动拉起
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 14
pm2 set pm2-logrotate:compress true
```

日志不轮转会撑满磁盘 —— 这几个文件是只增不减的。

### 6. nginx

```bash
cp nginx/agenttodo.conf /etc/nginx/conf.d/
# 把 todo.example.com 换成你的域名，确认 alias 与 UPLOAD_DIR 一致
nginx -t && nginx -s reload
```

配置里有四段值得注意：

| 段 | 作用 |
|---|---|
| `/.well-known/acme-challenge/` | 证书续期（webroot 模式）要走得到 |
| `MP_verify_*.txt` | 第三方平台校验文件，不能落到 SPA 兜底里 |
| `location /files/` | `alias` 直出图片。**结尾斜杠不能少**，少了路径会错位 |
| `location = /api/v1/health` | 单独放行，不限流，给拨测用 |

`/auth/login` 与 `/asr` 在 nginx 层单独限速，应用层再按人日限流。

### 7. 证书

```bash
certbot certonly --webroot -w /var/www/certbot -d todo.example.com
```

### 8. 微信后台

`request`、`uploadFile`、`downloadFile` 三类合法域名各加一次，**二级域名要精确添加，不支持泛域名**。漏了的表现是真机全线报"不在以下 request 合法域名列表中"。

## 日常发布

```bash
/srv/agenttodo/deploy.sh          # 一条命令、零交互
```

脚本顺序固定：

```
备份 → prisma migrate deploy → prisma generate → npm run build → pm2 reload → 健康检查
```

四条纪律：

1. **先迁移、后发代码**。迁移必须是向后兼容的加字段，这样老代码仍能跑；改名/删列要拆两次发布（第一次只发兼容代码）
2. **发布前先手动 dump 一次**，成本 1 秒，收益是一次可回滚
3. **`pm2 reload` 而不是 `restart`**，reload 平滑，不打断在途请求
4. **`dist` 与 `src` 必须一起更新**。只推 `dist` 的话下一个 `npm run build` 会把改动覆盖回去

## 备份与回滚

```bash
/srv/agenttodo/backup.sh          # 按星期自动决定要不要带图片
/srv/agenttodo/backup.sh --all    # 强制数据库 + 图片
```

| 层 | 内容 | 频率 | 保留 |
|---|---|---|---|
| L1 | `mysqldump --single-transaction` | 每日 | 7 份 |
| L2 | `tar /data/uploads` | 每周 | 3 份 |
| L3 | 异地（对象存储 / rsync） | — | 脚本做不了，**必须自己补** |

L3 才是真正算数的备份：同机备份在磁盘坏掉、误删实例、欠费停机这几种情况下一起消失。

回滚代码：

```bash
pm2 stop agenttodo
git checkout <上一个可用提交>     # 或解压上一版压缩包
npm ci && npm run build
pm2 start ecosystem.config.js --env production
```

**回滚点只认压缩包**，不要只依赖"服务器上还留着上一版目录"—— 那个目录经常在下一次清理时被删掉。发版前先 `tar tzf` + `cmp` 证明包能还原，再动手清理。

## 静态站发版

官网是纯静态的，与后端解耦。规则是"归档 → 替换 → 验收 → 清理"四段分离：

1. 先把当前 `site/` 打包归档，记下 sha256
2. 上传新文件（大文件按块传，单个文件过大时整包一次传会超限）
3. 验收：文件数 + 逐字节比对 + 首页与手册可访问 + API 仍正常
4. 清理旧目录，然后跑一次只读审计（残留、nginx 配置、进程、磁盘）

验收判据必须落在**服务器上的字节**（块数 + sha256），不能挂在"本机临时文件删成功"上。

## 排障

| 症状 | 多半是 | 处理 |
|---|---|---|
| 所有配置项都取了默认值 | `cwd` 写错，找不到 `.env` | 检查 `ecosystem.config.js` 的 `cwd` 是否为绝对路径 |
| 图片全裂 | `FILE_BASE_URL` 与 `UPLOAD_DIR` / nginx `alias` 不一致 | 三处核对 |
| 真机报"不在合法域名列表" | 微信后台漏配或用了泛域名 | 精确添加三个域名 |
| 热力图整体错一天 | 时间字段被改成 `DateTime`，或连接串缺 `timezone` | 恢复 string 字段与 `+08:00` |
| 登录 500，日志里有 `code2session` | AppSecret 错、服务器出网被限 | 用 `curl` 直连微信接口验证 |
| `/files/` 返回 404 但文件在 | `alias` 结尾少了斜杠 | 补齐斜杠 |
| 进程反复重启 | `max_memory_restart` 触发，可能内存泄漏 | 看 `err.log`，先调阈值止损再查 |
| 磁盘满 | 日志或备份没轮转 | `pm2-logrotate` + 备份保留策略 |

日志位置：`/srv/agenttodo/logs/out.log` 与 `err.log`。确认新版本真的在跑，看启动日志里的路由映射行（`RouterExplorer Mapped ...`）—— 光看进程 `online` 不够。
