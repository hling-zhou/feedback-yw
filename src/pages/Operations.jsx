import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, Col, Empty, Row, Select, Spin, Table, Typography } from 'antd'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, Legend } from 'recharts'
import { apiFetch } from '../lib/apiClient.js'

const { Title, Text } = Typography

const MODULE_LABELS = {
  workbench: '洞察工作台',
  themes: '主题分析',
  topics: '专题分析',
  feedbacks: '工单列表',
  feedbacks_detail: '工单详情',
  actions: '举措与进展',
  import: '数据导入',
  tags: '对象与标签',
  users: '用户管理',
  settings: '系统设置',
  operations: '运营分析',
  other: '其他',
}

const MODULE_GROUPS = [
  { key: 'workbench', label: '洞察工作台' },
  { key: 'themes', label: '主题分析' },
  { key: 'topics', label: '专题分析' },
  { key: 'feedbacks', label: '工单列表' },
  { key: 'feedbacks_detail', label: '工单详情' },
  { key: 'actions', label: '举措与进展' },
  { key: 'import', label: '数据导入' },
  { key: 'tags', label: '对象与标签' },
  { key: 'users', label: '用户管理' },
  { key: 'settings', label: '系统设置' },
]

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
      const label = MODULE_LABELS[row.module] || row.module
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
    <div className="p-6">
      <Title level={3}>平台运营分析</Title>
      <div className="mb-4">
        <Select
          value={selectedMonth}
          onChange={setSelectedMonth}
          options={monthOptions}
          style={{ width: 180 }}
          placeholder="选择月份"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-20">
          <Spin size="large" />
        </div>
      ) : rows.length === 0 ? (
        <Empty description="该月暂无使用数据" />
      ) : (
        <Row gutter={[16, 16]}>
          {/* 能力使用频次（按月） */}
          <Col span={24}>
            <Card title="能力使用频次（按月）" size="small">
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
            </Card>
          </Col>

          {/* Top 5 活跃用户 */}
          <Col span={12}>
            <Card title="Top 5 活跃用户" size="small">
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
            </Card>
          </Col>

          {/* 班组维度 */}
          <Col span={12}>
            <Card title="班组维度" size="small">
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
            </Card>
          </Col>

          {/* 角色维度 */}
          <Col span={24}>
            <Card title="角色维度" size="small">
              <Table
                size="small"
                dataSource={roleStats}
                rowKey="role"
                pagination={false}
                columns={[
                  { title: '角色', dataIndex: 'role', key: 'role' },
                  { title: '访问次数', dataIndex: 'visit_count', key: 'visit_count', align: 'right' },
                  ...MODULE_GROUPS.map((m) => ({
                    title: m.label,
                    key: m.key,
                    align: 'right',
                    render: (_, record) => {
                      const v = record.modules?.[m.key]
                      return v ? v : '-'
                    },
                  })),
                ]}
                scroll={{ x: true }}
              />
            </Card>
          </Col>

          {/* 月度趋势 */}
          {trendData.length >= 2 && (
            <Col span={24}>
              <Card title="近 6 个月访问趋势" size="small">
                <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                  <LineChart data={trendData} margin={{ top: 16, right: 16, bottom: 16, left: 16 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e8e8e8" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {MODULE_GROUPS.slice(0, 6).map((m, i) => (
                      <Line
                        key={m.key}
                        type="monotone"
                        dataKey={m.key}
                        name={m.label}
                        stroke={CHART_COLORS[i % CHART_COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </Card>
            </Col>
          )}
        </Row>
      )}
    </div>
  )
}

const CHART_COLORS = ['#1677ff', '#52c41a', '#faad14', '#ff7a45', '#722ed1', '#13c2c2']
