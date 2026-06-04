import { ACTION_ITEM_STATUSES } from './actionItem.js'

/** @typedef {import('./actionItem.js').ActionItemStatus} ActionItemStatus */

/**
 * 举措状态视觉规范（需求 §四.3：待评估灰 / 进行中蓝 / 已完成绿 / 挂起紫）
 * - 标签：半透明底色 + 强调色文字
 * - 图表：与文字强调色一致的实心柱色
 *
 * @type {Record<ActionItemStatus, { chartColor: string; bgClass: string; textClass: string; borderClass: string }>}
 */
export const ACTION_ITEM_STATUS_VISUAL = {
  pending_evaluation: {
    chartColor: '#475569',
    bgClass: 'bg-slate-500/15',
    textClass: 'text-slate-600',
    borderClass: 'border-slate-500/25',
  },
  in_progress: {
    chartColor: '#1D4ED8',
    bgClass: 'bg-blue-500/15',
    textClass: 'text-blue-700',
    borderClass: 'border-blue-500/25',
  },
  completed: {
    chartColor: '#15803D',
    bgClass: 'bg-green-500/15',
    textClass: 'text-green-700',
    borderClass: 'border-green-500/25',
  },
  suspended: {
    chartColor: '#6D28D9',
    bgClass: 'bg-violet-500/15',
    textClass: 'text-violet-700',
    borderClass: 'border-violet-500/25',
  },
  not_implemented: {
    chartColor: '#78716C',
    bgClass: 'bg-stone-500/15',
    textClass: 'text-stone-600',
    borderClass: 'border-stone-500/25',
  },
  abnormal_terminated: {
    chartColor: '#B91C1C',
    bgClass: 'bg-red-500/15',
    textClass: 'text-red-700',
    borderClass: 'border-red-500/25',
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
