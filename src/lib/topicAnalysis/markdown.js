import { DATA_SOURCE_LABELS } from '../../domain/enums.js'
import { TOPIC_ANALYSIS_DEMO_LABEL, TOPIC_TYPE_LABELS } from './constants.js'
import { ensureTopicAnalysis } from './buildTopicAnalysisChapters.js'

function sourceCountLine(countsBySource = {}) {
  return Object.entries(countsBySource)
    .map(([type, count]) => `${DATA_SOURCE_LABELS[type] || type} ${count}`)
    .join('，')
}

function percent(share) {
  return `${Math.round((Number(share) || 0) * 100)}%`
}

/**
 * @param {object} brief
 */
export function buildTopicMarkdown(brief) {
  const resolved = ensureTopicAnalysis(brief || {})
  const topic = resolved.topic || {}
  const analysis = resolved.analysis || {}
  const lines = [
    `# ${topic.title || '未命名专题'}`,
    '',
    `> ${TOPIC_ANALYSIS_DEMO_LABEL} · ${TOPIC_TYPE_LABELS[topic.type] || topic.typeLabel || ''} · 生成于 ${resolved.generatedAt || ''}`,
    '',
    '## 决策摘要',
    '',
    `- 紧迫度：${resolved.decision?.urgency?.level || '—'} · ${resolved.decision?.urgency?.label || '—'}`,
    `- 做什么：${resolved.decision?.action?.what || '—'}`,
    `- 谁来做：${resolved.decision?.action?.owner || '—'}`,
    `- 怎么验证：${resolved.decision?.action?.verify || '—'}`,
    '',
    '## 定性',
    '',
    resolved.decision?.qualitative?.text || '—',
    '',
    '## 归因假设',
    '',
    resolved.decision?.attribution?.text || '—',
    '',
    '## 指标',
    '',
    `- 洞察周期：${resolved.scope?.periodLabel || '—'}`,
    `- 系统记录：${resolved.scope?.total ?? 0} 条${sourceCountLine(resolved.scope?.countsBySource) ? `（${sourceCountLine(resolved.scope.countsBySource)}）` : ''}`,
  ]
  const products = resolved.whatHappened?.products || []
  const problems = resolved.whatHappened?.problemTypes || []
  if (products.length) {
    lines.push('产品分布：' + products.slice(0, 8).map((row) => `${row.name} ${row.count}`).join('；'))
  }
  if (problems.length) {
    lines.push('问题类型：' + problems.slice(0, 8).map((row) => `${row.name} ${row.count}`).join('；'))
  }
  if (!products.length && !problems.length) lines.push('暂无足够系统统计。')

  const quantitative = analysis.quantitative || {}
  lines.push('', '## 规模与结构', '')
  if (quantitative.sourceMix?.length) {
    lines.push('来源构成：' + quantitative.sourceMix.map((row) => `${row.name} ${row.count}`).join('；'))
  }
  if (quantitative.trend) lines.push(`趋势：${quantitative.trend}`)
  if (quantitative.concentrationNote) lines.push(quantitative.concentrationNote)
  if (quantitative.sentiment) {
    lines.push(`负向率 ${percent(quantitative.sentiment.negativeRate)}，期望落差 ${percent(quantitative.sentiment.expectationRate)}。`)
  }
  if (quantitative.inventory) {
    lines.push(`举措库存：开放 ${quantitative.inventory.open}，已完成 ${quantitative.inventory.done}，已停止 ${quantitative.inventory.stopped}。`)
  }
  for (const block of quantitative.structures || []) {
    lines.push(`${block.title}：` + block.rows.map((row) => `${row.name} ${row.count}`).join('；'))
  }

  const qualitative = analysis.qualitative || {}
  lines.push('', '## 发生了什么', '')
  if (analysis.narrative) lines.push(analysis.narrative, '')
  if (qualitative.facts?.length) {
    for (const fact of qualitative.facts) lines.push(`- ${fact.text}`)
  } else {
    lines.push('暂无足够事实判断。')
  }
  lines.push('', '### 用户怎么说', '')
  if (qualitative.quoteGroups?.length) {
    for (const group of qualitative.quoteGroups) {
      lines.push(`#### ${group.key}（${group.count}）`)
      for (const quote of group.quotes) {
        lines.push(`- （${quote.sourceLabel || ''} / ${quote.product || ''} / ${quote.ticketId || quote.id}）${quote.text}`)
      }
    }
  } else if (resolved.quotes?.length) {
    for (const quote of resolved.quotes) {
      lines.push(`- （${quote.sourceLabel || ''} / ${quote.product || ''} / ${quote.ticketId || quote.id}）${quote.text}`)
    }
  } else {
    lines.push('暂无可用原话。')
  }
  if (qualitative.visits?.length) {
    lines.push('', '### 拜访结论', '')
    for (const visit of qualitative.visits) {
      lines.push(`- ${visit.customerName || '未具名客户'}：${visit.text}`)
    }
  }
  if (qualitative.supplements?.length) {
    lines.push('', '### 补充材料要点', '')
    for (const item of qualitative.supplements) {
      lines.push(`- ${item.fileName ? `${item.fileName}：` : ''}${item.text}`)
    }
  }
  if (qualitative.gaps?.length) {
    lines.push('', '### 证据缺口', '')
    for (const gap of qualitative.gaps) lines.push(`- ${gap}`)
  }

  const why = analysis.whyHappened || {}
  lines.push('', '## 为什么发生（假设）', '')
  lines.push(why.disclaimer || '本章是机制假设，不是已证实根因。')
  if (why.narrative) lines.push('', why.narrative)
  if (why.chain?.length) {
    lines.push('', '### 机制链条', '')
    for (const step of why.chain) {
      lines.push(`- ${step.label}：${step.text}${step.missing ? '（缺口）' : ''}`)
    }
  }
  if (why.hypotheses) {
    lines.push('', '### 竞争假说', '')
    lines.push(why.hypotheses.note || '')
    if (why.hypotheses.items?.length) {
      for (const item of why.hypotheses.items) {
        lines.push(`- ${item.statement}（${item.support}${item.counter ? `；反证：${item.counter}` : ''}）`)
      }
    } else {
      lines.push('不给主因，只保留线索。')
    }
  }
  for (const table of why.crossTabs || []) {
    lines.push('', `### ${table.title}`, '')
    for (const row of table.rows) lines.push(`- ${row.a} × ${row.b}：${row.count}`)
  }

  lines.push('', '## 建议', '')
  if (analysis.recommendations?.length) {
    for (const item of analysis.recommendations) {
      lines.push(`- ${item.title}：${item.text}${item.why ? `（${item.why}）` : ''}`)
    }
  } else {
    lines.push('暂无规则建议。')
  }

  lines.push('', '## 关联举措', '')
  if (resolved.actions?.length) {
    for (const action of resolved.actions) {
      lines.push(`- ${action.title}${action.status ? `（${action.status}）` : ''}`)
    }
  } else {
    lines.push('系统内未见确立举措。')
  }

  lines.push('', '## 补充材料', '')
  if (resolved.supplements?.length) {
    for (const sup of resolved.supplements) {
      lines.push(`- ${sup.fileName}（${sup.format}，${sup.importedAt || ''}）`)
    }
    for (const note of resolved.supplementItems || []) {
      lines.push(`  - ${note.text}`)
    }
  } else {
    lines.push('尚未提供补充材料。可将本地 Word / Markdown / PDF / Excel 提供给系统。')
  }

  lines.push('', '## 依据与口径', '')
  lines.push(`口径：${resolved.scope?.matchNote || '—'}`)
  lines.push(`为何现在看：${resolved.whyNow || '—'}`)
  lines.push('', '### 信息源', '')
  if (resolved.sources?.length) {
    for (const source of resolved.sources) {
      lines.push(`- ${source.sourceLabel || ''} | ${source.ticketId || source.id} | ${source.product || ''} | ${source.customerName || ''} | ${source.summary || ''}`)
    }
  } else {
    lines.push('无系统信息源。')
  }
  lines.push('')
  return lines.join('\n')
}
