import {
  extractAcceptanceTextFromFields,
  extractAppendTextFromFields,
  extractHandlingTextFromFields,
} from '../taggingText.js'
import { stripTaggingNoise } from './workflowTextCleanup.js'

/**
 * @param {Object} input
 * @param {string} [input.rawText]
 * @param {string} [input.handlingText]
 * @param {string} [input.customerQuote]
 * @param {Record<string, string>} [input.sourceColumns]
 * @returns {{ primaryText: string; secondaryText: string; fullText: string }}
 */
export function buildDimensionTaggingLayers(input) {
  const fields = {
    rawText: input.rawText,
    handlingText: input.handlingText,
    customerQuote: input.customerQuote,
    sourceColumns: input.sourceColumns,
  }

  const acceptance = stripTaggingNoise(extractAcceptanceTextFromFields(fields))
  const append = stripTaggingNoise(extractAppendTextFromFields(fields))
  const handling = stripTaggingNoise(extractHandlingTextFromFields(fields))

  /** @type {string[]} */
  const primaryParts = []
  if (acceptance) primaryParts.push(acceptance)
  if (append && append !== acceptance) primaryParts.push(append)

  const primaryText = primaryParts.join('\n')
  const secondaryText = handling && handling !== primaryText ? handling : ''
  const fullText = [primaryText, secondaryText].filter(Boolean).join('\n\n')

  return { primaryText, secondaryText, fullText }
}

/**
 * 问题类型打标语料：对齐规则文档「工单痛点文本」
 * 优先 customerRequest + painPoint；无则回退受理/追加/处理意见（buildDimensionTaggingLayers）
 *
 * @param {Object} input
 * @param {string} [input.customerRequest]
 * @param {string} [input.painPoint]
 * @param {string} [input.problemSummary]
 * @param {string} [input.rawText]
 * @param {string} [input.handlingText]
 * @param {string} [input.customerQuote]
 * @param {Record<string, string>} [input.sourceColumns]
 */
export function buildProblemTypeTaggingText(input = {}) {
  /** @type {string[]} */
  const parts = []
  const request = input.customerRequest?.trim()
  const pain = (input.painPoint || input.problemSummary || '').trim()

  if (request) parts.push(request)
  if (pain && pain !== request) parts.push(pain)
  if (parts.length) return parts.join('\n')

  const layers = buildDimensionTaggingLayers(input)
  return (
    layers.fullText ||
    input.rawText?.trim() ||
    input.handlingText?.trim() ||
    input.customerQuote?.trim() ||
    ''
  )
}
