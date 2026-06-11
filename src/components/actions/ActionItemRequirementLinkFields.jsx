import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Form, Input, Radio, Table, Tag, Typography } from 'antd'
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons'
import ActionItemStatusTag from '../tags/ActionItemStatusTag.jsx'
import {
  normalizeRequirementTicketId,
  REQUIREMENT_PROGRESS_FIELD_LABELS,
} from '../../domain/requirementTicketProgress.js'
import { lookupRequirementTickets } from '../../lib/requirementTicketProgressClient.js'

/** @typedef {import('../../domain/requirementTicketProgress.js').RequirementTicketDetail} RequirementTicketDetail */

/**
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeRequirementTicketIdsFromForm(raw) {
  const list = Array.isArray(raw) ? raw : []
  return [...new Set(list.map((id) => normalizeRequirementTicketId(id)).filter(Boolean))]
}

/**
 * @param {string[]} [ids]
 * @returns {string[]}
 */
export function toRequirementTicketFormList(ids) {
  const unique = [...new Set((ids || []).map(normalizeRequirementTicketId).filter(Boolean))]
  return unique.length ? unique : ['']
}

/**
 * @param {Object} props
 * @param {import('antd').FormInstance} props.form
 * @param {boolean} [props.disabled]
 * @param {RequirementTicketDetail[]} [props.initialTicketDetails]
 * @param {(enabled: boolean) => void} [props.onLinkModeChange]
 */
export default function ActionItemRequirementLinkFields({
  form,
  disabled = false,
  initialTicketDetails = [],
  onLinkModeChange,
}) {
  const linkEnabled = Form.useWatch('requirementLinkEnabled', form)
  const ticketIds = Form.useWatch('requirementTicketIds', form)
  const [ticketDetails, setTicketDetails] = useState(/** @type {RequirementTicketDetail[]} */ ([]))
  const [lookupLoading, setLookupLoading] = useState(false)

  useEffect(() => {
    if (linkEnabled && initialTicketDetails.length) {
      setTicketDetails(initialTicketDetails)
    }
  }, [initialTicketDetails, linkEnabled])

  const resolvedIds = useMemo(
    () => normalizeRequirementTicketIdsFromForm(ticketIds),
    [ticketIds],
  )

  const loadTicketDetails = useCallback(async (ids) => {
    if (!ids.length) {
      setTicketDetails([])
      return
    }
    setLookupLoading(true)
    try {
      const tickets = await lookupRequirementTickets(ids)
      setTicketDetails(tickets)
    } catch {
      setTicketDetails(
        ids.map((ticketId) => ({
          ticketId,
          syncState: 'missing',
          mappedStatus: null,
        })),
      )
    } finally {
      setLookupLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!linkEnabled) {
      setTicketDetails([])
      return
    }
    const timer = window.setTimeout(() => {
      void loadTicketDetails(resolvedIds)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [linkEnabled, loadTicketDetails, resolvedIds.join('|')])

  const columns = [
    {
      title: '需求工单号',
      dataIndex: 'ticketId',
      width: 140,
      render: (value) => (
        <Typography.Text className="text-xs" copyable={{ text: value }}>
          {value}
        </Typography.Text>
      ),
    },
    {
      title: REQUIREMENT_PROGRESS_FIELD_LABELS.product,
      dataIndex: 'product',
      width: 96,
      render: (value, record) => {
        if (record.syncState === 'missing') return <Typography.Text type="secondary">—</Typography.Text>
        return value || '—'
      },
    },
    {
      title: REQUIREMENT_PROGRESS_FIELD_LABELS.scheduleAt,
      dataIndex: 'scheduleAt',
      width: 120,
      render: (value, record) => {
        if (record.syncState === 'missing') return <Typography.Text type="secondary">—</Typography.Text>
        return value || '—'
      },
    },
    {
      title: REQUIREMENT_PROGRESS_FIELD_LABELS.workflowStatus,
      dataIndex: 'workflowStatus',
      width: 100,
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
      width: 100,
      render: (_, record) => {
        if (record.syncState === 'missing') {
          return <Typography.Text type="secondary">—</Typography.Text>
        }
        if (!record.mappedStatus) {
          return <Tag color="orange">未映射</Tag>
        }
        return <ActionItemStatusTag status={record.mappedStatus} />
      },
    },
  ]

  return (
    <div className="space-y-3">
      <Form.Item
        name="requirementLinkEnabled"
        label="关联需求工单"
        rules={[{ required: true, message: '请选择是否关联需求工单' }]}
      >
        <Radio.Group
          disabled={disabled}
          onChange={(event) => onLinkModeChange?.(event.target.value)}
        >
          <Radio value={false}>不关联</Radio>
          <Radio value={true}>关联</Radio>
        </Radio.Group>
      </Form.Item>

      {linkEnabled ? (
        <>
          <Typography.Text type="secondary" className="block text-xs">
            填写需求工单号后，下方自动展示各工单的排期与状态（来自「需求工单进展同步」），不可修改，允许为空或未同步。
          </Typography.Text>
          <Form.List name="requirementTicketIds">
            {(fields, { add, remove }) => (
              <div className="space-y-2">
                {fields.map((field, index) => (
                  <div key={field.key} className="flex items-start gap-2">
                    <Form.Item {...field} className="!mb-0 min-w-0 flex-1">
                      <Input
                        placeholder="需求工单号"
                        disabled={disabled}
                        onBlur={() => void loadTicketDetails(resolvedIds)}
                      />
                    </Form.Item>
                    {fields.length > 1 ? (
                      <Button
                        type="text"
                        danger
                        icon={<MinusCircleOutlined />}
                        disabled={disabled}
                        onClick={() => remove(field.name)}
                        aria-label="删除需求工单号"
                      />
                    ) : null}
                  </div>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  disabled={disabled}
                  onClick={() => add('')}
                >
                  添加需求工单号
                </Button>
              </div>
            )}
          </Form.List>
          {resolvedIds.length > 0 ? (
            <Table
              size="small"
              rowKey="ticketId"
              loading={lookupLoading}
              pagination={false}
              columns={columns}
              dataSource={ticketDetails}
              locale={{ emptyText: '填写工单号后自动加载' }}
            />
          ) : null}
        </>
      ) : null}
    </div>
  )
}
