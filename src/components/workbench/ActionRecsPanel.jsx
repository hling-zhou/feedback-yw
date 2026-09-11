import { useMemo, useState } from 'react'
import { Card, Segmented, Select, Space, Button, Dropdown, Empty, Typography, Alert } from 'antd'
import { DownloadOutlined, ExportOutlined } from '@ant-design/icons'
import ActionTierSection from './ActionTierSection.jsx'
import ProblemDetailDrawer from './ProblemDetailDrawer.jsx'
import { useActionRecommendations } from '../../lib/useActionRecommendations.js'
import { exportActionRecsMd } from '../../lib/actionReportMd.js'
import { exportActionRecsXlsx } from '../../lib/actionReportExcel.js'

/** @typedef {import('../../domain/overviewConclusions.js').ActionRecsResult} ActionRecsResult */

const TIER_ORDER = ['structural', 'change', 'sharp', 'iteration', 'tail', 'cross']
const TIER_DEFAULT_OPEN = { structural: true, change: true, sharp: true, iteration: false, tail: false, cross: true }

/**
 * 行动建议面板 — 三 tab 共用组件。
 *
 * @param {Object} props
 * @param {'all' | 'complaint_ticket' | 'consultation_ticket'} [props.sourceFilter='all']
 * @param {Object} props.snapshot - 概览快照或 source 快照
 * @param {import('../../lib/types.js').FeedbackRecord[]} [props.records=[]] - 用于详情抽屉工单展示
 * @param {boolean} [props.showEffectTable=false] - 投诉/咨询 tab 专用
 * @param {string} [props.productId=null] - 产品筛选
 */
export default function ActionRecsPanel({
  sourceFilter = 'all',
  snapshot,
  records = [],
  showEffectTable = false,
  productId = null,
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

      {/* 分层卡片 */}
      {hasRecs ? (
        TIER_ORDER.map((tier) => (
          <ActionTierSection
            key={tier}
            tier={tier}
            recs={tierGroups[tier] || []}
            onCardClick={handleCardClick}
            defaultOpen={TIER_DEFAULT_OPEN[tier]}
          />
        ))
      ) : (
        <Empty description="本周期无可展示的行动建议" />
      )}

      {/* 详情抽屉 */}
      <ProblemDetailDrawer
        rec={selectedRec}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        records={records}
        showEffectTable={showEffectTable}
      />
    </div>
  )
}
