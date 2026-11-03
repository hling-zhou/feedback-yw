import { useMemo, useState } from 'react'
import { Form, Input, Modal, Radio, Select, Tooltip, message } from 'antd'
import {
  createGeneralizationIssue,
  attachGeneralizationLink,
  listGeneralizationIssues,
} from '../../lib/generalizationClient.js'
import {
  GENERALIZATION_CATEGORIES,
  GENERALIZATION_CATEGORY_LABELS,
  GENERALIZATION_SCOPES,
  GENERALIZATION_SCOPE_LABELS,
  GENERALIZATION_SUMMARY_MAX_LENGTH,
} from '../../domain/generalizationIssue.js'

/**
 * title 预填：痛点首句截 30 字（对齐 TASKS G1-1 口径）。
 * @param {import('../../lib/types.js').FeedbackRecord | null} record
 * @returns {string}
 */
export function buildGeneralizationTitleDraft(record) {
  const pain = String(record?.painPoint || record?.problemSummary || '').trim()
  const firstSentence = pain.split(/[。！!？?\n]/)[0] || pain
  return firstSentence.slice(0, 30)
}

/**
 * summary 预填：请求场景 + 痛点（兜底 客户请求节选 → 处理意见首句）。
 * 与留观 attachModal 同款拼接规则（DESIGN §5.1），但上限沿用 gen 口径 100 字。
 * @param {import('../../lib/types.js').FeedbackRecord | null} record
 * @returns {string}
 */
export function buildGeneralizationSummaryDraft(record) {
  const clip = (t, n = 60) => String(t || '').trim().slice(0, n)
  const scene = clip(record?.requestScene, 12)
  const pain = clip(record?.painPoint || record?.problemSummary, GENERALIZATION_SUMMARY_MAX_LENGTH)
  if (scene && pain) return `${scene}：${pain}`.slice(0, GENERALIZATION_SUMMARY_MAX_LENGTH)
  if (pain) return pain.slice(0, GENERALIZATION_SUMMARY_MAX_LENGTH)
  const cr = clip(record?.customerRequest, 60)
  if (cr) return cr
  const handling = String(record?.handlingText || '').trim()
  if (handling) return clip(handling.split(/[。！\n]/)[0] || handling, 60)
  return ''
}

/**
 * keywords 极短/极通用轻提示（不强制——v3.3 ⑧）。
 * @param {string[]} keywords
 * @returns {string | null} 提示文案（null = 无需提示）
 */
export function generalizationKeywordsWarning(keywords) {
  const GENERIC = new Set(['报错', '失败', '异常', '错误', '问题', '无法', '不能', '不support', '故障'])
  for (const k of keywords) {
    if (k.length < 2) return `关键词「${k}」过短（<2 字），召回面过宽建议补充`
    if (GENERIC.has(k)) return `关键词「${k}」过于通用，可能召回大量无关记录，建议加限定词`
  }
  return null
}

/**
 * 纳入举一反三 Modal：新建 / 关联已有 二选一（人工兜底主路径）。
 *
 * 与留观 attachModal 的差异（DESIGN §5.1 / TASKS G1-1）：
 * - category/scope 必选（定义性属性——创建即必填）；
 * - 不含根因分析/优化方案输入项（创建可空，Tab 侧滑补全——v3.4）；
 * - 新建响应含 similarHints 去重提示（轻提示不强制）；
 * - 关联已有只搜 in_progress 态。
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('../../lib/types.js').FeedbackRecord | null} props.record - 宿主工单记录
 * @param {{ category?: string, scope?: string }} [props.suggested] - AI 建议预填（建议条「创建」入口）
 * @param {() => void} [props.onAttached] - 成功回调（卡片刷新用）
 */
export default function GeneralizationAttachModal({
  open,
  onClose,
  record,
  suggested,
  onAttached,
}) {
  const [mode, setMode] = useState('create')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [category, setCategory] = useState(null)
  const [categoryOther, setCategoryOther] = useState('')
  const [scope, setScope] = useState(null)
  const [keywords, setKeywords] = useState('')
  const [selectedIssueId, setSelectedIssueId] = useState(null)
  const [issueOptions, setIssueOptions] = useState([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  const productKey = String(record?.productKey || '').trim()
  // FeedbackRecord 类型只有 product 字段（productName 是导入模板列名，非记录属性）
  const productName = String(record?.product || '').trim()
  const recordId = String(record?.id || '').trim()
  const ticketId = String(record?.ticketId || '').trim()

  const titleDraft = useMemo(() => buildGeneralizationTitleDraft(record), [record])
  const summaryDraft = useMemo(() => buildGeneralizationSummaryDraft(record), [record])
  const keywordWarning = useMemo(
    () =>
      generalizationKeywordsWarning(
        keywords.split(/[,，、\s]+/).map((k) => k.trim()).filter(Boolean),
      ),
    [keywords],
  )

  /** 打开时初始化草稿与候选（含 AI 建议预填——建议条入口传入 suggested） */
  const afterOpenChange = (visible) => {
    if (!visible) return
    setMode('create')
    setTitle(titleDraft)
    setSummary(summaryDraft)
    setCategory(suggested?.category || null)
    setCategoryOther('')
    setScope(suggested?.scope || null)
    setKeywords('')
    setSelectedIssueId(null)
    setIssueOptions([])
  }

  const handleSearchIssues = async (text) => {
    const q = String(text || '').trim()
    if (!q) return
    setSearching(true)
    try {
      const result = await listGeneralizationIssues({
        keyword: q,
        productKey: productKey || undefined,
        status: 'in_progress',
        pageSize: 20,
      })
      setIssueOptions(
        result.issues.map((issue) => ({
          value: issue.id,
          label: `${issue.title} · ${issue.occurrenceCount} 次 · ${GENERALIZATION_CATEGORY_LABELS[issue.category] || '—'}`,
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
      const trimmedTitle = title.trim()
      const trimmedSummary = summary.trim()
      if (!trimmedTitle) {
        messageApi.warning('请填写问题标题')
        return
      }
      if (!trimmedSummary) {
        messageApi.warning('请填写问题描述')
        return
      }
      if (!category) {
        messageApi.warning('请选择可介入原因范畴（六选一）')
        return
      }
      // 选「其他」时补充说明必填（11-04 用户需求：其他 + 自定义输入）
      const trimmedOther = categoryOther.trim()
      if (category === 'other_intervenable' && !trimmedOther) {
        messageApi.warning('选择「其他」时请填写具体原因')
        return
      }
      if (!scope) {
        messageApi.warning('请选择共性范围（多场景 / 跨产品）')
        return
      }
      if (!productKey || !productName) {
        messageApi.warning('记录缺少产品信息，无法新建举一反三问题')
        return
      }
      setSubmitting(true)
      try {
        // 30s 超时兜底（防网络/代理挂起时按钮永久转圈——2026-11-04 用户反馈）
        const TIMEOUT_MS = 30_000
        const result = await Promise.race([
          createGeneralizationIssue({
            productKey,
            productName,
            title: trimmedTitle.slice(0, GENERALIZATION_SUMMARY_MAX_LENGTH),
            summary: trimmedSummary.slice(0, GENERALIZATION_SUMMARY_MAX_LENGTH),
            category,
            scope,
            // 「其他」自定义说明随创建提交（存 issue.payload.categoryOther——枚举列保持 other_intervenable）
            ...(category === 'other_intervenable' && trimmedOther
              ? { categoryOther: trimmedOther.slice(0, 100) }
              : {}),
            keywords: keywords
              .split(/[,，、\s]+/)
              .map((k) => k.trim())
              .filter(Boolean)
              .slice(0, 20),
            firstLink: recordId
              ? { recordId, recordDataSource: 'complaint_ticket', ticketId: ticketId || undefined }
              : undefined,
          }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('创建请求超时（30 秒），请检查网络后重试')), TIMEOUT_MS)
          }),
        ])
        // 去重提示（轻提示不强制——similarHints 由后端 findSimilarIssues 返回）
        if (result?.similarHints?.length) {
          messageApi.warning(
            `检测到 ${result.similarHints.length} 个相似举一反三问题（如「${result.similarHints[0].title}」），可到清单中确认是否应关联`,
          )
        } else {
          messageApi.success('已新建举一反三问题并关联本记录')
        }
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
        messageApi.warning('请选择要关联的举一反三问题')
        return
      }
      if (!recordId) {
        messageApi.warning('记录缺失，无法关联')
        return
      }
      setSubmitting(true)
      try {
        // 30s 超时兜底（防挂起永久转圈——同 create 分支）
        const TIMEOUT_MS = 30_000
        await Promise.race([
          attachGeneralizationLink(selectedIssueId, {
            recordId,
            recordDataSource: 'complaint_ticket',
            ticketId: ticketId || undefined,
          }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('关联请求超时（30 秒），请检查网络后重试')), TIMEOUT_MS)
          }),
        ])
        messageApi.success('已关联到举一反三问题')
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
      title="纳入举一反三"
      afterOpenChange={afterOpenChange}
      onCancel={onClose}
      onOk={handleSubmit}
      okText={mode === 'create' ? '确认创建' : '确认关联'}
      okButtonProps={{ loading: submitting }}
      destroyOnClose
      width={560}
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
          { value: 'create', label: '新建举一反三问题' },
          { value: 'attach', label: '关联已有' },
        ]}
      />
      {mode === 'create' ? (
        <Form layout="vertical" className="[&_.ant-form-item]:!mb-3">
          <Form.Item label="问题标题" required extra="自动预填痛点首句（≤30 字），可修改">
            <Input
              showCount
              maxLength={GENERALIZATION_SUMMARY_MAX_LENGTH}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="自动预填，可修改"
            />
          </Form.Item>
          <Form.Item
            label="问题描述"
            required
            extra="建议写 现象+受阻点，如「控制台找不到退订/取消入口，列表超 50 条翻不到」"
          >
            <Input.TextArea
              rows={3}
              showCount
              maxLength={GENERALIZATION_SUMMARY_MAX_LENGTH}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="自动预填，可修改"
            />
          </Form.Item>
          <Form.Item
            label="可介入原因范畴"
            required
            extra="问题根因属于哪类可介入原因（六选一）——客户侧原因（如客户自己配置错误）不适合纳入"
          >
            <Select
              value={category}
              onChange={(v) => {
                setCategory(v)
                if (v !== 'other_intervenable') setCategoryOther('')
              }}
              placeholder="选择范畴"
              options={GENERALIZATION_CATEGORIES.map((c) => ({
                value: c,
                label: GENERALIZATION_CATEGORY_LABELS[c],
              }))}
              allowClear
            />
          </Form.Item>
          {category === 'other_intervenable' ? (
            <Form.Item label="具体原因" required extra="选「其他」时必填，将随问题保存并在清单/侧滑展示">
              <Input
                value={categoryOther}
                onChange={(e) => setCategoryOther(e.target.value)}
                placeholder="如：服务端资源配置默认值不合理"
                maxLength={100}
                showCount
              />
            </Form.Item>
          ) : null}
          <Form.Item
            label="共性范围"
            required
            extra="多场景共性：同类问题会在其他场景再现；跨产品共性：非单产品特例"
          >
            <Radio.Group
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              options={GENERALIZATION_SCOPES.map((s) => ({
                value: s,
                label: GENERALIZATION_SCOPE_LABELS[s],
              }))}
            />
          </Form.Item>
          <Form.Item label="关键词（可选）" extra="逗号或顿号分隔，供自动召回使用">
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="如：退订、批量删除"
              maxLength={200}
            />
          </Form.Item>
          {keywordWarning ? (
            <Tooltip title="极短或极通用的关键词会放大召回范围，建议加限定词（提示不强制）">
              <div className="text-xs text-amber-600">⚠ {keywordWarning}</div>
            </Tooltip>
          ) : null}
          <div className="mt-2 text-xs text-ink-500">
            根因分析、优化方案在创建后到「问题与举措 · 举一反三」页补充（本弹窗不填）。
          </div>
        </Form>
      ) : (
        <Form layout="vertical" className="[&_.ant-form-item]:!mb-3">
          <Form.Item
            label={`搜索进行中的举一反三问题${productKey ? '（当前产品优先）' : ''}`}
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
