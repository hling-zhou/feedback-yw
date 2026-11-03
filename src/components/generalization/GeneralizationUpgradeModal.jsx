import { useEffect, useState } from 'react'
import { Input, Modal, Radio, Select, Tooltip, Typography, message } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import FieldLabel from '../FieldLabel.jsx'
import {
  upgradeActionToGeneralization,
  listGeneralizationIssuesForAction,
  listGeneralizationIssues,
} from '../../lib/generalizationClient.js'
import {
  GENERALIZATION_CATEGORIES,
  GENERALIZATION_CATEGORY_LABELS,
  GENERALIZATION_SCOPES,
  GENERALIZATION_SCOPE_LABELS,
  GENERALIZATION_SUMMARY_MAX_LENGTH,
} from '../../domain/generalizationIssue.js'

/** @typedef {import('../../domain/actionItem.js').ActionItem} ActionItem */

/**
 * 举措升级举一反三 Modal（v3.1/v3.3/v3.4 + 11-04 体验优化）：
 * - 双模式：create（新建——title=举措内容首句、summary=举措详情、**optimization 预填=举措内容（可改可清空）**、
 *   root_cause 不出现）/ link（Select 搜索 in_progress issue）。
 * - 证据预览：dataSourceType 过滤（仅投诉/咨询，评价不纳入预览）+ 数量（后端 collectActionEvidence 同口径过滤）。
 * - 409 防重：in_progress 升级件存在即拦（按钮侧同步隐藏；服务端双保险）。
 * - 11-04 优化：说明压缩为顶部一条摘要（细节入 Tooltip）；字段标签必填 * 标记 + 深色与说明灰拉开层级；
 *   「其他」范畴追加自定义输入框；提交 30s 超时兜底。
 *
 * @param {Object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {ActionItem | null} props.item - 宿主举措
 * @param {() => void} [props.onUpgraded] - 升级成功回调（宿主刷新已升级态）
 */
export default function GeneralizationUpgradeModal({ open, onClose, item, onUpgraded }) {
  const [messageApi, contextHolder] = message.useMessage()
  const [mode, setMode] = useState('create')
  const [title, setTitle] = useState('')
  const [summary, setSummary] = useState('')
  const [category, setCategory] = useState(null)
  const [categoryOther, setCategoryOther] = useState('')
  const [scope, setScope] = useState(null)
  const [optimization, setOptimization] = useState('')
  const [linkIssueId, setLinkIssueId] = useState(null)
  const [issueOptions, setIssueOptions] = useState([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const actionContent = String(item?.content || '').trim()
  const actionDetail = String(item?.detail || '').trim()
  const evidenceCount = (item?.evidenceRecordIds || []).filter(Boolean).length

  /** 打开时初始化：预填 + 默认 create */
  const afterOpenChange = (visible) => {
    if (!visible) return
    setMode('create')
    // 预填（v3.4 23:39 定稿）：title=举措内容首句、summary=举措详情、optimization=举措内容（可改可清空）、root_cause 不出现
    setTitle(actionContent.split(/[。！!？?\n]/)[0]?.slice(0, 30) || actionContent.slice(0, 30))
    setSummary(actionDetail.slice(0, GENERALIZATION_SUMMARY_MAX_LENGTH))
    setOptimization(actionContent)
    setCategory(null)
    setCategoryOther('')
    setScope(null)
    setLinkIssueId(null)
    setIssueOptions([])
  }

  const handleSearchIssues = async (text) => {
    const q = String(text || '').trim()
    if (!q) return
    setSearching(true)
    try {
      const result = await listGeneralizationIssues({
        keyword: q,
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
    if (!item?.id) return
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
      const trimmedOther = categoryOther.trim()
      if (category === 'other_intervenable' && !trimmedOther) {
        messageApi.warning('选择「其他」时请填写具体原因')
        return
      }
      if (!scope) {
        messageApi.warning('请选择共性范围')
        return
      }
      setSubmitting(true)
      try {
        const TIMEOUT_MS = 30_000
        await Promise.race([
          upgradeActionToGeneralization({
            actionItemId: item.id,
            mode: 'create',
            title: trimmedTitle.slice(0, GENERALIZATION_SUMMARY_MAX_LENGTH),
            summary: trimmedSummary.slice(0, GENERALIZATION_SUMMARY_MAX_LENGTH),
            category,
            scope,
            ...(category === 'other_intervenable' && trimmedOther
              ? { categoryOther: trimmedOther.slice(0, 100) }
              : {}),
            // optimization 预填=举措内容（可改可清空——创建允许空口径）
            optimization: optimization.trim() || undefined,
          }),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('升级请求超时（30 秒），请检查网络后重试')), TIMEOUT_MS)
          }),
        ])
        messageApi.success('已升级为举一反三问题，证据已全量继承')
        onUpgraded?.()
        onClose()
      } catch (err) {
        const text = err instanceof Error ? err.message : '升级失败'
        if (text.includes('不能重复升级')) messageApi.warning(text)
        else messageApi.error(text)
      } finally {
        setSubmitting(false)
      }
      return
    }

    // mode=link
    if (!linkIssueId) {
      messageApi.warning('请选择要关联的举一反三问题')
      return
    }
    setSubmitting(true)
    try {
      const TIMEOUT_MS = 30_000
      await Promise.race([
        upgradeActionToGeneralization({
          actionItemId: item.id,
          mode: 'link',
          issueId: linkIssueId,
        }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new Error('关联请求超时（30 秒），请检查网络后重试')), TIMEOUT_MS)
        }),
      ])
      messageApi.success('已关联到举一反三问题，证据已全量继承')
      onUpgraded?.()
      onClose()
    } catch (err) {
      const text = err instanceof Error ? err.message : '升级失败'
      if (text.includes('不能重复升级')) messageApi.warning(text)
      else messageApi.error(text)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title="升级为举一反三"
      afterOpenChange={afterOpenChange}
      onCancel={onClose}
      onOk={() => void handleSubmit()}
      okText={mode === 'create' ? '确认升级' : '确认关联'}
      okButtonProps={{ loading: submitting }}
      destroyOnClose
      width={600}
    >
      {contextHolder}
      {/* 顶部：一条摘要 + 细节 Tooltip（11-04 优化——原三段灰字平铺压缩为一行） */}
      <div className="mb-3 flex items-start gap-1.5">
        <Typography.Text type="secondary" className="text-xs">
          初始证据：本举措关联的工单将全量继承（仅投诉/咨询，评价不纳入）
          {evidenceCount ? `，共 ${evidenceCount} 条待过滤挂载` : ''}。
        </Typography.Text>
        <Tooltip
          title={
            <div className="space-y-1">
              <div>举措：{actionContent.slice(0, 80) || '—'}</div>
              <div>升级后新建独立举一反三问题，两边编辑互不影响，仅保留关联跳转。</div>
              <div>根因分析不在升级时填写——升级后在「举一反三」详情中补全。</div>
            </div>
          }
        >
          <InfoCircleOutlined className="mt-0.5 text-xs text-ink-400" />
        </Tooltip>
      </div>
      <Radio.Group
        value={mode}
        onChange={(e) => setMode(e.target.value)}
        className="mb-4"
        options={[
          { value: 'create', label: '新建举一反三问题' },
          { value: 'link', label: '关联已有' },
        ]}
      />
      {mode === 'create' ? (
        <div className="space-y-3">
          <div>
            <FieldLabel required>问题标题</FieldLabel>
            <Input
              showCount
              maxLength={GENERALIZATION_SUMMARY_MAX_LENGTH}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="预填举措内容首句，可修改"
            />
          </div>
          <div>
            <FieldLabel required>问题描述</FieldLabel>
            <Input.TextArea
              rows={3}
              showCount
              maxLength={GENERALIZATION_SUMMARY_MAX_LENGTH}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="预填举措详情，可修改"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel required>可介入原因范畴</FieldLabel>
              <Select
                className="!w-full"
                value={category}
                placeholder="六选一"
                options={GENERALIZATION_CATEGORIES.map((c) => ({
                  value: c,
                  label: GENERALIZATION_CATEGORY_LABELS[c],
                }))}
                onChange={(v) => {
                  setCategory(v)
                  if (v !== 'other_intervenable') setCategoryOther('')
                }}
                allowClear
              />
            </div>
            <div>
              <FieldLabel required>共性范围</FieldLabel>
              <Radio.Group
                value={scope}
                onChange={(e) => setScope(e.target.value)}
                options={GENERALIZATION_SCOPES.map((s) => ({
                  value: s,
                  label: GENERALIZATION_SCOPE_LABELS[s],
                }))}
              />
            </div>
          </div>
          {category === 'other_intervenable' ? (
            <div>
              <FieldLabel required>具体原因</FieldLabel>
              <Input
                value={categoryOther}
                onChange={(e) => setCategoryOther(e.target.value)}
                placeholder="如：服务端资源配置默认值不合理"
                maxLength={100}
                showCount
              />
            </div>
          ) : null}
          <div>
            <FieldLabel hint="预填举措内容，可清空">优化方案</FieldLabel>
            <Input.TextArea
              rows={2}
              showCount
              maxLength={2000}
              value={optimization}
              onChange={(e) => setOptimization(e.target.value)}
              placeholder="预填举措内容，可清空——创建允许为空，稍后在「举一反三」页补全"
            />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <FieldLabel required>搜索进行中的举一反三问题</FieldLabel>
          <Select
            showSearch
            filterOption={false}
            className="!w-full"
            placeholder="输入关键词搜索"
            value={linkIssueId}
            onSearch={(v) => void handleSearchIssues(v)}
            onChange={setLinkIssueId}
            options={issueOptions}
            loading={searching}
            notFoundContent={searching ? '搜索中…' : '输入关键词搜索'}
            allowClear
          />
          <Typography.Text type="secondary" className="block text-xs">
            选中即确认为已关联，本举措的工单证据将全量继承到该问题。
          </Typography.Text>
        </div>
      )}
    </Modal>
  )
}

/**
 * 举措已升级的举一反三列表（已升级态——中间表反查）。
 * 独立导出供 ActionItemDrawer 使用（升级按钮/已升级列表切换）。
 *
 * @param {Object} props
 * @param {string} props.actionItemId
 * @returns {{ list: Array<{ issueId: string, kind: string, status: string, title: string, id?: string, category?: string, occurrenceCount?: number, originActionId?: string }>, loading: boolean, reload: () => Promise<void> }}
 *   list 元素 = 服务端 listIssuesForAction 行（issueId/kind/status/title 必有；id/category/
 *   occurrenceCount/originActionId 为 issue 反查字段——清单展示与「由本举措升级创建」判断用）
 */
export function useActionGeneralizations(actionItemId) {
  const [list, setList] = useState([])
  const [loading, setLoading] = useState(false)
  const reload = async () => {
    if (!actionItemId) {
      setList([])
      return
    }
    setLoading(true)
    try {
      const result = await listGeneralizationIssuesForAction(actionItemId)
      setList(result.issues || [])
    } catch {
      setList([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionItemId])
  return { list, loading, reload: async () => { await reload() } }
}
