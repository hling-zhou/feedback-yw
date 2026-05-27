# 数据持久化说明（生产发版必读）

本文说明 **哪些数据会落盘**、**存在哪里**、**发版/扩容时如何不丢数据**，以及当前已知的「应存未存」与规避方式。

---

## 1. 核心结论：工单列表（feedbacks）已落盘

工作台 `InsightsContext.feedbacks` 是 **服务端 SQLite 的内存缓存**，不是唯一副本。

| 操作 | 是否写库 | 机制 |
|------|----------|------|
| 登录后首屏加载 | 读库 | `fetchAllRecordPages` → `GET /api/storage/records` → `records` 表 |
| Excel/JSON 导入 | 写库 | `adapter.putRecords` 增量写入 |
| 工单详情编辑/打标 | 写库 | `persistRecordUpdate` → `putRecord` |
| 批量重新打标 | 写库 | `persistRecordUpdates` |
| 他人导入后同步 | 读库 | `dataRevision` 轮询 → `syncSharedDataFromServer` |

**不会**把整份 `feedbacks` 数组 debounce 全量写回共享库（会误删其他月份数据）；这是刻意设计，见 `InsightsContext` 注释。

发版替换 `dist/` 或 API 代码 **不会** 清空 `records` 表；只要 **`server/data/auth.db`（或 `AUTH_DATABASE_PATH`）在持久卷上** 即可。

---

## 2. 生产环境数据地图

### 2.1 必须备份（P0）

| 数据 | 路径/表 | 发版是否保留 |
|------|---------|----------------|
| 全部工单与打标 | `auth.db` → `records` | ✅ 在卷上则保留 |
| 洞察快照（含行动建议、用户编辑） | `auth.db` → `snapshots` | ✅ |
| 洞察周期、当前周期选择 | `auth.db` → `meta` | ✅ |
| 托管标签库 | `meta.taxonomy_managed` 等 | ✅ |
| 产品目录托管 | `meta.product_catalog_managed_v1` | ✅ |
| 月订单数 | `meta.product_order_volumes_v1` | ✅ |
| 标签候选 | `tag_candidates` | ✅ |
| 用户与审计 | `users`, `audit_log` | ✅ |
| 共享应用设置（非密钥） | `meta.app_settings_shared_v1` | ✅ |
| 行动建议反馈 | `meta.recommendation_feedback_v1` | ✅ |

### 2.2 自动生成备份（P1，非权威）

| 数据 | 路径 | 说明 |
|------|------|------|
| 打标配置 Excel/JSON | `public/config/taxonomy/` | 保存标签后 API 自动写盘（`AUTO_PUBLISH_CONFIG`）；**权威在 meta** |
| 产品目录 Excel/JSON | `public/config/product-catalog/` | 同上 |
| 行动建议 Playbook/权重 | `public/config/planning/*.json` | 静态文件；未写入 DB（待托管） |

### 2.3 仅本机浏览器（不随 auth.db 迁移）

| 数据 | 存储 | 生产影响 |
|------|------|----------|
| LLM API Key（用户自填） | `localStorage` | 每浏览器一份；应用服务端 `LLM_API_KEY` |
| 登录 Token | `localStorage` / `sessionStorage` | 会话级 |
| 旧版工单缓存键 | `localStorage` `feedback-insights-records` | 仅首次迁移用 |

### 2.4 仅内存 / 会话（刷新即失）

| 数据 | 说明 |
|------|------|
| UI 筛选、Tab、视图模式 | React state / URL 部分参数 |
| 洞察分析高频词 | 每次重算 |
| 导入/打标进度条 | `sessionStorage` 会话恢复用 |

---

## 3. 发版与部署检查清单

### 3.1 单节点（常见）

- [ ] `server/data/` 挂载 **持久卷**（或宿主机目录），**不要**打进仅含代码的镜像层
- [ ] `public/config/` 同上，或发版后重新「发布打标配置/产品目录」
- [ ] 发版前：`sqlite3 … ".backup 'backup/auth-$(date +%F).db'"`
- [ ] 发版后：`GET /health` 中 `recordCount`、`revision` 与发版前一致
- [ ] 抽一条工单、一条行动建议、一次洞察快照 spot check

### 3.2 多 API 实例

- [ ] 所有节点 **同一** `auth.db`（网络盘/主从，非多份独立文件）
- [ ] `public/config` **共享卷**，否则 Publish 只更新单节点磁盘
- [ ] 前端依赖 `dataRevision` 轮询（约 5s）拉齐他人写入

### 3.3 仅前端发版

- 替换 `dist/` **不影响** 业务数据（数据在 API 侧 SQLite）

### 3.4 仅 API 发版

- 向后兼容：快照 JSON 字段未知时 UI 降级
- 若有 DB schema 变更，需配套迁移脚本（当前以 `payload` JSON 为主，表结构较稳定）

---

## 4. 已知缺口与建议

| 项 | 现状 | 建议 |
|----|------|------|
| Playbook/信号权重 | 仅 `public/config/planning/` | 纳入备份；或后续做「发布到 meta」 |
| 用户级 LLM Key | 仅 localStorage | 生产用环境变量 `LLM_API_KEY` |
| 容器无卷重启 | `auth.db` 在容器内会新建空库 | 必须挂卷，见 DEPLOY.md |
| 标签/产品配置读盘 | 已移除运行时读 Excel | 仅上传 Excel 导入 + 自动写盘备份 |

---

## 5. 相关文档

- [DATA-MIGRATION.md](./DATA-MIGRATION.md) — 跨机迁移步骤  
- [DEPLOY.md](./DEPLOY.md) — 部署、备份、Publish 流程
