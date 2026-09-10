import { resolveProblemTypeWithPeerFallback, resolveRequestSceneFromConfig } from '../dimensionTagging.js'
import { PROBLEM_TYPE_OTHER } from '../problemTypeClassifier.js'
import {
  isEmptyJourneyAsk,
  matchJourneyByDescription,
  stripJourneyTaggingNoise,
} from '../ticketTagging.js'
import { finalizeCorpusFuzzy } from './ticketAnalysisCorpus.js'
import {
  buildDimensionTaggingLayers,
  buildDimensionTaggingText,
} from './dimensionTaggingText.js'
import {
  isUnrecognizedTag,
  normalizeTagLabel,
  TAG_UNRECOGNIZED,
} from './tagLabels.js'
import { REQUEST_SCENE_DEFAULT } from '../requestSceneClassifier.js'
import {
  matchJourneyFromPath,
  matchProblemTypeFromPath,
  matchRequestSceneFromPath,
} from './pathTagging.js'
import { applyCorrectionOverlay } from '../learning/tagCorrectionRules.js'
import { extractIntent, intentToRequestScene, intentToProblemType } from './intentExtractor.js'
import { validateL0, validateL1, validateL2 } from './dimensionValidation.js'
import { retryGate } from './gateRetry.js'

/**
 * 「其他」为有效分类结果；仅决策树未命中（或无法识别）时启用路径兜底
 * @param {string | undefined | null} label
 */
function isProblemTypeClassifierMiss(label) {
  const t = label?.trim()
  if (!t || isUnrecognizedTag(t)) return true
  return t === PROBLEM_TYPE_OTHER
}

/**
 * @param {Object} [input]
 * @param {string} text
 * @param {{ label: string }[]} problemTypeRules
 */
function resolveProblemTypeForTicket(input, text, problemTypeRules) {
  const corpus = input ? buildDimensionTaggingText(input) : text
  const fullPeer = input ? buildDimensionTaggingLayers(input).fullText || text : text
  return normalizeTagLabel(
    resolveProblemTypeWithPeerFallback(corpus, fullPeer, problemTypeRules),
    'dimension',
  )
}

/**
 * @param {string} text
 * @param {{ label: string; description?: string; keywords?: string[] }[]} requestSceneRules
 */
function resolveRequestSceneForTicket(text, requestSceneRules) {
  return normalizeTagLabel(resolveRequestSceneFromConfig(text, requestSceneRules), 'dimension')
}

/**
 * @param {string} text
 * @param {import('../productTaxonomy.js').ProductTaxonomy} taxonomy
 * @param {string} taxonomyKey
 * @param {{ problemType?: string }} [opts]
 */
function matchSceneAndJourneyFromText(text, taxonomy, taxonomyKey, opts = {}) {
  return {
    requestScene: resolveRequestSceneForTicket(text, taxonomy.requestScenes),
    journey: matchJourneyByDescription(text, taxonomy.journeys, taxonomyKey, {
      useRequestNode: false,
      problemType: opts.problemType,
      requestScene: opts.requestScene,
    }),
  }
}

/**
 * 旅程只吃客户请求/痛点；空模板不回退处理意见。
 * @param {Object} [input]
 * @param {string} [fallbackText]
 */
function resolveJourneyAskText(input, fallbackText) {
  const request = stripJourneyTaggingNoise(input?.customerRequest || '')
  if (request && !isEmptyJourneyAsk(request)) return request
  const pain = stripJourneyTaggingNoise(input?.painPoint || input?.problemSummary || '')
  if (pain && !isEmptyJourneyAsk(pain)) return pain
  if (input?.customerRequest != null || input?.painPoint != null) {
    if (isEmptyJourneyAsk(request) || !request) return ''
  }
  const fallback = stripJourneyTaggingNoise(fallbackText || '')
  return isEmptyJourneyAsk(fallback) ? '' : fallback
}

/**
 * 核心打标逻辑（不含闸门验证与重试），被同步和异步两条路径共用
 */
function tagCore({ text, input, taxonomy, taxonomyKey, settings }) {
  const pathSegments =
    (text.match(/(?:请求节点|系统路径)[：:]([^\n]+)/i) || [])[1]
      ?.split('--')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'undefined') || []

  const layers = input ? buildDimensionTaggingLayers(input) : null
  const requestCorpus = input ? buildDimensionTaggingText(input) : ''
  const hasExtractedRequest = Boolean(
    input?.customerRequest?.trim() || input?.painPoint?.trim() || input?.problemSummary?.trim(),
  )
  const primaryText = hasExtractedRequest
    ? requestCorpus
    : layers?.primaryText || text
  const secondaryText = hasExtractedRequest
    ? layers?.primaryText && layers.primaryText !== primaryText
      ? layers.primaryText
      : layers?.secondaryText || ''
    : layers?.secondaryText || ''
  const taggingCorpus = requestCorpus || layers?.fullText || text
  const journeyAskText = resolveJourneyAskText(input, hasExtractedRequest ? requestCorpus : primaryText)
  const emptyJourneyAsk = !journeyAskText

  const primary = matchSceneAndJourneyFromText(primaryText, taxonomy, taxonomyKey)
  let requestScene = normalizeTagLabel(primary.requestScene, 'dimension')
  let problemType = resolveProblemTypeForTicket(input, text, taxonomy.problemTypes)

  // 共享意图提取
  let intentConfidence = 'low'
  let intent = null
  if (hasExtractedRequest) {
    const crText = input?.customerRequest?.trim() || ''
    if (crText) {
      intent = extractIntent(crText)
      intentConfidence = intent.confidence
      if (intent.confidence === 'high') {
        requestScene = intentToRequestScene(intent.action)
        problemType = intentToProblemType(intent.domain)
      }
    }
  }

  // Journey 匹配
  let journeyL1 = TAG_UNRECOGNIZED
  let journeyL2 = TAG_UNRECOGNIZED
  if (!emptyJourneyAsk) {
    const fromAsk = matchJourneyByDescription(journeyAskText, taxonomy.journeys, taxonomyKey, {
      useRequestNode: false,
      problemType,
      requestScene,
    })
    journeyL1 = normalizeTagLabel(fromAsk.journeyL1, 'journeyL1')
    journeyL2 = normalizeTagLabel(fromAsk.journeyL2, 'journeyL2')
  }

  if (!emptyJourneyAsk && problemType === '配额与权限申请') {
    const quotaJourney = matchJourneyByDescription(journeyAskText, taxonomy.journeys, taxonomyKey, {
      useRequestNode: false,
      problemType,
      requestScene,
    })
    if (!isUnrecognizedTag(quotaJourney.journeyL1)) {
      journeyL1 = normalizeTagLabel(quotaJourney.journeyL1, 'journeyL1')
      journeyL2 = normalizeTagLabel(quotaJourney.journeyL2, 'journeyL2')
    }
  }

  // secondaryText 补充
  if (secondaryText) {
    const secondary = matchSceneAndJourneyFromText(secondaryText, taxonomy, taxonomyKey)
    if ((isUnrecognizedTag(requestScene) || requestScene === REQUEST_SCENE_DEFAULT) &&
      !isUnrecognizedTag(secondary.requestScene) &&
      secondary.requestScene !== REQUEST_SCENE_DEFAULT
    ) {
      requestScene = normalizeTagLabel(secondary.requestScene, 'dimension')
    }
    if (isProblemTypeClassifierMiss(problemType)) {
      const fromHandling = normalizeTagLabel(
        resolveProblemTypeWithPeerFallback(
          secondaryText,
          layers?.fullText || text,
          taxonomy.problemTypes,
        ),
        'dimension',
      )
      if (!isProblemTypeClassifierMiss(fromHandling)) {
        problemType = fromHandling
      }
    }
  }

  const corpus = finalizeCorpusFuzzy(
    { taggingText: taggingCorpus, pathSegments, fuzzy: false },
    {
      requestScene,
      problemType,
      journeyL1,
    },
  )

  const usePath =
    settings?.useRequestNodeForJourney !== false &&
    (corpus.fuzzy ||
      isUnrecognizedTag(requestScene) ||
      isProblemTypeClassifierMiss(problemType) ||
      isUnrecognizedTag(journeyL1))

  if (usePath && pathSegments.length >= 2) {
    const pathScene = matchRequestSceneFromPath(pathSegments, taxonomyKey, taxonomy.requestScenes)
    const pathProblem = matchProblemTypeFromPath(pathSegments, taxonomyKey, taxonomy.problemTypes)
    const pathJourney = matchJourneyFromPath(text, taxonomy.journeys, taxonomyKey, pathSegments)

    if (isUnrecognizedTag(requestScene) && pathScene) {
      requestScene = normalizeTagLabel(pathScene, 'dimension')
    }
    if (isProblemTypeClassifierMiss(problemType) && pathProblem) {
      problemType = normalizeTagLabel(pathProblem, 'dimension')
    }
    if (!emptyJourneyAsk && !corpus.fuzzy && isUnrecognizedTag(journeyL1) && pathJourney) {
      journeyL1 = normalizeTagLabel(pathJourney.journeyL1, 'journeyL1')
      journeyL2 = normalizeTagLabel(pathJourney.journeyL2, 'journeyL2')
    }
  }

  if (corpus.fuzzy || emptyJourneyAsk) {
    journeyL1 = TAG_UNRECOGNIZED
    journeyL2 = TAG_UNRECOGNIZED
  } else if (settings?.useRequestNodeForJourney === true && isUnrecognizedTag(journeyL1)) {
    const nodeJourney = matchJourneyByDescription(text, taxonomy.journeys, taxonomyKey, {
      useRequestNode: true,
    })
    if (!isUnrecognizedTag(nodeJourney.journeyL1)) {
      journeyL1 = normalizeTagLabel(nodeJourney.journeyL1, 'journeyL1')
      journeyL2 = normalizeTagLabel(nodeJourney.journeyL2, 'journeyL2')
    }
  }

  return {
    dims: { requestScene, problemType, journeyL1, journeyL2 },
    meta: {
      pathSegments,
      taggingCorpus,
      intentConfidence,
      intent,
      hasExtractedRequest,
      journeyAskText,
      emptyJourneyAsk,
      corpus,
    },
  }
}

/**
 * 内容语义优先：先客户侧语料，再处理意见；路径仅在模糊或未识别时兜底
 *
 * 同步版：执行规则打标 + 快速闸门检查（无 LLM 重试）。
 * L0/L1/L2 失败时标记但不触发重试——异步版才有完整重试闭环。
 *
 * @param {Object} opts
 * @param {string} opts.text
 * @param {Object} [opts.input] 原始字段，用于分段打标
 * @param {import('../productTaxonomy.js').ProductTaxonomy} opts.taxonomy
 * @param {string} opts.taxonomyKey
 * @param {{ useRequestNodeForJourney?: boolean }} [opts.settings]
 */
export function tagTicketDimensions(opts) {
  const { text, input, taxonomy, taxonomyKey, settings = {} } = opts
  const { dims, meta } = tagCore({ text, input, taxonomy, taxonomyKey, settings })

  // === L0 闸门（快速版：不重试，只标记）===
  const l0Result = validateL0({
    customerRequest: input?.customerRequest,
    confidence: meta.intentConfidence,
    action: meta.intent?.action,
  })

  // === L1 闸门 ===
  const l1Result = validateL1({
    requestScene: dims.requestScene,
    problemType: dims.problemType,
    confidence: meta.intentConfidence,
  })

  // 同步版：闸门只标记 tagStatus，不清空 journey 值
  // journey 的清空只在异步版（含重试闭环）中发生
  let journeyL1 = dims.journeyL1
  let journeyL2 = dims.journeyL2

  // === L2 闸门 ===
  let l2Result = null
  if (l1Result.grade !== 'conflict') {
    l2Result = validateL2({
      journeyL1,
      journeyL2,
      requestScene: dims.requestScene,
    })
  }

  // 合并 tagStatus
  const tagIssues = []
  if (!l0Result.pass) tagIssues.push(...l0Result.issues)
  if (!l1Result.pass) tagIssues.push(...l1Result.issues)
  if (l2Result && !l2Result.pass) tagIssues.push(...l2Result.issues)

  const tagStatus =
    !l0Result.pass || !l1Result.pass || (l2Result && !l2Result.pass)
      ? 'manual_review'
      : 'ok'

  const finalDims = { ...dims, journeyL1, journeyL2 }
  if (settings.skipCorrectionOverlay) {
    return { ...finalDims, tagStatus, tagIssues }
  }

  const overlaid = applyCorrectionOverlay(finalDims, meta.taggingCorpus || text, {
    productKey: taxonomyKey,
  })
  return {
    requestScene: overlaid.requestScene,
    problemType: overlaid.problemType,
    journeyL1: overlaid.journeyL1,
    journeyL2: overlaid.journeyL2,
    overlayHits: overlaid.overlayHits,
    tagStatus,
    tagIssues,
  }
}

/**
 * 异步版：执行规则打标 + 完整闸门验证 + 重试闭环（含 LLM 介入）。
 *
 * 这是用户要求的完整闭环：
 *   L0 验证 → FAIL → 重试（扩语料→处理意见→LLM）→ 再验证 → 仍失败 manual_review
 *   L1 验证 → FAIL → 重试（旧分类器→路径→LLM）→ 再验证 → 仍失败 manual_review
 *   L2 验证 → FAIL → 重试（路径→宽松匹配）→ 再验证 → 仍失败 manual_review
 *
 * @param {Object} opts
 * @param {string} opts.text
 * @param {Object} [opts.input]
 * @param {import('../productTaxonomy.js').ProductTaxonomy} opts.taxonomy
 * @param {string} opts.taxonomyKey
 * @param {{ useRequestNodeForJourney?: boolean }} [opts.settings] 应用设置（含 LLM 配置）
 */
export async function tagTicketDimensionsAsync(opts) {
  const { text, input, taxonomy, taxonomyKey, settings = {} } = opts
  const { dims: initialDims, meta } = tagCore({ text, input, taxonomy, taxonomyKey, settings })

  let customerRequest = input?.customerRequest || ''
  let intentConfidence = meta.intentConfidence
  let intent = meta.intent
  let requestScene = initialDims.requestScene
  let problemType = initialDims.problemType
  let journeyL1 = initialDims.journeyL1
  let journeyL2 = initialDims.journeyL2

  const tagIssues = []

  // === L0 闸门 + 重试 ===
  const l0Result = validateL0({ customerRequest, confidence: intentConfidence, action: intent?.action })
  if (!l0Result.pass) {
    tagIssues.push(...l0Result.issues)
    const retry = await retryGate({
      level: 'L0',
      input,
      text,
      taxonomy,
      taxonomyKey,
      dims: { customerRequest, confidence: intentConfidence, intent },
      gateResult: l0Result,
      settings,
    })
    if (retry.pass) {
      customerRequest = retry.dims.customerRequest || customerRequest
      intentConfidence = retry.dims.confidence || intentConfidence
      intent = retry.dims.intent || intent
      // L0 修复后，如果 intent 变了，重算 scene/type
      if (intent && intent.confidence === 'high') {
        requestScene = intentToRequestScene(intent.action)
        problemType = intentToProblemType(intent.domain)
      }
    } else {
      tagIssues.push(...retry.tagIssues)
      // L0 失败 → 直接 manual_review，不再走 L1/L2
      const finalDims = { requestScene, problemType, journeyL1, journeyL2 }
      if (settings.skipCorrectionOverlay) {
        return { ...finalDims, tagStatus: 'manual_review', tagIssues }
      }
      const overlaid = applyCorrectionOverlay(finalDims, meta.taggingCorpus || text, { productKey: taxonomyKey })
      return {
        requestScene: overlaid.requestScene,
        problemType: overlaid.problemType,
        journeyL1: overlaid.journeyL1,
        journeyL2: overlaid.journeyL2,
        overlayHits: overlaid.overlayHits,
        tagStatus: 'manual_review',
        tagIssues,
      }
    }
  }

  // === L1 闸门 + 重试 ===
  const l1Result = validateL1({ requestScene, problemType, confidence: intentConfidence })
  if (!l1Result.pass) {
    tagIssues.push(...l1Result.issues)
    const retry = await retryGate({
      level: 'L1',
      input,
      text,
      taxonomy,
      taxonomyKey,
      dims: { requestScene, problemType, journeyL1, journeyL2 },
      gateResult: l1Result,
      settings,
    })
    if (retry.pass) {
      requestScene = retry.dims.requestScene || requestScene
      problemType = retry.dims.problemType || problemType
    } else {
      tagIssues.push(...retry.tagIssues)
      // L1 失败 → manual_review，journey 不可信
      journeyL1 = TAG_UNRECOGNIZED
      journeyL2 = TAG_UNRECOGNIZED
      const finalDims = { requestScene, problemType, journeyL1, journeyL2 }
      if (settings.skipCorrectionOverlay) {
        return { ...finalDims, tagStatus: 'manual_review', tagIssues }
      }
      const overlaid = applyCorrectionOverlay(finalDims, meta.taggingCorpus || text, { productKey: taxonomyKey })
      return {
        requestScene: overlaid.requestScene,
        problemType: overlaid.problemType,
        journeyL1: overlaid.journeyL1,
        journeyL2: overlaid.journeyL2,
        overlayHits: overlaid.overlayHits,
        tagStatus: 'manual_review',
        tagIssues,
      }
    }
  }

  // L1 conflict 已通过（或重试通过），重做 journey 匹配
  if (l1Result.grade === 'conflict' || !isUnrecognizedTag(journeyL1) === false) {
    // 如果 L1 修复改了 scene/type，重做 journey
    const journeyAskText = resolveJourneyAskText(input, meta.taggingCorpus || text)
    if (journeyAskText && !meta.emptyJourneyAsk) {
      const fromAsk = matchJourneyByDescription(journeyAskText, taxonomy.journeys, taxonomyKey, {
        useRequestNode: false,
        problemType,
        requestScene,
      })
      journeyL1 = normalizeTagLabel(fromAsk.journeyL1, 'journeyL1')
      journeyL2 = normalizeTagLabel(fromAsk.journeyL2, 'journeyL2')
    }
  }

  // === L2 闸门 + 重试 ===
  const l2Result = validateL2({ journeyL1, journeyL2, requestScene })
  if (!l2Result.pass) {
    tagIssues.push(...l2Result.issues)
    if (l2Result.grade === 'mismatch') {
      journeyL1 = TAG_UNRECOGNIZED
      journeyL2 = TAG_UNRECOGNIZED
    }
    const retry = await retryGate({
      level: 'L2',
      input,
      text,
      taxonomy,
      taxonomyKey,
      dims: { requestScene, problemType, journeyL1, journeyL2 },
      gateResult: l2Result,
      settings,
    })
    if (retry.pass) {
      journeyL1 = retry.dims.journeyL1 || journeyL1
      journeyL2 = retry.dims.journeyL2 || journeyL2
    } else {
      tagIssues.push(...retry.tagIssues)
    }
  }

  // 最终 tagStatus：如果任何重试策略穷尽（仍不通过），则 manual_review
  const hasExhausted = tagIssues.some(i => i.includes('重试后仍不通过'))
  const tagStatus = hasExhausted ? 'manual_review' : 'ok'

  const finalDims = { requestScene, problemType, journeyL1, journeyL2 }
  if (settings.skipCorrectionOverlay) {
    return { ...finalDims, tagStatus, tagIssues }
  }

  const overlaid = applyCorrectionOverlay(finalDims, meta.taggingCorpus || text, {
    productKey: taxonomyKey,
  })
  return {
    requestScene: overlaid.requestScene,
    problemType: overlaid.problemType,
    journeyL1: overlaid.journeyL1,
    journeyL2: overlaid.journeyL2,
    overlayHits: overlaid.overlayHits,
    tagStatus,
    tagIssues,
  }
}
