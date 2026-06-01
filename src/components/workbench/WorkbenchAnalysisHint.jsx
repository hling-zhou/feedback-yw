import { Alert } from 'antd'

/**
 * @param {{ sourceLabel?: string; product?: string }} props
 */
function buildHintDescription({ sourceLabel, product }) {
  const cta = '点击页面上方「洞察分析」可进入多维标签下钻。'
  if (sourceLabel && product) {
    return `当前为「${sourceLabel} · ${product}」快照概览。${cta}将自动带上当前来源与产品筛选。`
  }
  if (sourceLabel) {
    return `当前为「${sourceLabel}」快照概览。${cta}将自动带上当前数据来源。`
  }
  return `工作台展示各来源快照概览。${cta}按请求场景、问题类型、用户旅程与情绪聚合分析。`
}

/**
 * 分源 Tab 情境说明（综合概述不再展示；主入口在顶栏）
 * @param {{ sourceLabel?: string; product?: string; className?: string }} props
 */
export default function WorkbenchAnalysisHint({ sourceLabel, product, className = '' }) {
  return (
    <Alert
      className={className}
      type="info"
      showIcon
      title="多维标签下钻"
      description={buildHintDescription({ sourceLabel, product })}
    />
  )
}
