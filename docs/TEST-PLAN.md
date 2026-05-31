# Feedback Insights 系统测试计划

**版本**：2026-06-02（增补条件清空回归）
**适用分支**：当前 `main` / 工作区  
**关联**：清空数据加固、投诉终判导入、共享 SQLite 存储

---

## 1. 测试目标

| 目标 | 说明 |
|------|------|
| 回归保护 | 确认 379+ 单元测试通过，构建无报错 |
| 核心业务 | 导入 → 周期筛选 → 洞察/打标 → 快照 → 报告链路可用 |
| 高风险项 | **清空数据**（选定范围 vs 全部）不误删；权限与审计正确 |
| 数据口径 | 列表/统计按 `importMonth` 与洞察周期一致；投诉终判字段入库完整 |
| 发布就绪 | 与 CI 一致：`npm test` + `npm run build`；可选 E2E |

---

## 2. 测试范围

### 2.1 纳入范围

- 前端页面：登录、工作台、洞察分析、反馈列表、导入、设置、标签管理、用户管理
- 存储层：IndexedDB 适配器、API 适配器、SQLite `storageRepository`
- 服务端：认证、权限、Storage API、健康检查、审计日志
- 领域逻辑：洞察周期、数据来源、导入解析、打标管道、快照构建
- **清空导入数据**：`clearImportedData.js`、设置页 UI、DELETE `/api/storage/imported-data`

### 2.2 不纳入（本次）

- 第三方 LLM 真实调用（使用 mock / 规则回退）
- 生产 Nginx / TLS / 备份恢复演练（见 [DEPLOY.md](./DEPLOY.md)）
- 性能压测、多租户隔离（当前为单租户 `local`）

---

## 3. 测试环境与数据

### 3.1 环境要求

| 项 | 要求 |
|----|------|
| Node | 20.x（与 CI 一致） |
| 依赖 | `npm ci` 或 `npm install` |
| 环境变量 | `JWT_SECRET`（≥16 字符）；空库 E2E/本地需 `ADMIN_INITIAL_PASSWORD` |
| SQLite | `better-sqlite3` 可编译（macOS/Linux CI）；沙箱环境可能 skip 14 项服务端测试 |
| 端口 | API `3001`，前端 `5175` |

### 3.2 推荐测试数据集（手工 / 集成）

在**独立临时库**（勿用生产 `server/data/auth.db`）准备：

| 记录 ID 前缀 | importMonth | dataSourceType | 用途 |
|--------------|-------------|----------------|------|
| `t-q2-c-` | 2026-04 ~ 2026-06 | complaint_ticket | Q2 投诉交集清空 |
| `t-q2-z-` | 2026-05 | consultation_ticket | Q2 咨询（清空 Q2+投诉 应保留） |
| `t-old-c-` | 2022-08 | complaint_ticket | 历史投诉（清空 Q2+投诉 应保留） |
| `t-q1-c-` | 2026-03 | complaint_ticket | Q1 投诉（清空 Q2+投诉 应保留） |

每条记录需含最小必填字段（`customerQuote`、`importedAt` 等），投诉类建议带 Excel「终判」列映射后的 `complaintCauseL1Final`。

洞察周期元数据：至少注册 `period:quarter:2026-Q2`（2026-04-01 ~ 2026-06-30）。

---

## 4. 测试分层与工具

| 层级 | 工具 | 命令 | 自动化 |
|------|------|------|--------|
| L1 单元 | Vitest | `npm test` | 是（84 文件，约 393 case） |
| L2 集成冒烟 | Vitest `src/test/smoke.integration.test.js` | 含在 `npm test` | 是 |
| L3 API/权限 | Vitest `server/routes/storage.permissions.test.js` 等 | 需 SQLite 可用 | 部分 skip |
| L4 构建 | Vite | `npm run build` | 是 |
| L5 E2E | Playwright | `npm run test:e2e` | 1 条冒烟 |
| L6 手工探索 | 浏览器 + 设置页 | 见第 6 节 | 否 |

### 4.1 通过标准

- **L1–L4**：0 failed；允许 documented skip（无 SQLite 时 14 skipped）
- **L5**：登录成功，洞察分析页周期条数三处一致
- **L6**：P0 用例全部 Pass；P1 允许记录已知缺陷

---

## 5. 测试案例（按模块）

优先级：**P0** 阻塞发布 | **P1** 重要 | **P2** 一般

### 5.1 认证与权限（AUTH / SEC）

| ID | 优先级 | 场景 | 步骤 | 预期 | 自动化 |
|----|--------|------|------|------|--------|
| AUTH-01 | P0 | 未登录访问受保护路由 | 直接访问 `/workbench` | 跳转登录 | E2E 间接 |
| AUTH-02 | P0 | 管理员登录 | 正确用户名密码 | 进入工作台 | E2E-01 |
| AUTH-03 | P0 | 错误密码 | 错误密码提交 | 提示失败，无 Token | 手工 |
| SEC-01 | P0 | Viewer 读记录 | GET `/api/storage/records` | 200，有数据 | storage.permissions |
| SEC-02 | P0 | Viewer 禁止 bootstrap | POST `bootstrap-from-local` | 403 | storage.permissions |
| SEC-03 | P0 | Editor 禁止团队设置 | PUT `meta/app_settings_shared_v1` | 403 | storage.permissions |
| SEC-04 | P0 | Admin 可写 meta | PUT `meta/app_settings_shared_v1` | 200 | storage.permissions |
| SEC-05 | P1 | 清空数据权限 | 非 admin 调用 DELETE imported-data | 403（若策略为仅 admin） | 待补 |

### 5.2 洞察周期与筛选（PER）

| ID | 优先级 | 场景 | 步骤 | 预期 | 自动化 |
|----|--------|------|------|------|--------|
| PER-01 | P0 | 按 importMonth 筛周期 | 记录 `importMonth=2025-05`，`createdAt` 在期外 | 仍算在 2025-05 月周期内 | smoke + insightPeriod.test |
| PER-02 | P0 | Q2 与记录交集 | Q2 周期 + 2026-05 投诉 | `recordMatchesPeriod` true | clearImportedData.test |
| PER-03 | P1 | 默认月周期 | 新建月粒度周期 | 起止日期正确 | insightPeriod.defaultMonth |
| PER-04 | P1 | 工作台周期切换 | 切换洞察周期 | 列表条数、快照一致 | 手工 / E2E 扩展 |

### 5.3 数据导入（IMP）

| ID | 优先级 | 场景 | 步骤 | 预期 | 自动化 |
|----|--------|------|------|------|--------|
| IMP-01 | P0 | 非法 importMonth | `2025-5`、空字符串 | 拒绝 | smoke |
| IMP-02 | P0 | 行元数据保留 | 行带 `importMonth` | 入库字段保留 | smoke |
| IMP-03 | P0 | 文件类型/大小 | `.exe`、超行数 | 校验失败 | smoke |
| IMP-04 | P0 | 投诉 Excel 终判列 | 导入含「投诉原因一级（终判）」 | `complaintCauseL1Final` 有值，非「未填写」 | recordFactory + 手工 |
| IMP-05 | P1 | 无初判列 | 映射表无初判字段 | 不写入 `problemType` 作终判 | 领域约定 + 手工 |
| IMP-06 | P1 | 批量导入后 stats | GET `/api/storage/stats` | total 增加正确 | 手工 |
| IMP-07 | P2 | 导入预览 | 上传前预览 | 列映射正确 | importPreview.test |

### 5.4 打标与标签库（TAG）

| ID | 优先级 | 场景 | 步骤 | 预期 | 自动化 |
|----|--------|------|------|------|--------|
| TAG-01 | P0 | 管道 importMonth | 处理行 | `importMonth` 写入记录 | pipeline.importMonth |
| TAG-02 | P1 | 标签库导入校验 | 空问题类型名 | 失败 | smoke TAG-07 |
| TAG-03 | P1 | 候选复核合并 | approve 候选 | 并入 managed snapshot | smoke REV-03 |
| TAG-04 | P1 | 旅程/VPC 迁移 | 内置旅程键 | 迁移不丢环节 | migrateVpcJourneys 等 |
| TAG-05 | P2 | LLM 客户端 | mock 请求 | 超时/错误可处理 | llmClient.test |

### 5.5 快照与洞察（INS / SNP）

| ID | 优先级 | 场景 | 步骤 | 预期 | 自动化 |
|----|--------|------|------|------|--------|
| SNP-01 | P1 | 来源快照构建 | 有记录 + 周期 | snapshot id 符合约定 | buildSourceSnapshot |
| SNP-02 | P1 | 概览结论 | 有快照数据 | 结论结构合法 | buildOverviewConclusions |
| INS-01 | P0 | 周期条数一致 | 洞察分析页 | 侧栏/标题/描述三处 count 相同 | E2E-01 |
| INS-02 | P1 | 投诉原因统计 | 列表有终判字段 | 统计按 `complaintCauseL1Final` | 手工 |
| INS-03 | P2 | 报告导出 | 导出 PDF/对比 | 不崩溃 | quoteComparison 等 |

### 5.6 存储与同步（STG）

| ID | 优先级 | 场景 | 步骤 | 预期 | 自动化 |
|----|--------|------|------|------|--------|
| STG-01 | P0 | IDB 读写反馈 | save/load |  round-trip 正确 | feedbackStore.test |
| STG-02 | P0 | API 适配器清空参数 | `{ all: true }` | 请求带 `scope=all` | 代码审查 + 待集成测 |
| STG-03 | P1 | 记录索引 | 按 period/source 查询 | SQL where 与 JS 过滤一致 | recordIndex.test |
| STG-04 | P1 | 健康检查 | GET `/health` | `dbOk`、`recordCount` | health.test（需 SQLite） |

### 5.7 清空数据（CLR）— 重点回归

| ID | 优先级 | 场景 | 步骤 | 预期 | 自动化 |
|----|--------|------|------|------|--------|
| CLR-01 | P0 | 空参数 API | `DELETE /api/storage/imported-data` 无 query | **400**，不删数据 | **待补** integration |
| CLR-02 | P0 | 全部清空 | `?scope=all` 或 `{ all: true }` | 删 records/snapshots/runs/artifacts/pending；保留设置/标签库/已处理候选 | clearImportedData + feedbackStore |
| CLR-03 | P0 | 设置页条件清空校验 | 仅选周期或仅选来源 | UI 禁用或 validateScoped 报错 | clearImportedData.test |
| CLR-04 | P0 | Q2 + 投诉交集 | 准备 §3.2 数据集，清空 `period:quarter:2026-Q2` + `complaint_ticket` | 仅删 Q2 投诉；**保留**咨询、2022 投诉、Q1 投诉 | `clearImportedData.test` + `feedbackStore.test`（IDB scoped）；repository 集成待补 |
| CLR-05 | P0 | 仅来源（API） | `?dataSourceType=complaint_ticket` | 删所有月份投诉；不删咨询 | describeClearImportedScopeRisk + 手工 |
| CLR-06 | P0 | 仅周期（API） | `?insightPeriodId=...Q2` | 删 Q2 月范围内全部来源 | 手工 |
| CLR-07 | P1 | 快照删除范围 | 条件清空后 | 对应 `snapshot:{period}:{source}` 删除 | snapshotMatchesClearFilter |
| CLR-08 | P1 | 审计日志 | 清空后查审计 | `storage.clear_imported_data` 含 scope/period/source/deleted 计数 | 手工 |
| CLR-09 | P1 | clearAll 上下文 | 设置「清空全部数据」 | 传 `{ all: true }`；条件清空须走 `clearAllImportedData(options)`，**不得**经 `clearAllFeedbacks()` | InsightsContext + feedbackStore.test |
| CLR-10 | P2 | 浏览器 IDB 脚本 | `scripts/clear-in-browser.js` | 仅清本地 IDB，不动服务端库 | 文档/手工 |

### 5.8 配置与构建（CFG / BLD）

| ID | 优先级 | 场景 | 步骤 | 预期 | 自动化 |
|----|--------|------|------|------|--------|
| CFG-01 | P0 | 无 JWT 启动 API | 未设置 `JWT_SECRET` | 进程拒绝启动 | config.test |
| CFG-02 | P1 | 生产 CORS | `NODE_ENV=production` 无 CORS | 启动失败 | config.test |
| BLD-01 | P0 | 前端生产构建 | `npm run build` | 成功产出 `dist/` | CI |

### 5.9 端到端（E2E）

| ID | 优先级 | 场景 | 步骤 | 预期 | 自动化 |
|----|--------|------|------|------|--------|
| E2E-01 | P0 | 登录与周期条数 | 登录 → `/workbench/analysis` | 三处 period count 一致 | e2e/smoke.spec.js |
| E2E-02 | P1 | 设置页条件清空 | 选 Q2+投诉 → 确认 | 仅目标数据消失（需种子数据） | **待补** |
| E2E-03 | P2 | 导入向导 | 上传小样 Excel | 成功提示、列表可见 | **待补** |

---

## 6. 手工测试检查清单（P0）

执行前：复制 `server/data/auth.db` 备份，或使用 `e2e-data/` 独立库。

- [ ] **AUTH-02** 管理员登录成功
- [ ] **IMP-04** 导入 4 月投诉样例，详情/列表显示终判一级（非「未填写」）
- [ ] **INS-01** 洞察分析页三处条数一致
- [ ] **CLR-04** 在测试库执行「2026 Q2 + 投诉工单」清空后，咨询与 2022 投诉仍在
- [ ] **CLR-02** 仅在确认后执行「清空全部数据」，审计为 `scope: all`
- [ ] **CLR-01**（可选）用 curl 无参 DELETE，应 400

```bash
# 示例：条件清空（需 admin token）
curl -X DELETE 'http://127.0.0.1:3001/api/storage/imported-data?insightPeriodId=period:quarter:2026-Q2&dataSourceType=complaint_ticket' \
  -H "Authorization: Bearer $TOKEN"

# 全部清空（必须显式 scope）
curl -X DELETE 'http://127.0.0.1:3001/api/storage/imported-data?scope=all' \
  -H "Authorization: Bearer $TOKEN"
```

---

## 7. 执行顺序（推荐）

```bash
# 1. 单元 + 集成（约 5s）
export JWT_SECRET="$(openssl rand -base64 32)"
npm test

# 2. 构建
npm run build

# 3. E2E（启动 API+前端，约 2min，需本机 SQLite）
npm run test:e2e

# 4. 手工 P0（第 6 节）
```

### 7.1 结果记录模板

| 执行项 | 日期 | 执行人 | 通过/失败 | 备注 |
|--------|------|--------|-----------|------|
| npm test | | | | passed / failed / skipped N |
| npm run build | | | | |
| npm run test:e2e | | | | |
| 手工 CLR-04 | | | | |

---

## 8. 已知缺口与改进建议

| 缺口 | 风险 | 建议 |
|------|------|------|
| 无 `storageRepository.clearImportedData` 集成测 | CLR-04 仅靠单元过滤函数 | 新增 `server/storageRepository.clear.test.js`（内存 DB） |
| DELETE 无参 400 无自动化 | 误删回归 | API inject 测试 1 条 |
| E2E 仅 1 案例 | 清空/导入 UI 未覆盖 | 增加 E2E-02、E2E-03 |
| 沙箱 skip 14 tests | 本地未验 SQLite 路径 | macOS 全量跑时确认 0 skip |
| Playwright 未入默认 `npm test` | CI 分 job，本地易漏 | PR 前显式跑 `test:e2e` |

---

## 9. 与历史事故的对照（回归必测）

**事故**：用户以为只清「2026 Q2 投诉」，实际删掉全部 132 条（根因：`InsightsContext` 误调 `clearAllFeedbacks()`，忽略 scoped options）。

| 检查点 | 对应用例 |
|--------|----------|
| 空 `{}` 不等于全部清空 | CLR-01、CLR-02 |
| 设置页必须周期+来源才能点「清空选中范围」 | CLR-03 |
| 条件清空走 `clearAllImportedData(options)`，非 `clearAllFeedbacks()` | CLR-09、feedbackStore scoped 测 |
| 审计 `clear_imported_data` 应带 `insightPeriodId`/`dataSourceType`（条件清空时） | CLR-08 |
| Q2∩投诉 不删咨询/2022 | CLR-04 |

---

## 10. 附录：现有自动化映射

| 测试文件 | 主要覆盖 |
|----------|----------|
| `src/storage/clearImportedData.test.js` | CLR-02~07 过滤逻辑；周期 ID 无 meta 时 `recordMatchesClearFilter` |
| `src/storage/feedbackStore.test.js` | STG-01、CLR-02 IDB 全清；**CLR-04** scoped 条件清空 |
| `src/test/smoke.integration.test.js` | IMP-01~04、PER-01、TAG-07 |
| `server/routes/storage.permissions.test.js` | SEC-01~04 |
| `e2e/smoke.spec.js` | E2E-01 / INS-01 |
| `src/domain/complaintCause.test.js` | 终判字段解析 |
| `src/lib/recordFactory.test.js` | 入库字段复制 |

**当前基线（2026-05-25）**：`npm test` → 379 passed，14 skipped（3 文件需 SQLite）。
