import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from 'antd'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { subscribe } from '../lib/events.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { formatImportFinishedToast, clearImportSessionMarker } from '../lib/importSession.js'
import { formatTicketLlmRemainRuleMessage } from '../lib/importEnrichmentStats.js'

/**
 * 导入完成全局通知。
 * 注：导入已在服务端后台执行，刷新/关闭页面不会中断导入，
 * 旧的"离开确认 / beforeunload / 中断检测 Modal"均已移除，
 * 任务进展可在「打标任务」面板查看。
 */
export default function ImportSessionGuard() {
  const message = useAppMessage()
  const navigate = useNavigate()

  // 清理旧版 sessionStorage marker（前端打标时代的遗留，已无写入/读取点）
  useEffect(() => {
    clearImportSessionMarker()
  }, [])

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

  return null
}
