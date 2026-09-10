/**
 * 闸门失败重试闭环 (Gate Retry Loop)
 *
 * 设计原则（用户 2026-09-10 确认）：
 *  - 闸门不通过 → 重新处理（换策略），不卡住下游
 *  - 重处理仍不通过 → 标 manual_review，人工修正
 *  - LLM 介入做闸门修复（用户明确要求引入 LLM 介入）
 *  - manual_review 工单落盘但跳过下游 LLM 增强
 *  - 最多 1 轮重试（避免无限循环），LLM 介入作为最后一道策略
 *
 * 每层闸门的重试策略：
 *  L0（customerRequest 质量 + 意图可信度）：
 *    R1: 扩大语料窗口（从 customerRequest 扩展到 fullText）
 *    R2: 处理意见结论信号补入（handlingSignalExtract 的 verified signals）
 *    R3: LLM 介入（调用 extractCustomerRequestWithLLM 重新提取）
 *  L1（requestScene × problemType 一致性）：
 *    R1: 回退旧分类器（不用 extractIntent，用独立 problemTypeClassifier/requestSceneClassifier）
 *    R2: 路径兜底（从请求节点/系统路径提取 scene+type）
 *    R3: LLM 介入（用 LLM 语料重打维度）
 *  L2（journey 有效性）：
 *    R1: 路径兜底（从请求节点提取旅程）
 *    R2: 宽松匹配（useRequestNode=true 放宽旅程匹配）
 *    R3: 标 manual_review（旅程 LLM 介入代价高，暂不做）
 */

import { extractIntent, intentToRequestScene, intentToProblemType } from './intentExtractor.js'
import { validateL0, validateL1, validateL2 } from './dimensionValidation.js'
import { buildDimensionTaggingLayers, buildDimensionTaggingText } from './dimensionTaggingText.js'
import { extractVerifiedSupplementSignals } from './handlingSignalExtract.js'
import { TAG_UNRECOGNIZED, normalizeTagLabel } from './tagLabels.js'
import {
  matchJourneyByDescription,
} from '../ticketTagging.js'
import {
  matchRequestSceneFromPath,
  matchProblemTypeFromPath,
  matchJourneyFromPath,
} from './pathTagging.js'
import { isUnrecognizedTag } from './tagLabels.js'
import { resolveProblemTypeWithPeerFallback, resolveRequestSceneFromConfig } from '../dimensionTagging.js'

/**
 * 最大重试轮次
 */
const MAX_RETRY_ROUNDS = 1

/**
 * 闸门重试结果
 * @typedef {Object} RetryResult
 * @property {boolean} pass 重试后闸门是否通过
 * @property {Object} dims 修复后的维度结果（requestScene/problemType/journeyL1/journeyL2/customerRequest/confidence）
 * @property {string} tagStatus 'ok' | 'manual_review'
 * @property {string[]} tagIssues 累积的问题列表
 * @property {string} retryStrategy 最终生效的策略名（或 'none'）
 */

/**
 * 从 text 中解析请求节点路径段
 * @param {string} text
 * @returns {string[]}
 */
function extractPathSegments(text) {
  const segs = (text.match(/(?:请求节点|系统路径)[：:]([^\n]+)/i) || [])[1]
    ?.split('--')
    .map((s) => s.trim())
    .filter((s) => s && s !== 'undefined') || []
  return segs
}

// ============================================================
// L0 重试策略
// ============================================================

/**
 * L0-R1: 扩大语料窗口
 * 当 customerRequest 太短/无信号时，用 buildDimensionTaggingText 获取更完整的语料
 */
function retryL0ExpandCorpus(input, text, taxonomy, taxonomyKey) {
  const layers = buildDimensionTaggingLayers(input)
  const fullText = layers?.fullText || text

  // 从更完整的语料中重新提取 customerRequest 级别的信号
  const expandedCR = buildDimensionTaggingText(input) || fullText
  const intent = extractIntent(expandedCR)

  return {
    customerRequest: expandedCR.slice(0, 120),
    confidence: intent.confidence,
    intent,
  }
}

/**
 * L0-R2: 处理意见结论信号补入
 * 从 handlingText 中提取已验证的结论信号，追加到 customerRequest
 */
function retryL0HandlingSupplement(input, text, taxonomy, taxonomyKey) {
  const cr = input?.customerRequest?.trim() || ''
  const supplement = extractVerifiedSupplementSignals({
    rawText: input?.rawText || '',
    handlingText: input?.handlingText || '',
    customerRequest: cr,
  })

  if (!supplement) return null

  const enrichedCR = cr ? `${cr} ${supplement}` : supplement
  const intent = extractIntent(enrichedCR)

  return {
    customerRequest: enrichedCR.slice(0, 120),
    confidence: intent.confidence,
    intent,
  }
}

/**
 * L0-R3: LLM 介入
 * 调用 LLM 重新提取 customerRequest（需要 settings 中配置 LLM）
 * @returns {Promise<Object|null>}
 */
async function retryL0LLM(input, text, settings) {
  if (!settings) return null
  try {
    const { canUseSemanticMatch } = await import('../themeSemantic.js')
    if (!canUseSemanticMatch(settings)) return null

    const { resolveSettingsForLlm } = await import('../llmClient.js')
    const llmSettings = await resolveSettingsForLlm(settings)

    const { buildCustomerRequestExtractionContext } = await import('./customerRequestExtract.js')
    const { extractCustomerRequestWithLLM } = await import('./customerRequestLLM.js')

    const ctx = buildCustomerRequestExtractionContext(input)
    const llmResult = await extractCustomerRequestWithLLM(
      {
        taggingText: buildDimensionTaggingText(input) || text,
        candidates: ctx.candidates,
        ruleFallback: ctx.ruleFallback,
      },
      llmSettings,
    )

    if (!llmResult) return null

    const intent = extractIntent(llmResult)
    return {
      customerRequest: llmResult,
      confidence: intent.confidence,
      intent,
    }
  } catch {
    return null
  }
}

// ============================================================
// L1 重试策略
// ============================================================

/**
 * L1-R1: 回退旧分类器
 * 不用 extractIntent，用独立的 problemTypeClassifier + requestSceneClassifier
 */
function retryL1FallbackClassifier(input, text, taxonomy, taxonomyKey) {
  const corpus = input ? buildDimensionTaggingText(input) : text
  const fullPeer = input ? buildDimensionTaggingLayers(input).fullText || text : text

  const problemType = normalizeTagLabel(
    resolveProblemTypeWithPeerFallback(corpus, fullPeer, taxonomy.problemTypes),
    'dimension',
  )
  const requestScene = normalizeTagLabel(
    resolveRequestSceneFromConfig(corpus, taxonomy.requestScenes),
    'dimension',
  )

  return { requestScene, problemType }
}

/**
 * L1-R2: 路径兜底
 * 从请求节点/系统路径提取 scene + problemType
 */
function retryL1PathFallback(text, taxonomy, taxonomyKey) {
  const segments = extractPathSegments(text)
  if (segments.length < 2) return null

  const pathScene = matchRequestSceneFromPath(segments, taxonomyKey, taxonomy.requestScenes)
  const pathProblem = matchProblemTypeFromPath(segments, taxonomyKey, taxonomy.problemTypes)

  if (!pathScene && !pathProblem) return null

  return {
    requestScene: pathScene ? normalizeTagLabel(pathScene, 'dimension') : undefined,
    problemType: pathProblem ? normalizeTagLabel(pathProblem, 'dimension') : undefined,
  }
}

/**
 * L1-R3: LLM 介入重打维度
 * 用 LLM 提取的语料重跑维度分类
 */
async function retryL1LLM(input, text, taxonomy, taxonomyKey, settings) {
  if (!settings) return null
  try {
    const { canUseSemanticMatch } = await import('../themeSemantic.js')
    if (!canUseSemanticMatch(settings)) return null

    const { resolveSettingsForLlm } = await import('../llmClient.js')
    const llmSettings = await resolveSettingsForLlm(settings)

    const { enrichRecordsWithSharedDimensions } = await import('../dimensionTagging.js')
    const tagInput = {
      product: input?.product,
      productKey: taxonomyKey,
      rawText: input?.rawText || text,
      handlingText: input?.handlingText || '',
    }

    const enriched = await enrichRecordsWithSharedDimensions(
      [{ ...tagInput, requestScene: '', problemType: '' }],
      llmSettings,
      () => {},
    )

    if (enriched?.[0]) {
      return {
        requestScene: enriched[0].requestScene,
        problemType: enriched[0].problemType,
      }
    }
    return null
  } catch {
    return null
  }
}

// ============================================================
// L2 重试策略
// ============================================================

/**
 * L2-R1: 路径兜底
 * 从请求节点提取旅程
 */
function retryL2PathFallback(text, input, taxonomy, taxonomyKey) {
  const segments = extractPathSegments(text)
  if (segments.length < 2) return null

  const pathJourney = matchJourneyFromPath(text, taxonomy.journeys, taxonomyKey, segments)
  if (!pathJourney || isUnrecognizedTag(pathJourney.journeyL1)) return null

  return {
    journeyL1: normalizeTagLabel(pathJourney.journeyL1, 'journeyL1'),
    journeyL2: normalizeTagLabel(pathJourney.journeyL2, 'journeyL2'),
  }
}

/**
 * L2-R2: 宽松匹配
 * useRequestNode=true，用全文本做旅程匹配
 */
function retryL2RelaxedMatch(text, input, taxonomy, taxonomyKey, requestScene, problemType) {
  const journeyAskText = input?.customerRequest || input?.painPoint || text
  const journey = matchJourneyByDescription(journeyAskText, taxonomy.journeys, taxonomyKey, {
    useRequestNode: true,
    problemType,
    requestScene,
  })

  if (isUnrecognizedTag(journey.journeyL1)) return null

  return {
    journeyL1: normalizeTagLabel(journey.journeyL1, 'journeyL1'),
    journeyL2: normalizeTagLabel(journey.journeyL2, 'journeyL2'),
  }
}

// ============================================================
// 主入口：闸门重试闭环
// ============================================================

/**
 * 执行闸门重试
 *
 * @param {Object} params
 * @param {string} params.level 'L0' | 'L1' | 'L2'
 * @param {Object} params.input 原始输入
 * @param {string} params.text 完整文本
 * @param {Object} params.taxonomy 分类法
 * @param {string} params.taxonomyKey 分类法键
 * @param {Object} params.dims 当前维度结果
 * @param {Object} params.gateResult 闸门失败结果
 * @param {Object|null} [params.settings] 设置（含 LLM 配置）
 * @returns {Promise<RetryResult>}
 */
export async function retryGate({
  level,
  input,
  text,
  taxonomy,
  taxonomyKey,
  dims,
  gateResult,
  settings = null,
}) {
  const issues = [...(gateResult.issues || [])]
  let currentDims = { ...dims }

  // === L0 重试 ===
  if (level === 'L0') {
    // R1: 扩大语料
    const r1 = retryL0ExpandCorpus(input, text, taxonomy, taxonomyKey)
    if (r1?.confidence && r1.confidence !== 'low') {
      const recheck = validateL0({ customerRequest: r1.customerRequest, confidence: r1.confidence, action: r1.intent?.action })
      if (recheck.pass) {
        return {
          pass: true,
          dims: { ...currentDims, customerRequest: r1.customerRequest, confidence: r1.confidence, intent: r1.intent },
          tagStatus: 'ok',
          tagIssues: issues,
          retryStrategy: 'L0-R1-expand-corpus',
        }
      }
    }

    // R2: 处理意见补入
    const r2 = retryL0HandlingSupplement(input, text, taxonomy, taxonomyKey)
    if (r2) {
      const recheck = validateL0({ customerRequest: r2.customerRequest, confidence: r2.confidence, action: r2.intent?.action })
      if (recheck.pass) {
        return {
          pass: true,
          dims: { ...currentDims, customerRequest: r2.customerRequest, confidence: r2.confidence, intent: r2.intent },
          tagStatus: 'ok',
          tagIssues: issues,
          retryStrategy: 'L0-R2-handling-supplement',
        }
      }
    }

    // R3: LLM 介入
    const r3 = await retryL0LLM(input, text, settings)
    if (r3) {
      const recheck = validateL0({ customerRequest: r3.customerRequest, confidence: r3.confidence, action: r3.intent?.action })
      if (recheck.pass) {
        return {
          pass: true,
          dims: { ...currentDims, customerRequest: r3.customerRequest, confidence: r3.confidence, intent: r3.intent },
          tagStatus: 'ok',
          tagIssues: issues,
          retryStrategy: 'L0-R3-llm',
        }
      }
    }

    // 仍不通过 → manual_review
    return {
      pass: false,
      dims: currentDims,
      tagStatus: 'manual_review',
      tagIssues: [...issues, 'L0 重试后仍不通过（R1扩语料+R2处理意见+R3 LLM）'],
      retryStrategy: 'exhausted',
    }
  }

  // === L1 重试 ===
  if (level === 'L1') {
    // R1: 回退旧分类器
    const r1 = retryL1FallbackClassifier(input, text, taxonomy, taxonomyKey)
    const r1Check = validateL1({
      requestScene: r1.requestScene,
      problemType: r1.problemType,
      confidence: undefined,
    })
    if (r1Check.pass) {
      return {
        pass: true,
        dims: { ...currentDims, requestScene: r1.requestScene, problemType: r1.problemType },
        tagStatus: 'ok',
        tagIssues: issues,
        retryStrategy: 'L1-R1-fallback-classifier',
      }
    }

    // R2: 路径兜底
    const r2 = retryL1PathFallback(text, taxonomy, taxonomyKey)
    if (r2) {
      const merged = {
        requestScene: r2.requestScene || currentDims.requestScene,
        problemType: r2.problemType || currentDims.problemType,
      }
      const r2Check = validateL1(merged)
      if (r2Check.pass) {
        return {
          pass: true,
          dims: { ...currentDims, ...merged },
          tagStatus: 'ok',
          tagIssues: issues,
          retryStrategy: 'L1-R2-path-fallback',
        }
      }
    }

    // R3: LLM 介入
    const r3 = await retryL1LLM(input, text, taxonomy, taxonomyKey, settings)
    if (r3) {
      const r3Check = validateL1(r3)
      if (r3Check.pass) {
        return {
          pass: true,
          dims: { ...currentDims, ...r3 },
          tagStatus: 'ok',
          tagIssues: issues,
          retryStrategy: 'L1-R3-llm',
        }
      }
    }

    // 仍不通过 → manual_review
    return {
      pass: false,
      dims: currentDims,
      tagStatus: 'manual_review',
      tagIssues: [...issues, 'L1 重试后仍不通过（R1旧分类器+R2路径+R3 LLM）'],
      retryStrategy: 'exhausted',
    }
  }

  // === L2 重试 ===
  if (level === 'L2') {
    // R1: 路径兜底
    const r1 = retryL2PathFallback(text, input, taxonomy, taxonomyKey)
    if (r1) {
      const r1Check = validateL2({
        journeyL1: r1.journeyL1,
        journeyL2: r1.journeyL2,
        requestScene: currentDims.requestScene,
      })
      if (r1Check.pass) {
        return {
          pass: true,
          dims: { ...currentDims, journeyL1: r1.journeyL1, journeyL2: r1.journeyL2 },
          tagStatus: 'ok',
          tagIssues: issues,
          retryStrategy: 'L2-R1-path-fallback',
        }
      }
    }

    // R2: 宽松匹配
    const r2 = retryL2RelaxedMatch(
      text, input, taxonomy, taxonomyKey,
      currentDims.requestScene, currentDims.problemType,
    )
    if (r2) {
      const r2Check = validateL2({
        journeyL1: r2.journeyL1,
        journeyL2: r2.journeyL2,
        requestScene: currentDims.requestScene,
      })
      if (r2Check.pass) {
        return {
          pass: true,
          dims: { ...currentDims, journeyL1: r2.journeyL1, journeyL2: r2.journeyL2 },
          tagStatus: 'ok',
          tagIssues: issues,
          retryStrategy: 'L2-R2-relaxed-match',
        }
      }
    }

    // L2 不做 LLM 介入（旅程 LLM 代价高且效果有限），直接 manual_review
    return {
      pass: false,
      dims: currentDims,
      tagStatus: 'manual_review',
      tagIssues: [...issues, 'L2 重试后仍不通过（R1路径+R2宽松匹配）'],
      retryStrategy: 'exhausted',
    }
  }

  // 未知层级
  return {
    pass: false,
    dims: currentDims,
    tagStatus: 'manual_review',
    tagIssues: [...issues, `未知闸门层级: ${level}`],
    retryStrategy: 'none',
  }
}
