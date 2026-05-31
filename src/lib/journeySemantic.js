import { getTaxonomy, getTaxonomyForRecord } from './productTaxonomy.js'
import { getProductByKey } from './taxonomyLoader.js'
import { matchJourneyByDescription } from './ticketTagging.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from './llmClient.js'
import { DEFAULT_THEME_MATCH_MODE } from './storage.js'
import { canUseSemanticMatch, usesLlmThemeMatch } from './themeSemantic.js'
import { captureJourneyCandidateIfNeeded } from './tagCandidates.js'
import { canonicalTaxonomyKey } from './taxonomyKeyAliases.js'
import { buildTaggingTextForRecord } from './taggingText.js'
import { evaluateJourneyGatingBatch } from './journeyMatchConfidence.js'

const DEFAULT_MODEL = 'gpt-4o-mini'
const UNKNOWN_L1 = '未识别环节'
const UNKNOWN_L2 = '未识别子环节'

/**
 * @param {import('./storage.js').AppSettings} settings
 */
function journeyMatchOpts(settings) {
  return { useRequestNode: settings?.useRequestNodeForJourney === true }
}

/**
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 */
function buildJourneyCatalog(journeys) {
  /** @type {{ journeyL1: string; journeyL2: string; l1Description: string; l2Description: string; keywords: string }[]} */
  const list = []
  for (const l1 of journeys || []) {
    for (const l2 of l1.children || []) {
      list.push({
        journeyL1: l1.label,
        journeyL2: l2.label,
        l1Description: l1.description || '',
        l2Description: l2.description || '',
        keywords: (l2.keywords || []).join('、') || '无',
      })
    }
  }
  return list
}

/**
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 */
export function catalogHasJourneyOptions(journeys) {
  return buildJourneyCatalog(journeys).length > 0
}

/**
 * LLM 给出了库外的候选一级+二级旅程（待复核采纳）
 * @param {{ journeyL1?: string; journeyL2?: string }} llm
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 */
export function isLlmProposedJourney(llm, journeys) {
  if (!llm?.journeyL1 || llm.journeyL1 === UNKNOWN_L1) return false
  if (!llm?.journeyL2 || llm.journeyL2 === UNKNOWN_L2) return false
  return !isValidJourneyPair(llm.journeyL1, llm.journeyL2, journeys)
}

/**
 * @param {{ product?: string; productKey?: string }} record
 */
export function recordTaxonomyKey(record) {
  const pk = record?.productKey?.trim()
  if (pk) return canonicalTaxonomyKey(pk)
  return getTaxonomyForRecord(record).key
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 */
export function recordsNeedJourneyLlmProposal(records) {
  return records.some((r) => !catalogHasJourneyOptions(journeysForKey(recordTaxonomyKey(r))))
}

/**
 * @param {Object} params
 * @param {{ journeyL1: string; journeyL2: string; l1Description: string; l2Description: string; keywords: string }[]} params.catalog
 * @param {string} params.productName
 * @param {boolean} params.hasHints
 * @param {string[]} params.texts
 * @param {{ journeyL1: string; journeyL2: string }[]} [params.localHints]
 */
export function buildJourneyLlmPrompts({ catalog, productName, hasHints, texts, localHints }) {
  const hasCatalog = catalog.length > 0

  const systemPrompt = hasCatalog
    ? `你是移动云产品用户旅程分类助手。根据工单处理意见/客户问题，判断该反馈属于哪一段「一级旅程 > 二级旅程」。
只返回 JSON：{"results":[{"index":0,"journeyL1":"一级名称","journeyL2":"二级名称"},...]}
规则：
- 优先从下列旅程列表中选择 journeyL1、journeyL2
- 若列表中无合适项，可建议新的一级、二级名称（中文、简洁、贴合工单语义），系统将收录为待复核标签
- 结合一级/二级的「解释」理解语义，不要只做字面关键词匹配
- 以处理意见、客户问题、工单标题等正文为准；勿依赖「请求节点」字段（该字段常填写不准）
- 仅当正文完全无法判断用户旅程阶段时，journeyL1 为「${UNKNOWN_L1}」，journeyL2 为「${UNKNOWN_L2}」
${hasHints ? '- 若提供「本地初判」，可采纳、补充或修正；以语义与工单证据为准' : ''}`
    : `你是移动云产品用户旅程分类助手。当前产品尚未配置用户旅程标签库（列表为空）。
请根据工单处理意见/客户问题，为该反馈建议最合适的一级、二级用户旅程名称。
只返回 JSON：{"results":[{"index":0,"journeyL1":"一级名称","journeyL2":"二级名称"},...]}
规则：
- journeyL1、journeyL2 为建议新增的标签名称（中文、简洁），将进入「待复核标签」供管理员采纳
- 名称应体现用户在该产品上的真实使用阶段，勿套用其他产品
- 以处理意见、客户问题、工单标题等正文为准
- 仅当正文完全无法判断旅程阶段时，journeyL1 为「${UNKNOWN_L1}」，journeyL2 为「${UNKNOWN_L2}」
${hasHints ? '- 若提供「本地初判」且非「未识别」，可参考其语义' : ''}`

  const catalogBlock = hasCatalog
    ? `旅程列表（一级 > 二级 · 含解释）：
${catalog
  .map(
    (c, i) =>
      `${i + 1}. ${c.journeyL1} > ${c.journeyL2}\n   一级说明：${c.l1Description}\n   二级说明：${c.l2Description}\n   参考词：${c.keywords}`,
  )
  .join('\n')}

允许的组合示例：${catalog.map((c) => `${c.journeyL1} > ${c.journeyL2}`).slice(0, 8).join('；')}${catalog.length > 8 ? '…' : ''}`
    : '旅程列表：（当前为空，请根据工单正文建议新的一级、二级旅程名称）'

  const userPrompt = `当前产品：${productName || '通用产品'}（以下旅程仅适用于该产品，勿套用其他产品环节）

${catalogBlock}

待分类工单：
${texts
  .map((t, i) => {
    const hint = localHints?.[i]
    const hintLine =
      hint && hint.journeyL1 !== UNKNOWN_L1
        ? `\n   本地初判（解释+关键词）：${hint.journeyL1} > ${hint.journeyL2}`
        : ''
    return `[${i}] ${t.slice(0, 900)}${hintLine}`
  })
  .join('\n\n')}`

  return { systemPrompt, userPrompt }
}

/**
 * @param {string} l1
 * @param {string} l2
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 */
export function isValidJourneyPair(l1, l2, journeys) {
  const node = journeys.find((j) => j.label === l1)
  if (!node) return false
  if (l2 === UNKNOWN_L2) return true
  return node.children.some((c) => c.label === l2)
}

/**
 * @param {{ journeyL1: string; journeyL2: string }} local
 * @param {{ journeyL1: string; journeyL2: string }} llm
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 */
export function mergeJourneyResult(local, llm, journeys) {
  if (isLlmProposedJourney(llm, journeys)) return llm

  const emptyCatalog = !catalogHasJourneyOptions(journeys)
  if (emptyCatalog && llm.journeyL1 && llm.journeyL1 !== UNKNOWN_L1) return llm

  const llmValid = isValidJourneyPair(llm.journeyL1, llm.journeyL2, journeys)
  if (!llmValid || llm.journeyL1 === UNKNOWN_L1) return local

  if (local.journeyL1 === UNKNOWN_L1) return llm

  if (local.journeyL1 === llm.journeyL1) {
    if (local.journeyL2 === UNKNOWN_L2 && llm.journeyL2 !== UNKNOWN_L2) return llm
    if (llm.journeyL2 !== UNKNOWN_L2) return llm
    return local
  }

  return llm
}

/**
 * @param {string} text
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {import('./storage.js').AppSettings} settings
 */
export async function matchJourneyForSettings(text, product, settings, productKey) {
  const tax = getTaxonomy(product)
  const key = productKey || tax.key
  const journeys = tax.journeys
  const mode = settings.themeMatchMode || DEFAULT_THEME_MATCH_MODE

  if (mode === 'hybrid') {
    return matchJourneyHybrid(text, journeys, settings, key)
  }

  if (mode === 'semantic' && canUseSemanticMatch(settings)) {
    return matchJourneySemantic(text, journeys, settings, key)
  }

  return matchJourneyByDescription(text, journeys, key, journeyMatchOpts(settings))
}

/**
 * @param {string} text
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {import('./storage.js').AppSettings} settings
 */
/**
 * @param {string} taxonomyKey
 */
export function journeysForKey(taxonomyKey) {
  const key = (taxonomyKey || 'generic').trim()
  return getProductByKey(key).journeys || []
}

export async function matchJourneyHybrid(text, journeys, settings, taxonomyKey = 'generic') {
  const local = matchJourneyByDescription(text, journeys, taxonomyKey, journeyMatchOpts(settings))
  if (!canUseSemanticMatch(settings)) return local

  const taxName = getProductByKey(taxonomyKey)?.name || '通用产品'

  try {
    const [llm] = await callLlmJourneyBatch([text], journeys, settings, [local], taxName, taxonomyKey)
    return mergeJourneyResult(local, llm, journeys)
  } catch (err) {
    console.warn('旅程混合匹配 LLM 失败，仅使用本地:', err)
    return local
  }
}

/**
 * @param {string} text
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {import('./storage.js').AppSettings} settings
 */
export async function matchJourneySemantic(text, journeys, settings, taxonomyKey = 'generic') {
  if (!canUseSemanticMatch(settings)) {
    return matchJourneyByDescription(text, journeys, taxonomyKey, journeyMatchOpts(settings))
  }
  const taxName = getProductByKey(taxonomyKey)?.name || '通用产品'
  try {
    const [llm] = await callLlmJourneyBatch([text], journeys, settings, undefined, taxName, taxonomyKey)
    if (
      isValidJourneyPair(llm.journeyL1, llm.journeyL2, journeys) ||
      isLlmProposedJourney(llm, journeys)
    ) {
      return llm
    }
    return matchJourneyByDescription(text, journeys, taxonomyKey, journeyMatchOpts(settings))
  } catch (err) {
    console.warn('旅程语义匹配失败，回退本地:', err)
    return matchJourneyByDescription(text, journeys, taxonomyKey, journeyMatchOpts(settings))
  }
}

/**
 * @param {string[]} texts
 * @param {string[]} taxonomyKeys 产品模板 key（eip / generic …）
 * @param {import('./storage.js').AppSettings} settings
 * @param {(done: number, total: number) => void} [onProgress]
 */
export async function matchJourneyHybridBatch(texts, taxonomyKeys, settings, onProgress, records) {
  const localResults = texts.map((text, i) => {
    const key = taxonomyKeys[i] || 'generic'
    return matchJourneyByDescription(text, journeysForKey(key), key, journeyMatchOpts(settings))
  })

  if (!canUseSemanticMatch(settings)) return localResults

  const BATCH = 8
  /** @type {{ journeyL1: string; journeyL2: string }[]} */
  const results = []

  for (let i = 0; i < texts.length; i += BATCH) {
    const chunkTexts = texts.slice(i, i + BATCH)
    const chunkKeys = taxonomyKeys.slice(i, i + BATCH)
    const localChunk = localResults.slice(i, i + BATCH)
    const batchRecords = records ? records.slice(i, i + BATCH) : undefined
    const decisions = evaluateJourneyGatingBatch(
      chunkTexts,
      chunkKeys,
      settings,
      localChunk,
      batchRecords,
    )

    /** @type {Map<string, { texts: string[]; locals: { journeyL1: string; journeyL2: string }[]; idx: number[] }>} */
    const groups = new Map()

    const merged = new Array(chunkTexts.length)
    chunkTexts.forEach((text, j) => {
      const decision = decisions[j]
      if (decision.skipLlm) {
        merged[j] = {
          journeyL1: localChunk[j].journeyL1,
          journeyL2: localChunk[j].journeyL2,
          journeySource: /** @type {'rule'} */ ('rule'),
          journeyMatchScore: decision.score,
        }
        return
      }
      const key = chunkKeys[j] || 'generic'
      if (!groups.has(key)) groups.set(key, { texts: [], locals: [], idx: [] })
      const g = groups.get(key)
      g.texts.push(text)
      g.locals.push(localChunk[j])
      g.idx.push(j)
    })

    for (const [key, group] of groups) {
      const journeys = journeysForKey(key)
      const taxName = getProductByKey(key)?.name || '通用产品'
      try {
        const llmBatch = await callLlmJourneyBatch(
          group.texts,
          journeys,
          settings,
          group.locals,
          taxName,
          key,
        )
        group.idx.forEach((j, k) => {
          const llm = llmBatch[k]
          const rec = records?.[i + j]
          captureJourneyCandidateIfNeeded({
            llm,
            local: group.locals[k],
            journeys,
            taxonomyKey: key,
            recordId: rec?.id,
            sourceText: group.texts[k],
            insightPeriodId: rec?.insightPeriodId,
            dataSourceType: rec?.dataSourceType,
          })
          merged[j] = {
            ...mergeJourneyResult(group.locals[k], llm, journeys),
            journeySource: /** @type {'llm'} */ ('llm'),
            journeyMatchScore: decisions[j].score,
          }
        })
      } catch (err) {
        console.warn('旅程混合批量 LLM 失败，该批仅用本地:', err)
        group.idx.forEach((j, k) => {
          merged[j] = {
            ...group.locals[k],
            journeySource: /** @type {'rule'} */ ('rule'),
            journeyMatchScore: decisions[j].score,
          }
        })
      }
    }
    results.push(...merged)
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length)
  }

  return results
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {import('./storage.js').AppSettings} settings
 * @param {(done: number, total: number) => void} [onProgress]
 */
const UNKNOWN_JOURNEY_RE =
  /^(未识别环节|未识别子环节|未分类|)$/

export function recordHasUnknownJourney(record) {
  const l1 = (record?.journeyL1 || '').trim()
  return !l1 || UNKNOWN_JOURNEY_RE.test(l1)
}

export async function enrichRecordsWithJourneys(records, settings, onProgress) {
  const mode = settings.themeMatchMode || DEFAULT_THEME_MATCH_MODE
  const canLlm = canUseSemanticMatch(settings)
  const needsProposal = recordsNeedJourneyLlmProposal(records)
  const hasUnknown = records.some(recordHasUnknownJourney)
  const useLlmJourney =
    canLlm && (usesLlmThemeMatch(mode) || needsProposal || hasUnknown)
  if (!useLlmJourney) {
    return records
  }

  const texts = records.map((r) => buildTaggingTextForRecord(r))
  const taxonomyKeys = records.map((r) => recordTaxonomyKey(r))

  const useHybrid = mode === 'hybrid' || needsProposal || hasUnknown
  const journeyResults = useHybrid
    ? await matchJourneyHybridBatch(texts, taxonomyKeys, settings, onProgress, records)
    : await matchJourneySemanticBatch(texts, taxonomyKeys, settings, onProgress, records)

  return records.map((r, i) => ({
    ...r,
    productKey: r.productKey || taxonomyKeys[i],
    journeyL1: journeyResults[i]?.journeyL1 || r.journeyL1,
    journeyL2: journeyResults[i]?.journeyL2 || r.journeyL2,
    ...(journeyResults[i]?.journeySource
      ? { journeySource: journeyResults[i].journeySource }
      : {}),
    ...(journeyResults[i]?.journeyMatchScore != null
      ? { journeyMatchScore: journeyResults[i].journeyMatchScore }
      : {}),
  }))
}

/**
 * @param {string[]} texts
 * @param {string[]} products
 * @param {import('./storage.js').AppSettings} settings
 * @param {(done: number, total: number) => void} [onProgress]
 */
async function matchJourneySemanticBatch(texts, taxonomyKeys, settings, onProgress, records) {
  const BATCH = 8
  const results = []

  for (let i = 0; i < texts.length; i += BATCH) {
    const chunkTexts = texts.slice(i, i + BATCH)
    const chunkKeys = taxonomyKeys.slice(i, i + BATCH)

    /** @type {Map<string, { texts: string[]; idx: number[] }>} */
    const groups = new Map()
    chunkTexts.forEach((text, j) => {
      const key = chunkKeys[j] || 'generic'
      if (!groups.has(key)) groups.set(key, { texts: [], idx: [] })
      const g = groups.get(key)
      g.texts.push(text)
      g.idx.push(j)
    })

    const merged = new Array(chunkTexts.length)
    for (const [key, group] of groups) {
      const journeys = journeysForKey(key)
      const taxName = getProductByKey(key)?.name || '通用产品'
      try {
        const llmBatch = await callLlmJourneyBatch(
          group.texts,
          journeys,
          settings,
          undefined,
          taxName,
          key,
        )
        group.idx.forEach((j, k) => {
          const llm = llmBatch[k]
          const rec = records?.[i + j]
          captureJourneyCandidateIfNeeded({
            llm,
            journeys,
            taxonomyKey: key,
            recordId: rec?.id,
            sourceText: group.texts[k],
            insightPeriodId: rec?.insightPeriodId,
            dataSourceType: rec?.dataSourceType,
          })
          merged[j] =
            isValidJourneyPair(llm.journeyL1, llm.journeyL2, journeys) ||
            isLlmProposedJourney(llm, journeys)
              ? llm
              : matchJourneyByDescription(
                  group.texts[k],
                  journeys,
                  key,
                  journeyMatchOpts(settings),
                )
        })
      } catch (err) {
        console.warn('旅程语义批量失败，该批回退本地:', err)
        group.idx.forEach((j, k) => {
          merged[j] = matchJourneyByDescription(group.texts[k], journeys, key, journeyMatchOpts(settings))
        })
      }
    }
    results.push(...merged)
    onProgress?.(Math.min(i + BATCH, texts.length), texts.length)
  }

  return results
}

/**
 * @param {string[]} texts
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 * @param {import('./storage.js').AppSettings} settings
 * @param {{ journeyL1: string; journeyL2: string }[]} [localHints]
 * @param {string} [productName] 当前产品名，约束 LLM 仅选该产品旅程
 * @param {string} [taxonomyKey]
 */
/**
 * @param {Array<{ index?: number; journeyL1?: string; journeyL2?: string }>} items
 * @param {number} i 0-based batch index
 */
function resolveLlmJourneyResultItem(items, i) {
  if (!Array.isArray(items) || !items.length) return undefined
  const byIndex = items.find((r) => {
    const idx = Number(r?.index)
    return Number.isFinite(idx) && (idx === i || idx === i + 1)
  })
  return byIndex || items[i]
}

async function callLlmJourneyBatch(texts, journeys, settings, localHints, productName, taxonomyKey = 'generic') {
  const catalog = buildJourneyCatalog(journeys)
  const hasHints = localHints?.some(
    (h) => h?.journeyL1 && h.journeyL1 !== UNKNOWN_L1,
  )
  const { systemPrompt, userPrompt } = buildJourneyLlmPrompts({
    catalog,
    productName,
    hasHints,
    texts,
    localHints,
  })

  const data = await llmChatCompletion(settings, {
    model: settings.llmModel || DEFAULT_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const items = parsed.results || parsed.items || []

  return texts.map((text, i) => {
    const item = resolveLlmJourneyResultItem(items, i)
    const l1 = item?.journeyL1 || UNKNOWN_L1
    const l2 = item?.journeyL2 || UNKNOWN_L2
    const llm = { journeyL1: l1, journeyL2: l2 }
    captureJourneyCandidateIfNeeded({
      llm,
      journeys,
      taxonomyKey,
      sourceText: text,
    })
    const llmResult = { journeyL1: l1, journeyL2: l2 }
    if (
      isValidJourneyPair(l1, l2, journeys) ||
      isLlmProposedJourney(llmResult, journeys)
    ) {
      return llmResult
    }
    return matchJourneyByDescription(text, journeys, taxonomyKey, journeyMatchOpts(settings))
  })
}
