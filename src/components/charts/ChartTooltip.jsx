import { Tooltip } from 'recharts'
import { CHART_TOOLTIP_CONTENT_STYLE, CHART_TOOLTIP_CURSOR } from './chartConstants.js'

/**
 * 统一 Recharts Tooltip：悬停高亮为浅灰，避免默认 #ccc 过深。
 * displayName 必须为 Tooltip，否则 Recharts 无法挂载 hover 事件。
 *
 * @param {import('recharts').TooltipProps<number, string>} props
 */
function ChartTooltip({ contentStyle, cursor, ...rest }) {
  const resolvedCursor =
    cursor === false
      ? false
      : { ...CHART_TOOLTIP_CURSOR, ...(typeof cursor === 'object' ? cursor : {}) }

  return (
    <Tooltip
      contentStyle={{ ...CHART_TOOLTIP_CONTENT_STYLE, ...contentStyle }}
      cursor={resolvedCursor}
      {...rest}
    />
  )
}

ChartTooltip.displayName = 'Tooltip'
/** Recharts Cursor 读取外层 Tooltip 元素的 cursor，而非内部 Tooltip 子树 */
ChartTooltip.defaultProps = {
  cursor: CHART_TOOLTIP_CURSOR,
}

export default ChartTooltip
