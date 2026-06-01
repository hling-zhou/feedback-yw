# API 非 POST 方法报备清单

> 安全基线要求客户端写操作优先使用 POST。本系统为 REST 协作型内网应用，**只读查询**保留 GET；**写操作**仍含 PUT/PATCH/DELETE，列入本清单并计划分阶段 POST 化（P1+）。
>
> 关联：`server/schemas/*` 为核心写接口 JSON Schema 校验；JWT 含 `sv`（session_version），登出/改密/禁用/改角色后旧 token 失效。

---

## 1. 允许保留 GET 的接口（只读、无敏感写副作用）

| 方法 | 路径 | 用途 | 敏感数据 | 报备理由 |
|------|------|------|----------|----------|
| GET | `/health` | 探针 | 否 | 运维探活，无鉴权 |
| GET | `/api/auth/me` | 当前用户 | 低 | 会话校验，无 body |
| GET | `/api/auth/permissions` | 权限列表 | 低 | 只读 |
| GET | `/api/users` | 用户列表 | 中 | 仅 admin；后续可改 POST `/query` |
| GET | `/api/actions` | 举措列表 | 低 | 筛选查询 |
| GET | `/api/actions/stats` | 举措统计 | 低 | 只读 |
| GET | `/api/actions/:id` | 举措详情 | 低 | 只读 |
| GET | `/api/audit` | 审计日志 | 中 | 仅 admin |
| GET | `/api/llm/status` | LLM 配置状态 | 低 | 不含密钥 |
| GET | `/api/storage/stats` | 库统计 | 低 | 只读 |
| GET | `/api/storage/revision` | 数据版本 | 低 | 5s 轮询同步 |
| GET | `/api/storage/background-task` | 后台任务锁 | 低 | 只读 |
| GET | `/api/storage/periods` | 洞察周期 | 低 | 只读 |
| GET | `/api/storage/periods/:id` | 周期详情 | 低 | 只读 |
| GET | `/api/storage/records` | 工单列表 | 中 | 业务只读；含脱敏后内容 |
| GET | `/api/storage/records/:id` | 单条工单 | 中 | 同上 |
| GET | `/api/storage/runs` | 分析运行 | 低 | 只读 |
| GET | `/api/storage/runs/by-idempotency` | 幂等查询 | 低 | 只读 |
| GET | `/api/storage/runs/:id` | 运行详情 | 低 | 只读 |
| GET | `/api/storage/artifacts` | 产物 | 低 | 只读 |
| GET | `/api/storage/snapshots` | 快照列表 | 低 | 只读 |
| GET | `/api/storage/snapshots/:id` | 快照详情 | 低 | 只读 |
| GET | `/api/storage/insight-rebuild` | 重建任务列表 | 低 | 只读 |
| GET | `/api/storage/insight-rebuild/:id` | 重建任务 | 低 | 只读 |
| GET | `/api/storage/meta/:key` | 元数据 | 低 | 只读 |
| GET | `/api/storage/tag-candidates` | 标签候选 | 低 | 只读 |
| GET | `/api/storage/taxonomy/publish-status` | 发布状态 | 低 | 只读 |
| GET | `/api/storage/product-catalog/publish-status` | 发布状态 | 低 | 只读 |

---

## 2. 写操作非 POST 接口（需知晓；P1 计划 POST 化）

| 方法 | 路径 | 用途 | Schema 校验 |
|------|------|------|-------------|
| PATCH | `/api/users/:id` | 更新用户 | ✅ `updateUserBodySchema` |
| DELETE | `/api/users/:id` | 删除用户 | ✅ params |
| PATCH | `/api/actions/:id` | 更新举措 | ✅ |
| DELETE | `/api/actions/:id` | 删除举措 | ✅ params |
| PUT | `/api/storage/periods` | 保存周期 | ✅ |
| PUT | `/api/storage/records` | 全量替换 | ✅ |
| PATCH | `/api/storage/records/:id` | 更新工单 | ✅ params + body |
| POST | `/api/storage/records/batch` | 批量写入 | ✅ |
| DELETE | `/api/storage/records/:id` | 删除工单 | ✅ params |
| DELETE | `/api/storage/imported-data` | 清空导入 | ✅ query |
| PUT/PATCH/DELETE | `/api/storage/background-task*` | 任务锁 | ✅ acquire/touch |
| PUT | `/api/storage/runs` | 分析运行 | ✅ |
| PUT | `/api/storage/artifacts` | 产物 | ✅ |
| PUT | `/api/storage/snapshots` | 快照 | ✅ |
| PUT | `/api/storage/meta/:key` | 元数据 | ✅ params + body |
| PUT | `/api/storage/tag-candidates` | 标签候选 | ✅ |
| DELETE | `/api/storage/tag-candidates/:id` | 删除候选 | ✅ params |
| POST | `/api/llm/chat` | LLM 代理 | ✅（保留 OpenAI 扩展字段） |

图例：✅ 已接入 JSON Schema（`additionalProperties: false` 或 params 约束）。

---

## 3. 已统一 POST 的认证写接口

| 方法 | 路径 | Schema |
|------|------|--------|
| POST | `/api/auth/login` | `loginBodySchema` |
| POST | `/api/auth/change-password` | `changePasswordBodySchema` |
| POST | `/api/auth/logout` | —（递增 `session_version` 撤销 token） |

---

## 4. Token 撤销（session_version）

| 事件 | 行为 |
|------|------|
| 登录成功 | JWT 写入 `sv = users.session_version` |
| 登出 | `session_version += 1`，旧 token 全部失效 |
| 过期改密 / 管理员改密 | `session_version += 1` |
| 禁用用户 / 变更角色 | `session_version += 1` |
| API 鉴权 | `claims.sv !== row.session_version` → 401 |

验证：登录后调用 `/api/auth/me` 成功 → 登出 → 同一 token 再请求 → **401「登录已失效」**。

---

## 5. 参数 Schema 覆盖范围（P0）

| 模块 | 文件 |
|------|------|
| 认证 | `server/schemas/authSchemas.js` |
| 用户 | `server/schemas/userSchemas.js` |
| 举措 | `server/schemas/actionSchemas.js` |
| 存储写 | `server/schemas/storageWriteSchemas.js` |
| LLM | `server/schemas/llmSchemas.js` |

非法字段 / 枚举 / 长度：Fastify Ajv 校验失败 → **400** + `formatSchemaValidationError` 中文提示。

---

## 6. P1 安全增强（2026-06-01）

| 项 | 说明 |
|----|------|
| 记住我 | 已移除；JWT 仅存 `sessionStorage`，关闭浏览器即失效 |
| 密码复杂度 | ≥8 位，含大小写、数字、特殊字符；创建/改密/过期轮换均校验 |
| 登录限流 | `/api/auth/login` 失败次数超阈 → **429**（默认 5 次 / 15 分钟，按 IP+用户名） |
| 环境变量 | `LOGIN_RATE_LIMIT_MAX`、`LOGIN_RATE_LIMIT_WINDOW_MS` |

---

## 7. 修订记录

| 日期 | 说明 |
|------|------|
| 2026-06-01 | P0：Schema 基线 + session_version 撤销 + 本报备文档 |
| 2026-06-01 | P1：移除记住我、密码复杂度、登录限流、剩余写路由 Schema |
