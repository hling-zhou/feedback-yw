import {
  isClusterFamilyRecommendation,
  isFallbackReferenceRecommendation,
} from '../planningRecommendations.js'

function priorityWeight(priority) {
  if (priority === 'high') return 3
  if (priority === 'medium') return 2
  return 1
}

function union(values) {
  return [...new Set((values || []).filter(Boolean))]
}

/**
 * @param {import('../../domain/overviewConclusions.js').OverviewRecommendation[]} complaintRecommendations
 * @param {import('../../domain/overviewConclusions.js').OverviewRecommendation[]} consultationRecommendations
 */
export function buildOverviewFusedRecommendations(
  complaintRecommendations = [],
  consultationRecommendations = [],
) {
  /** @type {Map<string, { complaint: import('../../domain/overviewConclusions.js').OverviewRecommendation[]; consultation: import('../../domain/overviewConclusions.js').OverviewRecommendation[] }>} */
  const byKey = new Map()

  const append = (source, rec) => {
    if (!isClusterFamilyRecommendation(rec)) return
    const key =
      rec.generationMeta?.fingerprintV2?.trim()
      || rec.stableKey?.trim()
      || `${rec.signalType}:${rec.scope?.product || ''}:${rec.summary || rec.text || ''}`
    if (!byKey.has(key)) byKey.set(key, { complaint: [], consultation: [] })
    byKey.get(key)[source].push(rec)
  }

  complaintRecommendations.forEach((rec) => append('complaint', rec))
  consultationRecommendations.forEach((rec) => append('consultation', rec))

  const fused = [...byKey.entries()].map(([key, bucket]) => {
    const members = [...bucket.complaint, ...bucket.consultation]
    const best = members
      .slice()
      .sort((a, b) => (b.generationMeta?.score || 0) - (a.generationMeta?.score || 0))[0]
    const sourceGroup =
      bucket.complaint.length && bucket.consultation.length
        ? 'cross_source'
        : bucket.complaint.length
          ? 'complaint_only'
          : 'consultation_only'
    const mergedScore =
      Math.min(
        5,
        Math.max(...members.map((rec) => rec.generationMeta?.score || 0))
          + (sourceGroup === 'cross_source' ? 0.45 : 0),
      )

    return {
      ...best,
      id: `overview-${key}`,
      signalType: 'overview_fused_cluster',
      sourceGroup,
      evidenceRecordIds: union(members.flatMap((rec) => rec.evidenceRecordIds || [])),
      evidenceTicketIds: union(members.flatMap((rec) => rec.evidenceTicketIds || [])),
      generationMeta: {
        ...best.generationMeta,
        mergedFrom: union(members.map((rec) => rec.summary || rec.text || rec.id)),
        score: mergedScore,
      },
      summary:
        sourceGroup === 'cross_source'
          ? `${best.summary}（投诉/咨询共性主题）`
          : best.summary,
      text:
        sourceGroup === 'cross_source'
          ? `${best.text}（投诉/咨询共性主题）`
          : best.text,
    }
  })

  const fallback = [...complaintRecommendations, ...consultationRecommendations]
    .filter((rec) => isFallbackReferenceRecommendation(rec))
    .map((rec) => ({
      ...rec,
      sourceGroup:
        rec.scope?.dataSourceType === 'consultation_ticket'
          ? 'consultation_only'
          : 'complaint_only',
    }))

  return {
    fusedRecommendations: fused.sort((a, b) => {
      const scoreDiff = (b.generationMeta?.score || 0) - (a.generationMeta?.score || 0)
      if (scoreDiff) return scoreDiff
      return priorityWeight(b.priority) - priorityWeight(a.priority)
    }),
    fallbackRecommendations: fallback.sort((a, b) => {
      const scoreDiff = (b.generationMeta?.score || 0) - (a.generationMeta?.score || 0)
      if (scoreDiff) return scoreDiff
      return priorityWeight(b.priority) - priorityWeight(a.priority)
    }),
  }
}

