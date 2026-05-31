import { DEFAULT_TAGGING_PIPELINE_ORDER } from './storage.js'

/** @typedef {'ticket_first' | 'legacy'} TaggingPipelineOrder */
/** @typedef {'sharedDimensions' | 'ticketLlm' | 'journey'} TaggingPipelineStage */

/**
 * @param {import('./storage.js').AppSettings} [settings]
 * @param {{ pipelineOrder?: TaggingPipelineOrder }} [options]
 * @returns {TaggingPipelineOrder}
 */
export function resolveTaggingPipelineOrder(settings, options = {}) {
  const fromOptions = options.pipelineOrder
  if (fromOptions === 'ticket_first' || fromOptions === 'legacy') return fromOptions
  const fromSettings = settings?.taggingPipelineOrder
  if (fromSettings === 'ticket_first' || fromSettings === 'legacy') return fromSettings
  return DEFAULT_TAGGING_PIPELINE_ORDER
}

/**
 * LLM 阶段顺序（不含 sharedDimensions，其始终最先执行）。
 * @param {TaggingPipelineOrder} pipelineOrder
 * @returns {('ticketLlm' | 'journey')[]}
 */
export function llmStageOrderAfterShared(pipelineOrder) {
  if (pipelineOrder === 'legacy') return ['journey', 'ticketLlm']
  return ['ticketLlm', 'journey']
}

/**
 * @param {TaggingPipelineOrder} pipelineOrder
 * @returns {TaggingPipelineStage[]}
 */
export function fullTaggingStageOrder(pipelineOrder) {
  return ['sharedDimensions', ...llmStageOrderAfterShared(pipelineOrder)]
}
