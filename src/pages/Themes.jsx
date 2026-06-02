import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Button, Card, Empty, Select, Space, Spin, Tag, Tooltip, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { useFeedbacks } from '../context/FeedbackContext.jsx'
import { usePeriodScope } from '../hooks/usePeriodScope.js'
import AnalysisPageHeader from '../components/workbench/AnalysisPageHeader.jsx'
import WorkbenchTabNav from '../components/workbench/WorkbenchTabNav.jsx'
import InsightPeriodPicker from '../components/InsightPeriodPicker.jsx'
import ThemeBarChart from '../components/charts/ThemeBarChart.jsx'
import KeywordWordCloud from '../components/charts/KeywordWordCloud.jsx'
import InsightFeedbackList from '../components/InsightFeedbackList.jsx'
import FeedbackDrawer from '../components/FeedbackDrawer.jsx'
import SentimentDistributionPanel from '../components/SentimentDistributionPanel.jsx'
import { listProducts, listResourcePools } from '../lib/productTaxonomy.js'
import {
  aggregateComplaintCauseL1Insights,
  getComplaintCauseL1Display,
} from '../domain/complaintCause.js'
import {
  aggregateFieldInsights,
  filterFeedbacks,
  journeyTree,
} from '../lib/productAnalytics.js'
import { collectTopKeywords, topKeywordsAsync } from '../lib/themes.js'
import { canUseSemanticMatch } from '../lib/themeSemantic.js'
import PermissionGate from '../components/auth/PermissionGate.jsx'
import { exportTicketAnalysisWithConfirm } from '../lib/ticketAnalysisExport.js'
import { RETAG_IN_PROGRESS_TIP } from '../lib/retagSession.js'
import { IMPORT_REBUILD_DISABLED_TIP } from '../lib/importSession.js'
import { useBulkRetagModal } from '../hooks/useBulkRetagModal.jsx'
import { useSharedBackgroundTaskBlock } from '../hooks/useSharedBackgroundTaskBlock.js'
import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'
import { filterRecordsForScope } from '../snapshots/recordScope.js'
import {
  parseAnalysisSearchParams,
  patchAnalysisSearchParams,
} from '../lib/workbenchAnalysisLink.js'

/**
 * @param {ReturnType<typeof parseAnalysisSearchParams>} p
 */
function resolveInitialAnalysisTab(p) {
  if (p.tab) return p.tab
  if (p.journeyL1 || p.journeyL2) return 'journey'
  if (p.complaintCauseL1) return 'complaint_cause'
  if (p.problemType) return 'problem'
  if (p.requestScene) return 'request'
  return 'request'
}

/** @param {string} dataSource */
function buildAnalysisTabs(dataSource) {
  const tabs = [{ value: 'request', label: '请求场景' }]
  if (!dataSource || dataSource === 'complaint_ticket') {
    tabs.push({ value: 'complaint_cause', label: '投诉原因（终判）' })
  }
  tabs.push({
    value: 'problem',
    label: dataSource === 'complaint_ticket' ? '问题类型（打标）' : '问题类型',
  })
  tabs.push(
    { value: 'journey', label: '用户旅程' },
    { value: 'sentiment', label: '用户情绪' },
    { value: 'keywords', label: '高频词' },
  )
  return tabs
}

export default function Themes() {
  const { feedbacks, retagSession, importSession, settings } = useFeedbacks()
  const { rebuildBlocked, rebuildBlockedTip } = useSharedBackgroundTaskBlock()
  const { period: currentPeriod, periodFeedbacks, periodCount } = usePeriodScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const initialParams = useMemo(() => parseAnalysisSearchParams(searchParams), [searchParams])
  const [tab, setTab] = useState(() => resolveInitialAnalysisTab(initialParams))
  const [dataSource, setDataSource] = useState(initialParams.source)
  const [product, setProduct] = useState(initialParams.product)
  const [resourcePool, setResourcePool] = useState('')
  const [expanded, setExpanded] = useState(() => {
    if (initialParams.complaintCauseL1) return initialParams.complaintCauseL1
    if (initialParams.problemType) return initialParams.problemType
    if (initialParams.requestScene) return initialParams.requestScene
    return null
  })
  const [journeySel, setJourneySel] = useState(() => ({
    l1: initialParams.journeyL1 || undefined,
    l2: initialParams.journeyL2 || undefined,
  }))
  const [selected, setSelected] = useState(null)

  const backgroundTaskActive = retagSession.active || importSession.active || rebuildBlocked
  const backgroundTaskTip = retagSession.active
    ? RETAG_IN_PROGRESS_TIP
    : importSession.active
      ? IMPORT_REBUILD_DISABLED_TIP
      : rebuildBlockedTip

  const syncAnalysisParams = useCallback(
    (patch) => {
      setSearchParams(patchAnalysisSearchParams(searchParams, patch), { replace: true })
    },
    [searchParams, setSearchParams],
  )

  const sourceScopedFeedbacks = useMemo(
    () => filterRecordsForScope(periodFeedbacks, currentPeriod, dataSource || undefined),
    [periodFeedbacks, currentPeriod, dataSource],
  )

  const products = useMemo(() => listProducts(sourceScopedFeedbacks), [sourceScopedFeedbacks])
  const pools = useMemo(
    () => listResourcePools(sourceScopedFeedbacks, product || undefined),
    [sourceScopedFeedbacks, product],
  )

  useEffect(() => {
    const p = parseAnalysisSearchParams(searchParams)
    setTab(resolveInitialAnalysisTab(p))
    setDataSource(p.source)
    setProduct(p.product)
    setResourcePool('')
    if (p.journeyL1 || p.journeyL2) {
      setJourneySel({ l1: p.journeyL1 || undefined, l2: p.journeyL2 || undefined })
      setExpanded(null)
    } else if (p.complaintCauseL1) {
      setExpanded(p.complaintCauseL1)
      setJourneySel({ l1: undefined, l2: undefined })
    } else if (p.problemType) {
      setExpanded(p.problemType)
      setJourneySel({ l1: undefined, l2: undefined })
    } else if (p.requestScene) {
      setExpanded(p.requestScene)
      setJourneySel({ l1: undefined, l2: undefined })
    }
  }, [searchParams])

  useEffect(() => {
    if (!product) return
    if (!products.some((p) => p.name === product)) {
      setProduct('')
      syncAnalysisParams({ product: '' })
    }
  }, [products, product, syncAnalysisParams])

  const analysisTabs = useMemo(() => buildAnalysisTabs(dataSource), [dataSource])

  const analysisScoped = useMemo(() => {
    let items = filterFeedbacks(sourceScopedFeedbacks, {
      product: product || undefined,
      resourcePool: resourcePool || undefined,
    })
    if (journeySel.l1) {
      items = filterFeedbacks(items, {
        journeyL1: journeySel.l1,
        journeyL2: journeySel.l2,
      })
    }
    return items
  }, [sourceScopedFeedbacks, product, resourcePool, journeySel])

  const scoped = useMemo(() => {
    let items = analysisScoped
    if (tab === 'problem' && expanded) {
      items = items.filter((fb) => (fb.problemType || '未分类') === expanded)
    }
    if (tab === 'complaint_cause' && expanded) {
      items = items.filter((fb) => getComplaintCauseL1Display(fb) === expanded)
    }
    if (tab === 'request' && expanded) {
      items = items.filter((fb) => (fb.requestScene || '未分类') === expanded)
    }
    return items
  }, [analysisScoped, tab, expanded])

  const { openBulkRetagModal, bulkRetagBusy, bulkRetagDisabled, bulkRetagDisabledTip } =
    useBulkRetagModal({ filteredRecords: scoped })

  const requestAgg = useMemo(
    () => aggregateFieldInsights(analysisScoped, 'requestScene'),
    [analysisScoped],
  )
  const problemAgg = useMemo(
    () => aggregateFieldInsights(analysisScoped, 'problemType'),
    [analysisScoped],
  )
  const complaintCauseAgg = useMemo(
    () => aggregateComplaintCauseL1Insights(analysisScoped),
    [analysisScoped],
  )
  const journeyTreeData = useMemo(() => journeyTree(scoped), [scoped])
  const [keywords, setKeywords] = useState(/** @type {{ word: string; count: number }[]} */ ([]))
  const [keywordsLoading, setKeywordsLoading] = useState(false)

  useEffect(() => {
    if (tab !== 'keywords') return undefined

    let cancelled = false
    const run = async () => {
      if (scoped.length === 0) {
        setKeywords([])
        return
      }
      if (!canUseSemanticMatch(settings)) {
        setKeywords(collectTopKeywords(scoped, 24))
        return
      }
      setKeywordsLoading(true)
      try {
        const list = await topKeywordsAsync(scoped, settings, 24)
        if (!cancelled) setKeywords(list)
      } catch (err) {
        console.warn('[Themes] 高频词 LLM 过滤失败:', err)
        if (!cancelled) setKeywords(collectTopKeywords(scoped, 24))
      } finally {
        if (!cancelled) setKeywordsLoading(false)
      }
    }

    run()
    return () => {
      cancelled = true
    }
  }, [scoped, tab, settings?.llmServerConfigured, settings?.llmModel])

  const chartData = useMemo(() => {
    if (tab === 'request') return requestAgg
    if (tab === 'problem') return problemAgg
    if (tab === 'complaint_cause') return complaintCauseAgg
    return []
  }, [tab, requestAgg, problemAgg, complaintCauseAgg])

  const detailItems = useMemo(() => {
    if (tab === 'journey') {
      return filterFeedbacks(scoped, {
        journeyL1: journeySel.l1,
        journeyL2: journeySel.l2,
      })
    }
    if (tab === 'request' && expanded) {
      return scoped.filter((fb) => (fb.requestScene || '未分类') === expanded)
    }
    if (tab === 'problem' && expanded) {
      return scoped.filter((fb) => (fb.problemType || '未分类') === expanded)
    }
    if (tab === 'complaint_cause' && expanded) {
      return scoped.filter((fb) => getComplaintCauseL1Display(fb) === expanded)
    }
    return []
  }, [tab, scoped, expanded, journeySel])

  const detailTitle = useMemo(() => {
    if (tab === 'journey' && journeySel.l1) {
      return `「${journeySel.l1}${journeySel.l2 ? ` / ${journeySel.l2}` : ''}」工单`
    }
    if (expanded) return `「${expanded}」相关工单`
    return '工单明细'
  }, [tab, expanded, journeySel])

  const resetDimensionSelection = useCallback(() => {
    setExpanded(null)
    setJourneySel({ l1: undefined, l2: undefined })
    syncAnalysisParams({
      journeyL1: '',
      journeyL2: '',
      problemType: '',
      complaintCauseL1: '',
      requestScene: '',
    })
  }, [syncAnalysisParams])

  const syncBarSelectionToUrl = useCallback(
    (label) => {
      if (tab === 'problem') {
        syncAnalysisParams({
          problemType: label,
          complaintCauseL1: '',
          requestScene: '',
          journeyL1: '',
          journeyL2: '',
          tab: 'problem',
        })
      } else if (tab === 'complaint_cause') {
        syncAnalysisParams({
          complaintCauseL1: label,
          problemType: '',
          requestScene: '',
          journeyL1: '',
          journeyL2: '',
          tab: 'complaint_cause',
        })
      } else {
        syncAnalysisParams({
          requestScene: label,
          problemType: '',
          complaintCauseL1: '',
          journeyL1: '',
          journeyL2: '',
          tab: 'request',
        })
      }
    },
    [tab, syncAnalysisParams],
  )

  useEffect(() => {
    if (tab !== 'request' && tab !== 'problem' && tab !== 'complaint_cause') return
    if (!chartData.length) {
      if (expanded) setExpanded(null)
      return
    }
    if (expanded && chartData.some((t) => t.label === expanded)) return
    const first = chartData[0].label
    setExpanded(first)
    syncBarSelectionToUrl(first)
  }, [tab, chartData, expanded, syncBarSelectionToUrl])

  useEffect(() => {
    if (tab === 'complaint_cause' && dataSource && dataSource !== 'complaint_ticket') {
      setTab('request')
      syncAnalysisParams({ tab: 'request' })
    }
  }, [dataSource, tab, syncAnalysisParams])

  const handleDataSourceChange = (value) => {
    setDataSource(value)
    setProduct('')
    setResourcePool('')
    resetDimensionSelection()
    syncAnalysisParams({ source: value, product: '' })
  }

  const handleProductChange = (value) => {
    setProduct(value)
    setResourcePool('')
    resetDimensionSelection()
    syncAnalysisParams({ product: value })
  }

  const handleResourcePoolChange = (value) => {
    setResourcePool(value)
    resetDimensionSelection()
  }

  const handleBarClick = (label) => {
    setExpanded(label)
    setJourneySel({ l1: undefined, l2: undefined })
    syncBarSelectionToUrl(label)
  }

  const handleJourneyClick = (l1, l2) => {
    setJourneySel({ l1, l2 })
    setExpanded(null)
    syncAnalysisParams({
      journeyL1: l1 || '',
      journeyL2: l2 || '',
      problemType: '',
      complaintCauseL1: '',
      requestScene: '',
      tab: 'journey',
    })
  }

  const handleExportAnalysis = () => {
    exportTicketAnalysisWithConfirm(scoped, {
      filePrefix: '洞察分析',
      periodLabel: currentPeriod?.label || '周期',
      totalInDb: periodCount,
      totalScopeLabel: '周期内',
    })
  }

  if (feedbacks.length === 0) {
    return (
      <div>
        <AnalysisPageHeader desc="按请求场景、问题类型、用户旅程、情绪与高频词聚合；周期与工作台保持一致" />
        <div className="page-toolbar">
          <InsightPeriodPicker compact showHint={false} />
        </div>
        <Card className="page-section">
          <Empty description="暂无数据">
            <Link to="/import">
              <Button type="primary">去导入</Button>
            </Link>
          </Empty>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] flex-col">
      <AnalysisPageHeader
        desc={
          <span data-testid="period-count-themes-desc">
            {dataSource || product || resourcePool
              ? `当前筛选 ${scoped.length} 条 · 周期内共 ${sourceScopedFeedbacks.length} 条${
                  dataSource ? ` · ${DATA_SOURCE_LABELS[dataSource]}` : ''
                }`
              : `周期内共 ${periodCount} 条 · 请求场景与问题类型为全产品通用标签`}
          </span>
        }
      />

      <div className="page-toolbar page-toolbar-nowrap !items-center gap-2">
        <InsightPeriodPicker compact showHint={false} className="shrink-0" />
        <Select
          className="min-w-[150px]"
          placeholder="全部产品"
          value={product}
          options={[
            { label: '全部产品', value: '' },
            ...products.map((p) => ({ label: `${p.name} (${p.count})`, value: p.name })),
          ]}
          onChange={handleProductChange}
        />
        <Select
          className="min-w-[130px]"
          placeholder="全部来源"
          value={dataSource}
          options={[
            { label: '全部来源', value: '' },
            ...DATA_SOURCE_TYPES.map((type) => ({
              label: DATA_SOURCE_LABELS[type],
              value: type,
            })),
          ]}
          onChange={handleDataSourceChange}
        />
        <Select
          className="min-w-[130px]"
          placeholder="全部资源池"
          value={resourcePool}
          options={[
            { label: '全部资源池', value: '' },
            ...pools.map((p) => ({ label: `${p.name} (${p.count})`, value: p.name })),
          ]}
          onChange={handleResourcePoolChange}
        />
      </div>

      <div className="page-section-sm flex flex-wrap items-end justify-between gap-3">
        <WorkbenchTabNav
          className="mb-0 min-w-0 flex-1"
          activeKey={tab}
          items={analysisTabs.map(({ value, label }) => ({ key: value, label }))}
          onChange={(value) => {
            setTab(value)
            resetDimensionSelection()
            syncAnalysisParams({ tab: value })
          }}
        />
        <Space wrap size="small" className="shrink-0">
          <Button
            icon={<DownloadOutlined />}
            disabled={!scoped.length}
            onClick={handleExportAnalysis}
          >
            导出分析结果
          </Button>
          <PermissionGate permission="retag">
            <Tooltip
              title={
                backgroundTaskActive && !retagSession.active
                  ? backgroundTaskTip
                  : bulkRetagDisabledTip
              }
            >
              <span className="inline-block">
                <Button
                  disabled={bulkRetagDisabled}
                  loading={bulkRetagBusy}
                  onClick={openBulkRetagModal}
                >
                  批量重新打标
                </Button>
              </span>
            </Tooltip>
          </PermissionGate>
          <Link to="/settings">
            <Button>打标配置</Button>
          </Link>
        </Space>
      </div>

      {(tab === 'request' || tab === 'problem' || tab === 'complaint_cause') && (
        <div className="mt-6 grid min-h-0 flex-1 gap-6 lg:max-h-[calc(100vh-17rem)] lg:grid-cols-2">
          <Card
            className="min-h-0"
            title={
              tab === 'request'
                ? '请求场景分布'
                : tab === 'complaint_cause'
                  ? '投诉原因（终判）分布'
                  : '问题类型（打标）分布'
            }
          >
            <ThemeBarChart
              data={chartData}
              activeLabel={expanded}
              onBarClick={handleBarClick}
            />
          </Card>

          <InsightFeedbackList
            fillHeight
            items={detailItems}
            title={detailTitle}
            subtitle={detailItems.length ? `共 ${detailItems.length} 条 · 点击查看详情` : undefined}
            journeyL1={journeySel.l1}
            journeyL2={journeySel.l2}
            onItemClick={setSelected}
            emptyHint="暂无工单"
          />
        </div>
      )}

      {tab === 'journey' && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card title="用户旅程分布">
            <Typography.Text type="secondary" className="text-xs">
              基于用户旅程打标（一级 / 二级环节；列表中的旅程标签即二级环节名）
            </Typography.Text>
            <div className="mt-4 space-y-3 max-h-[520px] overflow-y-auto">
              {journeyTreeData.length === 0 ? (
                <Empty description={<span>暂无旅程数据，请至<Link to="/feedbacks">反馈库</Link>批量重新打标</span>} />
              ) : (
                journeyTreeData.map((node) => (
                  <div key={node.l1} className="rounded-lg border border-ink-100 overflow-hidden">
                    <button
                      type="button"
                      className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition ${
                        journeySel.l1 === node.l1 && !journeySel.l2
                          ? 'bg-brand-50 text-brand-800'
                          : 'hover:bg-ink-50'
                      }`}
                      onClick={() => handleJourneyClick(node.l1, undefined)}
                    >
                      <span className="font-medium">{node.l1}</span>
                      <Tag>{node.count}</Tag>
                    </button>
                    <ul className="border-t border-ink-100 bg-ink-50/50">
                      {node.children.map((child) => (
                        <li key={child.l2}>
                          <button
                            type="button"
                            className={`flex w-full items-center justify-between px-4 py-2 text-left text-xs transition ${
                              journeySel.l1 === node.l1 && journeySel.l2 === child.l2
                                ? 'bg-brand-100/60 text-brand-800'
                                : 'text-ink-600 hover:bg-white'
                            }`}
                            onClick={() => handleJourneyClick(node.l1, child.l2)}
                          >
                            <span>{child.l2}</span>
                            <span className="text-ink-400">{child.count}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </Card>

          <InsightFeedbackList
            items={detailItems}
            title={detailTitle}
            subtitle={detailItems.length ? `共 ${detailItems.length} 条` : undefined}
            journeyL1={journeySel.l1}
            journeyL2={journeySel.l2}
            onItemClick={setSelected}
            emptyHint="点击左侧旅程环节查看工单"
          />
        </div>
      )}

      {tab === 'sentiment' && (
        <div className="mt-6">
          <SentimentDistributionPanel
            items={scoped}
            subtitle={`筛选范围内 ${scoped.length} 条`}
          />
        </div>
      )}

      {tab === 'keywords' && (
        <Card className="page-section" title="客户原话高频词">
          <Typography.Text type="secondary" className="text-xs">
            从问题摘要与客户原话提取；词越大出现越频繁
            {canUseSemanticMatch(settings)
              ? '。已启用 LLM 校验，仅保留对产品规划有决策价值的词'
              : '（配置 LLM 后可启用词义校验）'}
          </Typography.Text>
          <Spin spinning={keywordsLoading} className="mt-3 block">
            <KeywordWordCloud words={keywords} />
          </Spin>
        </Card>
      )}

      <FeedbackDrawer feedback={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
