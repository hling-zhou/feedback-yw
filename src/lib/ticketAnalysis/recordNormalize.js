import { truncateCustomerRequest } from './customerRequestExtract.js'
import { isFormattedTemplateContent } from './customerRequestFilters.js'
import { truncatePainPoint } from './painPointExtract.js'
import { normalizeTagLabel } from './tagLabels.js'

/**
 * 读取/写入时归一化工单分析字段，兼容旧数据
 * @param {Record<string, unknown>} record
 */
export function normalizeTicketRecordFields(record) {
  const out = { ...record }

  if (!out.customerRequest?.trim() && out.customerQuote) {
    const quoteStr = String(out.customerQuote)
    if (!isFormattedTemplateContent(quoteStr)) {
      out.customerRequest = truncateCustomerRequest(quoteStr)
    }
  }
  if (out.customerRequest) {
    if (isFormattedTemplateContent(String(out.customerRequest))) {
      out.customerRequest = ''
    } else {
      out.customerRequest = truncateCustomerRequest(String(out.customerRequest))
    }
  }

  if (!out.painPoint?.trim() && out.problemSummary) {
    out.painPoint = truncatePainPoint(String(out.problemSummary))
  }
  if (out.painPoint) {
    out.painPoint = truncatePainPoint(String(out.painPoint))
    out.problemSummary = out.painPoint
  }

  if (out.requestScene) {
    out.requestScene = normalizeTagLabel(String(out.requestScene), 'dimension')
  }
  if (out.problemType) {
    out.problemType = normalizeTagLabel(String(out.problemType), 'dimension')
  }
  if (out.journeyL1) {
    out.journeyL1 = normalizeTagLabel(String(out.journeyL1), 'journeyL1')
  }
  if (out.journeyL2) {
    out.journeyL2 = normalizeTagLabel(String(out.journeyL2), 'journeyL2')
  }

  if (!out.optimizationProduct?.trim() && out.optimizationSuggestion) {
    out.optimizationProduct = String(out.optimizationSuggestion)
  }

  return out
}
