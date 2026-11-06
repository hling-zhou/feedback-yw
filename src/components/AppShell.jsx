import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  TagOutlined,
  HomeOutlined,
  ImportOutlined,
  SettingOutlined,
  UnorderedListOutlined,
  TeamOutlined,
  LogoutOutlined,
  LockOutlined,
  FlagOutlined,
  DeploymentUnitOutlined,
  BarChartOutlined,
  ApiOutlined,
  DashboardOutlined,
  BugOutlined,
} from '@ant-design/icons'
import { Button, Layout, Menu, Space, Statistic, Tag, Tooltip, Typography } from 'antd'
import { useAuth } from '../context/AuthContext.jsx'
import {
  APP_SIDER_BREAKPOINT,
  APP_SIDER_COLLAPSED_WIDTH,
  APP_SIDER_WIDTH,
  getAppSiderWidthPx,
} from '../constants/appLayout.js'
import { usePeriodScope } from '../hooks/usePeriodScope.js'
import { ROLE_LABELS } from '../domain/auth/permissions.js'
import { hasUnreadWhatsNewFeed } from '../domain/whatsNewFeed.js'
import { fetchWhatsNewFeed } from '../lib/whatsNewFeedClient.js'
import ImportSessionGuard from './ImportSessionGuard.jsx'
import RetagSessionGuard from './RetagSessionGuard.jsx'
import MessageBottleSubmitModal from './MessageBottleSubmitModal.jsx'
import MessageBottleFab from './MessageBottleFab.jsx'
import WhatsNewFab from './WhatsNewFab.jsx'
import WhatsNewDrawer from './WhatsNewDrawer.jsx'
import ReminderFab from './ReminderFab.jsx'
import ReminderSendModal from './ReminderSendModal.jsx'
import { useUsageTracking } from '../hooks/useUsageTracking.js'

/** @typedef {import('react').ReactElement} ReactNavIcon */

/**
 * 左导航唯一真源：分组（线上VOC / API巡检）与平级项混合。
 * group 项渲染为 antd Menu group（固定分组标题，不可点击，子项常驻）；
 * leaf 项为普通菜单项。菜单选中、角色过滤、折叠态展平均由此结构派生。
 * @typedef {{ type: 'leaf', key: string, label: string, icon: ReactNavIcon, badge?: string }} NavLeaf
 * @typedef {{ type: 'group', key: string, label: string, children: NavLeaf[] }} NavGroup
 */

/** @type {NavLeaf[]} */
const VOC_NAV_CHILDREN = [
  { type: 'leaf', key: '/workbench', label: '洞察工作台', icon: <HomeOutlined /> },
  { type: 'leaf', key: '/topics', label: '专题分析', icon: <DeploymentUnitOutlined /> },
  { type: 'leaf', key: '/feedbacks', label: '反馈库', icon: <UnorderedListOutlined /> },
]

/** @type {NavLeaf[]} */
const API_PATROL_NAV_CHILDREN = [
  { type: 'leaf', key: '/api-patrol/overview', label: '总览', icon: <DashboardOutlined /> },
  { type: 'leaf', key: '/api-patrol/failures', label: '异常接口溯源', icon: <BugOutlined /> },
]

/** @type {(NavGroup | NavLeaf)[]} */
const ALL_NAV = [
  { type: 'group', key: 'group-voc', label: '线上VOC', children: VOC_NAV_CHILDREN },
  {
    type: 'group',
    key: 'group-api-patrol',
    label: 'API巡检',
    children: API_PATROL_NAV_CHILDREN,
  },
  { type: 'leaf', key: '/actions', label: '问题与举措', icon: <FlagOutlined /> },
  { type: 'leaf', key: '/import', label: '数据导入', icon: <ImportOutlined /> },
  { type: 'leaf', key: '/tags', label: '对象与标签', icon: <TagOutlined /> },
  { type: 'leaf', key: '/users', label: '用户管理', icon: <TeamOutlined /> },
  { type: 'leaf', key: '/operations', label: '运营分析', icon: <BarChartOutlined /> },
  { type: 'leaf', key: '/settings', label: '设置', icon: <SettingOutlined /> },
  { type: 'leaf', key: '/mcp-guide', label: 'MCP 数据服务', icon: <ApiOutlined />, badge: 'NEW' },
]

/** 递归收集全部叶子导航项（分组与平级统一摊平）。 */
function collectNavLeaves(items) {
  return items.flatMap((item) =>
    item.type === 'group' ? collectNavLeaves(/** @type {NavGroup} */ (item).children) : [item],
  )
}

/** @type {NavLeaf[]} */
const NAV_LEAVES = collectNavLeaves(ALL_NAV)

function resolveNavKey(pathname) {
  if (pathname === '/' || pathname.startsWith('/workbench')) return '/workbench'
  // 最长前缀匹配：/api-patrol/failures 必须胜出 /api-patrol/overview，
  // 且平级 startsWith 匹配下先按 key 长度降序再取首个命中。
  const matched = NAV_LEAVES
    .filter((n) => n.key !== '/workbench' && pathname.startsWith(n.key))
    .sort((a, b) => b.key.length - a.key.length)[0]
  return matched?.key || '/workbench'
}

export default function AppShell() {
  const { period, periodCount, totalInDb } = usePeriodScope()
  const { user, logout, canRoute } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const selectedKey = resolveNavKey(location.pathname)
  useUsageTracking(user)
  const [collapsed, setCollapsed] = useState(false)
  const [bottleOpen, setBottleOpen] = useState(false)
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [whatsNewUnread, setWhatsNewUnread] = useState(false)
  const [reminderOpen, setReminderOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    void fetchWhatsNewFeed()
      .then((feed) => {
        if (!cancelled) setWhatsNewUnread(hasUnreadWhatsNewFeed(feed))
      })
      .catch(() => {
        if (!cancelled) setWhatsNewUnread(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleWhatsNewMarkedSeen = useCallback(() => {
    setWhatsNewUnread(false)
  }, [])

  /**
   * 叶子项 → antd 菜单项（NEW 角标等 label 装饰在此处）。
   * @param {NavLeaf} leaf
   */
  const buildLeafMenuItem = ({ key, label, icon, badge }) => ({
    key,
    label: badge ? (
      <Space size={4}>
        <span>{label}</span>
        <Tag color="purple" className="!m-0 !text-[10px] !leading-tight">
          {badge}
        </Tag>
      </Space>
    ) : (
      label
    ),
    icon,
  })

  /**
   * 折叠态：分组展平成平级菜单（antd inline collapsed 不支持 group 形态）。
   * filter(Boolean) 无法静态收窄 null，末端 cast 对齐 antd Menu items 类型。
   */
  const navItems = /** @type {import('antd').MenuProps['items']} */ (
    collapsed
      ? NAV_LEAVES.filter((item) => canRoute(item.key)).map(buildLeafMenuItem)
      : ALL_NAV.map((item) => {
          if (item.type === 'group') {
            const visibleChildren = item.children.filter((child) => canRoute(child.key))
            if (visibleChildren.length === 0) return null // 整组被角色隐藏则不渲染
            return {
              type: 'group',
              key: item.key,
              label: item.label,
              children: visibleChildren.map(buildLeafMenuItem),
            }
          }
          return canRoute(item.key) ? buildLeafMenuItem(item) : null
        }).filter(Boolean)
  )

  // 在 MCP 数据服务前插入分隔线
  const mcpIndex = navItems.findIndex((n) => n.key === '/mcp-guide')
  if (mcpIndex >= 0) {
    navItems.splice(mcpIndex, 0, { type: 'divider' })
  }

  const goChangePassword = () => {
    navigate('/change-password?mode=voluntary', {
      state: user ? { username: user.username, mode: 'voluntary' } : { mode: 'voluntary' },
    })
  }

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

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
        className="app-shell-sider !bg-white"
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

          {collapsed && user ? (
            <div className="flex shrink-0 flex-col items-center gap-1 border-t border-ink-100 p-2">
              <Tooltip title="修改密码" placement="right">
                <Button
                  type="text"
                  size="small"
                  aria-label="修改密码"
                  icon={<LockOutlined />}
                  onClick={goChangePassword}
                />
              </Tooltip>
              <Tooltip title="退出登录" placement="right">
                <Button
                  type="text"
                  size="small"
                  aria-label="退出登录"
                  icon={<LogoutOutlined />}
                  onClick={handleLogout}
                />
              </Tooltip>
            </div>
          ) : null}

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
                  <Space size={4} wrap className="mt-1">
                    <Button
                      type="link"
                      size="small"
                      className="!h-auto !p-0 !text-xs"
                      icon={<LockOutlined />}
                      onClick={goChangePassword}
                    >
                      修改密码
                    </Button>
                    <Typography.Text type="secondary" className="text-xs">
                      ·
                    </Typography.Text>
                    <Button
                      type="link"
                      size="small"
                      className="!h-auto !p-0 !text-xs"
                      icon={<LogoutOutlined />}
                      onClick={handleLogout}
                    >
                      退出登录
                    </Button>
                  </Space>
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
        <Layout.Content className="app-shell-content">
          <ImportSessionGuard />
          <RetagSessionGuard />
          <div className="app-float-actions">
            <WhatsNewFab
              hasUnread={whatsNewUnread}
              onClick={() => setWhatsNewOpen(true)}
            />
            <MessageBottleFab onClick={() => setBottleOpen(true)} />
            {user?.role === 'admin' && <ReminderFab onClick={() => setReminderOpen(true)} />}
          </div>
          <WhatsNewDrawer
            open={whatsNewOpen}
            onClose={() => setWhatsNewOpen(false)}
            onMarkedSeen={handleWhatsNewMarkedSeen}
          />
          <MessageBottleSubmitModal open={bottleOpen} onClose={() => setBottleOpen(false)} />
          {user?.role === 'admin' && (
            <ReminderSendModal open={reminderOpen} onClose={() => setReminderOpen(false)} />
          )}
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  )
}
