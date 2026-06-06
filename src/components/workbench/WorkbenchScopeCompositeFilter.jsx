import { useMemo } from 'react'
import CompositeFilter from '../filters/CompositeFilter.jsx'
import {
  WORKBENCH_ANALYSIS_SCOPE_GROUPS,
  WORKBENCH_ANALYSIS_SCOPE_KEYS,
  WORKBENCH_SCOPE_FILTER_LABELS,
  WORKBENCH_TICKET_SCOPE_GROUPS,
  WORKBENCH_TICKET_SCOPE_KEYS,
  applyWorkbenchScopeFilterPatch,
  clearWorkbenchScopeFilterKey,
  countActiveWorkbenchScopeFilters,
  formatWorkbenchScopeFilterChipLabel,
  getWorkbenchScopeFilterAddDisabledReason,
  isWorkbenchScopeFilterAddDisabled,
  listActiveWorkbenchScopeFilterChipKeys,
  normalizeWorkbenchScopeFilterEditorKey,
} from '../../lib/workbenchScopeFilterModel.js'
import {
  buildWorkbenchScopeFilterPatchFromDraft,
  getWorkbenchScopeFilterEditorKind,
  isWorkbenchScopeFilterDraftValid,
  listWorkbenchScopeEnumOptionsForFilterKey,
  readWorkbenchScopeFilterDraftValue,
} from '../../lib/workbenchScopeFilterEditors.js'

/** @typedef {import('../../lib/workbenchScopeFilterModel.js').WorkbenchScopeFilterValues} WorkbenchScopeFilterValues */
/** @typedef {import('../../lib/workbenchScopeFilterModel.js').WorkbenchScopeFilterKey} WorkbenchScopeFilterKey */

/**
 * @param {Object} props
 * @param {'analysis' | 'ticket'} props.preset
 * @param {WorkbenchScopeFilterValues} props.filters
 * @param {(next: WorkbenchScopeFilterValues, meta?: { key?: WorkbenchScopeFilterKey }) => void} props.onFiltersChange
 * @param {() => void} props.onClearFilters
 * @param {boolean} [props.showComplaintCauseFilter]
 * @param {{
 *   productOptions?: { label: string; value: string }[]
 *   resourcePoolOptions?: { label: string; value: string }[]
 *   complaintCauseOptions?: { label: string; value: string }[]
 * }} [props.options]
 * @param {string} [props.className]
 */
export default function WorkbenchScopeCompositeFilter({
  preset,
  filters,
  onFiltersChange,
  onClearFilters,
  showComplaintCauseFilter = true,
  options = {},
  className,
}) {
  const enabledKeys = preset === 'ticket' ? WORKBENCH_TICKET_SCOPE_KEYS : WORKBENCH_ANALYSIS_SCOPE_KEYS
  const groups = preset === 'ticket' ? WORKBENCH_TICKET_SCOPE_GROUPS : WORKBENCH_ANALYSIS_SCOPE_GROUPS

  const disableCtx = useMemo(
    () => ({
      showComplaintCause: showComplaintCauseFilter,
      enabledKeys: showComplaintCauseFilter
        ? enabledKeys
        : enabledKeys.filter((key) => key !== 'complaintCauseL1'),
    }),
    [showComplaintCauseFilter, enabledKeys],
  )

  const config = useMemo(
    () => ({
      groups: showComplaintCauseFilter
        ? groups
        : groups.map((group) => ({
            ...group,
            keys: group.keys.filter((key) => key !== 'complaintCauseL1'),
          })),
      labels: WORKBENCH_SCOPE_FILTER_LABELS,
      getEditorKind: getWorkbenchScopeFilterEditorKind,
      listActiveChipKeys: (values) =>
        listActiveWorkbenchScopeFilterChipKeys(values, disableCtx.enabledKeys),
      countActive: (values) => countActiveWorkbenchScopeFilters(values, disableCtx.enabledKeys),
      formatChipLabel: formatWorkbenchScopeFilterChipLabel,
      isAddDisabled: isWorkbenchScopeFilterAddDisabled,
      getAddDisabledReason: getWorkbenchScopeFilterAddDisabledReason,
      normalizeEditorKey: normalizeWorkbenchScopeFilterEditorKey,
      readDraftValue: readWorkbenchScopeFilterDraftValue,
      buildPatchFromDraft: buildWorkbenchScopeFilterPatchFromDraft,
      isDraftValid: isWorkbenchScopeFilterDraftValid,
      applyPatch: applyWorkbenchScopeFilterPatch,
      clearKey: (key, current) => clearWorkbenchScopeFilterKey(key, current, disableCtx.enabledKeys),
      listEnumOptions: listWorkbenchScopeEnumOptionsForFilterKey,
    }),
    [groups, disableCtx.enabledKeys, showComplaintCauseFilter],
  )

  return (
    <CompositeFilter
      filters={filters}
      onFiltersChange={onFiltersChange}
      onClearFilters={onClearFilters}
      config={config}
      disableCtx={disableCtx}
      options={options}
      className={className}
    />
  )
}
