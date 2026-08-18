import {
  TICKET_TODO_RESOLUTION_LABELS,
  getTicketTodoResolution,
} from '../../domain/ticketTodo.js'

/** @type {Record<string, { chartColor: string; tagTextClass: string }>} */
export const TICKET_TODO_RESOLUTION_VISUAL = {
  open: { chartColor: '#F59E0B', tagTextClass: 'text-white' },
  converted_to_action: { chartColor: '#22C55E', tagTextClass: 'text-white' },
  processed_without_action: { chartColor: '#64748B', tagTextClass: 'text-white' },
}

/** @type {Record<string, string>} */
export const TICKET_TODO_RESOLUTION_CHART_COLORS = Object.fromEntries(
  Object.entries(TICKET_TODO_RESOLUTION_VISUAL).map(([key, visual]) => [key, visual.chartColor]),
)

/**
 * @param {{
 *   resolution?: import('../../domain/ticketTodo.js').TicketTodoResolution | string
 *   item?: import('../../domain/ticketTodo.js').TicketTodoItem | null
 *   className?: string
 * }} props
 */
export default function TicketTodoStatusTag({ resolution, item, className = '' }) {
  const status = resolution || getTicketTodoResolution(item)
  const visual = TICKET_TODO_RESOLUTION_VISUAL[status] || TICKET_TODO_RESOLUTION_VISUAL.open
  const label = TICKET_TODO_RESOLUTION_LABELS[status] || status

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium leading-none ${visual.tagTextClass} ${className}`}
      style={{ backgroundColor: visual.chartColor }}
    >
      {label}
    </span>
  )
}
