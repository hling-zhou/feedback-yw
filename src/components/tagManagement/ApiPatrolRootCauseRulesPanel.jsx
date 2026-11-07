import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Popconfirm, Select, Space, Switch, Table, Tag, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, PlusOutlined } from '@ant-design/icons'
import { useInsights } from '../../context/InsightsContext.jsx'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import FieldLabel from '../FieldLabel.jsx'

/**
 * API 巡检·接口失败根因分类规则维护（对象与标签 Tab「接口失败根因分类」，设计 §6.5）。
 * 有序规则表：先命中先返回；兜底恒末位不可删不可停用；DNAT 类规则不得排在锁定类之后（UI 硬约束）。
 * 产品侧处理映射挂规则行（L2）。编辑存量不回溯（与注册表同口径）。
 *
 * @param {Object} props
 * @param {boolean} [props.readOnly]
 */
export default function ApiPatrolRootCauseRulesPanel({ readOnly = false }) {
  const message = useAppMessage()
  const { adapter } = useInsights()
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  /** @type {[Record<string, unknown> | null, Function]} */
  const [editing, setEditing] = useState(null)
  const [constraintError, setConstraintError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const parsed = await adapter.getMeta('api_patrol_root_cause_rules_v1')
      setItems(/** @type {{items: Array<Record<string, unknown>>}} */ (parsed)?.items || [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载根因分类规则失败')
    } finally {
      setLoading(false)
    }
  }, [adapter, message])

  useEffect(() => { load() }, [load])

  const persist = useCallback(async (nextItems) => {
    setSaving(true)
    try {
      await adapter.putMeta('api_patrol_root_cause_rules_v1', {
        version: 1, updatedAt: new Date().toISOString(), items: nextItems,
      })
      message.success('已保存（仅影响之后的诊断，存量不回溯）')
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
      setEditing(null)
    }
  }, [adapter, message, load])

  /**
   * 结构硬约束校验（设计 §6.5）：
   * 1) 兜底恒末位；2) 兜底不可删/停用；3) DNAT 规则（命中条件含 'DNAT'）不得排在锁定类规则之后。
   */
  const validateOrder = useCallback((nextItems) => {
    const nonFallback = nextItems.filter((r) => !r.isFallback)
    const fallback = nextItems.filter((r) => r.isFallback)
    if (fallback.length !== 1) return '兜底规则必须恰好一条'
    if (nextItems[nextItems.length - 1] !== fallback[0]) return '兜底规则必须排在末位'
    const dnatIdx = nonFallback.findIndex((r) => JSON.stringify(r).includes('DNAT'))
    const lockIdx = nonFallback.findIndex((r) => r.l1 === '资源锁定/并发冲突')
    if (dnatIdx >= 0 && lockIdx >= 0 && dnatIdx > lockIdx) {
      return 'DNAT 规则必须排在锁定类之前（否则 HAS_BEEN_ATTACHED_DNAT 会被误判为锁定）'
    }
    return ''
  }, [])

  const saveWithConstraints = useCallback(async (nextItems) => {
    const err = validateOrder(nextItems)
    if (err) {
      setConstraintError(err)
      message.error(err)
      return
    }
    setConstraintError('')
    await persist(nextItems)
  }, [validateOrder, persist, message])

  const move = useCallback(async (index, dir) => {
    const next = [...items]
    const target = index + dir
    if (target < 0 || target >= next.length) return
    const moved = next[index]
    if (moved.isFallback || next[target].isFallback) {
      message.error('兜底规则必须保持在末位')
      return
    }
    ;[next[index], next[target]] = [next[target], next[index]]
    await saveWithConstraints(next)
  }, [items, saveWithConstraints, message])

  const addRule = useCallback(async (rule) => {
    const fallback = items.find((r) => r.isFallback)
    const next = [...items.filter((r) => !r.isFallback), rule, ...(fallback ? [fallback] : [])]
    await saveWithConstraints(next)
  }, [items, saveWithConstraints])

  const updateRule = useCallback(async (rule) => {
    const next = items.map((r) => (r.order === rule.order ? rule : r))
    await saveWithConstraints(next)
  }, [items, saveWithConstraints])

  const removeRule = useCallback(async (rule) => {
    if (rule.isFallback) {
      message.error('兜底规则不可删除')
      return
    }
    await saveWithConstraints(items.filter((r) => r !== rule))
  }, [items, saveWithConstraints, message])

  const toggleEnabled = useCallback(async (rule) => {
    if (rule.isFallback) {
      message.error('兜底规则不可停用')
      return
    }
    await updateRule({ ...rule, enabled: rule.enabled === false ? true : false })
  }, [updateRule, message])

  const columns = useMemo(() => [
    { title: '顺序', key: 'order', width: 70,
      render: /** @param {Record<string, unknown>} r */ (r) => (
        <span className="flex items-center gap-1">
          <Typography.Text code>{r.isFallback ? '兜底' : String(r.order)}</Typography.Text>
          {!readOnly && !r.isFallback && (
            <Space size={0}>
              <Button type="text" size="small" icon={<ArrowUpOutlined />} onClick={() => move(items.indexOf(r), -1)} />
              <Button type="text" size="small" icon={<ArrowDownOutlined />} onClick={() => move(items.indexOf(r), 1)} />
            </Space>
          )}
        </span>
      ) },
    { title: 'L1 大类', dataIndex: 'l1', key: 'l1', width: 140,
      render: (v) => <Tag>{v}</Tag> },
    { title: 'L2 场景', dataIndex: 'l2', key: 'l2', width: 150 },
    { title: '命中关键词', key: 'match', ellipsis: true,
      render: /** @param {Record<string, unknown>} r */ (r) => {
        if (r.isFallback) return <Typography.Text type="secondary">以上全未命中</Typography.Text>
        /** @type {string[][]} */
        let groups = []
        if (Array.isArray(r.anyOf)) groups = [/** @type {string[]} */ (r.anyOf)]
        if (Array.isArray(r.orGroups)) groups = /** @type {string[][]} */ (r.orGroups)
        if (Array.isArray(r.requiresAll)) groups = groups.concat(/** @type {string[][]} */ (r.requiresAll))
        return (
          <Space wrap size={4}>
            {groups.map((g, i) => (
              <Tag key={i} className="!m-0">{g.join(' 且 ')}</Tag>
            ))}
            {groups.length > 1 && <Typography.Text type="secondary" className="text-xs">多组任一</Typography.Text>}
          </Space>
        )
      } },
    { title: '产品侧', dataIndex: 'productAction', key: 'productAction', width: 80,
      render: (v) => (v === '—' ? <Tag>—</Tag> : <Tag color="orange">待处理</Tag>) },
    { title: '启用', key: 'enabled', width: 70,
      render: /** @param {Record<string, unknown>} r */ (r) => (
        <Switch size="small" checked={Boolean(r.isFallback) || r.enabled !== false} disabled={readOnly || !!r.isFallback}
          onChange={() => toggleEnabled(r)} />
      ) },
    ...(readOnly ? [] : [{
      title: '操作', key: 'actions', width: 130,
      render: /** @param {Record<string, unknown>} r */ (r) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => setEditing({ ...r })}>编辑</Button>
          {!r.isFallback && (
            <Popconfirm title="删除该规则？" onConfirm={() => removeRule(r)}>
              <Button type="link" size="small" danger>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    }]),
  ], [readOnly, items, move, toggleEnabled, removeRule])

  return (
    <div className="page-card">
      <div className="page-card-header">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="page-card-title">接口失败根因分类</span>
          <Typography.Text type="secondary" className="text-xs">
            有序规则表：先命中先返回。编辑只影响之后的诊断，存量不回溯。
          </Typography.Text>
        </div>
        {!readOnly && (
          <Button type="primary" icon={<PlusOutlined />}
            onClick={() => setEditing({ order: Math.max(...items.map((r) => Number(r.order) || 0)) + 1, l1: '业务冲突', l2: '', productAction: '待处理', anyOf: [], enabled: true })}>
            新增规则
          </Button>
        )}
      </div>

      {constraintError && <Alert className="!mb-3" type="error" showIcon message={constraintError} />}

      <Table
        rowKey={(r) => String(r.isFallback ? 'fallback' : r.order)}
        columns={columns}
        dataSource={items}
        loading={loading}
        size="small"
        pagination={false}
      />

      {editing && (
        <RuleEditModal
          initial={editing}
          saving={saving}
          isNew={!items.some((r) => r.order === editing.order)}
          onCancel={() => setEditing(null)}
          onOk={async (rule) => { (isNewRule(items, rule) ? addRule : updateRule)(rule) }}
        />
      )}
    </div>
  )
}

/** @param {Array<Record<string, unknown>>} items @param {Record<string, unknown>} rule */
function isNewRule(items, rule) {
  return !items.some((r) => r.order === rule.order)
}

/** @param {Object} props @param {Record<string, unknown>} props.initial @param {boolean} props.saving @param {boolean} props.isNew
 * @param {() => void} props.onCancel @param {(rule: Record<string, unknown>) => void} props.onOk */
function RuleEditModal({ initial, saving, isNew, onCancel, onOk }) {
  const [form, setForm] = useState(initial)
  const [kwText, setKwText] = useState(
    Array.isArray(initial.anyOf) ? /** @type {string[]} */ (initial.anyOf).join(',') : '',
  )
  const L1_OPTIONS = [
    '业务冲突', '配额不足', '资源锁定/并发冲突', '参数无效/校验失败', '资源状态异常', '诊断能力缺口', '其他/未归类',
  ]
  const isFallback = !!initial.isFallback
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/30 p-4" role="dialog" aria-label="规则编辑">
      <div className="bg-white rounded-lg shadow-xl p-5 w-[520px] max-w-full">
        <Typography.Title level={5} className="!mt-0">{isNew ? '新增规则' : '编辑规则'}</Typography.Title>
        <div className="flex flex-col gap-3">
          <div>
            <FieldLabel required>L1 大类</FieldLabel>
            <Select value={form.l1} options={L1_OPTIONS.map((x) => ({ label: x, value: x }))} className="w-full"
              disabled={isFallback} onChange={(v) => setForm({ ...form, l1: v })} />
          </div>
          <div>
            <FieldLabel required>L2 场景</FieldLabel>
            <Input value={String(form.l2 || '')} disabled={isFallback}
              onChange={(e) => setForm({ ...form, l2: e.target.value })} />
          </div>
          {!isFallback && (
            <>
              <div>
                <FieldLabel required hint="多个关键词逗号分隔，命中任一即匹配该规则（anyOf）">命中关键词</FieldLabel>
                <Input value={kwText} placeholder="如 DNAT　或　缺少后续,日志不完整"
                  onChange={(e) => setKwText(e.target.value)} />
              </div>
              <div>
                <FieldLabel>产品侧处理</FieldLabel>
                <Select value={form.productAction || '待处理'} className="w-full"
                  options={[{ label: '待处理', value: '待处理' }, { label: '—（不需要产品侧处理）', value: '—' }]}
                  onChange={(v) => setForm({ ...form, productAction: v })} />
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onCancel}>取消</Button>
          {!isFallback && (
            <Button type="primary" loading={saving}
              disabled={!form.l1 || !form.l2 || !kwText.trim()}
              onClick={() => onOk({ ...form, anyOf: kwText.split(/[，,]/).map((s) => s.trim()).filter(Boolean) })}>
              保存
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
