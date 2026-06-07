import { useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Button, Card, Form, Input, Typography, message } from 'antd'
import { LockOutlined, UserOutlined } from '@ant-design/icons'
import { useAuth } from '../context/AuthContext.jsx'
import { PASSWORD_POLICY_HINT, passwordPolicyFormRule } from '../domain/passwordPolicy.js'
import { apiFetch } from '../lib/apiClient.js'
import { PASSWORD_EXPIRED_MESSAGE } from '../domain/passwordExpiry.js'

export default function ChangePassword() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { user, logout, isAuthenticated } = useAuth()
  const [loading, setLoading] = useState(false)
  const state = /** @type {{ username?: string; passwordChangedAt?: string; mode?: 'voluntary' | 'expired' } | null} */ (
    location.state
  )

  const voluntary =
    searchParams.get('mode') === 'voluntary' || state?.mode === 'voluntary'
  const fromApp = voluntary && isAuthenticated
  const lockedUsername = user?.username || state?.username || ''

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      await apiFetch('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          username: values.username.trim(),
          currentPassword: values.currentPassword,
          newPassword: values.newPassword,
        }),
      })
      if (isAuthenticated) {
        await logout()
      }
      message.success('密码已更新，请使用新密码登录')
      navigate('/login', { replace: true })
    } catch (err) {
      message.error(err instanceof Error ? err.message : '修改失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-50 px-5 py-10">
      <Card className="w-full max-w-md shadow-card" styles={{ body: { padding: 32 } }}>
        <Typography.Title level={2} className="!mb-0 !text-2xl">
          修改密码
        </Typography.Title>
        <Typography.Paragraph className="!mb-0 !mt-2 !text-sm !text-ink-500">
          {voluntary
            ? fromApp
              ? '请输入当前密码并设置新密码。修改成功后需重新登录。'
              : '请输入用户名、当前密码并设置新密码。修改成功后需重新登录。'
            : PASSWORD_EXPIRED_MESSAGE}
        </Typography.Paragraph>

        <Alert
          className="mt-4"
          type="warning"
          showIcon
          message={voluntary ? '密码安全要求' : '密码定期变更策略'}
          description={
            voluntary
              ? `新密码须满足：${PASSWORD_POLICY_HINT}。`
              : `账号密码使用满 3 个月须修改。新密码须满足：${PASSWORD_POLICY_HINT}。修改成功后请重新登录。`
          }
        />

        {state?.passwordChangedAt && !voluntary && (
          <Typography.Text type="secondary" className="mt-3 block text-xs">
            上次修改时间：{state.passwordChangedAt.slice(0, 10)}
          </Typography.Text>
        )}

        <Form
          className="mt-6"
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{ username: lockedUsername }}
        >
          <Form.Item
            label="用户名"
            name="username"
            rules={[{ required: true, message: '请输入用户名' }]}
          >
            <Input
              prefix={<UserOutlined className="text-ink-400" />}
              autoComplete="username"
              readOnly={fromApp}
              disabled={fromApp}
            />
          </Form.Item>
          <Form.Item
            label="当前密码"
            name="currentPassword"
            rules={[{ required: true, message: '请输入当前密码' }]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-ink-400" />}
              autoComplete="current-password"
            />
          </Form.Item>
          <Form.Item
            label="新密码"
            name="newPassword"
            rules={[
              { required: true, message: '请输入新密码' },
              passwordPolicyFormRule(),
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || value !== getFieldValue('currentPassword')) return Promise.resolve()
                  return Promise.reject(new Error('新密码不能与当前密码相同'))
                },
              }),
            ]}
          >
            <Input.Password
              prefix={<LockOutlined className="text-ink-400" />}
              autoComplete="new-password"
            />
          </Form.Item>
          <Form.Item
            label="再次输入新密码"
            name="confirmPassword"
            dependencies={['newPassword']}
            rules={[
              { required: true, message: '请再次输入新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('newPassword') === value) return Promise.resolve()
                  return Promise.reject(new Error('两次输入的新密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password autoComplete="new-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            {fromApp ? '保存并重新登录' : '保存并返回登录'}
          </Button>
        </Form>

        <div className="mt-4 text-center">
          {fromApp ? (
            <Link to="/workbench" className="text-sm text-ink-500">
              返回工作台
            </Link>
          ) : (
            <Link to="/login" className="text-sm text-ink-500">
              返回登录
            </Link>
          )}
        </div>
      </Card>
    </main>
  )
}
