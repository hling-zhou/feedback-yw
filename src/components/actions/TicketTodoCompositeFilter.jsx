import { useMemo } from 'react'
import CompositeFilter from '../filters/CompositeFilter.jsx'
import {
  TICKET_TODO_FILTER_GROUPS,
  TICKET_TODO_FILTER_LABELS,
  applyTicketTodoFilterPatch,
  clearTicketTodoFilterKey,
  countActiveTicketTodoFilters,
  formatTicketTodoFilterChipLabel,
  getTicketTodoFilterAddDisabledReason,
  isTicketTodoFilterAddDisabled,
  listActiveTicketTodoFilterChipKeys,
  normalizeTicketTodoFilterEditorKey,
} from '../../lib/ticketTodoFilterModel.js'
import {
  buildTicketTodoFilterPatchFromDraft,
  getTicketTodoFilterEditorKind,
  isTicketTodoFilterDraftValid,
  listTicketTodoEnumOptionsForFilterKey,
  readTicketTodoFilterDraftValue,
} from '../../lib/ticketTodoFilterEditors.js'

/** @typedef {import('../../lib/ticketTodoFilterModel.js').TicketTodoFilterValues} TicketTodoFilterValues */
/** @typedef {import('../../lib/ticketTodoFilterModel.js').TicketTodoFilterKey} TicketTodoFilterKey */

/**
 * @param {Object} props
 * @param {TicketTodoFilterValues} props.filters
 * @param {(next: TicketTodoFilterValues) => void} props.onFiltersChange
 * @param {() => void} props.onClearFilters
 * @param {{
 *   productOptions?: { label: string; value: string }[]
 *   statusOptions?: { label: string; value: string }[]
 *   sourceOptions?: { label: string; value: string }[]
 *   assigneeOptions?: { label: string; value: string }[]
 *   productNameByKey?: Map<string, string>
 *   assigneeNameById?: Map<string, string>
 * }} [props.options]
 * @param {string} [props.className]
 */
export default function TicketTodoCompositeFilter({
  filters,
  onFiltersChange,
  onClearFilters,
  options = {},
  className,
}) {
  const config = useMemo(
    () => ({
      groups: TICKET_TODO_FILTER_GROUPS,
      labels: TICKET_TODO_FILTER_LABELS,
      getEditorKind: getTicketTodoFilterEditorKind,
      listActiveChipKeys: listActiveTicketTodoFilterChipKeys,
      countActive: countActiveTicketTodoFilters,
      formatChipLabel: (key, values) =>
        formatTicketTodoFilterChipLabel(key, values, {
          productNameByKey: options.productNameByKey,
          assigneeNameById: options.assigneeNameById,
        }),
      isAddDisabled: isTicketTodoFilterAddDisabled,
      getAddDisabledReason: getTicketTodoFilterAddDisabledReason,
      normalizeEditorKey: normalizeTicketTodoFilterEditorKey,
      readDraftValue: readTicketTodoFilterDraftValue,
      buildPatchFromDraft: buildTicketTodoFilterPatchFromDraft,
      isDraftValid: isTicketTodoFilterDraftValid,
      applyPatch: applyTicketTodoFilterPatch,
      clearKey: clearTicketTodoFilterKey,
      listEnumOptions: listTicketTodoEnumOptionsForFilterKey,
    }),
    [options.productNameByKey, options.assigneeNameById],
  )

  return (
    <CompositeFilter
      filters={filters}
      onFiltersChange={onFiltersChange}
      onClearFilters={onClearFilters}
      config={config}
      options={options}
      className={className}
      emptyPlaceholder="选择属性筛选（产品、状态、来源、负责人…）"
    />
  )
}
