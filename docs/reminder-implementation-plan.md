# 邮件提醒功能 — 实施计划

## 已确认的设计决策（对话沉淀）

| 决策项 | 结论 |
|--------|------|
| 正文形式 | A+B 组合：正文 = 内联 HTML 简短摘要（每产品一行汇总）；附件 = .html 含完整分产品详情（Tab 切换） |
| 导航方式 | 只保留产品 Tab 切换，不做右侧悬浮目录 |
| 邮件粒度 | 合一封邮件；收件人 = 有待办产品负责人并集（产品无待办则不纳入，该产品负责人不收邮件） |
| 收件人 | 不裁剪：产品的 PM / 设计师 / 运维三线 / 运营 / 测试 全收 |
| LLM | 每产品调 1 次，仅做产品概述 + 趋势洞察；失败标记"LLM分析不可用"不阻断 |
| SMTP 通道 | DATA_SOURCE_TYPES 新增 'reminder'，独立配置；复用 sendSmtpMail |
| 入口 | 右下角悬浮按钮区 app-float-actions，新增 ReminderFab，仅 admin 可见 |
| 触发 | 第一期手动触发（预览→确认→发送） |
| 数据量 | 每类最多 50 条 + "更多详见平台" |

### 六类待办规则

| # | 全称 | 数据源 | 纳入条件 | 周期过滤 |
|---|------|--------|---------|---------|
| 1a | 投诉工单 | records (complaint_ticket) | tagStatus='manual_review' 或角色字段任一为空 (productGroupOptimization/designerOptimization/rootCauseReview/complaintCauseL1L2L3Review) | 是 (insightPeriodId) |
| 1b | 咨询工单 | records (consultation_ticket) | 全量纳入，按 requestScene 分布统计 | 是 (insightPeriodId) |
| 2 | 用后即评-产品部溯源 | post_use_callback_decisions + post_use_jira_items | needInternalTrace=true 且 status≠'已完成' (含无 jira_item) | 否 |
| 3 | 用后即评-补充的回访结果待评估 | post_use_callback_decisions + visit_records | needCustomerVisit=true 且 (internalConclusion 和 internalEvaluationDetail 均为空) | 是 (importMonth) |
| 4 | 未完成举措 | action_items | status IN (pending_evaluation/in_progress/suspended)；超期(scheduleAt<今天)标红+超期标签；临近(距排期<30天)标橙+临近标签 | 否 |
| 5 | 客户体验类分析会会后待办 | ticket_todos (records payload) | resolution='open' | 是 (通过 recordId→insightPeriodId) |

---

## 实施步骤（按依赖顺序）

### Phase 1: SMTP 通道类型扩展（1 个文件）

**目标**：让管理员能在设置页为提醒邮件配置独立 SMTP 通道。

| 文件 | 改动 |
|------|------|
| `src/domain/enums.js` | `DATA_SOURCE_TYPES` 数组加 `'reminder'`；`DATA_SOURCE_LABELS` 加 `reminder: '提醒邮件'` |

**无需额外改前端**：`MailSettingsPanel.jsx` 的通道新建表单数据来源下拉 (`SOURCE_OPTIONS`) 从 `DATA_SOURCE_TYPES` 动态生成，新增的 'reminder' 会自动出现。

**无需改后端**：`mailRepository.js` 的 `createMailChannel` / `getMailChannelByDataSource` 已通用化，通过 `isMailDataSourceType` 校验，新增的 'reminder' 自动通过。

---

### Phase 2: 规则引擎（2 个新文件）

**目标**：查 6 类待办数据，按产品分组，计算收件人。

#### 2.1 `server/reminderRuleEngine.js`（新建）

核心函数：

```js
/**
 * @param {{ insightPeriodId?: string }} options
 * @returns {{
 *   products: Array<{
 *     productKey: string,
 *     productName: string,
 *     categories: {
 *       complaintTickets: ComplaintTicketItem[],     // 1a
 *       consultationSummary: ConsultationSummary,     // 1b (统计分布)
 *       internalTraces: InternalTraceItem[],          // 2
 *       visitEvaluations: VisitEvaluationItem[],      // 3
 *       pendingActions: PendingActionItem[],          // 4
 *       openTodos: OpenTodoItem[],                    // 5
 *     },
 *     attentionRoles: string[],                       // 需关注角色
 *     owners: { productManager: OwnerRef[], designer: OwnerRef[], ... },
 *   }>,
 *   recipientEmails: string[],                        // 有待办产品负责人并集
 *   totalCount: number,
 *   periodLabel: string,
 *   generatedAt: string,
 * }}
 */
export function buildReminderData({ insightPeriodId } = {})
```

**查询逻辑**：

- **1a 投诉工单**：`storageRepository` 查 records WHERE `data_source_type='complaint_ticket'` + insightPeriodId 过滤 → 检查 `tagStatus='manual_review'` 或角色字段空值 → 按 productKey 分组
- **1b 咨询工单**：查 records WHERE `data_source_type='consultation_ticket'` + insightPeriodId 过滤 → 按 `requestScene` 字段值计数 → 不具体到角色
- **2 产品部溯源**：`postUseCallbackDecisionRepository.list()` 取 `needInternalTrace=true` → 对每个 decision 的 `itemKey` 查 `post_use_jira_items` 表 → `status !== '已完成'` 或无记录 → 纳入
- **3 回访结果待评估**：`postUseCallbackDecisionRepository.list()` 取 `needCustomerVisit=true` → 查 `visit_records` (meta key `post_use_visit_records_v1`) → `(internalConclusion || internalEvaluationDetail)` 为空 → 纳入；importMonth 按周期过滤
- **4 未完成举措**：`businessDb` 查 `action_items` WHERE `status IN ('pending_evaluation','in_progress','suspended')` → 计算超期/临近（`scheduleAt < 今天` → 超期；`scheduleAt` 在今天~今天+30天 → 临近）
- **5 会议待办**：`ticketTodoRepository` 查 `resolution='open'` + insightPeriodId 过滤

**收件人计算**：
- 有待办产品 → 查 `product_catalog` owners → 每角色取 `userId` → 查 `users` 表 `email` → 去重合并
- 无待办产品 → 不纳入 → 该产品负责人不收邮件

**依赖**：
- `storageRepository.getMeta()` — 查 insight periods、visit_records
- `storageRepository.listRecords()` 或直接 SQL — 查 records
- `postUseCallbackDecisionRepository.list()` — 查 decisions
- `getDb()` 直接查 `post_use_jira_items`、`action_items`、`users`
- `ticketTodoRepository.listTicketTodos({ status: 'open', insightPeriodId })`
- `productCatalogLoader` — 查 owners 配置

#### 2.2 `server/reminderSchema.js`（新建）

```js
export const reminderPreviewBodySchema = {
  body: {
    type: 'object',
    required: [],
    properties: {
      insightPeriodId: { type: 'string' },
    },
  },
}

export const reminderSendBodySchema = {
  body: {
    type: 'object',
    required: ['insightPeriodId'],
    properties: {
      insightPeriodId: { type: 'string' },
      skipLlm: { type: 'boolean', default: false },
    },
  },
}
```

---

### Phase 3: LLM 增强（1 个新文件）

**目标**：每产品调 1 次 LLM，生成概述段落 + 趋势洞察；失败标记不可用。

#### 3.1 `server/reminderLlmEnhancer.js`（新建）

```js
import { resolveLlmApiKey, resolveLlmBaseUrl, resolveLlmModel } from './llmConfig.js'
import { forwardLlmChatCompletion } from './llmProxy.js'

/**
 * @param {Array} products - buildReminderData 返回的 products 数组
 * @param {{ skipLlm?: boolean }} options
 * @returns {Map<string, { summary: string, trend: string } | { error: string }>}
 */
export async function enhanceWithLlm(products, { skipLlm = false } = {})
```

**逻辑**：
- `skipLlm=true` → 所有产品标记 `{ error: '已跳过' }`，返回
- 逐产品（串行，避免并发限流）：构造 system prompt + 产品数据摘要 → 调 `forwardLlmChatCompletion({ baseUrl, apiKey, body: { model, messages, temperature: 0.3 } })` → 解析返回文本 → 拆分为 summary + trend
- 单产品失败 → 标记 `{ error: 'LLM分析不可用' }`，不影响其他产品
- prompt 设计：喂入该产品的六类待办统计摘要（投诉 X 条、咨询 Y 条场景分布、溯源 Z 条...），要求 LLM 输出"产品概述"和"趋势洞察"两段文字，不做行动建议

**LLM 调用方式**：直接用 `forwardLlmChatCompletion`（服务端已有函数，不走前端 /api/llm/chat 路由），apiKey/baseUrl/model 从 `llmConfig.js` 解析。

---

### Phase 4: HTML 渲染（1 个新文件）

**目标**：生成 A 部分邮件正文（内联 HTML 摘要）+ B 部分附件 HTML（完整详情 Tab 切换）。

#### 4.1 `server/reminderMailRenderer.js`（新建）

```js
/**
 * @param {ReminderData} data - buildReminderData 返回
 * @param {Map<string, LlmResult>} llmResults - enhanceWithLlm 返回
 * @param {{ publicAppUrl: string }} options
 * @returns {{ subject: string, bodyHtml: string, attachmentHtml: string, attachmentFilename: string }}
 */
export function renderReminderMail(data, llmResults, { publicAppUrl })
```

**A 部分 `bodyHtml`（邮件正文）**：
- CSS 全内联 `style="..."`，无 `<script>`，无 `<style>` 标签
- 结构：邮件头 → 每产品一行汇总表（产品名 | 待办总数 | 各类分布 | 需关注角色） → LLM 整体概述（如有） → 邮件底部（平台链接 + 收件人说明）
- 每行格式：`云专线 | 共 56 项待办 | 投诉工单 3 - 咨询工单 47(统计) - 用后即评-产品部溯源 2 - ... | 需关注：产品经理、运维三线`

**B 部分 `attachmentHtml`（附件 HTML）**：
- 完整 `<html>` 文档，含 `<style>` 和 `<script>`
- 复用 `htmlReportOffline.js` 的 `data-product-tab` / `data-product-panel` Tab 切换模式
- Tab 栏：每个有待办的产品一个 Tab
- 每个 Tab 内容：产品标题 + 需关注角色 → 六类待办表格（分类标题 + count badge + 表格）→ LLM 概述段落（蓝色左条）
- Tab 切换 JS：`addEventListener('click')` 切换 `active` class
- 未完成举措表格：超期行底色 `#fff1f0` + 红色"超期"标签；临近行底色 `#fff7e6` + 橙色"临近"标签
- 咨询工单：请求场景分布柱状图（纯 HTML/CSS bar，不依赖 JS）
- `attachmentFilename`: `工单提醒周报_{周期}_{YYYYMMDD-HHmm}.html`

**分类标题全称**（严格按用户要求）：
- 投诉工单
- 咨询工单
- 用后即评-产品部溯源
- 用后即评-补充的回访结果待评估
- 未完成举措
- 客户体验类分析会会后待办

---

### Phase 5: API 路由（1 个新文件）

**目标**：preview 返回预览数据，send 发送邮件。

#### 5.1 `server/routes/reminders.js`（新建）

```js
import { requireAdmin } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { reminderPreviewBodySchema, reminderSendBodySchema } from '../reminderSchema.js'
import { buildReminderData } from '../reminderRuleEngine.js'
import { enhanceWithLlm } from '../reminderLlmEnhancer.js'
import { renderReminderMail } from '../reminderMailRenderer.js'
import { describeMailSendError, sendSmtpMail } from '../mail/smtp.js'
import { getMailChannelByDataSource, getPublicAppUrl } from '../mailRepository.js'

export function registerReminderRoutes(app) {
  // POST /api/reminders/preview — admin only
  //   入参: { insightPeriodId? }
  //   返回: { products: [...], recipientEmails: [...], totalCount, periodLabel, generatedAt }
  //   不调 LLM，不发送，只返回规则引擎查询结果

  // POST /api/reminders/send — admin only
  //   入参: { insightPeriodId, skipLlm? }
  //   流程: buildReminderData → enhanceWithLlm → renderReminderMail → sendSmtpMail(channel='reminder')
  //   返回: { ok: true, sentTo: [...], productCount, totalCount }
}
```

**注册位置**：`server/index.js` 第 103 行 `registerMailRoutes(app)` 后面加：
```js
import { registerReminderRoutes } from './routes/reminders.js'
registerReminderRoutes(app)
```

**权限**：`requireAdmin()` — 仅管理员（与用户要求一致）

**收件人上限处理**：提醒邮件收件人可能超过 30 个（5 产品 × 5 角色 × 多人），需要移除现有 `MAIL_MAX_RECIPIENTS=30` 的限制，或为提醒邮件单独放宽上限。计划在 `assertEmailList` 之外独立校验（提醒邮件不调 `assertEmailList`，直接 `uniqueEmails` 去重后使用）。

---

### Phase 6: 前端入口（2 个新文件 + 2 个改文件）

#### 6.1 `src/components/ReminderFab.jsx`（新建）

仿 `MessageBottleFab.jsx` 模式：

```jsx
import { Tooltip } from 'antd'
import { MailOutlined } from '@ant-design/icons'

export default function ReminderFab({ onClick }) {
  return (
    <Tooltip title="发送提醒邮件" placement="left">
      <button type="button" aria-label="发送提醒邮件" className="reminder-fab" onClick={onClick}>
        <MailOutlined className="reminder-fab__icon" />
      </button>
    </Tooltip>
  )
}
```

#### 6.2 `src/components/ReminderSendModal.jsx`（新建）

弹窗流程：
1. **第一步 — 预览**：选洞察周期（月份下拉）→ 调 `POST /api/reminders/preview` → 展示预览
   - 预览内容：哪些产品有待办、每个产品各类待办计数、收件人列表（姓名+邮箱）、收件人总数
   - "预览"阶段不调 LLM，纯规则数据
2. **第二步 — 确认发送**：点"发送" → 调 `POST /api/reminders/send` → loading 状态 → 返回成功/失败
   - 发送时调 LLM（除非用户勾选"跳过 LLM"）
   - 发送后展示结果：已发送给 N 人，涵盖 M 个产品

#### 6.3 `src/components/AppShell.jsx`（改）

在 `app-float-actions` div 内，`AssistantFab` 后面加：

```jsx
{user?.role === 'admin' && (
  <ReminderFab onClick={() => setReminderOpen(true)} />
)}
```

并加 state `const [reminderOpen, setReminderOpen] = useState(false)` 和 Modal 渲染：

```jsx
{user?.role === 'admin' && (
  <ReminderSendModal open={reminderOpen} onClose={() => setReminderOpen(false)} />
)}
```

#### 6.4 `src/index.css`（改）

在 `.whats-new-fab:focus-visible` 后面加：

```css
.reminder-fab {
  @apply grid place-items-center rounded-full text-white shadow-md transition;
  width: 2.1rem;
  height: 2.1rem;
  @apply bg-amber-500;
}

.reminder-fab__icon {
  font-size: 0.9rem;
}

.reminder-fab:hover {
  @apply bg-amber-600 shadow-lg;
}

.reminder-fab:focus-visible {
  @apply outline outline-2 outline-offset-1 outline-amber-600;
}
```

---

### Phase 7: 邮件模板预置（1 个改文件）

#### 7.1 `src/domain/mail.js`（改）

加预置模板：

```js
export const MAIL_PRESET_REMINDER = 'reminder_digest'

export const DEFAULT_REMINDER_SUBJECT = '工单提醒周报（{周期标签}）'
export const DEFAULT_REMINDER_BODY = `{周期标签}的工单提醒周报
涵盖 {产品数量} 个产品，共 {待办总数} 项待处理事项
详见附件，可用浏览器打开查看各产品完整明细
完整数据见用户反馈分析平台 {绝对链接}`
```

`MAIL_PRESET_IDS` 数组加 `MAIL_PRESET_REMINDER`，`defaultMailTemplate` 加分支。

`mailRepository.js` 的 `ensureMailDefaults` 已通用化遍历 `MAIL_PRESET_IDS`，无需额外改动。

---

## 文件清单汇总

### 新建文件（5 个）

| 文件 | 说明 |
|------|------|
| `server/reminderRuleEngine.js` | 规则引擎：查 6 类待办 + 按产品分组 + 计算收件人 |
| `server/reminderLlmEnhancer.js` | LLM 增强：每产品调 1 次，概述+趋势 |
| `server/reminderMailRenderer.js` | HTML 渲染：A 部分正文 + B 部分附件 |
| `server/routes/reminders.js` | API 路由：preview + send |
| `src/components/ReminderFab.jsx` | 右下角悬浮按钮 |
| `src/components/ReminderSendModal.jsx` | 预览+发送弹窗 |
| `server/reminderSchema.js` | Fastify 请求体 schema |

### 改动文件（5 个）

| 文件 | 改动 |
|------|------|
| `src/domain/enums.js` | DATA_SOURCE_TYPES 加 'reminder' |
| `src/domain/mail.js` | 加 MAIL_PRESET_REMINDER 预置模板 |
| `server/index.js` | 注册 registerReminderRoutes |
| `src/components/AppShell.jsx` | 加 ReminderFab + state + Modal |
| `src/index.css` | 加 .reminder-fab 样式 |

---

## 风险与注意事项

1. **收件人上限**：提醒邮件收件人可能 > 30 人（5 产品 × 5 角色），需移除/放宽 `MAIL_MAX_RECIPIENTS` 限制。计划在 reminders 路由中独立处理，不调用 `assertEmailList`，直接 `uniqueEmails` 后使用。
2. **LLM 串行调用**：5 个产品串行调 LLM，每个约 3-8 秒，总耗时约 15-40 秒。前端需要 loading 状态。若需加速可改并发（受限于 LLM 网关的 rate limit）。
3. **附件大小**：完整 HTML 附件（5 产品 × 5 类 × 50 条）估算约 200-500KB，远小于现有 4MB 限制。
4. **产品目录 owners 数据缺失**：部分产品可能未配置 owners → 无收件人 → 预览时提示"该产品未配置负责人"。
5. **洞察周期选择**：一期只支持按月，下拉从 `insight_periods` meta 读取。
6. **测试**：按项目约定只跑受影响的相关单测，不跑全量 E2E。
