import { Button, Space } from 'antd'

/**
 * 洞察工作台一级 Tab 样式：小按钮 + 选中 primary / 未选 text。
 *
 * @param {Object} props
 * @param {string} props.activeKey
 * @param {(key: string) => void} props.onChange
 * @param {{ key: string; label: import('react').ReactNode }[]} props.items
 * @param {string} [props.className]
 */
export default function WorkbenchTabNav({ activeKey, onChange, items, className = '' }) {
  return (
    <div className={`border-b border-ink-200 pb-3 ${className}`.trim()}>
      <Space wrap size={[4, 8]} className="min-w-0">
        {items.map((item) => {
          const selected = activeKey === item.key
          return (
            <Button
              key={item.key}
              type={selected ? 'primary' : 'text'}
              size="small"
              onClick={() => onChange(item.key)}
            >
              {item.label}
            </Button>
          )
        })}
      </Space>
    </div>
  )
}
