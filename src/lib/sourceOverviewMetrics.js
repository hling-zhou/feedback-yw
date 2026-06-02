import { listProducts } from './productTaxonomy.js'
import { filterRecordsForScope } from '../snapshots/recordScope.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */
/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/**
 * @param {FeedbackRecord[]} records
 * @returns {Map<string, number>}
 */
function productCountMap(records) {
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const row of listProducts(records)) {
    map.set(row.name, row.count)
  }
  return map
}

/**
 * 环比增幅最大产品（仅统计上周期基数 > 0 且本周期工单数增加的产品）
 * @param {FeedbackRecord[]} currentRecords
 * @param {FeedbackRecord[]} previousRecords
 * @returns {string | null}
 */
export function computeMaxMomGrowthProduct(currentRecords, previousRecords) {
  if (!previousRecords.length || !currentRecords.length) return null

  const prevMap = productCountMap(previousRecords)
  const currMap = productCountMap(currentRecords)

  let bestProduct = null
  let bestGrowthPct = 0

  for (const [product, currentCount] of currMap) {
    const previousCount = prevMap.get(product) ?? 0
    if (previousCount <= 0 || currentCount <= previousCount) continue
    const growthPct = ((currentCount - previousCount) / previousCount) * 100
    if (growthPct > bestGrowthPct) {
      bestGrowthPct = growthPct
      bestProduct = product
    }
  }

  return bestProduct
}

/**
 * @param {FeedbackRecord[]} feedbacks
 * @param {InsightPeriod | null | undefined} period
 * @param {InsightPeriod | null | undefined} previousPeriod
 * @param {DataSourceType} dataSourceType
 * @returns {string | null}
 */
export function computeMaxMomGrowthProductForSource(
  feedbacks,
  period,
  previousPeriod,
  dataSourceType,
) {
  if (!period || !previousPeriod) return null
  const currentRecords = filterRecordsForScope(feedbacks, period, dataSourceType)
  const previousRecords = filterRecordsForScope(feedbacks, previousPeriod, dataSourceType)
  return computeMaxMomGrowthProduct(currentRecords, previousRecords)
}
