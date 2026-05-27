# ADR-001: v2 领域模型与存储基线

## 状态

**已接受（2026-05-20）** — 下文「IndexedDB 为主存储」部分已被后续实现取代，见 [当前架构（2026-05 起）](#当前架构2026-05-起)。

## 背景

v1 将全部反馈存入 `localStorage` 单 key，无法支撑多数据来源、过程留存与洞察快照。v2 先建立领域契约与 `StorageAdapter` 抽象，再迁移 UI 与协作存储。

## 历史决策（2026-05-20，已由共享 API 存储取代）

当时计划以浏览器 **IndexedDB**（`feedback-insights-v2`）为主、`FeedbackContext` 逐步切换。下列条目描述的是**该阶段的意图**，不是当前运行方式：

1. **schemaVersion** 固定为 `2.0`（**仍有效**）。
2. **tenantId** 默认 `local`（**仍有效**）。
3. ~~业务数据主存 IndexedDB~~ → 现为服务端 SQLite + `ApiStorageAdapter`。
4. **分层 Record**：`BaseRecord` + 按 `dataSourceType` 扩展（**仍有效**）。
5. **事件**：内存 EventBus（**仍有效**）。
6. **适配器**：`StorageAdapter`；当时主实现为 `LocalIdbAdapter`（**仍保留**，用于本机迁移/测试）。

## 当前架构（2026-05 起）

- **协作数据**：Fastify API + SQLite（`server/data/auth.db`），前端 `ApiStorageAdapter`，约 5s 轮询 `dataRevision` 同步。
- **UI 状态**：`InsightsContext` / `useInsights()` 为 SSOT；`FeedbackContext.jsx` 仅为兼容别名（`useFeedbacks`）。
- **配置**：打标/产品目录可在共享库在线编辑，经「发布」写入 `public/config/` 下 Excel/JSON。
- **本地遗留**：`localStorage` / IndexedDB 仅用于一次性迁移或 `scripts/clear-in-browser.js` 等调试脚本，**不是**生产主路径。

新功能应以 `src/domain`、`src/storage`（适配器契约）、`InsightsContext` 为准；勿假定「仅 IndexedDB、无登录」。

## 仍有效的后果

- 领域模型与 `schemaVersion` / `dataSourceType` 扩展方式不变。
- 新代码通过 `src/storage` 与 `src/domain` 访问记录与快照。

## 参考

- v2 重构方案、NFR 附录 A（NFR-R-020、NFR-E-030）
- 部署与存储说明：[README.md](../../README.md)、[DEPLOY.md](../DEPLOY.md)
