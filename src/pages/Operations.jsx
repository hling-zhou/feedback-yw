import { useCallback, useEffect, useMemo, useState } from 'react'
import { Empty, Select, Spin, Table } from 'antd'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts'
import { apiFetch } from '../lib/apiClient.js'
import { USAGE_MODULE_LABELS, USAGE_MODULE_GROUPS } from '../lib/usageModuleMap.js'
import { PageHeader } from './Dashboard.shared.jsx'

const CHART_HEIGHT = 360

export default function Operations() {
  const [loading, setLoading] = useState(true)
  const [months, setMonths] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [rows, setRows] = useState([])

  // 加载可用月份
  useEffect(() => {
    void apiFetch('/api/usage/months')
      .then((data) => {
        const ms = data.months || []
        setMonths(ms)
        if (ms.length > 0 && !selectedMonth) {
          setSelectedMonth(ms[0])
        } else {
          // 没有月份数据，结束 loading 显示空态
          setLoading(false)
        }
      })
      .catch(() => {
        // 月份加载失败也结束 loading，显示空态
        setLoading(false)
      })
  }, [])

  // 加载选中月数据
  const loadStats = useCallback(async () => {
    if (!selectedMonth) return
    setLoading(true)
    try {
      const data = await apiFetch(`/api/usage/stats?month=${encodeURIComponent(selectedMonth)}`)
      setRows(data.rows || [])
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [selectedMonth])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  // 按模块聚合
  const moduleStats = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      const label = USAGE_MODULE_LABELS[row.module] || row.module
      const cur = map.get(row.module) || { module: row.module, label, visit_count: 0 }
      cur.visit_count += row.visit_count
      map.set(row.module, cur)
    }
    return [...map.values()].sort((a, b) => b.visit_count - a.visit_count)
  }, [rows])

  // Top 5 活跃用户
  const topUsers = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      const key = row.username || 'anonymous'
      const cur = map.get(key) || { username: key, team: row.team, role: row.role, visit_count: 0 }
      cur.visit_count += row.visit_count
      if (!cur.team && row.team) cur.team = row.team
      if (!cur.role && row.role) cur.role = row.role
      map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => b.visit_count - a.visit_count).slice(0, 5)
  }, [rows])

  // 按班组聚合
  const teamStats = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      const team = row.team || '未分配'
      const cur = map.get(team) || { team, visit_count: 0, modules: {} }
      cur.visit_count += row.visit_count
      cur.modules[row.module] = (cur.modules[row.module] || 0) + row.visit_count
      map.set(team, cur)
    }
    return [...map.values()].sort((a, b) => b.visit_count - a.visit_count)
  }, [rows])

  // 按角色聚合
  const roleStats = useMemo(() => {
    const map = new Map()
    for (const row of rows) {
      const role = row.role || 'unknown'
      const cur = map.get(role) || { role, visit_count: 0, modules: {} }
      cur.visit_count += row.visit_count
      cur.modules[row.module] = (cur.modules[row.module] || 0) + row.visit_count
      map.set(role, cur)
    }
    return [...map.values()].sort((a, b) => b.visit_count - a.visit_count)
  }, [rows])

  // 6 个月趋势数据
  const [trendData, setTrendData] = useState([])
  useEffect(() => {
    if (months.length === 0) return
    const recent = months.slice(0, 6).reverse()
    void Promise.all(
      recent.map((m) =>
        apiFetch(`/api/usage/stats?month=${encodeURIComponent(m)}`)
          .then((d) => ({ month: m, rows: d.rows || [] }))
          .catch(() => ({ month: m, rows: [] })),
      ),
    ).then((results) => {
      const trend = results.map((r) => {
        const byModule = {}
        for (const row of r.rows) {
          byModule[row.module] = (byModule[row.module] || 0) + row.visit_count
        }
        return { month: r.month, ...byModule }
      })
      setTrendData(trend)
    })
  }, [months])

  const monthOptions = useMemo(
    () => months.map((m) => ({ value: m, label: m })),
    [months],
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="平台运营分析"
        desc="按月查看各能力模块的访问频次与用户/班组/角色维度分布，数据由页面访问埋点按月归档。"
        hint="仅统计登录后的页面访问；抽屉内详情等组件级访问不计入（工单详情除外）。"
        action={
          <Select
            value={selectedMonth}
            onChange={setSelectedMonth}
            options={monthOptions}
            style={{ width: 180 }}
            placeholder="选择月份"
          />
        }
      />

      {loading ? (
        <div className="flex justify-center py-20">
          <Spin size="large" />
        </div>
      ) : rows.length === 0 ? (
        <Empty description="该月暂无使用数据" />
      ) : (
        <div className="space-y-4">
          {/* 能力使用频次（按月） */}
          <div className="page-card">
            <div className="page-card-header">
              <span className="page-card-title">能力使用频次（按月）</span>
            </div>
            <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
              <BarChart data={moduleStats} margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} angle={-20} textAnchor="end" height={60} />
                <YAxis />
                <Tooltip
                  formatter={(value) => [`${value} 次`, '访问次数']}
                  labelFormatter={(label) => `能力：${label}`}
                />
                <Bar dataKey="visit_count" fill="#1677ff" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Top 5 活跃用户 */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="page-card">
              <div className="page-card-header">
                <span className="page-card-title">Top 5 活跃用户</span>
              </div>
              <Table
                size="small"
                dataSource={topUsers}
                rowKey="username"
                pagination={false}
                columns={[
                  { title: '用户', dataIndex: 'username', key: 'username' },
                  { title: '班组', dataIndex: 'team', key: 'team' },
                  { title: '角色', dataIndex: 'role', key: 'role' },
                  { title: '访问次数', dataIndex: 'visit_count', key: 'visit_count', align: 'right' },
                ]}
              />
            </div>

            {/* 班组维度 */}
            <div className="page-card">
              <div className="page-card-header">
                <span className="page-card-title">班组维度</span>
              </div>
              <Table
                size="small"
                dataSource={teamStats}
                rowKey="team"
                pagination={false}
                columns={[
                  { title: '班组', dataIndex: 'team', key: 'team' },
                  { title: '访问次数', dataIndex: 'visit_count', key: 'visit_count', align: 'right' },
                ]}
              />
            </div>
          </div>

          {/* 角色维度 */}
          <div className="page-card">
            <div className="page-card-header">
              <span className="page-card-title">角色维度</span>
            </div>
            <Table
              size="small"
              dataSource={roleStats}
              rowKey="role"
              pagination={false}
              columns={[
                { title: '角色', dataIndex: 'role', key: 'role' },
                { title: '访问次数', dataIndex: 'visit_count', key: 'visit_count', align: 'right' },
                ...USAGE_MODULE_GROUPS.map((key) => ({
                  title: USAGE_MODULE_LABELS[key] || key,
                  key,
                  align: 'right',
                  render: (_, record) => {
                    const v = record.modules?.[key]
                    return v ? v : '-'
                  },
                })),
              ]}
              scroll={{ x: true }}
            />
          </div>

          {/* 月度趋势 */}
          {trendData.length >= 2 && (
            <div className="page-card">
              <div className="page-card-header">
                <span className="page-card-title">近 6 个月访问趋势</span>
              </div>
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                <LineChart data={trendData} margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                  <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {USAGE_MODULE_GROUPS.slice(0, 6).map((key, i) => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      name={USAGE_MODULE_LABELS[key] || key}
                      stroke={CHART_COLORS[i % CHART_COLORS.length]}
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const CHART_COLORS = ['#1677ff', '#52c41a', '#faad14', '#ff7a45', '#722ed1', '#13c2c2']
