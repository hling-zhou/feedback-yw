import { Select, Typography } from 'antd'
import FeedbackCompositeFilter from './FeedbackCompositeFilter.jsx'

/** @typedef {import('../../lib/feedbackFilterModel.js').FeedbackFilterValues} FeedbackFilterValues */
/** @typedef {import('../../lib/feedbackFilterModel.js').FeedbackFilterKey} FeedbackFilterKey */

/**
 * @param {Object} props
 * @param {FeedbackFilterValues} props.filters
 * @param {(next: FeedbackFilterValues, meta?: { key?: FeedbackFilterKey; syncUrl?: boolean }) => void} props.onFiltersChange
 * @param {(product: string) => void} props.onProductChange
 * @param {() => void} props.onClearFilters
 * @param {boolean} [props.showComplaintCauseFilter]
 * @param {boolean} [props.showMyReviewFilter]
 * @param {{
 *   ticketIdOptions?: { label: string; value: string }[]
 *   products?: { name: string; count?: number }[]
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
  onProductChange,
  onClearFilters,
  showComplaintCauseFilter = true,
  showMyReviewFilter = false,
  options = {},
  actions,
}) {
  const productOptions = (options.products || []).map((item) => ({
    label: item.count != null ? `${item.name} (${item.count})` : item.name,
    value: item.name,
  }))

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Typography.Text className="shrink-0 text-sm text-ink-600">产品</Typography.Text>
        <Select
          allowClear
          placeholder="全部产品"
          className="min-w-[180px]"
          value={filters.product || undefined}
          options={productOptions}
          onChange={(value) => onProductChange(value || '')}
        />
        {filters.product ? (
          <Typography.Text type="secondary" className="text-xs">
            下方复合筛选选项已按所选产品收窄
          </Typography.Text>
        ) : null}
      </div>

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
