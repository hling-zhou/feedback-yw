import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Modal } from 'antd'
import { useInsights } from '../context/InsightsContext.jsx'
import {
  clearRetagSessionMarker,
  formatInterruptedRetagMessage,
  readRetagSessionMarker,
} from '../lib/retagSession.js'

export default function RetagSessionGuard() {
  const navigate = useNavigate()
  const { retagSession } = useInsights()
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
            检测到上次打标任务可能因页面刷新或关闭而中断了前端进度显示。后台打标不受影响，请在打标任务面板中查看执行结果——任务可能仍在进行中或已完成。
          </p>
          <p className="text-gray-600">{formatInterruptedRetagMessage(interruptedRetag)}</p>
        </div>
      )}
    </Modal>
  )
}
