import { Tag } from 'antd'
import {
  getOptimizationSourceLabel,
  getPainPointSource,
  getCustomerRequestSource,
  getOptimizationSource,
  getTicketAnalysisSourceLabel,
} from '../../lib/ticketAnalysis/ticketAnalysisSources.js'

/**
 * @param {{ source: 'rule' | 'llm' | 'manual'; title?: string }} props
 */
export default function TicketAnalysisSourceTag({ source, title }) {
  const color = source === 'llm' ? 'purple' : source === 'manual' ? 'gold' : 'default'
  const label =
    source === 'manual'
      ? getOptimizationSourceLabel('manual')
      : getTicketAnalysisSourceLabel(source)

  return (
    <Tag color={color} className="!text-[10px] !leading-4" title={title}>
      {label}
    </Tag>
  )
}

/**
 * @param {import('../../lib/types.js').FeedbackRecord} record
 */
export function CustomerRequestSourceTag({ record }) {
  return (
    <TicketAnalysisSourceTag
      source={getCustomerRequestSource(record)}
      title="客户请求内容来源"
    />
  )
}

/**
 * @param {import('../../lib/types.js').FeedbackRecord} record
 */
export function PainPointSourceTag({ record }) {
  return <TicketAnalysisSourceTag source={getPainPointSource(record)} title="需求痛点挖掘来源" />
}

/**
 * @param {import('../../lib/types.js').FeedbackRecord} record
 */
export function OptimizationSourceTag({ record }) {
  return (
    <TicketAnalysisSourceTag
      source={getOptimizationSource(record)}
      title="单条优化建议来源（人工复核优先）"
    />
  )
}
