import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Modal } from 'antd'
import { useInsights } from '../context/InsightsContext.jsx'
import {
  clearRetagSessionMarker,
  formatBulkRetagScopeLabel,
  formatInterruptedRetagMessage,
  readRetagSessionMarker,
} from '../lib/retagSession.js'
import {
  formatTaggingProgressDescription,
  TAGGING_IN_PROGRESS_TITLE,
  TAGGING_TASK_LEAVE_HINT,
} from '../lib/taggingTaskUI.js'

export default function RetagSessionGuard() {
  const navigate = useNavigate()
  const location = useLocation()
  const { retagSession } = useInsights()
  const onFeedbacksPage = location.pathname.startsWith('/feedbacks')
  const interruptedCheckedRef = useRef(false)
  /** @type {[{ startedAt: string; total: number; progress?: string } | null, import('react').Dispatch<import('react').SetStateAction<{ startedAt: string; total: number; progress?: string } | null>>]} */
  const [interruptedRetag, setInterruptedRetag] = useState(null)

  useEffect(() => {
    if (retagSession.active) {
      setInterruptedRetag(null)
      return
    }
    if (interruptedCheckedRef.current) return
    interruptedCheckedRef.current = true
    const marker = readRetagSessionMarker()
    if (marker) setInterruptedRetag(marker)
  }, [retagSession.active])

  const dismissInterruptedRetag = () => {
    clearRetagSessionMarker()
    setInterruptedRetag(null)
  }

  const goFeedbacks = () => {
    dismissInterruptedRetag()
    navigate('/feedbacks')
  }

  return (
    <>
      <Modal
        title="检测到未完成的批量重新打标"
        open={Boolean(interruptedRetag)}
        onCancel={dismissInterruptedRetag}
        footer={[
          <Button key="dismiss" onClick={dismissInterruptedRetag}>
            我知道了
          </Button>,
          <Button key="feedbacks" type="primary" onClick={goFeedbacks}>
            前往反馈库
          </Button>,
        ]}
      >
        {interruptedRetag && (
          <div className="space-y-2 pt-1 text-sm">
            <p>
              上次批量重新打标可能因刷新或关闭页面而中断。未完成前不会写入数据库，请重新执行批量打标。
            </p>
            <p className="text-gray-600">{formatInterruptedRetagMessage(interruptedRetag)}</p>
          </div>
        )}
      </Modal>

      {!retagSession.active || onFeedbacksPage ? null : (
        <div className="app-shell-session-banner pointer-events-none fixed bottom-6 right-0 z-40 flex justify-center px-4 sm:px-8">
          <Alert
            className="pointer-events-auto max-w-xl shadow-md"
            type="info"
            showIcon
            title={TAGGING_IN_PROGRESS_TITLE}
            description={
              <span>
                {formatTaggingProgressDescription({
                  progress: retagSession.progress,
                  total: retagSession.total,
                  scopeLabel: formatBulkRetagScopeLabel(retagSession.scope),
                  hint: TAGGING_TASK_LEAVE_HINT,
                })}
              </span>
            }
          />
        </div>
      )}
    </>
  )
}
