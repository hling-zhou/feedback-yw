import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Tabs } from 'antd'
import { PageHeader } from './Dashboard.shared.jsx'
import Import from './Import.jsx'
import ImportAnalysis from './ImportAnalysis.jsx'

/** @type {const} */
const TAB_TICKETS = 'tickets'
/** @type {const} */
const TAB_ANALYSIS = 'analysis'

export default function ImportHub() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeKey = searchParams.get('tab') === TAB_ANALYSIS ? TAB_ANALYSIS : TAB_TICKETS

  const items = useMemo(
    () => [
      {
        key: TAB_TICKETS,
        label: '导入工单 Excel',
        children: <Import embedded />,
      },
      {
        key: TAB_ANALYSIS,
        label: '导入分析结果',
        children: <ImportAnalysis />,
      },
    ],
    [],
  )

  return (
    <div>
      <PageHeader
        title="数据导入"
        desc="「导入工单 Excel」用于新增工单入库；「导入分析结果」按工单号覆盖已有分析字段，二者互不相同。"
      />
      <Tabs
        className="page-section"
        activeKey={activeKey}
        onChange={(key) => {
          if (key === TAB_TICKETS) {
            setSearchParams({})
          } else {
            setSearchParams({ tab: key })
          }
        }}
        items={items}
      />
    </div>
  )
}
