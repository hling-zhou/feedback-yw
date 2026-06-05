import { Navigate, useSearchParams } from 'react-router-dom'
import Import from './Import.jsx'

/** @deprecated 旧 Tab 参数，重定向至反馈库或统一导入页 */
const TAB_ANALYSIS = 'analysis'
const TAB_FOLLOW_UP = 'followUp'

export default function ImportHub() {
  const [searchParams] = useSearchParams()
  if (searchParams.get('tab') === TAB_ANALYSIS) {
    return <Navigate to="/feedbacks" replace />
  }
  if (searchParams.get('tab') === TAB_FOLLOW_UP) {
    return (
      <Navigate
        to="/import?source=post_use_rating&subType=satisfaction_callback"
        replace
      />
    )
  }
  return <Import />
}
