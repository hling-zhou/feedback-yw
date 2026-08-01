/** 工单详情抽屉宽度（px），与 FeedbackDrawer Drawer size 保持一致 */
export const TICKET_DETAIL_DRAWER_WIDTH = 720

/** 举措详情抽屉宽度（px），高度与工单详情同为满视口 */
export const ACTION_ITEM_DRAWER_WIDTH = 640

/** 更新动态抽屉宽度（px），高度与工单详情同为满视口 */
export const WHATS_NEW_DRAWER_WIDTH = 480

/** 侧栏展开宽度（px），与 AppShell Layout.Sider width 保持一致 */
export const APP_SIDER_WIDTH = 224

/** 侧栏折叠宽度（px），与 Layout.Sider collapsedWidth 保持一致 */
export const APP_SIDER_COLLAPSED_WIDTH = 72

/** 视口 ≤ 991.98px 时自动折叠（Ant Design `lg` breakpoint） */
export const APP_SIDER_BREAKPOINT = 'lg'

/** @param {boolean} collapsed */
export function getAppSiderWidthPx(collapsed) {
  return collapsed ? APP_SIDER_COLLAPSED_WIDTH : APP_SIDER_WIDTH
}
