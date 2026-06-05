import { useMemo } from 'react'
import { useInsights } from '../../context/InsightsContext.jsx'
import { isStubPipeline } from '../../analysis/registry.js'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../../domain/enums.js'
import WorkbenchTabNav from './WorkbenchTabNav.jsx'

export { WORKBENCH_HOME } from '../../lib/workbenchAnalysisLink.js'

const TAB_OVERVIEW = 'overview'

/**
 * 工作台一级来源 Tab（洞察分析入口已上移至顶栏操作区）
 * @param {Object} props
 * @param {string} props.activeSourceTab
 * @param {(key: string) => void} props.onSourceTabChange
 */
export default function WorkbenchAnalysisNav({ activeSourceTab, onSourceTabChange }) {
  const { sourceSnapshots } = useInsights()
  const sourceCounts = useMemo(() => {
    const counts = {}
    for (const type of DATA_SOURCE_TYPES) {
      const n = sourceSnapshots[type]?.summary?.recordCount
      if (n != null) counts[type] = n
    }
    const followUpN =
      sourceSnapshots.post_use_rating?.aggregates?.followUpSatisfactionMetrics?.scoredCount ?? 0
    if (followUpN > (counts.post_use_rating ?? 0)) {
      counts.post_use_rating = followUpN
    }
    return counts
  }, [sourceSnapshots])

  const sourceItems = [
    { key: TAB_OVERVIEW, label: '综合概述' },
    ...DATA_SOURCE_TYPES.map((type) => {
      const base = DATA_SOURCE_LABELS[type]
      const preview =
        isStubPipeline(type) && type !== 'post_use_rating' ? '（预览）' : ''
      const count = sourceCounts[type]
      const name = `${base}${preview}`
      return {
        key: type,
        label: count != null ? `${name} (${count})` : name,
      }
    }),
  ]

  return (
    <WorkbenchTabNav
      className="mb-4"
      activeKey={activeSourceTab}
      onChange={onSourceTabChange}
      items={sourceItems}
    />
  )
}
