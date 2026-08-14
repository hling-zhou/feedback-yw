# Feedback Insights 系统测试计划

**版本**：2026-06-05（用后即评回访满意度 P6 收口）
**适用分支**：当前 `main` / 工作区  
**关联**：清空数据加固、投诉终判导入、共享 SQLite 存储

---

## 1. 测试目标

| 目标 | 说明 |
|------|------|
| 回归保护 | 确认 720+ 单元测试通过，构建无报错 |
| 核心业务 | 导入 → 周期筛选 → 洞察/打标 → 快照 → 报告链路可用 |
| 高风险项 | **清空数据**（选定范围 vs 全部）不误删；权限与审计正确 |
| 数据口径 | 列表/统计按 `importMonth` 与洞察周期一致；投诉终判字段入库完整 |
| 发布就绪 | 与 CI 一致：`npm test` + `npm run build`；可选 E2E |

---

## 2. 测试范围

### 2.1 纳入范围

- 前端页面：登录、工作台、洞察分析、反馈列表、导入、设置、对象与标签、用户管理
- **LLM 打标 P0 优化**（设计稿）：[LLM-TAGGING-P0-DESIGN.md](./LLM-TAGGING-P0-DESIGN.md) — 已实现；自动化见 §5.4.1 TAG-LLM；**发布/UAT**：[LLM-TAGGING-P0-UAT.md](./LLM-TAGGING-P0-UAT.md)
- **请求场景 V2 + Post-LLM 维度重打**（2026-06-02）：[data/请求场景标签体系及打标规则.md](../data/请求场景标签体系及打标规则.md)；[TICKET-ANALYSIS-P0-RULES.md](./TICKET-ANALYSIS-P0-RULES.md) §5.5；自动化 §5.4.2 TAG-RS、§5.4.3 TAG-RT
- **客户请求 / 痛点 V2 golden**（2026-06-02）：[data/从单条工单提取客户请求内容挖掘需求痛点.md](../data/从单条工单提取客户请求内容挖掘需求痛点.md) §1.4/§2.4；夹具 `fixtures/v2TicketExamples.js`；自动化 §5.4.4 TAG-CR/TAG-PP
- **痛点聚类 & 行动建议 Phase 1**（V2.0）：[`docs/PAIN-POINT-CLUSTERING.md`](./PAIN-POINT-CLUSTERING.md)；自动化 §5.4.5 TAG-CL；性能/Job 见 [`PAIN-POINT-CLUSTERING-PERF-PLAN.md`](./PAIN-POINT-CLUSTERING-PERF-PLAN.md)
- **导出 v2 UAT**：[EXPORT-V2-UAT.md](./EXPORT-V2-UAT.md)；自动化 §5.4.3b TAG-EXP-V2
- **工单详情 P2-0 布局**：[DESIGN-20260601-1.md](./DESIGN-20260601-1.md) §3.1；自动化 §5.4.3c TAG-UI-P2-0
- **工单详情 P2-2 根因排查**：[DESIGN-20260601-1.md](./DESIGN-20260601-1.md) §3.1 D 区；自动化 §5.4.3d TAG-UI-P2-2
- **工单详情 P2-1 确立举措**：[DESIGN-20260601-1.md](./DESIGN-20260601-1.md) §3.1 C 区；自动化 §5.4.3e TAG-UI-P2-1
- **工单详情 P2-3 产品组/设计师**：[DESIGN-20260601-1.md](./DESIGN-20260601-1.md) §3.1 C 区；自动化 §5.4.3f TAG-UI-P2-3
- **工单详情 P2-4 排期**：[DESIGN-20260601-1.md](./DESIGN-20260601-1.md) §3.1 C 区；自动化 §5.4.3g TAG-UI-P2-4
- **manualTagFields P2-5**：[DESIGN-20260601-1.md](./DESIGN-20260601-1.md) §3.1；自动化 §5.4.3h TAG-M2-P2-5
- **来源 Tag P2-6**：[DESIGN-20260601-1.md](./DESIGN-20260601-1.md) §3.1 来源 Tag；自动化 §5.4.3i TAG-UI-P2-6
- **工单详情 P2-7 UAT**：[FEEDBACK-DRAWER-UAT.md](./FEEDBACK-DRAWER-UAT.md)；自动化 §5.4.3j TAG-UI-P2-7
- **导入分析 P3-1 入口**：[DESIGN-20260601-1.md](./DESIGN-20260601-1.md) §3.3；自动化 §5.4.3k TAG-IMP-P3-1
- **用后即评 · 回访满意度 P0–P6**：[DESIGN-用后即评-满意度回访.md](./DESIGN-用后即评-满意度回访.md)；自动化 §5.4.3l TAG-FU；**UAT**：[FOLLOW-UP-SATISFACTION-UAT.md](./FOLLOW-UP-SATISFACTION-UAT.md)
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
| L1 单元 | Vitest | `npm test` | 是（126 文件，约 722 case） |
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

#### 5.4.1 LLM 打标 P0 验收（TAG-LLM）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-LLM-01~10 | P0 | unified ticket LLM + optimization 三层 | U-01~U-10 | ticketAnalysisUnifiedLLM.test 等 |
| TAG-LLM-11~15 | P0 | 旅程门控 | G-01~G-05 | journeyMatchConfidence.test |
| TAG-LLM-16~20 | P0 | 流水线重排 + 补打 | O-01~O-05、R-01~R-03 | applyThemes / importEnrichment.test |
| TAG-LLM-21 | P0 | U-06 golden 20 条 | request/pain Jaccard ≥0.85 | ticketLlmGolden.test |
| TAG-LLM-22 | P0 | O-golden optimization 率 | unified ≥ separate×90% | ticketLlmGolden.test |
| TAG-LLM-23 | P0 | Token 调用降幅 | 500 条 ≥40% | ticketLlmGolden.unit.test + `scripts/benchmark-ticket-llm.mjs` |
| TAG-LLM-24 | P1 | 洞察聚类稳定性 | 同 pain+journeyL1 簇数变化 <10% | insightClusterStability.test |

#### 5.4.2 请求场景 V2 决策树（TAG-RS）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-RS-01 | P0 | 规则文档 §4 golden 10 条 | 与文档一致分类 | `requestSceneClassifier.test.js` |
| TAG-RS-02 | P0 | 无关键词短文本 | 默认「产品信息咨询」 | `requestSceneClassifier.test.js` |
| TAG-RS-03 | P0 | 投诉工单请求场景 | 决策树，不调 LLM | `dimensionTagging.test.js` |
| TAG-RS-04 | P0 | 单条导入 + 路径兜底 | 内容优先 / 路径 fallback | `ticketDimensionTagging.test.js` |
| TAG-RS-05 | P1 | V1 标签迁移 | `报障与恢复` → `报障与排错` 等 | `migrateSharedTags.test.js` |
| TAG-RS-06 | P1 | 标签库 9 类 | Excel/index 与 `REQUEST_SCENES_BUILTIN` 一致 | `ensureBuiltinRequestScenes.test.js` + 手工核对 `打标配置.xlsx` |
| TAG-RS-07 | P1 | 历史工单刷新 | 批量重新打标后请求场景为 V2 标签 | 手工：反馈库 → 批量重新打标 → 抽样 |

#### 5.4.3 Post-LLM 维度重打（TAG-RT）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-RT-01 | P0 | ticket LLM 后默认重打 | `retagRecordsSharedDimensionsAfterTicketLlm` 在 import/reprocess 中调用 | `applyThemes.test.js` O-01/O-04；`importEnrichment.test.js` |
| TAG-RT-02 | P0 | 仅 LLM 语料参与重打 | `llmCorpusOnly` 跳过 rule-only 记录 | `dimensionTaggingText.test.js`、`dimensionTagging.test.js` |
| TAG-RT-03 | P0 | §3 对端排除 | 全文含协办诊断 → 问题类型 `产品功能咨询` | `dimensionTagging.test.js` |
| TAG-RT-04 | P1 | 关闭重打 | `retagDimensionsAfterTicketLlm=false` 跳过重打 | `applyThemes.test.js` O-06 |
| TAG-RT-05 | P1 | 设置与批量重打 | 团队设置 + 弹窗单次覆盖 | 手工：设置 → 维度打标；反馈库批量重打弹窗 |

#### 5.4.3a 需求@20260601 M0 治理（TAG-M0）

设计：[DESIGN-20260601-1.md](./DESIGN-20260601-1.md) · 任务：[TASKS-20260601-1.md](./TASKS-20260601-1.md)

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-M0-01 | P0 | Field Registry v2 列序 | 导出/导入 18 列顺序与设计一致 | `fieldRegistry.test.js` |
| TAG-M0-02 | P0 | Override Policy | FORCE / IMPORT_REPLACE / RESPECT 三策略 | `overridePolicy.test.js` |
| TAG-M0-03 | P0 | 强制覆盖全 scope | 全量/补打/补打旅程 + 强制覆盖均清空人工并回退根因 | `manualTagFields.test.js`；手工：三 scope 各 1 条 |
| TAG-M0-04 | P0 | 根因排查 effective | 优先人工字段，否则问题原因/rootCause | `rootCauseReview.test.js` |
| TAG-M0-05 | P1 | Legacy 三字段停写 | 新建记录 legacy 复核字段为空 | `recordFactory` + grep |
| TAG-M0-06 | P0 | 导入来源 UI | import/manual → Tag「人工」 | `ticketAnalysisSources.test.js` |
| TAG-M0-07 | P0 | 咨询终判完整性 | 咨询单缺终判快照列不触发 incomplete | `sourceColumns.test.js` |

#### 5.4.3b 导出 v2 UAT（TAG-EXP-V2）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-EXP-V2-01 | P0 | 18 列表头 | 与 Registry 一致 | `ticketAnalysisExport.test.js` |
| TAG-EXP-V2-02 | P0 | 投诉/咨询各 10 条 fixture | 无终判/legacy 列 | `ticketAnalysisExport.uat.test.js` |
| TAG-EXP-V2-03 | P0 | 空排期 R1 | 排期列为空 | 同上 |
| TAG-EXP-V2-04 | P0 | 根因排查 effective | 人工>问题原因>rootCause | 同上 |
| TAG-EXP-V2-05 | P0 | 导出→导入往返 | IMPORT_REPLACE 核心字段一致 | 同上 |
| TAG-EXP-V2-06 | P1 | 真实库抽样 | 5+5 手工核对 | [EXPORT-V2-UAT.md](./EXPORT-V2-UAT.md) §2.2 |

#### 5.4.3c 工单详情布局（TAG-UI-P2-0）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-UI-P2-0-01 | P0 | 分区顺序 | A→B1→B2→C→D；处理意见在 C 之后 | `FeedbackDrawer.layout.test.js` |
| TAG-UI-P2-0-02 | P1 | 打开投诉/咨询工单 | B 区仍在 meta 下最上；处理意见在优化建议下 | 手工 UAT（P2-7） |

#### 5.4.3d 根因排查详情（TAG-UI-P2-2）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-UI-P2-2-01 | P0 | 未人工维护 | 详情展示 effective；保存其它字段不误写 rootCauseReview | `rootCauseReview.test.js` |
| TAG-UI-P2-2-02 | P0 | 编辑保存 | manualTagFields 含 rootCauseReview；导出列一致 | `rootCauseReview.test.js` + 导出 UAT |
| TAG-UI-P2-2-03 | P0 | 1000 字限制 | normalize 截断 | `rootCauseReview.test.js` |
| TAG-UI-P2-2-04 | P0 | D 区顺序 | 处理意见 → 根因排查 → 备注 | `FeedbackDrawer.layout.test.js` |
| TAG-UI-P2-2-05 | P1 | FORCE 重打标后 | 回退 fallback 后可再编辑保存 | 手工 UAT（P2-7） |

#### 5.4.3e 确立举措详情（TAG-UI-P2-1）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-UI-P2-1-01 | P0 | 展示/读取 | establishedAction 优先于 manualReviewOptimization | `establishedAction.test.js` |
| TAG-UI-P2-1-02 | P0 | 保存双写 | 两字段同值；manualTagFields 含 optimization | `establishedAction.test.js` + export UAT |
| TAG-UI-P2-1-03 | P0 | 1000 字限制 | normalize 截断 | `establishedAction.test.js` |
| TAG-UI-P2-1-04 | P1 | 编辑保存后导出 | 「确立举措」列有值 | `ticketAnalysisExport.test.js` |

#### 5.4.3f 产品组/设计师建议（TAG-UI-P2-3）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-UI-P2-3-01 | P0 | Registry | clusterRole=none；暂不参与 v2 导出 | `detailOptimizationFields.test.js` |
| TAG-UI-P2-3-02 | P0 | 保存 normalize | 1000 字截断 | `detailOptimizationFields.test.js` |
| TAG-UI-P2-3-03 | P0 | 语料排除 | 不进入 getEffectiveOptimization / collect | `ticketOptimizationExtract.test.js` |
| TAG-UI-P2-3-04 | P0 | C 区顺序 | 自动优化 → 产品组/设计师 → 确立举措 | `FeedbackDrawer.layout.test.js` |
| TAG-UI-P2-3-05 | P1 | 详情编辑保存 | 刷新后字段保留 | 手工 UAT（P2-7） |

#### 5.4.3g 排期字段（TAG-UI-P2-4）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-UI-P2-4-01 | P0 | 空排期 R1 | normalize 为空；导出「排期」列为空 | `actionSchedule.test.js` |
| TAG-UI-P2-4-02 | P0 | 有排期 | 导出列与 actionSchedule 一致 | `actionSchedule.test.js` |
| TAG-UI-P2-4-03 | P0 | 只读展示 | 空排期显示「待评估」 | `actionSchedule.test.js` |
| TAG-UI-P2-4-04 | P0 | 保存联动 | actionSchedule 写入 patch；optimization 维度 | `manualTagFields.test.js` |
| TAG-UI-P2-4-05 | P0 | C 区顺序 | 确立举措 → 排期 | `FeedbackDrawer.layout.test.js` |
| TAG-UI-P2-4-06 | P1 | 详情编辑 | 留空可保存 | 手工 UAT（P2-7） |

#### 5.4.3h manualTagFields 扩展（TAG-M2-P2-5）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-M2-P2-5-01 | P0 | merge 维度 | customerRequest / painPoint 写入 manualTagFields | `ticketAnalysisManualFields.test.js` |
| TAG-M2-P2-5-02 | P0 | preserve + 来源 | 重打标保留人工值与 customerRequestSource | 同上 |
| TAG-M2-P2-5-03 | P0 | pipeline 集成 | reprocessFeedbackRecord 默认保留人工客户请求 | 同上 |
| TAG-M2-P2-5-04 | P0 | 详情可编辑 | C 区客户请求/痛点 TextArea | `FeedbackDrawer.jsx` |
| TAG-M2-P2-5-05 | P1 | bulk retag | 改客户请求后批量重打标仍保留 | 手工 UAT（P2-7） |

#### 5.4.3i 来源 Tag 规则（TAG-UI-P2-6）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-UI-P2-6-01 | P0 | 确立举措 | OptimizationSourceTag → 人工 | `ticketAnalysisSources.test.js` |
| TAG-UI-P2-6-02 | P0 | legacy manualReviewOptimization | 优化来源 → 人工 | 同上 |
| TAG-UI-P2-6-03 | P0 | import/manual 库内值 | 三项 Tag UI 均显示人工 | 同上 |
| TAG-UI-P2-6-04 | P0 | manualTagFields 兜底 | 客户请求/痛点人工维护 → 人工 | 同上 |
| TAG-UI-P2-6-05 | P1 | 详情 Tag 目视 | 规则/大模型/人工三色正确 | 手工 UAT（P2-7） |

#### 5.4.3j 工单详情 UAT 汇总（TAG-UI-P2-7）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-UI-P2-7-01 | P0 | 10 条样例 | 投诉/咨询各 5 | `detailDrawerUatSamples.js` |
| TAG-UI-P2-7-02 | P0 | 保存→导出 | 10 条核心列一致 | `FeedbackDrawer.uat.test.js` |
| TAG-UI-P2-7-03 | P0 | B2 终判 | 仅投诉；咨询无 Card | 同上 + layout test |
| TAG-UI-P2-7-04 | P0 | canEdit 双路径 | 编辑/只读分支存在 | `FeedbackDrawer.uat.test.js` |
| TAG-UI-P2-7-05 | P1 | 真实库 5+5 | 布局/编辑/重开/只读 | [FEEDBACK-DRAWER-UAT.md](./FEEDBACK-DRAWER-UAT.md) §2.2 |
| TAG-UI-P2-7-06 | P1 | bulk retag 保留 | 人工客户请求保留 | 手工 UAT §2.2 |

#### 5.4.3k 导入分析入口（TAG-IMP-P3-1）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-IMP-P3-1-01 | P0 | Tab 区分 | 工单 Excel vs 分析结果 | `ImportHub.jsx` + `/import?tab=analysis` |
| TAG-IMP-P3-1-02 | P0 | R3 文案 | 仅更新已存在工单 | `ImportAnalysis.jsx` |
| TAG-IMP-P3-1-03 | P0 | 模板表头 | 18 列 = export v2 | `importAnalysisTemplate.test.js` |
| TAG-IMP-P3-1-04 | P0 | 排期可空 | 必填不含排期 | `importAnalysisTemplate.test.js` |
| TAG-IMP-P3-1-05 | P1 | 下载模板 | Excel 首行表头正确 | 手工：设置 → 数据导入 → 分析 Tab |

#### 5.4.3l 用后即评 · 回访满意度（TAG-FU）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-FU-01 | P0 | 领域模型 | score/解析/展示 `10（已解决）`；趋势月份 fallback | `followUpSatisfaction.test.js` |
| TAG-FU-02 | P0 | Field Registry | 回访两列位于「是否加急」后；仅投诉/咨询 | `fieldRegistry.test.js` |
| TAG-FU-03 | P0 | 回访导入匹配 | 原工单号 patch、幂等、跳过非成功 | `followUpSatisfactionImport.test.js` + `server/routes/followUpSatisfactionImport.test.js` |
| TAG-FU-04 | P1 | 列表列 | 「数据来源」后「回访满意度」 | 手工 UAT U-02 / `FeedbackTable` |
| TAG-FU-05 | P1 | 详情展示 | 加急后回访满意度；客户请求上不满意原因 | `ticketDetailDisplay.test.js` + UAT U-06 |
| TAG-FU-06 | P1 | 反馈库筛选 | 有/无回访、10/非10、已/未解决、reasonDim | `feedbackFilters.test.js` |
| TAG-FU-07 | P1 | URL drill-down | `?followUp=non10&requestScene=` 可复现 | `feedbackFilters.test.js` + UAT U-13 |
| TAG-FU-08 | P0 | 幂等覆盖 | 同回访工单号更新；不同号覆盖原工单 | `followUpSatisfactionImport.test.js` + 集成测 |
| TAG-FU-09 | P0 | 10 分率分母 | 仅 `followUpSuccessful && 有效 score` | `followUpSatisfactionAnalytics.test.js` + 集成测 |
| TAG-FU-10 | P0 | 导出 v3 列 | 21 列含回访/不满意原因 | `ticketAnalysisExport.test.js` |
| TAG-FU-11 | P0 | Sheet 分组 | 数据来源 + importMonth | `ticketAnalysisExport.test.js` + 集成测 |
| TAG-FU-12 | P1 | round-trip | 导出→导入仅 patch 回访 | `importAnalysis.test.js` + `overridePolicy.test.js` + 集成测 |
| TAG-FU-13 | P1 | 快照预聚合 | post_use_rating 快照含 `followUpSatisfactionMetrics` | `buildSourceSnapshot.test.js` + 集成测 |
| TAG-FU-14 | P1 | 分析聚合 | 非 10 分分布、88% 基线、未解决占比 | `followUpSatisfactionAnalytics.test.js` |
| TAG-FU-15 | P1 | 下钻 URL 构建 | `buildFollowUpDrillDownUrl` 默认 non10 | `feedbackFilters.test.js` + 集成测 |
| TAG-FU-16 | P2 | 工作台面板 | 趋势/分布/条形图/产品联动 | `FollowUpSatisfactionPanel.jsx` + UAT U-09～12 |
| TAG-FU-17 | P2 | PDF 钩子 | `data-pdf-chart=followup-*` 不报错 | `captureChartImages.js` + 报告手工 |
| TAG-FU-18 | P1 | 周期外补全 | `outOfPeriodWarning` 写入 | `followUpSatisfactionImport.test.js` + 集成测 |

**UAT 清单**：[FOLLOW-UP-SATISFACTION-UAT.md](./FOLLOW-UP-SATISFACTION-UAT.md)  
**端到端集成**：`src/lib/followUpSatisfaction.integration.test.js`

#### 5.4.4 客户请求 / 痛点 V2 golden（TAG-CR / TAG-PP）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-CR-01 | P0 | §1.4 共 11 条 | 规则层：关键词 + ≤120 字；LLM mock：Jaccard ≥0.85 | `v2TicketExamples.test.js` |
| TAG-CR-02 | P0 | validateTicketAnalysisPair | LLM golden 客户请求校验通过 | `v2TicketExamples.test.js` |
| TAG-PP-01 | P0 | §2.4 共 10 条 | 规则层：关键词 + ≤80 字、无引导语；LLM mock：Jaccard ≥0.85 | `v2TicketExamples.test.js` |
| TAG-PP-02 | P0 | validateTicketAnalysisPair | LLM golden 痛点校验通过 | `v2TicketExamples.test.js` |

#### 5.4.5 痛点聚类 Phase 1（TAG-CL）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-CL-01 | P0 | 一次聚类分组 + Jaccard | 产品×来源×L1；簇≥2；孤立点 | `painPointClustering.test.js` |
| TAG-CL-02 | P0 | 低价值剔除 | `配额与权限申请`/`其他` 不进二次聚类 | `painPointClustering.test.js` |
| TAG-CL-03 | P0 | 二次聚类 + recordIds 去重 | 跨 L1/来源合并；ID 去重 | `painPointClustering.test.js` |
| TAG-CL-04 | P0 | Top10 评分 | 广度+危害度公式、并列排序、截断 | `painPointClustering.test.js` |
| TAG-CL-05 | P0 | §8 行动建议 | harmScore/customerTier/分布行 | `buildClusterActionRecommendations.test.js` |
| TAG-CL-06 | P0 | 来源快照 + 旅程 Tab | 读快照 L2 子集；无快照频次回退 | `painPointClustering.test.js` L0-1 |
| TAG-CL-07 | P1 | 概览重算 / legacy 回退 | V2 引擎 + legacyFallback | `rehydrateOverviewRecommendations.test.js` |
| TAG-CL-08 | P1 | 聚类稳定性 | mock 前后簇数变化 <10% | `insightClusterStability.test.js` |
| TAG-CL-12 | P1 | M2-4 Top10 golden | 固定夹具 Top10 与 golden τ≥0.85；优化 vs naive τ≥0.85 | `clusteringTop10Golden.test.js` |
| TAG-CL-09 | P1 | 快照集成 | `painPointClustering` 写入来源快照 | `painPointClusteringIntegration.test.js` |
| TAG-CL-10 | P2 | 空痛点跳过 / L1 回退 / label 辅助 | P2 区块 | `painPointClustering.test.js` |
| TAG-CL-11 | P2 | exact 预合并 key | 标点空白归一 | `normalizePainPoint.test.js` |
| TAG-CL-13 | P2 | 行动建议「生成规则」问号弹窗 | 文案含 V2 聚类流程与 Top N 常量 | `planningRecommendationTemplate.test.js` |

#### 5.4.6 洞察快照重建 Job（TAG-IR）

| ID | 优先级 | 场景 | 预期 | 自动化 |
|----|--------|------|------|--------|
| TAG-IR-01 | P0 | 服务端异步重建 | 入队 → running → succeeded；快照 status=ready | `server/insightRebuildJob.test.js` |
| TAG-IR-02 | P0 | 同周期去重 | active job 存在时不重复入队 | `server/insightRebuildJob.test.js` |
| TAG-IR-03 | P1 | 前端重建路径 | `InsightsContext` 优先 `startInsightRebuild` + 轮询 | 代码审查；手工工作台「生成/刷新洞察」 |
| TAG-IR-04 | P1 | 导入后入队 | `rebuildSnapshotsForImportMonth` 触发 Job | 手工导入后观察 Network |

### 5.5 快照与洞察（INS / SNP）

| ID | 优先级 | 场景 | 步骤 | 预期 | 自动化 |
|----|--------|------|------|------|--------|
| SNP-01 | P1 | 来源快照构建 | 有记录 + 周期 | snapshot id 符合约定 | buildSourceSnapshot |
| SNP-02 | P1 | 概览结论 | 有快照数据 | 结论结构合法 | buildOverviewConclusions |
| SNP-03 | P1 | 服务端 Job 重建 | POST insight-rebuild | 周期快照 ready；概览含 pain_cluster_v2 | TAG-IR-01 + 手工 |
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

**LLM 打标 P0 发布/UAT**（导入、补打、门控、回滚）：见专用清单 [LLM-TAGGING-P0-UAT.md](./LLM-TAGGING-P0-UAT.md)。

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
| `src/lib/ticketAnalysis/v2TicketExamples.test.js` | TAG-CR / TAG-PP（§1.4/§2.4 golden） |
| `src/lib/painPointClustering/*.test.js` | TAG-CL-01~11（聚类、行动建议、normalize） |
| `src/snapshots/painPointClusteringIntegration.test.js` | TAG-CL-09 快照集成 |
| `src/lib/painPointClustering/clusteringTop10Golden.test.js` | TAG-CL-12 M2-4 Top10 Kendall τ |
| `src/lib/painPointClustering/kendallTau.test.js` | Kendall τ 工具 |
| `src/lib/planningRecommendationTemplate.test.js` | TAG-CL-13 行动建议生成规则 UI |
| `server/insightRebuildJob.test.js` | TAG-IR 服务端快照重建 Job |
| `src/domain/insightRebuildJob.test.js` | Job 领域模型 |

**当前基线（2026-06-03）**：`npm test` → 722 passed，14 skipped（3 文件需 SQLite；`storage.permissions` bootstrap 测 1 known flake）。
