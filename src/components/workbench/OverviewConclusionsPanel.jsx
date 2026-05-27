import { useState } from 'react'
import { Alert, Button, Card, Collapse, Space, Tag, Typography } from 'antd'
import { BulbOutlined, ThunderboltOutlined, WarningOutlined } from '@ant-design/icons'
import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import { useInsights } from '../../context/InsightsContext.jsx'
import { canUseSemanticMatch } from '../../lib/themeSemantic.js'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import SimpleList from '../ui/SimpleList.jsx'
import RebuildInsightsButton from './RebuildInsightsButton.jsx'
import {
  OVERVIEW_EXECUTIVE_SUMMARY_TITLE,
  OVERVIEW_INSIGHTS_PANEL_TITLE,
} from '../../domain/overviewConclusions.js'

/** @typedef {import('../../domain/overviewConclusions.js').OverviewConclusions} OverviewConclusions */
/** @typedef {import('../../domain/overviewConclusions.js').OverviewConclusionHighlight} OverviewConclusionHighlight */
/** @typedef {import('../../domain/enums.js').DataSourceType} DataSourceType */

const HIGHLIGHT_TYPE_LABELS = {
  cross_source: '跨源对比',
  product: '产品与投诉',
  problem_type: '问题类型',
  journey: '用户旅程',
  risk: '风险信号',
}

/**
 * @param {Object} props
 * @param {OverviewConclusions | null | undefined} props.conclusions
 * @param {import('../../domain/snapshot.js').SnapshotStatus} [props.snapshotStatus]
 * @param {(source: DataSourceType) => void} [props.onSourceTab]
 * @param {() => void} [props.onRebuild]
 * @param {boolean} [props.rebuilding]
 * @param {boolean} [props.rebuildDisabled]
 */
export default function OverviewConclusionsPanel({
  conclusions,
  snapshotStatus,
  onSourceTab,
  onRebuild,
  rebuilding,
  rebuildDisabled,
}) {
  const { settings, polishOverviewConclusions } = useInsights()
  const message = useAppMessage()
  const [polishing, setPolishing] = useState(false)
  const canPolish = canUseSemanticMatch(settings)

  if (!conclusions) {
    return (
      <Card title={OVERVIEW_INSIGHTS_PANEL_TITLE} className="border-dashed">
        <Typography.Text type="secondary">
          当前快照尚无{OVERVIEW_INSIGHTS_PANEL_TITLE}。请点击上方「生成 / 刷新洞察」重新构建快照。
        </Typography.Text>
        {onRebuild && (
          <RebuildInsightsButton
            className="mt-3"
            size="small"
            loading={rebuilding}
            disabled={rebuildDisabled}
            onClick={onRebuild}
          >
            生成洞察快照
          </RebuildInsightsButton>
        )}
      </Card>
    )
  }

  const collapseItems = groupHighlights(conclusions.highlights).map(([type, items]) => ({
    key: type,
    label: (
      <span>
        {HIGHLIGHT_TYPE_LABELS[type] || type}
        <Tag className="ml-2">{items.length}</Tag>
      </span>
    ),
    children: (
      <SimpleList
        size="small"
        dataSource={items}
        renderItem={(item) => (
          <div className="flex justify-between gap-2">
            <div className="min-w-0 flex-1">
              <Typography.Text strong className="block">
                {item.title}
              </Typography.Text>
              <div className="mt-1 space-y-1">
                <Typography.Paragraph className="!mb-0 text-sm">{item.body}</Typography.Paragraph>
                {item.metrics?.length > 0 && (
                  <Space wrap size={[4, 4]}>
                    {item.metrics.map((m) => (
                      <Tag key={`${item.id}-${m.label}`}>
                        {m.label}: {m.value}
                      </Tag>
                    ))}
                  </Space>
                )}
                {item.sources?.length > 0 && (
                  <Typography.Text type="secondary" className="text-xs">
                    数据来源：
                    {item.sources.map((s) => DATA_SOURCE_LABELS[s] || s).join('、')}
                  </Typography.Text>
                )}
              </div>
            </div>
            {item.drillTab && onSourceTab && (
              <Button type="link" size="small" onClick={() => onSourceTab(item.drillTab)}>
                查看来源
              </Button>
            )}
          </div>
        )}
      />
    ),
  }))

  return (
    <Card
      title={
        <Space>
          <BulbOutlined />
          <span>{OVERVIEW_INSIGHTS_PANEL_TITLE}</span>
          <Tag color={conclusions.source === 'hybrid' ? 'purple' : 'blue'}>
            {conclusions.source === 'hybrid' ? '规则 + LLM' : '规则聚合'}
          </Tag>
          {snapshotStatus === 'stale' && <Tag color="orange">快照待更新</Tag>}
        </Space>
      }
      extra={
        <Space wrap>
          {!conclusions.insufficientData && (
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              loading={polishing}
              disabled={!canPolish}
              onClick={async () => {
                setPolishing(true)
                try {
                  await polishOverviewConclusions()
                  message.success(`已用 LLM 润色${OVERVIEW_INSIGHTS_PANEL_TITLE}并保存到快照`)
                } catch (e) {
                  message.error(e.message || '润色失败')
                } finally {
                  setPolishing(false)
                }
              }}
            >
              LLM 润色
            </Button>
          )}
          <Typography.Text type="secondary" className="text-xs">
            {conclusions.periodLabel} · 工单样本 {conclusions.sampleSize} 条 ·{' '}
            {conclusions.generatedAt?.slice(0, 16).replace('T', ' ')}
          </Typography.Text>
        </Space>
      }
    >
      {snapshotStatus === 'stale' && (
        <Alert
          className="mb-4"
          type="warning"
          showIcon
          title="周期洞察可能已过期"
          description="数据或标签已变更，请重新生成洞察快照以更新周期洞察概览。"
        />
      )}

      {!canPolish && !conclusions.insufficientData && (
        <Alert
          className="mb-3"
          type="info"
          showIcon
          title="服务端配置 LLM_API_KEY 后可使用「LLM 润色」，或开启「刷新快照时自动润色」"
        />
      )}

      <Typography.Text type="secondary" className="mb-3 block text-xs">
        以下为行动建议的数据依据与背景解读。
      </Typography.Text>

      <Alert
        type={conclusions.insufficientData ? 'warning' : 'info'}
        showIcon
        icon={conclusions.insufficientData ? <WarningOutlined /> : <BulbOutlined />}
        title={OVERVIEW_EXECUTIVE_SUMMARY_TITLE}
        description={conclusions.executiveSummary}
      />

      {conclusions.source === 'hybrid' && conclusions.ruleExecutiveSummary && (
        <Typography.Text type="secondary" className="mt-2 block text-xs">
          规则版摘要：{conclusions.ruleExecutiveSummary}
        </Typography.Text>
      )}

      {conclusions.dataCoverageNotes?.length > 0 && (
        <ul className="mb-4 mt-3 list-disc pl-5 text-xs text-gray-500">
          {conclusions.dataCoverageNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}

      {collapseItems.length > 0 && (
        <Collapse
          className="mb-0"
          items={collapseItems}
        />
      )}
    </Card>
  )
}

/**
 * @param {OverviewConclusionHighlight[]} [highlights]
 */
function groupHighlights(highlights) {
  /** @type {Map<string, OverviewConclusionHighlight[]>} */
  const map = new Map()
  for (const h of highlights || []) {
    const type = h.type || 'other'
    if (!map.has(type)) map.set(type, [])
    map.get(type).push(h)
  }
  return [...map.entries()]
}
