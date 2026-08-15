import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Col, Collapse, Empty, Row, Tag, Typography, Alert } from 'antd'
import JourneyFlowChart from './charts/JourneyFlowChart.jsx'
import JourneyViz from './charts/JourneyViz.jsx'
import { buildJourneyInsights, journeyChartData } from '../lib/journeyInsights.js'
import { resolveJourneyClusterViewForDisplay } from '../lib/painPointClustering/index.js'
import { isNegativeSentiment } from '../lib/sentiment.js'
import { buildWorkbenchAnalysisUrl } from '../lib/workbenchAnalysisLink.js'
import { buildFeedbacksTicketFilterHref } from '../lib/feedbackFilters.js'

/**
 * @param {string[]} recordIds
 * @param {import('../lib/types.js').FeedbackRecord[]} items
 * @param {import('../domain/enums.js').DataSourceType} [dataSourceType]
 */
function buildClusterFeedbacksHref(recordIds, items, dataSourceType) {
  const ticketIds = []
  const seen = new Set()
  for (const id of recordIds) {
    const record = items.find((fb) => fb.id === id)
    if (record?.ticketId && !seen.has(record.ticketId)) {
      seen.add(record.ticketId)
      ticketIds.push(record.ticketId)
    }
  }
  if (!ticketIds.length) return null
  const params = new URLSearchParams()
  params.set('ticketIds', ticketIds.slice(0, 30).join(','))
  if (dataSourceType) params.set('source', dataSourceType)
  return `/feedbacks?${params.toString()}`
}

/**
 * @param {{
 *   items: import('../lib/types.js').FeedbackRecord[];
 *   taxonomy: { journeys: import('../lib/productTaxonomy.js').JourneyL1[]; name?: string };
 *   productName?: string;
 *   dataSourceType?: import('../domain/enums.js').DataSourceType;
 *   painPointClustering?: import('../lib/painPointClustering/buildSourceClusterSnapshot.js').SourcePainPointClusterSnapshot | null;
 *   journeySel: { l1?: string; l2?: string };
 *   onJourneySelect: (l1: string, l2?: string) => void;
 * }}
 */
export default function JourneyFeedbackSection({
  items,
  taxonomy,
  productName,
  dataSourceType,
  painPointClustering,
  journeySel,
  onJourneySelect,
}) {
  const baseStages = useMemo(
    () => buildJourneyInsights(items, taxonomy.journeys),
    [items, taxonomy],
  )

  const chartData = useMemo(() => journeyChartData(baseStages), [baseStages])

  const [activeL1, setActiveL1] = useState(journeySel.l1 || baseStages[0]?.l1)
  const [activeL2, setActiveL2] = useState(journeySel.l2)

  useEffect(() => {
    if (journeySel.l1) {
      setActiveL1(journeySel.l1)
      setActiveL2(journeySel.l2)
    } else if (baseStages[0]?.l1) {
      setActiveL1(baseStages[0].l1)
      setActiveL2(undefined)
    }
  }, [journeySel.l1, journeySel.l2, baseStages])

  const currentStage = baseStages.find((s) => s.l1 === activeL1) || baseStages[0]
  const currentChild = activeL2
    ? currentStage?.children.find((c) => c.l2 === activeL2)
    : undefined
  const viewingL1Summary = Boolean(activeL1 && !activeL2)

  const segmentItems = useMemo(() => {
    if (!activeL1) return []
    return items.filter((fb) => {
      if (fb.journeyL1 !== activeL1) return false
      if (activeL2 && fb.journeyL2 !== activeL2) return false
      return true
    })
  }, [items, activeL1, activeL2])

  const clusterView = useMemo(() => {
    const product = productName || taxonomy.name
    if (!product || !activeL1 || !segmentItems.length) return null
    return resolveJourneyClusterViewForDisplay({
      painPointClustering,
      records: items,
      product,
      dataSourceType,
      journeyL1: activeL1,
      journeyL2: activeL2 || undefined,
    })
  }, [
    items,
    painPointClustering,
    productName,
    taxonomy.name,
    dataSourceType,
    activeL1,
    activeL2,
    segmentItems.length,
  ])

  const clusteringFromSnapshot = clusterView?.clusterSource === 'snapshot'
  const clusteringFrequencyFallback = clusterView?.clusterSource === 'frequency_fallback'

  const segmentCount = currentChild?.count ?? (viewingL1Summary ? segmentItems.length : 0)
  const segmentNegativePct =
    currentChild?.negativePct ??
    (viewingL1Summary && segmentItems.length
      ? Math.round(
          (segmentItems.filter((f) => isNegativeSentiment(f.sentiment)).length / segmentItems.length) *
            100,
        )
      : 0)

  const visibleGroups = clusterView?.groups.filter((g) => g.ticketCount > 0) || []
  const frequencyPainPoints = clusterView?.frequencyPainPoints || []
  const showFrequencyFallback = visibleGroups.length === 0 && frequencyPainPoints.length > 0
  const painPointRows = showFrequencyFallback
    ? frequencyPainPoints
    : visibleGroups.map((g) => ({
        key: g.id,
        painPoint: g.representativePainPoint,
        ticketCount: g.ticketCount,
        problemType: g.problemType,
        recordIds: g.recordIds,
        isCluster: true,
      }))

  const handleSelectL1 = (l1) => {
    setActiveL1(l1)
    setActiveL2(undefined)
    onJourneySelect(l1, undefined)
  }

  const handleSelectL2 = (l1, l2) => {
    setActiveL1(l1)
    setActiveL2(l2)
    onJourneySelect(l1, l2)
  }

  if (!items.length) {
    return (
      <Card title="按旅程环节聚合反馈">
        <Empty description="当前筛选下暂无数据" />
      </Card>
    )
  }

  return (
    <Card
      title={
        <span>
          按旅程环节聚合反馈
          <Typography.Text type="secondary" className="ml-2 text-xs font-normal">
            按一级旅程展示需求痛点聚类 / 高频痛点（非 LLM 优化举措）
          </Typography.Text>
        </span>
      }
      styles={{ body: { maxHeight: 'min(70vh, 640px)', overflow: 'hidden' } }}
    >
      <div className="max-h-[min(70vh,608px)] overflow-y-auto pr-1 lg:overflow-hidden">
        <Row gutter={[24, 24]} className="lg:items-start">
          <Col xs={24} lg={10} className="lg:max-h-[min(70vh,608px)] lg:overflow-y-auto lg:pr-1">
          <Typography.Text strong className="text-xs text-ink-600">
            旅程环节反馈量
          </Typography.Text>
          <div className="mt-2">
            <JourneyFlowChart
              data={chartData}
              selectedL1={activeL1}
              onSelect={handleSelectL1}
            />
          </div>
          <Typography.Text type="secondary" className="mt-3 block text-xs">
            点击柱状图或下方列表切换环节
          </Typography.Text>
          <div className="mt-3 max-h-[280px] overflow-y-auto">
            <JourneyViz
              tree={baseStages.map((s) => ({
                l1: s.l1,
                count: s.count,
                children: s.children.map((c) => ({
                  l2: c.l2,
                  count: c.count,
                  ids: [],
                })),
              }))}
              selected={{ l1: activeL1, l2: activeL2 }}
              onSelect={handleSelectL2}
            />
          </div>
        </Col>

        <Col xs={24} lg={14}>
          {currentStage && (
            <div className="space-y-4 lg:max-h-[min(70vh,608px)] lg:overflow-y-auto lg:pr-1">
              <div>
                <Typography.Title level={5} className="!mb-1">
                  {currentStage.l1}
                  {currentChild ? (
                    <Typography.Text type="secondary" className="ml-2 text-sm font-normal">
                      / {currentChild.l2}
                    </Typography.Text>
                  ) : (
                    <Typography.Text type="secondary" className="ml-2 text-sm font-normal">
                      （一级总览）
                    </Typography.Text>
                  )}
                </Typography.Title>
                {currentStage.description && (
                  <Typography.Paragraph type="secondary" className="!mb-2 !text-xs">
                    {currentStage.description}
                  </Typography.Paragraph>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <Tag>{segmentCount} 条反馈</Tag>
                  <Tag color="red">负面 {segmentNegativePct}%</Tag>
                  <Link
                    to={buildWorkbenchAnalysisUrl({
                      product: productName,
                      source: dataSourceType,
                      journeyL1: activeL1,
                      journeyL2: activeL2 || undefined,
                      tab: 'journey',
                    })}
                    className="text-xs text-indigo-600 hover:underline"
                  >
                    在洞察分析中查看
                  </Link>
                </div>
              </div>

              <Card size="small" className="!border-brand-200 !bg-brand-50/30">
                {clusteringFrequencyFallback && (
                  <Alert
                    type="info"
                    showIcon
                    className="!mb-3"
                    message="聚类数据待刷新"
                    description="当前无有效洞察快照聚类结果，暂按痛点原文频次展示。请在洞察工作台点击「生成 / 刷新洞察」。"
                  />
                )}
                <Typography.Text strong className="text-brand-800 text-xs">
                  {showFrequencyFallback ? '高频痛点' : '痛点群组'}
                  {clusteringFromSnapshot && !showFrequencyFallback ? (
                    <Tag color="blue" className="ml-2 !text-[10px]">
                      快照
                    </Tag>
                  ) : null}
                  {activeL2 ? '（本二级环节）' : '（一级环节）'}
                </Typography.Text>
                <Typography.Paragraph type="secondary" className="!mb-3 !mt-2 !text-[11px]">
                  {showFrequencyFallback
                    ? '语义聚类暂无 ≥2 条群组，按「需求痛点挖掘」原文频次展示 Top 列表。'
                    : activeL2
                      ? '展示各群组在本二级环节内的工单子集；不做 L2 聚类。'
                      : '同一一级环节下语义相近的需求痛点合并为群组；孤立单点见下方折叠区。'}
                </Typography.Paragraph>

                {painPointRows.length > 0 ? (
                  <ul className="space-y-3">
                    {painPointRows.map((row, index) => {
                      const feedbacksHref = buildClusterFeedbacksHref(
                        row.recordIds,
                        items,
                        dataSourceType,
                      )
                      return (
                        <li
                          key={row.key || `${row.painPoint}-${index}`}
                          className="rounded-lg border border-brand-100 bg-white/80 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <Typography.Text strong className="text-sm text-ink-900">
                              {index + 1}. {row.painPoint}
                            </Typography.Text>
                            <div className="flex shrink-0 flex-wrap gap-1">
                              <Tag color="blue">{row.ticketCount} 条</Tag>
                              <Tag>{row.problemType}</Tag>
                              {row.isCluster && <Tag color="purple">语义群组</Tag>}
                            </div>
                          </div>
                          {feedbacksHref && (
                            <Link
                              to={feedbacksHref}
                              className="mt-2 inline-block text-xs text-indigo-600 hover:underline"
                            >
                              查看相关工单
                            </Link>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      activeL2
                        ? '本二级环节下暂无有效「需求痛点挖掘」'
                        : '本一级环节下暂无有效「需求痛点挖掘」；请完成打标后刷新洞察'
                    }
                  />
                )}

                {clusterView && clusterView.isolatedCount > 0 && (
                  <Collapse
                    ghost
                    className="!mt-3"
                    items={[
                      {
                        key: 'isolated',
                        label: (
                          <Typography.Text type="secondary" className="text-xs">
                            未聚类单点 {clusterView.isolatedCount} 条
                          </Typography.Text>
                        ),
                        children: (
                          <ul className="space-y-2 pl-0">
                            {clusterView.isolatedSamples.map((sample) => (
                              <li key={sample.id} className="text-xs text-ink-700">
                                {sample.ticketId ? (
                                  <Link
                                    to={buildFeedbacksTicketFilterHref(sample.ticketId)}
                                    className="text-indigo-600 hover:underline"
                                  >
                                    {sample.ticketId}
                                  </Link>
                                ) : null}
                                {sample.ticketId ? ' · ' : null}
                                {sample.painPoint || '—'}
                              </li>
                            ))}
                            {clusterView.isolatedCount > clusterView.isolatedSamples.length && (
                              <li className="text-xs text-ink-500">
                                另有{' '}
                                {clusterView.isolatedCount - clusterView.isolatedSamples.length}{' '}
                                条未展示
                              </li>
                            )}
                          </ul>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>
            </div>
          )}
        </Col>
        </Row>
      </div>
    </Card>
  )
}
