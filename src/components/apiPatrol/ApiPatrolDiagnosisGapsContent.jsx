import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, DatePicker, Drawer, Empty, Space, Table, Tag, Tooltip, Typography,
} from 'antd'
import {
  CopyOutlined, InfoCircleOutlined, ReloadOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useAuth } from '../../context/AuthContext.jsx'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { apiFetch } from '../../lib/apiClient.js'
import { copyTextToClipboard } from '../../lib/clipboard.js'
import { paginationShowTotal } from '../../lib/paginationTotal.js'
import { useColumnResize } from '../../hooks/useColumnResize.js'
import { sumColumnsWidth } from '../../lib/columnWidths.js'
import { FailureGroupDrawer } from './ApiPatrolFailuresContent.jsx'

const { RangePicker } = DatePicker

/** 缺口类型 Tag 语义（与服务端 classifyGapKind 对应——11-19 拍板：MCP 响应推断，不维护池清单） */
const GAP_KIND_LABELS = {
  log_not_collected: { label: '日志未采集', color: 'orange' },
  failure_log_missing: { label: '失败日志缺失', color: 'gold' },
}

/**
 * API 巡检 · 诊断能力需求池（11-19 拍板）。
 * 「诊断能力缺口」类失败请求汇集——作为云网工作台 MCP 日志服务诊断能力建设的需求输入。
 * 第一版只读：浏览/复核/复制交付；Jira 提单与状态回传为后续扩展（端点命名空间已预留）。
 *
 * 页面结构：引导卡（定位+窗口统计+全局日期控件）→ 分区一 池未接入 MCP（数据驱动，
 * 无实例不渲染）→ 分区二 池已接入·诊断能力不足（接口聚合清单，复制交付）→
 * 明细卡（下钻才现）→ 详情抽屉（readOnly）。
 */
export default function ApiPatrolDiagnosisGapsContent() {
  const message = useAppMessage()
  const { user } = useAuth()
  // 默认近30天（需求池滚动语义——非巡检 T-1 口径）
  const [range, setRange] = useState(/** @type {[import('dayjs').Dayjs, import('dayjs').Dayjs]} */ ([dayjs().subtract(29, 'day'), dayjs()]))
  /** @type {[{stats: Record<string, number>, uncoveredPools: Array<Record<string, unknown>>, rows: Array<Record<string, unknown>>} | null, Function]} */
  const [summary, setSummary] = useState(null)
  const [loadingSummary, setLoadingSummary] = useState(false)
  /** @type {[Array<Record<string, unknown>>, Function]} */
  const [detailRows, setDetailRows] = useState([])
  const [loadingDetail, setLoadingDetail] = useState(false)
  /** 下钻过滤（null=未下钻不显示明细卡；「全部」=空过滤全量） */
  const [drill, setDrill] = useState(/** @type {{productKey: string, apiPath: string, poolName: string, aggregateKey?: string} | 'all' | null} */ (null))
  const [drawerId, setDrawerId] = useState(null)
  const [drawerData, setDrawerData] = useState(null)
  const [drawerLoading, setDrawerLoading] = useState(false)

  const aggResize = useColumnResize({ tableKey: 'patrol.diagnosisGaps.agg', userId: user?.id })
  const detailResize = useColumnResize({ tableKey: 'patrol.diagnosisGaps.detail', userId: user?.id })

  const rangeParams = useMemo(() => ({
    startDate: range[0].format('YYYY-MM-DD'),
    endDate: range[1].format('YYYY-MM-DD'),
  }), [range])

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true)
    try {
      const qs = new URLSearchParams(rangeParams).toString()
      const data = await apiFetch(`/api/patrol/diagnosis-gaps/summary?${qs}`)
      setSummary(data)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载诊断能力需求池失败')
    } finally {
      setLoadingSummary(false)
    }
  }, [rangeParams, message])

  const loadDetail = useCallback(async (drillState) => {
    setLoadingDetail(true)
    try {
      const qs = new URLSearchParams({ ...rangeParams, rootCauseL1: '诊断能力缺口' })
      if (drillState && drillState !== 'all') {
        qs.set('product', drillState.productKey)
        qs.set('apiPathExact', drillState.apiPath)
        qs.set('poolName', drillState.poolName)
      }
      const data = await apiFetch(`/api/patrol/failures/groups?${qs.toString()}`)
      setDetailRows(data?.rows || [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载缺口组明细失败')
    } finally {
      setLoadingDetail(false)
    }
  }, [rangeParams, message])

  useEffect(() => { loadSummary() }, [loadSummary])
  useEffect(() => {
    if (drill) loadDetail(drill)
    else setDetailRows([])
  }, [drill, loadDetail])

  const openDrawer = useCallback(async (id) => {
    setDrawerId(id)
    setDrawerData(null)
    setDrawerLoading(true)
    try {
      const data = await apiFetch(`/api/patrol/failures/groups/${id}`)
      setDrawerData(data)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载详情失败')
      setDrawerId(null)
    } finally {
      setDrawerLoading(false)
    }
  }, [message])

  const copyIds = useCallback(async (ids, label) => {
    try {
      await copyTextToClipboard(ids.join('\n'))
      message.success(`已复制 ${ids.length} 个请求ID${label ? `（${label}）` : ''}`)
    } catch {
      message.error('复制失败，请手动选择文本')
    }
  }, [message])

  // 聚合清单列（分区二）
  const aggColumns = useMemo(() => aggResize.decorateColumns([
    { title: '产品', dataIndex: 'productName', key: 'productName', width: 110, ellipsis: true },
    { title: '接口名称', dataIndex: 'apiPath', key: 'apiPath', width: 220, ellipsis: true },
    { title: '资源池', dataIndex: 'poolName', key: 'poolName', width: 120, ellipsis: true },
    {
      title: '缺口类型', key: 'gapKinds', width: 150,
      render: (r) => (
        <Space size={4} wrap>
          {Number(r.gapKinds?.log_not_collected || 0) > 0
            ? <Tag color={GAP_KIND_LABELS.log_not_collected.color}>{GAP_KIND_LABELS.log_not_collected.label}×{r.gapKinds.log_not_collected}</Tag> : null}
          {Number(r.gapKinds?.failure_log_missing || 0) > 0
            ? <Tag color={GAP_KIND_LABELS.failure_log_missing.color}>{GAP_KIND_LABELS.failure_log_missing.label}×{r.gapKinds.failure_log_missing}</Tag> : null}
        </Space>
      ),
    },
    { title: '组数', dataIndex: 'groupCount', key: 'groupCount', width: 70, align: 'right' },
    { title: '压缩前失败次数', dataIndex: 'preCompressTotal', key: 'preCompressTotal', width: 110, align: 'right', render: (v) => <span className="text-red-600">{v}</span> },
    { title: '首次出现', dataIndex: 'firstDate', key: 'firstDate', width: 100 },
    { title: '最近出现', dataIndex: 'lastRequestTime', key: 'lastRequestTime', width: 150, ellipsis: true },
    {
      title: '操作', key: 'actions', width: 150,
      render: (r) => (
        <Button
          type="link" size="small" icon={<CopyOutlined />}
          onClick={(e) => { e.stopPropagation(); copyIds(r.requestIds || [], `${r.productName} ${r.apiPath}`) }}
        >
          复制请求ID（{String((r.requestIds || []).length)}）
        </Button>
      ),
    },
  ]), [aggResize, copyIds])

  // 明细列
  const detailColumns = useMemo(() => detailResize.decorateColumns([
    {
      title: 'RequestID', dataIndex: 'firstRequestId', key: 'firstRequestId', width: 200, fixed: 'left', ellipsis: true,
      render: (v, r) => (
        <Space size={2}>
          <Typography.Link onClick={(e) => { e.stopPropagation(); openDrawer(r.id) }}>{v}</Typography.Link>
          <CopyOutlined
            className="cursor-pointer text-ink-400 hover:text-ink-700"
            onClick={(e) => { e.stopPropagation(); copyTextToClipboard(String(v)).then(() => message.success('已复制 RequestID')) }}
          />
        </Space>
      ),
    },
    { title: '数据日期', dataIndex: 'groupDate', key: 'groupDate', width: 100 },
    { title: '首次请求时间', dataIndex: 'firstRequestTime', key: 'firstRequestTime', width: 150, ellipsis: true },
    { title: '产品', dataIndex: 'productKey', key: 'productKey', width: 90 },
    { title: '接口名称', dataIndex: 'apiPath', key: 'apiPath', width: 200, ellipsis: true },
    { title: '资源池', dataIndex: 'poolName', key: 'poolName', width: 110, ellipsis: true },
    {
      title: '客户名称', dataIndex: 'userName', key: 'userName', width: 130, ellipsis: true,
      render: (v, r) => (
        <Space size={4}>
          <span>{v}</span>
          {r.customerType ? <Tag className="!m-0">{r.customerType === '测试账号' ? '测试' : r.customerType}</Tag> : null}
        </Space>
      ),
    },
    {
      title: '压缩前失败次数', dataIndex: 'preCompressCount', key: 'preCompressCount', width: 120, align: 'right',
      render: (v) => <span className="text-red-600">{v}</span>,
    },
  ]), [detailResize, openDrawer, message])

  const rows = summary?.rows || []
  const uncoveredPools = summary?.uncoveredPools || []
  const stats = summary?.stats
  const activeDrillKey = drill && drill !== 'all' ? String(drill.aggregateKey || `${drill.productKey}|${drill.apiPath}|${drill.poolName}`) : (drill === 'all' ? 'all' : null)

  return (
    <div className="space-y-4">
      {/* ── 引导卡（页面上方通栏）：定位 + 窗口统计 + 全局日期控件（11-19 拍板：无三步用法）── */}
      <div className="page-card">
        <div className="page-card-header">
          <div className="min-w-0">
            <div className="page-card-title">诊断能力需求池</div>
            <div className="mt-1 text-xs text-ink-500">
              以下失败请求因日志服务查不到有效失败信息，暂无法定位根因；汇集于此作为
              <Typography.Text type="secondary">云网工作台 MCP 日志服务诊断能力建设的需求输入</Typography.Text>。
            </div>
            {stats && (
              <div className="mt-1 text-xs text-ink-400">
                当前窗口 {stats.groupCount} 个缺口组 · {stats.apiCount} 个接口 · 合计 {stats.preCompressTotal ?? '—'} 次失败
                {stats.uncoveredCount > 0 ? ` · 其中 ${stats.uncoveredCount} 组池未接入 MCP 日志服务` : ''}
              </div>
            )}
          </div>
          <Space wrap size="small">
            <RangePicker value={range} onChange={(v) => v && setRange(v)} allowClear={false} />
            <Button size="small" onClick={() => setRange([dayjs().subtract(6, 'day'), dayjs()])}>近7天</Button>
            <Button size="small" onClick={() => setRange([dayjs().subtract(29, 'day'), dayjs()])}>近30天</Button>
            <Button size="small" onClick={() => setRange([dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')])}>T-1</Button>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => { loadSummary(); if (drill) loadDetail(drill) }}>刷新</Button>
          </Space>
        </div>
      </div>

      {/* ── 分区一：池未接入 MCP 日志服务（数据驱动；无实例整卡不渲染）── */}
      {uncoveredPools.length > 0 && (
        <div className="page-card">
          <div className="page-card-header">
            <div className="min-w-0">
              <div className="page-card-title">池未接入 MCP 日志服务</div>
              <div className="mt-1 text-xs text-ink-500">以下资源池调用 MCP 日志服务失败或无诊断记录——需推动池接入日志服务。</div>
            </div>
          </div>
          <Table
            className="!mt-2"
            rowKey="poolName"
            size="small"
            columns={[
              { title: '资源池', dataIndex: 'poolName', key: 'poolName', width: 140 },
              { title: '组数', dataIndex: 'groupCount', key: 'groupCount', width: 80, align: 'right' },
              { title: '压缩前失败次数', dataIndex: 'preCompressTotal', key: 'preCompressTotal', width: 120, align: 'right', render: (v) => <span className="text-red-600">{v}</span> },
              { title: '最近出现', dataIndex: 'lastRequestTime', key: 'lastRequestTime', width: 160, ellipsis: true },
              {
                title: '操作', key: 'actions', width: 170,
                render: (r) => (
                  <Button type="link" size="small" icon={<CopyOutlined />} onClick={() => copyIds(r.requestIds || [], r.poolName)}>
                    复制请求ID（{String((r.requestIds || []).length)}）
                  </Button>
                ),
              },
            ]}
            dataSource={uncoveredPools}
            pagination={false}
          />
        </div>
      )}

      {/* ── 分区二：池已接入·诊断能力不足（接口聚合清单——需求主体）── */}
      <div className="page-card">
        <div className="page-card-header">
          <div className="min-w-0">
            <div className="page-card-title">池已接入 MCP，但查不到失败日志</div>
            <div className="mt-1 text-xs text-ink-500">
              MCP 调用正常但该请求的有效失败日志查不到——诊断能力建设需求主体；
              点击行查看该接口的缺口组明细。
            </div>
          </div>
          <Button type="link" size="small" onClick={() => setDrill('all')}>查看全部明细</Button>
        </div>
        <Table
          rowKey="aggregateKey"
          size="small"
          columns={aggColumns}
          dataSource={rows}
          loading={loadingSummary}
          pagination={rows.length > 20 ? { pageSize: 20, showSizeChanger: false, showTotal: paginationShowTotal } : false}
          scroll={{ x: sumColumnsWidth(aggColumns) }}
          sticky={{ offsetHeader: 0 }}
          onRow={(r) => ({
            onClick: () => setDrill({ productKey: String(r.productKey || ''), apiPath: String(r.apiPath || ''), poolName: String(r.poolName || ''), aggregateKey: String(r.aggregateKey || '') }),
            className: drill && drill !== 'all' && activeDrillKey === String(r.aggregateKey || '') ? 'bg-brand-50/40' : undefined,
          })}
          locale={{ emptyText: <Empty description="当前窗口无诊断能力缺口" /> }}
        />
      </div>

      {/* ── 明细卡：缺口组明细（仅下钻态渲染；「全部」=无过滤全量）── */}
      {drill && (
        <div className="page-card">
          <div className="page-card-header">
            <div className="min-w-0">
              <div className="page-card-title">缺口组明细</div>
              <div className="mt-1 text-xs text-ink-400">点击行查看失败组详情与 MCP 原始日志。</div>
            </div>
            <Space wrap size="small">
              {drill !== 'all' ? (
                <Space size={4}>
                  <Tag closable onClose={() => setDrill(null)}>
                    {drill.productKey} · {drill.apiPath} · {drill.poolName}
                  </Tag>
                </Space>
              ) : <Tag>全部缺口组</Tag>}
              <Button size="small" onClick={() => setDrill(null)}>清除</Button>
              <Button size="small" onClick={() => loadDetail(drill)}>刷新</Button>
            </Space>
          </div>
          <Table
            className="!mt-2"
            rowKey="id"
            size="small"
            columns={detailColumns}
            dataSource={detailRows}
            loading={loadingDetail}
            pagination={{ pageSize: 20, showSizeChanger: false, showTotal: paginationShowTotal }}
            scroll={{ x: sumColumnsWidth(detailColumns) }}
            sticky={{ offsetHeader: 0 }}
            onRow={(r) => ({ onClick: () => openDrawer(r.id), style: { cursor: 'pointer' } })}
            locale={{ emptyText: <Empty description="当前窗口无诊断能力缺口" /> }}
          />
        </div>
      )}

      {/* 详情抽屉：第一版整页只读（不渲染反馈表单/footer）；onSubmit 占位——readOnly 态无提交入口永不触发 */}
      <FailureGroupDrawer
        groupId={drawerId}
        data={drawerData}
        loading={drawerLoading}
        readOnly
        onClose={() => { setDrawerId(null); setDrawerData(null) }}
        onSubmit={undefined}
      />
    </div>
  )
}
