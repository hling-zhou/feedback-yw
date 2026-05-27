import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import {
  TAXONOMY_CONFIG_DIR,
  TAXONOMY_EXCEL_FILE,
} from './tagLibrary/exportTaxonomyPatch.js'
import { candidateDedupeKey } from '../domain/tagCandidate.js'
import { getJourneyReference, getProductByKey } from './taxonomyLoader.js'
/** @type {Record<import('../domain/enums.js').TagType, string>} */
export const TAG_TYPE_LABELS = {
  request_scene: '请求场景',
  problem_type: '问题类型',
  journey_l1: '用户旅程（一级）',
  journey_l2: '用户旅程（二级）',
  theme: '主题标签',
}

/** @type {Record<import('../domain/tagCandidate.js').TagCandidate['origin'], string>} */
export const TAG_ORIGIN_LABELS = {
  llm: 'LLM 语义打标',
  local_overflow: '导入/本地打标溢出',
}

/**
 * @typedef {Object} TagCandidateTarget
 * @property {string} groupKey
 * @property {string} tabTitle
 * @property {string} shortLabel
 * @property {string} adoptTarget
 * @property {string} excelSheet
 * @property {string} jsonPath
 */

/**
 * 采纳后写入打标配置的位置（与 Excel 工作表对应）
 * @param {import('../domain/tagCandidate.js').TagCandidate} candidate
 * @returns {TagCandidateTarget}
 */
export function getTagCandidateTarget(candidate) {
  if (candidate.tagType === 'request_scene') {
    return {
      groupKey: 'request_scene',
      tabTitle: '请求场景',
      shortLabel: '全产品共用',
      adoptTarget: `${TAXONOMY_CONFIG_DIR}index.json → sharedRequestScenes`,
      excelSheet: `「${TAXONOMY_EXCEL_FILE}」工作表「请求场景」`,
      jsonPath: `${TAXONOMY_CONFIG_DIR}index.json`,
    }
  }
  if (candidate.tagType === 'problem_type') {
    return {
      groupKey: 'problem_type',
      tabTitle: '问题类型',
      shortLabel: '全产品共用',
      adoptTarget: `${TAXONOMY_CONFIG_DIR}index.json → sharedProblemTypes`,
      excelSheet: `「${TAXONOMY_EXCEL_FILE}」工作表「通用问题类型」`,
      jsonPath: `${TAXONOMY_CONFIG_DIR}index.json`,
    }
  }

  const key = candidate.taxonomyKey || 'generic'
  const name = getProductByKey(key)?.name || key
  return {
    groupKey: `journey:${key}`,
    tabTitle: `用户旅程 · ${name}`,
    shortLabel: name,
    adoptTarget: `${TAXONOMY_CONFIG_DIR}${key}.json → journeys`,
    excelSheet: `「${TAXONOMY_EXCEL_FILE}」工作表「用户旅程」（产品Key=${key}）`,
    jsonPath: `${TAXONOMY_CONFIG_DIR}${key}.json`,
  }
}

/**
 * 标签释义（非工单原文）
 * @param {import('../domain/tagCandidate.js').TagCandidate} candidate
 */
export function buildTagCandidateMeaning(candidate) {
  if (candidate.tagType === 'request_scene') {
    const label = candidate.proposedLabel
    return (
      `请求场景标签「${label}」：从用户角度描述其发起反馈时的意图与场景，` +
      `如报障与恢复、资源申请与开通、业务方案支撑、产品能力咨询等；全产品共用。` +
      `采纳后写入 sharedRequestScenes，并可通过说明与参考关键词辅助自动打标。`
    )
  }
  if (candidate.tagType === 'problem_type') {
    const label = candidate.proposedLabel
    return (
      `问题类型标签「${label}」：用于按投诉/反馈的初判原因或业务主题进行横向归类，` +
      `与具体产品无关，全产品工单共用同一套问题类型列表。` +
      `采纳后写入 sharedProblemTypes，并可通过「问题类型说明」「参考关键词」辅助自动打标。`
    )
  }

  if (candidate.tagType === 'journey_l2' || candidate.tagType === 'journey_l1') {
    const l1 = candidate.journeyL1 || candidate.proposedLabel.split('>')[0]?.trim() || ''
    const l2 =
      candidate.journeyL2 || candidate.proposedLabel.split('>')[1]?.trim() || candidate.proposedLabel
    const journeys = getJourneyReference(candidate.taxonomyKey || 'generic')
    const l1Node = journeys.find((j) => j.label === l1)
    const l2Node = l1Node?.children?.find((c) => c.label === l2)

    const l1Meaning = l1Node?.description
      ? l1Node.description
      : `用户在产品「${getProductByKey(candidate.taxonomyKey || 'generic')?.name || candidate.taxonomyKey}」使用过程中的「${l1}」阶段（待配置一级说明）`
    const l2Meaning = l2Node?.description
      ? l2Node.description
      : `「${l1}」阶段下的「${l2}」具体场景/触点（待配置二级说明）`

    return (
      `用户旅程标签：一级「${l1}」— ${l1Meaning}；二级「${l2}」— ${l2Meaning}。` +
      `用于洞察工作台旅程分布、主题联动与环节级优化建议；仅作用于当前产品模板。`
    )
  }

  const typeLabel = TAG_TYPE_LABELS[candidate.tagType] || candidate.tagType
  return `${typeLabel}「${candidate.proposedLabel}」：待补充标签释义，采纳时请填写说明与关键词。`
}

/**
 * 复核上下文（出现次数、采集方式等，不含反馈原文）
 * @param {import('../domain/tagCandidate.js').TagCandidate} candidate
 */
export function buildTagCandidateReviewHint(candidate) {
  const count = candidate.occurrenceCount ?? 1
  const countText = count > 1 ? `出现 ${count} 次` : '首次出现'
  const origin = TAG_ORIGIN_LABELS[candidate.origin] || candidate.origin
  const source = candidate.dataSourceType
    ? DATA_SOURCE_LABELS[candidate.dataSourceType]
    : null
  return [countText, origin, source].filter(Boolean).join(' · ')
}

/**
 * @param {import('../domain/tagCandidate.js').TagCandidate} candidate
 */
export function enrichTagCandidateForReview(candidate) {
  const target = getTagCandidateTarget(candidate)
  const tagMeaning = buildTagCandidateMeaning(candidate)
  return {
    ...candidate,
    targetGroup: target.groupKey,
    tagMeaning,
    explanation: tagMeaning,
    reviewHint: buildTagCandidateReviewHint(candidate),
  }
}

/**
 * @param {import('../domain/tagCandidate.js').TagCandidate[]} candidates
 */
export function groupTagCandidates(candidates) {
  /** @type {Map<string, { target: TagCandidateTarget; items: import('../domain/tagCandidate.js').TagCandidate[] }>} */
  const map = new Map()

  for (const c of candidates) {
    const target = getTagCandidateTarget(c)
    if (!map.has(target.groupKey)) {
      map.set(target.groupKey, { target, items: [] })
    }
    const items = map.get(target.groupKey).items
    const dupIdx = items.findIndex((x) => candidateDedupeKey(x) === candidateDedupeKey(c))
    if (dupIdx >= 0 && c.status === 'pending' && items[dupIdx].status === 'pending') {
      const prev = items[dupIdx]
      items[dupIdx] = {
        ...prev,
        occurrenceCount: (prev.occurrenceCount || 1) + (c.occurrenceCount || 1),
      }
      continue
    }
    items.push(c)
  }

  const groups = [...map.values()]
  groups.sort((a, b) => {
    if (a.target.groupKey === 'problem_type') return -1
    if (b.target.groupKey === 'problem_type') return 1
    return a.target.tabTitle.localeCompare(b.target.tabTitle, 'zh-CN')
  })

  for (const g of groups) {
    g.items.sort((a, b) => (b.occurrenceCount ?? 1) - (a.occurrenceCount ?? 1))
  }

  return groups
}

/**
 * @param {import('../domain/tagCandidate.js').TagCandidate[]} candidates
 * @param {string} groupKey
 */
export function filterCandidatesByGroup(candidates, groupKey) {
  if (!groupKey) return candidates
  return candidates.filter((c) => getTagCandidateTarget(c).groupKey === groupKey)
}
