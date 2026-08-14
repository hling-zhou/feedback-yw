import { useMemo } from 'react'
import CompositeFilter from '../filters/CompositeFilter.jsx'
import {
  POST_USE_JIRA_FILTER_GROUPS,
  POST_USE_JIRA_FILTER_LABELS,
  applyPostUseJiraFilterPatch,
  clearPostUseJiraFilterKey,
  countActivePostUseJiraFilters,
  formatPostUseJiraFilterChipLabel,
  getPostUseJiraFilterAddDisabledReason,
  isPostUseJiraFilterAddDisabled,
  listActivePostUseJiraFilterChipKeys,
  normalizePostUseJiraFilterEditorKey,
} from '../../lib/postUseJiraFilterModel.js'
import {
  buildPostUseJiraFilterPatchFromDraft,
  getPostUseJiraFilterEditorKind,
  isPostUseJiraFilterDraftValid,
  listPostUseJiraEnumOptionsForFilterKey,
  readPostUseJiraFilterDraftValue,
} from '../../lib/postUseJiraFilterEditors.js'

/** @typedef {import('../../lib/postUseJiraFilterModel.js').PostUseJiraFilterValues} PostUseJiraFilterValues */
/** @typedef {import('../../lib/postUseJiraFilterModel.js').PostUseJiraFilterKey} PostUseJiraFilterKey */

/**
 * @param {Object} props
 * @param {PostUseJiraFilterValues} props.filters
 * @param {(next: PostUseJiraFilterValues, meta?: { key?: PostUseJiraFilterKey; syncUrl?: boolean }) => void} props.onFiltersChange
 * @param {() => void} props.onClearFilters
 * @param {string} [props.className]
 */
export default function PostUseJiraCompositeFilter({
  filters,
  onFiltersChange,
  onClearFilters,
  className,
}) {
  const config = useMemo(
    () => ({
      groups: POST_USE_JIRA_FILTER_GROUPS,
      labels: POST_USE_JIRA_FILTER_LABELS,
      getEditorKind: getPostUseJiraFilterEditorKind,
      listActiveChipKeys: listActivePostUseJiraFilterChipKeys,
      countActive: countActivePostUseJiraFilters,
      formatChipLabel: formatPostUseJiraFilterChipLabel,
      isAddDisabled: isPostUseJiraFilterAddDisabled,
      getAddDisabledReason: getPostUseJiraFilterAddDisabledReason,
      normalizeEditorKey: normalizePostUseJiraFilterEditorKey,
      readDraftValue: readPostUseJiraFilterDraftValue,
      buildPatchFromDraft: buildPostUseJiraFilterPatchFromDraft,
      isDraftValid: isPostUseJiraFilterDraftValid,
      applyPatch: applyPostUseJiraFilterPatch,
      clearKey: clearPostUseJiraFilterKey,
      listEnumOptions: listPostUseJiraEnumOptionsForFilterKey,
    }),
    [],
  )

  return (
    <CompositeFilter
      filters={filters}
      onFiltersChange={onFiltersChange}
      onClearFilters={onClearFilters}
      config={config}
      className={className}
      emptyPlaceholder="选择属性筛选（月份、产品、状态、客户/JIRA）"
    />
  )
}
