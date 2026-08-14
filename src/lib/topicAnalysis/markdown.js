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
    '## 范围与可信度',
    '',
    `- 洞察周期：${brief.scope?.periodLabel || '—'}`,
    `- 匹配方式：${brief.scope?.matchNote || '—'}`,
    `- 系统记录：${brief.scope?.total ?? 0} 条${sourceCountLine(brief.scope?.countsBySource) ? `（${sourceCountLine(brief.scope.countsBySource)}）` : ''}`,
    '',
    '## 为何值得深入',
    '',
    brief.whyNow || '—',
    '',
    '## 发生了什么（系统统计）',
    '',
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

  lines.push('', '## 初步判断', '')
  if (brief.llmApplied) lines.push('_以下为 AI 归纳，每条均应能回到信息源。_', '')
  else lines.push('_以下为系统统计归纳（未使用 AI 或 AI 不可用）。_', '')
  for (const item of brief.judgments || []) {
    const refs = (item.sourceIds || []).length ? `〔来源 ${item.sourceIds.join(', ')}〕` : ''
    lines.push(`- ${item.text}${refs}`)
  }

  lines.push('', '## 已有举措与缺口', '')
  if (brief.actions?.length) {
    for (const action of brief.actions) {
      lines.push(`- ${action.title}${action.status ? `（${action.status}）` : ''}`)
    }
  } else {
    lines.push('系统内未见确立举措。')
  }

  lines.push('', '## 用户补充材料', '')
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

  lines.push('', '## 待补充', '')
  for (const gap of brief.toSupplement || []) lines.push(`- ${gap}`)

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
