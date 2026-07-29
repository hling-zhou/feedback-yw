/**
 * 功能上新提示：本机 localStorage 已读标记（版本号升版可再次曝光）。
 */

/**
 * @param {string} key
 */
export function hasSeenWhatsNew(key) {
  const storageKey = String(key ?? '').trim()
  if (!storageKey) return true
  try {
    return localStorage.getItem(storageKey) === '1'
  } catch {
    return true
  }
}

/**
 * @param {string} key
 */
export function markWhatsNewSeen(key) {
  const storageKey = String(key ?? '').trim()
  if (!storageKey) return
  try {
    localStorage.setItem(storageKey, '1')
  } catch {
    /* ignore quota / private mode */
  }
}

/** 工单详情 · 处理意见放大查看 */
export const HANDLING_EXPAND_WHATS_NEW_KEY = 'fi.handlingExpand.whatsNew.v1'

export function hasSeenHandlingExpandWhatsNew() {
  return hasSeenWhatsNew(HANDLING_EXPAND_WHATS_NEW_KEY)
}

export function markHandlingExpandWhatsNewSeen() {
  markWhatsNewSeen(HANDLING_EXPAND_WHATS_NEW_KEY)
}

/** 洞察工作台 · 投诉/咨询工单 Tab（共用） */
export const WORKBENCH_TICKET_TABS_WHATS_NEW_KEY = 'fi.workbench.ticketTabs.whatsNew.v1'

export const WORKBENCH_TICKET_TABS_WHATS_NEW_DESCRIPTION =
  '投诉/咨询工单分析页已更新布局与洞察模块，可结合产品筛选与图表下钻查看；详细分析请点上方「洞察分析」。'

export function hasSeenWorkbenchTicketTabsWhatsNew() {
  return hasSeenWhatsNew(WORKBENCH_TICKET_TABS_WHATS_NEW_KEY)
}

export function markWorkbenchTicketTabsWhatsNewSeen() {
  markWhatsNewSeen(WORKBENCH_TICKET_TABS_WHATS_NEW_KEY)
}
