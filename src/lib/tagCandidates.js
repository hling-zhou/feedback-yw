import { createTagCandidate, candidateDedupeKey, normalizeProposedLabel } from '../domain/tagCandidate.js'
import { excerptText } from '../analysis/core/ArtifactCollector.js'
import { enrichTagCandidateForReview } from './tagCandidateReview.js'
import { emit } from './events.js'
import {
  isPendingReviewTag,
  TAG_PENDING_REVIEW_PREFIX,
} from './ticketAnalysis/tagLabels.js'

export {
  TAG_TYPE_LABELS,
  TAG_ORIGIN_LABELS,
  buildTagCandidateMeaning,
  buildTagCandidateReviewHint,
  getTagCandidateTarget,
  groupTagCandidates,
  filterCandidatesByGroup,
  enrichTagCandidateForReview,
} from './tagCandidateReview.js'

import {
  buildTagCandidateMeaning as _buildMeaning,
  getTagCandidateTarget,
} from './tagCandidateReview.js'

/** @deprecated 使用 buildTagCandidateMeaning */
export function buildTagCandidateExplanation(candidate) {
  return _buildMeaning(candidate)
}

const UNKNOWN_L1 = '未识别环节'
const UNKNOWN_L2 = '未识别子环节'
const UNCLASSIFIED_PROBLEM = '未分类'
const UNCLASSIFIED_SCENE = '未分类'

/**
 * @param {string | undefined | null} label
 */
export function extractPendingReviewProposedLabel(label) {
  const t = label?.trim()
  if (!t || !isPendingReviewTag(t)) return null
  return t.slice(TAG_PENDING_REVIEW_PREFIX.length).trim() || null
}

/**
 * @param {string} label
 * @param {{ label: string; keywords?: string[] }[]} [requestScenes]
 */
export function isKnownRequestScene(label, requestScenes) {
  const normalized = (label || '').trim()
  if (!normalized || normalized === UNCLASSIFIED_SCENE) return true
  if (isPendingReviewTag(normalized)) return false
  return (requestScenes || []).some((t) => (t.label || '').trim() === normalized)
}

/**
 * @param {string} label
 * @param {{ label: string; keywords?: string[] }[]} [problemTypes]
 */
export function isKnownProblemType(label, problemTypes) {
  const normalized = (label || '').trim()
  if (!normalized || normalized === UNCLASSIFIED_PROBLEM) return true
  if (isPendingReviewTag(normalized)) return false
  return (problemTypes || []).some((t) => (t.label || '').trim() === normalized)
}

/**
 * @param {{ journeyL1: string; journeyL2: string }} llm
 * @param {import('./productTaxonomy.js').JourneyL1[]} journeys
 */
export function isValidJourneyPair(llm, journeys) {
  const node = journeys.find((j) => j.label === llm.journeyL1)
  if (!node) return false
  if (llm.journeyL2 === UNKNOWN_L2) return true
  return node.children?.some((c) => c.label === llm.journeyL2)
}

/**
 * 导入列或打标结果中的库外「问题类型」采集为候选标签
 * @param {Object} ctx
 * @param {string} ctx.problemType
 * @param {{ label: string; keywords?: string[] }[]} [ctx.problemTypes]
 * @param {string} [ctx.problemTypeCol]
 * @param {string} [ctx.taxonomyKey]
 * @param {string} [ctx.recordId]
 * @param {string} [ctx.sourceText]
 * @param {string} [ctx.insightPeriodId]
 * @param {import('../domain/enums.js').DataSourceType} [ctx.dataSourceType]
 * @param {'llm' | 'local_overflow'} [ctx.origin]
 */
export function captureProblemTypeCandidateIfNeeded(ctx) {
  const {
    problemType,
    problemTypes,
    problemTypeCol,
    recordId,
    sourceText,
    insightPeriodId,
    dataSourceType,
    origin = 'local_overflow',
  } = ctx

  const col = problemTypeCol?.trim()
  const raw = col || problemType?.trim()
  const resolved = extractPendingReviewProposedLabel(raw) || raw
  if (!resolved || isKnownProblemType(resolved, problemTypes)) return null

  const candidate = enrichTagCandidateForReview(
    createTagCandidate({
      tagType: 'problem_type',
      proposedLabel: resolved,
      taxonomyKey: 'generic',
      recordId,
      evidenceExcerpt: excerptText(sourceText, 200),
      insightPeriodId,
      dataSourceType,
      origin: isPendingReviewTag(raw || '') ? 'local_overflow' : origin,
    }),
  )

  emit('TagCandidateDiscovered', { candidate })
  return candidate
}

/**
 * 库外「请求场景」采集为候选标签
 * @param {Object} ctx
 * @param {string} ctx.requestScene
 * @param {{ label: string; keywords?: string[] }[]} [ctx.requestScenes]
 * @param {string} [ctx.recordId]
 * @param {string} [ctx.sourceText]
 * @param {string} [ctx.insightPeriodId]
 * @param {import('../domain/enums.js').DataSourceType} [ctx.dataSourceType]
 * @param {'llm' | 'local_overflow'} [ctx.origin]
 */
export function captureRequestSceneCandidateIfNeeded(ctx) {
  const { requestScene, requestScenes, recordId, sourceText, insightPeriodId, dataSourceType, origin = 'local_overflow' } =
    ctx

  const resolved = requestScene?.trim()
  const proposed = extractPendingReviewProposedLabel(resolved) || resolved
  if (!proposed || isKnownRequestScene(proposed, requestScenes)) return null

  const candidate = enrichTagCandidateForReview(
    createTagCandidate({
      tagType: 'request_scene',
      proposedLabel: proposed,
      taxonomyKey: 'generic',
      recordId,
      evidenceExcerpt: excerptText(sourceText, 200),
      insightPeriodId,
      dataSourceType,
      origin: isPendingReviewTag(resolved || '') ? 'local_overflow' : origin,
    }),
  )

  emit('TagCandidateDiscovered', { candidate })
  return candidate
}

/**
 * LLM 返回库外旅程时采集候选标签
 * @param {Object} ctx
 * @param {{ journeyL1: string; journeyL2: string }} ctx.llm
 * @param {{ journeyL1: string; journeyL2: string }} [ctx.local]
 * @param {import('./productTaxonomy.js').JourneyL1[]} ctx.journeys
 * @param {string} [ctx.taxonomyKey]
 * @param {string} [ctx.recordId]
 * @param {string} [ctx.sourceText]
 * @param {string} [ctx.insightPeriodId]
 * @param {import('../domain/enums.js').DataSourceType} [ctx.dataSourceType]
 */
export function captureJourneyCandidateIfNeeded(ctx) {
  const { llm, journeys, taxonomyKey, recordId, sourceText, insightPeriodId, dataSourceType } =
    ctx
  if (!llm?.journeyL1 || llm.journeyL1 === UNKNOWN_L1) return null
  if (isValidJourneyPair(llm, journeys)) return null

  const candidate = enrichTagCandidateForReview(
    createTagCandidate({
      tagType: 'journey_l2',
      proposedLabel: `${llm.journeyL1} > ${llm.journeyL2}`,
      journeyL1: llm.journeyL1,
      journeyL2: llm.journeyL2,
      taxonomyKey: taxonomyKey || 'generic',
      recordId,
      evidenceExcerpt: excerptText(sourceText, 200),
      insightPeriodId,
      dataSourceType,
      origin: 'llm',
    }),
  )

  emit('TagCandidateDiscovered', { candidate })
  return candidate
}

/**
 * @param {import('../domain/tagCandidate.js').TagCandidate[]} existing
 * @param {import('../domain/tagCandidate.js').TagCandidate} incoming
 */
export function mergeTagCandidate(existing, incoming) {
  const key = candidateDedupeKey(incoming)
  const idx = existing.findIndex(
    (c) => c.status === 'pending' && candidateDedupeKey(c) === key,
  )
  if (idx >= 0) {
    const prev = existing[idx]
    const merged = enrichTagCandidateForReview({
      ...prev,
      proposedLabel: normalizeProposedLabel(incoming),
      journeyL1: incoming.journeyL1 || prev.journeyL1,
      journeyL2: incoming.journeyL2 || prev.journeyL2,
      occurrenceCount: (prev.occurrenceCount || 1) + 1,
      evidenceExcerpt: prev.evidenceExcerpt || incoming.evidenceExcerpt,
    })
    existing[idx] = merged
    return merged
  }
  const enriched = enrichTagCandidateForReview({
    ...incoming,
    proposedLabel: normalizeProposedLabel(incoming),
  })
  existing.push(enriched)
  return enriched
}

/**
 * 合并列表中重复的待复核项（同类型+产品+标签名），保留一条
 * @param {import('../domain/tagCandidate.js').TagCandidate[]} candidates
 */
export function dedupePendingTagCandidates(candidates) {
  /** @type {Map<string, import('../domain/tagCandidate.js').TagCandidate>} */
  const byKey = new Map()
  const others = []

  for (const c of candidates) {
    if (c.status !== 'pending') {
      others.push(c)
      continue
    }
    const key = candidateDedupeKey(c)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, c)
      continue
    }
    byKey.set(
      key,
      enrichTagCandidateForReview({
        ...prev,
        occurrenceCount: (prev.occurrenceCount || 1) + (c.occurrenceCount || 1),
        evidenceExcerpt: prev.evidenceExcerpt || c.evidenceExcerpt,
      }),
    )
  }

  return [...others, ...byKey.values()]
}

/**
 * 写入或合并待复核候选（串行调用，避免批量导入时并发重复插入）
 * @param {{ listTagCandidates: Function; putTagCandidate: Function; deleteTagCandidate?: Function }} adapter
 * @param {import('../domain/tagCandidate.js').TagCandidate} incoming
 */
export async function upsertPendingTagCandidate(adapter, incoming) {
  const key = candidateDedupeKey(incoming)
  const all = await adapter.listTagCandidates()

  const adopted = all.find(
    (c) =>
      (c.status === 'approved' || c.status === 'merged') && candidateDedupeKey(c) === key,
  )
  if (adopted) {
    const updated = enrichTagCandidateForReview({
      ...adopted,
      occurrenceCount: (adopted.occurrenceCount || 1) + 1,
    })
    await adapter.putTagCandidate(updated)
    return { action: 'increment_adopted', candidate: updated }
  }

  const pendingDupes = all.filter(
    (c) => c.status === 'pending' && candidateDedupeKey(c) === key,
  )
  const primary = pendingDupes[0]

  if (primary) {
    const merged = enrichTagCandidateForReview({
      ...primary,
      proposedLabel: normalizeProposedLabel(incoming),
      journeyL1: incoming.journeyL1 || primary.journeyL1,
      journeyL2: incoming.journeyL2 || primary.journeyL2,
      occurrenceCount:
        (primary.occurrenceCount || 1) +
        1 +
        pendingDupes.slice(1).reduce((n, d) => n + (d.occurrenceCount || 1), 0),
      evidenceExcerpt: primary.evidenceExcerpt || incoming.evidenceExcerpt,
    })
    await adapter.putTagCandidate(merged)
    if (adapter.deleteTagCandidate) {
      for (const dup of pendingDupes.slice(1)) {
        await adapter.deleteTagCandidate(dup.id)
      }
    }
    return { action: 'merged', candidate: merged }
  }

  const created = enrichTagCandidateForReview({
    ...incoming,
    proposedLabel: normalizeProposedLabel(incoming),
  })
  await adapter.putTagCandidate(created)
  return { action: 'created', candidate: created }
}

/**
 * 启动时合并 IndexedDB 中已有的重复待复核项
 * @param {{ listTagCandidates: Function; putTagCandidate: Function; deleteTagCandidate?: Function }} adapter
 */
export async function compactDuplicateTagCandidates(adapter) {
  const all = await adapter.listTagCandidates()
  const pending = all.filter((c) => c.status === 'pending')
  const others = all.filter((c) => c.status !== 'pending')

  /** @type {Map<string, import('../domain/tagCandidate.js').TagCandidate>} */
  const byKey = new Map()
  /** @type {string[]} */
  const extraIds = []

  for (const c of pending) {
    const key = candidateDedupeKey(c)
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, c)
      continue
    }
    byKey.set(
      key,
      enrichTagCandidateForReview({
        ...prev,
        occurrenceCount: (prev.occurrenceCount || 1) + (c.occurrenceCount || 1),
        evidenceExcerpt: prev.evidenceExcerpt || c.evidenceExcerpt,
      }),
    )
    extraIds.push(c.id)
  }

  if (!extraIds.length) {
    return { list: all, removedCount: 0 }
  }

  for (const c of byKey.values()) {
    await adapter.putTagCandidate(c)
  }
  if (adapter.deleteTagCandidate) {
    for (const id of extraIds) {
      await adapter.deleteTagCandidate(id)
    }
  }

  return { list: [...others, ...byKey.values()], removedCount: extraIds.length }
}

/**
 * 统计待复核列表中可合并的重复条数
 * @param {import('../domain/tagCandidate.js').TagCandidate[]} candidates
 */
export function countPendingDuplicateCandidates(candidates) {
  const pending = candidates.filter((c) => c.status === 'pending')
  const seen = new Set()
  let dupes = 0
  for (const c of pending) {
    const key = candidateDedupeKey(c)
    if (seen.has(key)) dupes += 1
    else seen.add(key)
  }
  return dupes
}

/**
 * @param {import('../domain/tagCandidate.js').TagCandidate[]} candidates
 */
export function exportCandidatesToCsv(candidates) {
  const rows = candidates.map((c) => {
    const target = getTagCandidateTarget(c)
    return {
    写入位置: target.tabTitle,
    配置文件: target.jsonPath,
    标签类型: c.tagType,
    提议标签: c.proposedLabel,
    标签释义: c.tagMeaning || buildTagCandidateMeaning(c),
    产品模板: c.taxonomyKey || '',
    一级旅程: c.journeyL1 || '',
    二级旅程: c.journeyL2 || '',
    状态: c.status,
    出现次数: c.occurrenceCount ?? 1,
    来源: c.origin,
    周期ID: c.insightPeriodId || '',
    数据来源: c.dataSourceType || '',
    记录ID: c.recordId || '',
    创建时间: c.createdAt,
  }
  })
  return rows
}
