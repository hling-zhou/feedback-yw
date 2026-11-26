import { useCallback, useEffect, useMemo, useState } from 'react'
import { Empty, List, Select, Space, Tag, Typography, message } from 'antd'
import TrendChart from '../components/charts/TrendChart.jsx'
import { PageHeader } from './Dashboard.shared.jsx'
import { getProblemReductionView } from '../lib/actionItemClient.js'
import { ACTION_ITEM_STATUS_LABELS } from '../domain/actionItem.js'
import { buildMonthlyActionMarkers } from '../domain/actionProblemScope.js'

/** @typedef {import('../domain/actionProblemScope.js').ProblemCentricRow} ProblemCentricRow */

const TREND_ARROW = { up: '↑', down: '↓', flat: '→', unknown: '—' }
const TREND_COLOR = { up: 'red', down: 'green', flat: 'default', unknown: 'default' }

export default function ProblemReductionTab() {
  const [problems, setProblems] = useState(/** @type {ProblemCentricRow[]} */ ([]))
  const [loading, setLoading] = useState(false)
  const [selectedKey, setSelectedKey] = useState('')
  const [productFilter, setProductFilter] = useState('')

  const loadProblems = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getProblemReductionView()
      setProblems(result.problems || [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载问题压降视图失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProblems()
  }, [loadProblems])

  const productOptions = useMemo(() => {
    const seen = new Map()
    for (const row of problems) {
      if (row.productKey && !seen.has(row.productKey)) {
        seen.set(row.productKey, row.productName)
      }
    }
    return [...seen.entries()].map(([key, name]) => ({ value: key, label: name }))
  }, [problems])

  const filteredProblems = useMemo(
    () => (productFilter ? problems.filter((p) => p.productKey === productFilter) : problems),
    [problems, productFilter],
  )

  const selected = useMemo(
    () => problems.find((p) => p.key === selectedKey) || filteredProblems[0] || null,
    [problems, selectedKey, filteredProblems],
  )

  return (
    <div className="flex min-h-[360px] flex-col gap-4 lg:h-[calc(100dvh-9.5rem)]">
      <PageHeader
        desc="以问题为中心：查看某类问题在较长时间内的工单量变化，以及该问题上先后多个举措的压降情况。"
        action={
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="按产品筛选"
            className="min-w-[180px]"
            value={productFilter || undefined}
            options={productOptions}
            onChange={(v) => {
              setProductFilter(v || '')
              setSelectedKey('')
            }}
          />
        }
      />

      {!filteredProblems.length ? (
        <div className="page-card-sm">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={loading ? '加载中…' : '暂无关联举措的问题'}
          />
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-[300px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col overflow-hidden page-card-sm max-lg:max-h-[min(46vh,360px)]">
            <div className="min-h-0 flex-1 overflow-y-auto">
            <List
              size="small"
              dataSource={filteredProblems}
              renderItem={(row) => (
                <List.Item
                  onClick={() => setSelectedKey(row.key)}
                  className={`cursor-pointer ${selected?.key === row.key ? '!bg-ink-50' : ''}`}
                >
                  <div className="min-w-0 flex-1">
                    <Typography.Text strong className="!text-sm block truncate">
                      {row.productName}
                    </Typography.Text>
                    <Typography.Text type="secondary" className="!text-xs block truncate">
                      {row.journeyL1}
                      {row.journeyL2 && row.journeyL2 !== row.journeyL1 ? ` / ${row.journeyL2}` : ''}
                    </Typography.Text>
                    <Space size={4} className="mt-1">
                      <Tag className="!m-0 !text-xs">{row.totalTicketCount} 单</Tag>
                      <Tag className="!m-0 !text-xs">{row.actions.length} 举措</Tag>
                      <Tag color={TREND_COLOR[row.overallTrend]} className="!m-0 !text-xs">
                        {TREND_ARROW[row.overallTrend]}
                      </Tag>
                    </Space>
                  </div>
                </List.Item>
              )}
            />
            </div>
          </div>

          {selected ? (
            <div className="min-h-0 h-full">
              <ProblemDetail row={selected} />
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

/**
 * 问题详情面板（含趋势图竖线聚合与举措时间线）。命名导出供渲染测试直接注入 props。
 * @param {{ row: ProblemCentricRow }} props
 */
export function ProblemDetail({ row }) {
  // 竖线重叠治理（2026-11-25）：有排期举措按月聚合，每月一条竖线+数量角标；
  // 无排期举措不画线（firstProposedAt 是导入日，不上图）。
  const markers = useMemo(() => buildMonthlyActionMarkers(row.actions), [row.actions])
  const scheduledCount = markers.reduce((s, m) => s + m.badge, 0)
  const unscheduledCount = row.actions.length - scheduledCount
  // 图上竖线序号 → 举措列表按月分组编号，列表徽标与图一一对应
  const ordinalByMonth = useMemo(() => {
    const map = new Map()
    markers.forEach((m) => map.set(m.month, m.ordinal))
    return map
  }, [markers])

  return (
    <div className="page-card-sm flex h-full min-h-0 flex-col overflow-hidden">
      <div className="page-card-header"><span className="page-card-title">
        <Space size={6} wrap>
          <Typography.Text strong>{row.productName}</Typography.Text>
          <Typography.Text type="secondary" className="!text-xs">
            {row.journeyL1}
            {row.journeyL2 && row.journeyL2 !== row.journeyL1 ? ` / ${row.journeyL2}` : ''}
          </Typography.Text>
          {(row.problemTypeLabel || row.requestSceneLabel) && (
            <Space size={4} wrap>
              {row.problemTypeLabel ? (
                <Tag className="!m-0 !text-xs">问题类型 · {row.problemTypeLabel}</Tag>
              ) : null}
              {row.requestSceneLabel ? (
                <Tag className="!m-0 !text-xs">请求场景 · {row.requestSceneLabel}</Tag>
              ) : null}
            </Space>
          )}
        </Space>
      </span></div>
      <div className="space-y-4" style={{ flex: 1, minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
        {row.painPointSample ? (
          <Typography.Paragraph type="secondary" className="!mb-0 !text-xs" ellipsis={{ rows: 2, tooltip: row.painPointSample }}>
            痛点样本：{row.painPointSample}
          </Typography.Paragraph>
        ) : null}

        <div className="rounded-lg bg-white p-2">
          <Typography.Text type="secondary" className="mb-1 block text-xs">
            工单量月度趋势（全量 {row.totalTicketCount} 单，{row.firstMonth}~{row.lastMonth}）· 竖线=举措实施月（角标=当月举措数：已完成绿 / 混合橙 / 未完成灰 / 含逾期红）
            {unscheduledCount > 0 ? `，另有 ${unscheduledCount} 条无排期举措未上图` : ''}
          </Typography.Text>
          <TrendChart
            variant="line"
            xType="time"
            height={240}
            data={row.monthlyTrend}
            areas={[
              { dataKey: 'count', name: '工单数', stroke: '#4F46E5' },
              { dataKey: 'negative', name: '负向', stroke: '#EF4444' },
            ]}
            referenceLines={markers.map((m) => ({ x: m.x, badge: m.badge, tooltip: m.tooltip, tone: m.tone }))}
          />
        </div>

        <div>
          <Typography.Text type="secondary" className="mb-2 block text-xs">
            举措时间线（{scheduledCount} 条有排期按实施升序，徽标序号对应图上竖线月份
            {unscheduledCount > 0 ? `；${unscheduledCount} 条无排期未上图` : ''}）
          </Typography.Text>
          <Space direction="vertical" size={8} className="w-full">
            {[...row.actions]
              .sort((a, b) => Boolean(a.anchorDate) === Boolean(b.anchorDate)
                ? (a.anchorDate || '').localeCompare(b.anchorDate || '')
                : a.anchorDate ? -1 : 1)
              .map((action) => (
                <ActionTimelineRow
                  key={action.actionId}
                  action={action}
                  ordinal={action.anchorMonth ? ordinalByMonth.get(action.anchorMonth) ?? null : null}
                />
              ))}
          </Space>
        </div>
        <Typography.Text type="secondary" className="block !text-[11px]">
          关联趋势，非因果
        </Typography.Text>
      </div>
    </div>
  )
}

/**
 * 举措行状态圆点（与图上竖线 tone 同色系，S1 方案）：
 * completed 绿 / 逾期未完成（含挂起）红 / 其余灰橙。
 * @param {{ status?: string; scheduleAt?: string; anchorDate?: string }} action
 */
function actionStatusDotClass(action) {
  const status = String(action?.status ?? '')
  if (status === 'completed') return 'bg-green-500'
  const schedule = String(action?.scheduleAt ?? '').trim()
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const overdue = Boolean(schedule) && schedule < todayStr &&
    !['completed', 'not_implemented', 'abnormal_terminated'].includes(status)
  if (overdue) return 'bg-red-500'
  if (status === 'in_progress') return 'bg-amber-500'
  return 'bg-gray-400'
}

/**
 * @param {{ action: any; ordinal?: number | null }} props
 */
function ActionTimelineRow({ action, ordinal = null }) {
  const r = action.reduction
  return (
    <div className="rounded-md border border-ink-100 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <Typography.Text className="!text-sm">
          <span className={`mr-1.5 inline-block h-2 w-2 rounded-full align-middle ${actionStatusDotClass(action)}`} aria-label="状态点" />
          {ordinal != null ? (
            <span
              aria-label={`第 ${ordinal} 个实施月`}
              className="mr-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-amber-500 bg-amber-100 px-1 align-middle text-[10px] leading-none text-amber-700"
            >
              {ordinal}
            </span>
          ) : null}
          {action.content}
        </Typography.Text>
        <Tag className="!m-0 !text-xs">{ACTION_ITEM_STATUS_LABELS[action.status] || action.status}</Tag>
      </div>
      <Typography.Text type="secondary" className="!text-xs block">
        实施：{action.completedAt ? `实际完成 ${action.completedAt}` : action.scheduleAt || action.anchorDate || '—'}
      </Typography.Text>
      {r && r.sufficient && r.changePct !== null ? (
        <Typography.Text className="!text-xs">
          锚点前 {r.beforeMonths.length} 月月均 {r.beforeAvg} → 后 {r.afterMonths.length} 月月均 {r.afterAvg}，{' '}
          <Typography.Text type={r.changePct < 0 ? 'success' : 'danger'} strong>
            {r.changePct > 0 ? '↑' : '↓'}{Math.abs(r.changePct)}%
          </Typography.Text>
        </Typography.Text>
      ) : (
        <Typography.Text type="warning" className="!text-xs">
          {r ? '数据不足' : '未设排期，未上图'}
        </Typography.Text>
      )}
    </div>
  )
}
