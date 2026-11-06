import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Checkbox, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd'
import { DownloadOutlined, FolderAddOutlined, LinkOutlined, MailOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { downloadPostUseCallbackRecommendationsExcel } from '../../lib/postUseRating/callbackRecommendationsExport.js'
import {
  buildFollowupTableWorkbook,
  collectFollowupExportRows,
  downloadFollowupTableExcel,
  followupTableFilename,
  followupWorkbookToBase64,
  toJiraArchivePayload,
} from '../../lib/postUseRating/callbackFollowupTables.js'
import SendMailModal from '../mail/SendMailModal.jsx'
import { MAIL_PRESET_CALLBACK_VISIT } from '../../domain/mail.js'
import KeyCustomerStar from '../common/KeyCustomerStar.jsx'
import {
  archivePostUseJiraItems,
  listAssignees,
  listPostUseCallbackDecisions,
  listPostUseJiraItems,
  listPostUseVisitDispatch,
  markPostUseVisitDispatch,
  upsertPostUseCallbackDecisions,
} from '../../lib/postUseJiraClient.js'
import { buildUserOption, userOptionFilterOption } from '../../lib/userSelectOptions.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { canUsePostUseCallbackList } from '../../domain/auth/permissions.js'
import { allMatchingKeys, itemKeySubsetMatches, lookupBySubset } from '../../lib/postUseRating/itemKeyPeriod.js'

function decisionOf(map, itemKey) {
  // 2026-11-06 周期包含语义：任一被包含的已存键勾选 → 视为已勾选（拍板：处理过任一月即处理）
  const hits = lookupBySubset(map, itemKey)
  return {
    needCustomerVisit: hits.some((d) => d?.needCustomerVisit),
    needInternalTrace: hits.some((d) => d?.needInternalTrace),
  }
}

function EllipsisHover({ value }) {
  const text = String(value ?? '').trim()
  if (!text) return '—'
  return (
    <Tooltip title={<span className="whitespace-pre-line">{text}</span>} getPopupContainer={() => document.body}>
      <span className="block max-w-full truncate">{text}</span>
    </Tooltip>
  )
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {object[]} props.recommendations
 * @param {object[]} props.callbackNonTenRecords
 * @param {string} [props.scopeLabel]
 * @param {(originalTicketId: string) => void} [props.onOpenTicket]
 */
export default function PostUseCallbackProcessModal({
  open,
  onClose,
  recommendations = [],
  callbackNonTenRecords = [],
  scopeLabel = '当前范围',
  onOpenTicket,
}) {
  const { user } = useAuth()
  const canEdit = canUsePostUseCallbackList(user?.role)
  const navigate = useNavigate()
  const [decisions, setDecisions] = useState(() => new Map())
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [mailOpen, setMailOpen] = useState(false)
  /** 经办人候选列表 */
  const [assignees, setAssignees] = useState(/** @type {{ id: string; username: string; team: string }[]} */ ([]))
  /** itemKey → { id, username } */
  const [assigneeOverrides, setAssigneeOverrides] = useState(() => new Map())
  /** 已归档（产品部溯源）条目：itemKey 集合 + itemKey → { assigneeName }（Bug3，2026-11-04） */
  const [archivedKeys, setArchivedKeys] = useState(() => new Set())
  const [archivedItems, setArchivedItems] = useState(() => new Map())
  /** 客服部回访"已纳入"标记：itemKey 集合（需求8，2026-11-04：导出/发送即标记，不可逆） */
  const [dispatchedKeys, setDispatchedKeys] = useState(() => new Set())
  /** 快捷筛选（2026-11-06）：只看已纳入产品部回溯 / 已纳入客服部回访 */
  const [filterArchivedOnly, setFilterArchivedOnly] = useState(false)
  const [filterDispatchedOnly, setFilterDispatchedOnly] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    listAssignees()
      .then((res) => {
        if (!cancelled) setAssignees(res?.users || [])
      })
      .catch(() => {
        if (!cancelled) setAssignees([])
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const assigneeOptions = useMemo(
    () => assignees.map((person) => buildUserOption(person, assignees)),
    [assignees],
  )

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setLoading(true)
    listPostUseCallbackDecisions()
      .then((res) => {
        if (cancelled) return
        const next = new Map()
        for (const item of res?.items || []) {
          if (!item?.itemKey) continue
          next.set(item.itemKey, {
            needCustomerVisit: Boolean(item.needCustomerVisit),
            needInternalTrace: Boolean(item.needInternalTrace),
            sourceType: item.sourceType,
          })
        }
        setDecisions(next)
      })
      .catch((error) => {
        if (!cancelled) message.error(error?.message || '加载勾选状态失败')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  // 拉取已归档（产品部溯源）条目：归档列渲染"已纳入"Tag、经办人只读、rows 收集去重（Bug3）。
  // 注意 limit:-1 = 全量（limit:0 会经 Number(0)||100 截成 100 条，仓库既有坑）。
  const refreshArchivedItems = useCallback(async () => {
    const res = await listPostUseJiraItems({ limit: -1 })
    const items = res?.items || []
    const keys = new Set()
    const infoMap = new Map()
    for (const item of items) {
      if (!item?.itemKey) continue
      keys.add(item.itemKey)
      infoMap.set(item.itemKey, { assigneeName: item.assigneeName || '' })
    }
    setArchivedKeys(keys)
    setArchivedItems(infoMap)
  }, [])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    refreshArchivedItems().catch((error) => {
      if (!cancelled) message.error(error?.message || '加载已归档条目失败')
    })
    listPostUseVisitDispatch()
      .then((res) => {
        if (cancelled) return
        setDispatchedKeys(new Set((res?.items || []).map((item) => item.itemKey).filter(Boolean)))
      })
      .catch(() => {
        // 已纳入标记加载失败不阻断弹窗（decisions/归档仍可用），导出/发送时会再次尝试
      })
    return () => {
      cancelled = true
    }
  }, [open, refreshArchivedItems])

  // 2026-11-06 周期包含语义：已归档/已纳入按「存储键月份 ⊆ 行键月份」匹配（7 月归档 → Q3 行显示已纳入）
  const isArchived = useCallback(
    (itemKey) => {
      if (archivedKeys.has(itemKey)) return true
      for (const storedKey of archivedKeys) {
        if (itemKeySubsetMatches(itemKey, storedKey)) return true
      }
      return false
    },
    [archivedKeys],
  )
  const archivedInfoOf = useCallback(
    (itemKey) => {
      const exact = archivedItems.get(itemKey)
      if (exact) return exact
      for (const [storedKey, info] of archivedItems) {
        if (itemKeySubsetMatches(itemKey, storedKey)) return info
      }
      return null
    },
    [archivedItems],
  )
  const isDispatched = useCallback(
    (itemKey) => {
      if (dispatchedKeys.has(itemKey)) return true
      for (const storedKey of dispatchedKeys) {
        if (itemKeySubsetMatches(itemKey, storedKey)) return true
      }
      return false
    },
    [dispatchedKeys],
  )

  const currentKeys = useMemo(
    () => [
      ...(recommendations || []).map((item) => item.itemKey).filter(Boolean),
      ...(callbackNonTenRecords || []).map((item) => item.itemKey).filter(Boolean),
    ],
    [recommendations, callbackNonTenRecords],
  )
  const visitCount = currentKeys.filter((key) => decisions.get(key)?.needCustomerVisit).length
  const traceCount = currentKeys.filter((key) => decisions.get(key)?.needInternalTrace).length
  // 需求8：当前清单范围内已被标记"已纳入"（导出/发送过）的客服部回访条数
  const dispatchedCount = currentKeys.filter((key) => isDispatched(key)).length

  // 计算每个 tab 中勾选了产品部溯源但未指定经办人的行数（用于 tab 角标 + 存档提示）
  const pendingAssigneeQuestionnaire = useMemo(() => {
    return (recommendations || [])
      .filter((item) => item.itemKey && decisionOf(decisions, item.itemKey).needInternalTrace && !assigneeOverrides.get(item.itemKey)?.id)
      .map((item) => ({ itemKey: item.itemKey, customerName: item.customerName || '', productName: item.productName || '' }))
  }, [recommendations, decisions, assigneeOverrides])

  const pendingAssigneeCallback = useMemo(() => {
    return (callbackNonTenRecords || [])
      .filter((item) => item.itemKey && decisionOf(decisions, item.itemKey).needInternalTrace && !assigneeOverrides.get(item.itemKey)?.id)
      .map((item) => ({ itemKey: item.itemKey, customerName: item.customerName || '', productName: item.productName || '', originalTicketId: item.originalTicketId || '' }))
  }, [callbackNonTenRecords, decisions, assigneeOverrides])

  const persistDecision = async (itemKey, sourceType, patch) => {
    // 2026-11-06 周期包含语义：写入行键 + 同步其全部被包含子集键（Q3 勾选同步 7 月键；取消时全量写 false）
    const current = decisionOf(decisions, itemKey)
    const next = { ...current, ...patch, sourceType, itemKey }
    const related = allMatchingKeys(decisions, itemKey)
    const items = [next, ...related.filter((k) => k !== itemKey).map((k) => ({
      ...decisionOf(decisions, k),
      ...patch,
      sourceType,
      itemKey: k,
    }))]
    setDecisions((prev) => {
      const map = new Map(prev)
      for (const item of items) map.set(item.itemKey, item)
      return map
    })
    if (!canEdit) return
    setSavingKey(itemKey)
    try {
      await upsertPostUseCallbackDecisions(items)
    } catch (error) {
      setDecisions((prev) => {
        const map = new Map(prev)
        const latest = map.get(itemKey)
        if (
          latest?.needCustomerVisit === next.needCustomerVisit &&
          latest?.needInternalTrace === next.needInternalTrace
        ) {
          map.set(itemKey, current)
        }
        return map
      })
      message.error(error?.message || '保存勾选失败')
    } finally {
      setSavingKey('')
    }
  }

  // 按客户批量勾选：一次 API 调用持久化同一客户下所有产品的 itemKey
  const persistDecisionsBatch = async (itemKeys, sourceType, patch) => {
    const items = itemKeys.map((itemKey) => ({
      ...decisionOf(decisions, itemKey),
      ...patch,
      sourceType,
      itemKey,
    }))
    setDecisions((prev) => {
      const map = new Map(prev)
      for (const item of items) map.set(item.itemKey, item)
      return map
    })
    if (!canEdit) return
    setSavingKey(items[0]?.itemKey || '')
    try {
      await upsertPostUseCallbackDecisions(items)
    } catch (error) {
      message.error(error?.message || '保存勾选失败')
    } finally {
      setSavingKey('')
    }
  }

  const flagColumn = (flag, title) => ({
    title,
    dataIndex: flag,
    width: 92,
    fixed: 'right',
      render: (_value, row) => {
      // 需求8（2026-11-04）：已纳入（导出/发送过）的行不再显示勾选框（2026-11-06 含周期包含匹配）
      if (flag === 'needCustomerVisit' && isDispatched(row.itemKey)) {
        return <Tag color="blue">已纳入</Tag>
      }
      return (
        <Checkbox
          checked={Boolean(decisionOf(decisions, row.itemKey)[flag])}
          disabled={!canEdit || savingKey === row.itemKey}
          onChange={(event) =>
            persistDecision(row.itemKey, row.sourceType, { [flag]: event.target.checked })
          }
        />
      )
    },
  })

  // 官网问卷类按客户聚合：同一客户的多产品分行展示，显示列客户级合并单元格。
  // 行内顺序：先按客户（customerCode || customerName），再按产品名，保证同客户相邻以便 rowSpan。
  //
  // 2026-11-04 修复（Bug1/2）：antd 分页后 render 第三参 index 是「页内 index」，而旧的
  // questionnaireSpan/questionnaireGroupKeys 是「全量数组 index → 映射」——页内 index 查全量
  // 映射导致翻页后勾选态/合并单元格/经办人全部错位继承（首页客户的状态渲染到第 2 页）。
  // 现改为把分组信息直接预挂到每行对象上，render 按 row 自取，index 彻底退场。
  //
  // 2026-11-04 用户拍板（业务语义）：产品部回溯是产品维度动作（不同产品线归不同经办人），
  // 「产品部回溯」勾选列与经办人列行级独立（不做 rowSpan）；仅显示列与「客服部回访」
  // 勾选列保留客户级合并（回访对象是客户，一勾全选是既有便捷语义）。
  const questionnaireRows = useMemo(() => {
    const keyOf = (row) => String(row.customerCode || row.customerName || '').trim() || '匿名客户'
    const sorted = [...(recommendations || [])].sort(
      (a, b) =>
        keyOf(a).localeCompare(keyOf(b), 'zh')
        || String(a.productName || '').localeCompare(String(b.productName || ''), 'zh'),
    )
    // 客户分组信息预挂：首行 span=组行数，后续行 span=0（渲染时返回 rowSpan:0 吞行）
    let i = 0
    while (i < sorted.length) {
      let j = i
      const keys = []
      while (j < sorted.length && keyOf(sorted[j]) === keyOf(sorted[i])) {
        if (sorted[j].itemKey) keys.push(sorted[j].itemKey)
        j += 1
      }
      const span = j - i
      for (let k = i; k < j; k++) {
        sorted[k] = {
          ...sorted[k],
          __groupKeys: keys,
          __isGroupFirst: k === i,
          __groupSpan: span,
        }
      }
      i = j
    }
    return sorted
  }, [recommendations])

  // 快捷筛选派生（2026-11-06）：按"已纳入"状态过滤。过滤后同客户可能只剩部分行 →
  // 每行对象重新构建分组信息（__groupKeys 只含过滤后的组内键、span 重算），保证合并单元格正确。
  // （类型说明：recommendations prop 为 object[]，此处局部放宽 itemKey/分组字段访问）
  const filteredQuestionnaireRows = useMemo(() => {
    if (!filterArchivedOnly && !filterDispatchedOnly) return questionnaireRows
    /** @type {{ itemKey?: string; __groupKeys?: string[]; __isGroupFirst?: boolean; __groupSpan?: number }[]} */
    const typedRows = questionnaireRows
    const kept = typedRows.filter((row) => {
      if (filterArchivedOnly && !isArchived(row.itemKey || '')) return false
      if (filterDispatchedOnly && !isDispatched(row.itemKey || '')) return false
      return true
    })
    const keyOf = (row) => String(row.customerCode || row.customerName || '').trim() || '匿名客户'
    let i = 0
    while (i < kept.length) {
      let j = i
      const keys = []
      while (j < kept.length && keyOf(kept[j]) === keyOf(kept[i])) {
        if (kept[j].itemKey) keys.push(kept[j].itemKey)
        j += 1
      }
      const span = j - i
      for (let k = i; k < j; k++) {
        kept[k] = { ...kept[k], __groupKeys: keys, __isGroupFirst: k === i, __groupSpan: span }
      }
      i = j
    }
    return kept
  }, [questionnaireRows, filterArchivedOnly, filterDispatchedOnly, isArchived, isDispatched])

  // 投诉回访非10分 tab 同款过滤（行级无分组，直接 filter）
  const filteredCallbackRecords = useMemo(() => {
    if (!filterArchivedOnly && !filterDispatchedOnly) return callbackNonTenRecords
    /** @type {{ itemKey?: string }[]} */
    const typedRecords = callbackNonTenRecords
    return typedRecords.filter((row) => {
      if (filterArchivedOnly && !isArchived(row.itemKey || '')) return false
      if (filterDispatchedOnly && !isDispatched(row.itemKey || '')) return false
      return true
    })
  }, [callbackNonTenRecords, filterArchivedOnly, filterDispatchedOnly, isArchived, isDispatched])

  // 客户级合并单元格的通用 render 包装：非组首行返回 rowSpan:0 吞行。
  const mergedCell = (value, row, render) => {
    if (!row.__isGroupFirst) return { children: '', props: { rowSpan: 0 } }
    return { children: render ? render(value) : value, props: { rowSpan: row.__groupSpan } }
  }

  // 客户级合并勾选列（仅用于「客服部回访」needCustomerVisit：回访对象是客户，批量勾选）。
  // 需求8（2026-11-04）：组内任一 itemKey 已被标记"已纳入"（导出/发送过）→ 整组显示已纳入 Tag；
  // 全部标记显示"已纳入"，部分标记显示"已纳入（部分）"，勾选框不再渲染。
  const visitFlagColumn = (flag, title) => ({
    title,
    width: 92,
    fixed: 'right',
    render: (_value, row) => {
      if (!row.__isGroupFirst) return { children: '', props: { rowSpan: 0 } }
      const keys = row.__groupKeys
      const dispatched = keys.filter((k) => isDispatched(k))
      if (dispatched.length) {
        const all = dispatched.length === keys.length
        return {
          children: <Tag color="blue">已纳入{all ? '' : '（部分）'}</Tag>,
          props: { rowSpan: row.__groupSpan },
        }
      }
      const checkedList = keys.map((k) => Boolean(decisionOf(decisions, k)[flag]))
      const allChecked = checkedList.length > 0 && checkedList.every(Boolean)
      const someChecked = checkedList.some(Boolean)
      return {
        children: (
          <Checkbox
            checked={allChecked}
            indeterminate={!allChecked && someChecked}
            disabled={!canEdit || savingKey === (keys[0] || '')}
            onChange={(event) =>
              persistDecisionsBatch(keys, 'questionnaire', { [flag]: event.target.checked })
            }
          />
        ),
        props: { rowSpan: row.__groupSpan },
      }
    },
  })

  // 行级勾选列（用于「产品部回溯」needInternalTrace：每行=客户×产品 独立决策）；
  // 已归档行（Bug3）显示"已纳入"Tag、无勾选框——从反馈库删除归档条目后弹窗重开即恢复初始态。
  const rowFlagColumn = (flag, title) => ({
    title,
    width: 92,
    fixed: 'right',
    render: (_value, row) => {
      if (isArchived(row.itemKey)) {
        return <Tag color="blue">已纳入</Tag>
      }
      return (
        <Checkbox
          checked={Boolean(decisionOf(decisions, row.itemKey)[flag])}
          disabled={!canEdit || savingKey === row.itemKey}
          onChange={(event) =>
            persistDecision(row.itemKey, row.sourceType, { [flag]: event.target.checked })
          }
        />
      )
    },
  })

  const questionnaireColumns = [
    // 2026-11-06 列宽调整：数据月份/产品名称/反馈原因收窄，建议回访原因加宽，触发类型去掉"建议"前缀
    { title: '数据月份', dataIndex: 'importMonths', width: 92, render: (value) => (value || []).filter(Boolean).join('、') },
    {
      title: '客户名称',
      dataIndex: 'customerName',
      width: 160,
      ellipsis: true,
      render: (value, row) => mergedCell(<span>{value}<KeyCustomerStar isKeyCustomer={row.isKeyCustomer} /></span>, row),
    },
    {
      title: '客户编码',
      dataIndex: 'customerCode',
      width: 140,
      ellipsis: true,
      render: (value, row) => mergedCell(value || '—', row),
    },
    { title: '产品名称', dataIndex: 'productName', width: 110, ellipsis: true },
    {
      title: '触发类型',
      dataIndex: 'triggerType',
      width: 150,
      ellipsis: true,
      render: (value, row) => mergedCell(value || '—', row),
    },
    { title: '7分以下总次数', dataIndex: 'lowScoreLt7Count', width: 120 },
    { title: '7分以下分布', dataIndex: 'scoreBreakdown', width: 240, ellipsis: true },
    { title: '最近反馈时间', dataIndex: 'latestFeedbackAt', width: 170, ellipsis: true },
    { title: '涉及渠道', dataIndex: 'channels', width: 160, render: (value) => (value || []).join('；') },
    {
      title: '反馈原因',
      dataIndex: 'feedbackReasonSummary',
      width: 170,
      ellipsis: true,
      render: (value) => <EllipsisHover value={value} />,
    },
    {
      title: '建议回访原因',
      dataIndex: 'recommendedReason',
      width: 340,
      ellipsis: true,
      render: (value) => <EllipsisHover value={value} />,
    },
    visitFlagColumn('needCustomerVisit', '客服部回访'),
    rowFlagColumn('needInternalTrace', '产品部溯源'),
    {
      // 经办人列行级独立（2026-11-04 用户拍板：不同产品分别指定经办人；已纳入行只读显示归档经办人）
      title: '产品部溯源经办人',
      key: '__assignee',
      width: 120,
      fixed: 'right',
      render: (_v, row) => {
        if (isArchived(row.itemKey)) {
          const info = archivedInfoOf(row.itemKey)
          return <span className="text-ink-600">{info?.assigneeName || '—'}</span>
        }
        if (!decisionOf(decisions, row.itemKey).needInternalTrace) return '—'
        const current = assigneeOverrides.get(row.itemKey)
        return (
          <Select
            showSearch
            size="small"
            className="w-full"
            placeholder="经办人"
            value={current?.id || undefined}
            options={assigneeOptions}
            filterOption={userOptionFilterOption}
            onChange={(value) => {
              const person = assignees.find((p) => p.id === value)
              setAssigneeOverrides((prev) => {
                const map = new Map(prev)
                if (person) map.set(row.itemKey, { id: person.id, username: person.username })
                else map.delete(row.itemKey)
                return map
              })
            }}
          />
        )
      },
    },
  ]

  const callbackColumns = [
    { title: '具体投诉产品', dataIndex: 'productName', width: 140, ellipsis: true },
    {
      title: '原工单编号',
      dataIndex: 'originalTicketId',
      width: 180,
      render: (value) => {
        if (!value) return '—'
        if (!onOpenTicket) return value
        return (
          <Button type="link" size="small" className="!px-0" onClick={() => onOpenTicket(value)}>
            {value}
          </Button>
        )
      },
    },
    { title: '投诉整体服务评价', dataIndex: 'score', width: 140 },
    { title: '客户名称', dataIndex: 'customerName', width: 150, ellipsis: true, render: (value, row) => <span>{value}<KeyCustomerStar isKeyCustomer={row.isKeyCustomer} /></span> },
    { title: '集团客户编码', dataIndex: 'customerCode', width: 140, ellipsis: true },
    { title: '不满原因', dataIndex: 'dissatisfactionReason', width: 180, ellipsis: true },
    { title: '客户请求内容', dataIndex: 'customerRequest', width: 200, ellipsis: true },
    { title: '问题原因', dataIndex: 'problemCause', width: 200, ellipsis: true },
    flagColumn('needCustomerVisit', '客服部回访'),
    {
      title: '产品部溯源',
      dataIndex: 'needInternalTrace',
      width: 92,
      fixed: 'right',
      render: (_v, row) => {
        if (isArchived(row.itemKey)) return <Tag color="blue">已纳入</Tag>
        return (
          <Checkbox
            checked={Boolean(decisionOf(decisions, row.itemKey).needInternalTrace)}
            disabled={!canEdit || savingKey === row.itemKey}
            onChange={(event) =>
              persistDecision(row.itemKey, row.sourceType, { needInternalTrace: event.target.checked })
            }
          />
        )
      },
    },
    {
      title: '产品部溯源经办人',
      key: '__assignee',
      width: 120,
      fixed: 'right',
      render: (_v, row) => {
        if (isArchived(row.itemKey)) {
          const info = archivedInfoOf(row.itemKey)
          return <span className="text-ink-600">{info?.assigneeName || '—'}</span>
        }
        if (!decisionOf(decisions, row.itemKey).needInternalTrace) return '—'
        const current = assigneeOverrides.get(row.itemKey)
        return (
          <Select
            showSearch
            size="small"
            className="w-full"
            placeholder="经办人"
            value={current?.id || undefined}
            options={assigneeOptions}
            filterOption={userOptionFilterOption}
            onChange={(value) => {
              const person = assignees.find((p) => p.id === value)
              setAssigneeOverrides((prev) => {
                const map = new Map(prev)
                if (person) map.set(row.itemKey, { id: person.id, username: person.username })
                else map.delete(row.itemKey)
                return map
              })
            }}
          />
        )
      },
    },
  ]

  // 需求8（2026-11-04）：导出/发送成功后按 itemKey 标记"已纳入"（不可逆）；
  // 已纳入的条目不再进入后续导出/发送收集范围。标记失败不阻断主流程。
  const markVisitDispatched = async (rows, dispatchedVia) => {
    const pending = rows.filter((row) => row.itemKey && !isDispatched(row.itemKey))
    if (!pending.length) return
    try {
      const res = await markPostUseVisitDispatch(
        pending.map((row) => ({
          itemKey: row.itemKey,
          sourceType: row.sourceType,
          dispatchedVia,
          customerName: row.客户名称 || '',
          productName: row.产品名称 || '',
          importMonth: row.数据月份 || '',
        })),
      )
      const next = new Set(dispatchedKeys)
      for (const item of res?.items || []) {
        if (item?.itemKey) next.add(item.itemKey)
      }
      setDispatchedKeys(next)
    } catch {
      message.warning('标记"已纳入"失败，可重新导出补标')
    }
  }

  const exportVisit = () => {
    const rows = collectFollowupExportRows(recommendations, callbackNonTenRecords, decisions, 'needCustomerVisit')
      .filter((row) => !isDispatched(row.itemKey))
    if (!rows.length) {
      message.info('请先勾选需要客服部回访的记录（已纳入的不再重复导出）')
      return
    }
    downloadFollowupTableExcel(rows, '待客服部回访表', scopeLabel)
    void markVisitDispatched(rows, 'export')
  }

  const exportTrace = () => {
    const rows = collectFollowupExportRows(recommendations, callbackNonTenRecords, decisions, 'needInternalTrace')
    if (!rows.length) {
      message.info('请先勾选需要产品部溯源的记录')
      return
    }
    downloadFollowupTableExcel(rows, '待产品部溯源表', scopeLabel)
  }

  const archiveTrace = async () => {
    const allRows = collectFollowupExportRows(recommendations, callbackNonTenRecords, decisions, 'needInternalTrace')
    // 已归档条目不再重复归档（Bug3：与"已纳入"Tag 联动；2026-11-06 含周期包含匹配）
    const rows = allRows.filter((row) => !isArchived(row.itemKey))
    if (!rows.length) {
      message.info(allRows.length ? '勾选的记录均已纳入产品部溯源' : '请先勾选需要产品部溯源的记录')
      return
    }
    // 逐条校验：所有勾选产品部溯源的行必须指定经办人
    const missingAssigneeKeys = rows.filter((row) => !assigneeOverrides.get(row.itemKey)?.id)
    if (missingAssigneeKeys.length) {
      // 按 tab 分类，附带客户/产品信息
      const questionnaireMissing = pendingAssigneeQuestionnaire
      const callbackMissing = pendingAssigneeCallback
      const parts = []
      if (questionnaireMissing.length) {
        const detail = questionnaireMissing.slice(0, 3)
          .map((m) => `${m.customerName || '—'}-${m.productName || '—'}`)
          .join('、')
        const more = questionnaireMissing.length > 3 ? `等${questionnaireMissing.length}条` : ''
        parts.push(`官网问卷类 ${questionnaireMissing.length} 条（${detail}${more}）`)
      }
      if (callbackMissing.length) {
        const detail = callbackMissing.slice(0, 3)
          .map((m) => `${m.customerName || '—'}-${m.productName || '—'}（工单${m.originalTicketId || '—'}）`)
          .join('、')
        const more = callbackMissing.length > 3 ? `等${callbackMissing.length}条` : ''
        parts.push(`投诉回访非10分 ${callbackMissing.length} 条（${detail}${more}）`)
      }
      const detailStr = parts.length ? `：${parts.join('；')}` : ''
      message.warning(`还有 ${missingAssigneeKeys.length} 条勾选产品部溯源的记录未指定经办人${detailStr}。请到对应 tab 逐条指定后再存档`)
      return
    }
    setArchiving(true)
    try {
      const saved = await archivePostUseJiraItems(rows.map((row) => toJiraArchivePayload(row, assigneeOverrides)))
      const savedCount = saved?.items?.length || rows.length
      // 归档成功：刷新已归档集合（渲染"已纳入"Tag + 经办人只读）；不再清空 assigneeOverrides——
      // 已归档行不再渲染 Select，未归档行的经办人选择不受影响。
      await refreshArchivedItems()
      message.success({
        content: (
          <span>
            已存档 {savedCount} 条到「反馈库 · 用后即评满意度 · 产品部溯源」
            <Button
              type="link"
              size="small"
              className="!px-1"
              onClick={() => {
                onClose()
                navigate('/feedbacks?lane=post_use&view=trace&source=post_use_rating')
              }}
            >
              立即查看
            </Button>
          </span>
        ),
        duration: 6,
      })
    } catch (error) {
      message.error(error?.message || '存档失败')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <Modal
      title="查看并处理建议回访/溯源清单"
      open={open}
      onCancel={onClose}
      width={1200}
      footer={null}
      destroyOnClose
      styles={{ body: { maxHeight: '78vh', overflowY: 'auto' } }}
    >
      <Typography.Paragraph type="secondary" className="!mb-3">
        可同时勾选客服部回访与产品部溯源。勾选会保存，导出与一键存档只处理已勾选的记录。
        勾选与已纳入按数据月份独立（2026-11-06 起）：上月勾选/归档不影响本月行。
      </Typography.Paragraph>
      {/* 快捷筛选（2026-11-06 用户拍板）：只看已纳入产品部回溯 / 已纳入客服部回访 的行 */}
      <div className="mb-2 flex flex-wrap items-center gap-4">
        <Checkbox checked={filterArchivedOnly} onChange={(e) => setFilterArchivedOnly(e.target.checked)}>
          已纳入产品部回溯
        </Checkbox>
        <Checkbox checked={filterDispatchedOnly} onChange={(e) => setFilterDispatchedOnly(e.target.checked)}>
          已纳入客服部回访
        </Checkbox>
      </div>
      <Tabs
        items={[
          {
            key: 'questionnaire',
            label: (
              <Badge count={pendingAssigneeQuestionnaire.length} size="small" offset={[6, 0]}>
                <span>官网问卷类建议回访({filteredQuestionnaireRows.length})</span>
              </Badge>
            ),
            children: (
              <Table
                size="small"
                rowKey={(row) => row.itemKey || `${row.customerCode}-${row.productName}`}
                loading={loading}
                pagination={{ pageSize: 12 }}
                scroll={{ x: 2150 }}
                dataSource={filteredQuestionnaireRows}
                columns={questionnaireColumns}
                locale={{ emptyText: '当前范围内暂无官网问卷类建议回访记录' }}
              />
            ),
          },
          {
            key: 'callback',
            label: (
              <Badge count={pendingAssigneeCallback.length} size="small" offset={[6, 0]}>
                <span>投诉回访非10分({filteredCallbackRecords.length})</span>
              </Badge>
            ),
            children: (
              <Table
                size="small"
                rowKey={(row) => row.itemKey || row.id || row.originalTicketId}
                loading={loading}
                pagination={{ pageSize: 12 }}
                scroll={{ x: 1800 }}
                dataSource={filteredCallbackRecords}
                columns={callbackColumns}
                locale={{ emptyText: '当前范围内暂无投诉回访非10分记录' }}
              />
            ),
          },
        ]}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <Typography.Text type="secondary">
          已勾选客服部回访 {visitCount} 条 · 产品部溯源 {traceCount} 条
          {dispatchedCount ? ` · 客服部回访已纳入 ${dispatchedCount} 条` : ''}
        </Typography.Text>
        <Space wrap>
          <Tooltip title="下载当前范围的双表原始清单">
            <Button
              icon={<DownloadOutlined />}
              onClick={() =>
                downloadPostUseCallbackRecommendationsExcel(
                  recommendations,
                  callbackNonTenRecords,
                  scopeLabel,
                )
              }
            >
              下载原始清单
            </Button>
          </Tooltip>
          <Button icon={<DownloadOutlined />} onClick={exportVisit}>
            导出待客服部回访表
          </Button>
          <Tooltip title={visitCount ? '' : '请先勾选需要客服部回访的记录'}>
            <Button
              icon={<MailOutlined />}
              disabled={!canEdit || !visitCount}
              onClick={() => setMailOpen(true)}
            >
              发送待客服部回访
            </Button>
          </Tooltip>
          <Button icon={<DownloadOutlined />} onClick={exportTrace}>
            导出待产品部溯源表
          </Button>
          <Tooltip title={canEdit ? '' : '仅管理员与体验运营可处理清单并存档'}>
            <Button
              type="primary"
              icon={<FolderAddOutlined />}
              loading={archiving}
              disabled={!canEdit}
              onClick={() => void archiveTrace()}
            >
              存档「产品部溯源」
            </Button>
          </Tooltip>
          <Tooltip title="跳转反馈库 · 用后即评满意度 · 产品部回溯视图">
            <Button
              icon={<LinkOutlined />}
              onClick={() => {
                onClose()
                navigate('/feedbacks?lane=post_use&view=trace&source=post_use_rating')
              }}
            >
              查看产品部回溯
            </Button>
          </Tooltip>
        </Space>
      </div>
      <SendMailModal
        open={mailOpen}
        onClose={() => setMailOpen(false)}
        defaultTemplateId={MAIL_PRESET_CALLBACK_VISIT}
        dataSourceType="post_use_rating"
        periodLabel={scopeLabel}
        linkKind="workbench"
        canSend={canEdit && visitCount > 0}
        disabledReason={visitCount ? '' : '请先勾选需要客服部回访的记录'}
        buildAttachment={async () => {
          const rows = collectFollowupExportRows(
            recommendations,
            callbackNonTenRecords,
            decisions,
            'needCustomerVisit',
          ).filter((row) => !isDispatched(row.itemKey))
          if (!rows.length) return null
          const wb = buildFollowupTableWorkbook(rows, '待客服部回访表')
          return {
            filename: followupTableFilename('待客服部回访表', scopeLabel),
            mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            contentBase64: followupWorkbookToBase64(wb),
          }
        }}
        onSent={async () => {
          // 发送成功 → 与本次附件一致的未纳入行标记（buildAttachment 过滤逻辑同款重算）
          const rows = collectFollowupExportRows(
            recommendations,
            callbackNonTenRecords,
            decisions,
            'needCustomerVisit',
          ).filter((row) => !isDispatched(row.itemKey))
          await markVisitDispatched(rows, 'mail')
        }}
      />
    </Modal>
  )
}
