#!/usr/bin/env bash
#
# Agent ToDo · 备份脚本（技术文档 §10.5 的 L1 ＋ L2）
#
#   L1 数据库   mysqldump --single-transaction  →  /srv/backup/db-YYYY-MM-DD.sql.gz   每日 · 留 7 份
#   L2 图片     tar /data/uploads               →  /srv/backup/uploads-YYYY-MM-DD.tar.gz 每周 · 留 3 份
#   L3 异地     ★ 本脚本**做不了** —— 见文件末尾。这条才是真的算备份的那一环。
#
# 安装（★ 先做备份，再做别的 —— §10.3 第 9 步）：
#   install -m 700 backup.sh /srv/agenttodo/backup.sh
#   crontab -e  →
#       30 3 * * *  /srv/agenttodo/backup.sh  >> /srv/agenttodo/logs/backup.log 2>&1
#
# 手动跑：
#   /srv/agenttodo/backup.sh              # 按当天星期自动决定要不要带 L2
#   /srv/agenttodo/backup.sh --all        # 强制 L1 ＋ L2
#   /srv/agenttodo/backup.sh --db         # 只做 L1
#
# ⚠️⚠️ 本文件**必须是 LF 换行**。从 Windows 拷上来若带了 CRLF，
#     执行时会报 `$'\r': command not found` 这种一眼看不出原因的错。
#     自检：file backup.sh  → 应显示 "ASCII text executable"，若带 "with CRLF" 就修：
#        sed -i 's/\r$//' backup.sh
#
set -euo pipefail

# ---------------------------------------------------------------- 配置
DB_NAME="${DB_NAME:-agenttodo}"
BACKUP_DIR="${BACKUP_DIR:-/srv/backup}"
UPLOAD_DIR="${UPLOAD_DIR:-/data/uploads}"

# ★ 凭证放这里，**不要**写在命令行上（ps 能看到），也**不要**用 root
#   文件内容四行：
#       [client]
#       host=127.0.0.1
#       user=agenttodo
#       password=***
#   权限：chmod 600 /srv/agenttodo/.my.cnf
MY_CNF="${MY_CNF:-/srv/agenttodo/.my.cnf}"

DB_KEEP=7      # 保留 7 份日备（§10.5 L1）
IMG_KEEP=3     # 保留 3 份周备（§10.5 L2）

# ---------------------------------------------------------------- 参数
MODE="auto"
case "${1:-}" in
  --all) MODE="all" ;;
  --db)  MODE="db" ;;
  "")    MODE="auto" ;;
  *)     echo "用法：$0 [--all|--db]" >&2; exit 2 ;;
esac

# ---------------------------------------------------------------- 前置检查
for bin in mysqldump gzip tar; do
  command -v "$bin" >/dev/null 2>&1 || { echo "[backup] ✘ 缺少命令：$bin"; exit 1; }
done
[ -r "$MY_CNF" ] || { echo "[backup] ✘ 读不到 $MY_CNF（权限应为 600，属主应为运行 cron 的用户）"; exit 1; }

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"   # ★ dump 里有全部数据，别让同实例的其他用户翻

STAMP="$(date +%F)"
# 主库、用户、权限、存储过程/函数/触发器/事件 —— 少任何一项，"恢复演练"都会缺东西
# ★★ `--no-tablespaces` **必须加**：MySQL 8 的 mysqldump 默认会去读表空间信息，
#    而那不是业务账号能碰的（需要 PROCESS 权限）⇒ 生产上会刷
#      `Access denied; you need ... PROCESS privilege(s) ... when trying to dump tablespaces`
#    ⚠️ 它**退出码仍是 0** ⇒ 脚本判不出来，只有靠这行消除。
#    本机联调用 root 跑（root 有 PROCESS）⇒ **这个缺陷只会在生产暴露**。
DUMP_SCOPE=(--single-transaction --quick --routines --triggers --events --no-tablespaces --default-character-set=utf8mb4)

# ---------------------------------------------------------------- L1 · 数据库
L1="$BACKUP_DIR/db-$STAMP.sql.gz"
echo "[backup] L1 → $L1"
# ⚠️ 这里刻意**不用** `--databases`：带上它 dump 里会含 CREATE DATABASE，
#   恢复到别的库名时会失败（恢复演练要的就是"恢复到临时库名"这一步）
if ! mysqldump --defaults-extra-file="$MY_CNF" "${DUMP_SCOPE[@]}" "$DB_NAME" | gzip -9 > "$L1.part"; then
  echo "[backup] ✘ mysqldump 失败" >&2
  rm -f "$L1.part"
  exit 1
fi
mv "$L1.part" "$L1"

# ★ 空 dump 是最阴险的一种失败：文件在、mtime 新、恢复出来是空库。
#   gzip -t 只验完整性，不验内容 ⇒ 必须显式判体积。
if [ ! -s "$L1" ]; then
  echo "[backup] ✘ dump 是空文件，保留下来供排查" >&2
  mv "$L1" "$L1.EMPTY"
  exit 1
fi
gzip -t "$L1"
echo "[backup] L1 ✔ $(du -h "$L1" | cut -f1)"

# 清理：只保留最近 DB_KEEP 份（用 ls -1t 而不是 -1tr，别把最新的删了）
ls -1t "$BACKUP_DIR"/db-*.sql.gz 2>/dev/null | tail -n +$((DB_KEEP + 1)) | while read -r f; do
  echo "[backup] L1 清理旧档 $f"
  rm -f "$f"
done

# ---------------------------------------------------------------- L2 · 图片（每周）
DO_IMG="no"
case "$MODE" in
  all) DO_IMG="yes" ;;
  db)  DO_IMG="no" ;;
  auto) [ "$(date +%u)" = "7" ] && DO_IMG="yes" ;;   # 7 ＝ 周日
esac

if [ "$DO_IMG" = "yes" ]; then
  if [ -d "$UPLOAD_DIR" ]; then
    L2="$BACKUP_DIR/uploads-$STAMP.tar.gz"
    echo "[backup] L2 → $L2"
    # ★ 用 -C 切到父目录再打包**相对路径**，恢复时 `tar -xf ... -C /data` 就能原地还原，
    #   不会把 /data/uploads 的绝对路径写进包里
    if tar czf "$L2.part" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"; then
      mv "$L2.part" "$L2"
      echo "[backup] L2 ✔ $(du -h "$L2" | cut -f1)"
    else
      echo "[backup] ✘ 打包图片失败" >&2
      rm -f "$L2.part"
      exit 1
    fi

    ls -1t "$BACKUP_DIR"/uploads-*.tar.gz 2>/dev/null | tail -n +$((IMG_KEEP + 1)) | while read -r f; do
      echo "[backup] L2 清理旧档 $f"
      rm -f "$f"
    done
  else
    echo "[backup] ⚠️ 跳过 L2：$UPLOAD_DIR 不存在（还没上传过图片？）"
  fi
else
  echo "[backup] L2 今天不做（非周日）；要强制请加 --all"
fi

# ---------------------------------------------------------------- 汇总
echo "[backup] ── $BACKUP_DIR 现状 ──"
ls -lh "$BACKUP_DIR" | tail -n +2

# ★★ L3 异地 —— 本脚本永远做不到，必须靠人（或另配对象存储 / rclone）
cat <<'EOF'
[backup] ⚠️ 提醒：L1/L2 都还在**同一台机器**上。
         磁盘坏、误删、系统重装 三种情况会**同时带走原数据和备份**。
         ⇒ 每周手动把最新的 db-*.sql.gz 与 uploads-*.tar.gz 下载到本机
           （或配 rclone 推到 COS）。这是本项目性价比最高的一条运维纪律（§10.5）。
         ⇒ 且「没演练过的备份不叫备份」：上线前按 §10.5 做一次恢复演练
           （建临时库 → 导入 → count 一下 → 删库）。
EOF
