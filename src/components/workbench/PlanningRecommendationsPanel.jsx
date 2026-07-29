import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Collapse, Dropdown, Segmented, Select, Space, Table, Tag, Tooltip, Typography, Alert } from 'antd'
import {
  AimOutlined,
  DownloadOutlined,
  InfoCircleOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { useInsights } from '../../context/InsightsContext.jsx'
import { canUseSemanticMatch } from '../../lib/themeSemantic.js'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import SimpleList from '../ui/SimpleList.jsx'
import {
  buildFeedbacksLinkForRecommendation,
  buildPlanningAnalysisLink,
  collectRecommendationProductOptions,
  filterRecommendationsByProduct,
  limitPlanningRecommendations,
  resolveEvidenceRecordsForRecommendation,
} from '../../lib/planningRecommendations.js'
import { exportPlanningRecommendationsXlsx } from '../../lib/planningRecommendationsExport.js'
import {
  PERIOD_COMPARE_LABELS,
  summarizeRecommendationPeriodCompare,
} from '../../lib/planningRecommendationCompare.js'
import {
  groupRecommendationsByProduct,
  recommendationsForMatrixCell,
  resolveRecommendationSummary,
  buildRecommendationClusterHeading,
  buildRecommendationEvidenceLinkLabel,
  isPainClusterRecommendation,
} from '../../lib/planningRecommendationDisplay.js'
import {
  FEEDBACK_TYPE_LABELS,
  saveRecommendationFeedback,
} from '../../lib/planningRecommendationFeedback.js'
import PlanningRecommendationsHelpModal from './PlanningRecommendationsHelpModal.jsx'
import PlanningRecommendationSectionsView from './PlanningRecommendationSectionsView.jsx'
import {
  PLANNING_RECOMMENDATIONS_ANCHOR_ID,
  PLANNING_RECOMMENDATIONS_PANEL_TITLE,
} from '../../domain/overviewConclusions.js'
import { OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE } from '../../snapshots/rehydrateOverviewRecommendations.js'
import { refreshStaleV2RecommendationSections } from '../../snapshots/rehydrateOverviewRecommendations.js'

/** @typedef {import('../../domain/overviewConclusions.js').OverviewConclusions} OverviewConclusions */
/** @typedef {import('../../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../../lib/types.js').FeedbackRecord} FeedbackRecord */

const PRIORITY_COLORS = {
  high: 'red',
  medium: 'orange',
  low: 'default',
}

const PRIORITY_LABELS = {
  high: '高',
  medium: '中',
  low: '低',
}

const PRIORITY_BORDER_CLASS = {
  high: 'border-l-4 border-l-red-500 bg-red-50/40',
  medium: 'border-l-4 border-l-orange-400 bg-orange-50/30',
  low: 'border-l-4 border-l-gray-300 bg-white',
}

const CATEGORY_LABELS = {
  product: '产品优化',
  process: '流程运营',
  docs: '文档自助',
  monitoring: '监控预警',
}

const EVIDENCE_STRENGTH_LABELS = {
  strong: '证据充分',
  moderate: '证据一般',
  weak: '推断型',
}

const EVIDENCE_STRENGTH_COLORS = {
  strong: 'green',
  moderate: 'blue',
  weak: 'default',
}

const PERIOD_COMPARE_COLORS = {
  new: 'green',
  persist: 'default',
  priority_up: 'red',
  priority_down: 'blue',
}

const VIEW_MODES = [
  { label: '按产品', value: 'product' },
  { label: '矩阵', value: 'matrix' },
  { label: '列表', value: 'list' },
]

const MATRIX_PRIORITIES = ['high', 'medium', 'low']
const MATRIX_CATEGORIES = ['product', 'process', 'docs', 'monitoring']

/**
 * @param {OverviewRecommendation[]} recs
 */
function countByPriority(recs) {
  return {
    high: recs.filter((r) => r.priority === 'high').length,
    medium: recs.filter((r) => r.priority === 'medium').length,
    low: recs.filter((r) => r.priority === 'low').length,
  }
}

/**
 * @param {Object} props
 * @param {OverviewConclusions | null | undefined} props.conclusions
 * @param {FeedbackRecord[]} [props.feedbacks]
 * @param {string} [props.title] 面板标题，默认「行动建议」
 * @param {string} [props.syncedProduct] 外部产品筛选（如工单 Tab 当前产品）
 */
export default function PlanningRecommendationsPanel({
  conclusions,
  feedbacks = [],
  title,
  syncedProduct,
}) {
  const message = useAppMessage()
  const {
    adapter,
    settings,
    polishPlanningRecommendations,
  } = useInsights()

  const submitRecommendationFeedback = useCallback(
    async (params) => {
      if (!conclusions?.insightPeriodId) return
      await saveRecommendationFeedback(
        { ...params, insightPeriodId: conclusions.insightPeriodId },
        adapter,
      )
      message.success('感谢反馈，已记录')
    },
    [adapter, conclusions?.insightPeriodId, message],
  )
  const [productFilter, setProductFilter] = useState(/** @type {string | undefined} */ (undefined))
  const panelTitle = title || PLANNING_RECOMMENDATIONS_PANEL_TITLE

  useEffect(() => {
    if (syncedProduct === undefined) return
    setProductFilter(syncedProduct || undefined)
  }, [syncedProduct])
  const [viewMode, setViewMode] = useState(/** @type {'list' | 'product' | 'matrix'} */ ('product'))
  const [polishing, setPolishing] = useState(false)
  const canPolish = canUseSemanticMatch(settings)

  const feedbackByRecordId = useMemo(() => {
    /** @type {Map<string, FeedbackRecord>} */
    const map = new Map()
    for (const fb of feedbacks) {
      if (fb.id) map.set(fb.id, fb)
    }
    return map
  }, [feedbacks])

  const feedbackByTicketId = useMemo(() => {
    /** @type {Map<string, FeedbackRecord>} */
    const map = new Map()
    for (const fb of feedbacks) {
      if (fb.ticketId) map.set(fb.ticketId, fb)
    }
    return map
  }, [feedbacks])

  const allRecommendations = useMemo(() => {
    const raw = refreshStaleV2RecommendationSections(
      conclusions?.recommendations || [],
      feedbacks,
    )
    return limitPlanningRecommendations(raw)
  }, [conclusions?.recommendations, feedbacks])

  const recommendationProductOptions = useMemo(
    () => collectRecommendationProductOptions(allRecommendations, feedbackByRecordId),
    [allRecommendations, feedbackByRecordId],
  )

  const filteredRecommendations = useMemo(() => {
    return filterRecommendationsByProduct(
      allRecommendations,
      productFilter,
      feedbackByRecordId,
    )
  }, [allRecommendations, productFilter, feedbackByRecordId])

  const periodCompareSummary = useMemo(
    () => summarizeRecommendationPeriodCompare(allRecommendations),
    [allRecommendations],
  )
  const removedCount = conclusions?.recommendationsMeta?.removedFromPreviousCount ?? 0
  const showPeriodCompare =
    Boolean(conclusions?.recommendationsMeta?.previousPeriodId) &&
    (periodCompareSummary.new > 0 ||
      periodCompareSummary.priority_up > 0 ||
      periodCompareSummary.priority_down > 0 ||
      removedCount > 0)

  useEffect(() => {
    if (productFilter && !recommendationProductOptions.includes(productFilter)) {
      setProductFilter(undefined)
    }
  }, [productFilter, recommendationProductOptions])

  if (!allRecommendations.length) {
    if (
      !conclusions ||
      conclusions.insufficientData ||
      conclusions.recommendationsMeta?.displaySuppressed
    ) {
      return null
    }

    const emptyNote =
      conclusions.dataCoverageNotes?.find((n) => n.includes('未形成痛点聚类')) ||
      OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE

    return (
      <Card
        id={PLANNING_RECOMMENDATIONS_ANCHOR_ID}
        className="border-indigo-200 shadow-sm"
        styles={{
          header: { background: 'linear-gradient(to right, rgb(238 242 255), rgb(255 255 255))' },
          body: { paddingTop: 16 },
        }}
        title={
          <Space align="center">
            <AimOutlined className="text-indigo-600" />
            <span className="text-base font-semibold">{panelTitle}</span>
            <PlanningRecommendationsHelpModal />
          </Space>
        }
      >
        <Alert type="info" showIcon title="暂无行动建议" description={emptyNote} />
      </Card>
    )
  }

  const priorityCounts = countByPriority(allRecommendations)

  return (
    <Card
      id={PLANNING_RECOMMENDATIONS_ANCHOR_ID}
      className="border-indigo-200 shadow-sm"
      styles={{
        header: { background: 'linear-gradient(to right, rgb(238 242 255), rgb(255 255 255))' },
        body: { paddingTop: 16 },
      }}
      title={
        <Space align="center">
          <AimOutlined className="text-indigo-600" />
          <span className="text-base font-semibold">{panelTitle}</span>
          <PlanningRecommendationsHelpModal />
          {conclusions?.source === 'hybrid' && <Tag color="purple">规则 + LLM</Tag>}
          {conclusions?.recommendationsLlm?.polishedAt && (
            <Tag color="geekblue">行动建议已润色</Tag>
          )}
          <Button
            size="small"
            type="default"
            icon={<ThunderboltOutlined />}
            loading={polishing}
            disabled={!canPolish}
            title="在已有 V2 结构化行动建议上润色概述与举措文案，不重新聚类；与设置中的「单条工单优化建议」无关"
            onClick={async () => {
              setPolishing(true)
              try {
                await polishPlanningRecommendations()
                message.success('已润色行动建议并保存到快照')
              } catch (err) {
                message.error(err instanceof Error ? err.message : '润色失败')
              } finally {
                setPolishing(false)
              }
            }}
          >
            LLM 润色行动建议
          </Button>
        </Space>
      }
    >
      {conclusions?.recommendationsMeta?.rehydratedAt && (
        <Alert
          type="info"
          showIcon
          className="!mb-3"
          title="行动建议已实时重算"
          description="当前快照生成于聚类引擎上线前，行动建议已基于最新工单临时重算。请重新生成洞察快照以持久化结果。"
        />
      )}

      {showPeriodCompare && (
        <div className="mb-3 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
          <span className="font-medium text-slate-900">相对上一周期：</span>
          {periodCompareSummary.new > 0 && (
            <Tag color={PERIOD_COMPARE_COLORS.new}>
              新增 {periodCompareSummary.new}
            </Tag>
          )}
          {periodCompareSummary.persist > 0 && (
            <Tag>持续 {periodCompareSummary.persist}</Tag>
          )}
          {periodCompareSummary.priority_up > 0 && (
            <Tag color={PERIOD_COMPARE_COLORS.priority_up}>
              升级 {periodCompareSummary.priority_up}
            </Tag>
          )}
          {periodCompareSummary.priority_down > 0 && (
            <Tag color={PERIOD_COMPARE_COLORS.priority_down}>
              降级 {periodCompareSummary.priority_down}
            </Tag>
          )}
          {removedCount > 0 && <Tag color="default">上期有本期无 {removedCount}</Tag>}
        </div>
      )}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Segmented size="small" value={viewMode} options={VIEW_MODES} onChange={setViewMode} />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Typography.Text type="secondary" className="text-xs">
          {productFilter
            ? `已筛选「${productFilter}」· 显示 ${filteredRecommendations.length} / ${allRecommendations.length} 条`
            : `本期 ${allRecommendations.length} 条可纳入规划讨论`}
          {' · '}
          高 {priorityCounts.high} / 中 {priorityCounts.medium} / 低 {priorityCounts.low}
          {conclusions?.periodLabel ? ` · ${conclusions.periodLabel}` : ''}
        </Typography.Text>
        <Space wrap>
          {recommendationProductOptions.length > 0 && (
            <Select
              allowClear
              placeholder="全部产品"
              size="small"
              className="min-w-[160px]"
              value={productFilter}
              onChange={(value) => setProductFilter(value || undefined)}
              options={recommendationProductOptions.map((p) => ({ label: p, value: p }))}
            />
          )}
          <Button
            size="small"
            icon={<DownloadOutlined />}
            disabled={!filteredRecommendations.length}
            onClick={() =>
              exportPlanningRecommendationsXlsx(
                filteredRecommendations,
                conclusions?.periodLabel
                  ? `行动建议_${conclusions.periodLabel}`
                  : '行动建议',
              )
            }
          >
            导出 Excel
          </Button>
        </Space>
      </div>

      {filteredRecommendations.length > 0 ? (
        viewMode === 'list' ? (
          <SimpleList
            size="small"
            dataSource={filteredRecommendations}
            renderItem={(rec, idx) => (
              <PlanningRecommendationItem
                rec={rec}
                index={idx}
                periodMonth={conclusions?.periodMonth}
                insightPeriodId={conclusions?.insightPeriodId}
                onFeedback={(type) => {
                  void submitRecommendationFeedback({
                    recommendationId: rec.id,
                    type,
                  })
                }}
                evidenceRecords={resolveEvidenceRecordsForRecommendation(
                  rec,
                  feedbackByRecordId,
                  feedbackByTicketId,
                )}
              />
            )}
          />
        ) : viewMode === 'product' ? (
          <Collapse
            size="small"
            items={groupRecommendationsByProduct(filteredRecommendations).map(
              ([product, recs]) => ({
                key: product,
                label: (
                  <span>
                    {product}{' '}
                    <Typography.Text type="secondary" className="text-xs">
                      （{recs.length} 条 · 高 {recs.filter((r) => r.priority === 'high').length}）
                    </Typography.Text>
                  </span>
                ),
                children: recs.map((rec, idx) => (
                  <PlanningRecommendationItem
                    key={rec.id}
                    rec={rec}
                    index={idx}
                    periodMonth={conclusions?.periodMonth}
                    insightPeriodId={conclusions?.insightPeriodId}
                    onFeedback={(type) => {
                      void submitRecommendationFeedback({
                        recommendationId: rec.id,
                        type,
                      })
                    }}
                    evidenceRecords={resolveEvidenceRecordsForRecommendation(
                      rec,
                      feedbackByRecordId,
                      feedbackByTicketId,
                    )}
                  />
                )),
              }),
            )}
          />
        ) : (
          <Table
            size="small"
            pagination={false}
            bordered
            rowKey="key"
            dataSource={MATRIX_PRIORITIES.map((priority) => ({
              key: priority,
              priority,
            }))}
            columns={[
              {
                title: '优先级',
                dataIndex: 'priority',
                width: 72,
                render: (p) => PRIORITY_LABELS[p],
              },
              ...MATRIX_CATEGORIES.map((category) => ({
                title: CATEGORY_LABELS[category],
                key: category,
                render: (_, row) => {
                  const cell = recommendationsForMatrixCell(
                    filteredRecommendations,
                    row.priority,
                    category,
                  )
                  if (!cell.length) {
                    return <Typography.Text type="secondary">—</Typography.Text>
                  }
                  return (
                    <ul className="mb-0 list-disc pl-4 text-xs">
                      {cell.map((rec) => (
                        <li key={rec.id}>{rec.summary || rec.text}</li>
                      ))}
                    </ul>
                  )
                },
              })),
            ]}
          />
        )
      ) : (
        <Typography.Text type="secondary" className="text-sm">
          当前产品暂无匹配的行动建议，请选择「全部产品」或切换其他产品。
        </Typography.Text>
      )}

      <Typography.Text type="secondary" className="mt-3 block text-xs">
        可在反馈库中按范围筛选相关工单，或在洞察分析 Tab 中进一步下钻。
      </Typography.Text>
    </Card>
  )
}

/**
 * @param {Object} props
 * @param {OverviewRecommendation} props.rec
 * @param {number} props.index
 * @param {string} [props.periodMonth]
 * @param {FeedbackRecord[]} [props.evidenceRecords]
 * @param {(type: import('../../lib/planningRecommendationFeedback.js').RecommendationFeedbackType) => void} [props.onFeedback]
 */
function PlanningRecommendationItem({
  rec,
  index,
  periodMonth,
  insightPeriodId,
  onFeedback,
  evidenceRecords = [],
}) {
  const details = rec.details || []
  const sections = rec.sections
  const clusterHeading = buildRecommendationClusterHeading(rec)
  const insightSummary = resolveRecommendationSummary(rec)
  const ticketIds = rec.evidenceTicketIds || []
  const feedbacksListHref = buildFeedbacksLinkForRecommendation(rec, {
    month: periodMonth,
    evidenceRecords,
  })
  const feedbacksLinkLabel = buildRecommendationEvidenceLinkLabel(rec, evidenceRecords)
  const analysisHref = buildPlanningAnalysisLink(rec)
  const generationTip = rec.generationMeta ? (
    <div className="max-w-sm space-y-1 text-xs">
      <div>
        <strong>入选原因：</strong>
        {rec.generationMeta.selectedReason}
      </div>
      {rec.generationMeta.mergedFrom?.length > 0 && (
        <div>
          <strong>已合并同类信号：</strong>
          {rec.generationMeta.mergedFrom.join('；')}
        </div>
      )}
    </div>
  ) : null

  const borderClass = PRIORITY_BORDER_CLASS[rec.priority] || PRIORITY_BORDER_CLASS.low

  return (
    <div className={`mb-3 rounded-lg border border-gray-200 p-4 shadow-sm last:mb-0 ${borderClass}`}>
      <div className="flex gap-3">
        <Typography.Text
          strong
          className={`w-7 shrink-0 text-center ${rec.priority === 'high' ? 'text-red-600' : 'text-gray-500'}`}
        >
          {index + 1}
        </Typography.Text>
        <div className="min-w-0 flex-1">
          {clusterHeading ? (
            <div className="mb-2">
              <Typography.Text strong className="block text-sm leading-snug text-gray-900">
                {clusterHeading}
              </Typography.Text>
              {insightSummary ? (
                <Typography.Text type="secondary" className="mt-1 block text-sm leading-relaxed">
                  {insightSummary}
                </Typography.Text>
              ) : null}
            </div>
          ) : insightSummary ? (
            <Typography.Paragraph className="!mb-2 text-sm leading-relaxed text-gray-800">
              {insightSummary}
            </Typography.Paragraph>
          ) : null}

          <Space wrap className="mb-2">
            {isPainClusterRecommendation(rec) && (
              <Tag color="geekblue">痛点聚类 V2</Tag>
            )}
            <Tag color={PRIORITY_COLORS[rec.priority]}>
              {PRIORITY_LABELS[rec.priority]}优先级
            </Tag>
            <Tag>{CATEGORY_LABELS[rec.category] || rec.category}</Tag>
            {rec.scope?.product && <Tag color="blue">{rec.scope.product}</Tag>}
            {rec.scope?.journeyL2 && (
              <Tag color="purple">
                {rec.scope.journeyL1 ? `${rec.scope.journeyL1} → ` : ''}
                {rec.scope.journeyL2}
              </Tag>
            )}
            {rec.scope?.problemType && <Tag color="cyan">{rec.scope.problemType}</Tag>}
            {rec.evidenceStrength && (
              <Tag color={EVIDENCE_STRENGTH_COLORS[rec.evidenceStrength]}>
                {EVIDENCE_STRENGTH_LABELS[rec.evidenceStrength] || rec.evidenceStrength}
              </Tag>
            )}
            {rec.insufficientEvidence && <Tag color="warning">样本偏少</Tag>}
            {rec.generationMeta && (
              <Tooltip title={generationTip}>
                <Tag icon={<InfoCircleOutlined />} className="cursor-help">
                  生成说明
                </Tag>
              </Tooltip>
            )}
            {rec.periodCompare?.change && rec.periodCompare.change !== 'persist' && (
              <Tag color={PERIOD_COMPARE_COLORS[rec.periodCompare.change]}>
                {PERIOD_COMPARE_LABELS[rec.periodCompare.change]}
              </Tag>
            )}
          </Space>

          {sections ? (
            <PlanningRecommendationSectionsView sections={sections} />
          ) : (
            <>
              {details.length === 1 && (
                <Typography.Text type="secondary" className="mb-2 block text-sm leading-relaxed">
                  · {details[0]}
                </Typography.Text>
              )}

              {details.length > 1 && (
                <ul className="mb-2 list-disc space-y-1 pl-5 text-sm text-gray-700">
                  {details.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </>
          )}

          {(rec.insufficientEvidence || rec.evidenceStrength === 'weak') && (
            <div className="mb-2 rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-950">
              {rec.insufficientEvidence && (
                <Typography.Text className="block text-xs text-amber-800">
                  依据工单样本偏少，建议结合洞察分析进一步核实后再纳入规划。
                </Typography.Text>
              )}
              {rec.evidenceStrength === 'weak' && !rec.insufficientEvidence && (
                <Typography.Text className="block text-xs text-amber-800">
                  当前为推断型建议，工单佐证有限，请优先在洞察分析中交叉验证。
                </Typography.Text>
              )}
            </div>
          )}

          {rec.trackingMetrics?.length > 0 && (
            <Space wrap size={[4, 4]} className="mb-2">
              {rec.trackingMetrics.map((m) => (
                <Tag key={m} bordered={false} className="text-xs">
                  跟踪：{m}
                </Tag>
              ))}
            </Space>
          )}

          {(ticketIds.length > 0 || rec.scope) && (
            <div className="mb-1 flex flex-wrap gap-x-3 gap-y-1">
              <Link to={feedbacksListHref} className="text-xs font-medium text-indigo-600 hover:underline">
                {feedbacksLinkLabel}
              </Link>
              {rec.scope && (
                <Link to={analysisHref} className="text-xs text-indigo-600 hover:underline">
                  在洞察分析中查看
                </Link>
              )}
            </div>
          )}

          <Space wrap className="mt-2">
            {onFeedback && insightPeriodId && (
              <Dropdown
                menu={{
                  items: Object.entries(FEEDBACK_TYPE_LABELS).map(([key, label]) => ({
                    key,
                    label,
                    onClick: () => onFeedback(/** @type {import('../../lib/planningRecommendationFeedback.js').RecommendationFeedbackType} */ (key)),
                  })),
                }}
              >
                <Button type="link" size="small" className="!px-0 !text-xs">
                  反馈
                </Button>
              </Dropdown>
            )}
          </Space>

        </div>
      </div>
    </div>
  )
}
