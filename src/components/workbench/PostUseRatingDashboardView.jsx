import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Card, Col, Row, Statistic, Table, Typography } from 'antd'
import FollowUpSatisfactionPanel from './FollowUpSatisfactionPanel.jsx'
import PostUseVisitPanel from './PostUseVisitPanel.jsx'
import PostUseMonthlyReportPreview from './PostUseMonthlyReportPreview.jsx'
import TrendChart from '../charts/TrendChart.jsx'
import { buildPostUseActionSignals } from '../../lib/postUseRating/actionSignals.js'
import { loadVisitRecords } from '../../lib/postUseRating/visitRecords.js'
import {
  ensureHistoricalTrendSeed,
  buildFocusScoreTrendChartModel,
  buildFocusSatisfactionTrendChartModel,
} from '../../lib/postUseRating/trendStore.js'
import { listActionItems } from '../../lib/actionItemClient.js'
import { useInsights } from '../../context/InsightsContext.jsx'
import { filterRecordsForScope, resolveRecordsByIds } from '../../snapshots/recordScope.js'
import {
  computeExternalMixedMetrics,
  computeInternalExperienceMetrics,
  computeInternalSatisfactionMetrics,
  POST_USE_SMALL_SAMPLE_N,
} from '../../lib/postUseRating/metrics.js'
import {
  getPostUseFocusTrackedNames,
  getPostUseRatingProductNames,
} from '../../lib/productCatalog/postUseRatingProducts.js'
import { getCatalogProducts } from '../../lib/productCatalogLoader.js'
import { extractFollowUpTicketRecords } from '../../lib/followUpSatisfactionAnalytics.js'
import { isPostUseRatingCallbackRecord } from '../../domain/postUseRatingImport.js'

/**
 * @param {import('../../lib/types.js').FeedbackRecord[]} items
 */
function recordsToNormalized(items) {
  return items
    .filter((r) => r.dataSourceType === 'post_use_rating' && r.ratingScore != null)
    .map((r) => ({
      channel:
        r.channel ||
        (r.sourceSubType === 'sms_survey'
          ? 'sms'
          : r.sourceSubType === 'web_survey'
            ? 'console'
            : r.sourceSubType === 'satisfaction_callback'
              ? 'callback'
              : 'console'),
      productName: r.productName || r.product || '',
      score: Number(r.ratingScore),
      customerName: r.customerName || '',
      customerCode: r.customerCode || '',
      answeredAt: r.createdAt || '',
      originalTicketId: r.originalTicketId || '',
      lowScoreReason: r.lowScoreReason || '',
    }))
    .filter((r) => Number.isFinite(r.score) && r.productName)
}

/**
 * 用后即评工作台：对内分口径 KPI + 工单回访面板 + 重点跟踪趋势
 */
export default function PostUseRatingDashboardView({ snapshot, sourceLabel }) {
  const { feedbacks, currentPeriod, adapter } = useInsights()
  const [visits, setVisits] = useState([])
  const [actionItems, setActionItems] = useState([])
  const [trendSnap, setTrendSnap] = useState(null)
  const items = useMemo(
    () => resolveRecordsByIds(feedbacks, snapshot.recordIds),
    [feedbacks, snapshot.recordIds],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!adapter) return
      try {
        const [v, actionsRes, trend] = await Promise.all([
          loadVisitRecords(adapter),
          listActionItems({ limit: 500 }).catch(() => ({ items: [] })),
          ensureHistoricalTrendSeed(adapter).catch(() => null),
        ])
        if (!cancelled) {
          setVisits(v)
          setActionItems(actionsRes?.items || [])
          setTrendSnap(trend)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, feedbacks])

  const ticketRecordsForFollowUp = useMemo(() => {
    if (!currentPeriod) return []
    const complaint = filterRecordsForScope(feedbacks, currentPeriod, 'complaint_ticket')
    const consultation = filterRecordsForScope(feedbacks, currentPeriod, 'consultation_ticket')
    return [...complaint, ...consultation]
  }, [feedbacks, currentPeriod])

  const catalog = useMemo(() => getCatalogProducts(), [feedbacks])
  const productNames = useMemo(() => getPostUseRatingProductNames(catalog), [catalog])
  const focusNames = useMemo(() => getPostUseFocusTrackedNames(catalog), [catalog])

  const normalized = useMemo(() => recordsToNormalized(items), [items])
  const internalExp = useMemo(
    () => computeInternalExperienceMetrics(normalized, { productNames }),
    [normalized, productNames],
  )
  const internalSat = useMemo(
    () => computeInternalSatisfactionMetrics(normalized, { productNames }),
    [normalized, productNames],
  )
  const external = useMemo(
    () => computeExternalMixedMetrics(normalized, { productNames }),
    [normalized, productNames],
  )

  /** 渠道口径 callback vs 工单 enrich：披露未匹配，满意度明细以工单面板为准下钻 */
  const callbackLinkage = useMemo(() => {
    const callbackRows = items.filter(isPostUseRatingCallbackRecord)
    const enriched = extractFollowUpTicketRecords(ticketRecordsForFollowUp)
    const enrichedTicketIds = new Set(
      enriched
        .map((r) => String(r.ticketId || '').trim())
        .filter(Boolean),
    )
    const unmatched = callbackRows.filter((r) => {
      const oid = String(r.originalTicketId || '').trim()
      return !oid || !enrichedTicketIds.has(oid)
    })
    return {
      channelCallbackCount: callbackRows.length,
      ticketEnrichedCount: enriched.length,
      unmatchedCount: unmatched.length,
    }
  }, [items, ticketRecordsForFollowUp])

  const monthReasons = useMemo(() => {
    if (!trendSnap || !reportMonthSafe(currentPeriod)) return []
    const month = reportMonthSafe(currentPeriod)
    return (trendSnap.reasons || [])
      .filter((r) => r.month === month)
      .map((r) => ({
        reason: r.reason,
        count: r.count,
        ...(r.channel != null && r.channel !== '' ? { channel: r.channel } : {}),
      }))
      .sort((a, b) => b.count - a.count)
  }, [trendSnap, currentPeriod])

  const scoreTrend = useMemo(
    () =>
      trendSnap
        ? buildFocusScoreTrendChartModel(trendSnap, focusNames, 'internal_experience')
        : { data: [], areas: [] },
    [trendSnap, focusNames],
  )
  const satTrend = useMemo(
    () =>
      trendSnap ? buildFocusSatisfactionTrendChartModel(trendSnap, focusNames) : { data: [], areas: [] },
    [trendSnap, focusNames],
  )

  const actionSignals = useMemo(() => {
    const callbackNonTen = normalized
      .filter((r) => r.channel === 'callback' && r.score !== 10)
      .map((r) => ({
        productName: r.productName,
        score: r.score,
        customerName: r.customerName,
        lowScoreReason: r.lowScoreReason,
        originalTicketId: r.originalTicketId,
      }))
    return buildPostUseActionSignals({
      internalSat,
      internalExp,
      callbackNonTen: callbackNonTen.slice(0, 20),
    })
  }, [normalized, internalSat, internalExp])

  const reportMonth = reportMonthSafe(currentPeriod)
  const hasRatingItems = normalized.length > 0

  const satColumns = [
    { title: '产品', dataIndex: 'productName', key: 'productName' },
    { title: '样本量', dataIndex: 'sampleSize', key: 'sampleSize', width: 88 },
    {
      title: '10分率',
      dataIndex: 'rate',
      key: 'rate',
      width: 100,
      render: (v, row) => `${v}%${row.smallSample ? '（参考）' : ''}`,
    },
  ]

  return (
    <div className="space-y-4">
      <Typography.Text type="secondary" className="block text-sm">
        对内默认：体验均分=短信+控制台；投诉回访单独算 10 分满意度（达标线 88%，n&lt;
        {POST_USE_SMALL_SAMPLE_N} 标参考）。对外月报仍可按三渠道混算。投诉回访在反馈库只挂在投诉/咨询工单上，不重复列独立明细。
      </Typography.Text>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/import?source=post_use_rating&subType=channel_bundle"
          className="text-sm"
        >
          导入短信+官网双文件
        </Link>
        <Link to="/feedbacks?lane=post_use&source=post_use_rating" className="text-sm">
          查看用后即评明细（短信/控制台）
        </Link>
      </div>

      <FollowUpSatisfactionPanel ticketRecords={ticketRecordsForFollowUp} />

      {(callbackLinkage.channelCallbackCount > 0 || callbackLinkage.ticketEnrichedCount > 0) && (
        <Alert
          type="info"
          showIcon
          title="投诉回访数据源说明"
          description={
            <>
              渠道口径明细 {callbackLinkage.channelCallbackCount} 条（用于对内满意度/对外混算 KPI）；已关联工单{' '}
              {callbackLinkage.ticketEnrichedCount} 条（上方回访面板与反馈库下钻）。
              {callbackLinkage.unmatchedCount > 0
                ? ` 未匹配原工单 ${callbackLinkage.unmatchedCount} 条（仅计入渠道 KPI，不在反馈库用后即评列表展示）。`
                : ' 渠道回访均已关联工单或暂无渠道回访行。'}
            </>
          }
        />
      )}

      <PostUseVisitPanel reportMonth={reportMonth} />

      {scoreTrend.data.length > 0 && (
        <Card size="small" title="重点跟踪产品 · 体验均分趋势（对内）" data-pdf-chart="yhjp-product-scores">
          <TrendChart
            variant="line"
            allowDecimals
            height={260}
            data={scoreTrend.data}
            areas={scoreTrend.areas}
            referenceLine={{ y: 8, label: '考核基准 8' }}
          />
        </Card>
      )}

      {satTrend.data.length > 0 && (
        <Card size="small" title="重点跟踪产品 · 投诉回访满意度趋势" data-pdf-chart="yhjp-product-satisfaction">
          <TrendChart
            variant="line"
            allowDecimals
            height={260}
            data={satTrend.data}
            areas={satTrend.areas}
            referenceLine={{ y: 88, label: '达标线 88%' }}
          />
        </Card>
      )}

      {actionSignals.length > 0 && (
        <Card
          size="small"
          title="举措推荐（草稿信号）"
          extra={
            <Link to="/actions" className="text-sm">
              前往举措与进展
            </Link>
          }
        >
          <Table
            size="small"
            rowKey={(r) => `${r.type}-${r.productName}-${r.title}`}
            pagination={{ pageSize: 8 }}
            dataSource={actionSignals}
            columns={[
              { title: '优先级', dataIndex: 'priority', width: 72 },
              { title: '产品', dataIndex: 'productName', width: 120 },
              { title: '建议', dataIndex: 'title' },
              { title: '说明', dataIndex: 'detail', ellipsis: true },
            ]}
          />
        </Card>
      )}

      {!hasRatingItems ? (
        <Card>
          <Typography.Text type="secondary">
            当前周期内暂无「{sourceLabel}」渠道明细。请导入短信渠道 + 官网渠道双文件。
          </Typography.Text>
          <Alert
            className="mt-3"
            type="info"
            showIcon
            title="工单回访补全仍可独立存在"
            description="若仅完成了旧版满意度回访补全，上方回访面板仍可展示；渠道口径 KPI 需双文件导入后才有。重点跟踪趋势可先展示历史种子。"
          />
        </Card>
      ) : (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic title="对内体验样本量" value={internalExp.totalSample} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic title="对内体验均分" value={internalExp.avgScore} precision={2} />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic
                  title="对外云网均分（混算）"
                  value={external.yunwang.avgScore}
                  precision={2}
                />
              </Card>
            </Col>
            <Col xs={12} sm={6}>
              <Card>
                <Statistic title="对外云网样本量" value={external.yunwang.totalSample} />
              </Card>
            </Col>
          </Row>

          <Card title="投诉回访满意度（对内，渠道口径 · 与月报一致）" size="small">
            <Table
              size="small"
              rowKey="productName"
              pagination={false}
              columns={satColumns}
              dataSource={internalSat.byProduct}
            />
            {internalSat.notQualified.length > 0 && (
              <Alert
                className="mt-3"
                type="warning"
                showIcon
                title={`不达标（n≥${POST_USE_SMALL_SAMPLE_N} 且 <88%）：${internalSat.notQualified
                  .map((p) => `${p.productName} ${p.rate}%`)
                  .join('、')}`}
              />
            )}
          </Card>

          <Card title="对内体验分·分产品" size="small">
            <Table
              size="small"
              rowKey="productName"
              pagination={false}
              columns={[
                { title: '产品', dataIndex: 'productName' },
                { title: '样本量', dataIndex: 'sampleSize', width: 88 },
                {
                  title: '均分',
                  dataIndex: 'avgScore',
                  width: 88,
                  render: (v, row) => `${v}${row.smallSample ? '（参考）' : ''}`,
                },
              ]}
              dataSource={internalExp.byProduct}
            />
          </Card>

          {reportMonth ? (
            <PostUseMonthlyReportPreview
              reportMonth={reportMonth}
              scoredRows={normalized}
              productNames={productNames}
              visits={visits}
              actionItems={actionItems}
              reasons={monthReasons}
            />
          ) : null}
        </>
      )}
    </div>
  )
}

/** @param {{ id?: string } | null | undefined} period */
function reportMonthSafe(period) {
  if (!period?.id?.includes('period:month:')) return ''
  return period.id.replace('period:month:', '')
}
