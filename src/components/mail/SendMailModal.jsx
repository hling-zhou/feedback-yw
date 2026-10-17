import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Form, Input, Modal, Select, Typography, message } from 'antd'
import { loadMailStatus, sendMail } from '../../lib/mailClient.js'
import { parseEmailList } from '../../domain/mail.js'

/**
 * @param {{
 *   open: boolean
 *   onClose: () => void
 *   defaultTemplateId: string
 *   dataSourceType: string
 *   periodLabel: string
 *   reportKey?: string
 *   reportKind?: 'month' | 'quarter'
 *   linkKind: 'report' | 'workbench'
 *   canSend: boolean
 *   disabledReason?: string
 *   buildAttachment: () => Promise<{ filename: string, mime: string, contentBase64: string } | null>
 * }} props
 */
export default function SendMailModal({
  open,
  onClose,
  defaultTemplateId,
  dataSourceType,
  periodLabel,
  reportKey = '',
  reportKind = 'month',
  linkKind,
  canSend,
  disabledReason = '',
  buildAttachment,
}) {
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState(null)
  const [templateId, setTemplateId] = useState(defaultTemplateId)
  const [groupId, setGroupId] = useState('')
  const [toText, setToText] = useState('')
  const [ccText, setCcText] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return
    setTemplateId(defaultTemplateId)
    setGroupId('')
    setToText('')
    setCcText('')
    setNote('')
    setLoading(true)
    loadMailStatus()
      .then((data) => {
        setStatus(data)
        const group = data.groups?.[0]
        if (group) {
          setGroupId(group.id)
          setToText((group.emails || []).join(', '))
        }
      })
      .catch((error) => message.error(error?.message || '加载发信配置失败'))
      .finally(() => setLoading(false))
  }, [open, defaultTemplateId])

  const channel = useMemo(
    () => (status?.channels || []).find((item) => item.dataSourceType === dataSourceType) || null,
    [status, dataSourceType],
  )
  const templates = status?.templates || []
  const groups = status?.groups || []
  const missing = !status?.publicAppUrl
    ? '未配置平台访问地址'
    : !channel
      ? '未配置该数据来源的发信通道'
      : ''
  const blocked = Boolean(disabledReason || missing || !canSend)

  const onSelectGroup = (id) => {
    setGroupId(id || '')
    const group = groups.find((item) => item.id === id)
    setToText((group?.emails || []).join(', '))
  }

  const handleOk = async () => {
    if (blocked) return
    const to = parseEmailList(toText)
    const cc = parseEmailList(ccText)
    if (!to.length) {
      message.warning('请填写收件人')
      return
    }
    setSending(true)
    try {
      const attachment = await buildAttachment()
      if (!attachment) {
        message.warning('没有可发送的附件')
        return
      }
      await sendMail({
        templateId,
        dataSourceType,
        periodLabel,
        reportKey,
        reportKind,
        linkKind,
        to,
        cc,
        note,
        attachment,
      })
      message.success('已发送')
      onClose()
    } catch (error) {
      message.error(error?.message || '发送失败')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal
      title="发送邮件"
      open={open}
      onCancel={onClose}
      onOk={() => void handleOk()}
      okText="发送"
      confirmLoading={sending}
      okButtonProps={{ disabled: blocked || loading }}
      destroyOnClose
      zIndex={1200}
      width={560}
    >
      {disabledReason || missing ? (
        <Alert className="mb-3" type="warning" showIcon message={disabledReason || missing} />
      ) : null}
      <Form layout="vertical">
        <Form.Item label="邮件模板" required>
          <Select
            value={templateId}
            options={templates.map((item) => ({ value: item.id, label: item.name }))}
            onChange={setTemplateId}
          />
        </Form.Item>
        <Form.Item label="发信通道">
          <Typography.Text>
            {channel ? `${channel.name}（${channel.fromAddress}）` : '未配置'}
          </Typography.Text>
        </Form.Item>
        <Form.Item label="收件人群组">
          <Select
            allowClear
            placeholder="选择群组预填收件人"
            value={groupId || undefined}
            options={groups.map((item) => ({ value: item.id, label: item.name }))}
            onChange={onSelectGroup}
          />
        </Form.Item>
        <Form.Item label="收件人" required>
          <Input.TextArea
            rows={2}
            value={toText}
            onChange={(event) => setToText(event.target.value)}
            placeholder="多个邮箱用逗号或换行分隔；本次修改不写回群组"
          />
        </Form.Item>
        <Form.Item label="抄送">
          <Input.TextArea rows={2} value={ccText} onChange={(event) => setCcText(event.target.value)} />
        </Form.Item>
        <Form.Item label="发送说明">
          <Input.TextArea rows={2} value={note} onChange={(event) => setNote(event.target.value)} />
        </Form.Item>
      </Form>
    </Modal>
  )
}
