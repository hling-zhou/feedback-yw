# 部署与运维 Runbook

本文档面向内网/生产环境部署 **Feedback Insights**（React 前端 + Fastify API + SQLite）。本地开发见 [README.md](../README.md)。

---

## 1. 架构概览

```
浏览器 → 静态前端 (dist/) 或 Vite 开发服
       → /api/* → Fastify (:3001) → SQLite (server/data/auth.db)
       → /config/* → public/config/（打标 Excel/JSON，可由「发布」API 写入）
```

- **协作数据**：反馈记录、快照、标签候选等存 SQLite，客户端约 5s 轮询 `dataRevision` 同步。工作台 `feedbacks` 为读库后的内存缓存，写入走单条/批量 API，**不会**全量 debounce 覆盖共享库。
- **发布配置**：标签管理中的「发布」将共享库中的 managed 配置写入 `public/config/taxonomy/` 等目录（单节点直接写盘；多节点需共享卷，见 §6）。
- **持久化清单与发版防丢数据**：[DATA-PERSISTENCE.md](./DATA-PERSISTENCE.md)

---

## 2. 上线前检查清单（P0）

在首次生产启动前逐项确认：

- [ ] `NODE_ENV=production`
- [ ] `JWT_SECRET` 已设置，**≥32 字符**（`openssl rand -base64 32`）
- [ ] `CORS_ORIGINS` 已设置为实际前端 Origin（如 `https://insights.example.com`）
- [ ] 空库首次：`ADMIN_INITIAL_PASSWORD` **≥12 字符**，且非 `admin123`
- [ ] 已有用户库：**勿**依赖默认口令；在「用户管理」轮换弱密码
- [ ] API 前方有 **HTTPS** 反向代理（Nginx / Caddy 等）
- [ ] `server/data/` 目录已纳入 **备份** 计划
- [ ] 打标配置发布目录有写权限且已纳入备份/版本管理策略
- [ ] 若需大模型打标/润色/举措：`LLM_API_KEY` 已设置在 API 进程环境（**勿**写入前端或仓库）
- [ ] 负载均衡/容器探针指向 `GET /health`（`dbOk: false` 时返回 503）

---

## 3. 环境变量

完整说明见 [README.md § 环境变量](../README.md#环境变量)。

| 变量 | 生产 |
|------|------|
| `JWT_SECRET` | 必填，≥32 字符 |
| `CORS_ORIGINS` | 必填，逗号分隔 |
| `NODE_ENV` | `production` |
| `API_PORT` / `API_HOST` | 按部署调整；对外暴露 `0.0.0.0` 时需 `ALLOW_BIND_ALL=true` |
| `AUTH_DATABASE_PATH` | 可选，自定义 SQLite 路径 |
| `SERVER_DATA_DIR` | 可选，数据目录（默认 `server/data`） |
| `ADMIN_INITIAL_*` | 仅**空库首次**创建管理员 |
| `LLM_API_KEY` | 可选；大模型密钥仅存 API，经 `POST /api/llm/chat` 代理 |
| `LLM_BASE_URL` | 可选，默认 OpenAI 兼容 `https://api.openai.com/v1` |
| `LLM_MODEL` | 可选，服务端默认模型；用户可在设置页覆盖模型名 |

### 操作审计

- 表 `audit_log`：记录导入批次、清空数据、打标/产品目录发布、用户 CRUD 等
- 查询：`GET /api/audit?days=7`（**仅管理员**，默认最近 7 天，最多 90 天）
- 管理界面：「用户管理」页底部「操作审计」表格

---

## 4. 单节点部署步骤

### 4.1 构建

```bash
npm ci
export JWT_SECRET="..."   # 构建阶段可不设；运行 API 时必须设
npm run build             # 产出 dist/
```

### 4.2 启动 API

```bash
export NODE_ENV=production
export JWT_SECRET="$(openssl rand -base64 32)"
export CORS_ORIGINS=https://insights.yourcompany.com
# 空库首次：
# export ADMIN_INITIAL_PASSWORD="$(openssl rand -base64 18)"

node server/index.js
# 默认 http://127.0.0.1:3001
```

建议使用 **systemd** / **supervisor** 托管进程，并配置 `Restart=always`。

### 4.3 托管前端

将 `dist/` 由 Nginx 等静态托管，并将 `/api` 反向代理到 API 端口，例如：

```nginx
server {
  listen 443 ssl;
  server_name insights.yourcompany.com;

  root /var/www/feedback-insights/dist;
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

确保 `CORS_ORIGINS` 与浏览器访问的 Origin 一致（含 `https://`）。

### 4.4 健康检查

```bash
curl -s http://127.0.0.1:3001/health
# 期望：{"ok":true,"dbOk":true,"recordCount":123,"revision":5,"revisionUpdatedAt":"..."}
# dbOk 为 false 时 HTTP 503，负载均衡应摘除该实例
```

---

## 5. 备份与恢复

### 5.1 SQLite 备份

业务与用户数据默认在：

```text
server/data/auth.db
```

**建议**：每日文件级备份（复制 WAL 时短暂停写或使用 SQLite `.backup`）。

```bash
# 示例：一致性备份
sqlite3 server/data/auth.db ".backup 'backup/auth-$(date +%F).db'"
```

同时备份：

- `public/config/taxonomy/`（打标配置发布物）
- `public/config/product-catalog/`（产品规格发布物）

### 5.2 恢复

1. 停止 API 进程  
2. 用备份文件替换 `auth.db`（及 `-wal` / `-shm` 若存在，建议一并处理或删除 WAL 后仅恢复主库）  
3. 恢复 `public/config/` 对应目录（若需要）  
4. 启动 API，登录验证记录数与洞察快照  

---

## 6. 标签 / 产品目录配置流程

1. **权威数据**：`auth.db` 中 `taxonomy_managed`、`product_catalog_managed_v1`（标签管理页保存即写入）。  
2. **磁盘备份**：保存后由 API 自动生成 `public/config/taxonomy/`、`product-catalog/` 下 Excel/JSON。  
   - 生产默认开启：`AUTO_PUBLISH_CONFIG` 未设置且 `NODE_ENV=production` 时为 true。  
   - 开发默认关闭：避免本机 Excel 被占用导致写盘失败；可 `AUTO_PUBLISH_CONFIG=true` 开启。  
3. **前端运行时**不再从磁盘 Excel 读取；各客户端通过 `dataRevision` 轮询同步共享库。  
4. 写盘失败时，标签管理页顶显示「重试写盘备份」；亦可 `POST /api/storage/taxonomy/publish` 手动触发。

**多实例注意**：自动写盘须所有 API 节点挂载**同一** `public/config` 共享卷。

---

## 7. 持续集成（CI）

仓库内 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) 在 push/PR 到 `main`/`master` 时执行：

1. `npm ci`  
2. `npm test`  
3. `npm run build`  

本地提交前可执行：

```bash
export JWT_SECRET="$(openssl rand -base64 32)"
npm test && npm run build
```

---

## 8. 常见问题

| 现象 | 处理 |
|------|------|
| API 启动报 `未设置 JWT_SECRET` | `export JWT_SECRET=...`（≥16 字符；生产 ≥32） |
| 登录后 API 403 / CORS 错误 | 检查 `CORS_ORIGINS` 是否与浏览器地址完全一致 |
| 空库无法登录 | 设置 `ADMIN_INITIAL_PASSWORD` 后重启 API |
| 洞察数据与他人不一致 | 确认共用同一 `auth.db`；检查 revision 轮询；导入后点击「生成/刷新洞察」 |
| 发布 Excel 成功但页面未更新 | 设置页「重新加载配置」；确认 `public/config` 路径与 Nginx 静态规则 |

---

## 9. 版本与回滚

- 应用版本：见 `package.json` 的 `version` 字段。  
- 回滚应用：恢复上一版 `dist/` + 上一版 API 代码；**数据库向前兼容**时需自行评估是否回退 `auth.db` 备份。  
- 回滚打标配置 / 产品目录：通过 Git 恢复 `public/config/taxonomy/`、`public/config/product-catalog/` 下对应文件（发布时不再自动生成 Excel 备份）。
