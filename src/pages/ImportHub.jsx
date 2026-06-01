import { Navigate, useSearchParams } from 'react-router-dom'
import { PageHeader } from './Dashboard.shared.jsx'
import Import from './Import.jsx'

/** @deprecated 旧 Tab 参数，重定向至反馈库 */
const TAB_ANALYSIS = 'analysis'

export default function ImportHub() {
  const [searchParams] = useSearchParams()
  if (searchParams.get('tab') === TAB_ANALYSIS) {
    return <Navigate to="/feedbacks" replace />
  }

  return (
    <div>
      <PageHeader
        title="导入工单"
        desc="选择数据来源与数据月份，将工单 Excel 入库并自动打标；分析结果回写请使用反馈库「导入分析结果」。"
      />
      <Import embedded />
    </div>
  )
}
