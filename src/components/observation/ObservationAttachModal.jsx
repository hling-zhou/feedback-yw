import { useMemo, useState } from 'react'
import { Form, Input, Modal, Radio, Select, message } from 'antd'
import {
  createObservationIssue,
  attachObservationLink,
  listObservationIssues,
} from '../../lib/observationClient.js'
import {
  OBSERVATION_SUMMARY_MAX_LENGTH,
} from '../../domain/observationIssue.js'

/**
 * 预填草稿：三入口各自拼接规则（DESIGN §5.1）。
 * - 工单：请求场景 + 痛点（兜底 客户请求节选 → 处理意见首句）
 * - 评价：原因标签 + 原文摘录（原因为「其他」时只用摘录）
 * - 建议卡新建：直接用被匹配文本（调用方传入）
 *
 * @param {import('./types.js').FeedbackRecord | null} record
 * @param {'complaint_ticket' | 'consultation_ticket' | 'post_use_rating'} recordDataSource
 * @returns {string}
 */
export function buildObservationSummaryDraft(record, recordDataSource) {
  const clip = (t, n = 60) => String(t || '').trim().slice(0, n)
  if (recordDataSource === 'post_use_rating') {
    const reason = String(record?.lowScoreReason || '').trim()
    const excerpt = clip(record?.commentText || record?.rawText, 60)
    if (reason && reason !== '其他') return `${reason}：${excerpt}`.slice(0, OBSERVATION_SUMMARY_MAX_LENGTH)
    return excerpt.slice(0, OBSERVATION_SUMMARY_MAX_LENGTH)
  }
  const scene = clip(record?.requestScene, 12)
  const pain = clip(record?.painPoint || record?.problemSummary, OBSERVATION_SUMMARY_MAX_LENGTH)
  if (scene && pain) return `${scene}：${pain}`.slice(0, OBSERVATION_SUMMARY_MAX_LENGTH)
  if (pain) return pain.slice(0, OBSERVATION_SUMMARY_MAX_LENGTH)
  const cr = clip(record?.customerRequest, 60)
  if (cr) return cr
  const handling = String(record?.handlingText || '').trim()
  if (handling) return clip(handling.split(/[。！\n]/)[0] || handling, 60)
  return ''
}

/**
 * 纳入观察 Modal：新建 / 关联已有 二选一（S1/S2 人工兜底主路径）。
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('./types.js').FeedbackRecord | null} props.record - 宿主记录（工单或评价）
 * @param {'complaint_ticket' | 'consultation_ticket' | 'post_use_rating'} props.recordDataSource
 * @param {() => void} [props.onAttached] - 关联成功回调（卡片刷新用）
 */
export default function ObservationAttachModal({
  open,
  onClose,
  record,
  recordDataSource,
  onAttached,
}) {
  const [mode, setMode] = useState('create')
  const [summary, setSummary] = useState('')
  const [keywords, setKeywords] = useState('')
  const [selectedIssueId, setSelectedIssueId] = useState(null)
  const [issueOptions, setIssueOptions] = useState([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [form] = Form.useForm()
  const [messageApi, contextHolder] = message.useMessage()

  const productKey = String(record?.productKey || '').trim()
  const productName = String(record?.product || record?.productName || '').trim()
  const recordId = String(record?.id || '').trim()
  const ticketId = String(record?.ticketId || '').trim()

  const draft = useMemo(
    () => buildObservationSummaryDraft(record, recordDataSource),
    [record, recordDataSource],
  )

  /** 打开时初始化草稿与候选 */
  const afterOpenChange = (visible) => {
    if (!visible) return
    setMode('create')
    setSummary(draft)
    setKeywords('')
    setSelectedIssueId(null)
    setIssueOptions([])
  }

  const handleSearchIssues = async (text) => {
    const q = String(text || '').trim()
    if (!q) return
    setSearching(true)
    try {
      const result = await listObservationIssues({
        keyword: q,
        productKey: productKey || undefined,
        pageSize: 20,
      })
      setIssueOptions(
        result.issues.map((issue) => ({
          value: issue.id,
          label: `${issue.title} · ${issue.occurrenceCount} 次 · 最近 ${issue.lastSeenAt?.slice(0, 10) || '—'}`,
          issue,
        })),
      )
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '搜索失败')
    } finally {
      setSearching(false)
    }
  }

  const handleSubmit = async () => {
    if (mode === 'create') {
      const trimmed = summary.trim()
      if (!trimmed) {
        messageApi.warning('请填写问题描述')
        return
      }
      if (!productKey || !productName) {
        messageApi.warning('记录缺少产品信息，无法新建留观问题')
        return
      }
      setSubmitting(true)
      try {
        await createObservationIssue({
          productKey,
          productName,
          title: trimmed.slice(0, OBSERVATION_SUMMARY_MAX_LENGTH),
          summary: trimmed.slice(0, OBSERVATION_SUMMARY_MAX_LENGTH),
          keywords: keywords
            .split(/[,，、\s]+/)
            .map((k) => k.trim())
            .filter(Boolean)
            .slice(0, 20),
          firstLink: recordId
            ? { recordId, recordDataSource, ticketId: ticketId || undefined }
            : undefined,
        })
        messageApi.success('已新建留观问题并关联本记录')
        onAttached?.()
        onClose()
      } catch (err) {
        messageApi.error(err instanceof Error ? err.message : '创建失败')
      } finally {
        setSubmitting(false)
      }
      return
    }

    if (mode === 'attach') {
      if (!selectedIssueId) {
        messageApi.warning('请选择要关联的留观问题')
        return
      }
      if (!recordId) {
        messageApi.warning('记录缺失，无法关联')
        return
      }
      setSubmitting(true)
      try {
        await attachObservationLink(selectedIssueId, {
          recordId,
          recordDataSource,
          ticketId: ticketId || undefined,
        })
        messageApi.success('已关联到留观问题')
        onAttached?.()
        onClose()
      } catch (err) {
        const text = err instanceof Error ? err.message : '关联失败'
        if (text.includes('已存在关联')) {
          messageApi.warning('该记录与此问题已存在关联')
        } else {
          messageApi.error(text)
        }
      } finally {
        setSubmitting(false)
      }
    }
  }

  return (
    <Modal
      open={open}
      title="纳入观察"
      afterOpenChange={afterOpenChange}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={mode === 'create' ? '确认创建' : '确认关联'}
      okButtonProps={{ loading: submitting }}
      destroyOnClose
      width={520}
    >
      {contextHolder}
      <div className="mb-4 text-xs text-ink-500">
        {productName ? `产品：${productName}` : ''}
        {ticketId ? ` · 工单号：${ticketId}` : ''}
      </div>
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        className="mb-4"
        options={[
          { value: 'create', label: '新建留观问题' },
          { value: 'attach', label: '关联已有' },
        ]}
      />
      {mode === 'create' ? (
        <Form form={form} layout="vertical" className="[&_.ant-form-item]:!mb-3">
          <Form.Item label="问题描述" required extra="建议写 现象+受阻点，如「控制台找不到退订/取消入口」">
            <Input.TextArea
              rows={3}
              showCount
              maxLength={OBSERVATION_SUMMARY_MAX_LENGTH}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="自动预填，可修改"
            />
          </Form.Item>
          <Form.Item label="关键词（可选）" extra="逗号或顿号分隔，供自动召回使用">
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="如：退订、取消入口"
              maxLength={200}
            />
          </Form.Item>
        </Form>
      ) : (
        <Form layout="vertical" className="[&_.ant-form-item]:!mb-3">
          <Form.Item
            label={`搜索已有留观问题${productKey ? '（限当前产品）' : ''}`}
            required
          >
            <Select
              showSearch
              filterOption={false}
              placeholder="输入关键词搜索，如「退订」"
              value={selectedIssueId}
              onSearch={handleSearchIssues}
              onChange={setSelectedIssueId}
              options={issueOptions}
              loading={searching}
              notFoundContent={searching ? '搜索中…' : '输入关键词搜索'}
              allowClear
            />
          </Form.Item>
          <div className="text-xs text-ink-500">
            选中即直接确认为已关联（人工在完整上下文里的判断即为终判，不产生待复核建议）。
          </div>
        </Form>
      )}
    </Modal>
  )
}
