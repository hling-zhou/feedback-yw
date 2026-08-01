import { useMemo } from 'react'
import CompositeFilter from '../filters/CompositeFilter.jsx'
import {
  applyFeedbackFilterPatch,
  clearFeedbackFilterKey,
  countActiveFeedbackFilters,
  FEEDBACK_FILTER_GROUPS,
  FEEDBACK_FILTER_LABELS,
  formatFeedbackFilterChipLabel,
  getFeedbackFilterAddDisabledReason,
  isFeedbackFilterAddDisabled,
  listActiveFeedbackFilterChipKeys,
  normalizeFeedbackFilterEditorKey,
} from '../../lib/feedbackFilterModel.js'
import {
  buildFilterPatchFromDraft,
  getFeedbackFilterEditorKind,
  isFilterDraftValid,
  listEnumOptionsForFilterKey,
  readFilterDraftValue,
} from '../../lib/feedbackFilterEditors.js'

/** @typedef {import('../../lib/feedbackFilterModel.js').FeedbackFilterValues} FeedbackFilterValues */
/** @typedef {import('../../lib/feedbackFilterModel.js').FeedbackFilterKey} FeedbackFilterKey */

/**
 * @param {Object} props
 * @param {FeedbackFilterValues} props.filters
 * @param {(next: FeedbackFilterValues, meta?: { key?: FeedbackFilterKey; syncUrl?: boolean }) => void} props.onFiltersChange
 * @param {() => void} props.onClearFilters
 * @param {boolean} [props.showComplaintCauseFilter]
 * @param {boolean} [props.showMyReviewFilter]
 * @param {Object} [props.options]
 */
export default function FeedbackCompositeFilter({
  filters,
  onFiltersChange,
  onClearFilters,
  showComplaintCauseFilter = true,
  showMyReviewFilter = false,
  options = {},
}) {
  const disableCtx = useMemo(
    () => ({
      showComplaintCause: showComplaintCauseFilter,
      followUpActive: Boolean(filters.followUp && filters.followUp !== 'none'),
    }),
    [showComplaintCauseFilter, filters.followUp],
  )

  const filterGroups = useMemo(
    () => {
      const allowedKeys = options.filterKeys ? new Set(options.filterKeys) : null
      return FEEDBACK_FILTER_GROUPS.map((group) => ({
        ...group,
        keys: group.keys.filter(
          (key) =>
            (showMyReviewFilter || key !== 'myReview') && (!allowedKeys || allowedKeys.has(key)),
        ),
      })).filter((group) => group.keys.length > 0)
    },
    [options.filterKeys, showMyReviewFilter],
  )

  const config = useMemo(
    () => ({
      groups: filterGroups,
      labels: FEEDBACK_FILTER_LABELS,
      getEditorKind: getFeedbackFilterEditorKind,
      listActiveChipKeys: listActiveFeedbackFilterChipKeys,
      countActive: countActiveFeedbackFilters,
      formatChipLabel: formatFeedbackFilterChipLabel,
      isAddDisabled: isFeedbackFilterAddDisabled,
      getAddDisabledReason: getFeedbackFilterAddDisabledReason,
      normalizeEditorKey: normalizeFeedbackFilterEditorKey,
      readDraftValue: readFilterDraftValue,
      buildPatchFromDraft: buildFilterPatchFromDraft,
      isDraftValid: isFilterDraftValid,
      applyPatch: applyFeedbackFilterPatch,
      clearKey: clearFeedbackFilterKey,
      listEnumOptions: (key, values, editorOptions) =>
        listEnumOptionsForFilterKey(key, values, editorOptions, showComplaintCauseFilter),
      filterMenuKeys: (keys) =>
        keys.filter(
          (key) =>
            key !== 'ticketDateTo' &&
            (showMyReviewFilter || key !== 'myReview') &&
            (!options.filterKeys || options.filterKeys.includes(key)),
        ),
    }),
    [showComplaintCauseFilter, filterGroups, options.filterKeys, showMyReviewFilter],
  )

  return (
    <CompositeFilter
      filters={filters}
      onFiltersChange={onFiltersChange}
      onClearFilters={onClearFilters}
      config={config}
      disableCtx={disableCtx}
      options={{
        ...options,
        ticketIdOptions: options.ticketIdOptions,
      }}
    />
  )
}
