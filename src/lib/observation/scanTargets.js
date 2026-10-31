import { isSubstantiveFeedbackReason, splitFeedbackReasonPieces } from '../postUseRating/reasonTaxonomy.js'
import { resolvePostUseRatingProduct } from '../productCatalog/postUseRatingProducts.js'

/**
 * 自动识别候选池（DESIGN §3.1 步 1 / §3.2 C1）。
 *
 * 口径（用户定稿 2026-10-31）：
 * - 投诉/咨询工单：全量参与；
 * - 用后即评：**不看分数**，只看实质 lowScoreReason（占位词/正面词/裸动作词/否定式正面清洗）
 *   ——一格多选项按分号拆分，任一子项实质负面即入选；
 * - 产品边界：对齐 resolvePostUseRatingProduct（目录内才参与自动匹配；目录外不进池）。
 *
 * @typedef {Object} ObservationScanTarget
 * @property {string} recordId
 * @property {'complaint_ticket' | 'consultation_ticket' | 'post_use_rating'} recordDataSource
 * @property {string} productKey
 * @property {string} productName
 * @property {string} ticketId
 * @property {string | null} originalTicketId - 仅用后即评（锚点通道用）
 */

/**
 * @param {unknown} record
 * @returns {boolean}
 */
export function isPostUseRatingRecord(record) {
  return String(record?.dataSourceType || '') === 'post_use_rating'
}

/**
 * 评价负面判定：lowScoreReason 实质负面（不看分数）。
 * @param {unknown} record
 * @returns {boolean}
 */
export function isSubstantiveNegativeRating(record) {
  const raw = record?.lowScoreReason
  if (raw == null) return false
  const pieces = splitFeedbackReasonPieces(raw)
  if (!pieces.length) return false
  return pieces.some((piece) => isSubstantiveFeedbackReason(piece))
}

/**
 * 候选池筛选。
 *
 * @param {Object} params
 * @param {unknown[]} params.records
 * @param {import('../productCatalogLoader.js').CatalogProduct[]} [params.catalogProducts] - 未传则函数内部无法判目录，目录外评价将被排除
 * @returns {ObservationScanTarget[]}
 */
export function resolveObservationScanTargets({ records, catalogProducts = [] }) {
  /** @type {ObservationScanTarget[]} */
  const targets = []
  for (const record of records || []) {
    if (!record || typeof record !== 'object') continue
    const recordId = String(record.id || '').trim()
    if (!recordId) continue
    const dataSourceType = String(record.dataSourceType || '').trim()
    if (dataSourceType === 'post_use_rating') {
      if (!isSubstantiveNegativeRating(record)) continue
      const catalogProduct = resolvePostUseRatingProduct(
        { productName: String(record.productName || record.product || '') },
        catalogProducts,
      )
      if (!catalogProduct) continue // 目录外不进自动池（手动纳入不受限）
      targets.push({
        recordId,
        recordDataSource: 'post_use_rating',
        productKey: catalogProduct.key,
        productName: catalogProduct.name,
        ticketId: String(record.ticketId || ''),
        originalTicketId: String(record.originalTicketId || '').trim() || null,
      })
      continue
    }
    if (dataSourceType === 'complaint_ticket' || dataSourceType === 'consultation_ticket') {
      targets.push({
        recordId,
        recordDataSource: dataSourceType,
        productKey: String(record.productKey || '').trim(),
        productName: String(record.product || record.productName || '').trim(),
        ticketId: String(record.ticketId || ''),
        originalTicketId: null,
      })
    }
    // 其他数据源类型不参与留观自动识别
  }
  return targets
}
