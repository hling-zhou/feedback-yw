import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Empty, List, Select, Space, Tag, Typography, message } from 'antd'
import TrendChart from '../components/charts/TrendChart.jsx'
import { PageHeader } from './Dashboard.shared.jsx'
import { listActionItems } from '../lib/actionItemClient.js'
import { buildProductNameByKeyMap } from '../lib/productCatalog.js'
import { buildProblemCentricView } from '../domain/actionProblemScope.js'
import { useInsights } from '../context/InsightsContext.jsx'
import { ACTION_ITEM_STATUS_LABELS } from '../domain/actionItem.js'

/** @typedef {import('../domain/actionProblemScope.js').ProblemCentricRow} ProblemCentricRow */

const TREND_ARROW = { up: '↑', down: '↓', flat: '→', unknown: '—' }
const TREND_COLOR = { up: 'red', down: 'green', flat: 'default', unknown: 'default' }

export default function ProblemReductionTab() {
  const { feedbacks } = useInsights()
  const [actions, setActions] = useState([])
  const [loading, setLoading] = useState(false)
  const [selectedKey, setSelectedKey] = useState('')
  const [productFilter, setProductFilter] = useState('')

  const productNameByKey = useMemo(() => buildProductNameByKeyMap(), [])

  const loadActions = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listActionItems({ limit: 500, offset: 0 })
      setActions(result.items || [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载举措失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadActions()
  }, [loadActions])

  const view = useMemo(
    () => buildProblemCentricView(actions, feedbacks, productNameByKey),
    [actions, feedbacks, productNameByKey],
  )

  const productOptions = useMemo(() => {
    const seen = new Map()
    for (const row of view.problems) {
      if (row.productKey && !seen.has(row.productKey)) {
        seen.set(row.productKey, row.productName)
      }
    }
    return [...seen.entries()].map(([key, name]) => ({ value: key, label: name }))
  }, [view.problems])

  const filteredProblems = useMemo(
    () => (productFilter ? view.problems.filter((p) => p.productKey === productFilter) : view.problems),
    [view.problems, productFilter],
  )

  const selected = useMemo(
    () => view.problems.find((p) => p.key === selectedKey) || filteredProblems[0] || null,
    [view.problems, selectedKey, filteredProblems],
  )

  return (
    <div className="space-y-4">
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
        <Card size="small" className="!border-ink-100">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={loading ? '加载中…' : '暂无关联举措的问题'}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <Card size="small" className="!border-ink-100" styles={{ body: { padding: 0 } }}>
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
          </Card>

          {selected ? <ProblemDetail row={selected} /> : null}
        </div>
      )}
    </div>
  )
}

/**
 * @param {{ row: ProblemCentricRow }} props
 */
function ProblemDetail({ row }) {
  const referenceLines = useMemo(
    () =>
      row.actions
        .filter((a) => a.anchorMonth)
        .map((a) => ({
          x: a.anchorMonth,
          label: a.content.length > 8 ? `${a.content.slice(0, 8)}…` : a.content,
          stroke: '#F59E0B',
        })),
    [row.actions],
  )

  return (
    <Card
      size="small"
      className="!border-ink-100"
      title={
        <Space size={6} wrap>
          <Typography.Text strong>{row.productName}</Typography.Text>
          <Typography.Text type="secondary" className="!text-xs">
            {row.journeyL1}
            {row.journeyL2 && row.journeyL2 !== row.journeyL1 ? ` / ${row.journeyL2}` : ''}
          </Typography.Text>
          {(row.problemTypeLabel || row.requestSceneLabel) && (
            <Space size={4}>
              {row.problemTypeLabel ? <Tag className="!m-0 !text-xs">{row.problemTypeLabel}</Tag> : null}
              {row.requestSceneLabel ? <Tag className="!m-0 !text-xs">{row.requestSceneLabel}</Tag> : null}
            </Space>
          )}
        </Space>
      }
    >
      <div className="space-y-4">
        {row.painPointSample ? (
          <Typography.Paragraph type="secondary" className="!mb-0 !text-xs" ellipsis={{ rows: 2, tooltip: row.painPointSample }}>
            痛点样本：{row.painPointSample}
          </Typography.Paragraph>
        ) : null}

        <div className="rounded-lg bg-white p-2">
          <Typography.Text type="secondary" className="mb-1 block text-xs">
            工单量月度趋势（全量 {row.totalTicketCount} 单，{row.firstMonth}~{row.lastMonth}）· 竖线=各举措实施月
          </Typography.Text>
          <TrendChart
            variant="line"
            height={240}
            data={row.monthlyTrend}
            areas={[
              { dataKey: 'count', name: '工单数', stroke: '#4F46E5' },
              { dataKey: 'negative', name: '负向', stroke: '#EF4444' },
            ]}
            referenceLines={referenceLines}
          />
        </div>

        <div>
          <Typography.Text type="secondary" className="mb-2 block text-xs">
            举措时间线（按实施升序）
          </Typography.Text>
          <Space direction="vertical" size={8} className="w-full">
            {row.actions.map((action) => (
              <ActionTimelineRow key={action.actionId} action={action} />
            ))}
          </Space>
        </div>
        <Typography.Text type="secondary" className="block !text-[11px]">
          关联趋势，非因果
        </Typography.Text>
      </div>
    </Card>
  )
}

/**
 * @param {{ action: any }} props
 */
function ActionTimelineRow({ action }) {
  const r = action.reduction
  return (
    <div className="rounded-md border border-ink-100 px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <Typography.Text className="!text-sm">{action.content}</Typography.Text>
        <Tag className="!m-0 !text-xs">{ACTION_ITEM_STATUS_LABELS[action.status] || action.status}</Tag>
      </div>
      <Typography.Text type="secondary" className="!text-xs block">
        实施：{action.scheduleAt || '—'}（{action.anchorMonth || '—'}）
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
          {r ? '数据不足' : '未设排期，无法对比'}
        </Typography.Text>
      )}
    </div>
  )
}
