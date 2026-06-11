import FeedbackCompositeFilter from './FeedbackCompositeFilter.jsx'
import { isFeedbackFilterActive } from '../../lib/feedbackFilterModel.js'

/** @typedef {import('../../lib/feedbackFilterModel.js').FeedbackFilterValues} FeedbackFilterValues */
/** @typedef {import('../../lib/feedbackFilterModel.js').FeedbackFilterKey} FeedbackFilterKey */

/**
 * @param {Object} props
 * @param {FeedbackFilterValues} props.filters
 * @param {(next: FeedbackFilterValues, meta?: { key?: FeedbackFilterKey; syncUrl?: boolean }) => void} props.onFiltersChange
 * @param {() => void} props.onClearFilters
 * @param {boolean} [props.showComplaintCauseFilter]
 * @param {boolean} [props.showMyReviewFilter]
 * @param {{
 *   ticketIdOptions?: { label: string; value: string }[]
 *   products?: { name: string }[]
 *   problemTypes?: { name: string }[]
 *   complaintCauseOptions?: { name: string }[]
 *   journeys?: { name: string }[]
 *   resourcePools?: { name: string }[]
 *   requestScenes?: { name: string }[]
 * }} [props.options]
 * @param {import('react').ReactNode} [props.actions]
 */
export default function FeedbackFilterBar({
  filters,
  onFiltersChange,
  onClearFilters,
  showComplaintCauseFilter = true,
  showMyReviewFilter = false,
  options = {},
  actions,
}) {
  return (
    <div className="space-y-2">
      <FeedbackCompositeFilter
        filters={filters}
        onFiltersChange={onFiltersChange}
        onClearFilters={onClearFilters}
        showComplaintCauseFilter={showComplaintCauseFilter}
        showMyReviewFilter={showMyReviewFilter}
        options={options}
      />

      {actions ? <div className="flex w-full flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export { isFeedbackFilterActive }
