import { useEffect, useRef, useState } from 'react'
import { useBlocker, useLocation, useNavigate } from 'react-router-dom'
import { Alert, Button, Modal } from 'antd'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { subscribe } from '../lib/events.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import {
  clearImportSessionMarker,
  formatImportFinishedToast,
  formatInterruptedImportMessage,
  IMPORT_BEFOREUNLOAD_MESSAGE,
  IMPORT_LEAVE_CONFIRM_MESSAGE,
  readImportSessionMarker,
  shouldConfirmLeaveImportPage,
} from '../lib/importSession.js'
import { formatTicketLlmRemainRuleMessage } from '../lib/importEnrichmentStats.js'
import {
  formatImportProgressDescription,
  isImportTaggingPhase,
  TAGGING_IN_PROGRESS_TITLE,
  TAGGING_TASK_LEAVE_HINT,
} from '../lib/taggingTaskUI.js'

export default function ImportSessionGuard() {
  const message = useAppMessage()
  const navigate = useNavigate()
  const location = useLocation()
  const { importSession } = useInsights()
  const onImportPage = location.pathname.startsWith('/import')
  const leaveImportAckRef = useRef(false)
  const interruptedCheckedRef = useRef(false)
  /** @type {[{ startedAt: string; dataMonth: string; batchName?: string; progress?: string } | null, import('react').Dispatch<import('react').SetStateAction<{ startedAt: string; dataMonth: string; batchName?: string; progress?: string } | null>>]} */
  const [interruptedImport, setInterruptedImport] = useState(null)

  useEffect(() => {
    if (!importSession.active) {
      leaveImportAckRef.current = false
    }
  }, [importSession.active])

  useEffect(() => {
    if (importSession.active) {
      setInterruptedImport(null)
      return
    }
    if (interruptedCheckedRef.current) return
    interruptedCheckedRef.current = true
    const marker = readImportSessionMarker()
    if (marker) setInterruptedImport(marker)
  }, [importSession.active])

  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    shouldConfirmLeaveImportPage({
      importActive: importSession.active,
      leaveAcknowledged: leaveImportAckRef.current,
      currentPath: currentLocation.pathname,
      nextPath: nextLocation.pathname,
    }),
  )

  useEffect(() => {
    if (blocker.state !== 'blocked') return
    const ok = window.confirm(IMPORT_LEAVE_CONFIRM_MESSAGE)
    if (ok) {
      leaveImportAckRef.current = true
      blocker.proceed()
    } else {
      blocker.reset()
    }
  }, [blocker])

  useEffect(() => {
    if (!importSession.active) return
    const handler = (event) => {
      event.preventDefault()
      event.returnValue = IMPORT_BEFOREUNLOAD_MESSAGE
      return IMPORT_BEFOREUNLOAD_MESSAGE
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [importSession.active])

  useEffect(() => {
    const unsub = subscribe('ImportFinished', (ev) => {
      const payload = /** @type {import('../lib/importSession.js').ImportFinishedPayload} */ (
        ev.payload
      )
      if (!payload?.dataMonth) return
      const sourceLabel = payload.dataSourceType
        ? DATA_SOURCE_LABELS[payload.dataSourceType] || payload.dataSourceType
        : '数据'
      const detail = formatImportFinishedToast(payload)
      const month = payload.dataMonth
      const source = payload.dataSourceType || 'complaint_ticket'
      message.success({
        content: (
          <span>
            {sourceLabel}导入完成：{detail}。
            <Button
              type="link"
              size="small"
              className="!px-1"
              onClick={() => navigate(`/feedbacks?source=${source}&month=${month}`)}
            >
              查看反馈库
            </Button>
          </span>
        ),
        duration: 10,
      })
      const ticketLlmFailed = payload.ticketLlmFailed ?? 0
      if (ticketLlmFailed > 0) {
        message.warning(formatTicketLlmRemainRuleMessage(ticketLlmFailed), 15)
      }
    })
    return unsub
  }, [message, navigate])

  const dismissInterruptedImport = () => {
    clearImportSessionMarker()
    setInterruptedImport(null)
  }

  const goRetryImport = () => {
    dismissInterruptedImport()
    navigate('/import')
  }

  return (
    <>
      <Modal
        title="检测到未完成的导入"
        open={Boolean(interruptedImport)}
        onCancel={dismissInterruptedImport}
        footer={[
          <Button key="dismiss" onClick={dismissInterruptedImport}>
            我知道了
          </Button>,
          <Button key="retry" type="primary" onClick={goRetryImport}>
            前往重新导入
          </Button>,
        ]}
      >
        {interruptedImport && (
          <div className="space-y-2 pt-1 text-sm">
            <p>
              上次数据导入可能因刷新或关闭页面而中断，分析进度无法恢复。请核对反馈库中的实际条数，必要时重新导入。
            </p>
            <p className="text-gray-600">{formatInterruptedImportMessage(interruptedImport)}</p>
            {interruptedImport.dataSourceType && (
              <p className="text-gray-500">
                数据来源：{DATA_SOURCE_LABELS[interruptedImport.dataSourceType] || interruptedImport.dataSourceType}
              </p>
            )}
          </div>
        )}
      </Modal>

      {!importSession.active || onImportPage ? null : (
        <div className="app-shell-session-banner pointer-events-none fixed bottom-6 right-0 z-40 flex justify-center px-4 sm:px-8">
          <Alert
            className="pointer-events-auto max-w-xl shadow-md"
            type="info"
            showIcon
            title={
              isImportTaggingPhase(importSession.progress)
                ? TAGGING_IN_PROGRESS_TITLE
                : '数据导入进行中'
            }
            description={
              <span>
                {formatImportProgressDescription({
                  progress: importSession.progress,
                  dataMonth: importSession.dataMonth,
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
