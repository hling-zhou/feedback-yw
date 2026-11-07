import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Input, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useInsights } from '../../context/InsightsContext.jsx'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import FieldLabel from '../FieldLabel.jsx'

/**
 * API 巡检·产品接口注册表维护（对象与标签 Tab「产品接口」，docs/DESIGN-API巡检.md §5.1）。
 * 数据：meta api_patrol_api_registry_v1（34 项种子随 migration 灌入）。
 * 功能：表格 CRUD / 推断项标注 / 「待登记」分区（api_patrol_unregistered_apis_v1 一键转正）。
 * 编辑只影响之后推送，存量不回溯（拍板）。每次保存走 /api/storage/meta/:key（manageTags 权限+审计）。
 *
 * @param {Object} props
 * @param {boolean} [props.readOnly]
 */
export default function ApiPatrolRegistryPanel({ readOnly = false }) {
  const message = useAppMessage()
  const { adapter } = useInsightsContextAdapter()
  const [items, setItems] = useState([])
  const [unregistered, setUnregistered] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  /** @type {[Record<string, string> | null, Function]} */
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [reg, unreg] = await Promise.all([
        adapter.getMeta('api_patrol_api_registry_v1'),
        adapter.getMeta('api_patrol_unregistered_apis_v1'),
      ])
      setItems(/** @type {{items: Array<Record<string,string>>}} */ (reg)?.items || [])
      setUnregistered(/** @type {{items: string[]}} */ (unreg)?.items || [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载产品接口注册表失败')
    } finally {
      setLoading(false)
    }
  }, [adapter, message])

  useEffect(() => { load() }, [load])

  const persist = useCallback(async (nextItems, nextUnregistered) => {
    setSaving(true)
    try {
      await adapter.putMeta('api_patrol_api_registry_v1', {
        version: 1, updatedAt: new Date().toISOString(), items: nextItems,
      })
      if (nextUnregistered != null) {
        await adapter.putMeta('api_patrol_unregistered_apis_v1', {
          version: 1, updatedAt: new Date().toISOString(), items: nextUnregistered,
        })
      }
      message.success('已保存（仅影响之后的推送，存量数据不回溯）')
      await load()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [adapter, message, load])

  const addOrUpdate = useCallback(async (row) => {
    const key = `${row.productKey}|${row.apiPath}`
    const next = items.some((it) => `${it.productKey}|${it.apiPath}` === key)
      ? items.map((it) => (`${it.productKey}|${it.apiPath}` === key ? { ...it, ...row } : it))
      : [...items, row]
    await persist(next, null)
    setEditing(null)
  }, [items, persist])

  const remove = useCallback(async (row) => {
    const key = `${row.productKey}|${row.apiPath}`
    await persist(items.filter((it) => `${it.productKey}|${it.apiPath}` !== key), null)
  }, [items, persist])

  /** 未登记接口一键转正：从待登记移除 + 追加注册表（业务类型留空由运营补） */
  const promote = useCallback(async (apiPath) => {
    const nextItems = [...items, {
      productKey: '', metricName: '', apiPath, bizType: '', inferred: false, note: '待登记转正（业务字段待补）',
    }]
    await persist(nextItems, unregistered.filter((p) => p !== apiPath))
  }, [items, unregistered, persist])

  const columns = useMemo(() => [
    { title: '产品', dataIndex: 'productKey', key: 'productKey', width: 90,
      render: (v) => <Tag>{v || '—'}</Tag> },
    { title: '指标名称', dataIndex: 'metricName', key: 'metricName', width: 160 },
    { title: '接口名称', dataIndex: 'apiPath', key: 'apiPath', ellipsis: true },
    { title: '业务类型', dataIndex: 'bizType', key: 'bizType', width: 90 },
    { title: '标注', dataIndex: 'inferred', key: 'inferred', width: 90,
      render: (v) => (v ? <Tag color="orange">推断·待校验</Tag> : null) },
    ...(readOnly ? [] : [{
      title: '操作', key: 'actions', width: 130,
      render: /** @param {Record<string, string>} row */ (row) => (
        <Space size="small">
          <Button type="link" size="small" onClick={() => setEditing({ ...row })}>编辑</Button>
          <Popconfirm title="删除该接口注册？" onConfirm={() => remove(row)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    }]),
  ], [readOnly, remove])

  return (
    <div className="page-card">
      <div className="page-card-header">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <span className="page-card-title">产品接口</span>
          <Typography.Text type="secondary" className="text-xs">
            API 巡检推送数据的产品归属对照表。编辑只影响之后推送，存量不回溯。
          </Typography.Text>
        </div>
        {!readOnly && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ productKey: 'eip', metricName: '', apiPath: '', bizType: '' })}>
            新增接口
          </Button>
        )}
      </div>

      {unregistered.length > 0 && (
        <Alert
          className="!mb-3"
          type="warning"
          showIcon
          message={<span>发现 {unregistered.length} 个未登记接口（推送时启发式归属，请核对后转正）</span>}
          description={
            <Space wrap size="small">
              {unregistered.map((p) => (
                <span key={p} className="text-xs">
                  <Typography.Text code>{p}</Typography.Text>
                  {!readOnly && (
                    <Button type="link" size="small" onClick={() => promote(p)}>转正</Button>
                  )}
                </span>
              ))}
            </Space>
          }
        />
      )}

      <Table
        rowKey={(r) => `${r.productKey}|${r.apiPath}`}
        columns={columns}
        dataSource={items}
        loading={loading}
        size="small"
        pagination={false}
      />

      {editing && (
        <RegistryEditModal
          initial={editing}
          saving={saving}
          onCancel={() => setEditing(null)}
          onOk={addOrUpdate}
        />
      )}
    </div>
  )
}

/** @param {Object} props @param {Record<string,string>} props.initial @param {boolean} props.saving
 * @param {() => void} props.onCancel @param {(row: Record<string,string>) => Promise<void>} props.onOk */
function RegistryEditModal({ initial, saving, onCancel, onOk }) {
  const [form, setForm] = useState(initial)
  const PRODUCT_OPTIONS = [
    { label: '弹性公网IP (eip)', value: 'eip' },
    { label: '虚拟私有云 (vpc)', value: 'vpc' },
    { label: '弹性负载均衡 (slb)', value: 'slb' },
  ]
  return (
    <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/30 p-4" role="dialog" aria-label="接口编辑">
      <div className="bg-white rounded-lg shadow-xl p-5 w-[520px] max-w-full">
        <Typography.Title level={5} className="!mt-0">{initial.apiPath ? '编辑接口' : '新增接口'}</Typography.Title>
        <div className="flex flex-col gap-3">
          <div>
            <FieldLabel required>产品</FieldLabel>
            <Select value={form.productKey} options={PRODUCT_OPTIONS} className="w-full"
              onChange={(v) => setForm({ ...form, productKey: v })} />
          </div>
          <div>
            <FieldLabel required>指标名称</FieldLabel>
            <Input value={form.metricName || ''} placeholder="如 订购 / 绑定"
              onChange={(e) => setForm({ ...form, metricName: e.target.value })} />
          </div>
          <div>
            <FieldLabel required>接口名称</FieldLabel>
            <Input value={form.apiPath || ''} placeholder="如 /customer/v3/order/create/floatingip 或 L7POLICY/CREATE"
              onChange={(e) => setForm({ ...form, apiPath: e.target.value })} />
          </div>
          <div>
            <FieldLabel>业务类型</FieldLabel>
            <Input value={form.bizType || ''} placeholder="如 订购 / CREATE"
              onChange={(e) => setForm({ ...form, bizType: e.target.value })} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" loading={saving}
            disabled={!form.productKey || !form.metricName || !form.apiPath}
            onClick={() => onOk(form)}>保存</Button>
        </div>
      </div>
    </div>
  )
}

/** InsightsContext 的 adapter 挂在内部 state，组件层取用方式收敛为小 hook（避免每处解构 drift）。 */
function useInsightsContextAdapter() {
  const ctx = useInsights()
  return { adapter: ctx.adapter }
}
