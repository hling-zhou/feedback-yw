import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../../domain/enums.js'
import { isTicketSource } from '../../lib/importUtils.js'
import OverviewTab from '../workbench/OverviewTab.jsx'
import TicketDashboardView from '../workbench/TicketDashboardView.jsx'
import PostUseRatingDashboardView from '../workbench/PostUseRatingDashboardView.jsx'

/** @typedef {import('../../domain/pdfExportJob.js').PdfExportJobPayload} PdfExportJobPayload */

/**
 * 离屏渲染：仅用于 PDF 图表截图，不展示给用户
 *
 * @param {Object} props
 * @param {PdfExportJobPayload['scope']} props.scope
 * @param {PdfExportJobPayload} props.payload
 */
export default function PdfCaptureScopeView({ scope, payload }) {
  const {
    overview,
    sourceSnapshot,
    sourceSnapshots,
    period,
    feedbacks,
    orderVolumes,
    complaintRecords,
  } = payload

  if (scope === 'overview' && overview) {
    return (
      <OverviewTab
        pdfCaptureMode
        snapshot={overview}
        sourceSnapshots={sourceSnapshots || {}}
        currentPeriod={period}
        complaintRecords={complaintRecords || []}
        orderVolumes={orderVolumes || []}
        feedbacks={feedbacks || []}
      />
    )
  }

  if (isTicketSource(scope) && sourceSnapshot) {
    return (
      <TicketDashboardView
        pdfCaptureMode
        snapshot={sourceSnapshot}
        sourceLabel={DATA_SOURCE_LABELS[scope] || scope}
      />
    )
  }

  if (scope === 'post_use_rating' && sourceSnapshot) {
    return (
      <PostUseRatingDashboardView
        snapshot={sourceSnapshot}
        sourceLabel={DATA_SOURCE_LABELS.post_use_rating}
      />
    )
  }

  if (DATA_SOURCE_TYPES.includes(scope) && sourceSnapshot) {
    return (
      <div className="rounded-lg bg-white p-4 text-sm text-gray-500">
        {DATA_SOURCE_LABELS[scope] || scope} · 周期 {period?.label || '—'}
      </div>
    )
  }

  return null
}
