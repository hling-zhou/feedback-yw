import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Segmented, Space, Statistic, Switch, Table, Tag, Typography } from 'antd'
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { apiFetch } from '../../lib/apiClient.js'
import { useAppMessage } from '../../hooks/useAppMessage.js'

const PATROL_L1_KEYS = ['业务冲突', '配额不足', '资源锁定/并发冲突', '参数无效/校验失败', '资源状态异常', '诊断能力缺口', '其他/未归类']
const L1_COLORS = ['#f5222d', '#fa8c16', '#faad14', '#722ed1', '#13c2c2', '#1677ff', '#8c8c8c']
const HEAT_COLORS = ['#fff7e6', '#ffe7ba', '#ffd591', '#ffc069', '#fa8c16', '#d46b08', '#a04000']

/**
 * API 巡检 · 总览（docs/DESIGN-API巡检.md §7.2）。
 * 五模块：AI 综述（facts 锚点+LLM 润色降级）/ 根因分布（堆叠柱·表切换+严重度双维度+跳转溯源）/
 * 指标趋势（缺天断线+含明细补算开关空心标记）/ L1 趋势（七类全画）/ 跨日轨迹（热力·折线双形态）。
 * 数据：单一聚合接口 GET /api/patrol/cause-stats。
 */
export default function ApiPatrolOverviewContent() {
  const message = useAppMessage()
  const navigate = useNavigate()
  const [range, setRange] = useState([dayjs().subtract(6, 'day'), dayjs()])
  /** @type {[any, any]} */
  const [data, setData] = useState(null)
  /** @type {[any, any]} */
  const [summary, setSummary] = useState(null) // AI 综述独立加载（2026-11-07 拆分：LLM 慢不拖图表）
  const [loading, setLoading] = useState(false)
  const [pendingOnly, setPendingOnly] = useState(false)
  const [includeBackfill, setIncludeBackfill] = useState(false)
  /** @type {[string, any]} */
  const [distView, setDistView] = useState('bar')
  /** @type {[string, any]} */
  const [trackView, setTrackView] = useState('heat')

  const load = useCallback(async () => {
    setLoading(true)
    const qs = new URLSearchParams({
      startDate: range[0].format('YYYY-MM-DD'),
      endDate: range[1].format('YYYY-MM-DD'),
      pendingOnly: pendingOnly ? '1' : '0',
      includeBackfill: includeBackfill ? '1' : '0',
    })
    // 两段加载：图表数据先行（cause-stats 不含 LLM，秒回）；综述文字慢填（LLM 最多 10s，超时模板降级）
    setSummary(null)
    void apiFetch(`/api/patrol/cause-summary?${qs}`)
      .then((s) => setSummary(s))
      .catch(() => setSummary(null))
    try {
      const res = await apiFetch(`/api/patrol/cause-stats?${qs}`)
      setData(res)
    } catch (err) {
      message.error(err.message || '加载总览数据失败')
    } finally {
      setLoading(false)
    }
  }, [range, pendingOnly, includeBackfill, message])

  useEffect(() => { load() }, [load])

  const facts = data?.aiSummaryFacts
  const distData = useMemo(() => {
    // 堆叠柱数据：X=产品，堆叠=L1 七类
    const byProduct = new Map()
    for (const r of data?.byProductCause || []) {
      if (!byProduct.has(r.productKey)) byProduct.set(r.productKey, { product: r.productKey })
      const row = byProduct.get(r.productKey)
      row[String(r.l1)] = (row[String(r.l1)] || 0) + Number(r.groupCount)
      row.__pre = (row.__pre || 0) + Number(r.preCompressTotal)
    }
    return [...byProduct.values()]
  }, [data])

  const distTableRows = useMemo(() => {
    // 表格形态：行=L1，列=产品+组数+压缩前次数（严重度双维度）
    const l1Map = new Map()
    for (const r of data?.byProductCause || []) {
      if (!l1Map.has(r.l1)) l1Map.set(r.l1, { l1: r.l1, groupCount: 0, preCompressTotal: 0 })
      const row = l1Map.get(r.l1)
      row.groupCount += Number(r.groupCount)
      row.preCompressTotal += Number(r.preCompressTotal)
      row[r.productKey] = (row[r.productKey] || 0) + Number(r.groupCount)
    }
    return [...l1Map.values()].sort((a, b) => b.groupCount - a.groupCount)
  }, [data])

  const heatColumns = useMemo(() => {
    if (!data?.dailyTrend?.length) return []
    return [
      { title: 'L2 场景', dataIndex: 'l2', key: 'l2', width: 160, fixed: 'left' },
      ...data.dailyTrend.map((d) => ({
        title: String(d.date).slice(5),
        key: String(d.date),
        render: (row) => {
          const n = row.days?.[String(d.date)] ?? 0
          const color = n === 0 ? '#f5f5f5' : HEAT_COLORS[Math.min(HEAT_COLORS.length - 1, Math.ceil(Math.log2(n + 1)))]
          return (
            <span
              className="inline-block min-w-[28px] text-center rounded text-xs py-0.5"
              style={{ background: color, color: n > 4 ? '#fff' : undefined }}
              data-node={`heat-${row.l2}-${d.date}`}
            >
              {n || ''}
            </span>
          )
        },
      })),
    ]
  }, [data])

  const trackHeatRows = useMemo(() => {
    // l2Calendar → 热力行形态（days Map 平铺）
    return (data?.l2Calendar || []).map((t) => {
      const daysMap = {}
      for (const d of t.days) daysMap[d.date] = d.count
      return { l2: t.l2, days: daysMap, total: t.days.reduce((a, d) => a + d.count, 0) }
    })
  }, [data])

  const trackLineData = useMemo(() => {
    // 折线形态：X=日期，每条线=L2
    const rows = []
    for (const day of data?.dailyTrend || []) {
      /** @type {Record<string, unknown>} */
      const row = { date: String(day.date).slice(5) }
      for (const t of trackHeatRows) row[t.l2] = t.days[String(day.date)] || 0
      rows.push(row)
    }
    return rows
  }, [data, trackHeatRows])

  const trendSlots = data?.metricTrends || []

  return (
    <div className="p-6 flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Typography.Title level={5} className="!m-0">
            API 巡检 · 总览
            <Typography.Text type="secondary" className="text-xs !ml-3">
              统计口径：失败压缩组{pendingOnly ? '（仅待处理）' : ''}；组数可能小于原始失败次数（1 小时链压缩）
            </Typography.Text>
          </Typography.Title>
          <Space wrap>
            <Button size="small" onClick={() => setRange([dayjs().subtract(6, 'day'), dayjs()])}>近7天</Button>
            <Button size="small" onClick={() => setRange([dayjs().subtract(29, 'day'), dayjs()])}>近30天</Button>
            <span className="text-sm">仅待处理</span>
            <Switch size="small" checked={pendingOnly} onChange={setPendingOnly} />
            <Button size="small" onClick={load} loading={loading}>刷新</Button>
          </Space>
        </div>
      </Card>

      <Card title="AI 综述" extra={!summary?.summary ? null : (summary.summary.degraded ? <Tag>LLM 未启用 · 模板直出</Tag> : <Tag color="green">LLM 润色</Tag>)}>
          {facts ? (
            <>
          <Typography.Paragraph className="!mb-4">{summary?.summary?.text || '综述生成中…'}</Typography.Paragraph>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Statistic title="失败组（压缩后）" value={facts.totalGroups} />
            <Statistic title="压缩前失败请求" value={facts.preCompressTotal} />
            <Statistic title="待产品侧处理" value={facts.pendingGroups} />
            <Statistic title="已处理" value={facts.processedGroups ?? 0} />
            <Statistic title="未诊断组" value={facts.undiagnosedGroups} />
          </div>
          <Typography.Text type="secondary" className="text-xs !mt-2 block">
            主要根因：{facts.topCause || '—'} · 异常集中接口：{facts.topApi || '—'}
            {facts.simGroups > 0 && ` · 仿真/测试流量 ${facts.simGroups} 组（标签不过滤，可筛）`}
          </Typography.Text>
            </>
          ) : (
            <Typography.Text type="secondary">加载中…</Typography.Text>
          )}
        </Card>

      <Card
        title="根因分布（产品 × L1 大类）"
        extra={
          <Space>
            <Segmented size="small" value={distView} onChange={setDistView}
              options={[{ label: '堆叠柱', value: 'bar' }, { label: '表格', value: 'table' }]} />
          </Space>
        }
      >
        {distView === 'bar' ? (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={distData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="product" />
              <YAxis />
              <Tooltip />
              <Legend />
              {PATROL_L1_KEYS.map((k, i) => (
                <Bar key={k} dataKey={k} stackId="cause" fill={L1_COLORS[i]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Table
            rowKey="l1"
            size="small"
            dataSource={distTableRows}
            pagination={false}
            onRow={(row) => ({
              style: { cursor: 'pointer' },
              onClick: () => navigate(`/api-patrol/failures?rootCauseL1=${encodeURIComponent(String(row.l1))}`),
            })}
            columns={[
              { title: 'L1 大类', dataIndex: 'l1', key: 'l1', render: (v) => <Tag color="blue">{v}</Tag> },
              { title: '组数', dataIndex: 'groupCount', key: 'groupCount', align: 'right' },
              { title: '压缩前失败次数', dataIndex: 'preCompressTotal', key: 'preCompressTotal', align: 'right',
                render: (v) => <span className={Number(v) > 0 ? 'text-red-600' : ''}>{v}</span> },
            ]}
          />
        )}
        <Typography.Text type="secondary" className="text-xs !mt-2 block">
          点击表格行可跳转溯源页查看该根因的失败组明细
        </Typography.Text>
      </Card>

      <Card
        title="指标成功率趋势"
        extra={
          <Space>
            <span className="text-sm">含明细补算</span>
            <Switch size="small" checked={includeBackfill} onChange={setIncludeBackfill} />
          </Space>
        }
      >
        <Typography.Text type="secondary" className="text-xs !mb-2 block">
          无数据 = 当日未达推送阈值（≥99.5%），折线断开；开启补算后缺天用明细重算补点（× 标记）
        </Typography.Text>
        {trendSlots.length === 0 && (
          <Typography.Text type="secondary">该时间范围无推送数据</Typography.Text>
        )}
        <div className="flex flex-col gap-4">
          {trendSlots.map((t) => (
            <div key={`${t.pool}|${t.apiPath}|${t.metricName}`}>
              <Typography.Text strong className="text-sm">
                {t.pool} · {t.metricName}
                <Typography.Text type="secondary" className="text-xs !ml-2">{t.apiPath}</Typography.Text>
              </Typography.Text>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={t.points}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(5)} />
                  <YAxis domain={[80, 100]} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="successRate"
                    connectNulls={false}
                    stroke="#1677ff"
                    dot={(/** @type {any} */ props) => {
                      const { cx, cy, payload } = props
                      if (payload?.successRate == null || cx == null || cy == null) return null
                      return <Cell key={`dot-${cx}`} cx={cx} cy={cy} r={3}
                        fill={payload.backfilled ? '#fff' : '#1677ff'}
                        stroke="#1677ff" />
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ))}
        </div>
      </Card>

      <Card title="根因大类趋势（L1 七类全画）">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data?.dailyTrend || []}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tickFormatter={(v) => String(v).slice(5)} />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            {PATROL_L1_KEYS.map((k, i) => (
              <Line key={k} type="monotone" dataKey={k} stroke={L1_COLORS[i]} dot={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <Card
        title="跨日轨迹（L2 Top8）"
        extra={
          <Segmented size="small" value={trackView} onChange={setTrackView}
            options={[{ label: '热力', value: 'heat' }, { label: '折线', value: 'line' }]} />
        }
      >
        {trackView === 'heat' ? (
          <Table
            rowKey="l2"
            size="small"
            dataSource={trackHeatRows}
            pagination={false}
            scroll={{ x: 'max-content' }}
            columns={heatColumns}
          />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={trackLineData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              {(data?.l2Calendar || []).map((t, i) => (
                <Line key={t.l2} type="monotone" dataKey={t.l2}
                  stroke={L1_COLORS[i % L1_COLORS.length]} dot={false} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </Card>

      {!data && !loading && (
        <Alert type="info" showIcon message="暂无数据——等待外部系统推送后展示" />
      )}
    </div>
  )
}
