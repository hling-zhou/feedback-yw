import { useMemo, useState } from 'react'
import { Select, Space, Button, Dropdown, Empty, Typography, Alert } from 'antd'
import { DownloadOutlined, ExportOutlined } from '@ant-design/icons'
import ProblemCard from './ProblemCard.jsx'
import ProblemDetailDrawer from './ProblemDetailDrawer.jsx'
import WorkbenchTabNav from './WorkbenchTabNav.jsx'
import { useActionRecommendations } from '../../lib/useActionRecommendations.js'
import { exportActionRecsMd } from '../../lib/actionReportMd.js'
import { exportActionRecsXlsx } from '../../lib/actionReportExcel.js'

/** @typedef {import('../../domain/overviewConclusions.js').ActionRecsResult} ActionRecsResult */

const TIER_ORDER = ['structural', 'change', 'sharp', 'iteration', 'tail', 'cross']
const TIER_LABELS = {
  structural: '长期结构性',
  change: '本月异动',
  sharp: '小而锐',
  iteration: '常规迭代',
  tail: '平稳长尾',
  cross: '横切关注',
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
  const [productFilter, setProductFilter] = useState(productId || 'all')

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
        label: `${TIER_LABELS[tier] || tier} (${tierGroups[tier].length})`,
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
          description={gateReport.failures?.join('；')}
          className="!mb-3"
          banner
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
        </div>

        {/* 族分类 Tab + 卡片 */}
        {hasRecs ? (
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
    </div>
  )
}
