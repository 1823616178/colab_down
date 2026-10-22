# Colab Download Manager

利用 Google Colab 高速网络（实测 90–175 MB/s）批量下载文件到 Google Drive 的 Web 管理平台。
详细设计与任务规划见 [DESIGN.md](./DESIGN.md) 与 [TASK.md](./TASK.md)。

## 技术栈

Nuxt 3 + TypeScript · Nitro（server/ 即后端）· TypeORM + MySQL 8 · SSE 实时进度 · zod · pino

## 快速开始

```bash
# 1. 依赖
npm install

# 2. 环境变量（Nuxt 标准 NUXT_ 前缀，见 .env.example）
cp .env.example .env
#    必填：NUXT_DB_HOST/PORT/USER/PASSWORD/NAME、NUXT_CDM_SECRET_KEY
#    可选：NUXT_CDM_LOCAL_DRIVE_ROOT=<本地挂载点>（如 rclone mount gdrive: /mnt/gdrive），
#         配置后「浏览 Drive / 配额」直接读本地文件系统，不依赖已挂载 Drive 的 VM
#         （完整挂载步骤见 GOOGLE_DRIVE_MOUNT.md）

# 3. MySQL 授权（账号需要对库的全部权限）
#    GRANT ALL PRIVILEGES ON `colab_down`.* TO '<user>'@'%'; FLUSH PRIVILEGES;
#    库不存在先建：CREATE DATABASE colab_down CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
#    表结构由 TypeORM 启动时自动同步（当前阶段不走手写 migration）

# 4. 启动前检查
npm run preflight

# 5. 开发（Mock 模式：NUXT_CDM_MOCK=1，不调真实 Colab，可完整体验全部流程）
npm run dev   # http://127.0.0.1:3000
```

首次启动自动创建管理员 `admin / admin123`（日志有提示），**登录后请立即在设置页修改密码**。

## Mock 与真实模式

| 模式 | 开关 | 说明 |
|:---|:---|:---|
| Mock（默认） | `NUXT_CDM_MOCK=1` | 内存模拟 VM 全生命周期：2s 建机、模拟授权 URI、~100MB/s 假下载、断连/失败注入（任务名含 `mockfail` / `mockstall`） |
| 真实 | `NUXT_CDM_MOCK=0` | 调本机 `colab` CLI（google-colab-cli 0.6.0）。每台 VM 需在页面上完成一次 Google Drive 授权（横幅+面板引导，见 DESIGN.md §6.0.5） |

## 常用命令

```bash
npm run dev        # 开发
npm run build      # 生产构建（.output）
npm run test       # vitest 单元测试
npm run typecheck  # vue-tsc 全量类型检查
npm run preflight  # 启动前环境检查
```

## 使用姿势（真实模式）

1. 「VM 管理」→ 新建 VM（或睡前用「预热 N 台」一次开好）
2. 出现授权横幅 → 打开授权链接在浏览器完成 Google Drive 授权 → 点「我已完成授权」→ VM 变 `idle`
3. 「新建任务」粘贴 HF repo / 直链 URL 提交，仪表盘看实时进度
4. VM 空闲 1 小时自动回收；单 VM 寿命上限 23h（避开 Colab 24h 硬上限）

## 安全说明

- 登录 token（HMAC-SHA256，7 天）存 localStorage，API 全量鉴权（中间件白名单仅 `/api/auth-login`）
- HF/GitHub/rclone 凭据 AES-256-GCM 加密入库，密钥 = `NUXT_CDM_SECRET_KEY`（生产务必 `openssl rand -base64 32` 重生成）
- 默认监听 127.0.0.1；暴露局域网设 `NUXT_HOST=0.0.0.0` 前务必改强密码
- 不要把 Nuxt 服务容器化（需要宿主机 colab CLI 与凭据），只容器化 MySQL
