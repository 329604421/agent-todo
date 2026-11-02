/**
 * PM2 进程配置 —— Agent ToDo 后端
 *
 * 目标路径：/srv/agenttodo/app/ecosystem.config.js
 * 用法：
 *   pm2 start ecosystem.config.js --env production
 *   pm2 save && pm2 startup            # ★ 两句都要，否则重启后不自动拉起
 *   pm2 reload agenttodo               # 迭代发布用 reload（不要 restart）
 *
 * ★★ 这里**一个密钥都不写**。原因：`pm2 save` 会把当前环境快照写进
 *    ~/.pm2/dump.pm2，把 JWT_SECRET / 腾讯云密钥写进这个文件等于把它们
 *    定格进一个"谁都可能读到的备份文件"。所有密钥只活在 `.env`（权限 600），
 *    由 @nestjs/config 从 `cwd` 下的 `.env` 读（见 src/app.module.ts 的
 *    `ConfigModule.forRoot({ envFilePath: ['.env'] })`）
 *    ⇒ 所以下面 `cwd` 必须写对，写错了症状是"所有配置项都取了默认值"，
 *      其中最危险的是 JWT_SECRET 落到 `dev-only-secret-please-change`。
 *
 * ★ 与之配套的三条口径来自《技术开发文档-01 V1.2》§10.2。
 */

module.exports = {
  apps: [
    {
      name: 'agenttodo',
      script: 'dist/main.js',

      // ★ 必须是**绝对路径**：@nestjs/config 按 process.cwd() 找 .env，
      //   而 .env 与 dist/ 同在 /srv/agenttodo/app 下
      cwd: '/srv/agenttodo/app',

      // ★ 单实例 fork，**不要** exec_mode: 'cluster'。
      //   2 GB 的机器上多开一个 Node 进程就是多一份常量级内存；
      //   本项目的并发量（就几个人用）在单核单进程上远远够用。
      instances: 1,
      exec_mode: 'fork',

      autorestart: true,
      // 反复崩溃时不要疯狂重启刷日志：10 秒内最多 10 次就停手等人来看
      max_restarts: 10,
      min_uptime: '10s',
      // 崩溃重启之间留一点间隔，避免把日志刷爆
      restart_delay: 2000,
      // 关掉 watch：生产环境靠 pm2 reload 发布，不靠文件监听
      watch: false,
      // 磁盘不足时不要因为写日志失败把进程搞死
      ignore_watch: ['node_modules', 'logs', 'dist'],

      // ★★ **必设**。3.5 GB 可用内存（2 GB 实例）上，一个内存泄漏的 Node
      //    进程会把整机拖垮 —— 尤其在同机场景下。到了阈值就重启，比 OOM 好。
      max_memory_restart: '350M',

      // 收到 SIGINT 后给 5 秒优雅退出（Nest 会关掉 HTTP server 与 Prisma 连接）
      kill_timeout: 5000,
      // 启动后等 10 秒再判定"启动成功"（Prisma 首次连接会慢一点）
      listen_timeout: 10000,
      // 关掉"文件变化自动重启"
      wait_ready: false,
      shutdown_with_message: false,

      // ---------------------------------------------------------------- 日志
      output: '/srv/agenttodo/logs/out.log',
      error: '/srv/agenttodo/logs/err.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

      // ★ 轮转不在这里配 —— 这几个文件是**只增不减**的，不轮转会撑满磁盘（§4.3.4）：
      //     pm2 install pm2-logrotate
      //     pm2 set pm2-logrotate:max_size 10M
      //     pm2 set pm2-logrotate:retain 14
      //     pm2 set pm2-logrotate:compress true

      // ---------------------------------------------------------------- 环境
      // ⚠️ 只放**非密钥**项。NODE_ENV 在这里再写一遍是双保险：
      //    它会同时决定「错误堆栈是否回显」与「DEV_OPENID 调试通道是否生效」，
      //    而这两件事都只在 NODE_ENV === 'production' 时才是安全的默认值。
      env: {
        NODE_ENV: 'production',
        // 让日志时间戳是北京时间，方便和用户报障的时间对得上。
        // ★ 业务时间**不依赖**它：src/common/time.ts 是显式 +08:00 换算的，
        //   所以就算忘了设 TZ，库里存的时间也依然是对的。
        TZ: 'Asia/Shanghai',
      },
      // `pm2 start ecosystem.config.js --env production` 会叠这一层
      env_production: {
        NODE_ENV: 'production',
        TZ: 'Asia/Shanghai',
      },
    },
  ],
};
