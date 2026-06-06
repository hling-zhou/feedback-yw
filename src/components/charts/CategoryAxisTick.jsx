/**
 * 横向条形图左侧类目轴刻度：右对齐，避免被裁切。
 *
 * @param {Object} props
 * @param {number} props.x
 * @param {number} props.y
 * @param {{ value?: string }} props.payload
 */
export default function CategoryAxisTick({ x, y, payload, fontSize = 11 }) {
  return (
    <text
      x={x}
      y={y}
      dy={4}
      textAnchor="end"
      fill="#374151"
      fontSize={fontSize}
    >
      {payload?.value ?? ''}
    </text>
  )
}
