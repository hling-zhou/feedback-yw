import { useEffect, useState } from 'react'
import { Button, Card, Collapse, Tag, Typography } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { ACTION_ITEM_STATUS_LABELS } from '../../domain/actionItem.js'
import { resolveClusterFeedbacksNavigation } from '../../lib/feedbackTicketIdSet.js'
import { ensureTopicAnalysis } from '../../lib/topicAnalysis/buildTopicAnalysisChapters.js'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const PRIORITY_STYLES = {
  P0: 'bg-red-600 text-white',
  P1: 'bg-amber-100 text-amber-950',
  P2: 'bg-ink-100 text-ink-700',
}

const REC_TYPE_LABELS = {
  collect: '补证据',
  split: '拆专题',
  follow_up: '跟进库存',
  investigate: '核查',
  observe: '观察',
  expectation_gap: '预期落差',
}

const CHAPTERS = [
  { id: 'conclusion', label: '结论' },
  { id: 'quantitative', label: '规模与结构' },
  { id: 'qualitative', label: '发生了什么' },
  { id: 'why-happened', label: '为什么发生' },
  { id: 'recommendations', label: '建议' },
  { id: 'appendix', label: '依据' },
]

function percent(share) {
  return `${Math.round((Number(share) || 0) * 100)}%`
}

function confidenceLabel(badge) {
  if (badge === 'split') return '建议拆分'
  if (badge === 'high') return '高置信'
  if (badge === 'medium') return '中置信'
  return '低置信'
}

function shortTicket(id) {
  const value = String(id || '')
  return value.length > 10 ? value.slice(-6) : value
}

function clusterAnchor(key) {
  return `quote-cluster-${String(key || 'other').replace(/\s+/g, '-')}`
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function shareLine(item) {
  const matched = String(item.support || '').match(/(\d+)\s*\/\s*(\d+)/)
  if (matched) return `${matched[1]} / ${matched[2]}${item.share ? ` · ${percent(item.share)}` : ''}`
  if (item.share) return percent(item.share)
  return item.support || ''
}

function counterLine(counter) {
  const text = String(counter || '').replace(/^反证：/, '').replace(/^同时，/, '')
  return text ? `同时还有${text}` : ''
}

function dominantStructure(structures = []) {
  let best = null
  for (const block of structures) {
    const total = (block.rows || []).reduce((sum, row) => sum + row.count, 0)
    const top = block.rows?.[0]
    if (!top || !total) continue
    const share = top.count / total
    if (!best || share > best.share || (share === best.share && top.count > best.top.count)) {
      best = { block, top, rest: total - top.count, total, share }
    }
  }
  return best
}

function groupCrossRows(rows = []) {
  const groups = []
  const index = new Map()
  for (const row of rows) {
    const key = row.a || '未分类'
    let group = index.get(key)
    if (!group) {
      group = { name: key, rows: [] }
      index.set(key, group)
      groups.push(group)
    }
    group.rows.push(row)
  }
  return groups
}

function topCrossCell(tables = []) {
  let top = null
  for (const table of tables) {
    for (const row of table.rows || []) {
      if (!top || row.count > top.count) top = { ...row, title: table.title }
    }
  }
  return top
}

function ShareBars({ rows = [] }) {
  const max = Math.max(...rows.map((row) => row.count), 1)
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.name}>
          <div className="mb-1 flex justify-between gap-2 text-xs text-ink-500">
            <span className="truncate">{row.name}</span>
            <span>{row.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function EvidenceLinks({ sourceIds = [], onTicketClick }) {
  const [open, setOpen] = useState(false)
  if (!sourceIds.length) return null
  return (
    <div className="mt-2">
      <Button type="link" size="small" className="!h-auto !px-0 text-xs" onClick={() => setOpen((value) => !value)}>
        依据 {sourceIds.length} 条
      </Button>
      {open ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {sourceIds.map((id) => (
            <Button key={id} size="small" onClick={() => onTicketClick?.(id)}>
              {shortTicket(id)}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function QuoteRow({ quote, onTicketClick }) {
  return (
    <div className="border-b border-ink-50 py-3 last:border-0">
      <div className="text-[11px] text-ink-400">{quote.sourceLabel || '记录'}</div>
      <Typography.Paragraph ellipsis={{ rows: 2 }} className="!mb-1 !mt-1 !text-sm">{quote.text}</Typography.Paragraph>
      <div className="flex flex-wrap gap-3 text-xs">
        <Button type="link" size="small" className="!h-auto !px-0" onClick={() => onTicketClick?.(quote.recordId || quote.id || quote.ticketId)}>
          查看
        </Button>
        {quote.href ? <Link to={quote.href}>在反馈库打开</Link> : null}
      </div>
    </div>
  )
}

function QuoteCluster({ group, onTicketClick }) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? group.quotes : group.quotes.slice(0, 2)
  const hidden = Math.max(group.quotes.length - 2, 0)
  return (
    <div id={clusterAnchor(group.key)} className="scroll-mt-20">
      <div className="mb-1 text-xs text-ink-500">{group.key} · {group.count} 条</div>
      <div className="quote-list">
        {visible.map((quote) => (
          <QuoteRow key={quote.id} quote={quote} onTicketClick={onTicketClick} />
        ))}
      </div>
      {hidden > 0 ? (
        <Button type="link" size="small" className="!h-auto !px-0" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起' : `再看 ${hidden} 条`}
        </Button>
      ) : null}
    </div>
  )
}

function Chapter({ id, title, aside, children }) {
  return (
    <section id={id} className="scroll-mt-20 space-y-3">
      <div className="flex items-end justify-between gap-3 border-b border-ink-100 pb-2">
        <Typography.Title level={5} className="!mb-0">{title}</Typography.Title>
        {aside}
      </div>
      {children}
    </section>
  )
}

function GroupedCrossTable({ table }) {
  const groups = groupCrossRows(table.rows)
  const max = Math.max(...(table.rows || []).map((row) => row.count), 1)
  return (
    <div>
      <div className="mb-2 text-xs text-ink-500">{table.title}</div>
      {groups.map((group) => (
        <div key={group.name} className="mb-3">
          <div className="mb-1 text-sm font-medium">{group.name}</div>
          {group.rows.map((row) => (
            <div key={`${row.a}-${row.b}`} className="flex items-center gap-3 py-0.5 text-sm">
              <span className="min-w-0 flex-1 truncate text-ink-600">{row.b}</span>
              <span className="w-8 text-right text-ink-500">{row.count}</span>
              <div className="h-1 w-16 rounded-full bg-ink-100">
                <div className="h-full rounded-full bg-sky-500" style={{ width: `${(row.count / max) * 100}%` }} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * @param {{ brief: object, settings?: object, onTicketClick?: Function }} props
 */
export default function TopicBriefView({ brief, onTicketClick }) {
  const navigate = useNavigate()
  const [activeId, setActiveId] = useState('conclusion')
  const resolved = brief ? ensureTopicAnalysis(brief) : null
  const decision = resolved?.decision

  useEffect(() => {
    if (!decision) return undefined
    const root = document.querySelector('.app-shell-main')
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)
      if (visible[0]?.target?.id) setActiveId(visible[0].target.id)
    }, { root, rootMargin: '-15% 0px -65% 0px', threshold: [0.1, 0.25, 0.5] })
    for (const item of CHAPTERS) {
      const node = document.getElementById(item.id)
      if (node) observer.observe(node)
    }
    return () => observer.disconnect()
  }, [decision])

  if (!brief) return null
  if (!decision) {
    return <Card><Typography.Text type="secondary">该报告为旧版结构，请按系统数据重算后查看决策简报。</Typography.Text></Card>
  }
  const { urgency, action, qualitative, attribution, metrics } = decision
  const analysis = resolved.analysis || {}
  const quantitative = analysis.quantitative || {}
  const qualitativeChapter = analysis.qualitative || {}
  const why = analysis.whyHappened || {}
  const recommendations = analysis.recommendations || []
  const monthData = Object.entries(quantitative.monthCounts || metrics.monthCounts || {}).map(([month, count]) => ({
    month: month.slice(5),
    count,
  }))
  const sourceMix = quantitative.sourceMix || Object.entries(resolved.scope?.countsBySource || {}).map(([name, count]) => ({ name, count }))
  const libraryCount = (resolved.sources || []).filter((row) => row.ticketId).length
  const leftoverVisits = (qualitativeChapter.visits || []).slice(3)
  const lead = dominantStructure(quantitative.structures)
  const otherFacets = (quantitative.structures || []).filter((block) => block.key !== lead?.block.key)
  const crossTop = topCrossCell(why.crossTabs)
  const sampleTotal = quantitative.sentiment?.total || metrics.total || 0
  const quoteLead = analysis.narrative || qualitativeChapter.facts?.[0]?.text || qualitative.text
  const sideEvidence = Boolean(
    qualitativeChapter.visits?.length || qualitativeChapter.supplements?.length || qualitativeChapter.gaps?.length,
  )

  const openLibrary = () => {
    const ticketIds = (resolved.sources || []).map((row) => row.ticketId).filter(Boolean)
    const nav = resolveClusterFeedbacksNavigation({ ticketIds })
    navigate(nav.href)
  }

  return (
    <div className="space-y-8">
      <section id="conclusion" className="scroll-mt-20 space-y-3">
        <Card className="overflow-hidden !p-0" styles={{ body: { padding: 0 } }}>
          <div className="grid md:grid-cols-4">
            <div className={`min-h-40 p-5 ${PRIORITY_STYLES[urgency.level] || PRIORITY_STYLES.P2}`}>
              <div className="text-4xl font-bold">{urgency.level}</div>
              <div className="mt-1 text-sm font-medium">{urgency.label}</div>
              <div className="mt-4 flex flex-wrap gap-1">{(urgency.signals || []).map((signal) => <Tag key={signal}>{signal}</Tag>)}</div>
            </div>
            <div className="grid gap-px bg-ink-100 md:col-span-3 md:grid-cols-2">
              {[
                ['做什么', action.what],
                ['谁来做', action.owner],
                ['多急', action.when],
                ['怎么验证', action.verify],
              ].map(([label, value]) => (
                <div key={label} className="bg-white p-4">
                  <Typography.Text type="secondary" className="text-xs">{label}</Typography.Text>
                  <div className="mt-1 text-sm font-medium text-ink-900">{value || '—'}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="flex flex-wrap gap-x-4 gap-y-1 px-0.5 text-xs text-ink-500" data-testid="source-mix">
          <span>{metrics.total} 条</span>
          <span className={metrics.negativeRate >= 0.3 ? 'text-red-600' : ''}>负向 {metrics.negative}（{Math.round((metrics.negativeRate || 0) * 100)}%）</span>
          <span>近期 / 基线 {metrics.recentAvg == null ? '—' : `${metrics.recentAvg.toFixed(1)} / ${metrics.baselineAvg.toFixed(1)}`}</span>
          <span>产品 {metrics.productCount}</span>
          <span>开放举措 {metrics.openActionCount}</span>
          {sourceMix.map((row) => (
            <span key={row.name}>{row.name} {row.count}</span>
          ))}
        </div>

        <div className="space-y-1 text-sm">
          <a href="#qualitative" className="block text-ink-800 hover:text-sky-700" onClick={(event) => { event.preventDefault(); scrollToId('qualitative') }}>
            发生了什么 · {qualitative.text}
            <span className="ml-2 text-xs text-ink-400">{confidenceLabel(qualitative.confidence)}</span>
          </a>
          <a href="#why-happened" className="block text-ink-800 hover:text-sky-700" onClick={(event) => { event.preventDefault(); scrollToId('why-happened') }}>
            为何发生 · {attribution.text}
            <span className="ml-2 text-xs text-ink-400">{confidenceLabel(attribution.confidence)}</span>
          </a>
        </div>
      </section>

      <nav aria-label="报告章节" className="page-sticky-chrome flex flex-wrap gap-x-4 gap-y-1 border-y border-ink-100 text-sm">
        {CHAPTERS.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className={activeId === item.id ? 'font-medium text-ink-900' : 'text-ink-500 hover:text-ink-800'}
            onClick={(event) => { event.preventDefault(); scrollToId(item.id) }}
          >
            {item.label}
          </a>
        ))}
      </nav>

      <Chapter
        id="quantitative"
        title="规模与结构"
        aside={quantitative.splitSuggested ? <Tag color="orange">建议先拆专题</Tag> : null}
      >
        <p className="text-sm text-ink-800">{quantitative.concentrationNote}</p>
        <p className="text-xs text-ink-500">
          趋势 {quantitative.trend || '—'}
          {quantitative.sentiment ? ` · 期望落差 ${percent(quantitative.sentiment.expectationRate)}` : ''}
          {quantitative.sentiment?.highSeverity ? ` · 强负向/加急 ${quantitative.sentiment.highSeverity} 条` : ''}
          {quantitative.inventory ? ` · 举措库存 开放 ${quantitative.inventory.open} / 已完成 ${quantitative.inventory.done} / 已停止 ${quantitative.inventory.stopped}` : ''}
        </p>
        {monthData.length ? (
          <div className="h-28">
            <ResponsiveContainer>
              <BarChart data={monthData}>
                <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={10} />
                <YAxis hide />
                <Tooltip />
                <Bar dataKey="count" fill="#38bdf8" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        {lead ? (
          <div>
            <div className="mb-2 text-xs text-ink-500">主导切面 · {lead.block.title}</div>
            <div className="text-sm font-medium">{lead.top.name} {lead.top.count} / {lead.total}</div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-100">
              <div className="h-full bg-sky-500" style={{ width: `${lead.share * 100}%` }} />
            </div>
            <div className="mt-1 text-xs text-ink-400">其余 {lead.rest}</div>
          </div>
        ) : null}
        {otherFacets.length ? (
          <div className="space-y-1 text-sm">
            {otherFacets.map((block) => (
              <div key={block.key} className="flex justify-between gap-3">
                <span className="text-ink-500">{block.title}</span>
                <span>{block.rows[0]?.name} {block.rows[0]?.count}</span>
              </div>
            ))}
          </div>
        ) : null}
        {(quantitative.structures || []).length ? (
          <Collapse
            defaultActiveKey={[]}
            items={[{
              key: 'detail',
              label: '各维度明细',
              children: (
                <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
                  {(quantitative.structures || []).map((block) => (
                    <div key={block.key}>
                      <Typography.Text type="secondary" className="mb-2 block text-xs">{block.title}</Typography.Text>
                      <ShareBars rows={block.rows} />
                    </div>
                  ))}
                </div>
              ),
            }]}
          />
        ) : null}
      </Chapter>

      <Chapter id="qualitative" title="发生了什么">
        {quoteLead ? <p className="text-sm text-ink-800">{quoteLead}</p> : null}
        <ol className="space-y-2">
          {(qualitativeChapter.facts || []).map((fact, index) => (
            <li key={fact.id} className="flex gap-3 text-sm">
              <span className="w-4 shrink-0 text-xs text-ink-400">{index + 1}</span>
              <div>
                <div>{fact.text}</div>
                <EvidenceLinks sourceIds={fact.sourceIds} onTicketClick={onTicketClick} />
              </div>
            </li>
          ))}
        </ol>
        {!qualitativeChapter.facts?.length ? <Typography.Text type="secondary">暂无足够事实判断。</Typography.Text> : null}
        {(qualitativeChapter.quoteGroups || []).length ? (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="text-ink-400">用户原话</span>
              {(qualitativeChapter.quoteGroups || []).map((group) => (
                <a
                  key={group.key}
                  href={`#${clusterAnchor(group.key)}`}
                  className="text-ink-700 hover:text-sky-700"
                  onClick={(event) => { event.preventDefault(); scrollToId(clusterAnchor(group.key)) }}
                >
                  {group.key} {group.count}
                </a>
              ))}
            </div>
            {(qualitativeChapter.quoteGroups || []).map((group) => (
              <QuoteCluster key={group.key} group={group} onTicketClick={onTicketClick} />
            ))}
          </div>
        ) : null}
        {sideEvidence ? (
          <Collapse
            defaultActiveKey={[]}
            items={[{
              key: 'side',
              label: '旁证与缺口',
              children: (
                <div className="space-y-3 text-sm">
                  {qualitativeChapter.visits?.slice(0, 3).map((visit) => (
                    <div key={visit.id}>{visit.customerName || '未具名客户'}：{visit.text}</div>
                  ))}
                  {qualitativeChapter.visits?.length > 3 ? <div className="text-xs text-ink-400">其余 {qualitativeChapter.visits.length - 3} 条在依据</div> : null}
                  {qualitativeChapter.supplements?.map((item) => (
                    <div key={item.id}>{item.fileName ? `${item.fileName}：` : ''}{item.text}</div>
                  ))}
                  {qualitativeChapter.gaps?.map((gap) => (
                    <div key={gap} className="text-ink-500">{gap}</div>
                  ))}
                </div>
              ),
            }]}
          />
        ) : null}
      </Chapter>

      <Chapter id="why-happened" title="为什么发生（假设）" aside={<span className="text-xs text-ink-400">{why.disclaimer || '本章是机制假设，不是已证实根因。'}</span>}>
        {why.narrative ? <p className="text-sm">{why.narrative}</p> : null}
        <div>
          <div className="mb-2 text-xs text-ink-500">机制链条</div>
          <ol className="space-y-3">
            {(why.chain || []).map((step, index) => (
              <li key={step.id} className={`flex gap-3 ${step.missing ? 'opacity-70' : ''}`}>
                <span className="mt-0.5 w-5 shrink-0 text-xs text-ink-400">{index + 1}</span>
                <div>
                  <div className="text-xs text-ink-500">{step.label}{step.missing ? ' · 缺口' : ''}</div>
                  <div className="mt-0.5 text-sm">{step.text}</div>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <div className="mb-1 text-xs text-ink-500">竞争假说</div>
          <p className="mb-3 text-xs text-ink-400">{why.hypotheses?.note}</p>
          {(why.hypotheses?.items || []).map((item, index) => (
            <div key={item.id} className="border-b border-ink-50 py-3 last:border-0">
              <div className="text-xs text-ink-400">{index + 1}</div>
              <div className="mt-1 text-sm font-medium text-ink-900">{item.statement}</div>
              <div className="mt-1 text-sm text-ink-600">{shareLine(item)}</div>
              {item.counter ? <div className="mt-1 text-xs text-ink-400">{counterLine(item.counter)}</div> : null}
              <EvidenceLinks sourceIds={item.sourceIds} onTicketClick={onTicketClick} />
            </div>
          ))}
          {!why.hypotheses?.items?.length ? <Typography.Text type="secondary">不给主因，只保留线索。</Typography.Text> : null}
        </div>
        {(why.crossTabs || []).length ? (
          <Collapse
            defaultActiveKey={[]}
            items={[{
              key: 'cross',
              label: '交叉核对',
              children: (
                <div className="space-y-4">
                  {crossTop ? (
                    <p className="text-sm">
                      {crossTop.a} × {crossTop.b} 最密（{crossTop.count}{sampleTotal ? ` / ${sampleTotal}` : ''}）
                    </p>
                  ) : null}
                  {(why.crossTabs || []).map((table) => (
                    <GroupedCrossTable key={table.key} table={table} />
                  ))}
                </div>
              ),
            }]}
          />
        ) : null}
      </Chapter>

      <Chapter id="recommendations" title="建议">
        <div className="space-y-4">
          {recommendations.map((item, index) => (
            <div key={item.id} className="border-b border-ink-50 pb-4 last:border-0">
              <div className="text-xs text-ink-400">{index + 1} · {REC_TYPE_LABELS[item.type] || item.type}</div>
              <div className="mt-1 text-sm font-medium">{item.title}</div>
              <p className="mt-1 mb-1 text-sm">{item.text}</p>
              <div className="text-xs text-ink-400">为什么：{item.why}</div>
              <EvidenceLinks sourceIds={item.sourceIds} onTicketClick={onTicketClick} />
            </div>
          ))}
        </div>
      </Chapter>

      <section id="appendix" className="scroll-mt-20">
        <Collapse
          defaultActiveKey={[]}
          items={[{
            key: 'appendix',
            label: '依据与口径',
            children: (
              <div className="space-y-4">
                <div className="text-xs text-ink-500">
                  <div>口径：{resolved.scope?.matchNote || '—'}</div>
                  <div>为何现在看：{resolved.whyNow || '—'}</div>
                </div>
                {resolved.actions?.length ? (
                  <div>
                    <Typography.Text type="secondary" className="text-xs">关联举措</Typography.Text>
                    {resolved.actions.map((item) => (
                      <div key={item.id} className="py-1 text-sm">
                        <Tag color="blue">{ACTION_ITEM_STATUS_LABELS[item.status] || item.status || '未标记'}</Tag>
                        {item.title}
                      </div>
                    ))}
                  </div>
                ) : null}
                {leftoverVisits.length ? (
                  <div>
                    <Typography.Text type="secondary" className="text-xs">其余拜访</Typography.Text>
                    {leftoverVisits.map((visit) => (
                      <div key={visit.id} className="py-1 text-sm">{visit.customerName || '未具名客户'}：{visit.text}</div>
                    ))}
                  </div>
                ) : null}
                {libraryCount ? (
                  <Button type="link" className="!h-auto !px-0" onClick={openLibrary}>
                    在反馈库查看全部 {libraryCount} 条
                  </Button>
                ) : null}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-ink-500">
                        <th className="py-1 pr-3">来源</th>
                        <th className="py-1 pr-3">工单号</th>
                        <th className="py-1 pr-3">产品</th>
                        <th className="py-1 pr-3">客户</th>
                        <th className="py-1 pr-3">摘要</th>
                        <th className="py-1">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(resolved.sources || []).map((source) => (
                        <tr key={source.id || source.ticketId} className="border-t border-ink-50 align-top">
                          <td className="py-2 pr-3">{source.sourceLabel}</td>
                          <td className="py-2 pr-3">{source.ticketId || source.id}</td>
                          <td className="py-2 pr-3">{source.product}</td>
                          <td className="py-2 pr-3">{source.customerName}</td>
                          <td className="py-2 pr-3">{source.summary}</td>
                          <td className="py-2">
                            <Button type="link" size="small" className="!h-auto !px-0" onClick={() => onTicketClick?.(source.ticketId || source.id)}>查看</Button>
                            {source.href ? <Link to={source.href} className="ml-2">在反馈库打开</Link> : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ),
          }]}
        />
      </section>
    </div>
  )
}
