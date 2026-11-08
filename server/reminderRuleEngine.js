/**
 * 邮件提醒规则引擎 — 查 6 类待办数据，按产品分组，计算收件人。
 *
 * 六类待办：
 *  1a 投诉工单          — records (complaint_ticket) — tagStatus=manual_review 或角色字段空
 *  1b 咨询工单          — records (consultation_ticket) — 全量纳入，按 requestScene 分布统计
 *  2  用后即评-产品部溯源 — post_use_callback_decisions + post_use_jira_items — needInternalTrace=true 且 status≠'已完成'
 *  3  用后即评-补充的回访结果待评估 — post_use_callback_decisions + visit_records — needCustomerVisit=true 且 internalConclusion 空
 *  4  未完成举措         — action_items — status IN (pending_evaluation/in_progress/suspended)
 *  5  客户体验类分析会会后待办 — ticket_todos — resolution='open'
 */

import { getDb } from './db.js'
import { storageRepository } from './storageRepository.js'
import { postUseCallbackDecisionRepository } from './postUseJiraRepository.js'
import { postUseJiraRepository } from './postUseJiraRepository.js'
import { actionItemRepository } from './actionItemRepository.js'
import { ticketTodoRepository } from './ticketTodoRepository.js'
import { recordMatchesPeriod, normalizeInsightPeriod } from '../src/domain/insightPeriod.js'
import { importMonthRangeForPeriod } from './recordIndex.js'
import { META_KEY_POST_USE_VISITS, normalizeVisitRecords } from '../src/lib/postUseRating/visitRecords.js'
import { getCatalogProducts } from '../src/lib/productCatalogLoader.js'
import { resolveActionItemProductDisplayName } from '../src/domain/actionItem.js'
import { listUsers } from './users.js'
import { uniqueEmails } from '../src/domain/mail.js'

const MAX_PER_CATEGORY = 50

/** @typedef {'productManager'|'designer'|'opsSupport'|'operations'|'tester'} OwnerRole */
const OWNER_ROLES = ['productManager', 'designer', 'opsSupport', 'operations', 'tester']
const ROLE_LABELS = {
  productManager: '产品经理',
  designer: '设计师',
  opsSupport: '运维三线',
  operations: '运营',
  tester: '测试',
}

/**
 * @param {Record<string, unknown>} record
 */
function getRecordProductKey(record) {
  return String(record?.productKey || '').trim()
}

/**
 * 孤儿决策恢复：jira 表无对应 item 时，从 itemKey 自身解析产品名。
 * itemKey 格式锚定生产方 questionnaireCallbackItemKey：
 *   q:{customerCode|customerName}:{productName}[:{importMonths}]
 *   c:{ticketId}（投诉回访类，无产品段——生产方 callbackNonTenItemKey）
 * @param {string} itemKey
 * @returns {string} 解析不出返回空串
 */
function productNameFromItemKey(itemKey) {
  const key = String(itemKey || '').trim()
  if (!key.startsWith('q:')) return ''
  const segments = key.slice(2).split(':')
  // 生产方 questionnaireCallbackItemKey：q:{code|name}:{product}[:{months}]
  // 产品名恒在第 2 段（segments[1]），第 3 段（若有）是月份段（YYYY-MM|... 形态）——
  // 真实形态验证：q:ORPHAN:弹性公网IP:2026-07 三段时 segments[1]=产品、segments[2]=月份
  return String(segments[1] || '').trim()
}

/**
 * 检查投诉工单角色字段是否任一为空
 * @param {Record<string, unknown>} record
 */
function checkComplaintRoleFields(record) {
  const fields = [
    'productGroupOptimization',
    'designerOptimization',
    'rootCauseReview',
    'complaintCauseL1Review',
    'complaintCauseL2Review',
    'complaintCauseL3Review',
  ]
  const missing = []
  for (const f of fields) {
    const val = String(record?.[f] || '').trim()
    if (!val) {
      // 将字段映射到角色名
      if (f === 'productGroupOptimization') missing.push('产品经理')
      else if (f === 'designerOptimization') missing.push('设计师')
      else if (f === 'rootCauseReview') missing.push('运维三线')
      // complaintCauseL1/L2/L3Review 不对应产品目录角色，是投诉原因终判复核流程
    }
  }
  return missing
}

/**
 * 计算超期/临近标签
 * @param {string} scheduleAt - 排期日期 YYYY-MM-DD
 * @param {string} todayStr - 今天 YYYY-MM-DD
 * @returns {{ overdue: boolean, near: boolean }}
 */
function computeActionUrgency(scheduleAt, todayStr) {
  const schedule = String(scheduleAt || '').trim()
  if (!schedule || !/^\d{4}-\d{2}-\d{2}/.test(schedule)) return { overdue: false, near: false }
  const today = new Date(todayStr + 'T00:00:00')
  const due = new Date(schedule.slice(0, 10) + 'T00:00:00')
  if (isNaN(due.getTime())) return { overdue: false, near: false }
  const diffDays = (due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  return {
    overdue: diffDays < 0,
    near: diffDays >= 0 && diffDays < 30,
  }
}

/**
 * @param {{ insightPeriodId?: string }} options
 */
export function buildReminderData({ insightPeriodId } = {}) {
  const todayStr = new Date().toISOString().slice(0, 10)
  const nowIso = new Date().toISOString()

  // 解析洞察周期
  const period = insightPeriodId ? storageRepository.getInsightPeriod(insightPeriodId) : null
  const periodLabel = period
    ? `${(period.startDate || '').slice(0, 7)}`
    : todayStr.slice(0, 7)

  // 1. 查投诉工单 + 咨询工单
  const recordQuery = period
    ? { insightPeriodId: period.id, limit: 5000, fields: 'full' }
    : { dataSourceTypes: ['complaint_ticket', 'consultation_ticket'], limit: 5000, fields: 'full' }

  // 使用 insightPeriodId 查询时，buildRecordsWhereClause 会自动按 importMonth 过滤
  // 但我们需要分别查投诉和咨询
  const complaintQuery = {
    ...recordQuery,
    dataSourceType: 'complaint_ticket',
    dataSourceTypes: undefined,
  }
  const consultationQuery = {
    ...recordQuery,
    dataSourceType: 'consultation_ticket',
    dataSourceTypes: undefined,
  }

  const complaintResult = storageRepository.listRecords(complaintQuery)
  const consultationResult = storageRepository.listRecords(consultationQuery)

  // 进一步按 recordMatchesPeriod 过滤（如果有周期）
  const complaintRecords = period
    ? complaintResult.records.filter((r) => recordMatchesPeriod(r, period))
    : complaintResult.records
  const consultationRecords = period
    ? consultationResult.records.filter((r) => recordMatchesPeriod(r, period))
    : consultationResult.records

  // 2. 查用后即评 decisions
  const allDecisions = postUseCallbackDecisionRepository.list()
  const traceDecisions = allDecisions.filter((d) => d.needInternalTrace)
  const visitDecisions = allDecisions.filter((d) => d.needCustomerVisit)

  // 3. 查溯源处理记录（2026-11-05：limit:-1 全量——归档超 500 条会静默截断漏提醒；status 读取时经 normalize 归一，旧值"已完成"已映射"已处理"）
  const allJiraItems = postUseJiraRepository.list({ limit: -1 })
  const jiraItemByKey = new Map()
  for (const item of allJiraItems.items) {
    jiraItemByKey.set(item.itemKey, item)
  }

  // 4. 查回访记录
  const visitRaw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
  const allVisits = normalizeVisitRecords(visitRaw)
  const visitByItemKey = new Map()
  for (const v of allVisits) {
    // visit records 的 itemKey 来源：questionnaireCallbackItemKey 或 callbackNonTenItemKey
    // 与 decision itemKey 一致
    if (v.originalTicketId) {
      // 对于 callback type，itemKey 是 c:TID
    }
  }
  // 回访记录通过 customerName + productName + importMonth 匹配
  // 先构建一个多维度索引
  const visitIndex = new Map()
  for (const v of allVisits) {
    const importMonth = String(v.importMonth || v.visitMonth || '').slice(0, 7)
    const key = `${String(v.customerName || '').trim()}|${String(v.productName || '').trim()}|${importMonth}`
    visitIndex.set(key, v)
  }

  // 5. 查未完成举措
  const actionItemsResult = actionItemRepository.listActionItems({
    statuses: 'pending_evaluation,in_progress,suspended',
    limit: 500,
  })

  // 6. 查会议待办
  const todoQuery = period
    ? { status: 'open', insightPeriodId: period.id, limit: 500 }
    : { status: 'open', limit: 500 }
  const todoResult = ticketTodoRepository.listTicketTodos(todoQuery)

  // 7. 按产品分组
  /** @type {Map<string, { productKey: string, productName: string, categories: any, attentionRoles: string[], owners: any }>} */
  const productMap = new Map()

  // 获取产品目录（含 owners）
  // 缓存刷新契约（10-25 修复口径）：本函数目录刷新由路由层负责——
  // routes/reminders.js 的 refreshProductCatalogForReminder 在每次
  // preview/send 调用 buildReminderData 前刷新（守卫 catalogCacheCoverageGuard
  // 凭此注释认可；新增调用方必须同样先刷新）。
  const catalogProducts = getCatalogProducts()
  const catalogByKey = new Map()
  for (const p of catalogProducts) {
    catalogByKey.set(p.key, p)
  }

  // 产品名 → key 映射（用于通过 productName 找 productKey）
  const productKeyByName = new Map()
  for (const p of catalogProducts) {
    productKeyByName.set(p.name, p.key)
  }

  // key → 目录中文名（records 大量 productName 为空、仅存 productKey，
  // 提醒邮件展示须用中文名而非英文 key）
  const productNameByKey = new Map()
  for (const p of catalogProducts) {
    productNameByKey.set(p.key, p.name)
  }

  /**
   * 展示名解析：目录中文名优先（productKey 命中），回退存库 productName，再回退 key。
   * 与举措/待办列表同源（resolveActionItemProductDisplayName）。
   * 键与名称全解析不出（unknown 假键 / c: 孤儿决策）统一展示「未知产品」——
   * 数据关联断裂场景不得用「未标注产品」误导为"导入时漏填"。
   */
  function resolveDisplayName(productKey, productName) {
    const resolved = resolveActionItemProductDisplayName(
      { productKey: String(productKey || '').trim(), productName: String(productName || '').trim() },
      productNameByKey,
    )
    return resolved === 'unknown' || resolved === '未标注产品' ? '未知产品' : resolved
  }

  function ensureProduct(productKey, productName) {
    const key = String(productKey || '').trim()
    const name = resolveDisplayName(key, productName)
    if (!productMap.has(key)) {
      const catalog = catalogByKey.get(key)
      const owners = catalog?.owners || {}
      productMap.set(key, {
        productKey: key,
        productName: name,
        categories: {
          complaintTickets: [],
          consultationSummary: { total: 0, sceneDistribution: {} },
          internalTraces: [],
          visitEvaluations: [],
          pendingActions: [],
          openTodos: [],
        },
        attentionRoles: [],
        owners,
      })
    }
    return productMap.get(key)
  }

  // --- 1a 投诉工单 ---
  for (const record of complaintRecords) {
    // 投诉/咨询的中文名在 product 字段（产品规格解析）；productName 是用后即评
    // 专用字段，对这两类恒为空——读它会导致展示名回退英文 key。
    const recordProduct = record?.product || record?.productName
    const pk = getRecordProductKey(record) || productKeyByName.get(String(recordProduct || '').trim()) || 'unknown'
    const pn = String(recordProduct || '').trim() || pk
    const product = ensureProduct(pk, pn)
    const tagStatus = String(record?.tagStatus || '').trim()
    const missingRoles = checkComplaintRoleFields(record)
    const needsReview = tagStatus === 'manual_review' || missingRoles.length > 0
    if (!needsReview) continue
    if (product.categories.complaintTickets.length < MAX_PER_CATEGORY) {
      product.categories.complaintTickets.push({
        ticketId: String(record?.ticketId || ''),
        customerName: String(record?.customerName || record?.sourceColumns?.['集团名称'] || ''),
        productName: pn,
        problemSummary: String(record?.problemSummary || record?.handlingText || '').slice(0, 100),
        missingRoles,
        tagStatus,
      })
    }
    // 累加需关注角色
    for (const r of missingRoles) {
      if (!product.attentionRoles.includes(r)) product.attentionRoles.push(r)
    }
  }

  // --- 1b 咨询工单 ---
  for (const record of consultationRecords) {
    // 同投诉工单：中文名真源是 product 字段
    const recordProduct = record?.product || record?.productName
    const pk = getRecordProductKey(record) || productKeyByName.get(String(recordProduct || '').trim()) || 'unknown'
    const pn = String(recordProduct || '').trim() || pk
    const product = ensureProduct(pk, pn)
    product.categories.consultationSummary.total++
    const scene = String(record?.requestScene || '未分类').trim()
    if (!product.categories.consultationSummary.sceneDistribution[scene]) {
      product.categories.consultationSummary.sceneDistribution[scene] = 0
    }
    product.categories.consultationSummary.sceneDistribution[scene]++
  }

  // --- 2 用后即评-产品部溯源 ---
  for (const decision of traceDecisions) {
    const jiraItem = jiraItemByKey.get(decision.itemKey)
    const status = jiraItem?.status || '待处理' // 无记录视为待处理
    // 2026-11-05 口径拍板：已处理 = 完成态（含旧值"已完成"，读取已归一），不纳入提醒
    if (status === '已处理') continue

    // 获取产品信息（从 jira_item 或 decision 关联数据）
    // 孤儿决策恢复：jira 表无对应 item 时从 itemKey 解析产品名（q:code:product:months 的 product 段），
    // 避免空键空名组落「未标注产品」兜底文案
    const productName = String(jiraItem?.productName || '').trim() || productNameFromItemKey(decision.itemKey)
    const productKey = productKeyByName.get(productName) || ''
    const product = ensureProduct(productKey, productName)

    if (product.categories.internalTraces.length < MAX_PER_CATEGORY) {
      product.categories.internalTraces.push({
        itemKey: decision.itemKey,
        customerName: String(jiraItem?.customerName || ''),
        productName,
        feedbackSummary: String(jiraItem?.customerFeedback || '').slice(0, 100),
        assigneeName: String(jiraItem?.assigneeName || '未指派'),
        status,
      })
    }
  }

  // --- 3 用后即评-补充的回访结果待评估 ---
  const { startMonth, endMonth } = period
    ? importMonthRangeForPeriod(period)
    : { startMonth: '', endMonth: '' }

  for (const decision of visitDecisions) {
    // 查找对应的 visit record
    // decision 的 itemKey 格式：questionnaire:customerName:customerCode:productName:importMonths
    // visit record 通过 customerName + productName + importMonth 匹配
    // 先尝试通过 itemKey 直接匹配，如果不行则通过维度匹配

    // 从 decision 中提取维度信息（如果有的话）
    // decision 本身只存 itemKey + sourceType + needCustomerVisit + needInternalTrace
    // 需要从 jira_items 中查找维度信息
    const jiraItem = jiraItemByKey.get(decision.itemKey)
    const customerName = String(jiraItem?.customerName || '').trim()
    // 孤儿决策恢复：同溯源循环口径
    const productName = String(jiraItem?.productName || '').trim() || productNameFromItemKey(decision.itemKey)

    // 查 visit records
    let visitRecord = null
    if (customerName && productName) {
      // 按周期月份范围搜索
      if (startMonth && endMonth) {
        // 遍历月份范围
        let month = startMonth
        while (month <= endMonth) {
          const key = `${customerName}|${productName}|${month}`
          if (visitIndex.has(key)) {
            visitRecord = visitIndex.get(key)
            break
          }
          // 下个月
          const [y, m] = month.split('-').map(Number)
          const next = new Date(y, m, 1)
          month = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`
        }
      } else {
        // 无周期过滤，搜索所有月份
        for (const [key, v] of visitIndex) {
          if (key.startsWith(`${customerName}|${productName}|`)) {
            visitRecord = v
            break
          }
        }
      }
    }

    // 2026-11-05 评估状态派生口径（与回访抽屉/列表一致）：
    // 评估空 → 待评估（纳入提醒）；非空未提交 → 评估中（纳入提醒）；已提交 → 已评估（不纳入）。
    const internalConclusion = String(visitRecord?.internalConclusion || '').trim()
    const internalEvaluationDetail = String(visitRecord?.internalEvaluationDetail || '').trim()
    const evaluationSubmitted = Boolean(visitRecord?.evaluationSubmitted)
    if (evaluationSubmitted) continue // 已评估（提交完结）不纳入
    if (internalConclusion || internalEvaluationDetail) continue // 兼容旧链路：历史填了评估但无提交标记的，同样视为已评估

    const productKey = productKeyByName.get(productName) || ''
    const product = ensureProduct(productKey, productName)

    if (product.categories.visitEvaluations.length < MAX_PER_CATEGORY) {
      product.categories.visitEvaluations.push({
        itemKey: decision.itemKey,
        customerName,
        productName,
        visitResult: String(visitRecord?.visitResult || '').slice(0, 100) || '（回访结果未导入）',
        internalConclusion: '',
      })
    }
  }

  // --- 4 未完成举措 ---
  for (const item of actionItemsResult.items) {
    const pk = String(item.productKey || '').trim()
    const pn = String(item.productName || '').trim() || pk || '未知产品'
    const product = ensureProduct(pk, pn)

    if (product.categories.pendingActions.length < MAX_PER_CATEGORY) {
      const urgency = computeActionUrgency(item.scheduleAt, todayStr)
      product.categories.pendingActions.push({
        id: item.id,
        content: String(item.content || ''),
        status: item.status,
        statusLabel: item.status === 'pending_evaluation' ? '待评估'
          : item.status === 'in_progress' ? '进行中'
          : item.status === 'suspended' ? '挂起' : item.status,
        scheduleAt: String(item.scheduleAt || ''),
        firstProposedAt: String(item.firstProposedAt || ''),
        overdue: urgency.overdue,
        near: urgency.near,
      })
    }
  }

  // --- 5 客户体验类分析会会后待办 ---
  for (const todo of todoResult.items) {
    const pk = String(todo.productKey || '').trim()
    const pn = String(todo.productName || '').trim() || pk || '未知产品'
    const product = ensureProduct(pk, pn)

    if (product.categories.openTodos.length < MAX_PER_CATEGORY) {
      product.categories.openTodos.push({
        id: todo.id || todo.ticketTodoItemId,
        text: String(todo.text || ''),
        linkedTicketIds: todo.linkedTicketIds || (todo.ticketId ? [todo.ticketId] : []),
        assigneeName: String(todo.assigneeName || '未指派'),
        productKey: pk,
        productName: pn,
      })
    }
  }

  // 8. 过滤无待办产品 + 计算收件人
  const products = []
  /** @type {Map<string, { userId: string, username: string, displayName: string, email: string }>} */
  const userMap = new Map()
  for (const u of listUsers()) {
    userMap.set(u.id, {
      userId: u.id,
      username: u.username,
      displayName: u.display_name || u.username,
      email: u.email || `${u.username}@cmss.chinamobile.com`,
    })
  }

  const recipientEmails = new Set()

  for (const [, product] of productMap) {
    const c = product.categories
    const total =
      c.complaintTickets.length +
      c.consultationSummary.total +
      c.internalTraces.length +
      c.visitEvaluations.length +
      c.pendingActions.length +
      c.openTodos.length

    if (total === 0) continue // 无待办，不纳入

    // 收集该产品 owners 的 email
    for (const role of OWNER_ROLES) {
      const owners = product.owners?.[role]
      if (!Array.isArray(owners)) continue
      for (const owner of owners) {
        const user = userMap.get(owner.userId)
        if (user?.email) recipientEmails.add(user.email)
      }
    }

    products.push(product)
  }

  const totalCount = products.reduce((sum, p) => {
    const c = p.categories
    return sum + c.complaintTickets.length + c.consultationSummary.total +
      c.internalTraces.length + c.visitEvaluations.length +
      c.pendingActions.length + c.openTodos.length
  }, 0)

  return {
    products,
    recipientEmails: uniqueEmails([...recipientEmails]),
    totalCount,
    periodLabel,
    generatedAt: nowIso,
  }
}
