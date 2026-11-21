import { useCallback, useEffect, useState } from 'react'
import { Button, Form, Input, Modal, Popconfirm, Space, Switch, Table, Tag, Typography } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { apiFetch } from '../../lib/apiClient.js'
import FieldLabel from '../FieldLabel.jsx'
import { paginationShowTotal } from '../../lib/paginationTotal.js'

/**
 * API 巡检 · 处理豁免白名单（11-21 10:38 拍板：精确组合豁免替代全量仿真豁免）。
 * 语义：命中「客户名（必填全等）× 接口名称（选填，空=全部）× 资源池（选填，空=全部）」
 * 的失败组——诊断回填时强制 '—'（不占用产品侧处理），且不进诊断能力需求池分区。
 * 权限：GET=view 全员可见；PUT=manageTags（配置资产——判据表：白名单是配置不是业务记录）。
 */
export default function ApiPatrolActionExemptionsContent() {
  const message = useAppMessage()
  const { can } = useAuth()
  const readOnly = !can('manageTags')
  const [rules, setRules] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form] = Form.useForm()

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/api/patrol/action-exemptions')
      setRules(data?.rules || [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载豁免白名单失败')
    } finally {
      setLoading(false)
    }
  }, [message])

  useEffect(() => { load() }, [load])

  const openCreate = () => {
    setEditingId(null)
    form.resetFields()
    setModalOpen(true)
  }

  const openEdit = (record) => {
    setEditingId(String(record.id || ''))
    form.setFieldsValue({
      userName: record.userName,
      apiPath: record.apiPath || '',
      poolName: record.poolName || '',
      note: record.note, enabled: record.enabled !== false,
    })
    setModalOpen(true)
  }

  const doSave = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      // 全量覆盖写：本地列表替换/追加当前行后整表提交（端点做重复校验）。
      // 字段显式归一（apiPath/poolName 清空时 ...values 展开 undefined 不覆盖旧值——必显式写空串）
      const normalized = { ...values, apiPath: values.apiPath || '', poolName: values.poolName || '', enabled: values.enabled !== false }
      const next = editingId
        ? rules.map((r) => (String(r.id) === editingId ? { ...r, ...normalized } : r))
        : [...rules, { id: `rule-${Date.now()}`, ...normalized, createdAt: new Date().toISOString() }]
      const data = await apiFetch('/api/patrol/action-exemptions', {
        method: 'PUT',
        body: JSON.stringify({ rules: next }),
      })
      setRules(data?.rules || [])
      setModalOpen(false)
      message.success(editingId ? '已更新豁免规则' : '已新增豁免规则')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const doDelete = async (record) => {
    try {
      const next = rules.filter((r) => String(r.id) !== String(record.id))
      const data = await apiFetch('/api/patrol/action-exemptions', {
        method: 'PUT',
        body: JSON.stringify({ rules: next }),
      })
      setRules(data?.rules || [])
      message.success('已删除豁免规则')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const doToggle = async (record, enabled) => {
    try {
      const next = rules.map((r) => (String(r.id) === String(record.id) ? { ...r, enabled } : r))
      const data = await apiFetch('/api/patrol/action-exemptions', {
        method: 'PUT',
        body: JSON.stringify({ rules: next }),
      })
      setRules(data?.rules || [])
      message.success(enabled ? '已启用' : '已停用')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '操作失败')
    }
  }

  const columns = [
    { title: '客户名', dataIndex: 'userName', key: 'userName', width: 170, ellipsis: true },
    // 11-21 11:14 拍板：接口路径→接口名称（对齐失败列表列名）；资源池列新增；空值显「全部」
    { title: '接口名称', dataIndex: 'apiPath', key: 'apiPath', width: 250, ellipsis: true, render: (v) => v || <Tag>全部接口</Tag> },
    { title: '资源池', dataIndex: 'poolName', key: 'poolName', width: 150, ellipsis: true, render: (v) => v || <Tag>全部资源池</Tag> },
    { title: '备注', dataIndex: 'note', key: 'note', ellipsis: true, render: (v) => v || '—' },
    {
      title: '启用', dataIndex: 'enabled', key: 'enabled', width: 90,
      render: (v, r) => (
        <Switch size="small" checked={v !== false} disabled={readOnly} onChange={(checked) => doToggle(r, checked)} />
      ),
    },
    { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 170, render: (v) => (v ? String(v).slice(0, 19).replace('T', ' ') : '—') },
    ...(readOnly ? [] : [{
      title: '操作', key: 'actions', width: 130,
      render: (r) => (
        <Space size={4}>
          <Button type="link" size="small" className="!px-0" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="确认删除该豁免规则？" onConfirm={() => doDelete(r)}>
            <Button type="link" size="small" className="!px-0" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    }]),
  ]

  return (
    <div className="space-y-4">
      <div className="page-card">
        <div className="page-card-header">
          <div className="min-w-0">
            <div className="page-card-title">处理豁免白名单</div>
            <div className="mt-1 text-xs text-ink-500">
              命中「客户名 × 接口名称 × 资源池」的失败组：诊断回填时强制 '—'（不占用产品侧处理），且不进诊断能力需求池分区。
              客户名必填精确匹配；接口名称/资源池选填，留空=匹配全部（不做通配符——字段级通配，非空值精确全等）。
            </div>
          </div>
          {!readOnly && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增规则</Button>
          )}
        </div>
        {readOnly && (
          <div className="!mt-2">
            <Tag>只读模式（配置维护需管理权限）</Tag>
          </div>
        )}
        <Table
          className="!mt-2"
          rowKey={(r) => String(r.id)}
          size="small"
          columns={columns}
          dataSource={rules}
          loading={loading}
          pagination={false}
          locale={{ emptyText: '暂无豁免规则' }}
        />
      </div>

      <Modal
        open={modalOpen}
        title={editingId ? '编辑豁免规则' : '新增豁免规则'}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        onOk={doSave}
        onCancel={() => setModalOpen(false)}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="!mt-2"
          initialValues={{ enabled: true }}>
          <Form.Item label={<FieldLabel required>客户名</FieldLabel>} name="userName"
            rules={[{ required: true, message: '请输入客户名（精确全等匹配）' }]}>
            <Input placeholder="如 cmic_sim" maxLength={120} />
          </Form.Item>
          <Form.Item label={<FieldLabel>接口名称</FieldLabel>} name="apiPath"
            extra="选填——留空匹配该客户全部接口">
            <Input placeholder="如 L7POLICY/CREATE；留空=全部接口" maxLength={300} />
          </Form.Item>
          <Form.Item label={<FieldLabel>资源池</FieldLabel>} name="poolName"
            extra="选填——留空匹配全部资源池">
            <Input placeholder="如 华南-广州3；留空=全部资源池" maxLength={120} />
          </Form.Item>
          <Form.Item label={<FieldLabel>备注</FieldLabel>} name="note">
            <Input placeholder="豁免原因说明（选填）" maxLength={200} />
          </Form.Item>
          <Form.Item label={<FieldLabel>启用</FieldLabel>} name="enabled" valuePropName="checked">
            <Switch size="small" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
