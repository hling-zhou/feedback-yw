import { useEffect, useMemo, useState } from 'react'
import { Button, Space, Tag, Typography, message } from 'antd'
import { CopyOutlined, DownOutlined, UpOutlined } from '@ant-design/icons'
import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import { recordSourceType } from '../../snapshots/recordScope.js'
import { copyTextToClipboard } from '../../lib/clipboard.js'
import {
  getDisplayCustomerRequest,
  getDisplayPainPoint,
} from '../../lib/ticketAnalysis/ticketAnalysisSources.js'
import {
  formatLinkedFeedbackMonthLabel,
  groupLinkedTicketIdsByMonth,
  UNKNOWN_LINKED_FEEDBACK_MONTH,
} from '../../lib/actionItemLinkedFeedback.js'

/** @typedef {import('../../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * 举措详情抽屉内：直接列出关联反馈工单（可点开工单详情）。
 *
 * @param {Object} props
 * @param {string[]} props.ticketIds
 * @param {Map<string, FeedbackRecord>} [props.feedbackByTicketId]
 * @param {(ticketId: string) => void} [props.onOpenTicket]
 * @param {boolean} [props.expanded]
 * @param {(expanded: boolean) => void} [props.onExpandedChange]
 * @param {number} [props.collapseThreshold]
 */
export default function LinkedTicketsInlineList({
  ticketIds,
  feedbackByTicketId,
  onOpenTicket,
  expanded: controlledExpanded,
  onExpandedChange,
  collapseThreshold = 5,
}) {
  const ids = useMemo(
    () => [...new Set((ticketIds || []).map((id) => String(id).trim()).filter(Boolean))],
    [ticketIds],
  )
  const groups = useMemo(
    () => groupLinkedTicketIdsByMonth(ids, feedbackByTicketId),
    [ids, feedbackByTicketId],
  )
  const idsKey = ids.join('\n')
  const collapsible = ids.length > collapseThreshold
  const [internalExpanded, setInternalExpanded] = useState(!collapsible)
  const expanded = controlledExpanded ?? internalExpanded

  useEffect(() => {
    if (controlledExpanded == null) setInternalExpanded(!collapsible)
  }, [collapsible, controlledExpanded, idsKey])

  if (!ids.length) {
    return <Typography.Text type="secondary">暂无关联反馈</Typography.Text>
  }

  const copyAll = async () => {
    const ok = await copyTextToClipboard(ids.join('\n'))
    if (ok) message.success('已复制工单号')
    else message.error('复制失败')
  }

  const toggleExpanded = () => {
    const next = !expanded
    if (controlledExpanded == null) setInternalExpanded(next)
    onExpandedChange?.(next)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Typography.Text type="secondary" className="text-xs">
          共 {ids.length} 条
        </Typography.Text>
        <Space size={12}>
          {collapsible ? (
            <Button
              type="link"
              size="small"
              icon={expanded ? <UpOutlined /> : <DownOutlined />}
              className="!h-auto !px-0"
              onClick={toggleExpanded}
            >
              {expanded ? '收起' : `展开查看 ${ids.length} 条`}
            </Button>
          ) : null}
          <Button
            type="link"
            size="small"
            icon={<CopyOutlined />}
            className="!h-auto !px-0"
            onClick={() => void copyAll()}
          >
            复制全部
          </Button>
        </Space>
      </div>

      {expanded ? <Space direction="vertical" size={12} className="w-full">
        {groups.map((group) => (
          <div key={group.month} className="space-y-2">
            <Typography.Text className="text-xs font-medium text-ink-600">
              {group.label}
              <Typography.Text type="secondary" className="ml-1 font-normal">
                · {group.ticketIds.length} 条
              </Typography.Text>
            </Typography.Text>

            <Space direction="vertical" size={8} className="w-full">
              {group.ticketIds.map((ticketId) => {
                const record = feedbackByTicketId?.get(ticketId)
                const source = record ? recordSourceType(record) : null
                const summary =
                  (record && (getDisplayCustomerRequest(record) || getDisplayPainPoint(record))) ||
                  ''
                const product = record?.productName || record?.product || ''
                const monthLabel = record?.importMonth
                  ? formatLinkedFeedbackMonthLabel(record.importMonth)
                  : null

                return (
                  <button
                    key={ticketId}
                    type="button"
                    className="w-full rounded-md border border-ink-100 bg-ink-50/40 px-3 py-2 text-left transition-colors hover:border-brand-200 hover:bg-brand-50/40"
                    onClick={() => onOpenTicket?.(ticketId)}
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <Typography.Text strong className="text-sm text-brand-700">
                        {ticketId}
                      </Typography.Text>
                      {source ? (
                        <Tag className="!m-0 !text-[10px]">
                          {DATA_SOURCE_LABELS[source] || source}
                        </Tag>
                      ) : (
                        <Tag color="warning" className="!m-0 !text-[10px]">
                          未入库
                        </Tag>
                      )}
                      {product ? (
                        <Typography.Text type="secondary" className="text-xs">
                          {product}
                        </Typography.Text>
                      ) : null}
                      {monthLabel && group.month === UNKNOWN_LINKED_FEEDBACK_MONTH ? (
                        <Typography.Text type="secondary" className="text-xs">
                          {monthLabel}
                        </Typography.Text>
                      ) : null}
                    </div>
                    {summary ? (
                      <Typography.Paragraph
                        className="!mb-0 !mt-1 text-xs text-ink-700"
                        ellipsis={{ rows: 2, tooltip: summary }}
                      >
                        {summary}
                      </Typography.Paragraph>
                    ) : (
                      <Typography.Text type="secondary" className="mt-1 block text-xs">
                        {record ? '暂无客户请求 / 痛点摘要' : '库中未找到该工单'}
                      </Typography.Text>
                    )}
                  </button>
                )
              })}
            </Space>
          </div>
        ))}
      </Space> : null}
    </div>
  )
}
