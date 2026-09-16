import { Tag, Typography } from 'antd'
import {
  CheckCircleOutlined,
  ExclamationCircleOutlined,
  StopOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons'

/** @typedef {import('../../domain/overviewConclusions.js').ActionRecsResult} ActionRecsResult */

const TIER_CONFIG = {
  structural: { label: '持续高频', color: '#f5222d', borderClass: 'border-l-4 border-l-red-500 bg-red-50/30' },
  change:     { label: '环比突增',   color: '#fa8c16', borderClass: 'border-l-4 border-l-orange-400 bg-orange-50/20' },
  sharp:      { label: '少数高发',     color: '#fa541c', borderClass: 'border-l-4 border-l-orange-500 bg-orange-50/20' },
  iteration:  { label: '常规优化',   color: '#1677ff', borderClass: 'border-l-4 border-l-blue-300 bg-blue-50/20' },
  tail:       { label: '零散长尾',   color: '#8c8c8c', borderClass: 'border-l-4 border-l-gray-300 bg-gray-50/30' },
  unloc:      { label: '未定位',     color: '#d9d9d9', borderClass: 'border-l-4 border-l-gray-200' },
  cross:     { label: '共性关注',   color: '#722ed1', borderClass: 'border-l-4 border-l-purple-400 bg-purple-50/20' },
  crossCut:  { label: '共性关注',   color: '#722ed1', borderClass: 'border-l-4 border-l-purple-400 bg-purple-50/20' },
}

const INVENTORY_CONFIG = {
  open:    { label: '纳入优化·进行中', color: '#52c41a', icon: <ExclamationCircleOutlined /> },
  done:    { label: '纳入优化·已完成', color: '#52c41a', icon: <CheckCircleOutlined /> },
  stopped: { label: '纳入优化·已停止', color: '#bfbfbf', icon: <StopOutlined /> },
  none:    { label: '未纳入·盲区',     color: '#ff4d4f', icon: <MinusCircleOutlined /> },
}

/**
 * @param {Object} props
 * @param {ActionRecsResult} props.rec
 * @param {(rec: ActionRecsResult) => void} [props.onClick]
 */
export default function ProblemCard({ rec, onClick }) {
  const tier = TIER_CONFIG[rec.tier] || TIER_CONFIG.iteration
  const inv = INVENTORY_CONFIG[rec.inventoryStatus] || INVENTORY_CONFIG.none
  const scale = rec.scale || {}

  const problemSummary = rec.problemSummary || {}
  const customerVoice = rec.customerVoice || {}

  return (
    <div className={`page-card-sm cursor-pointer transition-shadow hover:shadow-md ${tier.borderClass}`} onClick={() => onClick?.(rec)}>
      {/* 第一行：标题 + tier 标签 */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <Typography.Text strong className="text-sm">
          {rec.summary || rec.scope?.product || '—'}
        </Typography.Text>
        <Tag color={tier.color} className="!m-0 !text-xs">
          {tier.label}
        </Tag>
      </div>

      {/* 第二行：问题概述（定性描述） */}
      {(problemSummary.pain || problemSummary.root) && (
        <div className="mb-2 space-y-0.5">
          {problemSummary.pain && (
            <div className="text-xs text-gray-600">
              <span className="text-gray-400 mr-1">[痛点]</span>
              {problemSummary.pain}
            </div>
          )}
          {problemSummary.root && (
            <div className="text-xs text-gray-500">
              <span className="text-gray-400 mr-1">[根因]</span>
              {problemSummary.root}
            </div>
          )}
        </div>
      )}

      {/* 第三行：规模情况 */}
      <div className="flex items-center gap-3 text-xs text-gray-500 mb-2">
        <span>{scale.ticketCount || 0}单</span>
        {scale.moMPct !== undefined && scale.moMPct !== null ? (
          <span className={scale.moMPct > 0 ? 'text-red-500' : 'text-green-500'}>
            环比 {scale.moMPct > 0 ? '+' : ''}{scale.moMPct}%
          </span>
        ) : (
          <span className="text-gray-400">环比 —</span>
        )}
        <span>投诉率 {Number(scale.complaintRate || 0).toFixed(0)}%</span>
        <span>
          ({scale.complaintCount || 0}投诉/{scale.consultationCount || 0}咨询)
        </span>
        {scale.urgentRate > 0 && (
          <span className="text-red-500">加急 {Number(scale.urgentRate).toFixed(0)}%</span>
        )}
      </div>

      {/* 第四行：建议文本 */}
      {rec.recommendation && (
        <Typography.Paragraph className="!mb-2 text-xs text-gray-700" ellipsis={{ rows: 2 }}>
          {rec.recommendation}
        </Typography.Paragraph>
      )}

      {/* 第五行：纳入优化徽章 */}
      <div className="flex items-center gap-1">
        <Tag color={inv.color} icon={inv.icon} className="!m-0 !text-xs !border-0">
          {inv.label}
        </Tag>
        {rec.inventoryActions?.length > 0 && (
          <Typography.Text type="secondary" className="text-xs">
            {rec.inventoryActions.length} 项举措
          </Typography.Text>
        )}
      </div>
    </div>
  )
}
