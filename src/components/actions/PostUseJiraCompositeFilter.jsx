import { useEffect, useMemo, useState } from 'react'
import CompositeFilter from '../filters/CompositeFilter.jsx'
import { listAssignees } from '../../lib/postUseJiraClient.js'
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
  const [assigneeOptions, setAssigneeOptions] = useState([])
  useEffect(() => {
    listAssignees()
      .then((res) => setAssigneeOptions(
        (res?.users || []).map((u) => ({ label: u.username, value: u.id })),
      ))
      .catch(() => {})
  }, [])
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
      listEnumOptions: (key, flt) => listPostUseJiraEnumOptionsForFilterKey(key, flt, { assigneeOptions }),
    }),
    [assigneeOptions],
  )

  // chip label for assigneeId should show name instead of id
  const formatChipLabelOverride = useMemo(() => {
    const nameMap = new Map(assigneeOptions.map((o) => [o.value, o.label]))
    return (key, vals) => {
      if (key === 'assigneeId') return nameMap.get(vals.assigneeId) || vals.assigneeId
      return formatPostUseJiraFilterChipLabel(key, vals)
    }
  }, [assigneeOptions])
  const configWithOverride = useMemo(
    () => ({ ...config, formatChipLabel: formatChipLabelOverride }),
    [config, formatChipLabelOverride],
  )

  return (
    <CompositeFilter
      filters={filters}
      onFiltersChange={onFiltersChange}
      onClearFilters={onClearFilters}
      config={configWithOverride}
      className={className}
      emptyPlaceholder="选择属性筛选（月份、产品、状态、经办人、客户）"
    />
  )
}
