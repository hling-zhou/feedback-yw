import { useState } from 'react'
import { Alert, Button, Card, Col, Empty, Collapse, Row, Space, Statistic, Table, Tag, Typography } from 'antd'
import { ArrowRightOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import TrendChart from '../charts/TrendChart.jsx'
import ThemeBarChart from '../charts/ThemeBarChart.jsx'
import { ACTION_ITEM_STATUS_LABELS } from '../../domain/actionItem.js'
import { ticketQualityAnomaliesToCsv } from '../../lib/ticketStoryModel.js'

const changeColors = { 新增: 'red', 增长: 'volcano', 持续: 'gold', 缓解: 'blue', 消失: 'green' }
const priorityColors = { high: 'red', medium: 'gold', low: 'default' }
const recoveryColors = { recovered: 'green', not_recovered: 'red', pending: 'gold' }
const impactRiskColors = { high: 'red', medium: 'gold', low: 'default' }
const impactSignalColors = { 高价值客户: 'gold', 负向情绪: 'red', 紧急催办: 'volcano', 回访未解决: 'purple' }

function SectionHeading({ title, summary, id }) {
  return (
    <div id={id} className="pt-2">
      <Typography.Title level={4} className="!mb-0 !text-base">{title}</Typography.Title>
      {summary ? <Typography.Text type="secondary" className="text-xs">{summary}</Typography.Text> : null}
    </div>
  )
}

function LimitedTable({ dataSource = [], limit = 10, ...props }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <>
      <Table {...props} dataSource={expanded ? dataSource : dataSource.slice(0, limit)} pagination={false} />
      {dataSource.length > limit ? (
        <div className="mt-2 text-center">
          <Button type="link" size="small" onClick={() => setExpanded((value) => !value)}>
            {expanded ? '收起' : `查看全部 ${dataSource.length} 项`}
          </Button>
        </div>
      ) : null}
    </>
  )
}

function downloadCsv(text, name) {
  const blob = new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function evidenceHref(sourceType, ticketIds) {
  const params = new URLSearchParams({ source: sourceType })
  if (ticketIds?.length) params.set('ticketIds', ticketIds.join(','))
  return `/feedbacks?${params.toString()}`
}

function themeEvidenceAnchor(themeId) {
  return `ticket-evidence-theme-${String(themeId || '').replace(/[^a-zA-Z0-9_-]+/g, '-')}`
}

function DriverEmptyState({ state, fallbackOnly = false }) {
  const title = state?.title || (fallbackOnly ? '当前范围未形成正式 V2 聚类' : '当前范围暂无可展示结果')
  const description = state?.description || (fallbackOnly
    ? '当前范围仅命中小样本参考项，暂未形成正式痛点聚类。'
    : '当前范围未形成正式痛点聚类或小样本参考项。')
  const type = state?.alertType || 'info'

  return (
    <div className="space-y-4 py-4">
      <Alert showIcon type={type} title={title} description={description} />
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无正式痛点聚类结果" />
    </div>
  )
}

export default function TicketStoryView({ model, creatingInsightId, onCreateAction, onOpenFeedback }) {
  const { scope, overview, trendsAndChanges, drivers, impactAndEvidence, actionsAndRecovery, quality } = model
  const complaint = scope.sourceType === 'complaint_ticket'
  const metrics = overview.metrics
  const hierarchyRows = drivers.locationRows
  const formalClusters = drivers.clusters || []
  const fallbackReferences = drivers.fallbackReferences || []
  const driversEmptyState = drivers.emptyState || null
  const impactSummary = impactAndEvidence.summary || null
  const impactThemeLinks = impactAndEvidence.themeLinks || []

  return (
    <div className="space-y-5">
      <SectionHeading title="综合结论" summary="先回答整体状态、首要风险或机会、主要变化和行动缺口" id="ticket-conclusions" />
      <Row gutter={[12, 12]}>
        {model.conclusions.map((item) => (
          <Col xs={24} md={12} xl={6} key={item.key}>
            <Card size="small" className="h-full">
              <Typography.Text type="secondary" className="text-xs">{item.label}</Typography.Text>
              <Typography.Title level={5} className="!mb-1 !mt-2 !text-sm">{item.value}</Typography.Title>
              <Typography.Text type="secondary" className="text-xs">{item.detail}</Typography.Text>
              <div className="mt-2"><Typography.Link href={item.target} className="text-xs">查看依据 <ArrowRightOutlined /></Typography.Link></div>
            </Card>
          </Col>
        ))}
      </Row>

      <SectionHeading title="规模与体验现状" summary={complaint ? '衡量投诉规模、体验风险和问题解决情况' : '衡量咨询负担及可转化为产品与自助能力的机会'} id="ticket-status" />
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="工单量" value={metrics.total} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="负向占比" value={metrics.negativePct} suffix="%" /></Card></Col>
        {complaint ? (
          <>
            <Col xs={12} md={6}><Card size="small"><Statistic title="客户体验类投诉" value={metrics.customerExperienceComplaintCount} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="回访未解决" value={metrics.unresolvedCount} suffix={metrics.followUpCount ? `/ ${metrics.followUpCount}` : ''} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="回访10分满意率" value={metrics.followUpTenPointRate} suffix="%" /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="紧急工单" value={metrics.urgentCount} /></Card></Col>
          </>
        ) : (
          <>
            <Col xs={12} md={6}><Card size="small"><Statistic title="重复咨询占比" value={metrics.repeatConsultationPct} suffix="%" /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="自助优化机会占比" value={metrics.selfServicePct} suffix="%" /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="高频咨询主题" value={metrics.highFrequencyTopicCount} /></Card></Col>
            <Col xs={12} md={6}><Card size="small"><Statistic title="紧急工单" value={metrics.urgentCount} /></Card></Col>
          </>
        )}
      </Row>
      <Card size="small" title="产品总览">
        <Table
          size="small"
          rowKey="product"
          scroll={{ x: 1050 }}
          pagination={{ pageSize: 10 }}
          dataSource={overview.productOverview}
          columns={[
            { title: '产品', dataIndex: 'product', fixed: 'left', width: 150 },
            { title: '工单量', dataIndex: 'count', width: 82, render: (value, row) => <span>{value}{row.smallSample ? <Tag className="ml-1">参考</Tag> : null}</span> },
            { title: '占比', dataIndex: 'sharePct', width: 76, render: (value) => `${value}%` },
            { title: '最新月变化', dataIndex: 'delta', width: 104, render: (value) => value == null ? '暂无对比' : `${value >= 0 ? '+' : ''}${value}` },
            { title: '负向', dataIndex: 'negativePct', width: 82, render: (value, row) => `${row.negativeCount}（${value}%）` },
            ...(complaint ? [{ title: '万投比', dataIndex: 'wanTouRatio', width: 92, render: (value, row) => value == null ? '—' : <span>{value.toFixed(2)}{row.wanTouTargetMet === false ? <Tag color="red" className="ml-1">未达标</Tag> : null}</span> }] : []),
            { title: '首要问题', dataIndex: 'primaryProblem', width: 210, ellipsis: true },
            { title: '主要旅程', dataIndex: 'primaryJourney', width: 130 },
            { title: '回访证据', dataIndex: 'followUpEvidence', width: 88 },
            { title: '举措状态', dataIndex: 'actionStatus', width: 100 },
          ]}
        />
      </Card>

      <SectionHeading title="趋势与变化" summary="判断规模和重点问题是在增长、持续还是缓解" id="ticket-trends" />
      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="工单量趋势" className="h-full">
            <TrendChart height={260} variant="line" data={trendsAndChanges.volumeTrend} areas={[{ dataKey: 'count', name: '工单量', stroke: '#4F46E5' }, { dataKey: 'negative', name: '负向工单', stroke: '#EF4444' }]} />
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          {complaint ? (
            <Card size="small" title="客户体验类万投比趋势" className="h-full">
              {overview.wanTou.productKey ? (
                <TrendChart height={260} variant="line" allowDecimals data={overview.wanTou.trend} areas={[{ dataKey: 'ratio', name: '万投比', stroke: '#0D9488' }]} referenceLine={overview.wanTou.evaluation?.target != null ? { y: overview.wanTou.evaluation.target, label: `目标 ${overview.wanTou.evaluation.target}` } : null} />
              ) : <Alert type="info" showIcon title="选择具体产品后查看万投比及目标差距" />}
            </Card>
          ) : (
            <Card size="small" title="负向占比趋势" className="h-full">
              <TrendChart height={260} variant="line" allowDecimals data={trendsAndChanges.volumeTrend} areas={[{ dataKey: 'negativePct', name: '负向占比（%）', stroke: '#DC2626' }]} />
            </Card>
          )}
        </Col>
      </Row>
      <Card size="small" title="问题变化">
        <LimitedTable
          size="small"
          rowKey="key"
          dataSource={trendsAndChanges.changes}
          locale={{ emptyText: '至少需要两个有数据月份才能判断问题变化' }}
          columns={[
            { title: '变化', dataIndex: 'change', width: 82, render: (value) => <Tag color={changeColors[value]}>{value}</Tag> },
            { title: '产品', dataIndex: 'product', width: 150 },
            { title: '问题类型', dataIndex: 'problemType', width: 170 },
            { title: '用户旅程', dataIndex: 'journey', width: 130 },
            { title: '上一有数据月', dataIndex: 'previousCount', width: 112 },
            { title: '当前有数据月', dataIndex: 'currentCount', width: 112 },
            { title: '证据', width: 76, render: (_, row) => <Button type="link" size="small" href={evidenceHref(scope.sourceType, row.ticketIds)}>查看</Button> },
          ]}
        />
      </Card>

      <SectionHeading title="问题发生位置" summary="从请求场景沿用户旅程下钻到问题类型" id="ticket-location" />
      <Card size="small" title="请求场景 → 用户旅程 → 问题类型">
        <LimitedTable
          size="small"
          rowKey="key"
          dataSource={hierarchyRows}
          columns={[
            { title: '请求场景', dataIndex: 'scene', width: 170 },
            { title: '一级旅程', dataIndex: 'journeyL1', width: 150 },
            { title: '二级旅程', dataIndex: 'journeyL2', width: 170 },
            { title: '主要问题类型', dataIndex: 'problemType', width: 180 },
            { title: '工单数', dataIndex: 'count', width: 82 },
            { title: '证据', width: 76, render: (_, row) => <Button type="link" size="small" href={evidenceHref(scope.sourceType, row.ticketIds)}>查看</Button> },
          ]}
        />
      </Card>
      {complaint ? (
        <Card size="small" title="投诉原因（终判）">
          <Typography.Text type="secondary" className="mb-3 block text-xs">终判投诉原因来自工单业务口径，与系统自动打标的“问题类型”不同。</Typography.Text>
          <ThemeBarChart data={drivers.complaintCauses.map((row) => ({ label: row.name, count: row.count, negative: 0 }))} />
        </Card>
      ) : null}

      <SectionHeading title="原因与用户需求" summary="以痛点聚类解释用户遇到了什么、为何值得改善" id="ticket-drivers" />
      {!complaint ? (
        <Card size="small" title="咨询优化机会">
          <ThemeBarChart data={drivers.opportunities.map((row) => ({ label: row.name, count: row.count, negative: 0 }))} />
        </Card>
      ) : null}
      <Card size="small" title="正式痛点聚类（V2）">
        {formalClusters.length ? (
          <LimitedTable
            size="small"
            rowKey="id"
            dataSource={formalClusters}
            scroll={{ x: 1250 }}
            columns={[
              { title: '改善优先级', dataIndex: 'priority', fixed: 'left', width: 104, render: (value) => <Tag color={priorityColors[value]}>{value === 'high' ? '高' : value === 'medium' ? '中' : '低'}</Tag> },
              { title: '产品', dataIndex: 'product', width: 150 },
              { title: '用户需求/痛点', dataIndex: 'pain', width: 240, ellipsis: true },
              { title: '客户请求摘要', dataIndex: 'customerRequest', width: 220, ellipsis: true },
              { title: '根因', dataIndex: 'rootCause', width: 190, ellipsis: true },
              { title: '反馈数', dataIndex: 'ticketCount', width: 82 },
              { title: '产品内占比', dataIndex: 'sharePct', width: 96, render: (value) => `${Number(value || 0).toFixed(1)}%` },
              { title: '广度分', dataIndex: 'breadthScore', width: 76 },
              { title: '严重度', dataIndex: 'severity', width: 76 },
              { title: 'P90情绪', dataIndex: 'emotion', width: 88 },
              { title: '改善优先分', dataIndex: 'priorityScore', width: 104, render: (value) => typeof value === 'number' ? value.toFixed(2) : value },
              { title: '依据', dataIndex: 'basis', width: 240, ellipsis: true },
            ]}
          />
        ) : (
          <DriverEmptyState state={driversEmptyState} fallbackOnly={fallbackReferences.length > 0} />
        )}
      </Card>
      {fallbackReferences.length ? (
        <Card size="small" title="小样本参考项">
          <LimitedTable
            size="small"
            rowKey="id"
            dataSource={fallbackReferences}
            scroll={{ x: 1100 }}
            columns={[
              { title: '类型', width: 110, render: () => <Tag color="warning">推断型</Tag> },
              { title: '产品', dataIndex: 'product', width: 150 },
              { title: '参考主题', dataIndex: 'pain', width: 260, ellipsis: true },
              { title: '客户请求摘要', dataIndex: 'customerRequest', width: 220, ellipsis: true },
              { title: '根因', dataIndex: 'rootCause', width: 190, ellipsis: true },
              { title: '反馈数', dataIndex: 'ticketCount', width: 82 },
              { title: '产品内占比', dataIndex: 'sharePct', width: 96, render: (value) => `${Number(value || 0).toFixed(1)}%` },
              { title: '依据', dataIndex: 'basis', width: 260, ellipsis: true },
            ]}
          />
        </Card>
      ) : null}

      <SectionHeading title="影响与证据" summary="围绕上游主题解释为什么这些问题现在需要重点关注" id="ticket-evidence" />
      <Space size={[8, 8]} wrap>
        <Tag color="gold">高价值客户 {impactAndEvidence.highValueCount}</Tag>
        <Tag color="red">强负向 {impactAndEvidence.strongNegativeCount}</Tag>
        <Tag color="volcano">紧急催办 {impactAndEvidence.urgentCount}</Tag>
        <Tag color="purple">回访未解决 {impactAndEvidence.unresolvedCount}</Tag>
      </Space>
      <Card size="small" title="重点关注">
        {impactSummary?.status === 'empty' ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={impactSummary?.executiveSummary || '当前范围暂无重点关注主题'} />
        ) : (
          <div className="space-y-4">
            {impactSummary?.status === 'evidence_only' ? (
              <Alert
                showIcon
                type="info"
                title="当前未形成稳定主题"
                description={impactSummary?.executiveSummary}
              />
            ) : null}
            {impactSummary?.status === 'theme_without_evidence' ? (
              <Alert
                showIcon
                type="info"
                title="已识别主题，但当前未命中高风险证据"
                description={impactSummary?.executiveSummary}
              />
            ) : null}
            {impactSummary?.status !== 'evidence_only' && impactSummary?.status !== 'theme_without_evidence' ? (
              <Typography.Paragraph className="!mb-0">
                {impactSummary?.executiveSummary || '当前范围暂无可展示总结。'}
              </Typography.Paragraph>
            ) : null}
            {impactSummary?.focusItems?.length ? (
              <Row gutter={[12, 12]}>
                {impactSummary.focusItems.map((item) => (
                  <Col xs={24} md={12} key={item.themeId}>
                    <Card size="small" className="h-full">
                      <Space size={[6, 6]} wrap>
                        <Tag color={impactRiskColors[item.riskLevel] || 'default'}>
                          {item.riskLevel === 'high' ? '高风险' : item.riskLevel === 'medium' ? '中风险' : '低风险'}
                        </Tag>
                        {item.inferred ? <Tag color="warning">推断型</Tag> : null}
                        {item.riskSignals.map((signal) => (
                          <Tag key={signal} color={impactSignalColors[signal] || 'default'}>
                            {signal}
                          </Tag>
                        ))}
                      </Space>
                      <Typography.Title level={5} className="!mb-2 !mt-3 !text-sm">
                        {item.themeLabel}
                      </Typography.Title>
                      <Typography.Paragraph className="!mb-2 text-xs">
                        {item.summary}
                      </Typography.Paragraph>
                      {item.evidenceRecordIds?.length ? (
                        <Typography.Link href={`#${themeEvidenceAnchor(item.themeId)}`} className="text-xs">
                          查看该主题证据 <ArrowRightOutlined />
                        </Typography.Link>
                      ) : null}
                    </Card>
                  </Col>
                ))}
              </Row>
            ) : null}
          </div>
        )}
      </Card>
      {impactThemeLinks.length ? (
        <Card size="small" title="主题证据">
          <div className="space-y-5">
            {impactThemeLinks.map((link, index) => (
              <div
                key={link.themeId}
                id={themeEvidenceAnchor(link.themeId)}
                className={index < impactThemeLinks.length - 1 ? 'border-b border-gray-100 pb-5' : ''}
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <Typography.Title level={5} className="!mb-0 !text-sm">
                    {link.themeLabel}
                  </Typography.Title>
                  <Tag color={impactRiskColors[link.riskLevel] || 'default'}>
                    {link.riskLevel === 'high' ? '高风险' : link.riskLevel === 'medium' ? '中风险' : '低风险'}
                  </Tag>
                  {link.inferred ? <Tag color="warning">推断型</Tag> : null}
                  {link.impactSignals.highValueCount ? <Tag color="gold">高价值 {link.impactSignals.highValueCount}</Tag> : null}
                  {link.impactSignals.negativeCount ? <Tag color="red">负向 {link.impactSignals.negativeCount}</Tag> : null}
                  {link.impactSignals.urgentCount ? <Tag color="volcano">紧急 {link.impactSignals.urgentCount}</Tag> : null}
                  {link.impactSignals.unresolvedCount ? <Tag color="purple">未解决 {link.impactSignals.unresolvedCount}</Tag> : null}
                </div>
                <LimitedTable
                  className="ticket-evidence-table"
                  size="small"
                  rowKey="id"
                  dataSource={link.records}
                  tableLayout="fixed"
                  scroll={{ x: 1200 }}
                  columns={[
                    {
                      title: '工单号',
                      dataIndex: 'ticketId',
                      fixed: 'left',
                      width: 220,
                      render: (value, row) => (
                        <Button
                          type="link"
                          size="small"
                          className="ticket-evidence-table__ticket-link"
                          onClick={() => onOpenFeedback?.(row)}
                        >
                          {value || row.id}
                        </Button>
                      ),
                    },
                    { title: '产品', width: 150, render: (_, row) => row.product || row.productSpec || '未标注产品' },
                    { title: '客户等级', dataIndex: 'customerTier', width: 88, render: (value) => value || '—' },
                    { title: '客户请求', dataIndex: 'customerRequest', width: 230, ellipsis: true },
                    { title: '需求痛点', width: 220, ellipsis: true, render: (_, row) => row.painPoint || row.problemSummary || '—' },
                    { title: '根因', width: 190, ellipsis: true, render: (_, row) => row.rootCauseReview || row.rootCause || '—' },
                    { title: '解决方案', dataIndex: 'solutionSummary', width: 190, ellipsis: true },
                    { title: '回访', width: 120, render: (_, row) => row.followUpSatisfaction ? `${row.followUpSatisfaction.score ?? '—'}分 · ${row.followUpSatisfaction.problemResolved === 'unresolved' ? '未解决' : row.followUpSatisfaction.problemResolved === 'resolved' ? '已解决' : '未确认'}` : '—' },
                  ]}
                />
              </div>
            ))}
          </div>
        </Card>
      ) : impactSummary?.status === 'evidence_only' ? (
        <Card size="small" title="高风险信号证据">
          <LimitedTable
            className="ticket-evidence-table"
            size="small"
            rowKey="id"
            dataSource={impactAndEvidence.records}
            tableLayout="fixed"
            scroll={{ x: 1200 }}
            columns={[
              {
                title: '工单号',
                dataIndex: 'ticketId',
                fixed: 'left',
                width: 220,
                render: (value, row) => (
                  <Button
                    type="link"
                    size="small"
                    className="ticket-evidence-table__ticket-link"
                    onClick={() => onOpenFeedback?.(row)}
                  >
                    {value || row.id}
                  </Button>
                ),
              },
              { title: '产品', width: 150, render: (_, row) => row.product || row.productSpec || '未标注产品' },
              { title: '客户等级', dataIndex: 'customerTier', width: 88, render: (value) => value || '—' },
              { title: '客户请求', dataIndex: 'customerRequest', width: 230, ellipsis: true },
              { title: '需求痛点', width: 220, ellipsis: true, render: (_, row) => row.painPoint || row.problemSummary || '—' },
              { title: '根因', width: 190, ellipsis: true, render: (_, row) => row.rootCauseReview || row.rootCause || '—' },
              { title: '解决方案', dataIndex: 'solutionSummary', width: 190, ellipsis: true },
              { title: '回访', width: 120, render: (_, row) => row.followUpSatisfaction ? `${row.followUpSatisfaction.score ?? '—'}分 · ${row.followUpSatisfaction.problemResolved === 'unresolved' ? '未解决' : row.followUpSatisfaction.problemResolved === 'resolved' ? '已解决' : '未确认'}` : '—' },
            ]}
          />
        </Card>
      ) : null}

      <SectionHeading title="行动与效果验证" summary="将问题转成举措，并用后续周期数据判断是否真正改善" id="ticket-actions" />
      <Card size="small" title="问题与行动">
        <LimitedTable
          size="small"
          rowKey="id"
          dataSource={actionsAndRecovery.rows}
          scroll={{ x: 1000 }}
          columns={[
            { title: '优先级', dataIndex: 'priority', width: 82, render: (value) => <Tag color={priorityColors[value]}>{value === 'high' ? '高' : value === 'medium' ? '中' : '低'}</Tag> },
            { title: '产品', dataIndex: 'product', width: 150 },
            { title: '问题', dataIndex: 'pain', width: 250, ellipsis: true },
            { title: '证据', dataIndex: 'ticketCount', width: 76 },
            { title: '举措', width: 220, ellipsis: true, render: (_, row) => row.action?.content || '尚未创建举措' },
            { title: '状态', dataIndex: 'actionStatus', width: 100 },
            { title: '排期', width: 120, render: (_, row) => row.action?.scheduleAt || '—' },
            { title: '操作', fixed: 'right', width: 108, render: (_, row) => row.action ? <Button type="link" size="small" href="/actions">查看举措</Button> : <Button type="link" size="small" icon={<PlusOutlined />} loading={creatingInsightId === row.insightId} onClick={() => onCreateAction?.(row)}>创建举措</Button> },
          ]}
        />
      </Card>
      <Card size="small" title="效果验证">
        <LimitedTable
          size="small"
          rowKey="id"
          dataSource={actionsAndRecovery.recoveryRows}
          locale={{ emptyText: '暂无已完成且可验证的举措' }}
          columns={[
            { title: '产品', dataIndex: 'productName', width: 150 },
            { title: '举措', dataIndex: 'content' },
            { title: '验证结果', width: 100, render: (_, row) => <Tag color={recoveryColors[row.validation.status] || 'default'}>{row.validation.label || '待验证'}</Tag> },
            { title: '判定依据', width: 320, render: (_, row) => row.validation.explanation || '需要后续周期数据' },
          ]}
        />
        {actionsAndRecovery.notImproved ? <Alert className="mt-3" type="warning" showIcon title={`${actionsAndRecovery.notImproved} 项举措已完成但问题未改善`} /> : null}
      </Card>

      <SectionHeading title="分析附录" id="ticket-appendix" />
      <Collapse items={[{
        key: 'quality',
        label: '数据质量与分析口径',
        children: (
          <div className="space-y-3">
            <Typography.Paragraph type="secondary" className="!mb-0">当前聚类已升级为 profile-aware V2.3：投诉、咨询、概览分别使用不同评分模型；正式聚类之外，会补充高危 singleton 与小样本参考项。客户等级、紧急、未解决等信号已进入投诉/咨询评分或影响说明，不再只是附属证据。系统没有可靠的实际处理时长字段，因此不展示 SLA 或平均处理时长。</Typography.Paragraph>
            <Space size={[6, 6]} wrap>
              <Tag>Pipeline {quality.pipelineVersion}</Tag><Tag>聚类 {quality.clusteringVersion}</Tag><Tag>标签库 {quality.tagLibraryVersion}</Tag>
              <Tag color={quality.counts.missingRequestScene ? 'gold' : 'default'}>缺请求场景 {quality.counts.missingRequestScene}</Tag>
              <Tag color={quality.counts.missingProblemType ? 'gold' : 'default'}>缺问题类型 {quality.counts.missingProblemType}</Tag>
              <Tag color={quality.counts.missingJourney ? 'gold' : 'default'}>未识别旅程 {quality.counts.missingJourney}</Tag>
              <Tag color={quality.counts.missingPain ? 'gold' : 'default'}>缺需求痛点 {quality.counts.missingPain}</Tag>
            </Space>
            {quality.anomalies.length ? <Button icon={<DownloadOutlined />} onClick={() => downloadCsv(ticketQualityAnomaliesToCsv(quality), `${scope.sourceLabel}-数据异常.csv`)}>下载异常工单</Button> : null}
          </div>
        ),
      }]} />
    </div>
  )
}
