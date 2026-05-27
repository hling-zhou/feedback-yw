import { Link } from 'react-router-dom'
import { Breadcrumb } from 'antd'
import { WORKBENCH_HOME } from './WorkbenchAnalysisNav.jsx'

/**
 * 洞察工作台二级页面包屑（返回一级，不带 tab/周期控件）
 * @param {{ current?: string }} props
 */
export default function WorkbenchBreadcrumb({ current = '洞察分析' }) {
  return (
    <Breadcrumb
      items={[
        { title: <Link to={WORKBENCH_HOME}>洞察工作台</Link> },
        { title: current },
      ]}
    />
  )
}
