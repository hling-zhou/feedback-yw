import { Alert, Checkbox, Collapse, Input, Table, Tag, Typography } from 'antd'
import { REPORT_SECTION_APPENDIX, REPORT_SECTION_ISSUES, REPORT_SECTION_TODO } from '../../lib/postUseRating/htmlReportModel.js'
import { buildFeedbacksUrl } from '../../lib/feedbackFilters.js'
import PostUseHtmlReportCharts from './PostUseHtmlReportCharts.jsx'

const WORKBENCH_HREF = '/workbench?tab=post_use_rating'

function formatScore(value) {
  if (value == null || value === '') return '—'
  const num = Number(value)
  return Number.isFinite(num) ? String(num) : String(value)
}

function YunwangScoreHints({ kpis }) {
  if (!kpis?.vsCompanyLabel && !kpis?.momLabel) return null
  return (
    <div className="post-use-html-report-kpi-hints">
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

function issueStateTag(issue) {
  if (issue.severity === 0) return <Tag color="error">重点改善</Tag>
  if (issue.severity === 1) return <Tag color="warning">持续观察</Tag>
  if (issue.kind === 'change') return <Tag color="orange">问题增长</Tag>
  if (issue.kind === 'action') return <Tag>待推动</Tag>
  return null
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

function QuoteCard({ item }) {
  const href = quoteHref(item)
  return (
    <a href={href} className={`report-quote-card report-quote-card--${item.polarity || 'negative'}`}>
      <div className="report-quote-card__meta">
        {polarityTag(item.polarity)}
        <span>{item.channelLabel}</span>
        {item.score == null ? null : <span>{item.score}分</span>}
      </div>
      <p>「{item.text}」</p>
      <footer>{[item.customerName, item.customerCode, item.productName].filter(Boolean).join(' · ') || '未标注客户'} · 查看反馈</footer>
    </a>
  )
}

function SectionTitle({ id, children }) {
  return (
    <Typography.Title id={id} level={2} className="!mb-3 !mt-8 !text-xl">
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
      {evidence.visitEvidenceCount ? <div>回访证据 {evidence.visitEvidenceCount}</div> : null}
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
 *   hiddenSectionIds: string[]
 *   onJudgmentChange: (value: string) => void
 *   onTodoNoteChange: (value: string) => void
 *   onIssueChange: (key: string, field: 'conclusion' | 'action', value: string) => void
 * }} props
 */
export default function PostUseHtmlReportDocument({
  model,
  canEdit,
  judgment,
  todoNote,
  issueNarratives,
  hiddenSectionIds,
  onJudgmentChange,
  onTodoNoteChange,
  onIssueChange,
}) {
  const hidden = new Set(hiddenSectionIds || [])
  const preview = model.preview
  const reviewItems = preview?.reviewChecklist || []
  const voice = model.voice || { positiveCount: 0, negativeCount: 0, positiveQuotes: 0, negativeQuotes: 0, negativeOptions: 0 }
  const scoreBands = model.scoreBands || { ten: 0, nine: 0, eight: 0, low: 0 }
  const featuredVoice = model.featuredVoice || { positive: [], negative: [] }
  const kpiTone = Number(model.kpis.avgScore) < 9 ? 'warn' : 'ok'
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
    <article>
      <Typography.Title level={1} className="!mb-1 !text-2xl">
        {model.title}
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="!mb-4">
        表格与证据由线上综合分析同一套模型锁定；图表可悬停查看明细，原话可点进反馈库。总判断、问题结论和建议动作可编辑后保存。
      </Typography.Paragraph>

      {reviewItems.length ? (
        <Alert
          className="mb-4"
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
          className="mb-4"
          type="warning"
          showIcon
          message="表格已按最新数据刷新，叙述仍是上次保存"
        />
      ) : null}

      <SectionTitle id="report-judgment">本月判断</SectionTitle>
      <div className="post-use-html-report-kpis">
        <div className={`post-use-html-report-kpi post-use-html-report-kpi--${kpiTone}`}>
          <div className="label">云网均分</div>
          <div className="value">{formatScore(model.kpis.avgScore)}</div>
          <YunwangScoreHints kpis={model.kpis} />
        </div>
        <div className="post-use-html-report-kpi">
          <div className="label">样本量</div>
          <div className="value">{model.kpis.totalSample}</div>
        </div>
        <div className={`post-use-html-report-kpi${model.kpis.belowNineCount ? ' post-use-html-report-kpi--warn' : ''}`}>
          <div className="label">9 分以下产品数</div>
          <div className="value">{model.kpis.belowNineCount}</div>
        </div>
        <div className={`post-use-html-report-kpi${model.kpis.callbackUnqualifiedCount ? ' post-use-html-report-kpi--warn' : ''}`}>
          <div className="label">投诉回访不达标产品数</div>
          <div className="value">{model.kpis.callbackUnqualifiedCount}</div>
        </div>
      </div>

      <PostUseHtmlReportCharts
        scoreBands={scoreBands}
        voice={voice}
        productScores={model.charts?.productScores}
        reasons={model.charts?.reasons}
        scoreTrend={model.charts?.scoreTrend}
        satisfactionTrend={model.charts?.satisfactionTrend}
      />

      {featuredVoice.positive.length || featuredVoice.negative.length ? (
        <div className="report-voice-columns">
          <div>
            <div className="report-voice-columns__title">正反馈原话</div>
            {featuredVoice.positive.length ? (
              featuredVoice.positive.map((item) => <QuoteCard key={`${item.recordId}-${item.text}`} item={item} />)
            ) : (
              <Typography.Paragraph type="secondary">本月暂无有效正反馈原话。</Typography.Paragraph>
            )}
          </div>
          <div>
            <div className="report-voice-columns__title">负反馈原话</div>
            {featuredVoice.negative.length ? (
              featuredVoice.negative.map((item) => <QuoteCard key={`${item.recordId}-${item.text}`} item={item} />)
            ) : (
              <Typography.Paragraph type="secondary">本月暂无有效负反馈原话。</Typography.Paragraph>
            )}
          </div>
        </div>
      ) : null}

      <Input.TextArea
        value={judgment}
        onChange={(event) => onJudgmentChange(event.target.value)}
        autoSize={{ minRows: 4 }}
        disabled={!canEdit}
        placeholder="写清现在怎样，并点到下面的问题条，不要只写形容词。"
      />

      {hidden.has(REPORT_SECTION_ISSUES) ? null : (
        <>
          <SectionTitle id="report-issues">问题与证据</SectionTitle>
          {model.issues.length ? (
            model.issues.map((issue, index) => {
              const narrative = issueNarratives[issue.key] || {}
              return (
                <section key={issue.key} className="post-use-html-report-issue">
                  <h3>
                    {index + 1}. {issue.productName || '未标注产品'} {issueStateTag(issue)}
                  </h3>
                  <Typography.Text type="secondary">结论</Typography.Text>
                  <Input.TextArea
                    className="mt-1 mb-3"
                    value={narrative.conclusion ?? issue.conclusion}
                    onChange={(event) => onIssueChange(issue.key, 'conclusion', event.target.value)}
                    autoSize={{ minRows: 2 }}
                    disabled={!canEdit}
                  />
                  <Typography.Text type="secondary">证据（锁定）</Typography.Text>
                  <LockedEvidence issue={issue} />
                  <Typography.Text type="secondary">建议动作</Typography.Text>
                  <Input.TextArea
                    className="mt-1"
                    value={narrative.action ?? issue.action}
                    onChange={(event) => onIssueChange(issue.key, 'action', event.target.value)}
                    autoSize={{ minRows: 2 }}
                    disabled={!canEdit}
                  />
                </section>
              )
            })
          ) : (
            <Typography.Paragraph>本月没有需要单列的问题条，完整明细见附录。</Typography.Paragraph>
          )}
        </>
      )}

      {hidden.has(REPORT_SECTION_TODO) ? null : (
        <>
          <SectionTitle id="report-todo">本月要办</SectionTitle>
          <div className="post-use-html-report-kpis report-todo-kpis">
            <div className="post-use-html-report-kpi">
              <div className="label">本月提出</div>
              <div className="value">{model.todo.proposedCount}</div>
            </div>
            <div className="post-use-html-report-kpi">
              <div className="label">本月关闭</div>
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
          <Typography.Paragraph type="secondary">读者离开前应能回答：这月先办哪 3 件事。</Typography.Paragraph>
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
            <ul>
              {model.todo.callbackHighlights.map((item, index) => (
                <li key={`${item.customerName}-${item.productName}-${index}`}>
                  回访要点：{item.customerName} × {item.productName}
                  {item.reason ? ` · ${item.reason}` : ''}
                </li>
              ))}
            </ul>
          ) : (
            <Typography.Paragraph type="secondary">本月建议回访清单为空，完整客户明细见附录。</Typography.Paragraph>
          )}
          <Input.TextArea
            value={todoNote}
            onChange={(event) => onTodoNoteChange(event.target.value)}
            autoSize={{ minRows: 3 }}
            disabled={!canEdit}
            placeholder="补充本月要办备注：先办哪 3 件事。"
          />
        </>
      )}

      <div className={`report-appendix${hidden.has(REPORT_SECTION_APPENDIX) ? ' screen-only-hidden' : ''}`}>
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
                label: '客户与回访明细',
                children: (
                  <>
                    <Table
                      size="small"
                      pagination={false}
                      className="mb-4"
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
                    <Table
                      size="small"
                      pagination={false}
                      rowKey={(row) => row.id || `${row.customerName}-${row.visitMonth}`}
                      dataSource={preview.visitsDetailed}
                      columns={[
                        { title: '客户', dataIndex: 'customerName' },
                        { title: '编码', dataIndex: 'customerCode' },
                        { title: '产品', dataIndex: 'productName' },
                        { title: '回访反馈', dataIndex: 'visitFeedbackDetail' },
                        { title: '内部评估', dataIndex: 'internalEvaluationDetail' },
                      ]}
                    />
                  </>
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

export function ReportSectionToggles({ hiddenSectionIds, printAppendix, onToggleSection, onPrintAppendixChange }) {
  const hidden = new Set(hiddenSectionIds || [])
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Checkbox
        checked={!hidden.has(REPORT_SECTION_ISSUES)}
        onChange={(event) => onToggleSection(REPORT_SECTION_ISSUES, event.target.checked)}
      >
        显示问题与证据
      </Checkbox>
      <Checkbox
        checked={!hidden.has(REPORT_SECTION_TODO)}
        onChange={(event) => onToggleSection(REPORT_SECTION_TODO, event.target.checked)}
      >
        显示本月要办
      </Checkbox>
      <Checkbox
        checked={!hidden.has(REPORT_SECTION_APPENDIX)}
        onChange={(event) => onToggleSection(REPORT_SECTION_APPENDIX, event.target.checked)}
      >
        显示附录
      </Checkbox>
      <Checkbox checked={printAppendix} onChange={(event) => onPrintAppendixChange(event.target.checked)}>
        打印附录
      </Checkbox>
    </div>
  )
}
