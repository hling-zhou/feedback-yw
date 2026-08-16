import { Button, Card, Tag, Typography } from 'antd'
import { ACTION_ITEM_STATUS_LABELS } from '../../domain/actionItem.js'
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

const PRIORITY_STYLES = {
  P0: 'bg-red-600 text-white',
  P1: 'bg-amber-100 text-amber-950',
  P2: 'bg-ink-100 text-ink-700',
}

function ShareBars({ rows = [] }) {
  const max = Math.max(...rows.map((row) => row.count), 1)
  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.name}>
          <div className="mb-1 flex justify-between gap-2 text-xs text-ink-500">
            <span className="truncate">{row.name}</span><span>{row.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-ink-100">
            <div className="h-full rounded-full bg-sky-500" style={{ width: `${(row.count / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function TicketButtons({ sourceIds = [], onTicketClick }) {
  if (!sourceIds.length) return null
  return (
    <div className="mt-3 flex flex-wrap gap-1">
      {sourceIds.map((id) => (
        <Button key={id} size="small" type="link" className="!h-auto !px-0" onClick={() => onTicketClick?.(id)}>
          {id}
        </Button>
      ))}
    </div>
  )
}

/**
 * @param {{ brief: object, settings?: object }} props
 */
export default function TopicBriefView({ brief, onTicketClick }) {
  if (!brief) return null
  const decision = brief.decision
  if (!decision) {
    return <Card><Typography.Text type="secondary">该报告为旧版结构，请按系统数据重算后查看决策简报。</Typography.Text></Card>
  }
  const { urgency, action, qualitative, attribution, metrics, distributions } = decision
  const monthData = Object.entries(metrics.monthCounts || {}).map(([month, count]) => ({ month: month.slice(5), count }))
  return (
    <div className="space-y-4">
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

      <Card size="small" className="overflow-hidden">
        <div className="grid divide-y divide-ink-100 md:grid-cols-5 md:divide-x md:divide-y-0">
          <Metric label="匹配记录" value={`${metrics.total} 条`} />
          <Metric label="负向" value={`${metrics.negative} 条`} hint={`${Math.round(metrics.negativeRate * 100)}%`} alert={metrics.negativeRate >= 0.3} />
          <Metric label="近期 / 基线" value={metrics.recentAvg == null ? '—' : `${metrics.recentAvg.toFixed(1)} / ${metrics.baselineAvg.toFixed(1)}`} />
          <Metric label="涉及产品" value={`${metrics.productCount} 个`} />
          <Metric label="开放举措" value={`${metrics.openActionCount} 项`} />
        </div>
        {monthData.length ? <div className="h-20 px-4 pt-2"><ResponsiveContainer><BarChart data={monthData}><XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={10} /><YAxis hide /><Tooltip /><Bar dataKey="count" fill="#38bdf8" radius={[2, 2, 0, 0]} /></BarChart></ResponsiveContainer></div> : null}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <InsightCard title="定性" badge={qualitative.confidence} text={qualitative.text} basis={qualitative.basis} rows={distributions.qualitative} sourceIds={qualitative.sourceIds} onTicketClick={onTicketClick} />
        <InsightCard title="归因假设" badge={attribution.confidence} text={attribution.text} basis={attribution.basis} rows={distributions.attribution} sourceIds={attribution.sourceIds} onTicketClick={onTicketClick} />
      </div>

      <section>
        <Typography.Title level={5} className="!mb-3">用户原话</Typography.Title>
        <div className="grid gap-3 md:grid-cols-3">
          {(brief.quotes || []).slice(0, 3).map((quote) => (
            <Card key={quote.id} size="small" className="h-full">
              <Tag>{quote.sourceLabel}</Tag>
              <Typography.Paragraph ellipsis={{ rows: 2 }} className="!mb-3 !mt-2">{quote.text}</Typography.Paragraph>
              <Button type="link" size="small" className="!h-auto !px-0" onClick={() => onTicketClick?.(quote.recordId || quote.id)}>{quote.ticketId || '查看记录'}</Button>
            </Card>
          ))}
          {!brief.quotes?.length ? <Typography.Text type="secondary">暂无可用原话。</Typography.Text> : null}
        </div>
      </section>

      {(brief.actions?.length || brief.supplements?.length) ? <Card size="small">
        {brief.actions?.slice(0, 3).map((item) => <div key={item.id} className="py-1 text-sm"><Tag color="blue">{ACTION_ITEM_STATUS_LABELS[item.status] || item.status || '未标记'}</Tag>{item.title}</div>)}
        {brief.supplements?.map((item) => <Tag key={item.id} className="mt-2">{item.fileName}</Tag>)}
      </Card> : null}
    </div>
  )
}

function Metric({ label, value, hint, alert = false }) {
  return <div className="p-3"><Typography.Text type="secondary" className="text-xs">{label}</Typography.Text><div className={alert ? 'mt-1 text-lg font-semibold text-red-600' : 'mt-1 text-lg font-semibold'}>{value}</div>{hint ? <Typography.Text type="secondary" className="text-xs">{hint}</Typography.Text> : null}</div>
}

function InsightCard({ title, badge, text, basis, rows, sourceIds, onTicketClick }) {
  return <Card size="small"><div className="flex items-start justify-between gap-2"><Typography.Text type="secondary">{title}</Typography.Text><Tag>{badge === 'split' ? '建议拆分' : badge === 'high' ? '高置信' : badge === 'medium' ? '中置信' : '低置信'}</Tag></div><Typography.Title level={5} className="!my-2 !text-base">{text}</Typography.Title><ShareBars rows={rows} /><Typography.Text type="secondary" className="mt-3 block text-xs">{basis}</Typography.Text><TicketButtons sourceIds={sourceIds} onTicketClick={onTicketClick} /></Card>
}
