import { LabelList } from 'recharts'

/** 柱状图/条形图默认在条末端显示数值 */
export const BAR_VALUE_LABEL_PROPS = {
  fill: '#374151',
  fontSize: 11,
  fontWeight: 600,
}

/** @deprecated 请用 barChartRightMargin(data) 按数据动态计算 */
export const BAR_CHART_LABEL_MARGIN_RIGHT = 36

/**
 * @param {Object} props
 * @param {string} [props.dataKey]
 * @param {'vertical' | 'horizontal'} [props.layout] recharts BarChart layout；vertical=横向条形图
 * @param {(value: number, entry: object) => string} [props.formatLabel]
 */
export default function BarCountLabel({
  dataKey = 'count',
  layout = 'vertical',
  formatLabel,
}) {
  return (
    <LabelList
      dataKey={dataKey}
      position={layout === 'vertical' ? 'right' : 'top'}
      offset={6}
      {...BAR_VALUE_LABEL_PROPS}
      formatter={(value, _name, entry) => {
        const num = Number(value)
        if (!Number.isFinite(num) || num === 0) return ''
        if (formatLabel) return formatLabel(num, entry)
        return String(num)
      }}
    />
  )
}
