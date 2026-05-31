import { matchSharedLabel } from '../dimensionTagging.js'
import { classifyProblemType, PROBLEM_TYPE_OTHER } from '../problemTypeClassifier.js'
import { matchJourneyByDescription } from '../ticketTagging.js'
import { finalizeCorpusFuzzy } from './ticketAnalysisCorpus.js'
import { buildDimensionTaggingLayers, buildProblemTypeTaggingText } from './dimensionTaggingText.js'
import {
  isUnrecognizedTag,
  normalizeTagLabel,
  TAG_UNRECOGNIZED,
} from './tagLabels.js'
import {
  matchJourneyFromPath,
  matchProblemTypeFromPath,
  matchRequestSceneFromPath,
} from './pathTagging.js'

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
  const corpus = input ? buildProblemTypeTaggingText(input) : text
  return normalizeTagLabel(classifyProblemType(corpus, problemTypeRules), 'dimension')
}

/**
 * @param {string} text
 * @param {import('../productTaxonomy.js').ProductTaxonomy} taxonomy
 * @param {string} taxonomyKey
 */
function matchSceneAndJourneyFromText(text, taxonomy, taxonomyKey) {
  return {
    requestScene: matchSharedLabel(text, taxonomy.requestScenes),
    journey: matchJourneyByDescription(text, taxonomy.journeys, taxonomyKey, {
      useRequestNode: false,
    }),
  }
}

/**
 * 内容语义优先：先客户侧语料，再处理意见；路径仅在模糊或未识别时兜底
 * @param {Object} opts
 * @param {string} opts.text
 * @param {Object} [opts.input] 原始字段，用于分段打标
 * @param {import('../productTaxonomy.js').ProductTaxonomy} opts.taxonomy
 * @param {string} opts.taxonomyKey
 * @param {{ useRequestNodeForJourney?: boolean }} [opts.settings]
 */
export function tagTicketDimensions(opts) {
  const { text, input, taxonomy, taxonomyKey, settings = {} } = opts
  const pathSegments =
    (text.match(/(?:请求节点|系统路径)[：:]([^\n]+)/i) || [])[1]
      ?.split('--')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'undefined') || []

  const layers = input ? buildDimensionTaggingLayers(input) : null
  const primaryText = layers?.primaryText || text
  const secondaryText = layers?.secondaryText || ''
  const taggingCorpus = layers?.fullText || text

  const primary = matchSceneAndJourneyFromText(primaryText, taxonomy, taxonomyKey)
  let requestScene = normalizeTagLabel(primary.requestScene, 'dimension')
  let problemType = resolveProblemTypeForTicket(input, text, taxonomy.problemTypes)
  let journeyL1 = normalizeTagLabel(primary.journey.journeyL1, 'journeyL1')
  let journeyL2 = normalizeTagLabel(primary.journey.journeyL2, 'journeyL2')

  if (secondaryText) {
    const secondary = matchSceneAndJourneyFromText(secondaryText, taxonomy, taxonomyKey)
    if (isUnrecognizedTag(requestScene) && !isUnrecognizedTag(secondary.requestScene)) {
      requestScene = normalizeTagLabel(secondary.requestScene, 'dimension')
    }
    if (isProblemTypeClassifierMiss(problemType)) {
      const fromHandling = normalizeTagLabel(
        classifyProblemType(secondaryText, taxonomy.problemTypes),
        'dimension',
      )
      if (!isProblemTypeClassifierMiss(fromHandling)) {
        problemType = fromHandling
      }
    }
    if (isUnrecognizedTag(journeyL1) && !isUnrecognizedTag(secondary.journey.journeyL1)) {
      journeyL1 = normalizeTagLabel(secondary.journey.journeyL1, 'journeyL1')
      journeyL2 = normalizeTagLabel(secondary.journey.journeyL2, 'journeyL2')
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
    settings.useRequestNodeForJourney !== false &&
    (corpus.fuzzy ||
      isUnrecognizedTag(requestScene) ||
      isProblemTypeClassifierMiss(problemType) ||
      isUnrecognizedTag(journeyL1))

  if (usePath && pathSegments.length >= 2) {
    const pathScene = matchRequestSceneFromPath(
      pathSegments,
      taxonomyKey,
      taxonomy.requestScenes,
    )
    const pathProblem = matchProblemTypeFromPath(pathSegments, taxonomyKey, taxonomy.problemTypes)
    const pathJourney = matchJourneyFromPath(text, taxonomy.journeys, taxonomyKey, pathSegments)

    if (isUnrecognizedTag(requestScene) && pathScene) {
      requestScene = normalizeTagLabel(pathScene, 'dimension')
    }
    if (isProblemTypeClassifierMiss(problemType) && pathProblem) {
      problemType = normalizeTagLabel(pathProblem, 'dimension')
    }
    if (!corpus.fuzzy && isUnrecognizedTag(journeyL1) && pathJourney) {
      journeyL1 = normalizeTagLabel(pathJourney.journeyL1, 'journeyL1')
      journeyL2 = normalizeTagLabel(pathJourney.journeyL2, 'journeyL2')
    }
  }

  if (corpus.fuzzy) {
    journeyL1 = TAG_UNRECOGNIZED
    journeyL2 = TAG_UNRECOGNIZED
  } else if (settings.useRequestNodeForJourney === true && isUnrecognizedTag(journeyL1)) {
    const nodeJourney = matchJourneyByDescription(text, taxonomy.journeys, taxonomyKey, {
      useRequestNode: true,
    })
    if (!isUnrecognizedTag(nodeJourney.journeyL1)) {
      journeyL1 = normalizeTagLabel(nodeJourney.journeyL1, 'journeyL1')
      journeyL2 = normalizeTagLabel(nodeJourney.journeyL2, 'journeyL2')
    }
  }

  return {
    requestScene,
    problemType,
    journeyL1,
    journeyL2,
  }
}
