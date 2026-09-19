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
import {
  DownloadOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  UploadOutlined,
} from '@ant-design/icons'
import { PageHeader } from './Dashboard.shared.jsx'
import { PASSWORD_POLICY_HINT, passwordPolicyFormRule } from '../domain/passwordPolicy.js'
import { apiFetch } from '../lib/apiClient.js'
import { ROLE_LABELS, ROLES } from '../domain/auth/permissions.js'
import { useAuth } from '../context/AuthContext.jsx'
import { parseUserImportFile } from '../lib/userImport.js'
import { downloadUserImportTemplate } from '../lib/userImportTemplate.js'
import { downloadUserExport } from '../lib/userExport.js'
import { POSITIONS, TEAMS } from '../domain/userProfile.js'

const ROLE_OPTIONS = ROLES.map((r) => ({ label: ROLE_LABELS[r], value: r }))
const POSITION_OPTIONS = POSITIONS.map((p) => ({ label: p, value: p }))
const TEAM_OPTIONS = TEAMS.map((t) => ({ label: t, value: t }))

/** 存量账号在岗位字段上线前没有值，筛选时用一个哨兵值代表「未设置」 */
const POSITION_NONE = '__none__'
const POSITION_FILTER_OPTIONS = [
  { label: '未设置', value: POSITION_NONE },
  ...POSITION_OPTIONS,
]

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
  const [roleFilter, setRoleFilter] = useState(/** @type {string | undefined} */ (undefined))
  const [positionFilter, setPositionFilter] = useState(/** @type {string | undefined} */ (undefined))
  const [teamFilter, setTeamFilter] = useState(/** @type {string | undefined} */ (undefined))
  const [selectedKeys, setSelectedKeys] = useState(/** @type {string[]} */ ([]))
  const [resetOpen, setResetOpen] = useState(false)
  const [resetForm] = Form.useForm()
  const [batchSetOpen, setBatchSetOpen] = useState(false)
  const [batchSetForm] = Form.useForm()
  const [defaultPassword, setDefaultPassword] = useState('')

  // 首次打开用户弹窗时拉取系统默认密码（仅展示给管理员，用于提示）
  useEffect(() => {
    if (defaultPassword) return
    apiFetch('/api/users/default-password')
      .then((data) => setDefaultPassword(data?.defaultPassword || ''))
      .catch(() => {})
  }, [defaultPassword])

  const filteredUsers = useMemo(() => {
    const q = usernameQuery.trim().toLowerCase()
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false
      if (positionFilter) {
        const current = u.position || POSITION_NONE
        if (current !== positionFilter) return false
      }
      if (teamFilter && u.team !== teamFilter) return false
      if (!q) return true
      return u.username?.toLowerCase().includes(q)
    })
  }, [users, usernameQuery, roleFilter, positionFilter, teamFilter])

  const clearFilters = () => {
    setUsernameQuery('')
    setRoleFilter(undefined)
    setPositionFilter(undefined)
    setTeamFilter(undefined)
  }

  const hasFilter =
    Boolean(usernameQuery.trim()) || Boolean(roleFilter) || Boolean(positionFilter) || Boolean(teamFilter)

  // 班组下拉只显示枚举值，不再带出库内历史值。
  const expiredUsers = useMemo(
    () => filteredUsers.filter((u) => u.passwordExpired),
    [filteredUsers],
  )

  const selectedUsernames = useMemo(
    () => users.filter((u) => selectedKeys.includes(u.id)).map((u) => u.username),
    [users, selectedKeys],
  )

  const selectAllExpired = () => {
    if (!expiredUsers.length) {
      message.info('当前筛选结果中没有已过期账号')
      return
    }
    setSelectedKeys(expiredUsers.map((u) => u.id))
  }

  const handleResetPasswords = async () => {
    const values = await resetForm.validateFields()
    try {
      const result = await apiFetch('/api/users/reset-passwords', {
        method: 'POST',
        body: JSON.stringify({ ids: selectedKeys, password: values.password }),
      })
      const failed = result.errors?.length ?? 0
      const pendingFirst = (result.reset ?? []).filter((item) => item.mustChangePassword).length
      const usedDefault = (result.reset ?? []).filter((item) => item.usesDefaultPassword).length
      message.success(
        failed
          ? `已重置 ${result.reset?.length ?? 0} 个账号，${failed} 个失败`
          : pendingFirst
            ? `已重置 ${result.reset?.length ?? 0} 个账号；其中 ${pendingFirst} 个从未登录过，仍会按「首次登录」要求改密，其余账号用新密码直接登录`
            : usedDefault
              ? `已重置 ${result.reset?.length ?? 0} 个账号为默认密码，这些账号首次登录时会看到默认密码提示`
              : `已重置 ${result.reset?.length ?? 0} 个账号，这些账号用新密码登录后不强制改密`,
      )
      setResetOpen(false)
      setSelectedKeys([])
      loadUsers()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重置失败')
    }
  }

  const handleBatchSetProfile = async () => {
    const values = await batchSetForm.validateFields()
    /** @type {{ position?: string; team?: string }} */
    const patch = {}
    if (values.position) patch.position = values.position
    if (values.team) patch.team = values.team
    if (!patch.position && !patch.team) {
      message.warning('请至少选择要设置的岗位或班组')
      return
    }
    let ok = 0
    let fail = 0
    for (const id of selectedKeys) {
      try {
        await apiFetch(`/api/users/${id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        })
        ok += 1
      } catch {
        fail += 1
      }
    }
    message.success(
      fail ? `已更新 ${ok} 个账号，${fail} 个失败` : `已更新 ${ok} 个账号的岗位/班组`,
    )
    setBatchSetOpen(false)
    setSelectedKeys([])
    loadUsers()
  }

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
    form.setFieldsValue({ role: 'viewer', status: 'active', position: undefined, team: undefined })
    setModalOpen(true)
  }

  const openEdit = (record) => {
    setEditing(record)
    form.setFieldsValue({
      username: record.username,
      position: record.position || undefined,
      team: record.team || undefined,
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
          position: values.position,
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
        // 密码留空 → 后端使用系统统一初始密码，并把该账号标记为「仍在使用默认密码」
        const payload = {
          username: values.username,
          position: values.position,
          team: values.team,
          role: values.role,
        }
        if (values.password?.trim()) payload.password = values.password
        await apiFetch('/api/users', {
          method: 'POST',
          body: JSON.stringify(payload),
        })
        message.success(
          values.password?.trim()
            ? '用户已创建'
            : `用户已创建，初始密码为系统默认密码${defaultPassword ? `（${defaultPassword}）` : ''}`,
        )
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
    {
      title: '岗位',
      dataIndex: 'position',
      width: 110,
      render: (position) => (position ? <Tag>{position}</Tag> : <Tag color="default">未设置</Tag>),
    },
    { title: '所属班组', dataIndex: 'team', width: 200 },
    {
      title: '角色',
      dataIndex: 'role',
      width: 100,
      render: (role) => <Tag>{ROLE_LABELS[role] || role}</Tag>,
    },
    {
      title: '密码更新',
      key: 'passwordChangedAt',
      width: 130,
      render: (_, record) => {
        const text = record.passwordChangedAt?.slice(0, 10) || '—'
        return (
          <Space size={4} wrap={false}>
            {record.passwordExpired ? (
              <Tag color="red">{text} · 已过期</Tag>
            ) : (
              <span>{text}</span>
            )}
            {record.mustChangePassword ? (
              <Tag color="orange" title="该账号创建后从未成功登录，首次登录须先修改密码">
                待首次改密
              </Tag>
            ) : null}
          </Space>
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
        desc="管理系统登录账号、岗位、角色与所属班组"
        action={
          <Space wrap>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
              新增用户
            </Button>
            <Button icon={<UploadOutlined />} onClick={() => importInputRef.current?.click()}>
              批量导入
            </Button>
            <Button
              icon={<DownloadOutlined />}
              disabled={!users.length}
              onClick={() => downloadUserExport(users)}
            >
              导出
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
      <div className="page-card mt-4">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <Input
            allowClear
            prefix={<SearchOutlined className="text-ink-400" />}
            placeholder="按用户名搜索"
            value={usernameQuery}
            onChange={(e) => setUsernameQuery(e.target.value)}
            className="max-w-xs"
          />
          <Select
            allowClear
            placeholder="按角色筛选"
            options={ROLE_OPTIONS}
            value={roleFilter}
            onChange={(value) => setRoleFilter(value)}
            className="w-44"
          />
          <Select
            allowClear
            placeholder="按岗位筛选"
            options={POSITION_FILTER_OPTIONS}
            value={positionFilter}
            onChange={(value) => setPositionFilter(value)}
            className="w-36"
          />
          <Select
            allowClear
            showSearch
            placeholder="按班组筛选"
            options={TEAM_OPTIONS}
            value={teamFilter}
            onChange={(value) => setTeamFilter(value)}
            className="w-56"
            filterOption={(input, option) =>
              String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
          />
          {hasFilter ? (
            <Button type="link" className="!px-1" onClick={clearFilters}>
              重置筛选
            </Button>
          ) : null}
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadUsers()}>
            刷新
          </Button>
          <Button disabled={!expiredUsers.length} onClick={selectAllExpired}>
            选中全部已过期{expiredUsers.length ? `（${expiredUsers.length}）` : ''}
          </Button>
          <Button
            danger
            disabled={!selectedKeys.length}
            onClick={() => setResetOpen(true)}
          >
            批量重置密码{selectedKeys.length ? `（${selectedKeys.length}）` : ''}
          </Button>
          <Button
            disabled={!selectedKeys.length}
            onClick={() => {
              batchSetForm.resetFields()
              setBatchSetOpen(true)
            }}
          >
            批量设置岗位/班组{selectedKeys.length ? `（${selectedKeys.length}）` : ''}
          </Button>
          {hasFilter ? (
            <Typography.Text type="secondary" className="text-sm">
              共 {filteredUsers.length} / {users.length} 人
            </Typography.Text>
          ) : null}
        </div>
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={filteredUsers}
          pagination={{ pageSize: 10 }}
          rowSelection={{
            selectedRowKeys: selectedKeys,
            onChange: (keys) => setSelectedKeys(keys.map(String)),
          }}
        />
      </div>


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
            label={editing ? '新密码（留空不改）' : '密码（留空用默认）'}
            name="password"
            rules={editing ? [passwordPolicyFormRule()] : [passwordPolicyFormRule()]}
            extra={
              editing
                ? PASSWORD_POLICY_HINT
                : `留空则使用系统统一初始密码${defaultPassword ? `（${defaultPassword}）` : ''}；${PASSWORD_POLICY_HINT}`
            }
          >
            <Input.Password placeholder={editing ? '留空表示不修改' : '留空使用默认密码'} />
          </Form.Item>
          <Form.Item
            label="岗位"
            name="position"
            rules={[{ required: true, message: '请选择岗位' }]}
          >
            <Select options={POSITION_OPTIONS} placeholder="请选择岗位" />
          </Form.Item>
          <Form.Item
            label="所属班组"
            name="team"
            rules={[{ required: true, message: '请选择所属班组' }]}
          >
            <Select
              showSearch
              options={TEAM_OPTIONS}
              placeholder="请选择所属班组"
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
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
        title="批量重置密码"
        open={resetOpen}
        onCancel={() => setResetOpen(false)}
        onOk={handleResetPasswords}
        okText="确认重置"
        destroyOnClose
      >
        <Alert
          className="mt-4"
          type="warning"
          showIcon
          message={`将对选中的 ${selectedKeys.length} 个账号设置同一个临时密码，这些账号当前的登录会话会失效，需用新密码重新登录。`}
          description="是否须改密只看「该账号是否从未登录过」：从未登录的账号仍会按首次登录处理，已经登录过的账号用新密码直接登录，不会被拦去改密。请线下把临时密码告知本人。"
        />
        {selectedUsernames.length ? (
          <Typography.Text type="secondary" className="mt-3 block text-xs">
            已选账号：{selectedUsernames.join('、')}
          </Typography.Text>
        ) : null}
        <Form form={resetForm} layout="vertical" className="mt-4">
          <Form.Item
            label="统一临时密码"
            name="password"
            rules={[{ required: true, message: '请输入临时密码' }, passwordPolicyFormRule()]}
            extra={`所有选中账号将使用此密码。${defaultPassword ? `如填入 ${defaultPassword}，则这些账号会被标记为「仍在使用默认密码」，首次登录时界面会显示该密码提示。` : ''}${PASSWORD_POLICY_HINT}`}
          >
            <Input.Password placeholder={defaultPassword ? `留空不填会报错，可填默认密码 ${defaultPassword}` : '所有选中账号将使用此密码'} />
          </Form.Item>
          <Form.Item
            label="确认临时密码"
            name="confirmPassword"
            dependencies={['password']}
            rules={[
              { required: true, message: '请再次输入临时密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve()
                  return Promise.reject(new Error('两次输入的密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password placeholder="再次输入以确认" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="批量设置岗位/班组"
        open={batchSetOpen}
        onCancel={() => setBatchSetOpen(false)}
        onOk={handleBatchSetProfile}
        okText="确认设置"
        destroyOnClose
      >
        <Alert
          className="mt-4"
          type="info"
          showIcon
          message={`将对选中的 ${selectedKeys.length} 个账号批量设置岗位和/或班组。留空不设置该项。`}
        />
        {selectedUsernames.length ? (
          <Typography.Text type="secondary" className="mt-3 block text-xs">
            已选账号：{selectedUsernames.slice(0, 10).join('、')}
            {selectedUsernames.length > 10 ? ` 等 ${selectedUsernames.length} 个` : ''}
          </Typography.Text>
        ) : null}
        <Form form={batchSetForm} layout="vertical" className="mt-4">
          <Form.Item
            label="岗位"
            name="position"
            rules={[{ required: false }]}
          >
            <Select
              allowClear
              showSearch
              options={POSITION_OPTIONS}
              placeholder="选择要设置的岗位（留空不改）"
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            label="所属班组"
            name="team"
            rules={[{ required: false }]}
          >
            <Select
              allowClear
              showSearch
              options={TEAM_OPTIONS}
              placeholder="选择要设置的班组（留空不改）"
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
        </Form>
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
