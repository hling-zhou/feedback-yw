import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from 'recharts'
import TrendChart from '../charts/TrendChart.jsx'
import SentimentChart from '../charts/SentimentChart.jsx'
import ThemeBarChart from '../charts/ThemeBarChart.jsx'
import ChartTooltip from '../charts/ChartTooltip.jsx'
import { POST_USE_SATISFACTION_BASELINE } from '../../lib/postUseRating/metrics.js'

const SCORE_BAND_COLORS = {
  ten: '#10B981',
  nine: '#34D399',
  eight: '#F59E0B',
  low: '#EF4444',
}

const PRODUCT_BAR_OK = '#4F46E5'
const PRODUCT_BAR_WARN = '#DC2626'

/**
 * @param {{
 *   scoreBands?: { ten: number, nine: number, eight: number, low: number }
 *   voice?: { positiveCount: number, negativeCount: number }
 *   productScores?: Array<{ productName: string, avgScore: number, sampleSize: number }>
 *   reasons?: Array<{ reason: string, count: number }>
 *   scoreTrend?: { data: object[], areas: object[] }
 *   satisfactionTrend?: { data: object[], areas: object[] }
 * }} props
 */
export default function PostUseHtmlReportCharts({
  scoreBands,
  voice,
  productScores,
  reasons,
  scoreTrend,
  satisfactionTrend,
}) {
  const bandRows = [
    { key: 'ten', name: '10分', count: Number(scoreBands?.ten || 0) },
    { key: 'nine', name: '9分', count: Number(scoreBands?.nine || 0) },
    { key: 'eight', name: '8分', count: Number(scoreBands?.eight || 0) },
    { key: 'low', name: '7分及以下', count: Number(scoreBands?.low || 0) },
  ]
  const voiceRows = [
    { name: '正反馈', value: Number(voice?.positiveCount || 0), key: 'positive' },
    { name: '负反馈', value: Number(voice?.negativeCount || 0), key: 'negative' },
  ]
  const productRows = (productScores || [])
    .filter((row) => Number.isFinite(Number(row.avgScore)))
    .slice()
    .sort((a, b) => Number(a.avgScore) - Number(b.avgScore))
    .slice(0, 12)
    .map((row) => ({
      name: row.productName,
      avgScore: Number(row.avgScore),
      sampleSize: Number(row.sampleSize || 0),
    }))
  const reasonRows = (reasons || [])
    .filter((row) => row.reason && row.count)
    .slice(0, 8)
    .map((row) => ({ label: row.reason, count: row.count, negative: row.count }))

  return (
    <div className="report-charts">
      <div className="report-charts__grid">
        <div className="report-visual-panel">
          <div className="report-visual-panel__title">评分分布</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={bandRows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
              <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <ChartTooltip formatter={(value) => [`${value} 条`, '样本']} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {bandRows.map((row) => (
                  <Cell key={row.key} fill={SCORE_BAND_COLORS[row.key]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="report-visual-panel">
          <div className="report-visual-panel__title">客户声音</div>
          <SentimentChart data={voiceRows} />
        </div>
      </div>

      {productRows.length ? (
        <div className="report-visual-panel">
          <div className="report-visual-panel__title">产品均分（关注线 9 分）</div>
          <ResponsiveContainer width="100%" height={Math.max(220, productRows.length * 28)}>
            <BarChart data={productRows} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
              <XAxis type="number" domain={[0, 10]} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11, fill: '#6B7280' }} />
              <ChartTooltip
                formatter={(value, _name, props) => [
                  `${value} 分 · 样本 ${props.payload.sampleSize}`,
                  props.payload.name,
                ]}
              />
              <ReferenceLine x={9} stroke="#F59E0B" strokeDasharray="6 4" />
              <Bar dataKey="avgScore" radius={[0, 4, 4, 0]} maxBarSize={18}>
                {productRows.map((row) => (
                  <Cell key={row.name} fill={row.avgScore < 9 ? PRODUCT_BAR_WARN : PRODUCT_BAR_OK} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ) : null}

      {reasonRows.length ? (
        <div className="report-visual-panel">
          <div className="report-visual-panel__title">高频原因</div>
          <ThemeBarChart data={reasonRows} showNegativePct={false} />
        </div>
      ) : null}

      <div className="report-charts__grid">
        <div className="report-visual-panel">
          <div className="report-visual-panel__title">重点产品体验均分趋势</div>
          {scoreTrend?.data?.length ? (
            <TrendChart
              variant="line"
              allowDecimals
              height={240}
              data={scoreTrend.data}
              areas={scoreTrend.areas}
              referenceLine={{ y: 9, label: '关注线 9' }}
            />
          ) : (
            <div className="report-chart-empty">当前月份暂无体验趋势</div>
          )}
        </div>
        <div className="report-visual-panel">
          <div className="report-visual-panel__title">重点产品投诉回访满意度趋势</div>
          {satisfactionTrend?.data?.length ? (
            <TrendChart
              variant="line"
              allowDecimals
              height={240}
              data={satisfactionTrend.data}
              areas={satisfactionTrend.areas}
              referenceLine={{ y: POST_USE_SATISFACTION_BASELINE * 100, label: '达标线 88%' }}
            />
          ) : (
            <div className="report-chart-empty">当前月份暂无满意度趋势</div>
          )}
        </div>
      </div>
    </div>
  )
}
