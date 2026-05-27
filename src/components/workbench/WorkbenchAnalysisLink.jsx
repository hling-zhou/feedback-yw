import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { BarChartOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'
import { buildWorkbenchAnalysisUrl } from '../../lib/workbenchAnalysisLink.js'

const ANALYSIS_TOOLTIP = '按请求场景、问题类型、用户旅程与情绪聚合下钻'

/**
 * 工作台 → 洞察分析入口（顶栏主按钮）
 * @param {{
 *   source?: string
 *   product?: string
 *   size?: 'small' | 'middle' | 'large'
 *   showArrow?: boolean
 *   block?: boolean
 * }} props
 */
export default function WorkbenchAnalysisLink({
  source,
  product,
  size = 'middle',
  showArrow = true,
  block = false,
}) {
  const url = useMemo(
    () => buildWorkbenchAnalysisUrl({ source, product }),
    [source, product],
  )

  return (
    <Tooltip title={ANALYSIS_TOOLTIP}>
      <Link to={url} className={block ? 'block' : undefined}>
        <Button type="primary" icon={<BarChartOutlined />} size={size} block={block}>
          洞察分析{showArrow ? ' →' : ''}
        </Button>
      </Link>
    </Tooltip>
  )
}
