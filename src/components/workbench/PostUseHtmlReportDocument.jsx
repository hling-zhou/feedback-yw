import { useEffect, useState } from 'react'
import { Alert, Checkbox, Collapse, Input, Table, Tag, Typography } from 'antd'
import {
  REPORT_SECTION_APPENDIX,
  REPORT_SECTION_PREVIOUS_VISITS,
  REPORT_SECTION_PRODUCTS,
  REPORT_SECTION_TODO,
} from '../../lib/postUseRating/htmlReportModel.js'
import { buildFeedbacksUrl } from '../../lib/feedbackFilters.js'
import TrendChart from '../charts/TrendChart.jsx'
import { FocusProductTrendCharts, StatusOverviewChart } from './PostUseHtmlReportCharts.jsx'

const WORKBENCH_HREF = '/workbench?tab=post_use_rating'

function formatScore(value) {
  if (value == null || value === '') return '—'
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : String(value)
}

function PeriodHint({ comparison }) {
  if (!comparison?.label) return null
  return (
    <div className="post-use-html-report-kpi-hints">
      <div className={`hint hint--${comparison.tone || 'na'}`}>{comparison.label}</div>
    </div>
  )
}

function YunwangScoreHints({ kpis }) {
  if (!kpis?.vsCompanyLabel && !kpis?.momLabel) return null
  return (
    <div className="post-use-html-report-kpi-hints post-use-html-report-kpi-hints--inline">
      {kpis.vsCompanyLabel ? (
        <div className={`hint hint--${kpis.vsCompanyTone || 'flat'}`}>{kpis.vsCompanyLabel}</div>
      ) : null}
      {kpis.momLabel ? (
        <div className={`hint hint--${kpis.momTone || 'flat'}`}>{kpis.momLabel}</div>
      ) : null}
    </div>
  )
}

function formatQuoteLine(item) {
  const who = [item.customerName, item.customerCode].filter(Boolean).join(' / ') || '未标注客户'
  const score = item.score == null ? '' : ` · ${item.score}分`
  return `「${item.text}」— ${who}${score} · ${item.channelLabel}`
}

function polarityTag(polarity) {
  if (polarity === 'positive') return <Tag color="success">正反馈</Tag>
  return <Tag color="error">负反馈</Tag>
}

function quoteHref(item) {
  const name = String(item?.customerName || '').trim()
  if (!name || name === '匿名客户') {
    return buildFeedbacksUrl({
      lane: 'post_use',
      source: 'post_use_rating',
      product: item?.productName || '',
    })
  }
  return buildFeedbacksUrl({
    lane: 'post_use',
    source: 'post_use_rating',
    customerNames: name,
    product: item?.productName || '',
  })
}

function percent(part, total) {
  if (!total) return 0
  return Math.round((part / total) * 1000) / 10
}

function SectionTitle({ id, children }) {
  return (
    <Typography.Title id={id} level={2} className="!mb-3 !mt-0 !text-xl">
      {children}
    </Typography.Title>
  )
}

function ScoreMeter({ avgScore, sampleSize, nonTenCount }) {
  const score = Number(avgScore)
  const ratio = Number.isFinite(score) ? Math.max(0, Math.min(100, (score / 10) * 100)) : 0
  const nonTenRate = sampleSize ? percent(nonTenCount || 0, sampleSize) : 0
  return (
    <div className="report-score-meter">
      <div className="report-score-meter__track">
        <span className="report-score-meter__fill" style={{ width: `${ratio}%` }} />
        <span className="report-score-meter__mark" style={{ left: '90%' }} title="9 分线" />
      </div>
      <div className="report-score-meter__caption">
        均分 {formatScore(avgScore)} / 10 · 样本 {sampleSize || 0} · 非10分 {nonTenCount || 0}
        {sampleSize ? `（${nonTenRate}%）` : ''}
      </div>
    </div>
  )
}

function LockedEvidence({ issue }) {
  const evidence = issue.evidence || {}
  const quotes = evidence.quotes || []
  const options = evidence.options || []
  const positiveQuotes = evidence.positiveQuotes || []
  return (
    <div className="post-use-html-report-evidence">
      <ScoreMeter avgScore={evidence.avgScore} sampleSize={evidence.sampleSize} nonTenCount={evidence.nonTenCount} />
      {evidence.changeLabel ? (
        <div className="mt-1">问题变化 {evidence.changeIssue || ''} {evidence.changeLabel}</div>
      ) : null}
      {quotes.length ? (
        quotes.map((item) => (
          <a key={`${item.recordId}-${item.text}`} href={quoteHref(item)} className="post-use-html-report-quote">
            {polarityTag(item.polarity || 'negative')} {formatQuoteLine(item)}
          </a>
        ))
      ) : options.length ? (
        options.map((item) => (
          <div key={`${item.recordId}-${item.text}`} className="post-use-html-report-quote">
            {polarityTag('negative')} 反馈选项：{item.text}
            {item.customerName ? `（${item.customerName}${item.score == null ? '' : ` · ${item.score}分`}）` : ''}
          </div>
        ))
      ) : (
        <div className="post-use-html-report-quote">本条暂无有效负向原话</div>
      )}
      {positiveQuotes.length ? (
        <div className="report-positive-aside">
          <div className="report-positive-aside__label">同产品正反馈</div>
          {positiveQuotes.map((item) => (
            <a key={`${item.recordId}-${item.text}`} href={quoteHref(item)} className="post-use-html-report-quote">
              {polarityTag('positive')} {formatQuoteLine(item)}
            </a>
          ))}
        </div>
      ) : null}
      <div className="no-print mt-2">
        <a href={WORKBENCH_HREF}>在工作台核对</a>
      </div>
    </div>
  )
}

/**
 * @param {{
 *   model: ReturnType<import('../../lib/postUseRating/htmlReportModel.js').buildHtmlMonthlyReportModel>
 *   canEdit: boolean
 *   judgment: string
 *   todoNote: string
 *   issueNarratives: Record<string, { conclusion: string, action: string }>
 *   visitSupplements?: Record<string, { visitResult: string, internalConclusion: string, remark: string }>
 *   hiddenSectionIds: string[]
 *   onJudgmentChange: (value: string) => void
 *   onTodoNoteChange: (value: string) => void
 *   onIssueChange: (key: string, field: 'conclusion' | 'action', value: string) => void
 *   onVisitSupplementChange?: (id: string, field: string, value: string) => void
 * }} props
 */
function ProductDetail({ card, active, preview, distributionColumns, canEdit, issueNarratives, onIssueChange }) {
  const issue = card.issue
  const narrative = issue ? issueNarratives[issue.key] || {} : null
  const distribution = (preview?.scoreDistributionTable || []).filter((row) => row.productName === card.productName)
  const scenes = (preview?.sceneJourneys || []).filter((row) => row.productName === card.productName)
  return (
    <section className={`report-product-detail${active ? ' is-active' : ''}`}>
      <h3>{card.productName}</h3>
      <div className="post-use-html-report-kpis post-use-html-report-kpis--product">
        <div className="post-use-html-report-kpi">
          <div className="label">产品体验得分</div>
          <div className="value">{formatScore(card.experienceScore)}</div>
          <PeriodHint comparison={card.comparisons?.experienceScore} />
        </div>
        <div className="post-use-html-report-kpi">
          <div className="label">投诉回访满意度</div>
          <div className="value">{card.satisfactionRate == null ? '—' : `${card.satisfactionRate}%`}</div>
          <PeriodHint comparison={card.comparisons?.satisfactionRate} />
        </div>
        <div className="post-use-html-report-kpi">
          <div className="label">均分（三渠道）</div>
          <div className="value">{formatScore(card.mixedAvg)}</div>
          <PeriodHint comparison={card.comparisons?.mixedAvg} />
        </div>
        <div className="post-use-html-report-kpi">
          <div className="label">样本数（三渠道）</div>
          <div className="value">{card.mixedSample}</div>
          <PeriodHint comparison={card.comparisons?.mixedSample} />
        </div>
        <div className="post-use-html-report-kpi">
          <div className="label">3 分以下样本数</div>
          <div className="value">{card.lowScoreCount}</div>
          <PeriodHint comparison={card.comparisons?.lowScoreCount} />
        </div>
      </div>
      <Typography.Text type="secondary">得分分布</Typography.Text>
      <Table size="small" pagination={false} rowKey="productName" dataSource={distribution} columns={distributionColumns} locale={{ emptyText: '暂无得分分布' }} />
      <Typography.Text type="secondary">场景与旅程</Typography.Text>
      <Table
        size="small"
        pagination={false}
        rowKey={(row) => `${row.originalScene}-${row.journey}`}
        dataSource={scenes}
        locale={{ emptyText: '暂无场景与旅程' }}
        columns={[
          { title: '场景', dataIndex: 'originalScene' },
          { title: '旅程', dataIndex: 'journey' },
          { title: '样本', dataIndex: 'sampleSize', width: 72 },
          { title: '均分', dataIndex: 'avgScore', width: 72 },
        ]}
      />
      <Typography.Text type="secondary">问题与证据</Typography.Text>
      {issue ? (
        <>
          <div className="mt-1">结论</div>
          <Input.TextArea
            className="mt-1 mb-3"
            value={narrative.conclusion ?? issue.conclusion}
            onChange={(event) => onIssueChange(issue.key, 'conclusion', event.target.value)}
            autoSize={{ minRows: 2 }}
            disabled={!canEdit}
          />
          <LockedEvidence issue={issue} />
          <div>建议动作</div>
          <Input.TextArea
            className="mt-1"
            value={narrative.action ?? issue.action}
            onChange={(event) => onIssueChange(issue.key, 'action', event.target.value)}
            autoSize={{ minRows: 2 }}
            disabled={!canEdit}
          />
        </>
      ) : (
        <Typography.Paragraph type="secondary">本产品本月没有单列问题条。</Typography.Paragraph>
      )}
      <div className="post-use-html-report-evidence">
        {(card.visitNarratives || []).map((line) => <div key={line}>{line}</div>)}
      </div>
      <Typography.Text type="secondary">得分趋势</Typography.Text>
      {card.scoreTrend?.data?.length ? (
        <TrendChart
          variant="line"
          allowDecimals
          height={240}
          data={card.scoreTrend.data}
          areas={card.scoreTrend.areas}
          referenceLine={{ y: 9, label: '关注线 9' }}
        />
      ) : (
        <Typography.Paragraph type="secondary">暂无该产品得分趋势。</Typography.Paragraph>
      )}
    </section>
  )
}

export default function PostUseHtmlReportDocument({
  model,
  canEdit,
  judgment,
  todoNote,
  issueNarratives,
  visitSupplements = {},
  hiddenSectionIds,
  onJudgmentChange,
  onTodoNoteChange,
  onIssueChange,
  onVisitSupplementChange,
}) {
  const hidden = new Set(hiddenSectionIds || [])
  const copy = model.copy || {}
  const showPreviousVisits = model.showPreviousVisits !== false
  const preview = model.preview
  const reviewItems = preview?.reviewChecklist || []
  const productCards = model.productCards || []
  const [selectedProduct, setSelectedProduct] = useState(productCards[0]?.productName || '')
  useEffect(() => {
    if (!productCards.some((card) => card.productName === selectedProduct)) {
      setSelectedProduct(productCards[0]?.productName || '')
    }
  }, [productCards, selectedProduct])
  const distributionColumns = [
    { title: '产品', dataIndex: 'productName', key: 'productName' },
    { title: '样本', dataIndex: 'sampleSize', key: 'sampleSize', width: 72 },
    ...[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((score) => ({
      title: `${score}分`,
      dataIndex: String(score),
      key: String(score),
      width: 56,
    })),
  ]

  return (
    <article className="report-modules">
      <section className="report-module">
      <Typography.Title level={1} className="!mb-0 !text-2xl">
        {model.title}
      </Typography.Title>
      {reviewItems.length ? (
        <Alert
          className="mt-4"
          type="info"
          showIcon
          message="历史复核提示（只读）"
          description={
            <ul className="mb-0 list-disc pl-5">
              {reviewItems.map((item) => (
                <li key={item.id || item.title}>
                  {item.sectionLabel}：{item.title}。{item.recommendation}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}
      {model.tablesRefreshed ? (
        <Alert
          className="mt-4"
          type="warning"
          showIcon
          message="表格已按最新数据刷新，叙述仍是上次保存"
        />
      ) : null}
      </section>

      <section className="report-module">
      <SectionTitle id="report-judgment">{copy.overviewTitle || '本月概述'}</SectionTitle>
      <Input.TextArea
        value={judgment}
        onChange={(event) => onJudgmentChange(event.target.value)}
        autoSize={{ minRows: 4 }}
        disabled={!canEdit}
        placeholder={copy.overviewPlaceholder || '结合综合结论写清当月整体表现，不要改指标数字。'}
      />
      <div className="post-use-html-report-kpis">
        <div className="post-use-html-report-kpi">
          <div className="label">涉及产品数</div>
          <div className="value">{model.kpis.productCount}</div>
          <div className="post-use-html-report-kpi-hints">总样本量 {model.kpis.totalSample}</div>
        </div>
        <div className={`post-use-html-report-kpi post-use-html-report-kpi--${Number(model.kpis.avgScore) < 9 ? 'warn' : 'ok'}`}>
          <div className="label">云网均分（三渠道）</div>
          <div className="value">{formatScore(model.kpis.avgScore)}</div>
          <YunwangScoreHints kpis={model.kpis} />
        </div>
        <div className={`post-use-html-report-kpi${model.kpis.belowNineCount ? ' post-use-html-report-kpi--warn' : ''}`}>
          <div className="label">9 分以下产品数</div>
          <div className="value">{model.kpis.belowNineCount}</div>
          <div className="post-use-html-report-kpi-hints">{(model.kpis.belowNineNames || []).join('、') || '无'}</div>
        </div>
        <div className={`post-use-html-report-kpi${model.kpis.callbackUnqualifiedCount ? ' post-use-html-report-kpi--warn' : ''}`}>
          <div className="label">投诉回访不达标产品数</div>
          <div className="value">{model.kpis.callbackUnqualifiedCount}</div>
          <div className="post-use-html-report-kpi-hints">{(model.kpis.callbackUnqualifiedNames || []).join('、') || '无'}</div>
        </div>
      </div>
      <StatusOverviewChart statusTrend={model.charts?.statusTrend} />
      </section>

      {hidden.has(REPORT_SECTION_PRODUCTS) ? null : (
        <section className="report-module">
          <SectionTitle id="report-products">分产品情况</SectionTitle>
          <div className="report-product-layout">
            <div className="report-product-list">
              {productCards.map((card) => (
                <button
                  key={card.productName}
                  type="button"
                  className={`report-product-list__item${card.productName === selectedProduct ? ' is-active' : ''}`}
                  onClick={() => setSelectedProduct(card.productName)}
                >
                  <span>{card.productName}</span>
                  <span>{formatScore(card.mixedAvg)}</span>
                  {card.belowNine ? <Tag color="red">低于 9</Tag> : null}
                  {card.callbackUnqualified ? <Tag color="gold">回访不达标</Tag> : null}
                </button>
              ))}
            </div>
            <div>
              {productCards.map((card) => (
                <ProductDetail
                  key={card.productName}
                  card={card}
                  active={card.productName === selectedProduct}
                  preview={preview}
                  distributionColumns={distributionColumns}
                  canEdit={canEdit}
                  issueNarratives={issueNarratives}
                  onIssueChange={onIssueChange}
                />
              ))}
            </div>
          </div>
          <FocusProductTrendCharts
            scoreTrend={model.charts?.scoreTrend}
            satisfactionTrend={model.charts?.satisfactionTrend}
          />
        </section>
      )}

      {hidden.has(REPORT_SECTION_TODO) ? null : (
        <section className="report-module">
          <SectionTitle id="report-todo">待办事情及进展</SectionTitle>
          <div className="post-use-html-report-kpis report-todo-kpis">
            <div className="post-use-html-report-kpi">
              <div className="label">{copy.todoProposed || '本月提出'}</div>
              <div className="value">{model.todo.proposedCount}</div>
            </div>
            <div className="post-use-html-report-kpi">
              <div className="label">{copy.todoClosed || '本月关闭'}</div>
              <div className="value">{model.todo.closedCount}</div>
            </div>
            <div className={`post-use-html-report-kpi${model.todo.notRecoveredCount ? ' post-use-html-report-kpi--warn' : ''}`}>
              <div className="label">已完成未恢复</div>
              <div className="value">{model.todo.notRecoveredCount}</div>
            </div>
            <div className="post-use-html-report-kpi">
              <div className="label">建议回访/溯源</div>
              <div className="value">{model.todo.callbackCount}</div>
            </div>
          </div>
          <Typography.Paragraph type="secondary">{copy.todoLead || '读者离开前应能回答：这月先办哪 3 件事。'}</Typography.Paragraph>
          {model.todo.proposed.length ? (
            <ul>
              {model.todo.proposed.map((item) => (
                <li key={item.id || item.content}>
                  提出：{item.productName} · {item.content}
                </li>
              ))}
            </ul>
          ) : null}
          {model.todo.notRecovered.length ? (
            <ul>
              {model.todo.notRecovered.map((item) => (
                <li key={item.id || item.content}>
                  已完成未恢复：{item.productName} · {item.content}
                </li>
              ))}
            </ul>
          ) : null}
          {model.todo.callbackHighlights.length ? (
            <ol>
              {model.todo.callbackHighlights.map((item, index) => (
                <li key={`${item.customerName}-${item.productName}-${index}`}>
                  {item.reason}
                </li>
              ))}
            </ol>
          ) : (
            <Typography.Paragraph type="secondary">{copy.todoEmpty || '本月建议回访清单为空，完整客户明细见附录。'}</Typography.Paragraph>
          )}
          <Input.TextArea
            value={todoNote}
            onChange={(event) => onTodoNoteChange(event.target.value)}
            autoSize={{ minRows: 3 }}
            disabled={!canEdit}
            placeholder={copy.todoPlaceholder || '补充本月要办备注：先办哪 3 件事。'}
          />
        </section>
      )}

      {!showPreviousVisits || hidden.has(REPORT_SECTION_PREVIOUS_VISITS) ? null : (
        <section className="report-module">
          <SectionTitle id="report-previous-visits">上期客服部回访结果补充</SectionTitle>
          {(model.previousVisits || []).length ? (
            <Table
              size="small"
              pagination={false}
              rowKey="id"
              dataSource={model.previousVisits}
              columns={[
                { title: '客户', dataIndex: 'customerName', width: 160 },
                {
                  title: '客服部回访记录',
                  dataIndex: 'visitResult',
                  render: (value, row) => (
                    <Input.TextArea
                      value={visitSupplements[row.id]?.visitResult ?? value}
                      disabled={!canEdit}
                      autoSize={{ minRows: 1 }}
                      onChange={(event) => onVisitSupplementChange?.(row.id, 'visitResult', event.target.value)}
                    />
                  ),
                },
                {
                  title: '回访结果内部评估/回应',
                  dataIndex: 'internalConclusion',
                  render: (value, row) => (
                    <Input.TextArea
                      value={visitSupplements[row.id]?.internalConclusion ?? value}
                      disabled={!canEdit}
                      autoSize={{ minRows: 1 }}
                      onChange={(event) => onVisitSupplementChange?.(row.id, 'internalConclusion', event.target.value)}
                    />
                  ),
                },
                {
                  title: '备注',
                  dataIndex: 'remark',
                  render: (value, row) => (
                    <Input.TextArea
                      value={visitSupplements[row.id]?.remark ?? value}
                      disabled={!canEdit}
                      autoSize={{ minRows: 1 }}
                      onChange={(event) => onVisitSupplementChange?.(row.id, 'remark', event.target.value)}
                    />
                  ),
                },
              ]}
            />
          ) : (
            <Typography.Paragraph type="secondary">上期无客服部回访记录。</Typography.Paragraph>
          )}
        </section>
      )}

      <div className={`report-module report-appendix${hidden.has(REPORT_SECTION_APPENDIX) ? ' screen-only-hidden' : ''}`}>
          <SectionTitle id="report-appendix">附录</SectionTitle>
          <Collapse
            defaultActiveKey={[]}
            items={[
              {
                key: 'scores',
                label: '整体得分表',
                children: (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="productName"
                    dataSource={preview.monthlyScoreTable}
                    columns={[
                      { title: '产品', dataIndex: 'productName' },
                      { title: '样本量', dataIndex: 'sampleSize' },
                      { title: '均分', dataIndex: 'avgScore' },
                      { title: '投诉回访10分满意比', dataIndex: 'callbackTenPointRate' },
                    ]}
                  />
                ),
              },
              {
                key: 'distribution',
                label: '评分分布',
                children: (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="productName"
                    dataSource={preview.scoreDistributionTable}
                    columns={distributionColumns}
                    scroll={{ x: 720 }}
                  />
                ),
              },
              {
                key: 'scene',
                label: '场景 × 旅程',
                children: (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={(row) => `${row.productName}-${row.originalScene}-${row.journey}`}
                    dataSource={preview.sceneJourneys}
                    columns={[
                      { title: '产品', dataIndex: 'productName' },
                      { title: '场景', dataIndex: 'originalScene' },
                      { title: '旅程', dataIndex: 'journey' },
                      { title: '样本', dataIndex: 'sampleSize' },
                      { title: '均分', dataIndex: 'avgScore' },
                      { title: '非10分', dataIndex: 'nonTenCount' },
                    ]}
                  />
                ),
              },
              {
                key: 'needs',
                label: '需求全表',
                children: (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={(row) => `${row.productName}-${row.need}`}
                    dataSource={preview.needs}
                    columns={[
                      { title: '产品', dataIndex: 'productName' },
                      { title: '需求', dataIndex: 'need' },
                      { title: '优先级', dataIndex: 'priority' },
                      { title: '频次', dataIndex: 'count' },
                    ]}
                  />
                ),
              },
              {
                key: 'customers',
                label: '客户明细',
                children: (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={(row) => `${row.customerName}-${row.customerCode}`}
                    dataSource={preview.customers}
                    columns={[
                      { title: '客户', dataIndex: 'customerName' },
                      { title: '编码', dataIndex: 'customerCode' },
                      { title: '产品', dataIndex: 'products', render: (products) => (products || []).join('、') },
                      { title: '非10分', dataIndex: 'nonTenCount', width: 80 },
                      { title: '均分', dataIndex: 'avgScore', width: 72 },
                      { title: '最近原话', dataIndex: 'latestQuote' },
                    ]}
                  />
                ),
              },
              {
                key: 'reasons',
                label: '原因聚合',
                children: (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={(row) => `${row.channel || ''}-${row.reason}`}
                    dataSource={preview.reasons}
                    columns={[
                      { title: '渠道', dataIndex: 'channel' },
                      { title: '原因', dataIndex: 'reason' },
                      { title: '次数', dataIndex: 'count' },
                    ]}
                  />
                ),
              },
              {
                key: 'quotes',
                label: '有效客户原话登记',
                children: (
                  <Table
                    size="small"
                    pagination={false}
                    rowKey={(row, index) => `${row.recordId}-${row.kind}-${row.text}-${index}`}
                    dataSource={model.quoteRegistry}
                    columns={[
                      { title: '渠道', dataIndex: 'channelLabel', width: 110 },
                      { title: '正负', dataIndex: 'polarity', width: 88, render: (polarity) => (polarity === 'positive' ? '正反馈' : '负反馈') },
                      { title: '类型', dataIndex: 'kind', width: 80, render: (kind) => (kind === 'quote' ? '客户原话' : '反馈选项') },
                      { title: '产品', dataIndex: 'productName' },
                      { title: '得分', dataIndex: 'score', width: 64 },
                      {
                        title: '客户名称/编码',
                        key: 'customer',
                        render: (_, row) => [row.customerName, row.customerCode].filter(Boolean).join(' / ') || '—',
                      },
                      { title: '时间', dataIndex: 'answeredAt', width: 120 },
                      { title: '原文', dataIndex: 'text' },
                    ]}
                  />
                ),
              },
              model.overflow.length
                ? {
                    key: 'overflow',
                    label: '正文未收录的问题条',
                    children: (
                      <ul>
                        {model.overflow.map((issue) => (
                          <li key={issue.key}>{issue.productName}：{issue.conclusionDraft}</li>
                        ))}
                      </ul>
                    ),
                  }
                : null,
            ].filter(Boolean)}
          />
        </div>
    </article>
  )
}

export function ReportSectionToggles({ hiddenSectionIds, onToggleSection, showPreviousVisits = true }) {
  const hidden = new Set(hiddenSectionIds || [])
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Checkbox
        checked={!hidden.has(REPORT_SECTION_PRODUCTS)}
        onChange={(event) => onToggleSection(REPORT_SECTION_PRODUCTS, event.target.checked)}
      >
        显示分产品情况
      </Checkbox>
      <Checkbox
        checked={!hidden.has(REPORT_SECTION_TODO)}
        onChange={(event) => onToggleSection(REPORT_SECTION_TODO, event.target.checked)}
      >
        显示待办事情及进展
      </Checkbox>
      {showPreviousVisits ? (
        <Checkbox
          checked={!hidden.has(REPORT_SECTION_PREVIOUS_VISITS)}
          onChange={(event) => onToggleSection(REPORT_SECTION_PREVIOUS_VISITS, event.target.checked)}
        >
          显示上期回访补充
        </Checkbox>
      ) : null}
      <Checkbox
        checked={!hidden.has(REPORT_SECTION_APPENDIX)}
        onChange={(event) => onToggleSection(REPORT_SECTION_APPENDIX, event.target.checked)}
      >
        显示附录
      </Checkbox>
    </div>
  )
}
