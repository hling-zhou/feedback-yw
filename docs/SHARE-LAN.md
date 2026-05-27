# 局域网多人共享指南

在尚未部署到物理机或虚拟机前，让团队**共用同一份数据**访问 Feedback Insights。本文档包含两种方案：

| 方案 | 适用场景 | 复杂度 |
|------|----------|--------|
| [方案一：开发模式共享](#方案一开发模式共享局域网) | 内测、联调、快速试用；同一 Wi‑Fi / 内网 | 低 |
| [方案二：构建产物共享](#方案二构建产物--反向代理共享局域网) | 需稳定运行数天、更接近上线形态 | 中 |

**共同前提**

- 所有人访问 **同一台 host 机器** 上的 **一份 API + 一份 SQLite**（`server/data/auth.db`）。
- **不要**每人各自在本机跑 `npm run dev:all`（数据互不共享）。
- 平台已支持多用户登录与权限；管理员在「用户管理」为同事创建账号。
- 客户端约 5 秒轮询 `dataRevision`，多人编辑会自动同步（共用同一库时）。

相关文档：[README.md](../README.md)（环境变量）、[DEPLOY.md](./DEPLOY.md)（正式生产部署）。

**Host 操作系统**：本文同时覆盖 **macOS** 与 **Windows 11** 作托管机；命令行示例按系统分开展示。

---

## 角色分工

| 角色 | 职责 |
|------|------|
| **Host（托管机）** | 安装依赖、启动服务、备份数据库、创建用户账号 |
| **成员** | 浏览器访问 host 提供的地址，使用分配的账号登录 |

---

## 方案一：开发模式共享（局域网）

Vite 开发服对局域网开放；API 仍监听本机，由 Vite 将 `/api` 代理到 `127.0.0.1:3001`。成员只需访问 **5175** 端口。

### 1.1 架构

```
成员浏览器 → http://<host-IP>:5175
           → Vite dev（0.0.0.0:5175）
           → /api/* 代理 → Fastify（127.0.0.1:3001）→ SQLite
```

### 1.2 Host 准备

Host 需已安装 [Node.js](https://nodejs.org/)（LTS，含 `npm`）。Windows 11 建议使用 **PowerShell** 或 **Windows Terminal**。

**macOS / Linux（bash）**

```bash
cd /path/to/feedback-insights
npm install

export JWT_SECRET="$(openssl rand -base64 32)"
# 空库首次启动 API 时必填（≥12 字符）：
export ADMIN_INITIAL_PASSWORD="$(openssl rand -base64 18)"
```

**Windows 11（PowerShell）**

```powershell
cd C:\path\to\feedback-insights
npm install

# 随机密钥（需已安装 OpenSSL，或使用下方固定占位后自行替换为足够长的随机串）
$env:JWT_SECRET = -join ((48..57 + 65..90 + 97..122 | Get-Random -Count 32 | ForEach-Object { [char]$_ }))
# 空库首次启动 API 时必填（≥12 字符）：
$env:ADMIN_INITIAL_PASSWORD = -join ((48..57 + 65..90 + 97..122 | Get-Random -Count 18 | ForEach-Object { [char]$_ }))
```

> 上述 `$env:…` 仅对**当前 PowerShell 窗口**有效；新开终端需重新设置，或写入本机专用 `start-host.ps1`（勿提交仓库）。

**终端 1 — API（仅本机即可）**

```bash
npm run dev:api
# 默认 http://127.0.0.1:3001
```

**终端 2 — 前端（对局域网开放）**

```bash
npm run dev -- --host 0.0.0.0 --port 5175
```

看到类似 `Network: http://192.168.x.x:5175/` 即表示已对局域网监听。

**Windows 11 首次运行 Node 时**：若弹出 **「专用网络 / 公用网络」**，选 **专用网络**（家庭/公司 Wi‑Fi），否则防火墙可能拦截局域网访问。

### 1.3 查询 Host 内网 IP

**macOS**

```bash
ipconfig getifaddr en0    # 常见 Wi‑Fi
# 若无输出，试 en1 或在 系统设置 → 网络 中查看
```

**Windows 11（CMD / PowerShell）**

```text
ipconfig
# 查看当前网卡的「IPv4 地址」，如 192.168.1.100
```

或在 **设置 → 网络和 Internet → WLAN / 以太网 → 硬件属性** 中查看 **IPv4 地址**。

### 1.4 分发给成员的访问地址

```text
http://<host-内网IP>:5175
```

示例：`http://192.168.1.100:5175`

### 1.5 防火墙

#### macOS

1. **系统设置** → **网络** → **防火墙**（部分版本在 **隐私与安全性** → **防火墙**）
2. 打开防火墙 → **选项…**
3. 找到 **node** / **Node.js**，设为 **允许传入连接**
4. 若首次启动时系统弹出「是否允许 Node 接收连接」，选 **允许**

> macOS 防火墙按**应用**放行，一般无需单独配置「5175 端口」。方案一中 API 不对外，**只需保证 Vite（Node）可入站**。

**Windows 11**

**方式 A — 设置（图形界面）**

1. **设置** → **隐私和安全性** → **Windows 安全中心** → **防火墙和网络保护**
2. 点当前网络（通常为 **专用网络**）→ **防火墙** 开关保持 **开**
3. **高级设置**（或 **Win + R** → `wf.msc`）→ **入站规则** → **新建规则…**
4. **端口** → **TCP** → 特定本地端口 **`5175`** → **允许连接**
5. 配置文件至少勾选 **专用**；名称如 `Feedback Insights Dev 5175`

**方式 B — PowerShell（管理员）**

```powershell
New-NetFirewallRule -DisplayName "Feedback Insights Dev 5175" -Direction Inbound -Protocol TCP -LocalPort 5175 -Action Allow -Profile Private
```

> 若成员仍无法访问，可在「专用网络」防火墙中确认 **Node.js** 未被阻止；或临时关闭防火墙做连通测试（**测完务必恢复**）。

### 1.6 首次登录与建号

1. Host 用浏览器打开 `http://127.0.0.1:5175` 或内网地址
2. 空库首次：用户名默认 `admin`，密码为 Host 设置的 `ADMIN_INITIAL_PASSWORD`
3. 进入 **用户管理**，为成员创建账号（编辑 / 查看等角色）

### 1.7 连通性自检

**Host 本机**

macOS / Linux：

```bash
curl -I http://127.0.0.1:5175
curl -s http://127.0.0.1:3001/health
```

Windows 11（PowerShell）：

```powershell
Invoke-WebRequest -Uri http://127.0.0.1:5175 -Method Head -UseBasicParsing
Invoke-RestMethod http://127.0.0.1:3001/health
```

**成员电脑**

```bash
curl -I http://<host-内网IP>:5175
```

（Windows 成员可用浏览器直接打开，或 `Invoke-WebRequest` 同上。）

| 现象 | 可能原因 |
|------|----------|
| Host 通、成员不通 | 防火墙未放行 Node/5175；或 Vite 未加 `--host 0.0.0.0` |
| 页面打开但登录失败 | API 未启动；检查 Host 终端 1 是否在跑 `dev:api` |
| 数据与他人不一致 | 有人仍在本地跑另一份实例；应全部改用同一 host 地址 |

### 1.8 Host 运维注意

**macOS**

- 合盖/休眠会导致服务不可用：**系统设置 → 电池/节能 → 接通电源时防止自动睡眠**

**Windows 11**

- **设置** → **系统** → **电源** → **屏幕和睡眠**：接通电源时 **睡眠** 设为 **从不**（至少 Host 试用期间）
- 关闭或合盖前确认两个终端（API + 前端）仍在运行；关闭窗口会停止服务
- 可选：**控制面板** → **电源选项** → **更改计划设置** → **使计算机进入睡眠状态：从不**

**通用**

- 定期备份 `server/data/auth.db`（见 [DEPLOY.md §5](./DEPLOY.md#5-备份与恢复) 与下文 [数据备份](#数据备份两种方案通用)）
- 可选：在 Host 配置 `LLM_API_KEY`，全员经服务端代理使用大模型

### 1.9 方案一限制

- 适合短期联调；Vite 热更新、源码在 Host 机器上
- 不适合长期对外公网暴露（无 TLS）
- 远程办公见文末 [跨网访问补充](#跨网访问补充)

---

## 方案二：构建产物 + 反向代理（局域网）

先 `npm run build` 生成 `dist/`，API 以生产模式运行，Nginx（或 Caddy）在同一 host 上托管静态文件并反代 `/api`。更接近 [DEPLOY.md](./DEPLOY.md) 的单节点部署，适合内网稳定试用。

### 2.1 架构

```
成员浏览器 → http://<host-IP>:8080（或 80/443）
           → Nginx / Caddy
              ├─ /     → dist/ 静态文件
              └─ /api/ → Fastify（127.0.0.1:3001）→ SQLite
```

成员仍只需访问 **一个端口**（由 Nginx/Caddy 监听）；**3001 可不对外开放**。

### 2.2 Host 构建与启动 API

**macOS / Linux（bash）**

```bash
cd /path/to/feedback-insights
npm ci
npm run build

export NODE_ENV=production
export JWT_SECRET="$(openssl rand -base64 32)"
# 与浏览器访问地址一致（含协议、端口，无末尾斜杠）：
export CORS_ORIGINS=http://192.168.1.100:8080
# 空库首次：
# export ADMIN_INITIAL_PASSWORD="$(openssl rand -base64 18)"

node server/index.js
# 默认监听 127.0.0.1:3001（推荐，仅本机 + 反代访问）
```

**Windows 11（PowerShell）**

```powershell
cd C:\path\to\feedback-insights
npm ci
npm run build

$env:NODE_ENV = "production"
$env:JWT_SECRET = "<至少32字符的随机串>"
$env:CORS_ORIGINS = "http://192.168.1.100:8080"
# 空库首次：
# $env:ADMIN_INITIAL_PASSWORD = "<至少12字符的强密码>"

node server/index.js
```

将 `CORS_ORIGINS` 中的 IP 换成 Host 实际内网 IP 与反向代理监听端口。

验证 API：

```bash
curl -s http://127.0.0.1:3001/health
# 期望：{"ok":true,"dbOk":true,...}
```

### 2.3 反向代理配置

#### Nginx（macOS / Linux 或 Windows）

安装 Nginx 后新增站点配置。

- **Linux / macOS**：如 `/etc/nginx/conf.d/feedback-insights.conf`
- **Windows 11**：从 [nginx.org](https://nginx.org/en/download.html) 下载 Windows 版，在 `conf/nginx.conf` 的 `http { }` 内 `include` 自定义配置；`root` 使用 **正斜杠或转义反斜杠**，例如 `C:/path/to/feedback-insights/dist`

```nginx
server {
  listen 8080;
  server_name _;

  root /path/to/feedback-insights/dist;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /api/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

将 `root` 改为仓库内 `dist` 的**绝对路径**。重载 Nginx：

```bash
nginx -t && nginx -s reload
# macOS Homebrew：brew services restart nginx
# Windows：nginx -s reload（在 nginx 安装目录下执行）
```

> **Windows 11 作 Host 且不熟悉 Nginx 时**，更建议用下文 **Caddy**（单文件、配置简单）。

### 2.4 Caddy（可选，Windows 11 推荐）

从 [caddyserver.com](https://caddyserver.com/download) 下载 Windows 版，在仓库旁创建 `Caddyfile`：

```caddy
:8080 {
  root * C:/path/to/feedback-insights/dist
  try_files {path} /index.html
  reverse_proxy /api/* 127.0.0.1:3001
}
```

```powershell
caddy run --config Caddyfile
```

首次运行若防火墙提示，允许 **专用网络** 访问。

### 2.5 成员访问地址

```text
http://<host-内网IP>:8080
```

### 2.6 防火墙

#### macOS

放行 **Nginx** 或 **Caddy** 应用的传入连接（**系统设置 → 网络/隐私 → 防火墙 → 选项**），或放行所监听端口对应进程。

若暂时无法区分应用，可临时关闭防火墙做连通测试（**测完务必恢复**）。

#### Windows 11

同方案一：**设置 → 隐私和安全性 → Windows 安全中心 → 防火墙** → 入站规则放行 **TCP 8080**（或 Caddy/Nginx 所用端口）。

```powershell
New-NetFirewallRule -DisplayName "Feedback Insights HTTP 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
```

### 2.7 进程托管建议

内网试用也建议避免「关掉终端服务就停」：

- **macOS / Linux**：`tmux` / `screen`；或 systemd / launchd
- **Windows 11**：保持 **两个** PowerShell 窗口常开（API + 前端/ Caddy）；长期运行可用 [NSSM](https://nssm.cc/) 将 `node server/index.js` 注册为 Windows 服务

API 启动前须在**同一环境**中保留 `JWT_SECRET`、`CORS_ORIGINS` 等变量（可写 `start-host.ps1` / `start-host.sh`，**勿提交仓库**）。

### 2.8 首次登录与建号

同 [方案一 §1.6](#16-首次登录与建号)。

### 2.9 连通性自检

```bash
# Host
curl -I http://127.0.0.1:8080
curl -s http://127.0.0.1:3001/health

# 成员
curl -I http://<host-内网IP>:8080
```

### 2.10 方案二常见问题

| 现象 | 处理 |
|------|------|
| 页面 200，API 403 / CORS 错误 | `CORS_ORIGINS` 必须与浏览器地址完全一致（如 `http://192.168.1.100:8080`） |
| `/api` 404 | 检查 Nginx `location /api/` 与 `proxy_pass`；确认 API 在 3001 运行 |
| 刷新子路由 404 | 确认 `try_files ... /index.html` 已配置 |
| 打标发布成功他人未更新 | 共用同一 host 与 `public/config/`；成员在设置页「重新加载配置」 |

### 2.11 与正式生产的差异

本方案为**内网 HTTP 试用**，未包含：

- HTTPS / 域名证书
- `API_HOST=0.0.0.0` 直接暴露 API（不推荐，应仅反代）

正式上线路径见 [DEPLOY.md](./DEPLOY.md)。

---

## 跨网访问补充

成员不在同一局域网时（尚未有 VM/物理机），可在 Host 上叠加：

| 方式 | 说明 |
|------|------|
| **Tailscale** | 小团队推荐；虚拟内网 IP 访问 `http://100.x.x.x:5175` 或 `:8080` |
| **公司 VPN** | 连入后按本文 LAN 地址访问 |
| **Cloudflare Tunnel / ngrok** | 临时演示；须强密码、限时使用，**勿**长期裸奔 |

无论哪种方式，仍保持 **单 host + 单 auth.db**。

---

## 数据备份（两种方案通用）

**macOS / Linux（已安装 sqlite3 CLI）**

```bash
sqlite3 server/data/auth.db ".backup 'backup/auth-$(date +%F).db'"
```

**Windows 11**

- 简单方式：停止 API 后，复制 `server\data\auth.db` 到备份目录（若存在 `auth.db-wal`，建议 API 停稳后一并复制或仅用 `.backup`）
- 或安装 [SQLite 命令行工具](https://www.sqlite.org/download.html) 后执行与上相同的 `.backup` 命令

同时建议备份 `public/config/taxonomy/`、`public/config/product-catalog/`。

---

## 方案选择速查

```text
今天就要多人试用、同一办公室     → 方案一（5 分钟可启动；Win11 Host 用 PowerShell + 放行 5175）
要稳定跑几天、不想开 Vite 热更新   → 方案二（Win11 Host 推荐 Caddy + 放行 8080）
已有机房 / 域名 / HTTPS 需求       → DEPLOY.md 正式部署
```
