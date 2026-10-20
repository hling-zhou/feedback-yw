# 反馈库页面性能排查报告

> 排查时间：2026-09-15  
> 问题：① 列表加载时间长；② 编辑工单详情保存约 20s

---

## 一、数据现状

| 指标 | 数值 |
|------|------|
| records 表总行数 | **54,936** |
| - complaint_ticket（投诉工单） | 481 |
| - consultation_ticket（咨询工单） | 2,474 |
| - post_use_rating（用后即评） | **51,981** |
| DB 文件大小 | 150 MB |
| 当前选中周期 | `period:month:2026-08`（2026年8月） |
| 2026-08 行数 | **26,296**（含 24,847 条 post_use_rating） |

---

## 二、根因分析

### 问题一：列表加载慢

**根因：前端列表加载不区分 dataSourceType，拉取了全量 post_use_rating 数据**

前端 `loadRecordsForPeriodId` 调用链：

```
InsightsContext.jsx:287
  → loadFeedbacksForPeriod(adapter, periodId, { fields: 'list' })
    → fetchRecordPagesForPeriod → fetchAllRecordPages
      → adapter.listRecords({ insightPeriodId, fields: 'list' })
        → GET /api/storage/records?insightPeriodId=...&fields=list
```

**关键问题**：`listRecords` 请求**不带 `dataSourceType` 过滤**。后端 `buildRecordsWhereClause` 只按 `import_month` 范围过滤，导致 2026-08 周期下的 **26,296 条记录全部返回**，其中 **24,847 条 post_use_rating** 占了 95%。

| 周期 | 行数 | payload 大小（list 投影） | DB 查询耗时 |
|------|------|---------------------------|------------|
| 2026-08 | 26,296 | **~37 MB** | ~1.1s |
| 2026-07 | 15,036 | ~14 MB | ~0.6s |
| 合计（两月） | 41,332 | **~51 MB** | ~1.7s |

此外 `loadRecordsForJourneyComparison`（`:305`）会**额外加载上一个月份**的数据用于旅程对比，使首屏实际传输量翻倍。

**`fields=list` 投影只裁剪了 5 个大文本字段**（`rawText`、`handlingText`、`customerQuote`、`responseText`、`sourceColumns`），但 post_use_rating 的 payload 本身就不含这些字段（avg 802 bytes），裁剪几乎无收益。

**次要因素**：分页拉取逻辑 `fetchAllRecordPages` 以 1000 条/页分页，26,296 条需 27 页，虽有 4 路并发但仍有 RTT 累加。

### 问题二：保存工单详情约 20s

**根因：保存后的级联同步 N+1 串行请求**

保存入口 `FeedbackDrawer.finalizeSave`（`:1479`）在主 PATCH 之后**串行触发**以下操作：

```
finalizeSave 伪代码流：
1. adapter.getRecord(id)                    → 1 次 GET（拉全量 merge base，因为 list 投影缺 rawText）
2. updateFeedback(id, patch)                → 1 次 PATCH（主保存）
3. syncTicketTodoIncoming(...)              → 对每个关联工单串行 updateFeedback
4. syncFirstTicketSnapshotsForRecord(...)   → getActionItem + 可能 updateActionItem
5. syncLinkedTicketsForActionIds(...)       → N+1 重灾区：
   │  对每个关联工单串行执行 updateFeedback
   │  每个 updateFeedback 内部又先 getRecord（因为 list 投影缺 rawText）
   │  → 每条关联工单 = 1 GET + 1 PATCH
   └ 若举措关联 N 个工单，总网络往返 = 2N+2 次
6. persistEstablishedActionOnLinkedTickets   → 又一轮 N+1（getRecord + 举措库 API + PATCH）
```

**关键瓶颈**：

| 操作 | 单次耗时（估算） | N=10 条关联工单 | N=30 条 |
|------|-----------------|----------------|---------|
| 每条关联工单 updateFeedback | ~150-300ms（1 GET + 1 PATCH） | ~3s | ~9s |
| 每条 persistEstablishedActionForTicket | ~200-400ms（含举措库 API） | ~3s | ~12s |
| **合计** | | **~6s** | **~21s** |

**多余 GET 的来源**（`InsightsContext.jsx:1698`）：
```js
// list 投影裁剪了大文本字段；编辑需全量作为 merge base，缺 rawText 时拉单条
if (!('rawText' in existing) && typeof adapter.getRecord === 'function') {
  const full = await adapter.getRecord(id)  // ← 每条工单都额外发一次 GET
}
```
因为列表数据是 `fields=list` 投影，缺 `rawText`，每次 `updateFeedback` 都要额外拉一次全量。

---

## 三、优化方案

### 方案 A：列表加载优化（预计可提速 5-10 倍）

#### A1. 前端按 dataSourceType 分类型懒加载（核心改动）

**思路**：反馈库页面实际只展示 `complaint_ticket` + `consultation_ticket`，`post_use_rating` 不在列表展示（只用于快照分析）。

**改动点**：

1. **`InsightsContext.jsx` `loadRecordsForPeriodId`**：加载记录时传 `dataSourceType` 区分类型，或改为只加载投诉+咨询两类：
   ```js
   // 方案：按需加载，跳过 post_use_rating
   const records = await loadFeedbacksForPeriod(adapter, periodId, {
     fields: 'list',
     dataSourceTypes: ['complaint_ticket', 'consultation_ticket'], // 新增
   })
   ```

2. **后端 `storageRepository.listRecords` / `buildRecordsWhereClause`**：支持 `dataSourceType IN (...)` 多值过滤：
   ```js
   if (query.dataSourceTypes?.length) {
     parts.push(`data_source_type IN (${query.dataSourceTypes.map(() => '?').join(',')})`)
     params.push(...query.dataSourceTypes)
   }
   ```

3. **API 路由 `/api/storage/records`**：支持 `dataSourceTypes` 参数（逗号分隔）。

**效果**：2026-08 周期从 26,296 条 → ~1,449 条（125 投诉 + 1,324 咨询），payload 从 ~37 MB → ~2 MB，**提速 18 倍**。

#### A2. `post_use_rating` 数据延迟加载

`post_use_rating` 只在快照/趋势分析时使用，改为按需加载（快照重建时才拉取），不参与列表首屏。

#### A3. ~~去掉~~ `loadRecordsForJourneyComparison` 双月加载改为后台异步（✅ 已实施）

**原方案**：去掉双月加载，改为用户切换到对比视图时再加载。

**实际改动**：不丢失上月对比数据，改为**后台异步加载**。`loadRecordsForJourneyComparison` 拆分为两步：
- 当前月数据：`await loadRecordsForPeriodId(period.id)` ——首屏必需，同步等待
- 上月对比数据：`void loadRecordsForPeriodId(previousPeriodId).catch(...)` ——后台异步加载，不阻塞首屏

数据就绪后 `feedbacks` 状态更新 → `OverviewJourneyMap` 的 `useMemo` 自动重算 → 旅程图自动填充对比数据，无需用户手动触发。

**效果**：首屏传输量从 ~51MB → ~37MB（少加载一个月 ~14MB 数据），首屏加载时间减少约 30%。旅程图对比数据有短暂延迟（后台加载完成前为空对比），数据就绪后自动填充。

**改动文件**：`src/context/InsightsContext.jsx:305-322`

---

### 方案 B：保存工单详情优化（预计 20s → <2s）

#### B1. 消除 N+1：关联工单同步改为批量写入（核心改动）

**当前**：`syncLinkedTicketCopies`（`actionItemTicketSync.js:37-39`）逐条 `await updateFeedback`，每条 = 1 GET + 1 PATCH。

**改为**：一次性收集所有 patch，批量调用 `POST /api/storage/records/batch`：

```js
// actionItemTicketSync.js 改造
export async function syncLinkedTicketCopies(actionItem, feedbacks, updateFeedback) {
  const linked = feedbacks.filter((fb) => fb.actionId?.trim() === actionItem.id)
  if (!linked.length) return 0

  const patch = buildTicketCopyPatchForActionItem(actionItem)

  // 批量构造更新记录，一次性写入
  const updates = linked.map(fb => ({ ...fb, ...patch }))
  // 用 adapter.putRecords 批量写入，替代逐条 updateFeedback
  await adapter.putRecords(updates)
  
  // 内存同步更新
  for (const fb of linked) {
    feedbacksRef.current = feedbacksRef.current.map(f =>
      f.id === fb.id ? { ...f, ...patch } : f
    )
  }
  setFeedbacks(feedbacksRef.current)
  return linked.length
}
```

同理改造 `persistEstablishedActionOnLinkedTickets` 和 `syncTicketTodoIncoming`。

**效果**：N 条关联工单从 2N 次串行请求 → 1 次批量请求。

#### B2. 去掉保存前的额外 GET（`rawText` 缺失问题）

**根因**：列表用 `fields=list` 投影裁剪了 `rawText`，保存时需要全量 merge base。

**方案**：将 `rawText` 从 `LIST_PROJECTION_OMITTED_FIELDS` 中移除，或改为在列表加载时不裁剪 `rawText`。

但 `rawText` 可能是大文本（投诉描述），影响列表 payload 大小。替代方案：

- **保存时用增量 patch 而非全量 merge**：后端 `PATCH /api/storage/records/:id` 改为支持部分字段更新（只更新传入的字段），不需要全量 merge base。
- **或前端缓存全量记录**：首次打开抽屉时拉一次全量（已实现 `FeedbackDrawer.jsx:1467`），后续保存复用。

#### B3. 级联同步改为后台异步

**当前**：`finalizeSave` 内 `await` 所有级联同步，用户必须等全部完成才能关闭抽屉。

**改为**：主 PATCH 完成后立即关闭抽屉 + 提示成功，级联同步丢到后台：

```js
// finalizeSave 改造
const saved = await updateFeedback(feedback.id, patch, { ... })
const merged = { ...feedback, ...saved }

// 立即关闭抽屉，提示成功
;(onSavedClose ?? onClose)()
message.success(`${label} 已保存`)

// 级联同步异步执行，不阻塞 UI
void syncTicketTodoIncoming({ ... }).catch(err =>
  console.warn('[sync] ticket todo incoming failed', err)
)
if (merged.actionId?.trim()) {
  void syncFirstTicketSnapshotsForRecord(merged).catch(...)
  void syncLinkedTicketsForActionIds([merged.actionId], feedbacks, updateFeedback).catch(...)
}
```

#### B4. 后端 PATCH 接口支持增量更新

**当前**：`PATCH /api/storage/records/:id` 的 body 是完整 record 对象，后端用 `RECORDS_UPSERT_SQL` 全量覆盖。

**改为**：后端支持部分字段更新——只合并传入的字段，不需要前端提供全量 record：
```js
// 后端 storageRepository.putRecord 改造
if (options.partial) {
  const existing = this.getRecord(record.id) || {}
  const merged = { ...existing, ...record }
  // 用 merged 写入
}
```

---

### 方案 C：数据库层优化

#### C1. 复合索引优化

当前 `idx_records_import_month` 只索引 `import_month`，查询 `WHERE import_month >= ? AND import_month <= ? AND data_source_type = ?` 时需要回表过滤。

**建议**：新增复合索引：
```sql
CREATE INDEX IF NOT EXISTS idx_records_month_source
  ON records(import_month, data_source_type);
```

或更精准的覆盖索引（如果 payload 不需要的话效果有限，但 `COUNT(*)` 查询会快很多）。

#### C2. 定期清理 audit_log

`audit_log` 已有 53,785 条（~2.7 MB），虽然不影响 records 查询，但增大了 DB 文件。建议定期归档/清理。

#### C3. WAL checkpoint

DB 已用 WAL 模式（正确），但 WAL 文件已达 4.3 MB，建议在低峰期执行 `PRAGMA wal_checkpoint(TRUNCATE)` 回收 WAL。

---

## 四、优先级建议

| 优先级 | 改动 | 预期效果 | 改动范围 |
|--------|------|---------|---------|
| **P0** | A1: 前端按 dataSourceType 加载列表 | 列表加载 37MB → 2MB | 前端+后端 |
| **P0** | B1: 关联工单同步改批量 | 保存 N+1 → 1 次批量 | 前端 |
| **P1** | B3: 级联同步改异步 | 保存 20s → <1s 体感 | 前端 |
| **P1** | B2: 去掉保存前额外 GET | 保存减少 N 次 GET | 前端 |
| **P2** | C1: 复合索引 | DB 查询提速 | 后端 |
| **P2** | A3: 双月加载改异步（✅ 已实施） | 首屏传输量减 ~14MB | 前端 |

---

## 五、附录：关键代码位置

| 文件 | 行号 | 说明 |
|------|------|------|
| `src/context/InsightsContext.jsx` | 287-303 | 列表加载入口 |
| `src/context/InsightsContext.jsx` | 305-317 | 旅程对比额外加载上月 |
| `src/context/InsightsContext.jsx` | 1685-1755 | `updateFeedback` 保存逻辑 |
| `src/context/InsightsContext.jsx` | 1698-1704 | 缺 `rawText` 时额外 GET |
| `src/components/FeedbackDrawer.jsx` | 1467-1477 | 保存前额外 GET |
| `src/components/FeedbackDrawer.jsx` | 1479-1523 | `finalizeSave` 级联同步 |
| `src/lib/actionItemTicketSync.js` | 32-41 | `syncLinkedTicketCopies` N+1 |
| `src/lib/ticketTodoIncomingSync.js` | 72-113 | `syncTicketTodoIncoming` N+1 |
| `src/lib/ticketTodoIncomingSync.js` | 126-155 | `persistEstablishedActionOnLinkedTickets` N+1 |
| `src/lib/establishedActionPersist.js` | 209-219 | `syncLinkedTicketsForActionIds` |
| `src/storage/apiStorageAdapter.js` | 59-76 | `listRecords` 拼接参数 |
| `src/storage/feedbackStore.js` | 112-116 | `loadFeedbacksForPeriod` |
| `src/lib/recordLoader.js` | 14-53 | `fetchAllRecordPages` 分页拉取 |
| `server/storageRepository.js` | 181-211 | `listRecords` 后端实现 |
| `server/recordIndex.js` | 37-62 | `buildRecordsWhereClause` |
| `server/routes/storage.js` | 250-254 | `GET /api/storage/records` 路由 |
| `server/routes/storage.js` | 324-374 | `PATCH /api/storage/records/:id` 路由 |
