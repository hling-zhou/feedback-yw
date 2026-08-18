import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Alert, Button, Card, Col, Collapse, Row, Space, Statistic, Table, Tag, Tooltip, Typography, message } from 'antd'
import { ArrowRightOutlined, DownloadOutlined, PlusOutlined } from '@ant-design/icons'
import TrendChart from '../charts/TrendChart.jsx'
import { ACTION_ITEM_STATUS_LABELS } from '../../domain/actionItem.js'
import { POST_USE_SATISFACTION_BASELINE, POST_USE_SMALL_SAMPLE_N } from '../../lib/postUseRating/metrics.js'
import { qualityAnomaliesToCsv } from '../../lib/postUseRating/qualityStore.js'
import { buildFeedbacksUrl } from '../../lib/feedbackFilters.js'
import PostUseCallbackProcessModal from './PostUseCallbackProcessModal.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { canUsePostUseCallbackList } from '../../domain/auth/permissions.js'

const stateColor = { healthy: 'green', watch: 'gold', critical: 'red', small_sample: 'default' }
const changeColor = { 新增: 'red', 增长: 'volcano', 持续: 'gold', 缓解: 'blue', 消失: 'green' }
const recoveryColor = { recovered: 'green', not_recovered: 'red', pending: 'gold', not_applicable: 'default' }
const actionPriorityColor = { P0: 'red', P1: 'gold', '—': 'default' }

function downloadCsv(text, name) {
  const blob = new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
}

function SectionHeading({ title, summary, id }) {
  return (
    <div id={id} className="pt-2">
      <div className="min-w-0">
        <Typography.Title level={4} className="!mb-0 !text-base">{title}</Typography.Title>
        {summary ? <Typography.Text type="secondary" className="text-xs">{summary}</Typography.Text> : null}
      </div>
    </div>
  )
}

function LimitedTable({ dataSource, limit = 10, ...props }) {
  const [expanded, setExpanded] = useState(false)
  const rows = expanded ? dataSource : dataSource.slice(0, limit)
  return (
    <>
      <Table {...props} dataSource={rows} pagination={false} />
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

function customerFeedbackHref(customerName) {
  const name = String(customerName || '').trim()
  if (!name || name === '匿名客户') return ''
  return buildFeedbacksUrl({
    lane: 'post_use',
    source: 'post_use_rating',
    customerNames: name,
  })
}

export default function PostUseStoryView({ model, creatingSignalKey, onCreateAction }) {
  const [callbackProcessOpen, setCallbackProcessOpen] = useState(false)
  const { user } = useAuth()
  const canOpenCallbackList = canUsePostUseCallbackList(user?.role)
  const { metrics, productOverview, trendsAndChanges, drivers, actionsAndRecovery, quality } = model
  const callbackRecommendations = model.callbackRecommendations || []
  const callbackNonTenRecords = model.callbackNonTenRecords || []
  const exp = metrics.internalExperience
  const sat = metrics.satisfaction
  const yw = metrics.external?.yunwang
  const company = metrics.external?.company
  const scoreDistributionRows = (metrics.nonTenDistributionProducts || []).map((productName) => ({
    productName,
    ...(metrics.scoreDistribution?.[productName] || {}),
  }))
  const actionStatusLabel = (status) => status === 'recommended' ? '待创建' : ACTION_ITEM_STATUS_LABELS[status] || status
  const callbackDownloadDisabled = !callbackRecommendations.length && !callbackNonTenRecords.length
  const callbackDownloadDisabledReason = '当前范围内暂无命中“官网问卷类建议回访”或“投诉回访非10分”的记录'

  return (
    <div className="space-y-5">
      <SectionHeading title="综合结论" summary="先回答所选范围内的整体表现、首要风险、主要变化和行动缺口" id="post-use-conclusions" />
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

      <SectionHeading title="体验现状" summary="统一查看体验评分、投诉回访满意度及产品状态" id="post-use-status" />
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="体验均分" value={exp.avgScore} precision={2} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="体验样本" value={exp.totalSample} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="投诉回访满意度" value={sat.rate} precision={2} suffix="%" /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="投诉回访样本" value={sat.totalSample} /></Card></Col>
      </Row>
      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="云网均分（三渠道）" value={yw?.avgScore} precision={2} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="云网样本量" value={yw?.totalSample} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="公司均分（三渠道）" value={company?.avgScore} precision={2} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="公司样本量" value={company?.totalSample} /></Card></Col>
      </Row>
      <Card size="small" title="产品体验总览">
        <Table
          size="small"
          rowKey="productName"
          scroll={{ x: 1080 }}
          pagination={{ pageSize: 10 }}
          dataSource={productOverview}
          columns={[
            { title: '产品', dataIndex: 'productName', fixed: 'left', width: 145 },
            { title: '状态', dataIndex: 'state', width: 100, render: (value, row) => <Tag color={stateColor[row.stateCode]}>{value}</Tag> },
            { title: '体验均分', dataIndex: 'avgScore', width: 92, render: (value, row) => <span>{value}{row.sampleSize < POST_USE_SMALL_SAMPLE_N ? <Tag className="ml-1">参考</Tag> : null}</span> },
            { title: '体验样本', dataIndex: 'sampleSize', width: 88 },
            { title: '非10分', dataIndex: 'nonTenCount', width: 80 },
            { title: '回访满意度', dataIndex: 'satisfactionRate', width: 116, render: (value, row) => value == null ? '—' : <span>{value}%{row.satisfactionSmallSample ? <Tag className="ml-1">参考</Tag> : null}</span> },
            { title: '回访样本', dataIndex: 'satisfactionSample', width: 88 },
            { title: '主要需求', dataIndex: 'primaryNeed', width: 180, ellipsis: true },
            { title: '客服部回访证据', dataIndex: 'visitEvidenceCount', width: 112, render: (value) => value || '—' },
          ]}
        />
      </Card>
      <Collapse
        items={[
          {
            key: 'score-distribution',
            label: '得分分布详情',
            children: (
              <Table
                size="small"
                rowKey="productName"
                pagination={false}
                dataSource={scoreDistributionRows}
                columns={[
                  { title: '产品名', dataIndex: 'productName', width: 145 },
                  { title: '样本量', dataIndex: 'sampleSize', width: 88 },
                  ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((score) => ({
                    title: `${score}分`,
                    dataIndex: String(score),
                    width: 72,
                  })),
                ]}
                locale={{ emptyText: '当前范围内暂无需要展开分布的产品' }}
              />
            ),
          },
        ]}
      />

      <SectionHeading title="趋势与变化" summary="判断体验是在改善、恶化还是持续" id="post-use-trends" />
      <Row gutter={[12, 12]}>
        <Col xs={24} xl={12}>
          <Card size="small" title="重点产品体验均分趋势" className="h-full">
            {trendsAndChanges.scoreTrend.data.length ? <TrendChart variant="line" allowDecimals height={260} data={trendsAndChanges.scoreTrend.data} areas={trendsAndChanges.scoreTrend.areas} referenceLine={{ y: 9, label: '关注线 9' }} /> : <Alert type="info" showIcon title="当前范围暂无体验趋势" />}
          </Card>
        </Col>
        <Col xs={24} xl={12}>
          <Card size="small" title="重点产品投诉回访满意度趋势" className="h-full">
            {trendsAndChanges.satisfactionTrend.data.length ? <TrendChart variant="line" allowDecimals height={260} data={trendsAndChanges.satisfactionTrend.data} areas={trendsAndChanges.satisfactionTrend.areas} referenceLine={{ y: POST_USE_SATISFACTION_BASELINE * 100, label: '达标线 88%' }} /> : <Alert type="info" showIcon title="当前范围暂无满意度趋势" />}
          </Card>
        </Col>
      </Row>
      <Card size="small" title="问题变化">
        <LimitedTable
          size="small"
          rowKey={(row) => `${row.productName}-${row.issue}`}
          dataSource={trendsAndChanges.changes}
          locale={{ emptyText: '至少需要两个有数据月份才能判断问题变化' }}
          columns={[
            { title: '变化', dataIndex: 'change', width: 86, render: (value) => <Tag color={changeColor[value]}>{value}</Tag> },
            { title: '产品', dataIndex: 'productName', width: 145 },
            { title: '问题/需求', dataIndex: 'issue' },
            { title: '上一对比周期', dataIndex: 'previousCount', width: 112 },
            { title: '当前范围', dataIndex: 'currentCount', width: 88 },
          ]}
        />
      </Card>

      <SectionHeading title="原因与用户需求" summary="从发生位置继续下钻到用户真正需要的改善" id="post-use-drivers" />
      <Card size="small" title="评价触发场景 × 用户旅程">
        <LimitedTable
          size="small"
          rowKey={(row) => `${row.productName}-${row.originalScene}-${row.journey}`}
          dataSource={drivers.sceneJourneys}
          columns={[
            { title: '产品', dataIndex: 'productName', width: 145 },
            { title: '评价触发场景', dataIndex: 'originalScene', width: 180 },
            { title: '用户旅程', dataIndex: 'journey', width: 140 },
            { title: '样本量', dataIndex: 'sampleSize', width: 82 },
            { title: '均分', dataIndex: 'avgScore', width: 76 },
            { title: '非10分', dataIndex: 'nonTenCount', width: 82 },
          ]}
        />
      </Card>
      <Card size="small" title="用户需求改善优先级">
        <LimitedTable
          size="small"
          rowKey={(row) => `${row.productName}-${row.need}`}
          dataSource={drivers.needs}
          columns={[
            { title: '改善优先级', dataIndex: 'priority', width: 104, render: (value) => <Tag color={value === 'P0' ? 'red' : value === 'P1' ? 'gold' : 'default'}>{value}</Tag> },
            { title: '产品', dataIndex: 'productName', width: 145 },
            { title: '用户需求', dataIndex: 'need', width: 210 },
            { title: '反馈数', dataIndex: 'count', width: 82 },
            { title: '客户数', dataIndex: 'customerCount', width: 82 },
            { title: '回访证据', dataIndex: 'visitEvidenceCount', width: 88, render: (value) => value || '—' },
            { title: '改善优先分', dataIndex: 'priorityScore', width: 104 },
            { title: '判定依据', dataIndex: 'explanation' },
          ]}
        />
      </Card>

      <SectionHeading title="客户与证据" summary="识别受影响客户，并合并反馈原因与客服部回访结论" id="post-use-customers" />
      <Card
        size="small"
        extra={
          canOpenCallbackList ? (
          <Tooltip title={callbackDownloadDisabled ? callbackDownloadDisabledReason : ''}>
            <span>
              <Button
                size="small"
                icon={<DownloadOutlined />}
                disabled={callbackDownloadDisabled}
                onClick={() => {
                  if (!callbackRecommendations.length && !callbackNonTenRecords.length) {
                    message.info('当前范围内暂无建议回访/溯源记录')
                    return
                  }
                  setCallbackProcessOpen(true)
                }}
              >
                查看并处理建议回访/溯源清单
              </Button>
            </span>
          </Tooltip>
          ) : null
        }
      >
        <LimitedTable
          size="small"
          rowKey={(row) => row.customerCode || `${row.customerName}-${row.products.join(',')}`}
          dataSource={drivers.customers}
          scroll={{ x: 1000 }}
          columns={[
            {
              title: '客户',
              dataIndex: 'customerName',
              width: 190,
              render: (value) => {
                const href = customerFeedbackHref(value)
                if (!href) return value || '—'
                return <Link to={href}>{value}</Link>
              },
            },
            { title: '涉及产品', dataIndex: 'products', width: 180, render: (value) => value.join('、') },
            { title: '非10分', dataIndex: 'nonTenCount', width: 80 },
            { title: '均分', dataIndex: 'avgScore', width: 76, render: (value) => value == null ? '—' : value },
            { title: '客户特征', width: 100, render: (_, row) => row.highFrequency ? <Tag color="red">高频低分</Tag> : row.visitEvidenceCount && !row.nonTenCount ? <Tag color="blue">仅回访证据</Tag> : <Tag>单次反馈</Tag> },
            { title: '反馈原因', dataIndex: 'latestQuote', ellipsis: true },
            { title: '回访证据', dataIndex: 'visitEvidenceCount', width: 88, render: (value) => value || '—' },
            { title: '回访结论', dataIndex: 'visitConclusion', width: 180, ellipsis: true },
          ]}
        />
      </Card>
      <Card size="small" title="高频低分原因">
        <LimitedTable
          size="small"
          rowKey={(row) => row.id}
          dataSource={drivers.highFrequencyLowScoreReasons || []}
          scroll={{ x: 980 }}
          locale={{ emptyText: '当前范围内暂无命中 高频低分原因规则 的记录' }}
          columns={[
            { title: '低分反馈', dataIndex: 'lowScoreFeedback', width: 260, ellipsis: true },
            { title: '产品名', dataIndex: 'productName', width: 145 },
            { title: '得分', dataIndex: 'score', width: 76 },
            { title: '低分反馈次数', dataIndex: 'feedbackCount', width: 108 },
            { title: '集团客户名称', dataIndex: 'customerName', width: 180, ellipsis: true },
            { title: '集团客户编码', dataIndex: 'customerCode', width: 140, render: (value) => value || '—' },
            { title: '客户标识', dataIndex: 'customerTag', width: 88, render: (value) => value ? <Tag color="red">{value}</Tag> : '—' },
          ]}
        />
      </Card>

      <SectionHeading title="行动" summary="先识别触发推进的风险信号，再把上游主题转成可落地举措" id="post-use-actions" />
      {actionsAndRecovery.triggerGroups?.length ? (
        <Card size="small" title="行动触发摘要">
          <Row gutter={[12, 12]}>
            {actionsAndRecovery.triggerGroups.map((row) => (
              <Col xs={24} md={12} xl={8} key={row.productName}>
                <Card size="small" className="h-full bg-ink-50/50">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Typography.Text strong>{row.productName}</Typography.Text>
                    <Tag color={actionPriorityColor[row.priority] || 'default'}>{row.priority}</Tag>
                    {row.criticalLowScoreSignal ? <Tag color="red">极低分</Tag> : null}
                    {row.satisfactionSignal ? <Tag color="volcano">回访未达标</Tag> : null}
                    {row.experienceSignal ? <Tag color="gold">体验偏低</Tag> : null}
                    {row.callbackNonTenCount ? <Tag color="purple">非10分回访 {row.callbackNonTenCount}</Tag> : null}
                  </div>
                  <div className="space-y-2">
                    {row.criticalLowScoreSignal ? (
                      <Typography.Paragraph className="!mb-0 text-xs">
                        {row.criticalLowScoreSignal.detail}
                      </Typography.Paragraph>
                    ) : null}
                    {row.satisfactionSignal ? (
                      <Typography.Paragraph className="!mb-0 text-xs">
                        {row.satisfactionSignal.detail}
                      </Typography.Paragraph>
                    ) : null}
                    {row.experienceSignal ? (
                      <Typography.Paragraph className="!mb-0 text-xs">
                        {row.experienceSignal.detail}
                      </Typography.Paragraph>
                    ) : null}
                    {row.callbackNonTenCount ? (
                      <Typography.Paragraph className="!mb-0 text-xs">
                        投诉回访非10分 {row.callbackNonTenCount} 条
                        {row.callbackExamples?.length ? `；例如：${row.callbackExamples.join('；')}` : ''}
                      </Typography.Paragraph>
                    ) : null}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>
      ) : null}
      <Card size="small" title="主题级行动建议">
        <LimitedTable
          size="small"
          rowKey="id"
          dataSource={actionsAndRecovery.rows}
          scroll={{ x: 1400 }}
          columns={[
            {
              title: '优先级',
              dataIndex: 'priority',
              width: 82,
              render: (value) => <Tag color={actionPriorityColor[value] || 'default'}>{value}</Tag>,
            },
            { title: '产品', dataIndex: 'productName', width: 145 },
            { title: '待改议题', dataIndex: 'theme', width: 190, ellipsis: true },
            { title: '反馈数', dataIndex: 'feedbackCount', width: 82, render: (value) => value ?? '—' },
            { title: '客户数', dataIndex: 'customerCount', width: 82, render: (value) => value ?? '—' },
            { title: '回访证据', dataIndex: 'visitEvidenceCount', width: 92, render: (value) => value ?? '—' },
            {
              title: '变化',
              width: 110,
              render: (_, row) =>
                row.change ? (
                  <div>
                    <Tag color={changeColor[row.change] || 'default'}>{row.change}</Tag>
                    {row.changeDetail ? (
                      <Typography.Text type="secondary" className="block text-xs">
                        {row.changeDetail}
                      </Typography.Text>
                    ) : null}
                  </div>
                ) : '—',
            },
            {
              title: '建议动作 / 举措',
              width: 240,
              render: (_, row) => (
                <Typography.Paragraph className="!mb-0 line-clamp-2 text-xs">
                  {row.action?.content || row.title}
                </Typography.Paragraph>
              ),
            },
            {
              title: '依据',
              width: 260,
              render: (_, row) => (
                <Typography.Paragraph className="!mb-0 line-clamp-3 text-xs text-secondary">
                  {row.detail || '—'}
                </Typography.Paragraph>
              ),
            },
            { title: '状态', dataIndex: 'status', width: 100, render: (value) => <Tag color={value === 'recommended' ? 'gold' : 'blue'}>{actionStatusLabel(value)}</Tag> },
            {
              title: '操作',
              width: 108,
              render: (_, row) =>
                row.status === 'recommended' && row.signal?.linkedInsightIds?.length ? (
                  <Button type="link" size="small" icon={<PlusOutlined />} loading={creatingSignalKey === `${row.signal.type}-${row.signal.productName}-${row.signal.title}`} onClick={() => onCreateAction(row.signal)}>创建举措</Button>
                ) : (
                  <Button type="link" size="small" href="/actions" icon={<ArrowRightOutlined />}>查看</Button>
                ),
            },
          ]}
        />
      </Card>

      <SectionHeading title="效果验证" summary="举措完成不等于体验恢复" id="post-use-recovery" />
      <Card size="small">
        <LimitedTable
          size="small"
          rowKey="id"
          dataSource={actionsAndRecovery.recoveryRows}
          locale={{ emptyText: '暂无已完成且可验证的举措' }}
          columns={[
            { title: '产品', dataIndex: 'productName', width: 145 },
            { title: '举措', dataIndex: 'content' },
            { title: '验证结果', width: 100, render: (_, row) => <Tag color={recoveryColor[row.validation.status]}>{row.validation.label}</Tag> },
            { title: '前后对比', width: 300, render: (_, row) => row.validation.explanation },
          ]}
        />
        {actionsAndRecovery.notRecovered ? <Alert className="mt-3" type="warning" showIcon title={`${actionsAndRecovery.notRecovered} 项举措已完成但体验未恢复`} /> : null}
      </Card>

      <SectionHeading title="分析附录" id="post-use-appendix" />
      <Collapse
        items={[
          {
            key: 'method',
            label: '数据质量与指标口径',
            children: (
              <div className="space-y-3">
                <Typography.Paragraph className="!mb-0" type="secondary">
                  体验均分使用短信与控制台评价（云网 16 款）；云网均分（三渠道）为短信、控制台与投诉回访混算（云网 16 款）；公司均分（三渠道）为当期全部产品、主子合并后的记录级平均。投诉回访单独计算 10 分满意度，达标线 88%；n&lt;{POST_USE_SMALL_SAMPLE_N} 通常仅作参考，但若出现 3 分及以下极低分，仍按重点风险关注。客服部回访只作为补充证据，不改变评分和需求改善优先级。
                </Typography.Paragraph>
                <Space size={[6, 6]} wrap>
                  <Tag>目录 {model.scope.catalogVersion}</Tag>
                  <Tag>分析规则 {model.scope.ruleVersion}</Tag>
                  {quality?.snapshotAvailable ? <><Tag>原始 {quality.counts.raw || 0}</Tag><Tag>范围内 {quality.counts.analysisScoped || 0}</Tag><Tag>范围外 {quality.counts.outOfScope || 0}</Tag><Tag>缺场景 {quality.counts.missingOriginalScene || 0}</Tag></> : <Tag color="gold">未生成质量快照</Tag>}
                  <Tag color={quality?.counts?.unclassifiedNeed ? 'gold' : 'default'}>未识别需求 {quality?.counts?.unclassifiedNeed || 0}</Tag>
                </Space>
                {quality?.anomalies?.length ? <Button icon={<DownloadOutlined />} onClick={() => downloadCsv(qualityAnomaliesToCsv(quality), `用后即评数据异常-${quality.importMonth}.csv`)}>下载异常明细</Button> : null}
              </div>
            ),
          },
        ]}
      />
      <PostUseCallbackProcessModal
        open={callbackProcessOpen}
        onClose={() => setCallbackProcessOpen(false)}
        recommendations={callbackRecommendations}
        callbackNonTenRecords={callbackNonTenRecords}
        scopeLabel={model.scope.periodLabel}
      />
    </div>
  )
}
