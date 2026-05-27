import { PageHeader } from '../../pages/Dashboard.shared.jsx'
import WorkbenchBreadcrumb from './WorkbenchBreadcrumb.jsx'

/**
 * 洞察分析二级页顶栏：面包屑 + 标题
 * @param {{ desc?: import('react').ReactNode }} props
 */
export default function AnalysisPageHeader({ desc }) {
  return (
    <>
      <WorkbenchBreadcrumb />
      <div className="mt-4">
        <PageHeader title="洞察分析" desc={desc} />
      </div>
    </>
  )
}
