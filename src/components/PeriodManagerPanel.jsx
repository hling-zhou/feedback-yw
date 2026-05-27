import { Alert, Typography } from 'antd'
import InsightPeriodPicker from './InsightPeriodPicker.jsx'

/** 设置页：洞察周期仅通过月/季/年选择器切换 */
export default function PeriodManagerPanel() {
  return (
    <div>
      <Typography.Text type="secondary" className="mb-4 block text-xs">
        选择粒度后点选具体月份、季度或年份即可；系统按<strong>数据时间</strong>（导入时的数据月份）自动汇总，无需新建或填写周期名称。
      </Typography.Text>
      <InsightPeriodPicker />
      <Alert
        className="mt-4"
        type="info"
        showIcon
        title="同一份导入数据可在不同周期视图下复用"
        description="例如 2025年5月导入的工单，在「2025年5月」「2025年Q2」「2025年」洞察周期中都会出现。"
      />
    </div>
  )
}
