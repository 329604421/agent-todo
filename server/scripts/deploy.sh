#!/usr/bin/env bash
#
# Agent ToDo · 迭代发布脚本（技术文档 §10.4）
#
# ★ 为什么要写成"一条命令、零交互"：本项目的服务器**没有 SSH**，
#   运维走腾讯云 TAT（自动化助手），而 TAT 不能交互 ⇒
#   任何"要不要继续？[y/N]"都会让发布卡死在那里（还得等人去小程序里点）。
#
# 用法（服务器上）：
#   /srv/agenttodo/deploy.sh              # 标准发布
#   /srv/agenttodo/deploy.sh --no-pull    # 代码已经用别的方式放上去了
#   /srv/agenttodo/deploy.sh --skip-build # 只重载进程（改了 .env 时用）
#
# 顺序（§10.4 两条纪律）：
#   ① **先迁移、后发代码** —— 迁移必须是"向后兼容的加字段"，这样老代码仍能跑；
#      破坏性变更（改名 / 删列）要拆成两次发布，第一次只发兼容代码。
#   ② **发布前先手动 dump 一次** —— 成本 1 秒，收益是一次可回滚。
#
# ⚠️ 本文件必须是 **LF 换行**（CRLF 会报 `$'\r': command not found`）。
#
set -euo pipefail

APP_DIR="${APP_DIR:-/srv/agenttodo/app}"
LOG_DIR="${LOG_DIR:-/srv/agenttodo/logs}"
PM2_NAME="${PM2_NAME:-agenttodo}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/v1/health}"

DO_PULL=1
DO_BUILD=1
for a in "$@"; do
  case "$a" in
    --no-pull)    DO_PULL=0 ;;
    --skip-build) DO_BUILD=0 ;;
    *) echo "未知参数：$a" >&2; exit 2 ;;
  esac
done

cd "$APP_DIR"
mkdir -p "$LOG_DIR"

echo "════════ [$(date '+%F %T')] Agent ToDo 发布开始 ════════"

# ---------------------------------------------------------------- 0. 发布前备份
# ★ 失败**不中断**发布，但一定要喊出来 —— "这次没有可回滚的备份"是个需要人知道的事实
if [ -x /srv/agenttodo/backup.sh ]; then
  echo "── 0/6 发布前 dump"
  /srv/agenttodo/backup.sh --db || echo "⚠️ 备份失败，这次发布**没有可回滚的 dump**，继续但请留意"
else
  echo "── 0/6 跳过备份：/srv/agenttodo/backup.sh 不存在或不可执行"
fi

# ---------------------------------------------------------------- 1. 拉代码
if [ "$DO_PULL" = "1" ]; then
  echo "── 1/6 git pull"
  git rev-parse --short HEAD
  git pull --ff-only
  git rev-parse --short HEAD
else
  echo "── 1/6 跳过 git pull（--no-pull）"
fi

# ---------------------------------------------------------------- 2. 装依赖
# ★ `npm ci` 而不是 `npm install`：它严格按 lock 文件装，
#   不会因为"顺手升一个小版本"导致线上和本机行为不一致。
#   ⚠️ 若用 npmmirror 的 registry 加速，注意 .npmrc 是否被 git 跟踪（本项目是）。
echo "── 2/6 npm ci"
npm ci

# ---------------------------------------------------------------- 3. 生成 Prisma Client
# ★ 必须**在 build 之前** —— build 要编译出引用 @prisma/client 的 dist，
#   而 prisma generate 的输出是 node_modules/.prisma/client
echo "── 3/6 prisma generate"
npx prisma generate

# ---------------------------------------------------------------- 4. 数据库迁移
# ★★ `migrate deploy` 而**不是** `migrate dev`：
#   - deploy：只应用 migrations/ 里已有的迁移，不改 schema、不生成新迁移、不问问题
#   - dev：可能 reset 数据库（会**清空数据**）—— 在生产上跑等于自杀
echo "── 4/6 prisma migrate deploy"
npx prisma migrate deploy

# ---------------------------------------------------------------- 5. 编译
if [ "$DO_BUILD" = "1" ]; then
  echo "── 5/6 tsc build"
  npm run build
else
  echo "── 5/6 跳过编译（--skip-build）"
fi

# ---------------------------------------------------------------- 6. 重载 ＋ 自检
echo "── 6/6 pm2 reload"
# 单实例 fork 模式下 reload ≈ restart；用 reload 是为了"哪天改成多实例了也不用改脚本"
pm2 reload "$PM2_NAME" --update-env

echo "── 自检：等待进程起来"
OK=0
for i in $(seq 1 15); do
  sleep 1
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    OK=1
    break
  fi
done

if [ "$OK" = "1" ]; then
  echo "── GET /health →"
  curl -fsS "$HEALTH_URL" || true
  echo
  echo "════════ [$(date '+%F %T')] 发布完成 ✔ ════════"
else
  echo "✘ 健康检查连续 15 秒没通过 —— 发布**很可能失败**了。排查顺序：" >&2
  echo "   1) pm2 logs $PM2_NAME --lines 80 --nostream" >&2
  echo "   2) pm2 describe $PM2_NAME   （看 restart 次数是否在涨）" >&2
  echo "   3) 确认 $APP_DIR/.env 存在且权限是 600、DATABASE_URL 能连上" >&2
  echo "   4) 回滚：git reset --hard <上一个 commit> && npm ci && npm run build && pm2 reload $PM2_NAME" >&2
  exit 1
fi
