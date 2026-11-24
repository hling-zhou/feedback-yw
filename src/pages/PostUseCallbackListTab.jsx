import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button, Checkbox, Select, Space, Table, Tabs, Tag, Tooltip, Typography, message } from 'antd'
import { DownloadOutlined, FolderAddOutlined, MailOutlined, ReloadOutlined } from '@ant-design/icons'
import {
  downloadPostUseCallbackRecommendationsExcel,
} from '../lib/postUseRating/callbackRecommendationsExport.js'
import {
  buildFollowupTableWorkbook,
  collectFollowupExportRows,
  followupTableFilename,
  followupWorkbookToBase64,
  toJiraArchivePayload,
} from '../lib/postUseRating/callbackFollowupTables.js'
import SendMailModal from '../components/mail/SendMailModal.jsx'
import { MAIL_PRESET_CALLBACK_VISIT } from '../domain/mail.js'
import KeyCustomerStar from '../components/common/KeyCustomerStar.jsx'
import {
  archivePostUseJiraItems,
  listAssignees,
  listPostUseCallbackDecisions,
  listPostUseJiraItems,
  listPostUseVisitDispatch,
  markPostUseVisitDispatch,
  upsertPostUseCallbackDecisions,
} from '../lib/postUseJiraClient.js'
import { batchPreloadPostUseVisits } from '../lib/postUseVisitClient.js'
import { buildUserOption, userOptionFilterOption } from '../lib/userSelectOptions.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useInsights } from '../context/InsightsContext.jsx'
import { canUsePostUseCallbackList } from '../domain/auth/permissions.js'
import { allMatchingKeys, itemKeySubsetMatches, lookupBySubset } from '../lib/postUseRating/itemKeyPeriod.js'
import { paginationShowTotal } from '../lib/paginationTotal.js'
import { filterRecordsForScope } from '../snapshots/recordScope.js'
import {
  getPostUseRatingProductNames,
  scopePostUseRatingRecords,
} from '../lib/productCatalog/postUseRatingProducts.js'
import { getCatalogProducts } from '../lib/productCatalogLoader.js'
import { buildPostUseCallbackLists } from '../lib/postUseRating/callbackListModel.js'
import { buildTicketRecordIndex } from '../lib/followUpSatisfactionImport.js'
import { normalizeTicketId } from '../lib/desensitize.js'
import { useColumnResize } from '../hooks/useColumnResize.js'
import { sumColumnsWidth } from '../lib/columnWidths.js'

const PAGE_SIZE = 20

function decisionOf(map, itemKey) {
  // 2026-11-06 周期包含语义（与弹窗同源）：任一被包含的已存键勾选 → 视为已勾选
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
 * 反馈库 · 用后即评满意度 ·「建议回访/溯源清单」视图（2026-11-21 平铺需求）。
 * 由工作台弹窗（PostUseCallbackProcessModal，已删除）平移而来，业务逻辑原样保留；
 * 工作台双入口与弹窗已于同日拍板下线——本视图是清单功能唯一入口（单处维护）。
 * 口径一致性由 callbackListModel.test.js 对拍守卫锚定（storyModel 两字段 vs 本视图直调同源）。
 *
 * 数据链（与原弹窗同口径）：周期切片 → 目录 scope → 产品「先切后建」→ 共享构建函数。
 * 产品下拉语义 = 先切 records 再 build——改变进入构建的评价记录范围，
 * 不是对清单行做后过滤；跨产品高频低分累计随所选范围重算。
 *
 * @param {object} props
 * @param {(record: object) => void} props.onOpenTicket 打开工单详情抽屉（宿主 selectFeedback）
 * @param {() => void} props.onNavigateToTrace 跳转产品部溯源视图（存档成功「立即查看」）
 */
export default function PostUseCallbackListTab({ onOpenTicket, onNavigateToTrace }) {
  const { user } = useAuth()
  const { feedbacks, currentPeriod, settings } = useInsights()
  // 操作权限（勾选/存档/发送）与弹窗同构：admin+editor（canUsePostUseCallbackList）
  const canEdit = canUsePostUseCallbackList(user?.role)

  const [selectedProduct, setSelectedProduct] = useState('')
  const [decisions, setDecisions] = useState(() => new Map())
  const [loading, setLoading] = useState(false)
  const [savingKey, setSavingKey] = useState('')
  const [archiving, setArchiving] = useState(false)
  const [mailOpen, setMailOpen] = useState(false)
  /** 经办人候选列表 */
  const [assignees, setAssignees] = useState(/** @type {{ id: string; username: string; team: string }[]} */ ([]))
  /** itemKey → { id, username } */
  const [assigneeOverrides, setAssigneeOverrides] = useState(() => new Map())
  /** 已归档（产品部溯源）条目：itemKey 集合 + itemKey → { assigneeName } */
  const [archivedKeys, setArchivedKeys] = useState(() => new Set())
  const [archivedItems, setArchivedItems] = useState(() => new Map())
  /** 省代表回访「已纳入」标记：itemKey 集合（导出/发送即标记，不可逆） */
  const [dispatchedKeys, setDispatchedKeys] = useState(() => new Set())
  /** 快捷筛选：只看已纳入产品部回溯 / 已纳入省代表回访 */
  const [filterArchivedOnly, setFilterArchivedOnly] = useState(false)
  const [filterDispatchedOnly, setFilterDispatchedOnly] = useState(false)
  const stickyChromeRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [stickyChromeHeight, setStickyChromeHeight] = useState(0)

  useEffect(() => {
    const chrome = stickyChromeRef.current
    if (!chrome) return undefined
    const syncOffset = () => setStickyChromeHeight(chrome.offsetHeight)
    syncOffset()
    const ro = new ResizeObserver(syncOffset)
    ro.observe(chrome)
    return () => ro.disconnect()
  }, [])

  // ── 数据链：周期切片 → 目录 scope → 产品先切 → 共享构建（与弹窗同口径） ──
  const catalog = useMemo(() => getCatalogProducts(), [feedbacks])
  const periodItems = useMemo(
    () => filterRecordsForScope(feedbacks, currentPeriod, 'post_use_rating'),
    [feedbacks, currentPeriod],
  )
  const scopedItems = useMemo(
    () => scopePostUseRatingRecords(periodItems, catalog),
    [periodItems, catalog],
  )
  const allProductNames = useMemo(() => getPostUseRatingProductNames(catalog), [catalog])
  // 工单记录（投诉+咨询）：列表构建 + 工单跳转共用同源输入（index 各建各，成本 O(n) 忽略）
  const ticketRecords = useMemo(
    () =>
      (feedbacks || []).filter(
        (record) =>
          record.dataSourceType === 'complaint_ticket' ||
          record.dataSourceType === 'consultation_ticket',
      ),
    [feedbacks],
  )

  // 全产品清单（无产品筛选）：供产品下拉统计 + 未选产品时直接复用（2026-11-23 口径修正：
  // 计数必须反映 tab 内实际显示的行数 = recommendations + nonTenRecords，而非原始 scopedItems
  // 记录数——后者含被 buildPostUseCallbackLists 内部多道过滤排除的记录）
  const allLists = useMemo(
    () =>
      buildPostUseCallbackLists({
        records: scopedItems,
        productNames: allProductNames,
        keyCustomers: settings?.postUseKeyCustomers,
        ticketRecords,
      }),
    [scopedItems, allProductNames, settings?.postUseKeyCustomers, ticketRecords],
  )

  // 产品下拉选项 = 全产品清单内容计数（每产品 tab 内可见行数 = recommendations + nonTenRecords）
  const productOptions = useMemo(() => {
    const counts = new Map()
    for (const item of allLists.recommendations) {
      const name = String(item.productName || '').trim()
      if (name) counts.set(name, (counts.get(name) || 0) + 1)
    }
    for (const item of allLists.nonTenRecords) {
      const name = String(item.productName || '').trim()
      if (name) counts.set(name, (counts.get(name) || 0) + 1)
    }
    return [...counts].map(([name, count]) => ({ value: name, label: `${name} (${count})` }))
      .sort((a, b) => a.value.localeCompare(b.value, 'zh'))
  }, [allLists])

  const totalRowCount = allLists.recommendations.length + allLists.nonTenRecords.length

  const selectedItems = useMemo(
    () => (selectedProduct ? scopedItems.filter((record) => record.product === selectedProduct) : scopedItems),
    [scopedItems, selectedProduct],
  )

  const { recommendations, nonTenRecords } = useMemo(
    () =>
      selectedProduct
        ? buildPostUseCallbackLists({
            records: selectedItems,
            productNames: allProductNames,
            keyCustomers: settings?.postUseKeyCustomers,
            ticketRecords,
          })
        : allLists,
    [selectedProduct, selectedItems, allProductNames, settings?.postUseKeyCustomers, ticketRecords, allLists],
  )

  const scopeLabel = currentPeriod?.label || '当前范围'

  // ── 服务端状态：挂载即拉（视图切换卸载重挂 ≈ 弹窗 destroyOnClose 语义） ──
  const refreshDecisions = useCallback(async () => {
    const res = await listPostUseCallbackDecisions()
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
  }, [])

  const refreshArchivedItems = useCallback(async () => {
    // limit:-1 = 全量（limit:0 会经 Number(0)||100 截成 100 条，仓库既有坑）
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

  const refreshDispatched = useCallback(async () => {
    const res = await listPostUseVisitDispatch()
    setDispatchedKeys(new Set((res?.items || []).map((item) => item.itemKey).filter(Boolean)))
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      await Promise.all([
        refreshDecisions(),
        refreshArchivedItems(),
        refreshDispatched(),
      ])
    } catch (error) {
      message.error(error?.message || '加载清单状态失败')
    } finally {
      setLoading(false)
    }
  }, [refreshDecisions, refreshArchivedItems, refreshDispatched])

  useEffect(() => {
    let cancelled = false
    listAssignees()
      .then((res) => {
        if (!cancelled) setAssignees(res?.users || [])
      })
      .catch(() => {
        if (!cancelled) setAssignees([])
      })
    void reload()
    return () => {
      cancelled = true
    }
  }, [reload])

  const assigneeOptions = useMemo(
    () => assignees.map((person) => buildUserOption(person, assignees)),
    [assignees],
  )

  // ── 周期包含语义判定（与弹窗同源：itemKeyPeriod 共享函数） ──
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
      ...recommendations.map((item) => item.itemKey).filter(Boolean),
      ...nonTenRecords.map((item) => item.itemKey).filter(Boolean),
    ],
    [recommendations, nonTenRecords],
  )

  const visitCount = currentKeys.filter((key) => decisionOf(decisions, key).needCustomerVisit).length

  // 2026-11-24 单一真源：待省代表回访行（勾选且未纳入）——邮件附件 / 原子标记 / 弹窗数量提示
  // 三处共用；曾三处各写一份 collectFollowupExportRows + filter（同源判定纪律）
  const pendingVisitRows = useMemo(
    () =>
      collectFollowupExportRows(recommendations, nonTenRecords, decisions, 'needCustomerVisit')
        .filter((row) => !isDispatched(row.itemKey)),
    [recommendations, nonTenRecords, decisions, isDispatched],
  )

  const pendingAssigneeQuestionnaire = useMemo(() => {
    return recommendations
      .filter((item) => item.itemKey && decisionOf(decisions, item.itemKey).needInternalTrace && !assigneeOverrides.get(item.itemKey)?.id)
      .filter((item) => !isArchived(item.itemKey || ''))
      .map((item) => ({ itemKey: item.itemKey, customerName: item.customerName || '', productName: item.productName || '' }))
  }, [recommendations, decisions, assigneeOverrides, isArchived])

  const pendingAssigneeCallback = useMemo(() => {
    return nonTenRecords
      .filter((item) => item.itemKey && decisionOf(decisions, item.itemKey).needInternalTrace && !assigneeOverrides.get(item.itemKey)?.id)
      .filter((item) => !isArchived(item.itemKey || ''))
      .map((item) => ({ itemKey: item.itemKey, customerName: item.customerName || '', productName: item.productName || '', originalTicketId: item.originalTicketId || '' }))
  }, [nonTenRecords, decisions, assigneeOverrides, isArchived])

  // ── 勾选持久化（周期包含同步，与弹窗同源） ──
  const persistDecision = async (itemKey, sourceType, patch) => {
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

  const flagColumn = (flag, title) => ({
    title,
    dataIndex: flag,
    width: 92,
    fixed: 'right',
    render: (_value, row) => {
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

  // 官网问卷类按客户聚合：显示列客户级合并；勾选列行级独立（2026-11-09 拍板，与弹窗同源）
  const questionnaireRows = useMemo(() => {
    const keyOf = (row) => String(row.customerCode || row.customerName || '').trim() || '匿名客户'
    // 分组字段动态预挂到行对象（页内 render 消费）；组键类型局部放宽（与弹窗同语义）
    /** @type {{ itemKey?: string; customerCode?: string; customerName?: string; productName?: string; __groupKeys?: string[]; __isGroupFirst?: boolean; __groupSpan?: number }[]} */
    const sorted = /** @type {any[]} */ ([...recommendations]).sort(
      (a, b) =>
        keyOf(a).localeCompare(keyOf(b), 'zh')
        || String(a.productName || '').localeCompare(String(b.productName || ''), 'zh'),
    )
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

  const dispatchedCount = useMemo(() => {
    return (
      questionnaireRows.filter((row) => isDispatched(row.itemKey || '')).length +
      nonTenRecords.filter((row) => isDispatched(row.itemKey || '')).length
    )
  }, [questionnaireRows, nonTenRecords, isDispatched])
  const archivedCount = useMemo(
    () => currentKeys.filter((key) => isArchived(key)).length,
    [currentKeys, isArchived],
  )

  const filteredQuestionnaireRows = useMemo(() => {
    if (!filterArchivedOnly && !filterDispatchedOnly) return questionnaireRows
    /** @type {{ itemKey?: string; customerCode?: string; customerName?: string; productName?: string; __groupKeys?: string[]; __isGroupFirst?: boolean; __groupSpan?: number }[]} */
    const kept = /** @type {any[]} */ (questionnaireRows.filter((row) => {
      if (filterArchivedOnly && !isArchived(row.itemKey || '')) return false
      if (filterDispatchedOnly && !isDispatched(row.itemKey || '')) return false
      return true
    }))
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

  const filteredCallbackRecords = useMemo(() => {
    if (!filterArchivedOnly && !filterDispatchedOnly) return nonTenRecords
    return nonTenRecords.filter((row) => {
      if (filterArchivedOnly && !isArchived(row.itemKey || '')) return false
      if (filterDispatchedOnly && !isDispatched(row.itemKey || '')) return false
      return true
    })
  }, [nonTenRecords, filterArchivedOnly, filterDispatchedOnly, isArchived, isDispatched])

  // 客户级合并单元格 render 包装：仅显示列；非组首行 rowSpan:0 吞行
  const mergedCell = (value, row, render) => {
    if (!row.__isGroupFirst) return { children: '', props: { rowSpan: 0 } }
    return { children: render ? render(value) : value, props: { rowSpan: row.__groupSpan } }
  }

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

  // ── 工单跳转：tab 自建 index（buildTicketRecordIndex 与列表构建共用 ticketRecords） ──
  const { byTicketId, byId } = useMemo(
    () => buildTicketRecordIndex(ticketRecords),
    [ticketRecords],
  )
  const openTicketByOriginalId = useCallback(
    (originalTicketId) => {
      if (!originalTicketId || !onOpenTicket) return
      const norm = normalizeTicketId(originalTicketId)
      const ticket = (norm && byTicketId.get(norm)) || byId.get(originalTicketId)
      if (ticket) {
        onOpenTicket(ticket)
      } else {
        message.info(`未找到原工单 ${originalTicketId} 对应的工单记录，请确认该工单已导入`)
      }
    },
    [byTicketId, byId, onOpenTicket],
  )

  // ── 列定义（列宽拖拽：页面持有 override，弹性/操作/fixed 列自动排除） ──
  const questionnaireResize = useColumnResize({ tableKey: 'postUseCallbackQuestionnaire', userId: user?.id })
  const callbackResize = useColumnResize({ tableKey: 'postUseCallbackNonTen', userId: user?.id })

  const assigneeColumn = {
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
          getPopupContainer={() => document.body}
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
  }

  const questionnaireColumns = [
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
      // 11-23 需求一步骤 3：该列是问卷选项串（forDisplay 过滤后的原因域），
      // 不是客户打的原话——去掉误标的【原话】前缀（用户例句现场）。
      render: (value) => value ? <EllipsisHover value={value} /> : '—',
    },
    {
      title: '建议回访原因',
      dataIndex: 'recommendedReason',
      width: 340,
      ellipsis: true,
      // 11-23 需求一步骤 3：recommendedReason 是系统生成的建议文案（非客户原话），
      // 去掉误标的【原话】前缀。
      render: (value) => value ? <EllipsisHover value={value} /> : '—',
    },
    flagColumn('needCustomerVisit', '省代表回访'),
    rowFlagColumn('needInternalTrace', '产品部溯源'),
    assigneeColumn,
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
          <Button type="link" size="small" className="!px-0" onClick={() => openTicketByOriginalId(value)}>
            {value}
          </Button>
        )
      },
    },
    { title: '投诉整体服务评价', dataIndex: 'score', width: 140 },
    { title: '客户名称', dataIndex: 'customerName', width: 150, ellipsis: true, render: (value, row) => <span>{value}<KeyCustomerStar isKeyCustomer={row.isKeyCustomer} /></span> },
    { title: '集团客户编码', dataIndex: 'customerCode', width: 140, ellipsis: true },
    { title: '不满原因', dataIndex: 'dissatisfactionReason', width: 180, ellipsis: true,
      render: (value) => value ? <span>【原话】{value}</span> : '—' },
    { title: '客户请求内容', dataIndex: 'customerRequest', width: 200, ellipsis: true,
      render: (value) => value ? <span>【原话】{value}</span> : '—' },
    { title: '问题原因', dataIndex: 'problemCause', width: 200, ellipsis: true },
    flagColumn('needCustomerVisit', '省代表回访'),
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
    assigneeColumn,
  ]

  // ── 导出/发送/存档（与弹窗同源逻辑） ──
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
      // 预导入写入回访 tab（按 itemKey 拆月份；同身份取信息量最大反馈）
      const preloadItems = []
      const seenIdentity = new Map()
      for (const row of pending) {
        const months = String(row.数据月份 || '').split('、').map((m) => m.trim()).filter(Boolean)
        const feedback = String(row.客户反馈 || '').trim()
        for (const month of months) {
          const identity = [month, row.产品名称, row.客户名称, row.客户编码].join('\0')
          if (seenIdentity.has(identity)) {
            const prev = seenIdentity.get(identity)
            if (feedback.length > String(prev.customerFeedback || '').length) {
              prev.customerFeedback = feedback
            }
            continue
          }
          const item = {
            visitMonth: month,
            productName: row.产品名称 || '',
            customerName: row.客户名称 || '',
            customerCode: row.客户编码 || '',
            customerFeedback: feedback,
          }
          seenIdentity.set(identity, item)
          preloadItems.push(item)
        }
      }
      if (preloadItems.length) {
        try {
          await batchPreloadPostUseVisits(preloadItems)
        } catch {
          message.warning('已标记"已纳入"，但回访 tab 预写入失败（导入时仍会正常生成）')
        }
      }
    } catch {
      message.warning('标记"已纳入"失败，可重新导出补标')
    }
  }

  // 2026-11-24 用户拍板：「导出待省代表回访表」「导出待产品部溯源表」两按钮下线——
  // 交付统一走「发送待省代表回访」（邮件链路有服务端确认，失败不标记）与「存档产品部溯源」。
  // 旧导出按钮的缺陷（浏览器下载无成功回调、被吞后标记已写死无解）随入口移除而消解。

  const archiveTrace = async () => {
    const allRows = collectFollowupExportRows(recommendations, nonTenRecords, decisions, 'needInternalTrace')
    const rows = allRows.filter((row) => !isArchived(row.itemKey))
    if (!rows.length) {
      message.info(allRows.length ? '勾选的记录均已纳入产品部溯源' : '请先勾选需要产品部溯源的记录')
      return
    }
    const missingAssigneeKeys = rows.filter((row) => !assigneeOverrides.get(row.itemKey)?.id)
    if (missingAssigneeKeys.length) {
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
      await Promise.all([refreshArchivedItems(), refreshDecisions().catch(() => {})])
      message.success({
        content: (
          <span>
            已存档 {savedCount} 条到「反馈库 · 用后即评满意度 · 产品部溯源」
            <Button
              type="link"
              size="small"
              className="!px-1"
              onClick={() => {
                onNavigateToTrace?.()
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
    <div className="space-y-4">
      <div
        ref={stickyChromeRef}
        // 布局一致性（11-09 方案 A 用户拍板）：卡片内嵌吸顶形态——与溯源/原始数据
        // 视图同款（白底 + -mx-4/px-4 抵消宿主 page-card 的 p-4），禁页面级 page-sticky-chrome
        // 2026-11-21 用户反馈：操作按钮行与筛选行间距太小——space-y-2(8px) → space-y-4(16px)
        className="sticky top-0 z-20 -mx-4 space-y-4 rounded-t-lg border-b border-ink-100 bg-white px-4 pb-3 pt-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Space wrap>
            <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
              刷新
            </Button>
            <Tooltip title="下载当前范围的双表原始清单">
              <Button
                icon={<DownloadOutlined />}
                onClick={() =>
                  downloadPostUseCallbackRecommendationsExcel(recommendations, nonTenRecords, scopeLabel)
                }
              >
                下载原始清单
              </Button>
            </Tooltip>
            <Tooltip title={visitCount ? '' : '请先勾选需要省代表回访的记录'}>
              <Button
                icon={<MailOutlined />}
                disabled={!canEdit || !visitCount}
                onClick={() => setMailOpen(true)}
              >
                发送待省代表回访
              </Button>
            </Tooltip>
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
            {/* 2026-11-21 用户拍板：删除「产品部溯源」跳转按钮——同 lane 内直接切
                Segmented 即达；存档成功的「立即查看」跳转保留（onNavigateToTrace 单消费点） */}
          </Space>
        </div>
        <div className="flex w-full flex-wrap items-center gap-4">
          <Space wrap>
            <Typography.Text strong>产品</Typography.Text>
            <Select
              showSearch
              optionFilterProp="label"
              className="min-w-[220px]"
              value={selectedProduct}
              options={[{ value: '', label: `全部产品 (${totalRowCount})` }, ...productOptions]}
              onChange={(value) => setSelectedProduct(value || '')}
              getPopupContainer={() => document.body}
            />
          </Space>
          <Checkbox checked={filterArchivedOnly} onChange={(e) => setFilterArchivedOnly(e.target.checked)}>
            已纳入产品部回溯（{archivedCount}）
          </Checkbox>
          <Checkbox checked={filterDispatchedOnly} onChange={(e) => setFilterDispatchedOnly(e.target.checked)}>
            已纳入省代表回访（{dispatchedCount}）
          </Checkbox>
        </div>
      </div>
      <Tabs
        items={[
          {
            key: 'questionnaire',
            label: (
              <Tooltip title="红点数字 = 已勾选产品部溯源但尚未指定经办人的条数">
                <Badge count={pendingAssigneeQuestionnaire.length} size="small" offset={[6, 0]}>
                  <span>官网问卷类建议回访({filteredQuestionnaireRows.length})</span>
                </Badge>
              </Tooltip>
            ),
            children: (
              <Table
                size="small"
                rowKey={(row) => row.itemKey || `${row.customerCode}-${row.productName}`}
                loading={loading}
                pagination={{ pageSize: PAGE_SIZE, showTotal: paginationShowTotal }}
                scroll={{ x: sumColumnsWidth(questionnaireResize.decorateColumns(questionnaireColumns)) }}
                sticky={{ offsetHeader: stickyChromeHeight }}
                dataSource={filteredQuestionnaireRows}
                columns={questionnaireResize.decorateColumns(questionnaireColumns)}
                locale={{ emptyText: '当前范围内暂无官网问卷类建议回访记录' }}
              />
            ),
          },
          {
            key: 'callback',
            label: (
              <Tooltip title="红点数字 = 已勾选产品部溯源但尚未指定经办人的条数">
                <Badge count={pendingAssigneeCallback.length} size="small" offset={[6, 0]}>
                  <span>投诉回访非10分({filteredCallbackRecords.length})</span>
                </Badge>
              </Tooltip>
            ),
            children: (
              <Table
                size="small"
                rowKey={(row) => row.itemKey || row.id || row.originalTicketId}
                loading={loading}
                pagination={{ pageSize: PAGE_SIZE, showTotal: paginationShowTotal }}
                scroll={{ x: sumColumnsWidth(callbackResize.decorateColumns(callbackColumns)) }}
                sticky={{ offsetHeader: stickyChromeHeight }}
                dataSource={filteredCallbackRecords}
                columns={callbackResize.decorateColumns(callbackColumns)}
                locale={{ emptyText: '当前范围内暂无投诉回访非10分记录' }}
              />
            ),
          },
        ]}
      />
      <SendMailModal
        open={mailOpen}
        onClose={() => setMailOpen(false)}
        defaultTemplateId={MAIL_PRESET_CALLBACK_VISIT}
        dataSourceType="post_use_rating"
        periodLabel={scopeLabel}
        linkKind="workbench"
        canSend={canEdit && visitCount > 0}
        disabledReason={visitCount ? '' : '请先勾选需要省代表回访的记录'}
        defaultGroupKeyword="用后即评回访"
        dispatchSummary={`本次将发送「待省代表回访」清单 ${pendingVisitRows.length} 条`}
        buildAttachment={async () => {
          const rows = pendingVisitRows
          if (!rows.length) return null
          const wb = buildFollowupTableWorkbook(rows, '待省代表回访表')
          return {
            filename: followupTableFilename('待省代表回访表', scopeLabel),
            mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            contentBase64: followupWorkbookToBase64(wb),
          }
        }}
        // 2026-11-24 原子标记：勾选上下文随发送请求提交，服务端 SMTP 成功后同请求写标记；
        // 附件与标记同源（pendingVisitRows），杜绝两份数据不一致
        buildDispatchItems={() =>
          pendingVisitRows.map((row) => ({
            itemKey: row.itemKey,
            sourceType: row.sourceType,
            customerName: row.客户名称 || '',
            productName: row.产品名称 || '',
            importMonth: row.数据月份 || '',
          }))
        }
        onMarkOnly={async () => {
          await markVisitDispatched(pendingVisitRows, 'mail')
        }}
        onSent={async () => {
          // 服务端原子标记已成功时 markVisitDispatched 内部按 isDispatched 跳过（幂等兜底）
          await markVisitDispatched(pendingVisitRows, 'mail')
        }}
      />
    </div>
  )
}
