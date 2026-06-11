import { useMemo } from 'react'
import { Button, Popover, Table, Tag, Typography } from 'antd'
import { DownOutlined } from '@ant-design/icons'
import { ACTION_ITEM_STATUS_LABELS } from '../../domain/actionItem.js'
import { REQUIREMENT_PROGRESS_FIELD_LABELS } from '../../domain/requirementTicketProgress.js'

/** @typedef {import('../../domain/requirementTicketProgress.js').RequirementTicketDetail} RequirementTicketDetail */

/**
 * @param {Object} props
 * @param {string[]} [props.ticketIds]
 * @param {RequirementTicketDetail[]} [props.requirementTickets]
 */
export default function RequirementTicketsCell({ ticketIds, requirementTickets }) {
  const ids = ticketIds || []
  const details = requirementTickets || []

  const detailById = useMemo(() => {
    const map = new Map()
    for (const detail of details) {
      map.set(detail.ticketId, detail)
    }
    return map
  }, [details])

  const summary = useMemo(() => {
    if (!ids.length) return ''
    const firstId = ids[0]
    const firstDetail = detailById.get(firstId)
    if (!firstDetail || firstDetail.syncState === 'missing') {
      return `${firstId}${ids.length > 1 ? ` 等 ${ids.length} 条` : ''}`
    }
    const statusLabel = firstDetail.mappedStatus
      ? ACTION_ITEM_STATUS_LABELS[firstDetail.mappedStatus]
      : firstDetail.workflowStatus
        ? '未映射'
        : '—'
    const schedule = firstDetail.scheduleAt || '—'
    const suffix = ids.length > 1 ? ` 等 ${ids.length} 条` : ''
    return `${firstId} · ${schedule} · ${statusLabel}${suffix}`
  }, [detailById, ids])

  if (!ids.length) return <Typography.Text type="secondary">—</Typography.Text>

  const columns = [
    {
      title: REQUIREMENT_PROGRESS_FIELD_LABELS.ticketId,
      dataIndex: 'ticketId',
      width: 110,
      render: (value) => (
        <Typography.Text className="text-xs" copyable={{ text: value }}>
          {value}
        </Typography.Text>
      ),
    },
    {
      title: REQUIREMENT_PROGRESS_FIELD_LABELS.product,
      dataIndex: 'product',
      width: 72,
      render: (value) => value || '—',
    },
    {
      title: REQUIREMENT_PROGRESS_FIELD_LABELS.scheduleAt,
      dataIndex: 'scheduleAt',
      width: 96,
      render: (value) => value || '—',
    },
    {
      title: REQUIREMENT_PROGRESS_FIELD_LABELS.workflowStatus,
      dataIndex: 'workflowStatus',
      width: 88,
      render: (value, record) => {
        if (record.syncState === 'missing') {
          return <Tag color="warning">未同步</Tag>
        }
        return value || '—'
      },
    },
    {
      title: '映射状态',
      key: 'mappedStatus',
      width: 88,
      render: (_, record) => {
        if (record.syncState === 'missing') {
          return <Typography.Text type="secondary">—</Typography.Text>
        }
        if (!record.mappedStatus) {
          return <Tag color="orange">未映射</Tag>
        }
        return ACTION_ITEM_STATUS_LABELS[record.mappedStatus] || record.mappedStatus
      },
    },
  ]

  const content = (
    <div className="max-w-[34rem]">
      <Typography.Text type="secondary" className="mb-2 block text-xs">
        共 {ids.length} 条需求工单 · 数据来自「需求工单进展同步」
      </Typography.Text>
      <Table
        size="small"
        pagination={false}
        rowKey="ticketId"
        columns={columns}
        dataSource={ids.map((ticketId) => detailById.get(ticketId) || { ticketId, syncState: 'missing', mappedStatus: null })}
        scroll={{ y: 220 }}
      />
    </div>
  )

  return (
    <Popover
      title="需求工单明细"
      trigger="click"
      placement="left"
      content={content}
      getPopupContainer={() => document.body}
    >
      <Button type="link" className="!h-auto !max-w-full !px-0 !text-left !whitespace-normal">
        <span className="inline-flex items-start gap-1 text-xs">
          <span className="break-all">{summary}</span>
          <DownOutlined className="mt-0.5 shrink-0 text-[10px] text-ink-400" />
        </span>
      </Button>
    </Popover>
  )
}
