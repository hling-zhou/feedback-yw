import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Card, Col, Collapse, Empty, Row, Tag, Typography } from 'antd'
import JourneyFlowChart from './charts/JourneyFlowChart.jsx'
import JourneyViz from './charts/JourneyViz.jsx'
import { buildJourneyInsights, journeyChartData } from '../lib/journeyInsights.js'
import { buildJourneyClusterView } from '../lib/painPointClustering/index.js'
import { isNegativeSentiment } from '../lib/sentiment.js'
import { buildWorkbenchAnalysisUrl } from '../lib/workbenchAnalysisLink.js'

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
 *   journeySel: { l1?: string; l2?: string };
 *   onJourneySelect: (l1: string, l2?: string) => void;
 * }}
 */
export default function JourneyFeedbackSection({
  items,
  taxonomy,
  productName,
  dataSourceType,
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
    return buildJourneyClusterView({
      records: items,
      product,
      dataSourceType,
      journeyL1: activeL1,
      journeyL2: activeL2 || undefined,
    })
  }, [items, productName, taxonomy.name, dataSourceType, activeL1, activeL2, segmentItems.length])

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
      <Card title="用户旅程 · 痛点聚类">
        <Empty description="当前筛选下暂无数据" />
      </Card>
    )
  }

  return (
    <Card
      title={
        <span>
          用户旅程 · 痛点聚类
          <Typography.Text type="secondary" className="ml-2 text-xs font-normal">
            按产品 + 数据来源 + 一级环节 Jaccard 一次聚类（阈值 0.35，≥2 条成组）
          </Typography.Text>
        </span>
      }
    >
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={10}>
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
            <div className="space-y-4">
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
                <Typography.Text strong className="text-brand-800 text-xs">
                  痛点群组
                  {activeL2 ? '（本二级环节子集）' : '（一级环节）'}
                </Typography.Text>
                <Typography.Paragraph type="secondary" className="!mb-3 !mt-2 !text-[11px]">
                  {activeL2
                    ? '展示各群组在本二级环节内的工单子集；不做 L2 聚类。'
                    : '同一一级环节下语义相近的需求痛点合并为群组；孤立单点见下方折叠区。'}
                </Typography.Paragraph>

                {visibleGroups.length > 0 ? (
                  <ul className="space-y-3">
                    {visibleGroups.map((group, index) => {
                      const feedbacksHref = buildClusterFeedbacksHref(
                        group.recordIds,
                        items,
                        dataSourceType,
                      )
                      return (
                        <li
                          key={group.id}
                          className="rounded-lg border border-brand-100 bg-white/80 p-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <Typography.Text strong className="text-sm text-ink-900">
                              {index + 1}. {group.representativePainPoint}
                            </Typography.Text>
                            <div className="flex shrink-0 flex-wrap gap-1">
                              <Tag color="blue">{group.ticketCount} 条</Tag>
                              <Tag>{group.problemType}</Tag>
                            </div>
                          </div>
                          {feedbacksHref && (
                            <Link
                              to={feedbacksHref}
                              className="mt-2 inline-block text-xs text-indigo-600 hover:underline"
                            >
                              查看群组工单
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
                        ? '本二级环节下暂无 ≥2 条的痛点群组'
                        : '本一级环节下暂无 ≥2 条的痛点群组'
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
                                    to={`/feedbacks?ticketId=${encodeURIComponent(sample.ticketId)}`}
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
    </Card>
  )
}
