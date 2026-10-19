import ComboBarLineChart from '../charts/ComboBarLineChart.jsx'
import { scoreAxisDomain, toJourneyChartRows } from '../../lib/postUseRating/insights.js'

const DASHBOARD_BARS = [{ dataKey: 'sampleSize', name: '样本量', fill: '#38BDF8' }]
const DASHBOARD_LINE = { dataKey: 'avgScore', name: '均分', stroke: '#0F766E' }
const REPORT_BARS = [{ dataKey: 'sampleSize', name: '样本量', fill: '#D1D5DB' }]
const REPORT_LINE = { dataKey: 'avgScore', name: '均分', stroke: '#0F766E', strokeWidth: 3, dotRadius: 4 }

/**
 * 用后即评一级旅程图：柱为样本量，折线为均分；无二级环节。
 * @param {{
 *   rows?: { productName?: string, journey: string, sampleSize: number, avgScore: number | null, nonTenCount?: number }[]
 *   productName?: string
 *   height?: number
 *   variant?: 'dashboard' | 'report'
 * }} props
 */
export default function PostUseJourneyMap({ rows = [], productName = '', height = 260, variant = 'dashboard' }) {
  const data = toJourneyChartRows(rows, { productName })
  const bars = variant === 'report' ? REPORT_BARS : DASHBOARD_BARS
  const line = variant === 'report' ? REPORT_LINE : DASHBOARD_LINE
  const scores = data.map((row) => row.avgScore).filter((value) => Number.isFinite(value))
  const empty = !data.some((row) => row.sampleSize > 0)
  if (empty) {
    return <div className="py-8 text-center text-sm text-ink-400">暂无用户旅程分布</div>
  }
  return (
    <ComboBarLineChart
      data={data}
      xDataKey="journey"
      bars={bars}
      line={line}
      lineDomain={scoreAxisDomain(scores)}
      connectNulls
      height={height}
      referenceLine={{ y: 9, label: '关注线 9' }}
    />
  )
}
