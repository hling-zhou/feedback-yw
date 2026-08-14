import { Link } from 'react-router-dom'
import { Tag, Typography } from 'antd'
import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import { ACTION_ITEM_STATUS_LABELS } from '../../domain/actionItem.js'
import { isLlmAvailable } from '../../lib/llmClient.js'

const KIND_LABELS = {
  system_stat: '系统统计',
  ai: 'AI 归纳',
  user_supplement: '用户补充',
}

/**
 * @param {{ brief: object, settings?: object }} props
 */
export default function TopicBriefView({ brief, settings }) {
  if (!brief) return null
  return (
    <div className="space-y-5 text-sm leading-relaxed">
      <section>
        <Typography.Title level={5}>范围与可信度</Typography.Title>
        <p>分析周期：{brief.scope?.periodLabel}</p>
        <p>{brief.scope?.matchNote}</p>
        <p>
          系统记录 {brief.scope?.total || 0} 条
          {Object.entries(brief.scope?.countsBySource || {}).map(([type, count]) => (
            <Tag key={type} className="ml-1">{DATA_SOURCE_LABELS[type] || type} {count}</Tag>
          ))}
        </p>
        {isLlmAvailable(settings) && brief.llmApplied ? (
          <Tag color="blue">含 AI 归纳</Tag>
        ) : (
          <Tag>规则归纳（未调用 AI 或 AI 不可用）</Tag>
        )}
      </section>

      <section>
        <Typography.Title level={5}>为何值得深入</Typography.Title>
        <p>{brief.whyNow}</p>
      </section>

      <section>
        <Typography.Title level={5}>发生了什么</Typography.Title>
        <Tag>系统统计</Tag>
        {brief.whatHappened?.problemTypes?.length ? (
          <p>问题类型：{brief.whatHappened.problemTypes.slice(0, 6).map((row) => `${row.name} ${row.count}`).join('；')}</p>
        ) : <p>暂无问题类型分布。</p>}
        {brief.whatHappened?.products?.length ? (
          <p>产品：{brief.whatHappened.products.slice(0, 6).map((row) => `${row.name} ${row.count}`).join('；')}</p>
        ) : null}
      </section>

      <section>
        <Typography.Title level={5}>用户怎么说</Typography.Title>
        {brief.quotes?.length ? brief.quotes.map((quote) => (
          <p key={quote.id}>
            <Link to={quote.href}>{(quote.ticketId || quote.id)}</Link>
            {' '}
            <Tag>{quote.sourceLabel}</Tag>
            {quote.text}
          </p>
        )) : <p>暂无可用原话。</p>}
      </section>

      <section>
        <Typography.Title level={5}>初步判断</Typography.Title>
        {(brief.judgments || []).map((item) => (
          <p key={item.id}>
            <Tag color={item.kind === 'ai' ? 'blue' : 'default'}>{KIND_LABELS[item.kind] || item.kind}</Tag>
            {item.text}
            {item.sourceIds?.length ? (
              <Typography.Text type="secondary"> 来源 {item.sourceIds.join(', ')}</Typography.Text>
            ) : null}
          </p>
        ))}
      </section>

      <section>
        <Typography.Title level={5}>已有举措与缺口</Typography.Title>
        {brief.actions?.length ? brief.actions.map((item) => (
          <p key={item.id}>
            {item.title}
            {item.status ? `（${ACTION_ITEM_STATUS_LABELS[item.status] || item.status}）` : ''}
          </p>
        )) : <p>系统内未见确立举措。</p>}
      </section>

      <section>
        <Typography.Title level={5}>用户补充材料</Typography.Title>
        {brief.supplements?.length ? (
          <>
            {brief.supplements.map((item) => (
              <p key={item.id}>{item.fileName} · {item.format} · {item.importedAt}</p>
            ))}
            {(brief.supplementItems || []).map((item) => (
              <p key={item.id}><Tag color="gold">用户补充</Tag>{item.text}</p>
            ))}
          </>
        ) : (
          <p>尚未提供。可将本地 Word / Markdown / PDF / Excel（拜访结论、JIRA、产品侧进展等）上传，系统会并入分析。</p>
        )}
      </section>

      <section>
        <Typography.Title level={5}>待补充</Typography.Title>
        {(brief.toSupplement || []).map((gap) => <p key={gap}>· {gap}</p>)}
      </section>

      <section>
        <Typography.Title level={5}>信息源</Typography.Title>
        {(brief.sources || []).map((source) => (
          <p key={`${source.id}-${source.ticketId}`}>
            <Tag>{source.sourceLabel}</Tag>
            {source.ticketId ? <Link to={source.href}>{source.ticketId}</Link> : source.id}
            {source.product ? ` · ${source.product}` : ''}
            {source.customerName ? ` · ${source.customerName}` : ''}
            {source.summary ? ` · ${source.summary}` : ''}
          </p>
        ))}
        {!brief.sources?.length ? <p>无系统信息源。</p> : null}
      </section>
    </div>
  )
}
