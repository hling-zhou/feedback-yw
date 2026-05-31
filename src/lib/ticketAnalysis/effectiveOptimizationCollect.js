import { isGenericMeasure, isTicketDerivedPlanningText } from '../journeyOptimizationLLM.js'
import { getEffectiveOptimization } from './ticketOptimizationExtract.js'

/**
 * 从工单集合收集有效优化建议（人工复核优先，自动建议不参与人工复核工单）
 *
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {number} [limit]
 * @returns {{ text: string; count: number; source: string }[]}
 */
export function collectEffectiveOptimizationsFromRecords(records, limit = 8) {
  /** @type {Map<string, { text: string; count: number; source: string; priority: number }>} */
  const map = new Map()

  const add = (text, source, priority) => {
    const t = text?.trim()
    if (!t || t.length < 12) return
    if (isTicketDerivedPlanningText(t) || isGenericMeasure(t)) return
    const key = t.slice(0, 100)
    const prev = map.get(key)
    if (prev) {
      prev.count += 1
      prev.priority = Math.max(prev.priority, priority)
    } else {
      map.set(key, { text: t, count: 1, source, priority })
    }
  }

  for (const fb of records || []) {
    const eff = getEffectiveOptimization(fb)
    const manual = eff.source === 'manual'
    const basePriority = manual ? 10 : 5
    const source = manual ? '人工复核优化建议' : '单条优化建议'

    if (eff.product) {
      for (const line of eff.product.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
        add(line, source, basePriority)
      }
    }
    if (eff.service) {
      for (const line of eff.service.split(/\n+/).map((x) => x.trim()).filter(Boolean)) {
        add(line, source, basePriority - 1)
      }
    }
    if (!eff.product && !eff.service && eff.combined) {
      add(eff.combined, source, basePriority)
    }
  }

  return [...map.values()]
    .sort((a, b) => b.priority - a.priority || b.count - a.count)
    .slice(0, limit)
    .map(({ text, count, source }) => ({ text, count, source }))
}
