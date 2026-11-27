import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert, Button, DatePicker, Empty, Form, Input, Modal, Popconfirm, Space, Table, Tag, Tooltip, Typography,
} from 'antd'
import {
  CopyOutlined, DownloadOutlined, InfoCircleOutlined, ReloadOutlined,
} from '@ant-design/icons'
import { useAuth } from '../../context/AuthContext.jsx'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { apiFetch, getStoredToken } from '../../lib/apiClient.js'
import { copyTextToClipboard } from '../../lib/clipboard.js'
import { paginationShowTotal } from '../../lib/paginationTotal.js'
import { useColumnResize } from '../../hooks/useColumnResize.js'
import { sumColumnsWidth } from '../../lib/columnWidths.js'
import dayjs from 'dayjs'
import { FailureGroupDrawer } from './ApiPatrolFailuresContent.jsx'

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
  const { can, user } = useAuth()
  // 反馈闭环门控（11-27 拍板）：editRecord 可提交反馈（对齐 11-20 巡检处理反馈先例）；viewer 只读看状态列
  const canFeedback = can('editRecord')
  /** @type {[{stats: Record<string, number>, uncoveredPools: Array<Record<string, unknown>>, undiagnosedGroups: Array<Record<string, unknown>>, mcpErrorGroups: Array<Record<string, unknown>>, poolEnum: Record<string, unknown> | undefined, rows: Array<Record<string, unknown>>} | null, Function]} */
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

  // 反馈闭环弹窗态（11-27 拍板）：feedbackTarget=当前编辑的聚合行；Form 受控
  const [feedbackTarget, setFeedbackTarget] = useState(/** @type {{productKey: string, apiPath: string, poolName: string, resolution: {reason: string, fixPlan: string, scheduleAt: string, feedbackBy: string, feedbackAt: string} | null} | null} */ (null))
  const [feedbackForm] = Form.useForm()
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false)

  const aggResize = useColumnResize({ tableKey: 'patrol.diagnosisGaps.agg', userId: user?.id })
  const detailResize = useColumnResize({ tableKey: 'patrol.diagnosisGaps.detail', userId: user?.id })

  // 11-20 09:44 拍板「显示全部」→ 11-25 23:59 收窄：窗口下界 2026-11-10（与 summary 端点
  // GAP_DATE_FLOOR 同步——8 月 E2E 样例数据不进需求池，消除分区一误报污染）；上界保持极宽。
  const DETAIL_ALL_RANGE = { startDate: '2026-11-10', endDate: '2099-12-31' }

  const loadSummary = useCallback(async () => {
    setLoadingSummary(true)
    try {
      const data = await apiFetch('/api/patrol/diagnosis-gaps/summary')
      setSummary(data)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载诊断能力需求池失败')
    } finally {
      setLoadingSummary(false)
    }
  }, [message])

  const loadDetail = useCallback(async (drillState) => {
    setLoadingDetail(true)
    try {
      const qs = new URLSearchParams({ ...DETAIL_ALL_RANGE, rootCauseL1: '诊断能力缺口' })
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
  }, [message])

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

  // ── 反馈闭环（11-27 拍板）──────────────────────────────────────────
  // 打开弹窗：带出既有反馈（可改可更新）；记录弹窗打开时刻的快照避免编辑中数据漂移
  const openFeedback = (r) => {
    setFeedbackTarget({
      productKey: String(r.productKey || ''), apiPath: String(r.apiPath || ''), poolName: String(r.poolName || ''),
      resolution: r.resolution || null,
    })
    feedbackForm.setFieldsValue({
      reason: r.resolution?.reason || '',
      fixPlan: r.resolution?.fixPlan || '',
      // DatePicker 值=dayjs（先例 ApiPatrolFailuresContent range.format）；存量字符串按日期段解析
      scheduleAt: r.resolution?.scheduleAt ? dayjs(String(r.resolution.scheduleAt).slice(0, 10)) : undefined,
    })
  }
  // 提交：reason 必填（Form 规则兜底+服务端 400 双闸）；fixPlan/scheduleAt 非必填
  const submitFeedback = async () => {
    if (!feedbackTarget) return
    const values = await feedbackForm.validateFields()
    setFeedbackSubmitting(true)
    try {
      await apiFetch('/api/patrol/diagnosis-gaps/feedback', {
        method: 'POST',
        body: JSON.stringify({
          productKey: feedbackTarget.productKey, apiPath: feedbackTarget.apiPath, poolName: feedbackTarget.poolName,
          reason: String(values.reason || ''), fixPlan: String(values.fixPlan || ''),
          // dayjs → yyyy-MM-dd（与失败组 actionSchedule 同形态）；空选不传
          scheduleAt: values.scheduleAt ? values.scheduleAt.format('YYYY-MM-DD') : '',
        }),
      })
      message.success('已提交核实反馈')
      setFeedbackTarget(null)
      loadSummary()
      if (drill) loadDetail(drill)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '提交失败')
    } finally {
      setFeedbackSubmitting(false)
    }
  }
  // 撤销反馈：清记录回待核实（误填可逆；Popconfirm 二次确认）
  const revokeFeedback = async (r) => {
    try {
      await apiFetch(`/api/patrol/diagnosis-gaps/feedback?productKey=${encodeURIComponent(String(r.productKey || ''))}&apiPath=${encodeURIComponent(String(r.apiPath || ''))}&poolName=${encodeURIComponent(String(r.poolName || ''))}`, { method: 'DELETE' })
      message.success('已撤销，该条目回到待核实')
      loadSummary()
      if (drill) loadDetail(drill)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '撤销失败')
    }
  }

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
    // 11-20 18:02 拍板：删「压缩前失败次数」列（需求池只看缺口面数与组数；失败次数仍在引导卡合计与下钻明细）
    { title: '首次出现', dataIndex: 'firstDate', key: 'firstDate', width: 100 },
    { title: '最近出现', dataIndex: 'lastRequestTime', key: 'lastRequestTime', width: 150, ellipsis: true },
    // 核实状态列（11-27 拍板）：已核实绿标（hover 出原因/修复方案/排期/人）+ 待核实灰标
    {
      title: '核实状态', key: 'resolution', width: 120,
      render: (r) => {
        const fb = r.resolution
        if (!fb) return <Tag className="!m-0" color="default">待核实</Tag>
        const tip = (
          <div className="text-xs" style={{ maxWidth: 300 }}>
            <div className="font-medium mb-1">核实原因</div>
            <div className="whitespace-pre-line break-words">{fb.reason}</div>
            {fb.fixPlan ? <div className="mt-1">修复方案：{fb.fixPlan}</div> : null}
            {fb.scheduleAt ? <div>排期：{fb.scheduleAt}</div> : null}
            <div className="text-ink-400 mt-1">{fb.feedbackBy} · {String(fb.feedbackAt || '').slice(0, 10)}</div>
          </div>
        )
        return (
          <Tooltip title={tip}>
            <Tag className="!m-0" color="green">已核实</Tag>
            <div className="text-xs text-ink-400 mt-0.5">{fb.feedbackBy} · {String(fb.feedbackAt || '').slice(0, 10)}</div>
          </Tooltip>
        )
      },
    },
    {
      title: '操作', key: 'actions', width: 220,
      render: (r) => (
        <Space size={4} wrap>
          <Button
            type="link" size="small" className="!px-0" icon={<CopyOutlined />}
            onClick={(e) => { e.stopPropagation(); copyIds(r.requestIds || [], `${r.productName} ${r.apiPath}`) }}
          >
            复制请求ID（{String((r.requestIds || []).length)}）
          </Button>
          {canFeedback && (
            <Button
              type="link" size="small" className="!px-0"
              onClick={(e) => { e.stopPropagation(); openFeedback(r) }}
            >
              {r.resolution ? '修改反馈' : '核实原因'}
            </Button>
          )}
          {canFeedback && r.resolution && (
            <Popconfirm title="撤销后该条目回到待核实，确认？" onConfirm={() => revokeFeedback(r)}>
              <Button type="link" size="small" className="!px-0" onClick={(e) => e.stopPropagation()}>撤销</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ]), [aggResize, copyIds, canFeedback, openFeedback, revokeFeedback])

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
    // 根因细分 L2（11-20 18:02 拍板：明细同步加列——诊断分类器的细分标注；数据源已返回 rootCauseL2）
    { title: '根因细分', dataIndex: 'rootCauseL2', key: 'rootCauseL2', width: 130, ellipsis: true, render: (v) => (v ? <span title={v}>{v}</span> : '—') },
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
  const undiagnosedGroups = summary?.undiagnosedGroups || []
  const mcpErrorGroups = summary?.mcpErrorGroups || []
  const poolEnum = summary?.poolEnum
  const stats = summary?.stats
  const activeDrillKey = drill && drill !== 'all' ? String(drill.aggregateKey || `${drill.productKey}|${drill.apiPath}|${drill.poolName}`) : (drill === 'all' ? 'all' : null)
  // 未诊断清单复制内容：每行「日期 池 requestID」——用户拿清单自行补诊断（11-20 拍板：页面不提供触发按钮）
  const copyUndiagnosedList = () => {
    const lines = []
    for (const u of undiagnosedGroups) {
      const ids = Array.isArray(u.requestIds) ? u.requestIds.map(String) : []
      for (const id of ids) {
        lines.push(`${String(u.firstDate || '')}~${String(u.lastRequestTime || '').slice(0, 10)} ${String(u.poolName || '')} ${id}`)
      }
    }
    if (lines.length === 0) return
    copyTextToClipboard(lines.join('\n')).then(
      () => message.success(`已复制 ${lines.length} 个未诊断组的请求ID清单`),
      () => message.error('复制失败，请手动选择文本'),
    )
  }

  // MCP 报错组复制清单（11-20 14:48 拍板）：每行「日期 池 requestID」——枚举内池临时故障，补跑可愈
  const copyMcpErrorList = () => {
    const lines = []
    for (const u of mcpErrorGroups) {
      const ids = Array.isArray(u.requestIds) ? u.requestIds.map(String) : []
      for (const id of ids) {
        lines.push(`${String(u.firstDate || '')}~${String(u.lastRequestTime || '').slice(0, 10)} ${String(u.poolName || '')} ${id}`)
      }
    }
    if (lines.length === 0) return
    copyTextToClipboard(lines.join('\n')).then(
      () => message.success(`已复制 ${lines.length} 个 MCP 报错组的请求ID清单`),
      () => message.error('复制失败，请手动选择文本'),
    )
  }

  // 一键导出 xlsx（11-25 23:59 拍板）：能力提供方拿去分析/补齐能力——blob 下载
  // （apiFetch 是 JSON 专用，下载走原生 fetch + 同源 token；后端进程内自调 summary 同源判定）
  const [exporting, setExporting] = useState(false)
  const exportXlsx = async () => {
    setExporting(true)
    try {
      const res = await fetch('/api/patrol/diagnosis-gaps/export', {
        headers: { Authorization: `Bearer ${getStoredToken() || ''}` },
      })
      if (!res.ok) throw new Error(`导出失败（${res.status}）`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      // 本地日期命名（toISOString 走 UTC 会偏一天——与后端 L927 同口径）
      const d = new Date()
      const localToday = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      a.download = `诊断能力需求池_${localToday}.xlsx`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      message.success('已导出诊断能力需求池')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导出失败')
    } finally {
      setExporting(false)
    }
  }

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
                共 {stats.groupCount} 个缺口组 · {stats.apiCount} 个接口 · 合计 {stats.preCompressTotal ?? '—'} 次失败
                {stats.uncoveredCount > 0 ? ` · 其中 ${stats.uncoveredCount} 组池未接入 MCP 日志服务` : ''}
                {Number(stats.retryPendingCount || 0) > 0 ? ` · 另有 ${stats.retryPendingCount} 组诊断调用失败，次日自动重试` : ''}
                {Number(stats.mcpErrorCount || 0) > 0 ? ` · 另有 ${stats.mcpErrorCount} 组 MCP 调用报错，可补跑诊断` : ''}
              </div>
            )}
          </div>
          {/* 11-20 09:44 拍板：显示全部——无时间范围选择，仅保留刷新；11-25 加导出（窗口下界 11-10 后端裁） */}
          <Space wrap size="small">
            <Button size="small" icon={<ReloadOutlined />} onClick={() => { loadSummary(); if (drill) loadDetail(drill) }}>刷新</Button>
            <Button size="small" icon={<DownloadOutlined />} loading={exporting} onClick={exportXlsx}>一键导出</Button>
          </Space>
        </div>
      </div>

      {/* ── 未诊断提示条（11-20 拍板：从未诊断的组不进需求池——清单交付用户自行补诊断）── */}
      {Number(stats?.undiagnosedCount || 0) > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`另有 ${stats.undiagnosedCount} 个失败组从未执行 MCP 日志诊断（超龄收敛态），未纳入需求池`}
          description={(
            <Space wrap size="small" className="!mt-1">
              <span className="text-xs text-ink-500">补诊断后自动归入对应分区；可先复制清单（日期/池/请求ID）用于补跑。</span>
              <Button type="link" size="small" icon={<CopyOutlined />} onClick={copyUndiagnosedList}>
                复制未诊断组清单
              </Button>
            </Space>
          )}
        />
      )}

      {/* ── MCP 报错提示条（11-20 14:48 拍板：枚举内池临时故障——复制清单交付补跑，不进分区一）── */}
      {mcpErrorGroups.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message={`另有 ${mcpErrorGroups.reduce((s, u) => s + Number(u.groupCount || 0), 0)} 组因 MCP 日志服务调用报错（临时故障）无法判定`}
          description={(
            <Space wrap size="small" className="!mt-1">
              <span className="text-xs text-ink-500">
                所涉资源池均在 MCP 支持清单内——非接入问题；补跑诊断可恢复。可先复制清单（日期/池/请求ID）用于补跑。
              </span>
              <Button type="link" size="small" icon={<CopyOutlined />} onClick={copyMcpErrorList}>
                复制补跑清单
              </Button>
            </Space>
          )}
        />
      )}

      {/* ── 分区一：池未接入 MCP 日志服务（数据驱动；无实例整卡不渲染）── */}
      {uncoveredPools.length > 0 && (
        <div className="page-card">
          <div className="page-card-header">
            <div className="min-w-0">
              <div className="page-card-title">池未接入 MCP 日志服务</div>
              {/* 11-20 14:48 拍板：分区一真源=tools/list 枚举——标注清单规模与获取时间；降级时标注文本推断模式 */}
              <div className="mt-1 text-xs text-ink-500">
                {poolEnum && !poolEnum.degraded
                  ? `按 MCP 支持清单判定（共 ${poolEnum.count} 池 · 获取于 ${String(poolEnum.fetchedAt || '').slice(0, 16).replace('T', ' ')}${poolEnum.stale ? ' · 已超 24h 待刷新' : ''}）——以下资源池不在清单内，需推动池接入日志服务。`
                  : 'MCP 支持清单暂不可达，当前按响应文本推断（判定保守，清单恢复后自动校正）——以下资源池疑似未接入。'}
              </div>
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
                // 判定依据（11-20 拍板）：该池被判未接入所依据的 MCP 响应样例——复核不再查库
                title: '判定依据', dataIndex: 'sampleMcpRaw', key: 'sampleMcpRaw', width: 220, ellipsis: true,
                render: (v) => (v ? <span title={v} className="text-xs text-ink-500">{v}</span> : '—'),
              },
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

      {/* ── 反馈闭环弹窗（11-27 拍板）：三字段（核实原因必填/修复方案/排期非必填）+ 取消/提交 ── */}
      <Modal
        open={feedbackTarget != null}
        title="核实原因"
        onCancel={() => setFeedbackTarget(null)}
        width={560}
        footer={[
          <Button key="cancel" onClick={() => setFeedbackTarget(null)}>取消</Button>,
          <Button key="submit" type="primary" loading={feedbackSubmitting} onClick={submitFeedback}>提交</Button>,
        ]}
      >
        {feedbackTarget && (
          <>
            <div className="text-xs text-ink-400 mb-3">
              {feedbackTarget.productKey} · {feedbackTarget.apiPath} · {feedbackTarget.poolName}
            </div>
            <Form form={feedbackForm} layout="vertical" className="text-[13px]">
              <Form.Item
                label="核实原因"
                name="reason"
                rules={[{ required: true, message: '核实原因必填' }]}
              >
                <Input.TextArea rows={3} placeholder="如：日志保留期已过 / 该接口日志未采集 / ERROR 级日志缺失……" />
              </Form.Item>
              <Form.Item label="修复方案" name="fixPlan">
                <Input placeholder="选填——如何补齐该能力" />
              </Form.Item>
              <Form.Item label="排期时间" name="scheduleAt">
                <DatePicker className="w-full" placeholder="选填——预计修复日期" />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </div>
  )
}
