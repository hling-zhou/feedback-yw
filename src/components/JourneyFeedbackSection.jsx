import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Col, Drawer, Empty, Row, Spin, Tag, Typography } from 'antd'
import SentimentBadge from './SentimentBadge.jsx'
import JourneyFlowChart from './charts/JourneyFlowChart.jsx'
import JourneyViz from './charts/JourneyViz.jsx'
import { useFeedbacks } from '../context/FeedbackContext.jsx'
import { buildJourneyInsights, journeyChartData, topValues } from '../lib/journeyInsights.js'
import { ensureJourneyMeasuresForScope } from '../lib/journeyOptimizationBatch.js'
import {
  buildJourneyMeasuresScopeKey,
  computeJourneyMeasuresFingerprint,
  getSegmentMeasuresFromBundle,
  isJourneyMeasuresScopeReady,
  loadJourneyMeasuresBundle,
  setSegmentMeasuresInBundle,
} from '../lib/journeyOptimizationMeasuresCache.js'
import { generateMeasuresForSegment } from '../lib/journeyOptimizationLLM.js'
import { canUseSemanticMatch } from '../lib/themeSemantic.js'
import { isNegativeSentiment } from '../lib/sentiment.js'

const SOURCE_COLORS = {
  'AI 分析': 'gold',
  工单提炼: 'blue',
  '环节 playbook': 'purple',
  '阶段 playbook': 'geekblue',
  模式识别: 'orange',
  根因归纳: 'cyan',
  类型归纳: 'green',
}

/**
 * @param {{
 *   items: import('../lib/types.js').FeedbackRecord[];
 *   taxonomy: { journeys: import('../lib/productTaxonomy.js').JourneyL1[]; name?: string };
 *   productName?: string;
 *   journeySel: { l1?: string; l2?: string };
 *   onJourneySelect: (l1: string, l2?: string) => void;
 * }}
 */
export default function JourneyFeedbackSection({
  items,
  taxonomy,
  productName,
  journeySel,
  onJourneySelect,
}) {
  const { settings, currentPeriod } = useFeedbacks()
  const baseStages = useMemo(
    () => buildJourneyInsights(items, taxonomy.journeys),
    [items, taxonomy],
  )

  const chartData = useMemo(() => journeyChartData(baseStages), [baseStages])

  const [activeL1, setActiveL1] = useState(journeySel.l1 || baseStages[0]?.l1)
  const [activeL2, setActiveL2] = useState(journeySel.l2)
  const [cacheVersion, setCacheVersion] = useState(0)
  const [periodGenerating, setPeriodGenerating] = useState(false)
  const [periodProgress, setPeriodProgress] = useState('')
  const [segmentRegenerating, setSegmentRegenerating] = useState(false)
  const [llmError, setLlmError] = useState('')
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const periodGenInflightRef = useRef(/** @type {string | null} */ (null))
  const itemsRef = useRef(items)
  itemsRef.current = items

  useEffect(() => {
    if (journeySel.l1) {
      setActiveL1(journeySel.l1)
      setActiveL2(journeySel.l2)
    } else if (baseStages[0]?.l1) {
      setActiveL1(baseStages[0].l1)
      setActiveL2(undefined)
    }
    setDetailDrawerOpen(false)
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

  const scopeKey = useMemo(
    () => buildJourneyMeasuresScopeKey(currentPeriod?.id, productName || taxonomy.name),
    [currentPeriod?.id, productName, taxonomy.name],
  )

  const scopeFingerprint = useMemo(
    () => computeJourneyMeasuresFingerprint(items.map((f) => f.id)),
    [items],
  )

  const segmentItemIds = useMemo(() => segmentItems.map((f) => f.id), [segmentItems])

  const cachedSegmentMeasures = useMemo(() => {
    if (!scopeKey || !activeL1 || !segmentItemIds.length) return null
    return getSegmentMeasuresFromBundle(scopeKey, activeL1, activeL2 || '', segmentItemIds)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cacheVersion bumps after save
  }, [scopeKey, activeL1, activeL2, segmentItemIds, cacheVersion])

  const scopeMeasuresReady = useMemo(
    () => isJourneyMeasuresScopeReady(scopeKey, scopeFingerprint),
    [scopeKey, scopeFingerprint, cacheVersion],
  )

  useEffect(() => {
    if (settings.optimizationMode !== 'llm') return
    if (!canUseSemanticMatch(settings)) return
    if (!currentPeriod?.id || !items.length || !scopeKey) return
    if (isJourneyMeasuresScopeReady(scopeKey, scopeFingerprint)) return

    const inflightKey = `${scopeKey}::${scopeFingerprint}`
    if (periodGenInflightRef.current === inflightKey) return
    periodGenInflightRef.current = inflightKey

    let cancelled = false
    setPeriodGenerating(true)
    setPeriodProgress('正在为本洞察周期生成各旅程举措…')
    setLlmError('')

    void ensureJourneyMeasuresForScope({
      periodId: currentPeriod.id,
      productName: productName || taxonomy.name,
      items: itemsRef.current,
      taxonomy,
      settings,
      onProgress: (msg) => {
        if (!cancelled) setPeriodProgress(msg)
      },
    })
      .then((result) => {
        if (cancelled) return
        if (!result.ok && result.reason === 'no-llm') {
          setLlmError('请由管理员在 API 服务端配置 LLM_API_KEY')
        }
        setCacheVersion((v) => v + 1)
      })
      .catch((e) => {
        if (!cancelled) setLlmError(e.message || '周期举措生成失败')
      })
      .finally(() => {
        if (!cancelled) {
          setPeriodGenerating(false)
          setPeriodProgress('')
        }
        if (periodGenInflightRef.current === inflightKey) {
          periodGenInflightRef.current = null
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    settings.optimizationMode,
    settings,
    currentPeriod?.id,
    scopeKey,
    scopeFingerprint,
    productName,
    taxonomy,
  ])

  const regenerateCurrentSegment = useCallback(async () => {
    if (!activeL1 || !segmentItemIds.length || !scopeKey) return
    if (!canUseSemanticMatch(settings)) {
      setLlmError('请由管理员在 API 服务端配置 LLM_API_KEY，并选择「大模型生成具体举措」')
      return
    }
    setLlmError('')
    setSegmentRegenerating(true)
    try {
      const l1Def = taxonomy.journeys.find((j) => j.label === activeL1)
      const l2Def = l1Def?.children?.find((c) => c.label === activeL2)
      const meta = {
        productName: productName || taxonomy.name,
        l1Desc: l1Def?.description,
        l2Desc: l2Def?.description,
      }

      /** @type {Record<string, { text: string; source: string }[]>} */
      let childMeasuresByL2
      let parentL1Measures

      if (!activeL2) {
        childMeasuresByL2 = {}
        const stage = baseStages.find((s) => s.l1 === activeL1)
        for (const child of stage?.children || []) {
          const childItems = items.filter(
            (fb) => fb.journeyL1 === activeL1 && fb.journeyL2 === child.l2,
          )
          if (!childItems.length) continue
          const existing = getSegmentMeasuresFromBundle(
            scopeKey,
            activeL1,
            child.l2,
            childItems.map((f) => f.id),
          )
          if (existing?.length) {
            childMeasuresByL2[child.l2] = existing
          }
        }
      } else {
        const l1Items = items.filter((fb) => fb.journeyL1 === activeL1)
        parentL1Measures = getSegmentMeasuresFromBundle(
          scopeKey,
          activeL1,
          '',
          l1Items.map((f) => f.id),
        )
      }

      const measures = await generateMeasuresForSegment(
        `${scopeKey}::manual::${activeL1}::${activeL2 || ''}`,
        segmentItems,
        activeL1,
        activeL2 || '',
        meta,
        settings,
        {
          childMeasuresByL2: activeL2 ? undefined : childMeasuresByL2,
          parentL1Measures: activeL2 ? parentL1Measures || undefined : undefined,
        },
      )

      setSegmentMeasuresInBundle(
        scopeKey,
        scopeFingerprint,
        activeL1,
        activeL2 || '',
        segmentItemIds,
        measures,
      )
      setCacheVersion((v) => v + 1)
    } catch (e) {
      setLlmError(e.message || '生成失败')
    } finally {
      setSegmentRegenerating(false)
    }
  }, [
    activeL1,
    activeL2,
    segmentItemIds,
    segmentItems,
    scopeKey,
    scopeFingerprint,
    settings,
    taxonomy,
    productName,
    items,
    baseStages,
  ])

  const displayMeasures = useMemo(() => {
    if (settings.optimizationMode === 'llm' && cachedSegmentMeasures?.length) {
      return cachedSegmentMeasures
    }
    if (viewingL1Summary) {
      return currentStage?.businessMeasures || []
    }
    return currentChild?.businessMeasures || []
  }, [
    settings.optimizationMode,
    cachedSegmentMeasures,
    currentChild,
    currentStage,
    viewingL1Summary,
  ])

  const detailFeedbackSamples = useMemo(() => {
    if (currentChild?.feedbackSamples?.length) return currentChild.feedbackSamples
    if (!viewingL1Summary) return []
    return segmentItems.slice(0, 5).map((fb) => ({
      id: fb.id,
      ticketId: fb.ticketId,
      problemSummary: fb.problemSummary || fb.customerQuote,
      sentiment: fb.sentiment,
    }))
  }, [currentChild, viewingL1Summary, segmentItems])

  const detailTicketResponses = useMemo(() => {
    if (currentChild?.ticketResponses?.length) return currentChild.ticketResponses
    if (!viewingL1Summary) return []
    return topValues(segmentItems, 'solutionSummary')
  }, [currentChild, viewingL1Summary, segmentItems])

  const detailRootCauses = useMemo(() => {
    if (currentChild?.rootCauses?.length) return currentChild.rootCauses
    if (!viewingL1Summary) return []
    return topValues(segmentItems, 'rootCause')
  }, [currentChild, viewingL1Summary, segmentItems])

  const segmentCount = currentChild?.count ?? (viewingL1Summary ? segmentItems.length : 0)
  const segmentNegativePct =
    currentChild?.negativePct ??
    (viewingL1Summary && segmentItems.length
      ? Math.round(
          (segmentItems.filter((f) => isNegativeSentiment(f.sentiment)).length / segmentItems.length) *
            100,
        )
      : 0)

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
      <Card title="用户旅程 · 客户反馈与业务优化">
        <Empty description="当前筛选下暂无数据" />
      </Card>
    )
  }

  return (
    <Card
      title={
        <span>
          用户旅程 · 客户反馈与业务优化
          <Typography.Text type="secondary" className="ml-2 text-xs font-normal">
            按旅程环节聚合反馈；优化举措由 AI 结合业务归纳（非工单回单复述）
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
                  <Button
                    type="link"
                    size="small"
                    className="!px-0"
                    onClick={() => setDetailDrawerOpen(true)}
                  >
                    查看反馈与回单
                  </Button>
                </div>
              </div>

              <Card size="small" className="!border-brand-200 !bg-brand-50/30">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Typography.Text strong className="text-brand-800 text-xs">
                    业务优化举措（{viewingL1Summary ? '一级总领 · 总' : '二级具体 · 分'}）
                  </Typography.Text>
                  {settings.optimizationMode === 'llm' && (
                    <Button
                      size="small"
                      loading={segmentRegenerating}
                      onClick={() => void regenerateCurrentSegment()}
                      disabled={!canUseSemanticMatch(settings) || periodGenerating}
                    >
                      {cachedSegmentMeasures?.length ? '重新生成' : '生成本环节举措'}
                    </Button>
                  )}
                </div>

                {settings.optimizationMode === 'llm' && !canUseSemanticMatch(settings) && (
                  <Alert
                    type="warning"
                    showIcon
                    className="!mt-2"
                    title="请由管理员在 API 服务端配置 LLM_API_KEY 以生成具体优化举措"
                  />
                )}
                {llmError && (
                  <Alert type="error" showIcon className="!mt-2" title={llmError} />
                )}

                <Typography.Paragraph type="secondary" className="!mb-3 !mt-2 !text-[11px]">
                  {settings.optimizationMode === 'llm'
                    ? viewingL1Summary
                      ? '一级举措为总：涵盖覆盖各二级具体方向并保持可执行性；另可补充跨二级综合举措（多环节交叉启发）'
                      : '二级举措为分：针对本环节具体落地，表述完整以便一级汇总覆盖'
                    : '当前为本地规则模式，建议在设置中切换为「大模型生成」以获得更具体的举措'}
                </Typography.Paragraph>

                {periodGenerating ? (
                  <div className="py-6 text-center">
                    <Spin description={periodProgress || '正在为本周期各旅程生成举措…'} />
                    <Typography.Text type="secondary" className="mt-2 block text-xs">
                      生成完成后切换环节将直接展示缓存，不会重复调用大模型
                    </Typography.Text>
                  </div>
                ) : segmentRegenerating ? (
                  <div className="py-6 text-center">
                    <Spin
                      description={
                        viewingL1Summary
                          ? '正在重新生成本一级总领举措…'
                          : '正在重新生成本二级举措…'
                      }
                    />
                  </div>
                ) : displayMeasures.length > 0 ? (
                  <ul className="space-y-2">
                    {displayMeasures.map((m, i) => (
                      <li key={i} className="flex gap-2 text-sm text-ink-800">
                        <span className="shrink-0 font-semibold text-brand-600">{i + 1}.</span>
                        <span>
                          {m.text}
                          <Tag
                            className="!ml-2 !text-[10px]"
                            color={SOURCE_COLORS[m.source] || 'default'}
                          >
                            {m.source}
                          </Tag>
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={
                      scopeMeasuresReady
                        ? '本环节暂无举措，可点击「生成本环节举措」'
                        : '等待本周期举措生成完成，或点击「生成本环节举措」'
                    }
                  />
                )}
              </Card>

              <Drawer
                title={
                  <span>
                    {currentStage.l1}
                    {currentChild && (
                      <Typography.Text type="secondary" className="ml-2 text-sm font-normal">
                        / {currentChild.l2}
                      </Typography.Text>
                    )}
                  </span>
                }
                placement="right"
                size={480}
                open={detailDrawerOpen}
                onClose={() => setDetailDrawerOpen(false)}
                destroyOnClose
              >
                <Typography.Text strong className="text-xs text-ink-600">
                  客户反馈摘要
                </Typography.Text>
                <ul className="mt-2 space-y-2 text-xs text-ink-700">
                  {detailFeedbackSamples.map((fb) => (
                    <li key={fb.id} className="rounded border border-ink-100 p-2">
                      <SentimentBadge sentiment={fb.sentiment} />
                      <p className="mt-1">{fb.problemSummary}</p>
                      <p className="mt-1 text-ink-400">{fb.ticketId}</p>
                    </li>
                  ))}
                  {!detailFeedbackSamples.length && (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无样本" />
                  )}
                </ul>

                <Typography.Text strong className="mt-6 block text-xs text-ink-600">
                  工单回单参考（非优化结论）
                </Typography.Text>
                <ul className="mt-2 space-y-1 text-xs text-ink-500">
                  {detailTicketResponses.map((r) => (
                    <li key={r.text}>
                      <Tag className="mr-1">{r.count}</Tag>
                      {r.text}
                    </li>
                  ))}
                  {!detailTicketResponses.length && (
                    <Typography.Text type="secondary">暂无回单摘要</Typography.Text>
                  )}
                </ul>

                {detailRootCauses.length > 0 && (
                  <>
                    <Typography.Text strong className="mt-6 block text-xs text-ink-600">
                      高频根因（已过滤「待分析」）
                    </Typography.Text>
                    <ul className="mt-2 space-y-1 text-xs text-ink-500">
                      {detailRootCauses.map((r) => (
                        <li key={r.text}>
                          <Tag>{r.count}</Tag> {r.text}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </Drawer>
            </div>
          )}
        </Col>
      </Row>
    </Card>
  )
}
