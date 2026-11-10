import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, DatePicker, Descriptions, Drawer, Form, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import dayjs from 'dayjs'
import { apiFetch } from '../../lib/apiClient.js'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { useAuth } from '../../context/AuthContext.jsx'
import FieldLabel from '../FieldLabel.jsx'
import { paginationShowTotal } from '../../lib/paginationTotal.js'

const { RangePicker } = DatePicker

/**
 * API 巡检 · 异常接口溯源页（docs/DESIGN-API巡检.md §7.1）。
 * ①异常接口列表：时间范围（近7天/30天/自定义）+ stats 驱动（次数从明细 Σ 重算，跨日口径 API 处理）
 * ②失败请求列表：复合搜索 + L1·L2 两级 Tag + 未诊断筛选
 * ③详情抽屉：诊断原文 + 处理闭环（提交=已处理/暂存=处理中）
 * 数据来自 /api/patrol/failures/*（camelCase 返回）。
 */
const ROOT_CAUSE_L1_OPTIONS = [
  '业务冲突', '配额不足', '资源锁定/并发冲突', '参数无效/校验失败', '资源状态异常', '诊断能力缺口', '其他/未归类',
]
const STATUS_OPTIONS = ['待处理', '处理中', '已处理', '—', '未诊断']
const CUSTOMER_TYPE_LABELS = { 仿真: '仿真', 测试账号: '测试' }

export default function ApiPatrolFailures() {
  const message = useAppMessage()
  const { can } = useAuth()
  const readOnly = !can('manageTags')

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
    metricName: '', apiPath: '', requestId: '', userName: '',
    rootCauseL1: '', status: '', customerType: '',
  })
  /** @type {[number | null, Function]} */
  const [drawerId, setDrawerId] = useState(null)
  const [drawerData, setDrawerData] = useState(null)
  const [drawerLoading, setDrawerLoading] = useState(false)

  const rangeParams = useMemo(() => ({
    startDate: range[0].format('YYYY-MM-DD'),
    endDate: range[1].format('YYYY-MM-DD'),
  }), [range])

  const loadInterfaces = useCallback(async () => {
    setLoadingInterfaces(true)
    try {
      const qs = new URLSearchParams(rangeParams)
      const data = await apiFetch(`/api/patrol/failures/interfaces?${qs}`)
      setInterfaces(data.rows || [])
    } catch (err) {
      message.error(err.message || '加载异常接口列表失败')
    } finally {
      setLoadingInterfaces(false)
    }
  }, [rangeParams, message])

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

  const isSingleDay = rangeParams.startDate === rangeParams.endDate

  /** @type {any[]} */
  const interfaceColumns = useMemo(() => [
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
      title: 'RequestID', dataIndex: 'firstRequestId', key: 'firstRequestId', width: 150, ellipsis: true,
      render: (v, record) => (
        <Button type="link" size="small" className="!px-0" onClick={() => openDrawer(record.id)}>
          {v}
        </Button>
      ),
    },
    { title: '指标名称', dataIndex: 'metricName', key: 'metricName', width: 120 },
    { title: '接口名称', dataIndex: 'apiPath', key: 'apiPath', width: 200, ellipsis: true },
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
    { title: '压缩前次数', dataIndex: 'preCompressCount', key: 'preCompressCount', width: 90, align: 'right' },
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
        <div className="page-card-header">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="page-card-title">巡检概况</span>
            <Typography.Text type="secondary" className="text-xs">检测结果总结，随时间范围刷新</Typography.Text>
          </div>
          {summaryData?.summary ? (
            summaryData.summary.degraded ? <Tag>LLM 未启用 · 模板直出</Tag> : <Tag color="green">LLM 润色</Tag>
          ) : null}
        </div>
        {summaryData?.summary ? (
          <>
            <div className="!mt-3 !mb-2">
              {(summaryData.summary.text || '').split('\n').filter(Boolean).map((line, i) => (
                <Typography.Paragraph key={i} className="!mt-0 !mb-1">{line}</Typography.Paragraph>
              ))}
            </div>
            {summaryData.facts && (
              <Space wrap size={[14, 4]}>
                <Typography.Text type="secondary" className="text-xs">
                  异常接口 <Typography.Text strong>{summaryData.facts.interfaceCount}</Typography.Text>
                </Typography.Text>
                <Typography.Text type="secondary" className="text-xs">
                  失败请求 <Typography.Text strong className="text-red-600">{summaryData.facts.failTotal}</Typography.Text>
                </Typography.Text>
                <Typography.Text type="secondary" className="text-xs">
                  待产品侧处理 <Typography.Text strong className="text-orange-600">{summaryData.facts.closure?.pending ?? 0}</Typography.Text>
                </Typography.Text>
                <Typography.Text type="secondary" className="text-xs">
                  已处理 <Typography.Text strong className="text-green-700">{summaryData.facts.closure?.processed ?? 0}</Typography.Text>
                </Typography.Text>
              </Space>
            )}
          </>
        ) : (
          <Typography.Text type="secondary" className="!mt-2 block">{loadingSummary ? '加载中…' : '暂无概况'}</Typography.Text>
        )}
      </div>

      <div className="page-card">
        <div className="page-card-header">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="page-card-title">异常接口列表</span>
            <Typography.Text type="secondary" className="text-xs">
              {isSingleDay
                ? '单日视图：展示推送原值，总/失败次数从明细重算'
                : '跨日视图：成功率/次数按明细 Σ 重算，时长类显示 —'}
            </Typography.Text>
          </div>
          <Space>
            <RangePicker value={range} onChange={(v) => v && setRange(v)} allowClear={false} />
            <Button size="small" onClick={() => setRange([dayjs().subtract(6, 'day'), dayjs()])}>近7天</Button>
            <Button size="small" onClick={() => setRange([dayjs().subtract(29, 'day'), dayjs()])}>近30天</Button>
            <Button size="small" onClick={() => setRange([dayjs().subtract(1, 'day'), dayjs().subtract(1, 'day')])}>T-1</Button>
            <Button size="small" onClick={loadInterfaces}>刷新</Button>
          </Space>
        </div>
        <Table
          className="!mt-3"
          rowKey={(r) => `${r.pool}|${r.apiPath}|${r.metricName}`}
          columns={interfaceColumns}
          dataSource={interfaces}
          loading={loadingInterfaces}
          size="small"
          pagination={interfaces.length > 20 ? { pageSize: 20 } : false}
        />
      </div>

      <div className="page-card">
        <div className="page-card-header">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="page-card-title">失败请求列表</span>
            <Typography.Text type="secondary" className="text-xs">
              组 = 同客户同接口 1 小时内失败链（压缩后）；点击 RequestID 查看诊断原文与处理闭环
            </Typography.Text>
          </div>
        </div>
        <Space className="!my-3" wrap size="small">
          <Input.Search size="small" placeholder="RequestID" allowClear className="!w-40"
            onSearch={(v) => setFilters((f) => ({ ...f, requestId: v }))} />
          <Input.Search size="small" placeholder="指标名称" allowClear className="!w-28"
            onSearch={(v) => setFilters((f) => ({ ...f, metricName: v }))} />
          <Input.Search size="small" placeholder="接口名称" allowClear className="!w-44"
            onSearch={(v) => setFilters((f) => ({ ...f, apiPath: v }))} />
          <Input.Search size="small" placeholder="客户名称" allowClear className="!w-32"
            onSearch={(v) => setFilters((f) => ({ ...f, userName: v }))} />
          <Select size="small" placeholder="根因 L1" allowClear className="!w-36"
            options={ROOT_CAUSE_L1_OPTIONS.map((x) => ({ label: x, value: x }))}
            onChange={(v) => setFilters((f) => ({ ...f, rootCauseL1: v || '' }))} />
          <Select size="small" placeholder="处理状态" allowClear className="!w-28"
            options={STATUS_OPTIONS.map((x) => ({ label: x, value: x }))}
            onChange={(v) => setFilters((f) => ({ ...f, status: v || '' }))} />
          <Select size="small" placeholder="客户类型" allowClear className="!w-24"
            options={[{ label: '仿真', value: '仿真' }, { label: '测试账号', value: '测试账号' }]}
            onChange={(v) => setFilters((f) => ({ ...f, customerType: v || '' }))} />
        </Space>
        <Table
          rowKey="id"
          columns={groupColumns}
          dataSource={groups}
          loading={loadingGroups}
          size="small"
          pagination={{ pageSize: 20, showSizeChanger: false, showTotal: paginationShowTotal }}
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
 * 详情抽屉：诊断原文 + 处理闭环表单（§7.1 ③）。
 * 提交=已处理；暂存=处理中；不属实必填真实根因（API 校验兜底 + 前端必填标记）。
 * @param {Object} props
 * @param {number | null} props.groupId
 * @param {{ group?: Record<string, unknown>, diagnosis?: Record<string, unknown> | null, requests?: Array<Record<string, unknown>> } | null} props.data
 * @param {boolean} props.loading @param {boolean} props.readOnly
 * @param {() => void} props.onClose
 * @param {(id: number, payload: Record<string, unknown>, isSubmit: boolean) => Promise<void>} props.onSubmit
 */
function FailureGroupDrawer({ groupId, data, loading, readOnly, onClose, onSubmit }) {
  const [form] = Form.useForm()
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(true)
  const group = data?.group
  const diagnosis = data?.diagnosis
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
      title={`失败组详情 · ${group ? /** @type {{firstRequestId?: string}} */ (group).firstRequestId : ''}`}
      open={groupId != null}
      onClose={onClose}
      width={720}
      destroyOnClose
    >
      {loading ? <Typography.Text type="secondary">加载中…</Typography.Text> : null}
      {group && (
        <Space direction="vertical" size={16} className="w-full">
          <Descriptions size="small" column={2} bordered
            items={[
              { key: 'date', label: '日期', children: String(/** @type {{groupDate?: string}} */ (group).groupDate || '') },
              { key: 'pool', label: '资源池', children: String(/** @type {{poolName?: string}} */ (group).poolName || '') },
              { key: 'api', label: '接口', children: String(/** @type {{apiPath?: string}} */ (group).apiPath || '') },
              { key: 'metric', label: '指标', children: String(/** @type {{metricName?: string}} */ (group).metricName || '') },
              { key: 'user', label: '客户', children: String(/** @type {{userName?: string}} */ (group).userName || '') },
              { key: 'count', label: '压缩前次数', children: String(/** @type {{preCompressCount?: number}} */ (group).preCompressCount ?? '') },
              { key: 'status', label: '产品侧处理状态', children: String(/** @type {{productActionStatus?: string}} */ (group).productActionStatus || '') },
              { key: 'assignee', label: '经办人', children: String(/** @type {{assignee?: string}} */ (group).assignee || '—') },
            ]}
          />

          <div>
            <Typography.Text strong>AI 诊断原文</Typography.Text>
            <div className="mt-1 p-3 bg-gray-50 rounded text-sm whitespace-pre-wrap">
              {diagnosis && /** @type {{finalConclusion?: string}} */ (diagnosis).finalConclusion
                ? String(/** @type {{finalConclusion?: string}} */ (diagnosis).finalConclusion)
                : '（该组尚未完成 AI 诊断，或诊断无结论）'}
            </div>
            {requests.length > 0 && (
              <Typography.Text type="secondary" className="text-xs !mt-1 block">
                组内请求 {requests.length} 条（首条 {String(requests[0]?.requestId || '')}）
              </Typography.Text>
            )}
          </div>

          {!readOnly && (
            <div>
              <Typography.Text strong>产品侧处理反馈</Typography.Text>
              <Form form={form} layout="vertical" className="!mt-2">
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
              <Space>
                <Button type="primary" loading={submitting}
                  onClick={() => { setConfirmSubmit(true); setConfirmOpen(true) }}>
                  提交（已处理）
                </Button>
                <Button loading={submitting}
                  onClick={() => { setConfirmSubmit(false); setConfirmOpen(true) }}>
                  暂存（处理中）
                </Button>
              </Space>
            </div>
          )}
        </Space>
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
