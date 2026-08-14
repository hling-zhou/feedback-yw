import { useMemo } from 'react'
import CompositeFilter from '../filters/CompositeFilter.jsx'
import {
  ACTION_ITEM_FILTER_GROUPS,
  ACTION_ITEM_FILTER_LABELS,
  applyActionItemFilterPatch,
  clearActionItemFilterKey,
  countActiveActionItemFilters,
  formatActionItemFilterChipLabel,
  getActionItemFilterAddDisabledReason,
  isActionItemFilterAddDisabled,
  listActiveActionItemFilterChipKeys,
  normalizeActionItemFilterEditorKey,
} from '../../lib/actionItemFilterModel.js'
import {
  buildActionItemFilterPatchFromDraft,
  getActionItemFilterEditorKind,
  isActionItemFilterDraftValid,
  listActionItemEnumOptionsForFilterKey,
  readActionItemFilterDraftValue,
} from '../../lib/actionItemFilterEditors.js'

/** @typedef {import('../../lib/actionItemFilterModel.js').ActionItemFilterValues} ActionItemFilterValues */
/** @typedef {import('../../lib/actionItemFilterModel.js').ActionItemFilterKey} ActionItemFilterKey */

/**
 * @param {Object} props
 * @param {ActionItemFilterValues} props.filters
 * @param {(next: ActionItemFilterValues, meta?: { key?: ActionItemFilterKey; syncUrl?: boolean }) => void} props.onFiltersChange
 * @param {() => void} props.onClearFilters
 * @param {{ productOptions?: { label: string; value: string }[]; statusOptions?: { label: string; value: string }[]; productNameByKey?: Map<string, string> }} [props.options]
 * @param {string} [props.className]
 */
export default function ActionItemCompositeFilter({
  filters,
  onFiltersChange,
  onClearFilters,
  options = {},
  className,
}) {
  const config = useMemo(
    () => ({
      groups: ACTION_ITEM_FILTER_GROUPS,
      labels: ACTION_ITEM_FILTER_LABELS,
      getEditorKind: getActionItemFilterEditorKind,
      listActiveChipKeys: listActiveActionItemFilterChipKeys,
      countActive: countActiveActionItemFilters,
      formatChipLabel: (key, values) =>
        formatActionItemFilterChipLabel(key, values, {
          productNameByKey: options.productNameByKey,
        }),
      isAddDisabled: isActionItemFilterAddDisabled,
      getAddDisabledReason: getActionItemFilterAddDisabledReason,
      normalizeEditorKey: normalizeActionItemFilterEditorKey,
      readDraftValue: readActionItemFilterDraftValue,
      buildPatchFromDraft: buildActionItemFilterPatchFromDraft,
      isDraftValid: isActionItemFilterDraftValid,
      applyPatch: applyActionItemFilterPatch,
      clearKey: clearActionItemFilterKey,
      listEnumOptions: listActionItemEnumOptionsForFilterKey,
    }),
    [options.productNameByKey],
  )

  return (
    <CompositeFilter
      filters={filters}
      onFiltersChange={onFiltersChange}
      onClearFilters={onClearFilters}
      config={config}
      options={options}
      className={className}
      emptyPlaceholder="选择属性筛选（产品、状态、关联工单…）"
    />
  )
}
