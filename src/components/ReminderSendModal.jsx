import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Checkbox, Modal, Select, Spin, Table, Tag, Typography } from 'antd'
import { useInsights } from '../context/InsightsContext.jsx'
import { apiFetch } from '../lib/apiClient.js'
import { buildReminderPeriodOptions } from './reminderPeriodOptions.js'

const { Text, Paragraph } = Typography

/**
 * @param {{ open: boolean, onClose: () => void }} props
 */
export default function ReminderSendModal({ open, onClose }) {
  const { periods, currentPeriodId, importMonthSummary, refreshImportMonthSummary } = useInsights()
  const [selectedPeriodId, setSelectedPeriodId] = useState('')
  const [preview, setPreview] = useState(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [skipLlm, setSkipLlm] = useState(false)
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState(null)
  const [sendError, setSendError] = useState('')

  useEffect(() => {
    if (open) {
      setSelectedPeriodId(currentPeriodId || '')
      setPreview(null)
      setPreviewError('')
      setSendResult(null)
      setSendError('')
    }
  }, [open, currentPeriodId])

  // 弹窗打开时刷新月度汇总：按数据判定可选周期，导入新数据/他人导入后
  // 无需整页刷新即可选到最新（含预导入的未来）数据月份
  useEffect(() => {
    if (open) void refreshImportMonthSummary?.()
  }, [open, refreshImportMonthSummary])

  const periodOptions = useMemo(
    () => buildReminderPeriodOptions(periods, importMonthSummary?.months ?? null),
    [periods, importMonthSummary],
  )
  const effectivePeriodId = periodOptions.some((o) => o.value === selectedPeriodId)
    ? selectedPeriodId
    : (periodOptions[0]?.value || '')

  const handlePreview = useCallback(async () => {
    setPreviewLoading(true)
    setPreviewError('')
    setPreview(null)
    setSendResult(null)
    try {
      const data = await apiFetch('/api/reminders/preview', {
        method: 'POST',
        body: JSON.stringify({ insightPeriodId: effectivePeriodId }),
      })
      setPreview(data)
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : '预览失败')
    } finally {
      setPreviewLoading(false)
    }
  }, [effectivePeriodId])

  const handleSend = useCallback(async () => {
    setSending(true)
    setSendError('')
    setSendResult(null)
    try {
      const data = await apiFetch('/api/reminders/send', {
        method: 'POST',
        body: JSON.stringify({ insightPeriodId: effectivePeriodId, skipLlm }),
      })
      setSendResult(data)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : '发送失败')
    } finally {
      setSending(false)
    }
  }, [effectivePeriodId, skipLlm])

  const productColumns = [
    {
      title: '产品',
      dataIndex: 'productName',
      key: 'productName',
      width: 100,
      render: (name) => <Text strong style={{ color: '#1890ff' }}>{name}</Text>,
    },
    { title: '待办总数', dataIndex: 'total', key: 'total', width: 70, render: (v) => <Text strong style={{ color: '#cf1322' }}>{v}</Text> },
    {
      title: '各类分布',
      key: 'distribution',
      render: (_, record) => {
        const d = record.distribution
        const parts = []
        if (d.complaintTickets) parts.push(<Tag key="ct" color="red">投诉 {d.complaintTickets}</Tag>)
        if (d.consultationTotal) parts.push(<Tag key="cs" color="blue">咨询 {d.consultationTotal}</Tag>)
        if (d.internalTraces) parts.push(<Tag key="it" color="orange">溯源 {d.internalTraces}</Tag>)
        if (d.visitEvaluations) parts.push(<Tag key="ve" color="orange">回访 {d.visitEvaluations}</Tag>)
        if (d.pendingActions) {
          parts.push(<Tag key="pa" color="orange">举措 {d.pendingActions}</Tag>)
          if (d.actionOverdue) parts.push(<Tag key="ao" color="red">超期 {d.actionOverdue}</Tag>)
          if (d.actionNear) parts.push(<Tag key="an" color="gold">临近 {d.actionNear}</Tag>)
        }
        if (d.openTodos) parts.push(<Tag key="ot" color="orange">待办 {d.openTodos}</Tag>)
        return <div>{parts}</div>
      },
    },
    {
      title: '需关注',
      key: 'attention',
      width: 120,
      render: (_, record) => record.attentionRoles?.length
        ? record.attentionRoles.map((r) => <Tag key={r}>{r}</Tag>)
        : <Text type="secondary">—</Text>,
    },
  ]

  return (
    <Modal
      title="发送提醒邮件"
      open={open}
      onCancel={onClose}
      destroyOnClose
      width={800}
      footer={[
        <Button key="cancel" onClick={onClose}>关闭</Button>,
        !sendResult && (
          <Button key="send" type="primary" loading={sending} disabled={!preview || preview?.products?.length === 0} onClick={() => void handleSend()}>
            发送邮件（{preview?.recipientCount || 0} 人）
          </Button>
        ),
      ].filter(Boolean)}
    >
      <div className="space-y-4">
        {/* 周期选择 */}
        <div className="flex items-center gap-3">
          <Text>洞察周期：</Text>
          <Select
            value={effectivePeriodId}
            onChange={setSelectedPeriodId}
            options={periodOptions}
            placeholder="选择洞察周期"
            style={{ width: 200 }}
            showSearch
            optionFilterProp="label"
          />
          <Button onClick={() => void handlePreview()} loading={previewLoading} disabled={!effectivePeriodId}>
            预览
          </Button>
          <Checkbox checked={skipLlm} onChange={(e) => setSkipLlm(e.target.checked)}>
            跳过 LLM
          </Checkbox>
        </div>

        {/* 预览错误 */}
        {previewError && (
          <Alert type="error" message={previewError} showIcon closable onClose={() => setPreviewError('')} />
        )}

        {/* 预览 loading */}
        {previewLoading && <div className="text-center py-8"><Spin tip="正在查询待办数据..." /></div>}

        {/* 预览结果 */}
        {preview && !previewLoading && (
          <div className="space-y-3">
            <Alert
              type="info"
              showIcon
              message={`涵盖 ${preview.products.length} 个产品，共 ${preview.totalCount} 项待处理事项`}
              description={`收件人：${preview.recipientCount} 人（各产品 PM / 设计师 / 运维三线 / 运营 / 测试 负责人）`}
            />
            {preview.products.length === 0 ? (
              <Alert type="warning" message="本周期无待办数据，无需发送提醒邮件" showIcon />
            ) : (
              <Table
                dataSource={preview.products}
                columns={productColumns}
                rowKey="productKey"
                size="small"
                pagination={false}
                scroll={{ y: 300 }}
              />
            )}
            {preview.recipientEmails?.length > 0 && (
              <div>
                <Text type="secondary" style={{ fontSize: 12 }}>收件人列表：</Text>
                <Paragraph style={{ fontSize: 12, color: '#999', marginTop: 4 }}>
                  {preview.recipientEmails.join(', ')}
                </Paragraph>
              </div>
            )}
          </div>
        )}

        {/* 发送结果 */}
        {sendResult && (
          <Alert
            type="success"
            showIcon
            message={`邮件已发送！`}
            description={`已发送给 ${sendResult.recipientCount} 人，涵盖 ${sendResult.productCount} 个产品，共 ${sendResult.totalCount} 项待处理事项。周期：${sendResult.periodLabel}`}
          />
        )}

        {/* 发送错误 */}
        {sendError && (
          <Alert type="error" message={sendError} showIcon closable onClose={() => setSendError('')} />
        )}
      </div>
    </Modal>
  )
}
