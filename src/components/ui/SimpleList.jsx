/**
 * 轻量列表（替代已弃用的 antd List）
 * @param {Object} props
 * @param {unknown[]} [props.dataSource]
 * @param {(item: unknown, index: number) => import('react').ReactNode} props.renderItem
 * @param {'small' | 'default'} [props.size]
 * @param {string} [props.className]
 */
export default function SimpleList({
  dataSource = [],
  renderItem,
  size = 'default',
  className = '',
}) {
  const itemPad = size === 'small' ? 'py-2' : 'py-3'
  return (
    <div className={`flex flex-col divide-y divide-ink-100 ${className}`.trim()}>
      {dataSource.map((item, index) => (
        <div key={index} className={itemPad}>
          {renderItem(item, index)}
        </div>
      ))}
    </div>
  )
}
