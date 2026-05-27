import { Form, DatePicker, Select, InputNumber } from 'antd'
import dayjs from 'dayjs'
import { PERIOD_GRANULARITIES, PERIOD_GRANULARITY_LABELS } from '../domain/enums.js'
import { buildPeriodSpec } from '../domain/insightPeriod.js'

const GRANULARITY_OPTIONS = PERIOD_GRANULARITIES.map((g) => ({
  value: g,
  label: PERIOD_GRANULARITY_LABELS[g],
}))

const QUARTER_OPTIONS = [1, 2, 3, 4].map((q) => ({ value: q, label: `Q${q}` }))

/**
 * 洞察周期表单：按月 / 按季度 / 按年（与 buildPeriodSpec 联动）
 * @param {import('antd').FormInstance} form
 */
export default function PeriodFormFields({ form }) {
  const granularity = Form.useWatch('granularity', form) ?? 'month'

  return (
    <>
      <Form.Item
        name="granularity"
        label="周期类型"
        rules={[{ required: true, message: '请选择周期类型' }]}
        initialValue="month"
      >
        <Select options={GRANULARITY_OPTIONS} />
      </Form.Item>

      {granularity === 'month' && (
        <Form.Item
          name="monthAnchor"
          label="选择月份"
          rules={[{ required: true, message: '请选择月份' }]}
        >
          <DatePicker picker="month" className="w-full" />
        </Form.Item>
      )}

      {granularity === 'quarter' && (
        <div className="grid grid-cols-2 gap-4">
          <Form.Item
            name="year"
            label="年份"
            rules={[{ required: true, message: '请输入年份' }]}
          >
            <InputNumber className="w-full" min={2000} max={2100} />
          </Form.Item>
          <Form.Item
            name="quarter"
            label="季度"
            rules={[{ required: true, message: '请选择季度' }]}
          >
            <Select options={QUARTER_OPTIONS} />
          </Form.Item>
        </div>
      )}

      {granularity === 'year' && (
        <Form.Item
          name="yearAnchor"
          label="选择年份"
          rules={[{ required: true, message: '请选择年份' }]}
        >
          <DatePicker picker="year" className="w-full" />
        </Form.Item>
      )}
    </>
  )
}

/**
 * 从表单值生成 buildPeriodSpec 参数
 * @param {Record<string, unknown>} values
 */
export function periodSpecFromFormValues(values) {
  const granularity = values.granularity
  if (granularity === 'month') {
    const d = dayjs(values.monthAnchor)
    return buildPeriodSpec({
      granularity: 'month',
      year: d.year(),
      month: d.month() + 1,
    })
  }
  if (granularity === 'quarter') {
    return buildPeriodSpec({
      granularity: 'quarter',
      year: Number(values.year),
      quarter: Number(values.quarter),
    })
  }
  if (granularity === 'year') {
    const d = dayjs(values.yearAnchor)
    return buildPeriodSpec({ granularity: 'year', year: d.year() })
  }
  throw new Error('无效的周期类型')
}

/**
 * 用周期规格填充表单
 * @param {import('antd').FormInstance} form
 * @param {ReturnType<typeof buildPeriodSpec>} spec
 */
export function setPeriodFormFromSpec(form, spec) {
  form.setFieldsValue({
    granularity: spec.granularity,
    monthAnchor: spec.granularity === 'month' ? dayjs(`${spec.anchorYear}-${spec.anchorMonth}-01`) : undefined,
    year: spec.anchorYear,
    quarter: spec.anchorQuarter,
    yearAnchor: spec.granularity === 'year' ? dayjs(`${spec.anchorYear}-01-01`) : undefined,
  })
}
