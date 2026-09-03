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
| `LLM_API_KEY` | 否 | 大模型 API 密钥（仅存服务端）；**库优先于环境变量**——管理员可在「设置」页配置并存入数据库，未在库中配置时回退此环境变量；两者皆无时 LLM 打标/润色/举措生成回退本地规则 |
| `LLM_BASE_URL` | 否 | OpenAI 兼容 API 基址，默认 `https://api.openai.com/v1`；库内大模型配置留空时回退此变量 |
| `LLM_MODEL` | 否 | 默认模型名，默认 `gpt-4o-mini`；库内大模型配置留空时回退此变量 |

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

提交前再看一眼 `git diff --stat`：若标题/scope 只写某个模块（如 `feedbacks`），但 stat 里出现大量无关目录（尤其 `src/lib/postUseRating/**`、月报 preview），**先拆 commit**，不要用一次巨型提交混入多需求。超长 Agent 会话结束时禁止「整夜改动打成一个 commit」。

高敏目录（无关需求不得顺手改写）：

- `src/lib/postUseRating/**`
- `src/components/workbench/PostUseMonthlyReportPreview.jsx`
- `src/lib/productCatalog/postUseRatingProducts.js`

## 更新动态与 Commit 规范

- 默认约定：**只要没有明确说明不写入更新动态，用户可见改动请使用会进入更新动态的 commit 写法。**
- 更新动态来自 Git：执行 `npm run generate:whats-new` 或 `npm run build` 时，会从 `scripts/whats-new.since` 之后的 commit 生成 `public/config/whats-new.json`。
- 默认收录类型：`feat:`、`fix:`。
- 默认不收录类型：`docs:`、`chore:`、`refactor:` 等；若确需进入更新动态，请在 commit body 末尾加 `Changelog: show`。
- 显式跳过：若本次提交不应进入更新动态，请在 commit body 末尾加 `Changelog: skip`。
- 展示规则：
  - commit `subject`：更新动态标题
  - commit `body`：更新动态摘要
  - commit `scope`：映射模块，例如 `feat(workbench): ...`

推荐写法：

```gitcommit
feat(workbench): 升级洞察工作台与用后即评月报流程

- 重构工作台故事化展示结构
- 新增用后即评月报预览与导入链路
- 优化分析维度与产品配置相关交互
```

说明：

- 尽量使用 `feat(scope): 标题` / `fix(scope): 标题`。
- 若希望更新动态里能直接看到“详情”，请务必写 commit body；只有标题没有 body 时，更新动态只会显示标题。
- 同一个 commit 不会在 `git commit` 当下自动改写自己提交中的 `whats-new.json`；通常在后续构建或手动执行 `npm run generate:whats-new` 时生成。

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
