import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import { TOPIC_ANALYSIS_DEMO_LABEL, TOPIC_TYPE_LABELS } from './constants.js'

function sourceCountLine(countsBySource = {}) {
  return Object.entries(countsBySource)
    .map(([type, count]) => `${DATA_SOURCE_LABELS[type] || type} ${count}`)
    .join('，')
}

/**
 * @param {object} brief
 */
export function buildTopicMarkdown(brief) {
  const topic = brief.topic || {}
  const lines = [
    `# ${topic.title || '未命名专题'}`,
    '',
    `> ${TOPIC_ANALYSIS_DEMO_LABEL} · ${TOPIC_TYPE_LABELS[topic.type] || topic.typeLabel || ''} · 生成于 ${brief.generatedAt || ''}`,
    '',
    '## 决策摘要',
    '',
    `- 紧迫度：${brief.decision?.urgency?.level || '—'} · ${brief.decision?.urgency?.label || '—'}`,
    `- 做什么：${brief.decision?.action?.what || '—'}`,
    `- 谁来做：${brief.decision?.action?.owner || '—'}`,
    `- 怎么验证：${brief.decision?.action?.verify || '—'}`,
    '',
    '## 定性',
    '',
    brief.decision?.qualitative?.text || '—',
    '',
    '## 归因假设',
    '',
    brief.decision?.attribution?.text || '—',
    '',
    '## 指标',
    '',
    `- 洞察周期：${brief.scope?.periodLabel || '—'}`,
    `- 系统记录：${brief.scope?.total ?? 0} 条${sourceCountLine(brief.scope?.countsBySource) ? `（${sourceCountLine(brief.scope.countsBySource)}）` : ''}`,
  ]
  const products = brief.whatHappened?.products || []
  const problems = brief.whatHappened?.problemTypes || []
  if (products.length) {
    lines.push('产品分布：' + products.slice(0, 8).map((row) => `${row.name} ${row.count}`).join('；'))
  }
  if (problems.length) {
    lines.push('问题类型：' + problems.slice(0, 8).map((row) => `${row.name} ${row.count}`).join('；'))
  }
  if (!products.length && !problems.length) lines.push('暂无足够系统统计。')

  lines.push('', '## 用户怎么说', '')
  if (brief.quotes?.length) {
    for (const quote of brief.quotes) {
      lines.push(`- （${quote.sourceLabel || ''} / ${quote.product || ''} / ${quote.ticketId || quote.id}）${quote.text}`)
    }
  } else {
    lines.push('暂无可用原话。')
  }

  lines.push('', '## 关联举措', '')
  if (brief.actions?.length) {
    for (const action of brief.actions) {
      lines.push(`- ${action.title}${action.status ? `（${action.status}）` : ''}`)
    }
  } else {
    lines.push('系统内未见确立举措。')
  }

  lines.push('', '## 补充材料', '')
  if (brief.supplements?.length) {
    for (const sup of brief.supplements) {
      lines.push(`- ${sup.fileName}（${sup.format}，${sup.importedAt || ''}）`)
    }
    for (const note of brief.supplementItems || []) {
      lines.push(`  - ${note.text}`)
    }
  } else {
    lines.push('尚未提供补充材料。可将本地 Word / Markdown / PDF / Excel 提供给系统。')
  }

  lines.push('', '## 信息源', '')
  if (brief.sources?.length) {
    for (const source of brief.sources) {
      lines.push(`- ${source.sourceLabel || ''} | ${source.ticketId || source.id} | ${source.product || ''} | ${source.customerName || ''} | ${source.summary || ''}`)
    }
  } else {
    lines.push('无系统信息源。')
  }
  lines.push('')
  return lines.join('\n')
}
