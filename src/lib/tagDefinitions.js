import { MANUAL_TAG_DIMENSION_LABELS } from './manualTagFields.js'
import { PROBLEM_TYPES_BUILTIN, REQUEST_SCENES_BUILTIN } from './sharedTagDefs.js'
import {
  normalizeSentiment,
  SENTIMENT_DESCRIPTIONS,
  SENTIMENT_LABELS,
} from './sentiment.js'

/** @typedef {'requestScene' | 'problemType' | 'journey' | 'sentiment'} TagDimension */

/** @typedef {{ label: string; description?: string; keywords?: string[] }} TagRule */

/**
 * @typedef {Object} TagDefinition
 * @property {string} title
 * @property {string} body
 * @property {'taxonomy' | 'builtin' | 'sentiment' | 'keywords' | 'none'} source
 */

const UNSET_BODY = '当前未打标；保存或重新打标后，将按配置展示对应释义。'

/**
 * @param {TagRule[] | undefined} list
 * @param {string} label
 */
function findInList(list, label) {
  return list?.find((t) => t.label === label)
}

/**
 * @param {string | undefined} description
 * @param {string[] | undefined} keywords
 */
function bodyFromRule(description, keywords) {
  if (description?.trim()) return description.trim()
  if (keywords?.length) {
    return `参考关键词：${keywords.slice(0, 8).join('、')}`
  }
  return '暂无释义'
}

/**
 * @param {string} dimLabel
 * @param {string} tagLabel
 * @param {TagRule | undefined} fromTaxonomy
 * @param {TagRule | undefined} fromBuiltin
 */
function mergeRuleDefinition(dimLabel, tagLabel, fromTaxonomy, fromBuiltin) {
  const rule = fromTaxonomy || fromBuiltin
  if (!rule) {
    return {
      title: `${dimLabel} · ${tagLabel}`,
      body: '暂无释义',
      source: /** @type {const} */ ('none'),
    }
  }
  const description = fromTaxonomy?.description?.trim() || fromBuiltin?.description?.trim()
  const keywords = fromTaxonomy?.keywords?.length
    ? fromTaxonomy.keywords
    : fromBuiltin?.keywords
  const source = fromTaxonomy?.description?.trim()
    ? 'taxonomy'
    : fromBuiltin?.description?.trim()
      ? 'builtin'
      : keywords?.length
        ? 'keywords'
        : 'none'
  return {
    title: `${dimLabel} · ${tagLabel}`,
    body: bodyFromRule(description, keywords),
    source,
  }
}

/**
 * 从 getTaxonomyForRecord 返回的 taxonomy 解析标签释义（Excel/JSON/托管配置同源）。
 *
 * @param {Object} params
 * @param {TagDimension} params.dimension
 * @param {string} [params.label] 标签显示名（请求场景/问题类型）
 * @param {import('./sentiment.js').Sentiment | string} [params.sentimentKey]
 * @param {string} [params.journeyL1]
 * @param {string} [params.journeyL2]
 * @param {{ requestScenes?: TagRule[]; problemTypes?: TagRule[]; journeys?: { label: string; description?: string; children?: TagRule[] }[] } | null} [params.taxonomy]
 * @returns {TagDefinition}
 */
export function resolveTagDefinition({
  dimension,
  label = '',
  sentimentKey,
  journeyL1 = '',
  journeyL2 = '',
  taxonomy = null,
}) {
  const dimLabel = MANUAL_TAG_DIMENSION_LABELS[dimension]

  if (dimension === 'sentiment') {
    const key = normalizeSentiment(sentimentKey || label)
    const name = SENTIMENT_LABELS[key] || String(label || '未识别')
    return {
      title: `${dimLabel} · ${name}`,
      body: SENTIMENT_DESCRIPTIONS[key] || '暂无释义',
      source: 'sentiment',
    }
  }

  if (dimension === 'journey') {
    return resolveJourneyDefinition({ taxonomy, journeyL1, journeyL2, dimLabel })
  }

  const emptyLabel = dimension === 'requestScene' ? '未分类' : '未分类'
  if (!label?.trim()) {
    return {
      title: `${dimLabel} · ${emptyLabel}`,
      body: UNSET_BODY,
      source: 'none',
    }
  }

  const taxonomyList =
    dimension === 'requestScene' ? taxonomy?.requestScenes : taxonomy?.problemTypes
  const builtinList =
    dimension === 'requestScene' ? REQUEST_SCENES_BUILTIN : PROBLEM_TYPES_BUILTIN

  return mergeRuleDefinition(
    dimLabel,
    label.trim(),
    findInList(taxonomyList, label.trim()),
    findInList(builtinList, label.trim()),
  )
}

/**
 * @param {Object} params
 * @param {{ journeys?: { label: string; description?: string; children?: TagRule[] }[] } | null} params.taxonomy
 * @param {string} [params.journeyL1]
 * @param {string} [params.journeyL2]
 * @param {string} [params.dimLabel]
 */
export function resolveJourneyDefinition({
  taxonomy,
  journeyL1 = '',
  journeyL2 = '',
  dimLabel = MANUAL_TAG_DIMENSION_LABELS.journey,
}) {
  const l1 = journeyL1?.trim()
  const l2 = journeyL2?.trim()

  if (!l1 && !l2) {
    return {
      title: `${dimLabel} · 未识别`,
      body: UNSET_BODY,
      source: 'none',
    }
  }

  const l1Node = taxonomy?.journeys?.find((j) => j.label === l1)
  if (l2) {
    const l2Node = l1Node?.children?.find((c) => c.label === l2)
    const display = l1 ? `${l1} › ${l2}` : l2
    if (l2Node) {
      return {
        title: `${dimLabel} · ${display}`,
        body: bodyFromRule(l2Node.description || l1Node?.description, l2Node.keywords),
        source: l2Node.description?.trim() ? 'taxonomy' : l1Node?.description?.trim() ? 'taxonomy' : l2Node.keywords?.length ? 'keywords' : 'none',
      }
    }
    return {
      title: `${dimLabel} · ${display}`,
      body: '暂无释义',
      source: 'none',
    }
  }

  if (l1Node) {
    return {
      title: `${dimLabel} · ${l1}`,
      body: bodyFromRule(l1Node.description, l1Node.keywords),
      source: l1Node.description?.trim() ? 'taxonomy' : l1Node.keywords?.length ? 'keywords' : 'none',
    }
  }

  return {
    title: `${dimLabel} · ${l1}`,
    body: '暂无释义',
    source: 'none',
  }
}

/**
 * @param {TagRule[]} items
 * @param {TagDimension} dimension
 * @param {{ requestScenes?: TagRule[]; problemTypes?: TagRule[]; journeys?: object[] } | null} taxonomy
 */
export function mapTaxonomySelectOptions(items, dimension, taxonomy) {
  return (items || []).map((t) => {
    const def = resolveTagDefinition({ dimension, label: t.label, taxonomy })
    return {
      label: t.label,
      value: t.label,
      title: def.body,
    }
  })
}
