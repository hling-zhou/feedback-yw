import { ACTION_ITEM_STATUSES } from './actionItem.js'

/** @typedef {import('./actionItem.js').ActionItemStatus} ActionItemStatus */

/**
 * 举措状态视觉规范（需求 §四.3：待评估灰 / 进行中蓝 / 已完成绿 / 挂起紫）
 * - 标签：与柱状图同色的实心底色 + 反色文字（灰/暖灰底用深色文字保证对比度）
 * - 图表：实心柱色
 *
 * @type {Record<ActionItemStatus, { chartColor: string; tagTextClass: string }>}
 */
export const ACTION_ITEM_STATUS_VISUAL = {
  pending_evaluation: {
    chartColor: '#94A3B8',
    tagTextClass: 'text-slate-800',
  },
  in_progress: {
    chartColor: '#3B82F6',
    tagTextClass: 'text-white',
  },
  completed: {
    chartColor: '#22C55E',
    tagTextClass: 'text-white',
  },
  suspended: {
    chartColor: '#8B5CF6',
    tagTextClass: 'text-white',
  },
  not_implemented: {
    chartColor: '#A8A29E',
    tagTextClass: 'text-stone-800',
  },
  abnormal_terminated: {
    chartColor: '#EF4444',
    tagTextClass: 'text-white',
  },
}

/** @type {Record<ActionItemStatus, string>} */
export const ACTION_ITEM_STATUS_CHART_COLORS = Object.fromEntries(
  ACTION_ITEM_STATUSES.map((status) => [status, ACTION_ITEM_STATUS_VISUAL[status].chartColor]),
)

/**
 * @param {ActionItemStatus | string | undefined | null} status
 */
export function getActionItemStatusVisual(status) {
  const key = /** @type {ActionItemStatus} */ (status)
  return ACTION_ITEM_STATUS_VISUAL[key] || ACTION_ITEM_STATUS_VISUAL.pending_evaluation
}
