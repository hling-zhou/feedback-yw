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
 *   reportVersion?: 'v2' // 11-20 V1 下线：链接恒指 V2，参数保留仅为调用方兼容
 *   linkKind: 'report' | 'workbench'
 *   canSend: boolean
 *   disabledReason?: string
 *   buildAttachment: () => Promise<{ filename: string, mime: string, contentBase64: string } | null>
 *   onSent?: () => void | Promise<void>  // 2026-11-04 需求8：发送成功后回调；回调异常不影响发送成功语义
 *   dispatchSummary?: string  // 2026-11-24：弹窗顶部数量提示（如「本次将发送待省代表回访清单 12 条」）
 *   buildDispatchItems?: () => Array<{ itemKey: string; sourceType?: string; customerName?: string; productName?: string; importMonth?: string }>  // 2026-11-24 原子标记：随发送请求提交，服务端发送成功后同请求写"已纳入"
 *   onMarkOnly?: () => Promise<void>  // 2026-11-24 场景 2 补标：邮件已发但标记写失败时，弹窗露出补标按钮调用（只写标记不重发邮件）
 *   defaultGroupKeyword?: string  // 2026-11-24：默认选中的群组名称关键词（如「用后即评回访」）；无匹配退回首组
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
  reportVersion = 'v2',
  linkKind,
  canSend,
  disabledReason = '',
  buildAttachment,
  onSent,
  dispatchSummary = '',
  buildDispatchItems,
  onMarkOnly,
  defaultGroupKeyword = '',
}) {
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState(null)
  const [templateId, setTemplateId] = useState(defaultTemplateId)
  const [groupId, setGroupId] = useState('')
  const [toText, setToText] = useState('')
  const [ccText, setCcText] = useState('')
  const [note, setNote] = useState('')
  const [sendError, setSendError] = useState('')
  const [markPending, setMarkPending] = useState(false)

  useEffect(() => {
    if (!open) return
    setTemplateId(defaultTemplateId)
    setGroupId('')
    setToText('')
    setCcText('')
    setNote('')
    setSendError('')
    setMarkPending(false)
    setLoading(true)
    loadMailStatus()
      .then((data) => {
        setStatus(data)
        // 2026-11-24 拍板：默认选中名称含关键词的群组（如「用后即评回访」）；无匹配退回首组
        const groupList = data.groups || []
        const group = (defaultGroupKeyword
          && groupList.find((item) => String(item.name || '').includes(defaultGroupKeyword)))
          || groupList[0]
        if (group) {
          setGroupId(group.id)
          setToText((group.emails || []).join(', '))
          setCcText((group.cc || []).join(', '))
        }
      })
      .catch((error) => message.error(error?.message || '加载发信配置失败'))
      .finally(() => setLoading(false))
  }, [open, defaultTemplateId, defaultGroupKeyword])

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
    // 2026-11-09 拍板：选群组同时预填抄送；清空选择时两框同清（手改不写回群组语义不变）
    setCcText((group?.cc || []).join(', '))
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
    setSendError('')
    try {
      const attachment = await buildAttachment()
      if (!attachment) {
        message.warning('没有可发送的附件')
        return
      }
      // 2026-11-24 原子标记：勾选上下文随发送请求提交，服务端 SMTP 成功后同请求写"已纳入"
      //（邮件与标记原子完成，杜绝客户端后置回调失败造成的重复发送）
      const dispatchItems = buildDispatchItems ? buildDispatchItems() : []
      const result = await sendMail({
        templateId,
        dataSourceType,
        periodLabel,
        reportKey,
        reportKind,
        reportVersion,
        linkKind,
        to,
        cc,
        note,
        attachment,
        ...(dispatchItems.length ? { dispatchItems } : {}),
      })
      // 场景 2（邮件已发、标记写失败）：不自动关闭弹窗，露出补标按钮——
      // 提示必须阻止盲目重发（会重复发邮件），指向"仅补标"路径
      if (result?.markError) {
        setMarkPending(true)
        message.error('邮件已发送，但"已纳入"标记写入失败——请勿重复发送，点击下方"补写已纳入标记"补标即可', 10)
        return
      }
      message.success(`已发送${result?.marked ? `，${result.marked} 条已标记"已纳入"` : ''}`)
      // onSent 回调（可选）：标记等后置动作。必须吞错——回调失败绝不能覆写"已发送"成功语义。
      if (onSent) {
        try {
          await onSent()
        } catch (callbackError) {
          console.warn('onSent callback failed:', callbackError)
        }
      }
      onClose()
    } catch (error) {
      const reason = error?.message || '发送失败'
      setSendError(reason)
      message.error(reason, 8)
    } finally {
      setSending(false)
    }
  }

  // 场景 2 补标：只写"已纳入"标记，不碰邮件（幂等——服务端原子标记已成功的会跳过）
  const handleMarkOnly = async () => {
    if (!onMarkOnly) return
    setSending(true)
    try {
      await onMarkOnly()
      setMarkPending(false)
      message.success('已补写"已纳入"标记')
      onClose()
    } catch (error) {
      message.error(error?.message || '补标失败，请稍后重试', 8)
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
      okButtonProps={{ disabled: blocked || loading || markPending }}
      destroyOnClose
      zIndex={1200}
      width={560}
    >
      {disabledReason || missing ? (
        <Alert className="mb-3" type="warning" showIcon message={disabledReason || missing} />
      ) : null}
      {dispatchSummary && !markPending ? (
        <Alert className="mb-3" type="info" showIcon message={dispatchSummary} />
      ) : null}
      {sendError ? (
        <Alert className="mb-3" type="error" showIcon message="发送失败" description={sendError} />
      ) : null}
      {/* 场景 2（邮件已发、标记写失败）：不关闭弹窗，露出补标入口——只写标记不重发邮件 */}
      {markPending ? (
        <Alert
          className="mb-3"
          type="warning"
          showIcon
          message="邮件已发送，但&ldquo;已纳入&rdquo;标记写入失败"
          description="请勿重复发送（收件人会收到重复邮件）。点击下方按钮仅补写标记。"
        />
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
        {markPending && onMarkOnly ? (
          <Button
            type="primary"
            ghost
            block
            loading={sending}
            disabled={sending}
            onClick={() => void handleMarkOnly()}
          >
            补写"已纳入"标记（不重发邮件）
          </Button>
        ) : null}
      </Form>
    </Modal>
  )
}
