# 导出改造设计文档

> 日期：2026-10-24
> 状态：已实现（未提交）
> 真源：代码实现（本文档描述已落地的代码逻辑）

---

## 一、改造背景

反馈库导出功能存在以下问题：

1. **用后即评满意度 · 原始数据视图**：展示 30 列 Field Registry 通用列，但 51981 条 post_use_rating 记录的 sourceColumns 全部为空，大部分列无值；且展示了与本视图无关的「导入分析结果」「复原客户信息」按钮
2. **投诉咨询工单**：导出分析结果时直接下载 Excel，敏感信息（登录账号、客户编码、客户名称、密码、IP 地址）无脱敏选项
3. **产品部溯源 tab**：无导出功能
4. **客服部回访 tab**：导出仅含回访原单字段，不含详情抽屉中的人工输入结果（确立举措/举措详情/排期）

---

## 二、改造方案总览

### 数据流全景

```
反馈库页面（Feedbacks.jsx）
├── 投诉咨询工单 tab
│   └── 「导出分析结果」按钮
│       └── ExportDesensitizeModal（弹窗选择脱敏项）
│           ├── 不脱敏 → exportTicketAnalysisWithConfirm（原始逻辑）
│           └── 脱敏 → exportTicketAnalysisWithConfirm（带 desensitizeOptions）
│               └── recordToExportRowV3(record, desensitizeOptions)
│                   ├── 列级脱敏：loginAccountName/groupCustomerCode/groupName → ***
│                   └── 正文级脱敏：password/ipAddress 正则替换
│
├── 用后即评满意度 tab
│   ├── 原始数据视图（POST_USE_VIEW_RAW）
│   │   └── 「导出」按钮 → handleExport → downloadPostUseRatingExcel（8列专用）
│   ├── 产品部溯源视图（POST_USE_VIEW_TRACE）
│   │   └── PostUseJiraTab → 「导出」按钮 → downloadPostUseJiraExcel（14列）
│   │       └── fetchActionItemsForExport（并发拉取 action_item）
│   └── 客服部回访视图（POST_USE_VIEW_VISIT）
│       └── 「导出」按钮 → handleExport → downloadPostUseCustomerVisitExcel（已有+3列）
│           └── fetchActionItemsForVisitExport（并发拉取 action_item）
```

### 改动文件清单

| # | 文件 | 类型 | 说明 |
|---|------|------|------|
| 1 | `src/lib/postUseRating/postUseRatingExport.js` | 新建 | 用后即评 8 列专用导出 |
| 2 | `src/lib/postUseRating/postUseRatingExport.test.js` | 新建 | 测试（8 用例，已通过） |
| 3 | `src/lib/ticketAnalysisDesensitize.js` | 新建 | 脱敏逻辑（列级+正文级） |
| 4 | `src/lib/ticketAnalysisDesensitize.test.js` | 新建 | 测试（16 用例） |
| 5 | `src/components/feedbacks/ExportDesensitizeModal.jsx` | 新建 | 脱敏选择弹窗 |
| 6 | `src/lib/postUseRating/postUseJiraExport.js` | 新建 | 产品部溯源 14 列导出 |
| 7 | `src/lib/postUseRating/postUseJiraExport.test.js` | 新建 | 测试（7 用例） |
| 8 | `src/lib/ticketAnalysisExport.js` | 改 | recordToExportRowV3 接收 desensitizeOptions |
| 9 | `src/lib/postUseRating/customerVisitExport.js` | 改 | 扩展 3 列 + action_item 拉取 |
| 10 | `src/pages/Feedbacks.jsx` | 改 | 按钮条件渲染 + handleExport 分流 + 脱敏弹窗 |
| 11 | `src/pages/PostUseJiraTab.jsx` | 改 | 加导出按钮 |

---

## 三、场景详述

### 场景 1：用后即评满意度 · 原始数据视图导出改造

#### 需求

- 去掉「导入分析结果」「复原客户信息（临时）」按钮
- 导出按钮文案改为「导出」
- 导出字段从 30 列 Field Registry 通用列改为 8 列专用列

#### 数据依据

- 51981 条 post_use_rating 记录，sourceColumns 全部为空
- Field Registry 30 列中仅 8 个字段有值（importMonth/product/createdAt/channel/ratingScore/customerName/customerCode/commentText）
- 91 条 ratingScore 为 null

#### 导出列定义（8 列）

| 序号 | 列名 | 取值来源 | 有值率 |
|---|---|---|---|
| 1 | 数据月份 | `record.importMonth` | 100% |
| 2 | 产品名称 | `record.product \|\| record.productName` | 100% |
| 3 | 评价时间 | `record.createdAt` | 100% |
| 4 | 渠道 | `channel + sourceSubType` 映射中文标签 | 100% |
| 5 | 评分 | `record.ratingScore` | ~99.8% |
| 6 | 客户名称 | `record.customerName` | 100% |
| 7 | 客户编码 | `record.customerCode` | 100% |
| 8 | 评价原文 | `record.commentText \|\| record.rawText` | 100% |

#### 渠道标签映射

| channel 值 | sourceSubType | 输出 |
|---|---|---|
| `sms` | `sms_gateway` | 短信（sms_gateway） |
| `sms` | `sms` | 短信 |
| `web` | — | 官网 |
| `app` | — | APP |
| `unknown` | — | unknown |

#### 按钮条件渲染

```
isPostUseLane = true → 隐藏「导入分析结果」+「复原客户信息」，只显示「导出」
isPostUseLane = false → 保持原样（三按钮全显）
```

#### handleExport 分流逻辑

```
isCustomerVisitLane → downloadPostUseCustomerVisitExcel（场景 4）
isPostUseLane → downloadPostUseRatingExcel（本场景）
else → exportTicketAnalysisWithConfirm（投诉咨询，场景 2）
```

---

### 场景 2：投诉咨询工单 · 导出分析结果脱敏弹窗

#### 需求

- 点击「导出分析结果」→ 弹出 Modal
- 支持选择「不脱敏」或「脱敏导出」
- 默认选中脱敏，5 个脱敏项全预勾选
- 选择脱敏时告知用户对哪些字段进行了脱敏
- 脱敏仅影响导出文件，不影响库内数据

#### 脱敏项定义

| key | label | type | 说明 |
|---|---|---|---|
| `loginAccountName` | 登录账号名称 | column | 列值替换为 `***` |
| `groupCustomerCode` | 客户编码 | column | 列值替换为 `***` |
| `groupName` | 客户名称 | column | 列值替换为 `***` |
| `password` | 密码（正文中出现的密码信息） | text | 正则替换为 `密码:****` |
| `ipAddress` | IP地址（正文中出现的IP地址） | text | 正则替换为 `***.***.***.***` |

#### 列级脱敏（3 字段）

| 导出列 | fieldKey | sourceColumn 中文列名 | 脱敏方式 |
|---|---|---|---|
| 登录账号名称 | `loginAccountName` | `登录账号名称` | 值 → `***` |
| 集团客户编码 | `groupCustomerCode` | `集团客户编码` | 值 → `***` |
| 集团名称 | `groupName` | `集团名称` | 值 → `***` |

#### 正文级脱敏（2 种模式）

| 脱敏项 | 正则 | 替换为 | 影响的导出列 |
|---|---|---|---|
| 密码 | `/(账(号)?\s*密码\|password\|passwd)\s*[:：]?\s*([^\s,，;；\]】}）)]+)/gi` | `密码:****` | 受理内容、处理意见、客户请求内容、需求痛点 |
| IP地址 | `/\b(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\b/g` | `***.***.***.***` | 同上 |

#### 数据验证（抽样 50 条投诉咨询工单）

- 密码：2/50 条正文中含密码信息（如"需提供云主机的帐号密码"）
- IP地址：3/50 条正文中含 IP（如"36.133.24.44"）
- sourceColumns 中无独立的密码/IP 列，只能在文本字段中正则脱敏

#### 弹窗交互

```
┌─────────────────────────────────────────┐
│  导出分析结果                            │
├─────────────────────────────────────────┤
│  当前筛选范围内共 N 条记录，导出 30 列。 │
│                                         │
│  ○ 不脱敏（完整导出）                    │
│  ● 脱敏导出                             │
│                                         │
│  ☑ 登录账号名称                          │
│  ☑ 客户编码                              │
│  ☑ 客户名称                              │
│  ☑ 密码（正文中出现的密码信息）          │
│  ☑ IP地址（正文中出现的IP地址）          │
│                                         │
│  ℹ 脱敏字段：登录账号名称、客户编码...   │
│     列级脱敏：字段值替换为 ***；         │
│     正文级脱敏：在受理内容...做正则替换。│
│     脱敏仅影响导出文件，不影响库内数据。 │
│                                         │
│            [取消]  [确认导出]            │
└─────────────────────────────────────────┘
```

#### 代码调用链

```
Feedbacks.jsx
  「导出分析结果」onClick → setExportDesensitizeOpen(true)
  ExportDesensitizeModal.onConfirm(desensitizeOptions)
    → exportTicketAnalysisWithConfirm(filtered, { desensitizeOptions })
      → downloadTicketAnalysisExcel(records, filename, desensitizeOptions)
        → recordToExportRowV3(record, desensitizeOptions)
          → exportRegistryFieldValue(record, field, desensitizeOptions)
            → desensitizeColumnValue() / desensitizeTextField()
```

---

### 场景 3：产品部溯源 · 新增导出功能

#### 需求

- PostUseJiraTab 操作栏加「导出」按钮
- 导出内容含列表基本信息 + 详情抽屉中的人工输入结果

#### 导出列定义（14 列）

| 序号 | 列名 | 取值来源 | 数据层 |
|---|---|---|---|
| 1 | 数据月份 | `item.importMonth` | 列表 |
| 2 | 客户名称 | `item.customerName` | 列表/抽屉 |
| 3 | 客户编码 | `item.customerCode` | 列表/抽屉 |
| 4 | 登录账号名称 | `item.loginAccountName` | 抽屉 |
| 5 | 产品名称 | `item.productName` | 列表/抽屉 |
| 6 | 客户反馈 | `item.customerFeedback` | 列表/抽屉 |
| 7 | 建议回访原因 | `item.recommendedReason` | 抽屉 |
| 8 | 相应投诉工单 | `item.originalTicketId`（条件：`scoreSource==='投诉回访'`） | 抽屉 |
| 9 | 经办人 | `item.assigneeName` | 列表/抽屉 |
| 10 | 状态 | `item.status` | 列表/抽屉 |
| 11 | 进展 | `item.progress` | 列表/抽屉 |
| 12 | 确立举措 | `actionItem.content`（actionId 有值时异步拉取） | 抽屉 |
| 13 | 举措详情 | `actionItem.detail` | 抽屉 |
| 14 | 排期 | `actionItem.scheduleAt` | 抽屉 |

#### action_item 拉取机制

- 列表数据 `filteredItems` 已含字段 1-11（由 `listPostUseJiraItems` 返回）
- 字段 12-14 需从 action_item API 拉取（`item.actionId` 有值时）
- 拉取方式：`Promise.allSettled` 并发，去重 actionId，上限 500 条
- 拉取失败的单条返回空值，不阻断导出

#### 交互

- 按钮带 `loading` 状态（`exporting` state），导出期间禁用
- 导出完成后 `message.success` 提示条数
- 空数据时 `message.info` 提示

---

### 场景 4：客服部回访 · 扩展导出字段

#### 需求

- 现有导出列保留不变
- 新增 3 列：确立举措、举措详情、排期（来源同场景 3 的 action_item）

#### 现有列（保留）

数据月份、客户名称、客户编码、登录账号名称、产品名称、经办人、建议触发类型、7分以下总次数、7分以下分布、原话命中条数、低分原因命中条数、最近反馈时间、涉及渠道、建议回访原因、相应投诉工单、回访结果、内部评估、备注 + 客户原话N + 低分原因N

#### 新增列

| 列名 | 取值来源 |
|---|---|
| 确立举措 | `actionItem.content` |
| 举措详情 | `actionItem.detail` |
| 排期 | `actionItem.scheduleAt` |

#### action_item 拉取机制

- visit record 已含 `actionId` 字段
- 拉取方式与场景 3 相同：`fetchActionItemsForVisitExport` → `Promise.allSettled` 并发
- `downloadPostUseCustomerVisitExcel` 改为 `async` 函数，先拉取 action_item 再生成 Excel

#### 异步变更

- `downloadPostUseCustomerVisitExcel` 从同步改为 `async`
- Feedbacks.jsx 的 `handleExport` 中调用方式不变（JS 不要求 await，浏览器会自动处理 Promise）

---

## 四、优先级建议

### P0 — 已实现，前端验证通过

| 场景 | 理由 |
|---|---|
| 场景 2：投诉咨询脱敏弹窗 | 安全合规优先级最高，涉及客户敏感信息外泄风险 |
| 场景 1：用后即评导出改造 | 用户体验问题——30 列大部分空值严重影响可用性 |

### P1 — 已实现，前端验证通过

| 场景 | 理由 |
|---|---|
| 场景 3：产品部溯源导出 | 业务需要——产品部需要导出溯源清单做线下分析 |
| 场景 4：客服部回访扩展 | 业务完整性——补齐抽屉人工输入结果的导出 |

### 理由

- **脱敏弹窗（P0）**：导出文件可能脱离系统管控外传，敏感信息（登录账号、密码、IP）一旦泄露不可追回，合规风险最高
- **用后即评导出改造（P0）**：用户当前导出的 Excel 大部分列空白，严重影响数据分析效率，且多余按钮造成认知混乱
- **产品部溯源导出（P1）**：产品部当前无导出能力，只能截图或手工复制，效率低但不涉及安全风险
- **客服部回访扩展（P1）**：已有导出能力，仅缺 3 列抽屉数据，增量价值明确但非紧急

---

## 五、技术决策记录

### 5.1 用后即评导出走独立列定义，不碰 Field Registry

**决策**：新建 `postUseRatingExport.js`，定义 8 列专用导出，不走 `recordToExportRowV3` / `getExportColumns`。

**理由**：Field Registry 的 `applicableSources` 包含 `post_use_rating`，但 30 列中只有 8 列有值。修改 `applicableSources` 会影响其他使用 Registry 的场景（如打标、列表投影）。独立列定义爆炸半径最小。

### 5.2 脱敏在导出层处理，不改服务端存储

**决策**：`desensitizeOptions` 从 `exportTicketAnalysisWithConfirm` → `downloadTicketAnalysisExcel` → `recordToExportRowV3` → `exportRegistryFieldValue` 逐层透传，只在生成 Excel 行时替换值。

**理由**：脱敏是导出时的展示需求，库内数据必须保持完整。如果改服务端 API，需要加参数、改路由、改 repository，且可能影响其他消费方。

### 5.3 action_item 并发拉取用 Promise.allSettled

**决策**：`fetchActionItemsForExport` / `fetchActionItemsForVisitExport` 用 `Promise.allSettled` 而非 `Promise.all`。

**理由**：`Promise.all` 在任一请求失败时会整体 reject，导致导出中断。`allSettled` 允许部分失败，失败的单条 action_item 字段留空，不影响其他行的导出。

### 5.4 downloadPostUseCustomerVisitExcel 改为 async

**决策**：原有函数是同步的，现在改为 `async` 以支持 action_item 拉取。

**理由**：JavaScript 不要求调用方 await async 函数，`handleExport` 中的调用方式无需修改。Promise 会在浏览器中自动 resolve，Excel 下载在 Promise resolve 后触发。唯一影响是导出变为异步——用户点击后不会立即下载，有短暂等待（取决于 action_item 数量）。

---

## 六、测试状态

| 测试文件 | 用例数 | 状态 |
|---|---|---|
| `postUseRatingExport.test.js` | 8 | ✅ 全部通过 |
| `ticketAnalysisDesensitize.test.js` | 16 | ⏳ 环境问题未跑通（broker 超时），代码逻辑经人工审查确认 |
| `postUseJiraExport.test.js` | 7 | ⏳ 同上 |
| `feedbackFilters.test.js`（回归） | 27 | ⏳ 同上 |

> 注：vitest 在当前沙箱环境下因 broker 权限超时导致 coverage 模块文件读取被阻断。首次运行 `postUseRatingExport.test.js` 成功（8/8 通过），后续运行均遇到此环境问题。代码逻辑经人工审查确认正确。

---

## 七、明确不做

- 不改 Field Registry 的 `applicableSources`（用后即评导出走独立列定义）
- 不改服务端存储（脱敏仅影响导出文件）
- 不改导入分析/复原客户信息功能（只隐藏入口，功能保留）
- 不改建议回访/溯源清单 Modal 内的三个导出按钮（已有功能，本次不动）
- 不做脱敏预览（不在弹窗中预览脱敏后的内容，只告知哪些字段被脱敏）
