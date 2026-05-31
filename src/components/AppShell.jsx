import { useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  TagOutlined,
  HomeOutlined,
  ImportOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  TeamOutlined,
  LogoutOutlined,
} from '@ant-design/icons'
import { Button, Layout, Menu, Space, Statistic, Tag, Typography } from 'antd'
import { useAuth } from '../context/AuthContext.jsx'
import {
  APP_SIDER_BREAKPOINT,
  APP_SIDER_COLLAPSED_WIDTH,
  APP_SIDER_WIDTH,
  getAppSiderWidthPx,
} from '../constants/appLayout.js'
import { usePeriodScope } from '../hooks/usePeriodScope.js'
import { ROLE_LABELS } from '../domain/auth/permissions.js'
import ImportSessionGuard from './ImportSessionGuard.jsx'
import RetagSessionGuard from './RetagSessionGuard.jsx'

const ALL_NAV = [
  { key: '/workbench', label: '洞察工作台', icon: <HomeOutlined /> },
  { key: '/feedbacks', label: '反馈库', icon: <UnorderedListOutlined /> },
  { key: '/import', label: '数据导入', icon: <ImportOutlined /> },
  { key: '/tags', label: '标签管理', icon: <TagOutlined /> },
  { key: '/users', label: '用户管理', icon: <TeamOutlined />, adminOnly: true },
  { key: '/settings', label: '设置', icon: <SettingOutlined /> },
]

function resolveNavKey(pathname) {
  if (pathname === '/' || pathname.startsWith('/workbench')) return '/workbench'
  const item = ALL_NAV.find((n) => n.key !== '/workbench' && pathname.startsWith(n.key))
  return item?.key || '/workbench'
}

export default function AppShell() {
  const { period, periodCount, totalInDb } = usePeriodScope()
  const { user, logout, canRoute } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const selectedKey = resolveNavKey(location.pathname)
  const [collapsed, setCollapsed] = useState(false)

  const navItems = ALL_NAV.filter((item) => {
    if (item.adminOnly && user?.role !== 'admin') return false
    return canRoute(item.key)
  }).map(({ key, label, icon }) => ({ key, label, icon }))

  return (
    <Layout
      className="app-shell-root"
      style={{ '--app-sider-width': `${getAppSiderWidthPx(collapsed)}px` }}
    >
      <Layout.Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint={APP_SIDER_BREAKPOINT}
        width={APP_SIDER_WIDTH}
        collapsedWidth={APP_SIDER_COLLAPSED_WIDTH}
        theme="light"
        className="app-shell-sider border-r border-ink-200 !bg-white"
      >
        <div className="flex h-full min-h-0 flex-col">
          <div
            className={
              collapsed
                ? 'flex h-16 shrink-0 items-center justify-center border-b border-ink-100'
                : 'flex h-16 shrink-0 items-center gap-2 border-b border-ink-100 px-5'
            }
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-600 text-white">
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">
                <path
                  d="M4 6h16v2H4zm0 5h10v2H4zm0 5h16v2H4z"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <Typography.Text strong className="block text-sm">
                  Feedback Insights
                </Typography.Text>
                <Typography.Text type="secondary" className="block text-[10px]">
                  用户反馈分析
                </Typography.Text>
              </div>
            )}
          </div>

          <Menu
            className="min-h-0 flex-1 overflow-y-auto border-0 px-3 py-3"
            mode="inline"
            inlineCollapsed={collapsed}
            selectedKeys={[selectedKey]}
            items={navItems}
            onClick={({ key }) => navigate(key)}
          />

          {!collapsed && (
            <div className="shrink-0 border-t border-ink-100 p-4">
              {user && (
                <div className="mb-3">
                  <Typography.Text strong className="block text-xs">
                    {user.username}
                  </Typography.Text>
                  <Space size={4} className="mt-1">
                    <Tag className="!m-0 !text-[10px]">{ROLE_LABELS[user.role]}</Tag>
                    <Typography.Text type="secondary" className="text-[10px]">
                      {user.team}
                    </Typography.Text>
                  </Space>
                  <Button
                    type="link"
                    size="small"
                    className="!mt-1 !h-auto !p-0 !text-xs"
                    icon={<LogoutOutlined />}
                    onClick={async () => {
                      await logout()
                      navigate('/login')
                    }}
                  >
                    退出登录
                  </Button>
                </div>
              )}
              {period && (
                <Typography.Text type="secondary" className="mb-2 block text-[10px] leading-tight">
                  洞察周期
                  <br />
                  <span className="font-medium text-ink-600">{period.label}</span>
                </Typography.Text>
              )}
              <div data-testid="period-count-sidebar">
                <Statistic
                  title={period ? '周期内反馈' : '库内反馈'}
                  value={period ? periodCount : totalInDb}
                  styles={{ content: { fontSize: 18 } }}
                />
              </div>
              {period && periodCount !== totalInDb && (
                <Typography.Text type="secondary" className="mt-1 block text-[10px]">
                  库内合计 {totalInDb} 条
                </Typography.Text>
              )}
            </div>
          )}
        </div>
      </Layout.Sider>

      <Layout className="app-shell-main min-h-full min-w-0 bg-ink-50">
        <Layout.Content className="min-h-full min-w-0 bg-ink-50 p-3 sm:p-4 lg:p-5">
          <ImportSessionGuard />
          <RetagSessionGuard />
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
