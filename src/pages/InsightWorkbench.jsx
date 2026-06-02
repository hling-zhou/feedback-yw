import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Alert, Button, Card, Empty, Space, Spin, Typography } from 'antd'
import { useInsights } from '../context/InsightsContext.jsx'
import { PageHeader } from './Dashboard.shared.jsx'
import OverviewTab from '../components/workbench/OverviewTab.jsx'
import TicketDashboardView from '../components/workbench/TicketDashboardView.jsx'
import SourcePlaceholderTab from '../components/workbench/SourcePlaceholderTab.jsx'
import PostUseRatingDashboardView from '../components/workbench/PostUseRatingDashboardView.jsx'
import WorkbenchSourceEmpty from '../components/workbench/WorkbenchSourceEmpty.jsx'
import RebuildInsightsButton from '../components/workbench/RebuildInsightsButton.jsx'
import { IMPORT_REBUILD_DISABLED_TIP } from '../lib/importSession.js'
import { RETAG_REBUILD_DISABLED_TIP } from '../lib/retagSession.js'
import { useSharedBackgroundTaskBlock } from '../hooks/useSharedBackgroundTaskBlock.js'
import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { isTicketSource } from '../lib/importUtils.js'
import ExportPdfMenu from '../components/ExportPdfMenu.jsx'
import { PdfExportProvider } from '../context/PdfExportContext.jsx'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import WorkbenchAnalysisNav from '../components/workbench/WorkbenchAnalysisNav.jsx'
import WorkbenchAnalysisLink from '../components/workbench/WorkbenchAnalysisLink.jsx'
import {
  resolveSnapshotRecords,
  workbenchSourceHasContent,
} from '../snapshots/recordScope.js'
import FeedbackDrawer from '../components/FeedbackDrawer.jsx'
import { ensurePdfFontsReady } from '../lib/report/registerPdfFonts.js'
import {
  formatInsightRebuildButtonLabel,
  formatInsightRebuildSpinDescription,
} from '../lib/insightRebuildClient.js'
import { isApiStorageAdapter } from '../storage/feedbackStore.js'

const TAB_OVERVIEW = 'overview'

export default function InsightWorkbench() {
  const {
    feedbacks,
    currentPeriod,
    sourceSnapshots,
    overviewSnapshot,
    snapshotsStale,
    snapshotStaleReason,
    snapshotRebuilding,
    rebuildAllSnapshots,
    importSession,
    orderVolumes,
    adapter,
  } = useInsights()
  const insightRebuildOnServer = isApiStorageAdapter(adapter)
  const { rebuildBlocked, rebuildBlockedTip, localImport, localRetag } = useSharedBackgroundTaskBlock()

  const rebuildDisabled = rebuildBlocked
  const rebuildDisabledTip = localRetag
    ? RETAG_REBUILD_DISABLED_TIP
    : localImport
      ? IMPORT_REBUILD_DISABLED_TIP
      : rebuildBlockedTip

  const complaintRecords = useMemo(
    () => resolveSnapshotRecords(feedbacks, sourceSnapshots.complaint_ticket),
    [feedbacks, sourceSnapshots.complaint_ticket],
  )

  const [searchParams] = useSearchParams()
  const [activeTab, setActiveTab] = useState(() => {
    const tab = searchParams.get('tab')
    if (tab && (tab === TAB_OVERVIEW || DATA_SOURCE_TYPES.includes(tab))) return tab
    return TAB_OVERVIEW
  })
  const [ticketProduct, setTicketProduct] = useState('')
  const [selectedFeedback, setSelectedFeedback] = useState(
    /** @type {import('../lib/types.js').FeedbackRecord | null} */ (null),
  )

  useEffect(() => {
    const tab = searchParams.get('tab')
    if (tab && (tab === TAB_OVERVIEW || DATA_SOURCE_TYPES.includes(tab))) {
      setActiveTab(tab)
    }
  }, [searchParams])

  useEffect(() => {
    if (!isTicketSource(activeTab)) {
      setTicketProduct('')
    }
  }, [activeTab])

  const analysisContext = useMemo(() => {
    if (activeTab === TAB_OVERVIEW) return {}
    return {
      source: activeTab,
      product: isTicketSource(activeTab) ? ticketProduct || undefined : undefined,
    }
  }, [activeTab, ticketProduct])

  const overviewDisplay = overviewSnapshot
  const showStaleBanner =
    !snapshotRebuilding &&
    (snapshotsStale ||
      overviewDisplay?.status === 'stale' ||
      Object.values(sourceSnapshots).some((s) => s?.status === 'stale'))

  const staleDescription =
    snapshotStaleReason === 'period'
      ? '已切换洞察周期，当前周期的洞察快照尚未生成或已过期。系统会自动尝试刷新；也可手动点击「生成 / 刷新洞察」。'
      : '反馈数据或打标结果已变更，快照与当前数据不一致。系统会自动尝试刷新；也可手动点击「生成 / 刷新洞察」。'

  useEffect(() => {
    ensurePdfFontsReady().catch(() => {})
  }, [])

  const activeTabContent = useMemo(() => {
    if (activeTab === TAB_OVERVIEW) {
      return (
        <OverviewTab
          snapshot={overviewDisplay}
          sourceSnapshots={sourceSnapshots}
          onSourceTab={(type) => setActiveTab(type)}
          currentPeriod={currentPeriod}
          complaintRecords={complaintRecords}
          orderVolumes={orderVolumes}
          onRebuildSnapshots={rebuildAllSnapshots}
          snapshotRebuilding={snapshotRebuilding}
          rebuildDisabled={rebuildDisabled}
          feedbacks={feedbacks}
          onOpenFeedback={setSelectedFeedback}
        />
      )
    }

    const snap = sourceSnapshots[activeTab]
    const label = DATA_SOURCE_LABELS[activeTab]

    if (isTicketSource(activeTab)) {
      if (snap && workbenchSourceHasContent(feedbacks, currentPeriod, snap)) {
        return (
          <TicketDashboardView
            snapshot={snap}
            sourceLabel={label}
            product={ticketProduct}
            onProductChange={setTicketProduct}
          />
        )
      }
      return (
        <WorkbenchSourceEmpty
          sourceType={activeTab}
          sourceLabel={label}
          feedbacks={feedbacks}
          currentPeriod={currentPeriod}
          onRebuild={rebuildAllSnapshots}
          rebuilding={snapshotRebuilding}
          rebuildDisabled={rebuildDisabled}
        />
      )
    }

    if (activeTab === 'post_use_rating') {
      if (snap && workbenchSourceHasContent(feedbacks, currentPeriod, snap)) {
        return <PostUseRatingDashboardView snapshot={snap} sourceLabel={label} />
      }
      return (
        <WorkbenchSourceEmpty
          sourceType={activeTab}
          sourceLabel={label}
          feedbacks={feedbacks}
          currentPeriod={currentPeriod}
          onRebuild={rebuildAllSnapshots}
          rebuilding={snapshotRebuilding}
          rebuildDisabled={rebuildDisabled}
        />
      )
    }

    return (
      <SourcePlaceholderTab
        sourceLabel={label}
        dataSourceType={activeTab}
        snapshot={snap || null}
      />
    )
  }, [
    activeTab,
    sourceSnapshots,
    overviewDisplay,
    currentPeriod,
    complaintRecords,
    orderVolumes,
    feedbacks,
    snapshotRebuilding,
    rebuildAllSnapshots,
    rebuildDisabled,
    ticketProduct,
  ])

  const hasAnyData = Object.values(sourceSnapshots).some(
    (s) => (s?.summary?.recordCount ?? 0) > 0,
  )

  return (
    <PdfExportProvider>
    <div id="insight-workbench-root">
      <PageHeader
        title="洞察工作台"
        desc="按洞察周期（数据时间）筛选并查看多来源快照；同一份导入数据可切换不同月/季/年周期"
      />

      <div className="page-toolbar page-toolbar-nowrap !items-center !justify-between gap-2">
        <InsightPeriodPicker compact showHint={false} className="min-w-0 flex-1" />
        <Space className="mb-0 shrink-0" wrap size="small">
          <RebuildInsightsButton
            loading={Boolean(snapshotRebuilding)}
            disabled={rebuildDisabled}
            disabledTip={rebuildDisabledTip}
            onClick={() => rebuildAllSnapshots()}
          >
            {formatInsightRebuildButtonLabel(snapshotRebuilding)}
          </RebuildInsightsButton>
          <ExportPdfMenu activeSource={activeTab === TAB_OVERVIEW ? undefined : activeTab} />
          <Link to="/tags?tab=review">
            <Button>标签管理</Button>
          </Link>
          <WorkbenchAnalysisLink
            source={analysisContext.source}
            product={analysisContext.product}
          />
        </Space>
      </div>

      {showStaleBanner && (
        <Alert
          className="page-section-sm"
          type="warning"
          showIcon
          title="洞察快照已过期"
          description={staleDescription}
          action={
            <RebuildInsightsButton
              size="small"
              type="default"
              loading={Boolean(snapshotRebuilding)}
              disabled={rebuildDisabled}
              disabledTip={rebuildDisabledTip}
              onClick={() => rebuildAllSnapshots()}
            >
              立即更新
            </RebuildInsightsButton>
          }
        />
      )}

      {!hasAnyData && !snapshotRebuilding && (
        <Card className="page-section">
          <Empty description="当前周期尚无反馈数据">
            <Link to="/import">
              <Button type="primary">导入数据</Button>
            </Link>
          </Empty>
        </Card>
      )}

      {(hasAnyData || snapshotRebuilding || overviewDisplay) && (
        <Spin
          spinning={Boolean(snapshotRebuilding)}
          description={formatInsightRebuildSpinDescription(snapshotRebuilding, {
            serverJob: insightRebuildOnServer,
          })}
          className="page-section block"
        >
          <WorkbenchAnalysisNav
            activeSourceTab={activeTab}
            onSourceTabChange={setActiveTab}
          />
          <div key={activeTab} data-workbench-tab={activeTab}>
            {activeTabContent}
          </div>
        </Spin>
      )}

      <FeedbackDrawer feedback={selectedFeedback} onClose={() => setSelectedFeedback(null)} />
    </div>
    </PdfExportProvider>
  )
}
