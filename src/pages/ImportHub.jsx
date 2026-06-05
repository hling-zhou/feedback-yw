import { Navigate, useSearchParams } from 'react-router-dom'
import { Tabs } from 'antd'
import { PageHeader } from './Dashboard.shared.jsx'
import Import from './Import.jsx'
import FollowUpSatisfactionImportPanel from '../components/import/FollowUpSatisfactionImportPanel.jsx'

/** @deprecated 旧 Tab 参数，重定向至反馈库 */
const TAB_ANALYSIS = 'analysis'
const TAB_FOLLOW_UP = 'followUp'

export default function ImportHub() {
  const [searchParams, setSearchParams] = useSearchParams()
  if (searchParams.get('tab') === TAB_ANALYSIS) {
    return <Navigate to="/feedbacks" replace />
  }

  const activeTab = searchParams.get('tab') === TAB_FOLLOW_UP ? TAB_FOLLOW_UP : 'feedback'

  return (
    <div>
      <PageHeader
        title="数据导入"
        desc="反馈数据入库与打标；满意度回访记录按原工单号补全投诉/咨询工单；分析结果回写请使用反馈库「导入分析结果」。"
      />
      <Tabs
        activeKey={activeTab}
        onChange={(key) => {
          if (key === 'feedback') {
            setSearchParams({})
          } else {
            setSearchParams({ tab: key })
          }
        }}
        items={[
          {
            key: 'feedback',
            label: '反馈数据导入',
            children: <Import embedded />,
          },
          {
            key: TAB_FOLLOW_UP,
            label: '满意度回访导入',
            children: <FollowUpSatisfactionImportPanel />,
          },
        ]}
      />
    </div>
  )
}
