import { useMemo, useState } from 'react'
import { Select, Space, Button, Dropdown, Empty, Typography, Alert, Segmented, Tooltip } from 'antd'
import { DownloadOutlined, ExportOutlined, WarningOutlined, AppstoreOutlined, TableOutlined } from '@ant-design/icons'
import ProblemCard from './ProblemCard.jsx'
import ProblemDetailDrawer from './ProblemDetailDrawer.jsx'
import GateDetailDrawer from './GateDetailDrawer.jsx'
import CrossProductCompare from './CrossProductCompare.jsx'
import WorkbenchTabNav from './WorkbenchTabNav.jsx'
import { useActionRecommendations } from '../../lib/useActionRecommendations.js'
import { exportActionRecsMd } from '../../lib/actionReportMd.js'
import { exportActionRecsXlsx } from '../../lib/actionReportExcel.js'

/** @typedef {import('../../domain/overviewConclusions.js').ActionRecsResult} ActionRecsResult */

const TIER_ORDER = ['structural', 'change', 'sharp', 'iteration', 'tail', 'cross']
const TIER_LABELS = {
  structural: '持续高频',
  change: '环比突增',
  sharp: '少数高发',
  iteration: '常规优化',
  tail: '零散长尾',
  cross: '共性关注',
}

/** hover tooltip 文案：判定条件说明 */
const TIER_TOOLTIPS = {
  structural: '样本量 ≥ S（S = max(10, 10%×总量）），即持续高频的老问题',
  change: '环比变化绝对值 ≥ Δ（Δ = clamp(5%×总量, 3~12)）且环比百分比 ≥ 50%，即本月突然增多或骤减',
  sharp: '不属于以上两层，集中度 ≥ H（H = clamp(1.5×基线, 17~100)）且样本 ≥ 3，即量不大但高度集中',
  iteration: '不属于以上，样本量 ≥ L（L = clamp(1%×总量, 3~10)），即有一定量但不算高频',
  tail: '样本量 < L，即零散问题',
  cross: '跨多个产品出现的共性关注项',
}

/**
 * 行动建议面板 — 三 tab 共用组件。
 *
 * @param {Object} props
 * @param {'all' | 'complaint_ticket' | 'consultation_ticket'} [props.sourceFilter='all']
 * @param {Object} props.snapshot - 概览快照或 source 快照
 * @param {import('../../lib/types.js').FeedbackRecord[]} [props.records=[]] - 用于详情抽屉工单展示
 * @param {boolean} [props.showEffectTable=false] - 投诉/咨询 tab 专用
 * @param {string} [props.productId=null] - 产品筛选
 * @param {(record: import('../../lib/types.js').FeedbackRecord) => void} [props.onOpenFeedback] - 点击工单号叠加工单详情抽屉
 */
export default function ActionRecsPanel({
  sourceFilter = 'all',
  snapshot,
  records = [],
  showEffectTable = false,
  productId = null,
  onOpenFeedback,
}) {
  const { recs, gateReport } = useActionRecommendations({ sourceFilter, snapshot })
  const [selectedRec, setSelectedRec] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [gateDrawerOpen, setGateDrawerOpen] = useState(false)
  const [productFilter, setProductFilter] = useState(productId || 'all')
  const [viewMode, setViewMode] = useState('cards') // 'cards' | 'cross'

  // 产品筛选
  const filteredRecs = useMemo(() => {
    if (productFilter === 'all') return recs
    return recs.filter((r) => r.scope?.product === productFilter)
  }, [recs, productFilter])

  // 按 tier 分组
  const tierGroups = useMemo(() => {
    const groups = {}
    for (const tier of TIER_ORDER) groups[tier] = []
    for (const rec of filteredRecs) {
      const tier = rec.tier || 'tail'
      if (!groups[tier]) groups[tier] = []
      groups[tier].push(rec)
    }
    return groups
  }, [filteredRecs])

  // 有数据的 tier tab 列表
  const tierItems = useMemo(() => {
    return TIER_ORDER
      .filter((tier) => (tierGroups[tier] || []).length > 0)
      .map((tier) => ({
        key: tier,
        label: (
          <Tooltip title={TIER_TOOLTIPS[tier] || ''} placement="bottom">
            <span>{`${TIER_LABELS[tier] || tier} (${tierGroups[tier].length})`}</span>
          </Tooltip>
        ),
      }))
  }, [tierGroups])

  // 当前选中 tier（默认第一个有数据的）
  const [activeTier, setActiveTier] = useState(null)
  const currentTier = activeTier && tierGroups[activeTier] ? activeTier : tierItems[0]?.key
  const currentRecs = currentTier ? (tierGroups[currentTier] || []) : []

  // 产品选项
  const productOptions = useMemo(() => {
    const products = [...new Set(recs.map((r) => r.scope?.product).filter(Boolean))]
    return [{ label: '全部产品', value: 'all' }, ...products.map((p) => ({ label: p, value: p }))]
  }, [recs])

  const handleCardClick = (rec) => {
    setSelectedRec(rec)
    setDrawerOpen(true)
  }

  const handleExport = (format) => {
    if (format === 'md') {
      const md = exportActionRecsMd(filteredRecs, gateReport)
      const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `行动建议-${new Date().toISOString().slice(0, 10)}.md`
      a.click()
      URL.revokeObjectURL(url)
    } else if (format === 'excel') {
      exportActionRecsXlsx(filteredRecs, `行动建议-${new Date().toISOString().slice(0, 10)}`)
    }
  }

  const hasRecs = filteredRecs.length > 0

  return (
    <div>
      {/* 门禁提示 */}
      {gateReport?.escalated && (
        <Alert
          type="warning"
          showIcon
          message={`三方闭环 ${gateReport.rounds} 轮未通过门禁，已升级人工复核`}
          action={
            <Button size="small" icon={<WarningOutlined />} onClick={() => setGateDrawerOpen(true)}>
              查看详情
            </Button>
          }
          description={`${gateReport.failureCount} 项检查未通过，点击"查看详情"查看具体原因、涉及工单及人工复核指引`}
          className="!mb-3"
        />
      )}

      <div className="page-card">
        {/* 工具栏 */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <Space>
            <Select
              size="small"
              value={productFilter}
              onChange={setProductFilter}
              options={productOptions}
              style={{ width: 180 }}
              placeholder="选择产品"
            />
            {gateReport && (
              <Typography.Text type="secondary" className="text-xs">
                闭环 {gateReport.rounds} 轮 · {gateReport.passed ? '通过' : '未通过'}
                {gateReport.escalated ? ' · 待人工复核' : ''}
              </Typography.Text>
            )}
          </Space>
          <Space size="small">
            <Segmented
              size="small"
              value={viewMode}
              onChange={(v) => setViewMode(v)}
              options={[
                { label: '卡片', value: 'cards', icon: <AppstoreOutlined /> },
                { label: '跨产品对比', value: 'cross', icon: <TableOutlined /> },
              ]}
            />
            <Dropdown
              menu={{
                items: [
                  { key: 'md', label: '导出 Markdown', icon: <DownloadOutlined /> },
                  { key: 'excel', label: '导出 Excel', icon: <ExportOutlined /> },
                ],
                onClick: ({ key }) => handleExport(key),
              }}
            >
              <Button size="small" icon={<DownloadOutlined />}>导出</Button>
            </Dropdown>
          </Space>
        </div>

        {/* 内容区：卡片视图 or 跨产品对比 */}
        {viewMode === 'cross' ? (
          <CrossProductCompare
            recs={filteredRecs}
            records={records}
            onOpenFeedback={onOpenFeedback}
          />
        ) : hasRecs ? (
          <>
            <WorkbenchTabNav
              className="mb-4"
              activeKey={currentTier || ''}
              onChange={setActiveTier}
              items={tierItems}
            />
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {currentRecs.map((rec) => (
                <ProblemCard key={rec.id} rec={rec} onClick={handleCardClick} />
              ))}
            </div>
          </>
        ) : (
          <Empty description="本周期无可展示的行动建议" />
        )}
      </div>

      {/* 详情抽屉 */}
      <ProblemDetailDrawer
        rec={selectedRec}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        records={records}
        showEffectTable={showEffectTable}
        onOpenFeedback={onOpenFeedback}
      />

      {/* 门禁详情抽屉 */}
      <GateDetailDrawer
        gateReport={gateReport}
        open={gateDrawerOpen}
        onClose={() => setGateDrawerOpen(false)}
        records={records}
        onOpenFeedback={onOpenFeedback}
      />
    </div>
  )
}
