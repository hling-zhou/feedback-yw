import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ApiOutlined,
  BarChartOutlined,
  BugOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  FlagOutlined,
  HomeOutlined,
  ImportOutlined,
  LockOutlined,
  LogoutOutlined,
  MoreOutlined,
  SettingOutlined,
  TagOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons'
import { Button, Dropdown, Layout, Menu, Space, Tag, Tooltip, Typography } from 'antd'
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
import VersionRefreshBanner from './VersionRefreshBanner.jsx'
import MessageBottleSubmitModal from './MessageBottleSubmitModal.jsx'
import MessageBottleFab from './MessageBottleFab.jsx'
import WhatsNewFab from './WhatsNewFab.jsx'
import WhatsNewDrawer from './WhatsNewDrawer.jsx'
import ReminderFab from './ReminderFab.jsx'
import ReminderSendModal from './ReminderSendModal.jsx'
import { useUsageTracking } from '../hooks/useUsageTracking.js'

/** @typedef {import('react').ReactElement} ReactNavIcon */

/**
 * 左导航唯一真源：分组（线上VOC / API巡检）、平级项、分组闭合分隔线混合。
 * group 渲染为 antd Menu group（固定标题、不可点击、子项常驻）；leaf 为普通
 * 菜单项；divider 渲染为 antd Menu divider——分组结尾必须有闭合线，否则分组后的
 * 第一个平级项会被误读成上一组的子项（2026-11-07 层级误读修复）。
 * 菜单选中、角色过滤、折叠态展平、孤线清理均由此结构派生。
 * @typedef {{ type: 'leaf', key: string, label: string, icon: ReactNavIcon, badge?: string }} NavLeaf
 * @typedef {{ type: 'group', key: string, label: string, children: NavLeaf[] }} NavGroup
 * @typedef {{ type: 'divider', key: string }} NavDivider
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

/** @type {(NavGroup | NavLeaf | NavDivider)[]} */
const ALL_NAV = [
  { type: 'group', key: 'group-voc', label: '线上VOC', children: VOC_NAV_CHILDREN },
  {
    type: 'group',
    key: 'group-api-patrol',
    label: 'API巡检',
    children: API_PATROL_NAV_CHILDREN,
  },
  // 分组闭合线：切断「API巡检 → 问题与举措」的从属误读，两组之后的平级项是同层级模块
  { type: 'divider', key: 'divider-after-api-patrol' },
  { type: 'leaf', key: '/actions', label: '问题与举措', icon: <FlagOutlined /> },
  { type: 'leaf', key: '/import', label: '数据导入', icon: <ImportOutlined /> },
  { type: 'leaf', key: '/tags', label: '对象与标签', icon: <TagOutlined /> },
  { type: 'leaf', key: '/users', label: '用户管理', icon: <TeamOutlined /> },
  { type: 'leaf', key: '/operations', label: '运营分析', icon: <BarChartOutlined /> },
  { type: 'leaf', key: '/settings', label: '设置', icon: <SettingOutlined /> },
  { type: 'divider', key: 'divider-before-mcp' },
  { type: 'leaf', key: '/mcp-guide', label: 'MCP 数据服务', icon: <ApiOutlined />, badge: 'NEW' },
]

/** 递归收集全部叶子导航项（分组摊平；divider 不可点击，不参与摊平与路由匹配）。 */
function collectNavLeaves(items) {
  return items.flatMap((item) =>
    item.type === 'group'
      ? collectNavLeaves(/** @type {NavGroup} */ (item).children)
      : item.type === 'divider'
        ? []
        : [item],
  )
}

/** @type {NavLeaf[]} */
const NAV_LEAVES = collectNavLeaves(ALL_NAV)

/**
 * 移除首尾孤立的分隔线与连续重复的分隔线：
 * 角色过滤后分组/平级项可能整段消失，divider 若前无节点或与相邻 divider 直连会成为孤线/重线，
 * 必须在进入 antd Menu items 前清掉，否则渲染出无意义甚至误导性的断层。
 * 参数放宽为 unknown 数组（antd 内联 items 字面量的联合类型与结构化收窄互相打架），
 * divider 判定所需的 type 字段在函数内 cast；返回值由调用端 MenuProps cast 收口。
 * @param {ReadonlyArray<unknown>} items
 * @returns {unknown[]}
 */
function pruneStrayDividers(items) {
  const out = []
  for (const item of items) {
    const isDivider = /** @type {{ type?: string }} */ (item)?.type === 'divider'
    if (isDivider) {
      const prev = out[out.length - 1]
      if (!prev || /** @type {{ type?: string }} */ (prev)?.type === 'divider') continue
    }
    out.push(item)
  }
  if (out.length > 0 && /** @type {{ type?: string }} */ (out[out.length - 1])?.type === 'divider') {
    out.pop()
  }
  return out
}

/**
 * 菜单 items 摊平投影：分组展开为子项、divider 直通（折叠态用——antd inline collapsed
 * 不支持 group 形态）。与展开态共享同一份 visibleNavItems，两态只差一个投影，
 * 消除旧实现中折叠/展开双路径各自维护导致的漂移风险。
 * @param {ReadonlyArray<unknown>} items
 * @returns {unknown[]}
 */
function flattenMenuItems(items) {
  const out = []
  for (const item of items) {
    if (/** @type {{ type?: string }} */ (item)?.type === 'group') {
      const children = /** @type {{ children?: unknown[] }} */ (item).children
      if (Array.isArray(children)) out.push(...flattenMenuItems(children))
    } else {
      out.push(item)
    }
  }
  return out
}

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
   * 展开态菜单 items：分组保留 group 形态、divider 直通、隐藏项滤 null。
   * filter(Boolean) 无法静态收窄 null，末端 cast 对齐 antd Menu items 类型。
   * 顺序纪律：先滤掉隐藏项的 null，再 pruneStrayDividers——null 会干扰孤线判定。
   */
  const visibleNavItems = ALL_NAV.map((item) => {
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
    if (item.type === 'divider') return { type: 'divider', key: item.key }
    return canRoute(item.key) ? buildLeafMenuItem(item) : null
  }).filter(Boolean)

  const navItems = /** @type {import('antd').MenuProps['items']} */ (
    collapsed
      ? // 折叠态：分组摊平、divider 直通，摊平后仍可能产生孤线（分组隐藏后其前后的
        // divider 直连），必须同样过 pruneStrayDividers
        pruneStrayDividers(flattenMenuItems(visibleNavItems))
      : pruneStrayDividers(visibleNavItems)
  )

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
            className="min-h-0 flex-1 overflow-y-auto border-0 px-2 py-2"
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
            <div className="shrink-0 border-t border-ink-100 px-4 py-3">
              {user && (
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <Typography.Text strong className="block truncate text-xs leading-tight">
                      {user.username}
                    </Typography.Text>
                    <Space size={4} className="mt-0.5">
                      <Tag className="!m-0 !text-[10px] !leading-tight">
                        {ROLE_LABELS[user.role]}
                      </Tag>
                      {user.team && (
                        <Typography.Text type="secondary" className="text-[10px]">
                          {user.team}
                        </Typography.Text>
                      )}
                    </Space>
                  </div>
                  <Dropdown
                    trigger={['click']}
                    placement="topRight"
                    menu={{
                      items: [
                        {
                          key: 'change-password',
                          label: '修改密码',
                          icon: <LockOutlined />,
                        },
                        { type: 'divider' },
                        {
                          key: 'logout',
                          label: '退出登录',
                          icon: <LogoutOutlined />,
                          danger: true,
                        },
                      ],
                      onClick: ({ key }) => {
                        if (key === 'change-password') goChangePassword()
                        else if (key === 'logout') void handleLogout()
                      },
                    }}
                  >
                    <Button
                      type="text"
                      size="small"
                      aria-label="账号操作"
                      icon={<MoreOutlined />}
                      className="!text-ink-400"
                    />
                  </Dropdown>
                </div>
              )}
              {period && (
                <Typography.Text
                  type="secondary"
                  className="mt-2 block truncate text-[10px] leading-tight"
                >
                  洞察周期 · {period.label}
                </Typography.Text>
              )}
              <div data-testid="period-count-sidebar" className="mt-1">
                <Typography.Text type="secondary" className="block text-[10px] leading-tight">
                  {period ? '周期内反馈' : '库内反馈'}
                </Typography.Text>
                <div className="flex items-baseline justify-between gap-2">
                  <Typography.Text strong className="text-lg leading-none">
                    {period ? periodCount : totalInDb}
                  </Typography.Text>
                  {period && periodCount !== totalInDb && (
                    <Typography.Text type="secondary" className="text-[10px]">
                      库内合计 {totalInDb}
                    </Typography.Text>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </Layout.Sider>

      <Layout className="app-shell-main min-h-full min-w-0 bg-ink-50">
        <Layout.Content className="app-shell-content">
          <ImportSessionGuard />
          <RetagSessionGuard />
          <VersionRefreshBanner />
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
