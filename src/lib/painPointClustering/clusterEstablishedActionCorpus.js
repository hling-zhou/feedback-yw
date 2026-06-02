import { getEstablishedActionDisplay } from '../../domain/establishedAction.js'
import { isGenericMeasure, isTicketDerivedPlanningText } from '../journeyOptimizationLLM.js'
import { stripProductActionAroundPrefix, PLANNING_RECOMMENDATION_LIMITS } from '../planningRecommendationTemplate.js'

/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */

/** 群组内同一确立举措至少关联工单数，才参与 productActions 槽位 2 */
export const CLUSTER_ESTABLISHED_ACTION_MIN_TICKETS = 3

/** 离线沉淀 playbook：跨周期至少覆盖的 distinct 月份数 */
export const PLAYBOOK_PROMOTION_MIN_DISTINCT_MONTHS = 2

const MAX_ACTION_LEN = PLANNING_RECOMMENDATION_LIMITS.maxDetailLength

/** 与 clusterActionSynthesis 一致：服务/流程类不进 productActions */
const SERVICE_ACTION_RE =
  /SLA|回访|工单流转|升级路径|催办|空转|服务流程|响应时效|人工服务|升级\/回访/

const TICKET_METADATA_RE =
  /请求节点|工单标题|详细内容：|计费咨询--|受理内容|处理意见|目前进展|协助内容/

/**
 * @param {string} text
 */
export function isUsableEstablishedActionText(text) {
  const t = text?.trim()
  if (!t || t.length < 12) return false
  if (SERVICE_ACTION_RE.test(t)) return false
  if (isTicketDerivedPlanningText(t) || isGenericMeasure(t)) return false
  if (TICKET_METADATA_RE.test(t)) return false
  return true
}

/**
 * @param {string} text
 */
export function normalizeEstablishedActionKey(text) {
  return text.trim().slice(0, 100)
}

/**
 * @param {string} text
 * @param {number} [maxLen]
 */
export function normalizeEstablishedForProductAction(text, maxLen = MAX_ACTION_LEN) {
  let t = stripProductActionAroundPrefix(String(text ?? '').trim())
  t = t.replace(/\s+/g, ' ').trim()
  if (!t) return ''
  if (t.length <= maxLen) return t
  return `${t.slice(0, maxLen - 1)}…`
}

/**
 * @param {FeedbackRecord[]} pool
 * @returns {{ text: string; count: number; key: string }[]}
 */
export function collectClusterEstablishedActions(pool) {
  /** @type {Map<string, { text: string; count: number }>} */
  const map = new Map()

  for (const record of pool || []) {
    const raw = getEstablishedActionDisplay(record)
    if (!raw) continue
    for (const line of raw.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
      if (!isUsableEstablishedActionText(line)) continue
      const normalized = normalizeEstablishedForProductAction(line)
      if (!normalized || normalized.length < 12) continue
      const key = normalizeEstablishedActionKey(normalized)
      const prev = map.get(key)
      if (prev) {
        prev.count += 1
      } else {
        map.set(key, { text: normalized, count: 1 })
      }
    }
  }

  return [...map.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ text, count }) => ({ text, count, key: normalizeEstablishedActionKey(text) }))
}

/**
 * @param {FeedbackRecord[]} pool
 * @returns {{ text: string; count: number } | null}
 */
export function pickClusterEstablishedActionForSynthesis(pool) {
  const top = collectClusterEstablishedActions(pool)[0]
  if (!top || top.count < CLUSTER_ESTABLISHED_ACTION_MIN_TICKETS) return null
  return { text: top.text, count: top.count }
}

/**
 * @param {string | undefined} dateLike
 * @returns {string}
 */
function monthKeyFromDate(dateLike) {
  const s = String(dateLike ?? '').trim()
  const m = s.match(/^(\d{4})-(\d{2})/)
  return m ? `${m[1]}-${m[2]}` : ''
}

/**
 * 跨工单/跨周期聚合确立举措（供 playbook 离线沉淀）
 *
 * @param {FeedbackRecord[]} records
 * @param {{ minCount?: number; minDistinctMonths?: number }} [options]
 */
export function aggregateEstablishedActionsFromRecords(records, options = {}) {
  const minCount = options.minCount ?? CLUSTER_ESTABLISHED_ACTION_MIN_TICKETS
  const minDistinctMonths = options.minDistinctMonths ?? PLAYBOOK_PROMOTION_MIN_DISTINCT_MONTHS

  /** @type {Map<string, { text: string; count: number; months: Set<string>; product: string; journeyL2: string; problemType: string }>} */
  const map = new Map()

  for (const record of records || []) {
    const raw = getEstablishedActionDisplay(record)
    if (!raw) continue
    const month = monthKeyFromDate(record.createdAt || record.updatedAt)
    const product = String(record.productSpec || record.product || '').trim()
    const journeyL2 = String(record.journeyL2 || '').trim()
    const problemType = String(record.problemType || '').trim()

    for (const line of raw.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
      if (!isUsableEstablishedActionText(line)) continue
      const normalized = normalizeEstablishedForProductAction(line)
      if (!normalized || normalized.length < 12) continue
      const scopeKey = [product, journeyL2, problemType, normalizeEstablishedActionKey(normalized)].join('\0')
      const prev = map.get(scopeKey)
      if (prev) {
        prev.count += 1
        if (month) prev.months.add(month)
      } else {
        map.set(scopeKey, {
          text: normalized,
          count: 1,
          months: new Set(month ? [month] : []),
          product,
          journeyL2,
          problemType,
        })
      }
    }
  }

  return [...map.values()]
    .filter((row) => row.count >= minCount && row.months.size >= minDistinctMonths)
    .sort((a, b) => b.count - a.count || b.months.size - a.months.size)
    .map(({ text, count, months, product, journeyL2, problemType }) => ({
      text,
      count,
      distinctMonths: months.size,
      product,
      journeyL2,
      problemType,
    }))
}
