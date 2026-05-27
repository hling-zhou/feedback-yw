# Feedback Insights

用户反馈分析与洞察工作台（React + Fastify + SQLite）。

**生产部署与备份**请参阅 [docs/DEPLOY.md](docs/DEPLOY.md)。

## 本地开发

```bash
npm install

# 必填：JWT 签名密钥（无默认值，缺失时 API 拒绝启动）
export JWT_SECRET="$(openssl rand -base64 32)"

# 空库首次启动 API 时必填：初始管理员密码（≥12 字符，禁止 admin123）
export ADMIN_INITIAL_PASSWORD="$(openssl rand -base64 18)"

npm run dev:all
```

- 前端：http://127.0.0.1:5175/
- API：http://127.0.0.1:3001/

首次启动会按环境变量创建管理员（见下表）。本地可参考 [.env.example](.env.example) 自行 `export` 变量。

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `JWT_SECRET` | **是** | JWT 签名密钥，≥16 字符；禁止使用 `dev-only-change-me-in-production` |
| `JWT_EXPIRES_IN` | 否 | Token 有效期，默认 `7d` |
| `API_PORT` | 否 | API 端口，默认 `3001` |
| `API_HOST` | 否 | 监听地址，默认 `127.0.0.1` |
| `CORS_ORIGINS` | **生产必填** | 允许的前端 Origin，逗号分隔；开发未设置时默认 `http://127.0.0.1:5175` 与 `http://localhost:5175` |
| `NODE_ENV` | 否 | 设为 `production` 时强制 `CORS_ORIGINS`、`JWT_SECRET`≥32 字符 |
| `ALLOW_BIND_ALL` | 否 | 生产环境监听 `0.0.0.0` 时须设为 `true`（建议前方有反向代理 + TLS） |
| `ADMIN_INITIAL_USERNAME` | 否 | 空库首次创建管理员时的用户名，默认 `admin` |
| `ADMIN_INITIAL_PASSWORD` | **空库首次必填** | 初始管理员密码，≥12 字符；禁止 `admin123` 等弱口令；**无默认值** |
| `LLM_API_KEY` | 否 | 大模型 API 密钥（仅存服务端）；未设置时 LLM 打标/润色/举措生成回退本地规则 |
| `LLM_BASE_URL` | 否 | OpenAI 兼容 API 基址，默认 `https://api.openai.com/v1` |
| `LLM_MODEL` | 否 | 默认模型名，默认 `gpt-4o-mini`；设置页中的模型名可覆盖单次请求 |

## 常用命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 仅前端 |
| `npm run dev:api` | 仅 API（需已设置 `JWT_SECRET`） |
| `npm run dev:all` | API + 前端 |
| `npm test` | 单元测试（Vitest） |
| `npm run test:e2e` | Playwright 冒烟（自动启动 API + 前端，需本机可编译 better-sqlite3） |
| `npm run build` | 前端构建（产出 `dist/`） |

## 持续集成（CI）

Push / PR 到 `main` 或 `master` 时，GitHub Actions 会执行 `npm ci` → `npm test` → `npm run build`（见 [.github/workflows/ci.yml](.github/workflows/ci.yml)）。

本地提交前建议：

```bash
export JWT_SECRET="$(openssl rand -base64 32)"
npm test && npm run build
```

## 数据与配置

- 业务库：`server/data/auth.db`（SQLite，含用户与反馈记录）
- **换机迁移数据与洞察快照**：见 [docs/DATA-MIGRATION.md](docs/DATA-MIGRATION.md)
- 反馈记录列表 API：`GET /api/storage/records` 支持 `insightPeriodId`、`dataSourceType`、`limit`（默认不分页返回全部；传 `limit` 时返回 `{ records, total, limit, offset }`）、`offset`；`GET /api/storage/stats` 返回库内记录总数
- 健康检查：`GET /health` 返回 `dbOk`、`recordCount`、`revision`（库不可用时 HTTP 503）
- 打标配置发布：`public/config/taxonomy/`（详见 `public/config/taxonomy/README.md`）

## 生产部署（简版）

完整步骤、Nginx 示例、备份与打标发布见 **[docs/DEPLOY.md](docs/DEPLOY.md)**。

```bash
npm ci && npm run build
export NODE_ENV=production
export JWT_SECRET="$(openssl rand -base64 32)"
export CORS_ORIGINS=https://insights.yourcompany.com
export ADMIN_INITIAL_PASSWORD="$(openssl rand -base64 18)"   # 仅空库首次
export LLM_API_KEY="sk-..."                                  # 可选
node server/index.js
```
