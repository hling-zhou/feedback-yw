import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Alert,
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd'
import { PlusOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons'
import { PageHeader } from './Dashboard.shared.jsx'
import { PASSWORD_POLICY_HINT, passwordPolicyFormRule } from '../domain/passwordPolicy.js'
import { apiFetch } from '../lib/apiClient.js'
import { ROLE_LABELS, ROLES } from '../domain/auth/permissions.js'
import { useAuth } from '../context/AuthContext.jsx'
import AuditLogPanel from '../components/admin/AuditLogPanel.jsx'
import { parseUserImportFile } from '../lib/userImport.js'
import { downloadUserImportTemplate } from '../lib/userImportTemplate.js'

const ROLE_OPTIONS = ROLES.map((r) => ({ label: ROLE_LABELS[r], value: r }))

export default function Users() {
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()
  const importInputRef = useRef(/** @type {HTMLInputElement | null} */ (null))
  const [importOpen, setImportOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importPreview, setImportPreview] = useState(
    /** @type {ReturnType<typeof parseUserImportFile> | null} */ (null),
  )
  const [usernameQuery, setUsernameQuery] = useState('')

  const filteredUsers = useMemo(() => {
    const q = usernameQuery.trim().toLowerCase()
    if (!q) return users
    return users.filter((u) => u.username?.toLowerCase().includes(q))
  }, [users, usernameQuery])

  const loadUsers = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/api/users')
      setUsers(data.users || [])
    } catch (err) {
      message.error(err instanceof Error ? err.message : '加载用户失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadUsers()
  }, [loadUsers])

  const openCreate = () => {
    setEditing(null)
    form.resetFields()
    form.setFieldsValue({ role: 'viewer', status: 'active' })
    setModalOpen(true)
  }

  const openEdit = (record) => {
    setEditing(record)
    form.setFieldsValue({
      username: record.username,
      team: record.team,
      role: record.role,
      status: record.status,
      password: '',
    })
    setModalOpen(true)
  }

  const handleSubmit = async () => {
    const values = await form.validateFields()
    try {
      if (editing) {
        const body = {
          team: values.team,
          role: values.role,
          status: values.status,
        }
        if (values.password?.trim()) body.password = values.password
        await apiFetch(`/api/users/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        })
        message.success('用户已更新')
      } else {
        await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify({
            username: values.username,
            password: values.password,
            team: values.team,
            role: values.role,
          }),
        })
        message.success('用户已创建')
      }
      setModalOpen(false)
      loadUsers()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败')
    }
  }

  const handleDelete = async (id) => {
    try {
      await apiFetch(`/api/users/${id}`, { method: 'DELETE' })
      message.success('用户已删除')
      loadUsers()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败')
    }
  }

  const handleImportFile = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    try {
      const buffer = await file.arrayBuffer()
      const preview = parseUserImportFile(buffer)
      if (!preview.rows.length && preview.errors.length) {
        message.error(preview.errors[0]?.message || '导入文件无效')
        return
      }
      if (!preview.rows.length) {
        message.warning('未解析到有效用户行')
        return
      }
      setImportPreview(preview)
      setImportOpen(true)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '读取文件失败')
    }
  }

  const handleImportConfirm = async () => {
    if (!importPreview?.rows.length) return
    setImporting(true)
    try {
      const result = await apiFetch('/api/users/batch', {
        method: 'POST',
        body: JSON.stringify({ users: importPreview.rows }),
      })
      const failed = result.errors?.length ?? 0
      message.success(
        failed
          ? `已创建 ${result.created?.length ?? 0} 个用户，${failed} 条失败`
          : `已创建 ${result.created?.length ?? 0} 个用户`,
      )
      setImportOpen(false)
      setImportPreview(null)
      loadUsers()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '导入失败')
    } finally {
      setImporting(false)
    }
  }

  const columns = [
    { title: '用户名', dataIndex: 'username', width: 140 },
    { title: '所属班组', dataIndex: 'team', width: 160 },
    {
      title: '角色',
      dataIndex: 'role',
      width: 100,
      render: (role) => <Tag>{ROLE_LABELS[role] || role}</Tag>,
    },
    {
      title: '密码更新',
      key: 'passwordChangedAt',
      width: 120,
      render: (_, record) => {
        const text = record.passwordChangedAt?.slice(0, 10) || '—'
        return record.passwordExpired ? (
          <Tag color="red">{text} · 已过期</Tag>
        ) : (
          text
        )
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (status) => (
        <Tag color={status === 'active' ? 'green' : 'default'}>
          {status === 'active' ? '正常' : '禁用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" className="!px-0" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm
            title="确定删除该用户？"
            disabled={record.id === currentUser?.id}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              type="link"
              size="small"
              danger
              className="!px-0"
              disabled={record.id === currentUser?.id}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="用户管理"
        desc="管理系统登录账号、角色与所属班组"
        action={
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增用户
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => importInputRef.current?.click()}>
              批量导入
            </Button>
            <Button type="link" className="!px-1" onClick={downloadUserImportTemplate}>
              下载模板
            </Button>
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={handleImportFile}
            />
          </Space>
        }
      />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Input
          allowClear
          prefix={<SearchOutlined className="text-ink-400" />}
          placeholder="按用户名搜索"
          value={usernameQuery}
          onChange={(e) => setUsernameQuery(e.target.value)}
          className="max-w-xs"
        />
        {usernameQuery.trim() ? (
          <Typography.Text type="secondary" className="text-sm">
            共 {filteredUsers.length} / {users.length} 人
          </Typography.Text>
        ) : null}
      </div>
      <Table
        className="mt-4"
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={filteredUsers}
        pagination={{ pageSize: 10 }}
      />

      {currentUser?.role === 'admin' && <AuditLogPanel />}

      <Modal
        title={editing ? '编辑用户' : '新增用户'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSubmit}
        destroyOnClose
      >
        <Form form={form} layout="vertical" className="mt-4">
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input disabled={Boolean(editing)} placeholder="登录用户名" />
          </Form.Item>
          <Form.Item
            label={editing ? '新密码（留空不改）' : '密码'}
            name="password"
            rules={
              editing
                ? [passwordPolicyFormRule()]
                : [{ required: true, message: '请输入密码' }, passwordPolicyFormRule()]
            }
            extra={PASSWORD_POLICY_HINT}
          >
            <Input.Password placeholder={editing ? '留空表示不修改' : '初始密码'} />
          </Form.Item>
          <Form.Item
            label="所属班组"
            name="team"
            rules={[{ required: true, message: '请输入所属班组' }]}
          >
            <Input placeholder="例如：华东运营组" />
          </Form.Item>
          <Form.Item label="角色" name="role" rules={[{ required: true }]}>
            <Select options={ROLE_OPTIONS} />
          </Form.Item>
          {editing && (
            <Form.Item label="状态" name="status" rules={[{ required: true }]}>
              <Select
                options={[
                  { label: '正常', value: 'active' },
                  { label: '禁用', value: 'disabled' },
                ]}
              />
            </Form.Item>
          )}
        </Form>
        <Typography.Text type="secondary" className="text-xs">
          每个用户仅分配一个角色；数据权限不做班组隔离。
        </Typography.Text>
      </Modal>

      <Modal
        title="批量导入用户"
        open={importOpen}
        onCancel={() => {
          setImportOpen(false)
          setImportPreview(null)
        }}
        onOk={handleImportConfirm}
        okText="确认导入"
        confirmLoading={importing}
        destroyOnClose
      >
        {importPreview ? (
          <>
            <Alert
              type={importPreview.errors.length ? 'warning' : 'info'}
              showIcon
              className="mb-3"
              message={`解析到 ${importPreview.rows.length} 个可创建用户${
                importPreview.errors.length ? `，${importPreview.errors.length} 行有误将跳过` : ''
              }`}
            />
            {importPreview.errors.length > 0 ? (
              <ul className="mb-0 max-h-40 list-disc overflow-y-auto pl-5 text-xs text-ink-600">
                {importPreview.errors.slice(0, 8).map((err) => (
                  <li key={`${err.row}-${err.username}`}>
                    第 {err.row} 行（{err.username}）：{err.message}
                  </li>
                ))}
                {importPreview.errors.length > 8 ? (
                  <li>另有 {importPreview.errors.length - 8} 行错误未展示</li>
                ) : null}
              </ul>
            ) : null}
          </>
        ) : null}
      </Modal>
    </div>
  )
}
