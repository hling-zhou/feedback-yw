import { useMemo } from 'react'

/** @typedef {import('../domain/overviewConclusions.js').ActionRecsResult} ActionRecsResult */

/**
 * 从快照中提取行动建议数据。
 *
 * @param {Object} params
 * @param {'all' | 'complaint_ticket' | 'consultation_ticket'} [params.sourceFilter='all']
 * @param {Object} [params.snapshot] - 概览快照或 source 快照
 * @returns {{ recs: ActionRecsResult[], gateReport: object | null }}
 */
export function useActionRecommendations({ sourceFilter = 'all', snapshot } = {}) {
  const { recs, gateReport } = useMemo(() => {
    if (!snapshot) return { recs: [], gateReport: null }

    let all
    let gate

    if (sourceFilter === 'all') {
      // 概览快照：conclusions.recommendations
      all = snapshot.conclusions?.recommendations || []
      gate = snapshot.conclusions?.gateReport || null
    } else {
      // source 快照：aggregates.planningConclusions.recommendations
      all = snapshot.aggregates?.planningConclusions?.recommendations || []
      gate = snapshot.aggregates?.planningConclusions?.gateReport || null
    }

    // 按 sourceFilter 过滤
    if (sourceFilter === 'complaint_ticket') {
      all = all.filter((r) => (r.scale?.complaintCount || 0) > 0)
    } else if (sourceFilter === 'consultation_ticket') {
      all = all.filter((r) => (r.scale?.consultationCount || 0) > 0)
    }

    return { recs: all, gateReport: gate }
  }, [snapshot, sourceFilter])

  return { recs, gateReport }
}
