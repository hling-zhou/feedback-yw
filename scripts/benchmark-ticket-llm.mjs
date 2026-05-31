#!/usr/bin/env node
/**
 * P0 LLM 打标 token/调用次数估算（离线，不调用真实 API）。
 * 用法：node scripts/benchmark-ticket-llm.mjs [records=500]
 */
import {
  estimateTicketLlmCalls,
  llmCallReductionRatio,
} from '../src/lib/ticketAnalysis/ticketLlmGolden.js'

const records = Number(process.argv[2]) || 500

const legacy = estimateTicketLlmCalls({
  records,
  ticketLlmMode: 'separate',
  pipelineOrder: 'legacy',
  journeyGatingSkipRate: 0,
})

const p0 = estimateTicketLlmCalls({
  records,
  ticketLlmMode: 'unified',
  pipelineOrder: 'ticket_first',
  journeyGatingSkipRate: 0.55,
  optimizationRetryRate: 0.3,
})

const reduction = llmCallReductionRatio(legacy.total, p0.total)

console.log(`Records: ${records}`)
console.log('')
console.log('Legacy (separate + journey-first, no gating):')
console.log(`  ticket LLM calls:  ${legacy.ticketCalls}`)
console.log(`  journey LLM calls: ${legacy.journeyCalls}`)
console.log(`  total:             ${legacy.total}`)
console.log('')
console.log('P0 (unified + ticket_first + 55% journey gating + 30% opt retry):')
console.log(`  ticket LLM calls:  ${p0.ticketCalls}`)
console.log(`  journey LLM calls: ${p0.journeyCalls}`)
console.log(`  total:             ${p0.total}`)
console.log('')
console.log(`Estimated call reduction: ${(reduction * 100).toFixed(1)}%`)
console.log(`P0 acceptance (≥40%): ${reduction >= 0.4 ? 'PASS' : 'FAIL'}`)
