import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRightOutlined, LockOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Tag, Typography, message } from 'antd'
import { useAuth } from '../context/AuthContext.jsx'

export default function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (values) => {
    setLoading(true)
    try {
      await login(values.username, values.password)
      message.success('登录成功')
      const from = location.state?.from || '/workbench'
      navigate(from, { replace: true })
    } catch (err) {
      const data = err && typeof err === 'object' ? /** @type {{ code?: string; passwordChangedAt?: string }} */ (err).data : null
      const code = data?.code ?? (err && typeof err === 'object' ? /** @type {{ code?: string }} */ (err).code : undefined)
      if (code === 'PASSWORD_EXPIRED') {
        message.warning(err instanceof Error ? err.message : '密码已过期，请先修改')
        navigate('/change-password', {
          replace: true,
          state: {
            username: values.username,
            passwordChangedAt: data?.passwordChangedAt,
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
    <main className="min-h-screen bg-ink-50 text-ink-800">
      <div className="grid min-h-screen lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden overflow-hidden bg-ink-900 px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.42),transparent_34%),radial-gradient(circle_at_78%_12%,rgba(16,185,129,0.28),transparent_30%),linear-gradient(145deg,#0B0F19_0%,#111827_58%,#1F2937_100%)]" />
          <div className="relative">
            <Typography.Text className="text-white/80">Feedback Insights</Typography.Text>
          </div>
          <div className="relative max-w-xl">
            <Tag className="border-white/10 bg-white/10 text-white/75 backdrop-blur">
              产品体验洞察工作台
            </Tag>
            <h1 className="mt-6 text-4xl font-semibold leading-tight">
              从工单处理意见中，提炼可执行的产品优化线索。
            </h1>
            <p className="mt-4 text-sm text-white/70 leading-relaxed">
              使用账号密码登录工作台，开始洞察分析。
            </p>
          </div>
        </section>

        <section className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
          <div className="w-full max-w-md">
            <Card className="shadow-card" styles={{ body: { padding: 32 } }}>
              <Typography.Title level={2} className="!mb-0 !text-2xl">
                登录工作台
              </Typography.Title>
              <Typography.Paragraph className="!mb-0 !mt-2 !text-sm !text-ink-500">
                请输入用户名和密码
              </Typography.Paragraph>

              <Alert
                className="mt-4"
                type="info"
                showIcon
                message="首次部署须由运维设置环境变量 ADMIN_INITIAL_PASSWORD（≥12 字符）以创建管理员账号"
                description="默认用户名为 admin。系统不再提供 admin123 等内置弱口令；空库未配置密码时 API 无法创建可登录账号。详见 README「环境变量」。"
              />

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

              <p className="mt-6 text-center text-xs text-ink-400">
                还没有账号？请联系管理员在「用户管理」中开通
              </p>
            </Card>
          </div>
        </section>
      </div>
    </main>
  )
}
