import { DatePicker } from 'antd'
import dayjs from 'dayjs'
import { normalizeImportMonth } from '../lib/importUtils.js'

/**
 * 与洞察工作台「月粒度 → 选择月份」一致的月份选择器（Ant Design DatePicker month）
 * @param {{
 *   value?: string | null
 *   onChange?: (value: string) => void
 *   disabled?: boolean
 *   className?: string
 * }} props
 */
export default function InsightMonthPicker({ value, onChange, disabled, className }) {
  const normalized = normalizeImportMonth(value)
  const pickerValue = normalized ? dayjs(`${normalized}-01`) : null

  return (
    <DatePicker
      picker="month"
      className={className}
      disabled={disabled}
      value={pickerValue}
      onChange={(d) => {
        if (!d) return
        onChange?.(`${d.year()}-${String(d.month() + 1).padStart(2, '0')}`)
      }}
    />
  )
}
