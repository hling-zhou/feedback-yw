import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button, DatePicker, Descriptions, Drawer, Form, Input, Modal, Select, Space, Table, Tabs, Tag, Tooltip, Typography, Collapse } from 'antd'
import dayjs from 'dayjs'
import { useSearchParams } from 'react-router-dom'
import { apiFetch } from '../../lib/apiClient.js'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { useAuth } from '../../context/AuthContext.jsx'
import FieldLabel from '../FieldLabel.jsx'
import { paginationShowTotal } from '../../lib/paginationTotal.js'

const { RangePicker } = DatePicker

/**
 * API 巡检 · 异常接口溯源页（docs/DESIGN-API巡检.md §7.1）。
 * ①异常接口列表：时间范围（近7天/30天/自定义）+ stats 驱动（次数从明细 Σ 重算，跨日口径 API 处理）
 * ②失败请求列表：复合搜索 + L1·L2 两级 Tag + 处理状态快捷筛选
 * ③详情抽屉：诊断原文 + 处理闭环（提交=已处理/暂存=处理中）
 * 数据来自 /api/patrol/failures/*（camelCase 返回）。
 */
const ROOT_CAUSE_L1_OPTIONS = [
  '业务冲突', '配额不足', '资源锁定/并发冲突', '参数无效/校验失败', '资源状态异常', '诊断能力缺口', '其他/未归类',
]
const STATUS_OPTIONS = ['待处理', '处理中', '已处理', '—', '未诊断']
const PRODUCT_ACTION_FILTER = '需产品侧处理'
const CUSTOMER_TYPE_LABELS = { 仿真: '仿真', 测试账号: '测试' }

/**
 * 表头吸顶测量（11-17）：观察 ref 元素高度并回传 setState——卡片内工具条 → Table sticky.offsetHeader。
 * 照抄 Feedbacks.jsx stickyChromeHeight 先例（ResizeObserver + 初次同步）。
 * @param {React.RefObject<HTMLElement | null>} ref 工具条 ref
 * @param {(h: number) => void} onHeight 高度回调
 */
function useMeasureHeight(ref, onHeight) {
  const cbRef = useRef(onHeight)
  cbRef.current = onHeight
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return undefined
    const sync = () => cbRef.current(el.offsetHeight)
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(el)
    return () => observer.disconnect()
  }, [ref])
}

export default function ApiPatrolFailures() {
  const message = useAppMessage()
  const { can } = useAuth()
  const [searchParams] = useSearchParams()
  const rootCauseFromUrl = searchParams.get('rootCauseL1') || ''
  const readOnly = !can('manageTags')
  const [activeTab, setActiveTab] = useState(rootCauseFromUrl ? 'groups' : 'interfaces')

  /** @type {[any, React.Dispatch<React.SetStateAction<any>>]} */
  const [range, setRange] = useState([dayjs().subtract(6, 'day'), dayjs()])
  const [interfaces, setInterfaces] = useState([])
  const [loadingInterfaces, setLoadingInterfaces] = useState(false)
  /** @type {[any, React.Dispatch<React.SetStateAction<any>>]} */
  const [summaryData, setSummaryData] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  const [groups, setGroups] = useState([])
  const [loadingGroups, setLoadingGroups] = useState(false)
  const [filters, setFilters] = useState({
    product: '', metricName: '', apiPath: '', requestId: '', userName: '',
    rootCauseL1: rootCauseFromUrl, status: '', customerType: '', assignee: '',
  })
  /** 经办人选项（11-17：DISTINCT 端点，时间范围内有组的非空经办人） */
  const [assigneeOptions, setAssigneeOptions] = useState([])
  /** 分产品计数（11-17：两 tab 产品筛选共用——异常接口按接口行/失败请求按组数） */
  const [productCounts, setProductCounts] = useState([])
  /** 异常接口列表产品筛选（单选；跨 tab 独立状态——两 tab 口径不同不共享值） */
  const [interfaceProduct, setInterfaceProduct] = useState('')

  // 表头吸顶（11-17）：卡片内吸顶——测量工具条高度传 Table sticky.offsetHeader
  // （照抄 FeedbackTable/CustomerVisitTable 先例：ResizeObserver 测量传递，非 page-sticky-chrome）
  const interfacesToolbarRef = useRef(null)
  const groupsToolbarRef = useRef(null)
  const [interfacesToolbarH, setInterfacesToolbarH] = useState(0)
  const [groupsToolbarH, setGroupsToolbarH] = useState(0)
  useMeasureHeight(interfacesToolbarRef, setInterfacesToolbarH)
  useMeasureHeight(groupsToolbarRef, setGroupsToolbarH)
  /** @type {[number | null, Function]} */
  const [drawerId, setDrawerId] = useState(null)
  const [drawerData, setDrawerData] = useState(null)
  const [drawerLoading, setDrawerLoading] = useState(false)

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
      const k = g.rootCauseL1 || '未诊断'
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
      render: (record) => (
        <Space size={4} wrap>
          {record.rootCauseL1 ? <Tag color="blue">{record.rootCauseL1}</Tag> : null}
          {record.rootCauseL2 ? <Tag>{record.rootCauseL2}</Tag> : null}
          {!record.rootCauseL1 && !record.rootCauseL2 ? <Tag>未诊断</Tag> : null}
        </Space>
      ),
    },
    {
      title: '压缩前失败次数', dataIndex: 'preCompressCount', key: 'preCompressCount', width: 110, align: 'right',
      render: (v) => (
        <Tooltip title="压缩规则：同客户同接口 1 小时内的失败请求链压缩为一组，此处为压缩前的失败请求条数">
          <span>{v}</span>
        </Tooltip>
      ),
    },
    {
      title: '产品侧处理状态', dataIndex: 'productActionStatus', key: 'productActionStatus', width: 120,
      render: (v) => {
        if (v === '待处理') return <Tag color="orange">待处理</Tag>
        if (v === '处理中') return <Tag color="processing">处理中</Tag>
        if (v === '已处理') return <Tag color="green">已处理</Tag>
        if (v === 'pending_diagnosis' || v === '未诊断') return <Tag>未诊断</Tag>
        return <Tag>{v || '—'}</Tag>
      },
    },
    { title: '经办人', dataIndex: 'assignee', key: 'assignee', width: 90,
      render: (v) => v || '—' },
  ], [openDrawer])

  return (
    <div className="space-y-4">
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

      <div className="page-card">
        <Tabs
          className="[&_.ant-tabs-tab]:font-semibold"
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'interfaces',
              label: '异常接口列表',
              children: (
                <>
                  <div ref={interfacesToolbarRef} className="flex flex-wrap items-center justify-between gap-2">
                    {/* 11-17：产品筛选（分产品计数——接口行口径）；说明行已按拍板移除 */}
                    <Select
                      size="small"
                      placeholder="全部产品"
                      allowClear
                      className="!w-40"
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
                    columns={interfaceColumns}
                    dataSource={interfaces}
                    loading={loadingInterfaces}
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: false, showTotal: paginationShowTotal }}
                    sticky={interfacesToolbarH > 0 ? { offsetHeader: interfacesToolbarH } : undefined}
                  />
                </>
              ),
            },
            {
              key: 'groups',
              label: '失败请求列表',
              children: (
                <>
                  <div ref={groupsToolbarRef} className="flex flex-wrap items-center justify-between gap-2">
                    <Space className="!my-0" wrap size="small">
                      {/* 产品筛选（11-17）：组数口径计数；进入 groups 查询的 q.product 精确匹配 */}
                      <Select
                        size="small"
                        placeholder="全部产品"
                        allowClear
                        className="!w-40"
                        value={filters.product || undefined}
                        options={productCounts.map((p) => ({
                          label: `${p.name}（${p.groupCount}）`,
                          value: p.key,
                        }))}
                        onChange={(v) => setFilters((f) => ({ ...f, product: v || '' }))}
                      />
                      <Button
                        size="small"
                        type={filters.status === PRODUCT_ACTION_FILTER ? 'primary' : 'default'}
                        title="包含待处理、处理中、已处理"
                        aria-pressed={filters.status === PRODUCT_ACTION_FILTER}
                        onClick={() => setFilters((current) => ({
                          ...current,
                          status: current.status === PRODUCT_ACTION_FILTER ? '' : PRODUCT_ACTION_FILTER,
                        }))}
                      >
                        需产品侧处理
                      </Button>
                      <Input.Search size="small" placeholder="RequestID" allowClear className="!w-40"
                        onSearch={(v) => setFilters((f) => ({ ...f, requestId: v }))} />
                      <Input.Search size="small" placeholder="指标名称" allowClear className="!w-28"
                        onSearch={(v) => setFilters((f) => ({ ...f, metricName: v }))} />
                      <Input.Search size="small" placeholder="接口名称" allowClear className="!w-44"
                        onSearch={(v) => setFilters((f) => ({ ...f, apiPath: v }))} />
                      <Input.Search size="small" placeholder="客户名称" allowClear className="!w-32"
                        onSearch={(v) => setFilters((f) => ({ ...f, userName: v }))} />
                      <Select size="small" placeholder="根因 L1" allowClear className="!w-36"
                        value={filters.rootCauseL1 || undefined}
                        options={withCount(ROOT_CAUSE_L1_OPTIONS, l1Counts)}
                        onChange={(v) => setFilters((f) => ({ ...f, rootCauseL1: v || '' }))} />
                      <Select size="small" placeholder="处理状态" allowClear className="!w-28"
                        value={STATUS_OPTIONS.includes(filters.status) ? filters.status : undefined}
                        options={withCount(STATUS_OPTIONS, statusCounts)}
                        onChange={(v) => setFilters((f) => ({ ...f, status: v || '' }))} />
                      <Select size="small" placeholder="客户类型" allowClear className="!w-24"
                        options={[{ label: '仿真', value: '仿真' }, { label: '测试账号', value: '测试账号' }]}
                        onChange={(v) => setFilters((f) => ({ ...f, customerType: v || '' }))} />
                      {/* 经办人（11-17）：单选 + showSearch 模糊匹配；选项 = 当前时间范围 DISTINCT 经办人 */}
                      <Select
                        size="small"
                        placeholder="经办人"
                        allowClear
                        showSearch
                        className="!w-32"
                        value={filters.assignee || undefined}
                        optionFilterProp="label"
                        options={assigneeOptions.map((a) => ({
                          label: `${a.assignee}（${a.count}）`,
                          value: a.assignee,
                        }))}
                        onChange={(v) => setFilters((f) => ({ ...f, assignee: v || '' }))}
                      />
                    </Space>
                    <Button size="small" onClick={() => { loadGroups(); }}>刷新</Button>
                  </div>
                  <Table
                    rowKey="id"
                    columns={groupColumns}
                    dataSource={groups}
                    loading={loadingGroups}
                    size="small"
                    pagination={{ pageSize: 20, showSizeChanger: false, showTotal: paginationShowTotal }}
                    scroll={{ x: 1430 }}
                    sticky={groupsToolbarH > 0 ? { offsetHeader: groupsToolbarH } : undefined}
                    onRow={(record) => ({
                      onClick: () => openDrawer(record.id),
                      style: { cursor: 'pointer' },
                    })}
                  />
                </>
              ),
            },
          ]}
        />
      </div>

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
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(true)
  // 压缩前全部记录：默认收起（11-17 拍板）
  const [allRecordsOpen, setAllRecordsOpen] = useState([])
  // 直接原因日志：第一层默认收起；展开后显示核心行；「查看完整日志」第二层（11-17 拍板）
  const [logLinesOpen, setLogLinesOpen] = useState(false)
  const [rawLogOpen, setRawLogOpen] = useState(false)
  const group = data?.group
  const diagnosis = data?.diagnosis
  const report = data?.diagnosisReport
  const requests = data?.requests || []

  useEffect(() => {
    if (group) {
      form.setFieldsValue({
        rootCauseConfirmed: /** @type {{rootCauseConfirmed?: string}} */ (group).rootCauseConfirmed || undefined,
        realRootCause: '',
        measureFeedback: /** @type {{measureFeedback?: string}} */ (group).measureFeedback || '',
        assignee: /** @type {{assignee?: string}} */ (group).assignee || undefined,
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
                  { key: 'count', label: '压缩前失败次数', children: String(/** @type {{preCompressCount?: number}} */ (group).preCompressCount ?? '') },
                  { key: 'status', label: '产品侧处理状态', children: String(/** @type {{productActionStatus?: string}} */ (group).productActionStatus || '') },
                  { key: 'assignee', label: '经办人', children: String(/** @type {{assignee?: string}} */ (group).assignee || '—') },
                ]}
              />
            </div>
          </div>

          {/* ── 分区二 诊断结果（五段照 11-17 拍板；样式对齐 D4/D5）── */}
          <div className="scroll-mt-2 drawer-section-gap">
            <div className="section-title">诊断结果</div>
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
              {/* ③ 直接原因——默认收起；展开显示核心行；「查看完整日志」第二层（日志 13px 等宽） */}
              <div>
                <div className="sub-section-label">直接原因（含日志原文、返回体）</div>
                {report && (report.directCause?.logLines?.length || report.directCause?.returnFragments?.length) ? (
                  <>
                    {(report.directCause.returnFragments || []).map((f, i) => (
                      <div key={`ret-${i}`} className="text-xs text-ink-500">{f}</div>
                    ))}
                    <Button type="link" size="small" className="!px-0"
                      onClick={() => setLogLinesOpen(!logLinesOpen)}>
                      {logLinesOpen ? '收起日志' : `展开日志核心行（${(report.directCause.logLines || []).length} 条）`}
                    </Button>
                    {logLinesOpen && (
                      <div className="mt-1">
                        {(report.directCause.logLines || []).map((l, i) => (
                          <div key={`log-${i}`} className="font-mono text-[13px] bg-ink-50/60 rounded p-2 mb-1 whitespace-pre-wrap break-all">{l}</div>
                        ))}
                        <Button type="link" size="small" className="!px-0"
                          onClick={() => setRawLogOpen(!rawLogOpen)}>
                          {rawLogOpen ? '收起完整日志' : `查看完整日志（原始 ${report.directCause.rawCount} 行，本页仅核心 10 条）`}
                        </Button>
                        {rawLogOpen && (
                          <div className="font-mono text-[13px] bg-ink-50/60 rounded p-2 mt-1 whitespace-pre-wrap break-all">
                            {String(diagnosis?.mcpRawResponse || '').slice(0, 4000)}
                            {String(diagnosis?.mcpRawResponse || '').length > 4000 ? '\n…（超过 4000 字截断）' : ''}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <Typography.Text type="secondary" className="text-xs">—</Typography.Text>
                )}
              </div>
              {/* ④ 关键证据（正文 13px） */}
              <div>
                <div className="sub-section-label">关键证据</div>
                {report?.evidence?.length ? (
                  <ul className="text-[13px] space-y-1 list-disc pl-5">
                    {report.evidence.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                ) : (
                  <Typography.Text type="secondary" className="text-xs">—</Typography.Text>
                )}
              </div>
              {/* ⑤ 处理建议——浅蓝高亮（左竖条 3px；正文 13px） */}
              <div className="p-3 rounded border-l-[3px] border-blue-300 bg-blue-50 text-[13px] leading-relaxed">
                <div className="sub-section-label">处理建议</div>
                {report?.suggestion || '—'}
              </div>
            </div>
          </div>

          {/* ── 分区三 处理反馈（!readOnly）── */}
          {!readOnly && (
            <div className="scroll-mt-2 drawer-section-gap">
              <div className="section-title">产品侧处理反馈</div>
              <div className="page-card-sm page-card-bordered">
                <Form form={form} layout="vertical">
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
                  <Form.Item label={<FieldLabel required>举措及排期说明</FieldLabel>} name="measureFeedback"
                    rules={[{ required: true, message: '请填写举措及排期（不涉及也请说明）' }]}>
                    <Input.TextArea rows={3} placeholder="如：已修复 v1.2 / 已排期下迭代 / 不涉及（说明原因）" />
                  </Form.Item>
                  <Form.Item label={<FieldLabel>经办人</FieldLabel>} name="assignee">
                    <Input placeholder="经办人（可修改）" />
                  </Form.Item>
                </Form>
              </div>
            </div>
          )}

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
    </Drawer>
  )
}
