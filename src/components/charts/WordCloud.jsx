/**
 * 轻量词云组件（纯 HTML+CSS，无外部依赖）。
 * 按 value 降序排列，字号映射 12-28px，颜色按频次深浅渐变（高频=深红，低频=浅灰）。
 *
 * @param {{
 *   data: Array<{ text: string, value: number }>
 *   height?: number
 * }} props
 */
export default function WordCloud({ data, height = 240 }) {
  if (!data || data.length === 0) {
    return <div className="word-cloud-empty" style={{ height }}>暂无高频低分原因数据</div>
  }

  const maxValue = Math.max(...data.map((d) => Number(d.value) || 0), 1)
  const minValue = Math.min(...data.map((d) => Number(d.value) || 0), 0)
  const range = maxValue - minValue || 1

  const fontSize = (value) => {
    const ratio = (Number(value) - minValue) / range
    return 12 + Math.round(ratio * 16) // 12px ~ 28px
  }

  const color = (value) => {
    const ratio = (Number(value) - minValue) / range
    // 深红 #DC2626 → 浅灰 #9CA3AF
    if (ratio > 0.66) return '#DC2626'
    if (ratio > 0.33) return '#F59E0B'
    return '#9CA3AF'
  }

  const sorted = [...data]
    .map((d) => ({ ...d, value: Number(d.value) || 0 }))
    .sort((a, b) => b.value - a.value)

  return (
    <div
      className="word-cloud"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '6px 10px',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '8px 4px',
        height,
        overflowY: 'auto',
      }}
    >
      {sorted.map((item, index) => (
        <span
          key={`${item.text}-${index}`}
          style={{
            fontSize: `${fontSize(item.value)}px`,
            color: color(item.value),
            fontWeight: item.value === maxValue ? 700 : 500,
            lineHeight: 1.4,
            whiteSpace: 'nowrap',
          }}
          title={`${item.text}: ${item.value} 次`}
        >
          {item.text}
        </span>
      ))}
    </div>
  )
}
