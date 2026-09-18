import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ArrowRightOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Form, Input, Typography, message } from 'antd'
import { useAuth } from '../context/AuthContext.jsx'
import { PASSWORD_MUST_CHANGE_CODE } from '../domain/passwordExpiry.js'
import { apiFetch } from '../lib/apiClient.js'
import SystemUsageWorkflow from '../components/login/SystemUsageWorkflow.jsx'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)
  const [defaultPassword, setDefaultPassword] = useState(null)
  const [fetchingDefault, setFetchingDefault] = useState(false)

  const handleShowDefaultPassword = async () => {
    if (defaultPassword) return
    setFetchingDefault(true)
    try {
      const data = await apiFetch('/api/auth/default-password')
      setDefaultPassword(data.defaultPassword)
    } catch {
      message.error('获取默认密码失败，请检查 API 是否已启动')
    } finally {
      setFetchingDefault(false)
    }
  }

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      await login(values.username, values.password)
      message.success('登录成功')
      const from = location.state?.from || '/workbench'
      navigate(from, { replace: true })
    } catch (err) {
      const data =
        err && typeof err === 'object'
          ? /** @type {{ code?: string; passwordChangedAt?: string; defaultPassword?: string }} */ (err)
              .data
          : null
      const code = data?.code ?? (err && typeof err === 'object' ? /** @type {{ code?: string }} */ (err).code : undefined)
      if (code === PASSWORD_MUST_CHANGE_CODE) {
        message.warning(err instanceof Error ? err.message : '首次登录请先修改密码')
        navigate('/change-password', {
          replace: true,
          state: {
            username: values.username,
            mode: 'first',
            defaultPassword: data?.defaultPassword,
          },
        })
        return
      }
      if (code === 'PASSWORD_EXPIRED') {
        message.warning(err instanceof Error ? err.message : '密码已过期，请先修改')
        navigate('/change-password', {
          replace: true,
          state: {
            username: values.username,
            passwordChangedAt: data?.passwordChangedAt,
            mode: 'expired',
          },
        })
        return
      }
      message.error(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen bg-ink-50 text-ink-800 md:h-screen md:overflow-hidden">
      <div className="grid min-h-screen md:h-full md:max-h-screen md:grid-cols-[1.05fr_0.95fr] md:overflow-hidden">
        <section className="relative hidden h-full min-h-0 overflow-hidden bg-white px-8 py-6 text-ink-900 md:flex md:flex-col lg:px-10 lg:py-8">
          <div
            className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(79,70,229,0.10),transparent_42%),radial-gradient(circle_at_82%_8%,rgba(79,70,229,0.06),transparent_40%),linear-gradient(160deg,#FFFFFF_0%,#F5F7FB_55%,#EEF2F8_100%)]"
            aria-hidden
          />
          <div className="relative flex shrink-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white shadow-soft">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden>
                <path
                  d="M4 18V6l8 4 8-4v12l-8 4-8-4Z"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <Typography.Text className="text-sm font-medium text-ink-800">Feedback Insights</Typography.Text>
          </div>
          <div className="relative mt-6 flex min-h-0 flex-1 flex-col gap-4 lg:mt-8 lg:gap-6">
            <div className="max-w-lg shrink-0">
              <h1 className="text-2xl font-semibold leading-tight tracking-tight text-ink-900 lg:text-3xl">用户反馈洞察</h1>
              <p className="mt-3 text-sm leading-relaxed text-ink-500">
                以数为镜，从万千反馈的字里行间，捕捉产品优化的线索
              </p>
            </div>
            <SystemUsageWorkflow
              variant="full"
              tone="light"
              className="min-h-0 max-w-lg flex-1 overflow-y-auto pb-2"
            />
          </div>
        </section>

        <section className="flex min-h-screen items-start justify-center overflow-y-auto px-5 py-8 sm:px-8 md:h-full md:min-h-0 md:items-center md:py-6 lg:py-10">
          <div className="my-auto w-full max-w-md py-2 md:py-4">
            <div className="mb-4 md:hidden">
              <Typography.Title level={2} className="!mb-2 !text-ink-900">
                用户反馈洞察
              </Typography.Title>
              <Typography.Paragraph className="!mb-3 !text-sm !text-ink-500">
                以数为镜，从万千反馈的字里行间，捕捉产品优化的线索
              </Typography.Paragraph>
              <SystemUsageWorkflow variant="compact" className="!bg-white !shadow-card" />
            </div>
            <div className="page-card shadow-card" style={{ padding: 32 }}>
              <Typography.Title level={2} className="!mb-0 !text-2xl">
                登录
              </Typography.Title>
              <Typography.Paragraph className="!mb-0 !mt-2 !text-sm !text-ink-500">
                请输入用户名和密码
              </Typography.Paragraph>

              <Form
                className="mt-6"
                layout="vertical"
                onFinish={handleSubmit}
                requiredMark={false}
              >
                <Form.Item
                  label="用户名"
                  name="username"
                  rules={[{ required: true, message: '请输入用户名' }]}
                >
                  <Input
                    prefix={<UserOutlined className="text-ink-400" />}
                    autoComplete="username"
                    placeholder="用户名"
                    size="large"
                  />
                </Form.Item>

                <Form.Item
                  label="密码"
                  name="password"
                  rules={[{ required: true, message: '请输入密码' }]}
                >
                  <Input.Password
                    prefix={<LockOutlined className="text-ink-400" />}
                    autoComplete="current-password"
                    placeholder="请输入密码"
                    size="large"
                  />
                </Form.Item>

                <Button
                  type="primary"
                  htmlType="submit"
                  size="large"
                  block
                  loading={loading}
                  icon={<ArrowRightOutlined />}
                >
                  登录
                </Button>
              </Form>

              <div className="mt-4 text-center">
                <Link to="/change-password?mode=voluntary" className="text-sm text-ink-500">
                  修改密码
                </Link>
                <span className="mx-2 text-ink-200">|</span>
                <button
                  type="button"
                  onClick={handleShowDefaultPassword}
                  className="text-sm text-brand-600 transition hover:text-brand-700"
                  disabled={fetchingDefault}
                >
                  {fetchingDefault ? '查询中…' : '首次登录？'}
                </button>
              </div>

              {defaultPassword && (
                <Alert
                  className="mt-3"
                  type="info"
                  showIcon
                  message={`系统统一初始密码：${defaultPassword}`}
                  description="首次登录请先用上述密码登录，系统会引导你修改为自己的密码。修改后初始密码将不再有效。"
                />
              )}

              <p className="mt-4 text-center text-xs text-ink-400">
                还没有账号？请联系管理员在「用户管理」中开通
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
