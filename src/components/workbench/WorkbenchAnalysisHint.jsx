import { Alert } from 'antd'
import { Link } from 'react-router-dom'

/**
 * @param {{ sourceLabel?: string; product?: string; recommendationCount?: number; planningAnchor?: string }} props
 */
function buildHintDescription({ sourceLabel, product, recommendationCount, planningAnchor }) {
  const cta = '点击页面上方「洞察分析」可进入多维标签下钻。'
  if (sourceLabel && product) {
    return `当前为「${sourceLabel} · ${product}」快照概览。${cta}将自动带上当前来源与产品筛选。`
  }
  if (sourceLabel) {
    return `当前为「${sourceLabel}」快照概览。${cta}将自动带上当前数据来源。`
  }
  if (recommendationCount && recommendationCount > 0 && planningAnchor) {
    return (
      <>
        本期已生成 {recommendationCount} 条行动建议，可先查看
        <Link to={planningAnchor} className="mx-1">
          产品规划参考
        </Link>
        再下钻分析。{cta}
      </>
    )
  }
  return `工作台展示各来源快照概览。${cta}按请求场景、问题类型、用户旅程与情绪聚合分析。`
}

/**
 * 内容区情境说明（主入口在顶栏，此处不再重复按钮）
 * @param {{ sourceLabel?: string; product?: string; className?: string; recommendationCount?: number; planningAnchor?: string }} props
 */
export default function WorkbenchAnalysisHint({
  sourceLabel,
  product,
  className = '',
  recommendationCount,
  planningAnchor,
}) {
  return (
    <Alert
      className={className}
      type="info"
      showIcon
      title={recommendationCount ? '规划建议与下钻分析' : '多维标签下钻'}
      description={buildHintDescription({
        sourceLabel,
        product,
        recommendationCount,
        planningAnchor,
      })}
    />
  )
}
