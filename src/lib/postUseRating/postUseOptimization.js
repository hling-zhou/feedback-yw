/**
 * 用后即评「优化建议（自动生成）」适配层（省代表回访 visit + 产品部溯源 trace）。
 * DESIGN-用后即评抽屉优化建议-20261119.md（2026-11-19 拍板）：
 * - 语料口径：visit = 客户反馈 userFeedbackText + 回访结果 visitFeedbackDetail/visitResult；
 *   trace = 客户反馈 customerFeedback（+ 投诉回访类拼原投诉工单处理意见，跨表由调用方注入）。
 * - 内部评估/回溯结果/备注不进语料（防反向污染）。
 * - prompt 零漂移复用工单 prompt；场景心智靠语料前缀对齐。
 * - 来源如实标注：LLM 真实产出 'llm'，失败回退规则 'rule'（来源标注纪律）。
 * - 已有值不重生成（幂等）。
 */
import { canUseSemanticMatch } from '../themeSemantic.js'
import { extractTicketOptimizations } from '../ticketAnalysis/ticketOptimizationExtract.js'
import { extractTicketOptimizationsWithLLM } from '../ticketAnalysis/ticketOptimizationLLM.js'

/** @typedef {'visit' | 'trace'} PostUseOptimizationEntityType */

const SCENE_PREFIX = /** @type {Record<PostUseOptimizationEntityType, string>} */ ({
  visit: '[省代表回访反馈]',
  trace: '[产品部溯源·客户反馈]',
})

/**
 * 语料单源（拍板 6 + 生产方字段核对）：
 * - visit：userFeedbackText → visitFeedbackDetail/visitResult（回访结果）；
 * - trace：customerFeedback +（可选）调用方注入的原投诉工单处理意见段。
 *   内部评估 internalEvaluationDetail/internalConclusion、回溯结果 progress、备注 remark 一律不进语料。
 * @param {Record<string, unknown> | null | undefined} entity
 * @param {PostUseOptimizationEntityType} entityType
 * @param {{ complaintHandlingText?: string }} [options] trace 投诉回访类：records 表按工单号取的处理意见（截取口径 split('处理意见：')[-1]），由服务端调用方注入
 * @returns {string}
 */
export function collectPostUseOptimizationText(entity, entityType, options = {}) {
  const get = (key) => String(/** @type {any} */ (entity)?.[key] ?? '').trim()
  /** @type {string[]} */
  const parts = []
  if (entityType === 'visit') {
    parts.push(get('userFeedbackText'))
    parts.push(get('visitFeedbackDetail') || get('visitResult'))
  } else {
    parts.push(get('customerFeedback'))
    const complaintText = String(options?.complaintHandlingText ?? '').trim()
    if (complaintText) parts.push(`【原投诉工单处理意见】\n${complaintText}`)
  }
  const corpus = parts.filter(Boolean).join('\n')
  if (!corpus) return ''
  return `${SCENE_PREFIX[entityType]}\n${corpus}`
}

/**
 * 待生成判定（批量过滤与计数同源）：有语料且未生成过（optimizationProduct 为空）。
 * @param {Record<string, unknown> | null | undefined} entity
 * @param {PostUseOptimizationEntityType} entityType
 * @returns {boolean}
 */
export function needsPostUseOptimization(entity, entityType) {
  if (!entity) return false
  if (String(/** @type {any} */ (entity).optimizationProduct ?? '').trim()) return false
  return Boolean(collectPostUseOptimizationText(entity, entityType))
}

/**
 * 从溯源实体提取原投诉工单号（真实形态核对 11-19：存量 c: 项 payload 无 scoreSource 字段，
 * 工单号在 itemKey 第 2 段；归一化后 originalTicketId 可能来自导入列「相应投诉工单」）。
 * @param {Record<string, unknown> | null | undefined} entity
 * @returns {string} 工单号；非投诉回访类返回 ''
 */
export function traceComplaintTicketId(entity) {
  const scoreSource = String(/** @type {any} */ (entity)?.scoreSource ?? '').trim()
  const itemKey = String(/** @type {any} */ (entity)?.itemKey ?? '').trim()
  const explicit = String(/** @type {any} */ (entity)?.originalTicketId ?? '').trim()
  if (scoreSource === '投诉回访') return explicit || (itemKey.startsWith('c:') ? itemKey.slice(2) : '')
  // 存量 callback_non_ten 项 scoreSource 兜底为空串，靠 itemKey 前缀识别
  if (itemKey.startsWith('c:')) return explicit || itemKey.slice(2)
  return ''
}

/**
 * 生成优化建议：LLM 优先（复用工单 prompt，零改动），失败/未配置回退规则抽取。
 * @param {Record<string, unknown>} entity
 * @param {PostUseOptimizationEntityType} entityType
 * @param {import('../storage.js').AppSettings} settings
 * @param {{ knowledgeSnippets?: string, productName?: string, complaintHandlingText?: string }} [extras]
 * @returns {Promise<{ optimizationProduct: string, optimizationService: string, optimizationSource: 'rule' | 'llm' }>}
 */
export async function generatePostUseOptimizations(entity, entityType, settings, extras = {}) {
  const text = collectPostUseOptimizationText(entity, entityType, extras)
  if (!text) {
    return { optimizationProduct: '', optimizationService: '', optimizationSource: 'rule' }
  }

  /** @type {{ optimizationProduct: string, optimizationService: string, optimizationSource: 'rule' | 'llm' }} */
  let result = {
    ...extractTicketOptimizations({ text, journeyL2: '', painPoint: '', rootCause: '' }),
    optimizationSource: /** @type {'rule'} */ ('rule'),
  }

  if (!canUseSemanticMatch(settings)) return result

  try {
    const llm = await extractTicketOptimizationsWithLLM(
      {
        text,
        // 工单 prompt 需要的上下文尽量给全；实体没有的字段留空，prompt 已兼容
        journeyL2: String(/** @type {any} */ (entity).journeyL2 ?? ''),
        painPoint: String(/** @type {any} */ (entity).painPoint ?? ''),
        requestScene: String(/** @type {any} */ (entity).requestScene ?? ''),
        problemType: String(/** @type {any} */ (entity).problemType ?? ''),
      },
      settings,
      { knowledgeSnippets: extras.knowledgeSnippets, productName: extras.productName },
    )
    if (llm.optimizationProduct || llm.optimizationService) {
      result = {
        optimizationProduct: llm.optimizationProduct,
        optimizationService: llm.optimizationService,
        optimizationSource: /** @type {'llm'} */ ('llm'),
      }
    }
  } catch (err) {
    console.warn('[post-use-optimization] LLM 失败，保留规则结果:', err)
  }

  return result
}

/**
 * 只 merge 优化三字段（写回防覆盖拍板：禁止整条覆盖在线编辑）。
 * @param {Record<string, unknown>} entity
 * @param {{ optimizationProduct: string, optimizationService: string, optimizationSource: 'rule' | 'llm' }} result
 * @returns {Record<string, unknown>}
 */
export function applyPostUseOptimizationPatch(entity, result) {
  return {
    ...entity,
    optimizationProduct: result.optimizationProduct,
    optimizationService: result.optimizationService,
    optimizationSource: result.optimizationSource,
  }
}
