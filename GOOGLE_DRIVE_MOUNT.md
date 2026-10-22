# Google Drive 本地挂载（rclone）接入指南

把 Google Drive 挂载为本机目录，让 colab_down 的「浏览 Drive / 配额」直接读本地文件系统，
不再依赖已挂载 Drive 的 Colab VM。

原理：rclone 走 Google 官方 Drive API + OAuth 2.0（合规接入方式，非模拟客户端），
挂载点由 `NUXT_CDM_LOCAL_DRIVE_ROOT` 环境变量接入本项目（见 `server/services/DriveService.ts`）。

> ⚠️ 2026 年重要变化：rclone 内置的共享 client_id 正在退役，2026 年内停止可用。
> 必须按下面第 2 步创建自己的 client_id，否则会配置失败或日后突然不可用。

## 1. 安装 rclone

```bash
curl https://rclone.org/install.sh | sudo bash
rclone version   # 验证安装
```

## 2. 创建自己的 Google OAuth client_id（一次性，约 10 分钟）

在**有浏览器的电脑**上操作 [Google Cloud Console](https://console.cloud.google.com/)：

1. 新建项目（名字随意，如 `colab-down-rclone`）
2. 左侧「API 和服务 → 库」，搜索并启用 **Google Drive API**
3. 「API 和服务 → OAuth 同意屏幕」：
   - 用户类型选 **External**，填应用名（随意）、联系邮箱，保存
   - 回到概览点 **「Publish app」发布为生产状态**
     （不发布则 refresh token 每 7 天过期，需每周重新授权）
4. 「API 和服务 → 凭据 → 创建凭据 → OAuth 客户端 ID」：
   - 应用类型选 **桌面应用（Desktop app）**
   - 记下生成的 **Client ID** 和 **Client Secret**

> 授权时若出现「此应用未经 Google 验证」警告：对自己建的应用属正常提示，
> 点「高级 → 继续前往 <应用名>」即可。自用无需走 Google 正式验证。

## 3. 配置 rclone remote（服务器上，无浏览器走 headless 流程）

```bash
rclone config
```

交互应答：

```
n) New remote
name> gdrive
Storage> drive                      # Google Drive
client_id> <第 2 步的 Client ID>
client_secret> <第 2 步的 Client Secret>
scope> 1                            # drive，全部文件读写（只读需求选 2 drive.readonly）
service_account_file>               # 留空
Edit advanced config? > n
Use auto config? > n                # 服务器无浏览器，选 n！
```

选 n 后终端会打印一条形如以下的命令：

```
rclone authorize "drive" "<一长串>"
```

把它复制到**有浏览器的电脑**上执行（那台电脑也要装 rclone），
浏览器弹出 Google 登录授权页 → 登录并允许 → 终端得到一段 token JSON → 粘回服务器的 rclone config。

验证：

```bash
rclone lsd gdrive:        # 应列出 Drive 根目录的文件夹
```

## 4. 挂载为本地目录

```bash
mkdir -p /mnt/gdrive
rclone mount gdrive: /mnt/gdrive --daemon --vfs-cache-mode writes
ls /mnt/gdrive            # 应看到 Drive 内容
```

## 5. 接入 colab_down

编辑项目根目录 `.env`：

```bash
NUXT_CDM_LOCAL_DRIVE_ROOT=/mnt/gdrive
```

重启 dev server（`npm run dev` / `yarn dev`）。
之后「浏览 Drive / 配额」直接读 `/mnt/gdrive`，无需任何已挂载 Drive 的 VM。

## 6. 开机自动挂载（可选，systemd --user，免 root）

```bash
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/rclone-gdrive.service <<'EOF'
[Unit]
Description=rclone mount Google Drive
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
ExecStart=/usr/bin/rclone mount gdrive: /mnt/gdrive --vfs-cache-mode writes
ExecStop=/bin/fusermount -u /mnt/gdrive
Restart=on-failure

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now rclone-gdrive
loginctl enable-linger $USER    # 注销后仍保持运行
```

## 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 授权后 7 天失效 | OAuth 同意屏幕还在 Testing，回 Cloud Console 点 Publish app（第 2.3 步） |
| client_id 留空报错/不可用 | 共享 client_id 已退役，必须自建（第 2 步） |
| 授权页「未经 Google 验证」 | 自建应用的正常提示，点「高级 → 继续」即可 |
| 上传报 rateLimit / userRateLimit | Drive 日限额（约 750 GiB 上传 / 10 TiB 下载），次日恢复 |
| 配额显示的是本机磁盘数值 | rclone 挂载点上 `statfs` 反映的是 VFS 缓存所在盘，仅作参考；真实配额可用 `rclone about gdrive:` 查看 |
| 卸载挂载点 | `fusermount -u /mnt/gdrive` |
