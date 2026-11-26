import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Checkbox, DatePicker, Descriptions, Drawer, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Typography, Collapse } from 'antd'
import { CopyOutlined, InfoCircleOutlined, WarningOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../lib/apiClient.js'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { useAuth } from '../../context/AuthContext.jsx'
import FieldLabel from '../FieldLabel.jsx'
import { paginationShowTotal } from '../../lib/paginationTotal.js'
import PatrolCompositeFilter from './PatrolCompositeFilter.jsx'
import EstablishedActionFields, { getActionItemDisplayScheduleAt } from '../actions/EstablishedActionFields.jsx'
import { useColumnResize } from '../../hooks/useColumnResize.js'
import { sumColumnsWidth } from '../../lib/columnWidths.js'
import { copyTextToClipboard } from '../../lib/clipboard.js'

const { RangePicker } = DatePicker

/**
 * API 巡检 · 异常接口溯源页（docs/DESIGN-API巡检.md §7.1）。
 * ①异常接口列表：时间范围（近7天/30天/自定义）+ stats 驱动（次数从明细 Σ 重算，跨日口径 API 处理）
 * ②失败请求列表：复合搜索 + L1·L2 两级 Tag + 处理状态快捷筛选
 * ③详情抽屉：诊断原文 + 处理闭环（提交=已处理/暂存=处理中）
 * 数据来自 /api/patrol/failures/*（camelCase 返回）。
 */
const ROOT_CAUSE_L1_OPTIONS = [
  '业务冲突', '配额不足', '资源锁定&并发冲突', '参数无效&校验失败', '资源状态异常', '权限&授权不足', '诊断能力缺口', '产品可观测性不足', '其他&未归类',
]
const STATUS_OPTIONS = ['待处理', '处理中', '已处理', '—', '未诊断']
const PRODUCT_ACTION_FILTER = '需产品侧处理'
const CUSTOMER_TYPE_LABELS = { 仿真: '仿真', 测试账号: '测试' }
/**
 * 「诊断能力缺口」归属提示（11-25 拍板：缺口 = 诊断链路/日志服务的可观测性不足，
 * 是诊断能力提供方的问题，非产品功能缺陷——Tag 展示须自带该语境，
 * 防「缺口组标待处理」被误读为产品侧缺陷）。单源：列表 Tag / 抽屉 AI 判定行共用。
 */
const DIAGNOSIS_GAP_TOOLTIP = '诊断能力缺口 = 日志/诊断链路查不到失败原因（诊断能力提供方问题，非产品功能缺陷）；若标「待处理」，诉求是补提示与可诊断日志，不是修复本次失败'
/**
 * 「产品可观测性不足」归属提示（11-26 拆类拍板）：日志在但失败未落错误码/提示——
 * 责任在产品（补错误码与提示文案后此类自动消失）。与缺口类的分界线 = 日志在不在。
 */
const OBSERVABILITY_TOOLTIP = '产品可观测性不足 = 日志在但读不出失败原因（校验全 OK、无错误码、无异常堆栈）——平台未把失败写成可诊断形态，责任在产品：补错误码/提示文案后此类自动消失'

/**
 * 根因分类展示派生（11-18 晚拍板：同源谓词——列表 Tag/抽屉 AI 判定行共用同一函数）。
 * 口径：①列表模式 manual 优先（带 isManual 标识）；抽屉对照模式取 AI 原值（对照本意）
 * ②诊断能力缺口不显 L2 ③L2 是场景不是来源标注——「LLM结构化诊断/LLM语义判定/
 * LLM未诊断/无诊断结论」旧值过滤退场（两模式同口径）。
 * @param {{ rootCauseL1?: string | null, rootCauseL2?: string | null,
 *           rootCauseL1Manual?: string | null, rootCauseL2Manual?: string | null }} record
 * @param {'list' | 'ai-original'} [mode] list=manual 优先（默认）；ai-original=抽屉对照行取 AI 原判
 * @returns {{ l1: string, l2: string, isManual: boolean, hasManual: boolean }}
 */
function displayRootCause(record, mode = 'list') {
  const hasManual = Boolean(record.rootCauseL1Manual)
  const useManual = mode === 'list' && hasManual
  const l1 = (useManual ? record.rootCauseL1Manual : record.rootCauseL1) || ''
  let l2 = (useManual ? record.rootCauseL2Manual : record.rootCauseL2) || ''
  if (l1 === '诊断能力缺口') l2 = ''
  if (/^LLM(语义判定|结构化诊断|未诊断)/.test(l2) || l2 === '无诊断结论') l2 = ''
  return { l1, l2, isManual: useManual, hasManual }
}

export default function ApiPatrolFailures() {
  const message = useAppMessage()
  const { can, user } = useAuth()
  const [searchParams] = useSearchParams()
  const rootCauseFromUrl = searchParams.get('rootCauseL1') || ''
  // 11-20 拍板：处理反馈门控从 manageTags 收敛到 editRecord（对齐反馈库抽屉 canEdit 口径）——
  // admin/editor/partial_editor 可编辑；viewer 也能看到分区三，只读展示已填反馈（不再整区隐藏）。
  const readOnly = !can('editRecord')
  const [activeTab, setActiveTab] = useState(rootCauseFromUrl ? 'groups' : 'interfaces')
  // 列宽拖拽（11-18 拍板④：复用系统 useColumnResize 机制——localStorage 按 userId 持久化）
  const interfacesResize = useColumnResize({ tableKey: 'patrol.interfaces', userId: user?.id })
  const groupsResize = useColumnResize({ tableKey: 'patrol.groups', userId: user?.id })
  /** @type {[any, React.Dispatch<React.SetStateAction<any>>]} */
  const [range, setRange] = useState([dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')]) // 默认 T-1（11-18 拍板），与快捷按钮同语义
  const [interfaces, setInterfaces] = useState([])
  const [loadingInterfaces, setLoadingInterfaces] = useState(false)
  /** @type {[any, React.Dispatch<React.SetStateAction<any>>]} */
  const [summaryData, setSummaryData] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [groups, setGroups] = useState([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [filters, setFilters] = useState(/** @type {Record<string, string>} */ ({
    product: '', metricName: '', apiPath: '', requestId: '', userName: '',
    rootCauseL1: rootCauseFromUrl, status: '', customerType: '', assignee: '',
  }))
  /** 经办人选项（11-17：DISTINCT 端点，时间范围内有组的非空经办人） */
  const [assigneeOptions, setAssigneeOptions] = useState([])
  /** 分产品计数（11-17：两 tab 产品筛选共用——异常接口按接口行/失败请求按组数） */
  const [productCounts, setProductCounts] = useState([])
  /** 异常接口列表产品筛选（单选；跨 tab 独立状态——两 tab 口径不同不共享值） */
  const [interfaceProduct, setInterfaceProduct] = useState('')

  /** @type {[number | null, Function]} */
  const [drawerId, setDrawerId] = useState(null)
  const [drawerData, setDrawerData] = useState(null)
  const [drawerLoading, setDrawerLoading] = useState(false)

  // 历史 pending 转待处理（11-20 15:09 拍板）：今日诊断转出但失败发生在历史日期的组——
  // 不在当前日期范围易漏处理，顶部条件提示条 + 查看清单跳转（status=需产品侧处理）。
  /** @type {[Array<Record<string, unknown>> | null, Function]} */
  const [trappedPending, setTrappedPending] = useState(null)

  const rangeParams = useMemo(() => ({
    startDate: range[0].format('YYYY-MM-DD'),
    endDate: range[1].format('YYYY-MM-DD'),
  }), [range])

  // 总览根因分布跳转到此页时，直接展示已按 L1 筛选的失败请求列表。
  useEffect(() => {
    setFilters((current) => current.rootCauseL1 === rootCauseFromUrl
      ? current
      : { ...current, rootCauseL1: rootCauseFromUrl })
    if (rootCauseFromUrl) setActiveTab('groups')
  }, [rootCauseFromUrl])

  const loadInterfaces = useCallback(async () => {
    setLoadingInterfaces(true)
    try {
      const qs = new URLSearchParams(rangeParams)
      if (interfaceProduct) qs.set('product', interfaceProduct)
      const data = await apiFetch(`/api/patrol/failures/interfaces?${qs}`)
      setInterfaces(data.rows || [])
    } catch (err) {
      message.error(err.message || '加载异常接口列表失败')
    } finally {
      setLoadingInterfaces(false)
    }
  }, [rangeParams, interfaceProduct, message])

  /** 巡检概况（2026-11-07 拍板：检测结果概况——尤其异常情况；facts 与异常接口列表同源） */
  const loadSummary = useCallback(async () => {
    setLoadingSummary(true)
    try {
      const qs = new URLSearchParams(rangeParams)
      const data = await apiFetch(`/api/patrol/failures/summary-facts?${qs}`)
      setSummaryData(data)
    } catch (err) {
      message.error(err.message || '加载巡检概况失败')
    } finally {
      setLoadingSummary(false)
    }
  }, [rangeParams, message])

  useEffect(() => {
    loadSummary()
  }, [loadSummary])

  const loadGroups = useCallback(async () => {
    setLoadingGroups(true)
    try {
      const qs = new URLSearchParams({ ...rangeParams })
      for (const [k, v] of Object.entries(filters)) {
        if (v) qs.set(k, v)
      }
      const data = await apiFetch(`/api/patrol/failures/groups?${qs}`)
      setGroups(data.rows || [])
    } catch (err) {
      message.error(err.message || '加载失败请求列表失败')
    } finally {
      setLoadingGroups(false)
    }
  }, [rangeParams, filters, message])

  useEffect(() => { loadInterfaces() }, [loadInterfaces])
  useEffect(() => { loadGroups() }, [loadGroups])

  // 经办人选项加载（11-17）：随时间范围刷新；失败不阻塞列表（选项空时 Select 仍可手输搜索）
  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams(rangeParams)
    apiFetch(`/api/patrol/failures/assignees?${qs}`)
      .then((data) => { if (!cancelled) setAssigneeOptions(data.rows || []) })
      .catch(() => { if (!cancelled) setAssigneeOptions([]) })
    return () => { cancelled = true }
  }, [rangeParams])

  // 分产品计数加载（11-17）：两 tab 产品筛选共用一次拉取；失败静默降级
  useEffect(() => {
    let cancelled = false
    const qs = new URLSearchParams(rangeParams)
    apiFetch(`/api/patrol/failures/product-counts?${qs}`)
      .then((data) => { if (!cancelled) setProductCounts(data.rows || []) })
      .catch(() => { if (!cancelled) setProductCounts([]) })
    return () => { cancelled = true }
  }, [rangeParams])

  // 历史 pending 转待处理加载（11-20 15:09 拍板）：只拉一次（与日期范围无关——判定锚定「今日」）；
  // 失败静默降级（null=不渲染提示条）
  useEffect(() => {
    let cancelled = false
    apiFetch('/api/patrol/failures/trapped-pending')
      .then((data) => { if (!cancelled) setTrappedPending(data?.rows || []) })
      .catch(() => { if (!cancelled) setTrappedPending(null) })
    return () => { cancelled = true }
  }, [])

  const openDrawer = useCallback(async (id) => {
    setDrawerId(id)
    setDrawerLoading(true)
    try {
      const data = await apiFetch(`/api/patrol/failures/groups/${id}`)
      setDrawerData(data)
    } catch (err) {
      message.error(err.message || '加载详情失败')
      setDrawerId(null)
    } finally {
      setDrawerLoading(false)
    }
  }, [message])

  const submitFeedback = useCallback(async (groupId, payload, isSubmit) => {
    try {
      await apiFetch(`/api/patrol/failures/groups/${groupId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: isSubmit ? 'submit' : 'draft', ...payload }),
      })
      message.success(isSubmit ? '已提交（状态：已处理）' : '已暂存（状态：处理中）')
      setDrawerId(null)
      setDrawerData(null)
      loadGroups()
    } catch (err) {
      message.error(err.message || '保存失败')
    }
  }, [message, loadGroups])

  // 筛选下拉数量统计（11-17 傍晚拍板①）：基于当前窗口全部组（未应用该筛选项的其余条件？——
  // 口径拍板：计数基于「当前时间范围」全量组（与列表 LIMIT 500 同源），不受其他筛选项影响，
  // 让用户在清空筛选前就能看到各选项规模）
  const l1Counts = useMemo(() => {
    const m = {}
    for (const g of groups) {
      // 11-19 升级：displayRootCause 口径计数——下拉计数与筛选（后端 COALESCE）/列表 Tag 展示三方自洽
      const k = displayRootCause(g).l1 || '未诊断'
      m[k] = (m[k] || 0) + 1
    }
    return m
  }, [groups])
  const statusCounts = useMemo(() => {
    const m = {}
    for (const g of groups) {
      const raw = String(g.productActionStatus || '')
      const k = raw === 'pending_diagnosis' ? '未诊断' : (raw || '—')
      m[k] = (m[k] || 0) + 1
    }
    return m
  }, [groups])
  const withCount = (options, counts) => options.map((x) => ({
    label: `${x}（${counts[x] || 0}）`,
    value: x,
  }))

  /** @type {any[]} */
  const interfaceColumns = useMemo(() => [
    // 数据日期（11-17）：单日=该日；跨日合并行=statDates 多值（区间展示）
    { title: '数据日期', dataIndex: 'statDates', key: 'statDates', width: 110, ellipsis: true,
      render: (v) => {
        const dates = Array.isArray(v) ? v.filter(Boolean) : []
        if (dates.length === 0) return '—'
        if (dates.length === 1) return dates[0]
        return `${dates[0]} ~ ${dates[dates.length - 1]}`
      } },
    { title: '产品', dataIndex: 'productName', key: 'productName', width: 110, ellipsis: true,
      render: (v, record) => v || record.productKey || '—' },
    { title: '资源池', dataIndex: 'pool', key: 'pool', width: 120, ellipsis: true },
    { title: '指标名称', dataIndex: 'metricName', key: 'metricName', width: 130 },
    { title: '接口名称', dataIndex: 'apiPath', key: 'apiPath', ellipsis: true,
      render: (v, record) => record.pureSim
        ? (<span className="whitespace-nowrap">{v} <Tag className="!m-0" color="default">仿真/测试</Tag></span>)
        : v },
    { title: '业务类型', dataIndex: 'bizType', key: 'bizType', width: 90 },
    {
      title: '成功率', dataIndex: 'successRate', key: 'successRate', width: 100,
      render: (v) => {
        const n = Number(v)
        if (!Number.isFinite(n)) return <Tag>—</Tag>
        return <Tag color={n < 99.5 ? 'red' : (n < 100 ? 'orange' : 'green')}>{n}%</Tag>
      },
      sorter: (a, b) => Number(a.successRate ?? 100) - Number(b.successRate ?? 100),
    },
    { title: '总次数', dataIndex: 'totalCount', key: 'totalCount', width: 80, align: 'right' },
    { title: '失败次数', dataIndex: 'failCount', key: 'failCount', width: 80, align: 'right',
      render: (v) => <span className={Number(v) > 0 ? 'text-red-600' : ''}>{v}</span> },
    {
      title: '时长正常比例', dataIndex: 'durationNormalRatio', key: 'durationNormalRatio', width: 100,
      render: (v) => (v == null ? <Tag>—</Tag> : `${v}%`),
    },
    {
      title: '时长均值', dataIndex: 'avgDuration', key: 'avgDuration', width: 90,
      render: (v) => (v == null ? <Tag>—</Tag> : v),
    },
  ], [])
  // 11-18 列宽拖拽：装饰列（override 应用 + 拖拽手柄注入）；scroll.x 动态求和
  const decoratedInterfaceColumns = useMemo(
    () => interfacesResize.decorateColumns(interfaceColumns),
    [interfaceColumns, interfacesResize],
  )

  /** @type {any[]} */
  const groupColumns = useMemo(() => [
    {
      title: 'RequestID', dataIndex: 'firstRequestId', key: 'firstRequestId', width: 150, ellipsis: true, fixed: 'left',
      render: (v, record) => (
        <Button type="link" size="small" className="!px-0" onClick={() => openDrawer(record.id)}>
          {v}
        </Button>
      ),
    },
    { title: '指标名称', dataIndex: 'metricName', key: 'metricName', width: 120, fixed: 'left' },
    { title: '数据日期', dataIndex: 'groupDate', key: 'groupDate', width: 110 },
    { title: '产品', dataIndex: 'productName', key: 'productName', width: 110, ellipsis: true,
      render: (v, record) => v || record.productKey || '—' },
    { title: '接口名称', dataIndex: 'apiPath', key: 'apiPath', width: 200, ellipsis: true },
    { title: '资源池', dataIndex: 'poolName', key: 'poolName', width: 100, ellipsis: true },
    { title: '客户名称', dataIndex: 'userName', key: 'userName', width: 130, ellipsis: true,
      render: (v, record) => (
        <Space size={4}>
          <span>{v}</span>
          {record.customerType && (
            <Tag className="!m-0">{CUSTOMER_TYPE_LABELS[record.customerType] || record.customerType}</Tag>
          )}
        </Space>
      ) },
    {
      title: '根因分类', key: 'rootCause', width: 190,
      render: (record) => {
        // 11-18 同源派生：displayRootCause 与抽屉 AI 判定行共用（同概念多呈现单一谓词）
        const { l1, l2, isManual } = displayRootCause(record)
        return (
          <Space size={4} wrap>
            {l1 ? (
              l1 === '诊断能力缺口' || l1 === '产品可观测性不足' ? (
                // 11-25/11-26 拍板：两类归属提示（单源常量）——缺口=诊断链路问题、可观测性=产品问题
                <Tooltip title={l1 === '诊断能力缺口' ? DIAGNOSIS_GAP_TOOLTIP : OBSERVABILITY_TOOLTIP}>
                  <Tag color={isManual ? 'geekblue' : (l1 === '诊断能力缺口' ? 'blue' : 'orange')} className="cursor-help">{isManual ? `${l1}·人工` : l1}</Tag>
                </Tooltip>
              ) : (
                <Tag color={isManual ? 'geekblue' : 'blue'}>{isManual ? `${l1}·人工` : l1}</Tag>
              )
            ) : null}
            {l2 ? <Tag>{l2}</Tag> : null}
            {!l1 && !l2 ? <Tag>未诊断</Tag> : null}
          </Space>
        )
      },
    },
    {
      // 11-18 拍板：值区不再 hover；表头 info icon 提示压缩规则
      title: <span>压缩前失败次数 <Tooltip title="压缩规则：同客户同接口 1 小时内的失败请求链压缩为一组，此处为压缩前的失败请求条数"><InfoCircleOutlined className="text-ink-400" /></Tooltip></span>,
      dataIndex: 'preCompressCount', key: 'preCompressCount', width: 110, align: 'right',
      render: (v) => <span>{v}</span>,
    },
    {
      title: '产品侧处理状态', dataIndex: 'productActionStatus', key: 'productActionStatus', width: 120,
      render: (v, record) => {
        // 11-24 B4 豁免标记：与管线出口标注文案同锚（「命中处理豁免白名单」前缀）——
        // 判定源单一（后端 actionReason），不另建豁免判定点
        const exempt = String(record?.actionReason || '').includes('豁免白名单')
        return (
          <Space size={4} wrap>
            {v === '待处理' ? <Tag color="orange">待处理</Tag>
              : v === '处理中' ? <Tag color="processing">处理中</Tag>
              : v === '已处理' ? <Tag color="green">已处理</Tag>
              : (v === 'pending_diagnosis' || v === '未诊断') ? <Tag>未诊断</Tag>
              : <Tag>{v || '—'}</Tag>}
            {exempt ? <Tag className="!m-0" color="default">豁免</Tag> : null}
          </Space>
        )
      },
    },
    { title: '经办人', dataIndex: 'assignee', key: 'assignee', width: 90,
      render: (v) => v || '—' },
  ], [openDrawer])
  const decoratedGroupColumns = useMemo(
    () => groupsResize.decorateColumns(groupColumns),
    [groupColumns, groupsResize],
  )

  return (
    <div className="space-y-4">
      {/* ── 历史 pending 转待处理提示条（11-20 15:09 拍板）：今日诊断转出但失败发生在历史日期的组，
          不在当前日期范围易漏处理——提示 + 一键切筛选查看；无匹配不渲染，次日自动消失（零维护）── */}
      {trappedPending != null && trappedPending.length > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          message={`今日有 ${trappedPending.length} 组历史失败请求完成诊断、转待产品处理（最早 ${String(trappedPending[0]?.groupDate || '')}）`}
          description={(
            <Space wrap size="small" className="!mt-1">
              <span className="text-xs text-ink-500">
                这些组不在当前日期范围内，容易被漏处理——可切换近7日 + 需产品侧处理筛选举查看。
              </span>
              <Button
                type="link" size="small"
                onClick={() => {
                  setActiveTab('groups')
                  setFilters((current) => ({ ...current, status: PRODUCT_ACTION_FILTER }))
                  setRange([dayjs().subtract(6, 'day'), dayjs()])
                }}
              >
                查看清单（{trappedPending.length}）
              </Button>
            </Space>
          )}
        />
      )}
      <div className="page-card">
        <div className="page-card-header flex-wrap">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="page-card-title">巡检概况</span>
            <Typography.Text type="secondary" className="text-xs">检测结果总结，随时间范围刷新</Typography.Text>
            {summaryData?.summary ? (
              summaryData.summary.degraded ? <Tag>LLM 未启用 · 模板直出</Tag> : <Tag color="green">LLM 润色</Tag>
            ) : null}
          </div>
          <Space wrap size="small">
            <RangePicker value={range} onChange={(v) => v && setRange(v)} allowClear={false} />
            <Button size="small" onClick={() => setRange([dayjs().subtract(6, 'day'), dayjs()])}>近7天</Button>
            <Button size="small" onClick={() => setRange([dayjs().subtract(29, 'day'), dayjs()])}>近30天</Button>
            <Button size="small" onClick={() => setRange([dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')])}>T-1</Button>
          </Space>
        </div>
        {summaryData?.summary ? (
          <div className="!mt-3 space-y-3">
            {/* ① 结论区：LLM 综述正文（13px/行高1.7，浅色左边条——与详情抽屉原文卡同构） */}
            <div className="border-l-[3px] border-brand-300 pl-3 text-[13px] leading-relaxed">
              {(summaryData.summary.text || '').split('\n').filter(Boolean).map((line, i) => (
                <p key={i} className="!my-0.5">{line}</p>
              ))}
            </div>

            {summaryData.facts && (
              <>
                {/* ② 指标数字行：metric-card 灰底小卡（大数字 20px/600 + 12px 标签；语义色沿用） */}
                <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                  <div className="metric-card">
                    <div className="text-xs text-ink-500">异常接口</div>
                    <div className="text-xl font-semibold text-ink-900">{summaryData.facts.interfaceCount ?? '—'}</div>
                  </div>
                  <div className="metric-card">
                    <div className="text-xs text-ink-500">
                      失败请求
                      {/* 环比小箭头（上一等长窗口对比；无数据不显示） */}
                      {summaryData.facts.delta && summaryData.facts.delta.failDelta !== 0 ? (
                        <span className={summaryData.facts.delta.failDelta > 0 ? 'ml-1 text-red-600' : 'ml-1 text-green-600'}>
                          {summaryData.facts.delta.failDelta > 0 ? `↑${summaryData.facts.delta.failDelta}` : `↓${Math.abs(summaryData.facts.delta.failDelta)}`}
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xl font-semibold text-red-600">{summaryData.facts.failTotal ?? '—'}</div>
                  </div>
                  <div className="metric-card">
                    <div className="text-xs text-ink-500">待产品侧处理</div>
                    <div className="text-xl font-semibold text-orange-600">{summaryData.facts.closure?.pending ?? 0}</div>
                  </div>
                  <div className="metric-card">
                    <div className="text-xs text-ink-500">已处理</div>
                    <div className="text-xl font-semibold text-green-700">{summaryData.facts.closure?.processed ?? 0}</div>
                  </div>
                </div>

                {/* ③ 诊断细节区：三栏（最差接口/根因分布/处理闭环），仅在有数据时显示 */}
                {(summaryData.facts.worstTop3?.length > 0 || summaryData.facts.causeTop3?.length > 0 || summaryData.facts.closure) && (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                    {/* ③-1 最差接口 Top3 */}
                    {summaryData.facts.worstTop3?.length > 0 && (
                      <div className="rounded-lg bg-ink-50/60 p-3">
                        <div className="sub-section-label">最差接口 Top{summaryData.facts.worstTop3.length}</div>
                        <div className="space-y-1.5">
                          {summaryData.facts.worstTop3.map((w, i) => (
                            <div key={i} className="flex min-w-0 items-center gap-1.5 text-xs">
                              <Typography.Text type="secondary" className="shrink-0">{i + 1}</Typography.Text>
                              <span className="min-w-0 truncate text-ink-800" title={`${w.pool} · ${w.apiPath}`}>
                                {w.productName} · {w.apiPath}
                              </span>
                              <Tag className="!m-0 ml-auto shrink-0" color={Number(w.successRate) < 99.5 ? 'red' : 'orange'}>
                                {w.successRate}%
                              </Tag>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* ③-2 根因 Top3（占比条形态） */}
                    {summaryData.facts.causeTop3?.length > 0 && (
                      <div className="rounded-lg bg-ink-50/60 p-3">
                        <div className="sub-section-label">根因 Top{summaryData.facts.causeTop3.length}（已诊断组）</div>
                        <div className="space-y-1.5">
                          {summaryData.facts.causeTop3.map((c, i) => (
                            <div key={i} className="flex min-w-0 items-center gap-1.5 text-xs">
                              <Tag className="!m-0 shrink-0" color="blue">{c.l1}</Tag>
                              <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded bg-ink-100">
                                <div className="h-full rounded bg-brand-400" style={{ width: `${c.ratio}%` }} />
                              </div>
                              <span className="shrink-0 text-ink-500">{c.count}组 · {c.ratio}%</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {/* ③-3 处理闭环（未诊断/仿真灰字计数补充口径） */}
                    {summaryData.facts.closure && (
                      <div className="rounded-lg bg-ink-50/60 p-3">
                        <div className="sub-section-label">处理闭环</div>
                        <div className="space-y-1.5 text-xs">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Tag className="!m-0" color="orange">待处理 {summaryData.facts.closure.pending ?? 0}</Tag>
                            <Tag className="!m-0" color="processing">处理中 {summaryData.facts.closure.inProgress ?? 0}</Tag>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Tag className="!m-0" color="green">已处理 {summaryData.facts.closure.processed ?? 0}</Tag>
                            <Tag className="!m-0">— {summaryData.facts.closure.notNeeded ?? 0}</Tag>
                          </div>
                          <Typography.Text type="secondary" className="block pt-0.5">
                            未诊断 {summaryData.facts.closure.undiagnosed ?? 0} 组
                            {summaryData.facts.closure.simGroups > 0 ? ` · 仿真/测试 ${summaryData.facts.closure.simGroups} 组` : ''}
                          </Typography.Text>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        ) : (
          <Typography.Text type="secondary" className="!mt-2 block">{loadingSummary ? '加载中…' : '暂无概况'}</Typography.Text>
        )}
      </div>

      {/* 11-18 下午拍板：Tabs 裸挂（出 page-card）对齐反馈库 feedback-lane-tabs 样式——
          tab 不吸顶、表头吸顶（sticky={{ offsetHeader: 0 }} 两表直挂视口顶）。
          间距：nav 底 mb（lane-tabs mb-2 同款）+ 卡内筛选器顶部间距 mt-3——tab 与内容间距语义归位。 */}
      <Tabs
        className="patrol-lane-tabs mb-2 [&_.ant-tabs-nav]:!mb-0 [&_.ant-tabs-tab]:text-[14px] [&_.ant-tabs-tab]:font-bold [&_.ant-tabs-tab-btn]:text-[14px] [&_.ant-tabs-tab-btn]:font-bold"
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
            {
              key: 'interfaces',
              label: '异常接口列表',
              children: (
                <>
                  <div className="page-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
                    {/* 11-17：产品筛选（分产品计数——接口行口径）；说明行已按拍板移除。
                        11-18 晚：宽度 200（原名看不全） */}
                    <Select
                      size="small"
                      placeholder="全部产品"
                      allowClear
                      className="!w-[200px]"
                      value={interfaceProduct || undefined}
                      options={productCounts.map((p) => ({
                        label: `${p.name}（${p.interfaceCount}）`,
                        value: p.key,
                      }))}
                      onChange={(v) => setInterfaceProduct(v || '')}
                    />
                    <Button size="small" onClick={loadInterfaces}>刷新</Button>
                  </div>
                  <Table
                    className="!mt-3"
                    rowKey={(r) => `${r.pool}|${r.apiPath}|${r.metricName}`}
                    columns={decoratedInterfaceColumns}
                    dataSource={interfaces}
                    loading={loadingInterfaces}
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: false, showTotal: paginationShowTotal }}
                    scroll={{ x: sumColumnsWidth(decoratedInterfaceColumns) }}
                    sticky={{ offsetHeader: 0 }}
                  />
                  </div>
                </>
              ),
            },
            {
              key: 'groups',
              label: '失败请求列表',
              children: (
                <>
                  <div className="page-card">
                  {/* 复合搜索行（11-18 晚拍板修订）：复合筛选组件独占搜索入口——
                      其文本字段（RequestID/指标/接口/客户名）+ 枚举 chips 全承载，独立 q 搜索框退场。
                      需产品侧处理勾选 + 刷新同排；pb-3 工具条与表格间距。 */}
                  <div className="flex flex-wrap items-center gap-2 pb-3">
                    <PatrolCompositeFilter
                      filters={filters}
                      onFiltersChange={(next) => setFilters(next)}
                      onClearFilters={() => setFilters({
                        rootCauseL1: rootCauseFromUrl,
                      })}
                      enumOptions={{
                        product: productCounts.map((p) => ({ label: `${p.name}（${p.groupCount}）`, value: p.key })),
                        rootCauseL1: withCount(ROOT_CAUSE_L1_OPTIONS, l1Counts),
                        status: withCount(STATUS_OPTIONS, statusCounts),
                        // 11-18 拍板：其他 = 除仿真/测试账号以外的真实客户（customer_type 空值）；哨兵值 __others__ 后端转空值过滤
                        customerType: [
                          { label: '仿真', value: '仿真' },
                          { label: '测试账号', value: '测试账号' },
                          { label: '其他', value: '__others__' },
                        ],
                        assignee: assigneeOptions.map((a) => ({ label: `${a.assignee}（${a.count}）`, value: a.assignee })),
                      }}
                    />
                    <Checkbox
                      checked={filters.status === PRODUCT_ACTION_FILTER}
                      onChange={(e) => setFilters((current) => ({
                        ...current,
                        status: e.target.checked ? PRODUCT_ACTION_FILTER : '',
                      }))}
                    >
                      需产品侧处理
                    </Checkbox>
                    <Button size="small" onClick={() => { loadGroups(); }}>刷新</Button>
                  </div>
                  <Table
                    rowKey="id"
                    columns={decoratedGroupColumns}
                    dataSource={groups}
                    loading={loadingGroups}
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: false, showTotal: paginationShowTotal }}
                    scroll={{ x: sumColumnsWidth(decoratedGroupColumns) }}
                    sticky={{ offsetHeader: 0 }}
                    onRow={(record) => ({
                      onClick: () => openDrawer(record.id),
                      style: { cursor: 'pointer' },
                    })}
                  />
                  </div>
                </>
              ),
            },
          ]}
        />

      <FailureGroupDrawer
        groupId={drawerId}
        data={drawerData}
        loading={drawerLoading}
        readOnly={readOnly}
        onClose={() => { setDrawerId(null); setDrawerData(null) }}
        onSubmit={submitFeedback}
      />
    </div>
  )
}

/**
 * 详情抽屉：诊断结果五段 + 处理闭环表单（§7.1 ③）。
 * 评估完成=已处理；暂存=处理中；不属实必填真实根因（API 校验兜底 + 前端必填标记）。
 * 诊断结果五段（11-17 拍板）：结论（浅红高亮）/失败组信息（方案 A=顶部 Descriptions 承担）/直接原因
 * （日志原文默认收起双层展开）/关键证据/处理建议（浅蓝高亮）。数据=服务端 diagnosisReport 单源切分。
 * @param {Object} props
 * @param {number | null} props.groupId
 * @param {{ group?: Record<string, unknown>, diagnosis?: Record<string, unknown> | null, diagnosisReport?: Record<string, any> | null, requests?: Array<Record<string, unknown>> } | null} props.data
 * @param {boolean} props.loading @param {boolean} props.readOnly
 * @param {() => void} props.onClose
 * @param {(id: number, payload: Record<string, unknown>, isSubmit: boolean) => Promise<void>} props.onSubmit
 */
function FailureGroupDrawer({ groupId, data, loading, readOnly, onClose, onSubmit }) {
  const message = useAppMessage()
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(true)
  // 压缩前全部记录：默认收起（11-17 拍板）
  const [allRecordsOpen, setAllRecordsOpen] = useState([])
  // 直接原因日志：11-20 19:39 拍板——核心行内联展开退场（日志过长撑爆抽屉），
  // 原始日志弹窗承载（Modal 全宽+内部滚动+全文不截断）；19:51 拍板尺寸对齐反馈库处理意见弹窗；
  // 19:57 拍板：框选快捷复制（浮动气泡「复制选中」——FeedbackDrawer HandlingOriginalTextModal 同款交互）
  const [rawLogModalOpen, setRawLogModalOpen] = useState(false)
  const [selectionBubble, setSelectionBubble] = useState(/** @type {{ top: number, left: number } | null} */ (null))
  const rawLogPaneRef = useRef(/** @type {HTMLDivElement | null} */ (null))

  // 框选捕获（轻量版 readHandlingTextSelection：选区非空 → 气泡定位到选区下方）
  const captureLogSelection = useCallback(() => {
    const sel = window.getSelection()
    const text = sel ? String(sel.toString() || '') : ''
    if (!text.trim()) { setSelectionBubble(null); return }
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null
    const rect = range?.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) { setSelectionBubble(null); return }
    const bubbleWidth = 120
    setSelectionBubble({
      top: Math.min(rect.bottom + 8, window.innerHeight - 48),
      left: Math.min(Math.max(8, rect.left + rect.width / 2 - bubbleWidth / 2), window.innerWidth - bubbleWidth - 8),
    })
  }, [])

  const copyLogSelection = useCallback(() => {
    const text = String(window.getSelection()?.toString() || '')
    if (!text.trim()) return
    copyTextToClipboard(text).then(
      (ok) => ok ? message.success(`已复制选中 ${text.length} 字`) : message.error('复制失败，请手动选择复制'),
      () => message.error('复制失败，请手动选择复制'),
    )
    setSelectionBubble(null)
  }, [message])

  // 弹窗滚动/关闭时隐藏气泡（先例同款）
  useEffect(() => {
    if (!rawLogModalOpen) return
    const hide = () => setSelectionBubble(null)
    window.addEventListener('scroll', hide, true)
    return () => { window.removeEventListener('scroll', hide, true) }
  }, [rawLogModalOpen])
  useEffect(() => { if (!rawLogModalOpen) setSelectionBubble(null) }, [rawLogModalOpen])
  // 关键证据：默认收起可展开（11-18 拍板）
  const [evidenceOpen, setEvidenceOpen] = useState([])
  const group = data?.group
  const diagnosis = data?.diagnosis
  const report = data?.diagnosisReport
  const requests = data?.requests || []

  useEffect(() => {
    if (group) {
      form.setFieldsValue({
        rootCauseConfirmed: /** @type {{rootCauseConfirmed?: string}} */ (group).rootCauseConfirmed || undefined,
        realRootCause: /** @type {{realRootCause?: string}} */ (group).realRootCause || '',
        measureFeedback: /** @type {{measureFeedback?: string}} */ (group).measureFeedback || '',
        assignee: /** @type {{assignee?: string}} */ (group).assignee || undefined,
        actionId: /** @type {{actionId?: string}} */ (group).actionId || '',
        establishedAction: /** @type {{establishedAction?: string}} */ (group).establishedAction || '',
        actionSchedule: /** @type {{actionSchedule?: string}} */ (group).actionSchedule || '',
        rootCauseL1Manual: /** @type {{rootCauseL1Manual?: string}} */ (group).rootCauseL1Manual || undefined,
        rootCauseL2Manual: /** @type {{rootCauseL2Manual?: string}} */ (group).rootCauseL2Manual || '',
      })
    }
  }, [group, form])

  const doSubmit = async () => {
    if (!groupId) return
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      await onSubmit(groupId, values, confirmSubmit)
      form.resetFields()
      setConfirmOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      title={
        <div className="flex w-full min-w-0 flex-col gap-1">
          <span className="text-base font-semibold leading-none">失败组详情</span>
          <Typography.Text type="secondary" className="block min-w-0 text-sm leading-snug" ellipsis={{ tooltip: true }}>
            {group ? [
              String(/** @type {{firstRequestId?: string}} */ (group).firstRequestId || ''),
              String(/** @type {{groupDate?: string}} */ (group).groupDate || ''),
              String(/** @type {{poolName?: string}} */ (group).poolName || ''),
            ].filter(Boolean).join(' · ') : ''}
          </Typography.Text>
        </div>
      }
      open={groupId != null}
      onClose={onClose}
      width={720}
      destroyOnClose
      footer={
        !readOnly && group ? (
          <div className="flex justify-end">
            <Space>
              <Button type="primary" loading={submitting}
                onClick={() => { setConfirmSubmit(true); setConfirmOpen(true) }}>
                评估完成
              </Button>
              <Button loading={submitting}
                onClick={() => { setConfirmSubmit(false); setConfirmOpen(true) }}>
                暂存（处理中）
              </Button>
            </Space>
          </div>
        ) : null
      }
    >
      {loading ? <Typography.Text type="secondary">加载中…</Typography.Text> : null}
      {group && (
        /* 抽屉骨架（11-17 晚对齐反馈库 D1-D5 规范）：drawer-space-y 分区 20px → section-title 分区标题
           → drawer-section-gap 分区内 10px → page-card-sm 白卡；正文 13px（D4），元信息 12px（D5） */
        <div className="min-w-0 max-w-full drawer-space-y overflow-x-hidden">
          {/* ── 分区一 失败组信息 ── */}
          <div className="scroll-mt-2 drawer-section-gap">
            <div className="section-title">失败组信息</div>
            <div className="page-card-sm page-card-bordered">
              <Descriptions size="small" column={2} bordered
                items={[
                  { key: 'date', label: '日期', children: String(/** @type {{groupDate?: string}} */ (group).groupDate || '') },
                  { key: 'pool', label: '资源池', children: String(/** @type {{poolName?: string}} */ (group).poolName || '') },
                  { key: 'api', label: '接口', children: String(/** @type {{apiPath?: string}} */ (group).apiPath || '') },
                  { key: 'metric', label: '指标', children: String(/** @type {{metricName?: string}} */ (group).metricName || '') },
                  { key: 'user', label: '客户', children: String(/** @type {{userName?: string}} */ (group).userName || '') },
                  { key: 'count', label: <span>压缩前失败次数 <Tooltip title="压缩规则：同客户同接口 1 小时内的失败请求链压缩为一组，此处为压缩前的失败请求条数"><InfoCircleOutlined className="text-ink-400" /></Tooltip></span>, children: String(/** @type {{preCompressCount?: number}} */ (group).preCompressCount ?? '') },
                  { key: 'status', label: '产品侧处理状态', children: String(/** @type {{productActionStatus?: string}} */ (group).productActionStatus || '') },
                  { key: 'assignee', label: '经办人', children: String(/** @type {{assignee?: string}} */ (group).assignee || '—') },
                ]}
              />
            </div>
          </div>

          {/* ── 分区二 诊断结果（五段照 11-17 拍板；样式对齐 D4/D5）── */}
          <div className="scroll-mt-2 drawer-section-gap">
            {/* 11-18 拍板③：标题栏右侧提示诊断数据来源；22:57 修订：标题栏通栏与其他分区一致，
                说明文字嵌在蓝色背景内右侧 */}
            <div className="section-title flex items-center justify-between gap-2">
              <span>诊断结果</span>
              <Tooltip title="诊断数据来源：云网工作台 MCP Server 日志查询工具（log_search）——基于失败请求前后日志窗口检索产出">
                <Typography.Text type="secondary" className="text-xs cursor-help">
                  来自云网工作台MCP Server日志查询工具 <InfoCircleOutlined />
                </Typography.Text>
              </Tooltip>
            </div>
            <div className="space-y-3">
              {/* ① 诊断结论——浅红高亮（左竖条 3px 对齐正文规范；正文 13px） */}
              <div className="p-3 rounded border-l-[3px] border-red-300 bg-red-50 text-[13px] leading-relaxed">
                <div className="sub-section-label">诊断结论</div>
                {report?.conclusion
                  ? report.conclusion
                  : '（该组尚未完成 AI 诊断，或诊断无结论）'}
              </div>
              {/* ② 失败组信息——方案 A：顶部 Descriptions 已全量展示，此处精简速览（13px） */}
              <div className="text-[13px]">
                <div className="sub-section-label">失败组信息</div>
                <Space wrap size={12}>
                  <span>接口 {String(/** @type {{apiPath?: string}} */ (group).apiPath || '—')}</span>
                  <span>资源池 {String(/** @type {{poolName?: string}} */ (group).poolName || '—')}</span>
                  <span>客户 {String(/** @type {{userName?: string}} */ (group).userName || '—')}</span>
                </Space>
              </div>
              {/* ③ 直接原因——11-20 19:39 拍板：核心行内联展开退场（日志过长），返回体片段照常 +
                  「查看原始日志」按钮开 Modal 弹窗（全文不截断、内部滚动） */}
              <div>
                <div className="sub-section-label">直接原因（含日志原文、返回体）</div>
                {report && (report.directCause?.logLines?.length || report.directCause?.returnFragments?.length) ? (
                  <>
                    {(report.directCause.returnFragments || []).map((f, i) => (
                      <div key={`ret-${i}`} className="text-xs text-ink-500">{f}</div>
                    ))}
                    {(Number(report.directCause.rawCount) > 0 || String(diagnosis?.mcpRawResponse || '').length > 0) && (
                      <Button type="link" size="small" className="!px-0"
                        onClick={() => setRawLogModalOpen(true)}>
                        查看原始日志{Number.isFinite(Number(report.directCause.rawCount)) && report.directCause.rawCount > 0 ? `（原始 ${report.directCause.rawCount} 行）` : ''}
                      </Button>
                    )}
                  </>
                ) : (
                  <Typography.Text type="secondary" className="text-xs">—</Typography.Text>
                )}
              </div>
              {/* ④ 关键证据（11-18 拍板①：默认收起可展开；正文 13px） */}
              <div>
                <Collapse
                  ghost
                  activeKey={evidenceOpen}
                  onChange={(keys) => setEvidenceOpen(Array.isArray(keys) ? keys : [keys])}
                  items={[{
                    key: 'evidence',
                    label: `关键证据（${report?.evidence?.length || 0} 条）`,
                    children: report?.evidence?.length ? (
                      <ul className="text-[13px] space-y-1 list-disc pl-5">
                        {report.evidence.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    ) : (
                      <Typography.Text type="secondary" className="text-xs">—</Typography.Text>
                    ),
                  }]}
                />
              </div>
              {/* ⑤ 处理建议——浅蓝高亮（左竖条 3px；正文 13px） */}
              <div className="p-3 rounded border-l-[3px] border-blue-300 bg-blue-50 text-[13px] leading-relaxed">
                <div className="sub-section-label">处理建议</div>
                {report?.suggestion || '—'}
              </div>
            </div>
          </div>

          {/* ── 分区三 处理反馈（11-20 拍板：两态渲染——editRecord 可编辑表单；viewer 只读展示已填反馈，不再整区隐藏）── */}
          <div className="scroll-mt-2 drawer-section-gap">
            <div className="section-title">产品侧处理反馈</div>
            <div className="page-card-sm page-card-bordered">
              {readOnly ? (
                /* 只读态（viewer / 诊断能力需求页复用）：已填反馈结构化展示，未填显示空态提示 */
                group && (String(group.productActionStatus || '') !== '' || String(group.measureFeedback || '').trim()) ? (
                  <Descriptions size="small" column={1} bordered
                    items={[
                      { key: 'status', label: '处理状态', children: String(/** @type {{productActionStatus?: string}} */ (group).productActionStatus || '—') },
                      { key: 'confirmed', label: '根因是否属实', children: String(/** @type {{rootCauseConfirmed?: string}} */ (group).rootCauseConfirmed || '—') },
                      { key: 'realRootCause', label: '真实根因', children: String(/** @type {{realRootCause?: string}} */ (group).realRootCause || '—') },
                      { key: 'measure', label: '备注', children: String(/** @type {{measureFeedback?: string}} */ (group).measureFeedback || '—') },
                      { key: 'action', label: '确立举措', children: String(/** @type {{establishedAction?: string}} */ (group).establishedAction || '—') },
                      { key: 'schedule', label: '举措排期', children: String(/** @type {{actionSchedule?: string}} */ (group).actionSchedule || '—') },
                      { key: 'assignee', label: '经办人', children: String(/** @type {{assignee?: string}} */ (group).assignee || '—') },
                      { key: 'manualL1', label: '人工修正大类', children: String(/** @type {{rootCauseL1Manual?: string}} */ (group).rootCauseL1Manual || '—') },
                      { key: 'manualL2', label: '人工修正细分', children: String(/** @type {{rootCauseL2Manual?: string}} */ (group).rootCauseL2Manual || '—') },
                      { key: 'feedbackBy', label: '反馈人/时间', children: [
                        String(/** @type {{feedbackBy?: string}} */ (group).feedbackBy || ''),
                        String(/** @type {{feedbackAt?: string}} */ (group).feedbackAt || ''),
                      ].filter(Boolean).join(' · ') || '—' },
                    ]}
                  />
                ) : (
                  <Typography.Text type="secondary" className="text-xs">尚无处理反馈</Typography.Text>
                )
              ) : (
                <Form form={form} layout="vertical">
                  {/* 根因分类人工修正（11-18 拍板）：manual 独立存储不覆盖 LLM 原判；
                      修正值即"根因不属实"时表单意义上的真实根因载体，列表立即按人工值展示（·人工 标识） */}
                  <div className="mb-3 rounded-md bg-ink-50/60 p-2">
                    <div className="sub-section-label mb-1">根因分类（AI 判定与人工修正）</div>
                    <Typography.Text type="secondary" className="mb-2 block text-xs">
                      {/* 11-18 晚拍板：同源派生 ai-original 模式——对照行取 AI 原判（manual 修正另在下方表单），
                          来源标注旧值/缺口类 L2 与列表同口径过滤 */}
                      AI 判定：{(() => {
                        if (!group) return '—'
                        const { l1, l2, hasManual } = displayRootCause(group, 'ai-original')
                        // 11-25/11-26 拍板：两类归属提示内联——缺口=诊断链路问题；可观测性=产品问题（补错误码后自消）
                        const gapNote = l1 === '诊断能力缺口'
                          ? '（缺口=诊断链路查不到失败原因，属诊断能力提供方问题；若标「待处理」，诉求是补提示与可诊断日志，非修复产品缺陷）'
                          : l1 === '产品可观测性不足'
                            ? '（日志在但读不出失败原因——平台未把失败落成可诊断形态，责任在产品：补错误码/提示后此类自消）'
                            : ''
                        return (l1 || '未诊断') + (l2 ? ` / ${l2}` : '') + gapNote + (hasManual ? '（已被人工修正）' : '')
                      })()}
                    </Typography.Text>
                    {diagnosis?.actionReason ? (
                      <Typography.Text type="secondary" className="mb-2 block text-xs">
                        处理判定依据：{String(/** @type {{actionReason?: string}} */ (diagnosis).actionReason)}
                        （{String(/** @type {{productActionStatus?: string}} */ (group).productActionStatus || '') === '—' ? '不需产品侧处理' : '需产品侧处理'}）
                      </Typography.Text>
                    ) : null}
                    <div className="flex flex-wrap items-start gap-2">
                      <Form.Item label={<FieldLabel>修正根因大类</FieldLabel>} name="rootCauseL1Manual" className="!mb-0" style={{ minWidth: 180 }}>
                        <Select
                          allowClear
                          placeholder="不改则留空"
                          options={ROOT_CAUSE_L1_OPTIONS.map((v) => ({ label: v, value: v }))}
                        />
                      </Form.Item>
                      <Form.Item label={<FieldLabel>修正细分场景</FieldLabel>} name="rootCauseL2Manual" className="!mb-0" style={{ minWidth: 180 }}>
                        <Input placeholder="不改则留空" maxLength={60} />
                      </Form.Item>
                    </div>
                  </div>
                  <Form.Item label={<FieldLabel required>根因是否属实</FieldLabel>} name="rootCauseConfirmed"
                    rules={[{ required: true, message: '请选择根因是否属实' }]}>
                    <Select options={[
                      { label: '属实', value: '属实' },
                      { label: '不属实', value: '不属实' },
                    ]} />
                  </Form.Item>
                  <Form.Item noStyle shouldUpdate={(a, b) => a.rootCauseConfirmed !== b.rootCauseConfirmed}>
                    {() => form.getFieldValue('rootCauseConfirmed') === '不属实' && (
                      <Form.Item label={<FieldLabel required>真实根因</FieldLabel>} name="realRootCause"
                        rules={[{ required: true, message: '根因不属实时必须填写真实根因' }]}>
                        <Input.TextArea rows={2} placeholder="请填写实际根因（必填）" />
                      </Form.Item>
                    )}
                  </Form.Item>
                  {/* 确立举措（11-18 拍板）：与投诉咨询单抽屉同语义——库选/手填 + 排期可空；不强制必填。
                      Form.Item noStyle shouldUpdate 桥接——组件读 props 需 form 值变化触发重渲染 */}
                  <Form.Item noStyle shouldUpdate={(a, b) =>
                    a.actionId !== b.actionId || a.establishedAction !== b.establishedAction || a.actionSchedule !== b.actionSchedule}>
                    {() => (
                      <EstablishedActionFields
                        productKey={group ? String(/** @type {{productKey?: string}} */ (group).productKey || '') : ''}
                        source="api_patrol"
                        actionId={form.getFieldValue('actionId') || ''}
                        establishedAction={form.getFieldValue('establishedAction') || ''}
                        actionSchedule={form.getFieldValue('actionSchedule') || ''}
                        disabled={submitting}
                        onSelect={(item) => form.setFieldsValue({
                          actionId: item.id,
                          establishedAction: item.content,
                          // ActionItem 领域类型与组件回调类型的历史错位同 ActionItemSelect 基线——局部断言
                          actionSchedule: getActionItemDisplayScheduleAt(/** @type {any} */ (item)),
                        })}
                        onClear={() => form.setFieldsValue({ actionId: '', establishedAction: '', actionSchedule: '' })}
                        onContentChange={(v) => form.setFieldsValue({ establishedAction: v })}
                        onScheduleChange={(v) => form.setFieldsValue({ actionSchedule: v })}
                      />
                    )}
                  </Form.Item>
                  {/* 备注（11-18 拍板改名：旧「举措及排期」文案退场；结构化举措由上方确立举措模块独立承载） */}
                  <Form.Item label={<FieldLabel required>备注</FieldLabel>} name="measureFeedback"
                    rules={[{ required: true, message: '请填写备注（不涉及也请说明）' }]}>
                    <Input.TextArea rows={3} placeholder="如：已修复 v1.2 / 已排期下迭代 / 不涉及（说明原因）" />
                  </Form.Item>
                  <Form.Item label={<FieldLabel>经办人</FieldLabel>} name="assignee">
                    <Input placeholder="经办人（可修改）" />
                  </Form.Item>
                </Form>
              )}
            </div>
          </div>

          {/* ── 分区四 关联请求明细（方案 B 拍板：数据明细独立分区，不是反馈的一部分）── */}
          <div className="scroll-mt-2 drawer-section-gap">
            <div className="section-title">关联请求明细</div>
            <div className="page-card-sm page-card-bordered">
              <Collapse
                activeKey={allRecordsOpen}
                onChange={(keys) => setAllRecordsOpen(Array.isArray(keys) ? keys : [keys])}
                items={[{
                  key: 'allRecords',
                  label: `压缩前全部记录（${requests.length} 条）`,
                  children: requests.length > 0 ? (
                    <Table
                      rowKey="requestId"
                      size="small"
                      dataSource={requests}
                      pagination={{ pageSize: 10, showSizeChanger: false, showTotal: paginationShowTotal }}
                      columns={[
                        // RequestID 完整显示不截断（11-17 拍板）：reqId-+32hex=38 字符，
                        // 去掉 ellipsis、放宽列、word-break 兜底超长形态
                        { title: 'RequestID', dataIndex: 'requestId', key: 'requestId', width: 330,
                          render: (v) => <span className="whitespace-normal break-all">{v}</span> },
                        { title: '开始时间', dataIndex: 'requestTime', key: 'requestTime', width: 160 },
                        // 结束时间：ELB 行有值；EIP 行原始 CSV 无此列恒 null → 显示 —
                        { title: '结束时间', dataIndex: 'endTime', key: 'endTime', width: 160,
                          render: (v) => v || '—' },
                      ]}
                    />
                  ) : (
                    <Typography.Text type="secondary">（无压缩前请求明细）</Typography.Text>
                  ),
                }]}
              />
            </div>
          </div>
        </div>
      )}

      <Modal
        open={confirmOpen}
        title={confirmSubmit ? '确认提交（状态将变为：已处理）？' : '确认暂存（状态将变为：处理中）？'}
        okText="确认"
        cancelText="取消"
        confirmLoading={submitting}
        onOk={doSubmit}
        onCancel={() => setConfirmOpen(false)}
      >
        {confirmSubmit
          ? '提交后该失败组标记为已处理，变更将写入审计日志。'
          : '暂存后该失败组保持处理中，后续可继续完善反馈。'}
      </Modal>

      {/* 原始日志弹窗（11-20 19:39 拍板：Modal 承载全文；19:51 拍板：尺寸对齐反馈库处理意见弹窗
          先例（min(96vw,1280px)+centered+78vh 内部滚动）+ footer「复制全文」快捷复制） */}
      <Modal
        open={rawLogModalOpen}
        title={`原始日志${Number.isFinite(Number(report?.directCause?.rawCount)) && Number(report.directCause.rawCount) > 0 ? `（${report.directCause.rawCount} 行）` : ''}${group?.firstRequestId ? ` · ${group.firstRequestId}` : ''}`}
        centered
        width="min(96vw, 1280px)"
        destroyOnClose
        footer={[
          <Button key="copy" icon={<CopyOutlined />}
            onClick={() => copyTextToClipboard(String(diagnosis?.mcpRawResponse || ''))
              .then(() => message.success('已复制日志全文'), () => message.error('复制失败，请手动选择复制'))}>
            复制全文
          </Button>,
          <Button key="close" type="primary" onClick={() => setRawLogModalOpen(false)}>
            关闭
          </Button>,
        ]}
        styles={{ body: { maxHeight: '78vh', overflowY: 'auto' } }}
        onCancel={() => setRawLogModalOpen(false)}
      >
        <div
          ref={rawLogPaneRef}
          className="font-mono text-[13px] leading-relaxed bg-ink-50/60 rounded p-3 whitespace-pre-wrap break-all select-text cursor-text"
          onMouseUp={captureLogSelection}
        >
          {String(diagnosis?.mcpRawResponse || '')}
        </div>
        {/* 框选快捷复制气泡（FeedbackDrawer 处理意见弹窗同款交互——选中日志片段后浮动「复制选中」） */}
        {selectionBubble && (
          <div
            className="fixed z-[1200] flex gap-1 rounded-md border border-ink-200 bg-white p-1 shadow-lg"
            style={{ top: selectionBubble.top, left: selectionBubble.left }}
            onMouseDown={(event) => event.preventDefault()}
          >
            <Button size="small" type="primary" icon={<CopyOutlined />} onClick={copyLogSelection}>
              复制选中
            </Button>
          </div>
        )}
      </Modal>
    </Drawer>
  )
}

// 11-19 具名导出：诊断能力需求页复用（readOnly 形态——不渲染反馈表单/footer）。
// 寄生导出权衡：40+ 守卫锚点锚在本文件，提取独立文件成本高；Jira 版动抽屉前再提取（届时迁移锚点）。
export { FailureGroupDrawer, displayRootCause }
