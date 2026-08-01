import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Select, Space, Tag, Typography, message } from 'antd'
import { useInsights } from '../../context/InsightsContext.jsx'
import { workbenchTicketRecords } from '../../snapshots/recordScope.js'
import { filterFeedbacks } from '../../lib/productAnalytics.js'
import { listProducts } from '../../lib/productTaxonomy.js'
import { filterRecordsByImportMonths, resolveTrendMonthWindow } from '../../lib/workbenchTrendWindow.js'
import { prepareOverviewConclusionsForDisplay } from '../../snapshots/rehydrateOverviewRecommendations.js'
import { OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE } from '../../snapshots/rehydrateOverviewRecommendations.js'
import { buildTicketStoryModel } from '../../lib/ticketStoryModel.js'
import { createActionItem, listActionItems } from '../../lib/actionItemClient.js'
import TicketStoryView from './TicketStoryView.jsx'

function resolveDriversEmptyState({
  sourceLabel,
  conclusions,
  recommendationsPendingRefresh,
  product,
  allRecommendations,
  filteredRecommendations,
}) {
  if ((filteredRecommendations || []).length > 0) return null

  if (recommendationsPendingRefresh) {
    return {
      kind: 'pending_refresh',
      alertType: 'warning',
      title: '当前快照待刷新',
      description: '当前快照未包含可展示的 V2 痛点聚类结果，请先点击「生成 / 刷新洞察」后再查看。',
    }
  }

  if (conclusions?.insufficientData) {
    return {
      kind: 'insufficient_data',
      alertType: 'info',
      title: '当前范围样本不足',
      description:
        conclusions.dataCoverageNotes?.[0] ||
        `${sourceLabel}当前范围样本不足，暂不生成典型问题。`,
    }
  }

  if (product && (allRecommendations || []).length > 0) {
    return {
      kind: 'product_empty',
      alertType: 'info',
      title: '当前产品暂无结果',
      description: `已切换到「${product}」，但该产品在当前周期未形成正式痛点聚类或小样本参考项，可切回“全部产品”查看整体结果。`,
    }
  }

  if (conclusions?.dataCoverageNotes?.includes(OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE)) {
    return {
      kind: 'no_top10',
      alertType: 'info',
      title: '本期未形成痛点聚类 Top 10',
      description: OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE,
    }
  }

  return {
    kind: 'no_top10',
    alertType: 'info',
    title: '当前范围暂无可展示结果',
    description: '当前范围未形成可展示的正式痛点聚类或小样本参考项。',
  }
}

export default function TicketDashboardView({
  snapshot,
  sourceLabel,
  product: productProp,
  onProductChange,
  onOpenFeedback,
}) {
  const { feedbacks, currentPeriod, orderVolumes, wanTouTargets, adapter } = useInsights()
  const [productLocal, setProductLocal] = useState(productProp || '')
  const [actions, setActions] = useState([])
  const [creatingInsightId, setCreatingInsightId] = useState('')
  const controlled = onProductChange != null
  const product = controlled ? productProp || '' : productLocal
  const sourceType = snapshot.dataSourceType
  const periodRecords = useMemo(() => workbenchTicketRecords(feedbacks, currentPeriod, snapshot), [feedbacks, currentPeriod, snapshot])
  const products = useMemo(() => listProducts(periodRecords), [periodRecords])
  const sourceAllRecords = useMemo(() => feedbacks.filter((record) => (record.dataSourceType || 'complaint_ticket') === sourceType), [feedbacks, sourceType])
  const trendWindow = useMemo(() => resolveTrendMonthWindow(currentPeriod), [currentPeriod])
  const records = useMemo(() => filterFeedbacks(periodRecords, { product: product || undefined }), [periodRecords, product])
  const trendRecords = useMemo(() => filterFeedbacks(filterRecordsByImportMonths(sourceAllRecords, trendWindow.months), { product: product || undefined }), [sourceAllRecords, trendWindow.months, product])

  useEffect(() => {
    if (!adapter) return
    let cancelled = false
    listActionItems({ linkedDataSources: sourceType, limit: 500 })
      .then((result) => { if (!cancelled) setActions(result.items || []) })
      .catch(() => { if (!cancelled) setActions([]) })
    return () => { cancelled = true }
  }, [adapter, sourceType])

  useEffect(() => {
    if (product && !products.some((item) => item.name === product)) {
      if (controlled) onProductChange?.('')
      else setProductLocal('')
    }
  }, [product, products, controlled, onProductChange])

  const setProduct = useCallback((value) => {
    if (controlled) onProductChange?.(value || '')
    else setProductLocal(value || '')
  }, [controlled, onProductChange])

  const { conclusions, recommendationsPendingRefresh } = useMemo(
    () => prepareOverviewConclusionsForDisplay(snapshot?.aggregates?.planningConclusions),
    [snapshot?.aggregates?.planningConclusions],
  )
  const allRecommendations = conclusions?.recommendations || []
  const recommendations = useMemo(
    () => allRecommendations.filter((item) => !product || item.scope?.product === product),
    [allRecommendations, product],
  )
  const driversEmptyState = useMemo(
    () =>
      resolveDriversEmptyState({
        sourceLabel,
        conclusions,
        recommendationsPendingRefresh,
        product,
        allRecommendations,
        filteredRecommendations: recommendations,
      }),
    [
      sourceLabel,
      conclusions,
      recommendationsPendingRefresh,
      product,
      allRecommendations,
      recommendations,
    ],
  )
  const model = useMemo(() => buildTicketStoryModel({
    sourceType,
    sourceLabel,
    periodLabel: currentPeriod?.label || '当前范围',
    records,
    trendRecords,
    trendMonths: trendWindow.months,
    snapshot,
    recommendations,
    actions,
    orderVolumes,
    wanTouTargets,
    baselineYear: trendWindow.baselineYear,
    selectedProduct: product,
    periodEndMonth: String(currentPeriod?.endDate || '').slice(0, 7),
    driversEmptyState,
  }), [sourceType, sourceLabel, currentPeriod?.label, currentPeriod?.endDate, records, trendRecords, trendWindow.months, trendWindow.baselineYear, snapshot, recommendations, actions, orderVolumes, wanTouTargets, product, driversEmptyState])

  const createAction = async (row) => {
    setCreatingInsightId(row.insightId)
    try {
      const created = await createActionItem({
        content: `改善「${row.pain}」相关问题`,
        detail: `${row.ticketCount} 条工单证据；${row.basis}`,
        productName: row.product,
        status: 'pending_evaluation',
        painPointSnapshot: row.pain,
        problemTypeSnapshot: row.evidence[0]?.problemType || '',
        journeyL1Snapshot: row.evidence[0]?.journeyL1 || '',
        journeyL2Snapshot: row.evidence[0]?.journeyL2 || '',
        linkedTicketIds: row.evidence.map((record) => record.ticketId).filter(Boolean),
        linkedDataSources: [sourceType],
        linkedInsightIds: row.insightIds?.length ? row.insightIds : [row.insightId],
        evidenceRecordIds: row.evidenceIds,
        insightTheme: row.pain,
        firstProposedAt: new Date().toISOString().slice(0, 10),
      })
      setActions((items) => [created, ...items])
      message.success('已创建举措并关联问题证据')
    } catch (error) {
      message.error(error?.message || '创建举措失败')
    } finally {
      setCreatingInsightId('')
    }
  }

  if (!periodRecords.length) return <Card><Typography.Text type="secondary">当前周期内暂无「{sourceLabel}」数据，请先导入。</Typography.Text></Card>

  return (
    <div className="space-y-4">
      <Card size="small" title={`${sourceLabel}综合分析`}>
        <Space size={[8, 8]} wrap>
          <Typography.Text strong>产品</Typography.Text>
          <Select showSearch optionFilterProp="label" className="min-w-[220px]" value={product} options={[{ value: '', label: `全部产品 (${periodRecords.length})` }, ...products.map((item) => ({ value: item.name, label: `${item.name} (${item.count})` }))]} onChange={setProduct} />
          <Tag color="blue">当前范围：{model.scope.periodLabel}</Tag>
          <Tag>产品 {model.scope.productCount}</Tag>
          <Tag>有效工单 {model.scope.total}</Tag>
          <Tag color={model.scope.qualityWarningCount ? 'gold' : 'green'}>{model.scope.qualityStatus}</Tag>
          <Tag>聚类 {model.scope.clusteringVersion}</Tag>
        </Space>
      </Card>
      {model.scope.qualityWarningCount ? <Alert type="warning" showIcon title={`当前范围有 ${model.scope.qualityWarningCount} 项数据质量或快照问题`} action={<Button type="link" href="#ticket-appendix">查看附录</Button>} /> : null}
      <TicketStoryView model={model} creatingInsightId={creatingInsightId} onCreateAction={(row) => void createAction(row)} onOpenFeedback={onOpenFeedback} />
    </div>
  )
}
