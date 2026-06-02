/**
 * 行动建议 Playbook 单一来源（P2-7）
 * 供 V2 聚类行动建议、legacy buildPlanningRecommendations 与 collectMergedOptimizationDetails 共用
 */
import { synthesizePlanningMeasures, topValues } from './journeyInsights.js'
import {
  buildFallbackPrimaryAction,
  buildProblemTypePrimaryAction,
} from './planningRecommendationTemplate.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/** @typedef {'ticket' | 'playbook' | 'mixed' | 'synth' | 'synth+manual' | 'none'} ProductActionsSource */

export const PLAYBOOK_MEASURE_SOURCE_SCORE = {
  人工复核举措: 50,
  人工复核方案: 45,
  根因归纳: 32,
  '环节 playbook': 30,
  '类型 playbook': 28,
  '阶段 playbook': 24,
  类型归纳: 18,
}

/**
 * @param {FeedbackRecord[]} records
 * @returns {{ l1: string; l2: string } | null}
 */
export function inferPlanningJourneyContext(records) {
  const topL2 = topValues(records, 'journeyL2', 1)[0]
  if (!topL2?.text) return null
  const l1 = records.find((r) => r.journeyL2 === topL2.text)?.journeyL1 || ''
  return { l1, l2: topL2.text }
}

/**
 * @param {FeedbackRecord[]} records
 * @param {{ l1?: string; l2?: string } | null} journeyCtx
 */
export function collectPlanningPlaybookMeasures(records, journeyCtx) {
  if (!journeyCtx?.l1) return []
  return synthesizePlanningMeasures(records, journeyCtx.l1, journeyCtx.l2 || '')
}

/**
 * @param {Object} ctx
 * @param {FeedbackRecord[]} ctx.records
 * @param {string} [ctx.product]
 * @param {string} [ctx.journeyL1]
 * @param {string} [ctx.journeyL2]
 * @param {string} [ctx.problemType]
 */
export function collectPlanningPlaybookActionLines(ctx) {
  const { records, product = '', journeyL1, journeyL2, problemType = '' } = ctx
  if (!records?.length) return []

  const journeyCtx =
    journeyL1 && journeyL2
      ? { l1: journeyL1, l2: journeyL2 }
      : journeyL1
        ? { l1: journeyL1, l2: journeyL2 || '' }
        : inferPlanningJourneyContext(records)

  /** @type {string[]} */
  const lines = []
  for (const measure of collectPlanningPlaybookMeasures(records, journeyCtx)) {
    lines.push(measure.text)
  }

  const resolvedProblemType =
    problemType || topValues(records, 'problemType', 1)[0]?.text || ''
  const resolvedProduct = product || records[0]?.product?.trim() || ''

  const primary =
    buildFallbackPrimaryAction({
      product: resolvedProduct,
      journeyL1: journeyCtx?.l1,
      journeyL2: journeyCtx?.l2,
      problemType: resolvedProblemType,
    }) ||
    (resolvedProblemType ? buildProblemTypePrimaryAction(resolvedProblemType) : null)
  if (primary) lines.push(primary)

  return lines
}

/**
 * @param {string} productActionsSource
 * @returns {string}
 */
export function measureSourceLabelForProductActions(productActionsSource) {
  if (productActionsSource === 'synth+manual') return '群组规则合成（含确立举措）'
  if (productActionsSource === 'synth') return '群组规则合成'
  if (productActionsSource === 'playbook') return '环节 playbook'
  if (productActionsSource === 'mixed') return 'cluster_mixed'
  if (productActionsSource === 'ticket') return 'cluster_rule'
  return 'cluster_rule'
}

/**
 * @param {string[]} ticketActions
 * @param {string[]} finalActions
 * @param {{ usedPlaybookFallback?: boolean; usedAlignmentReplacement?: boolean; usedClusterSynthesis?: boolean; usedEstablishedActionInSynthesis?: boolean }} flags
 * @returns {ProductActionsSource}
 */
export function detectProductActionsSource(ticketActions, finalActions, flags = {}) {
  if (flags.usedClusterSynthesis && flags.usedEstablishedActionInSynthesis) return 'synth+manual'
  if (flags.usedClusterSynthesis) return 'synth'
  if (!finalActions.length) return 'none'
  if (!flags.usedPlaybookFallback && !flags.usedAlignmentReplacement) {
    return ticketActions.length ? 'ticket' : 'none'
  }

  const ticketKept = ticketActions.filter((line) =>
    finalActions.some((final) => final.slice(0, 40) === line.slice(0, 40)),
  )
  if (!ticketKept.length) return 'playbook'
  if (ticketKept.length < finalActions.length) return 'mixed'
  return 'ticket'
}
