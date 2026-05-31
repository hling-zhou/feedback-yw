import { truncateCustomerRequest, CUSTOMER_REQUEST_HARD_MAX } from './customerRequestExtract.js'
import { truncatePainPoint, PAIN_POINT_HARD_MAX } from './painPointExtract.js'

const LEADING_PHRASE_RE =
  /^(?:用户(?:希望|建议|反馈|要求|反映|咨询)|客户(?:希望|建议|反馈|要求|反映)|请(?:帮忙|协助)|希望|建议)/

const PAIR_TOTAL_MAX = 200

/**
 * @param {string} customerRequest
 * @param {string} painPoint
 * @param {string} [ruleCustomerRequest]
 * @param {string} [rulePainPoint]
 */
export function validateTicketAnalysisPair(
  customerRequest,
  painPoint,
  ruleCustomerRequest = '',
  rulePainPoint = '',
) {
  let request = truncateCustomerRequest(customerRequest || ruleCustomerRequest)
  let pain = truncatePainPoint(painPoint || rulePainPoint)

  if (!request && ruleCustomerRequest) {
    request = truncateCustomerRequest(ruleCustomerRequest)
  }
  if (!pain && rulePainPoint) {
    pain = truncatePainPoint(rulePainPoint)
  }

  if (pain && LEADING_PHRASE_RE.test(pain)) {
    pain = truncatePainPoint(rulePainPoint) || pain.replace(LEADING_PHRASE_RE, '').trim()
  }

  if (request && pain && request.replace(/\s/g, '') === pain.replace(/\s/g, '')) {
    // 咨询类可接受相同；否则保留 request，pain 尝试规则版
    if (rulePainPoint && rulePainPoint.replace(/\s/g, '') !== request.replace(/\s/g, '')) {
      pain = truncatePainPoint(rulePainPoint)
    }
  }

  let total = request.length + pain.length
  if (total > PAIR_TOTAL_MAX) {
    if (request.length > 80) {
      request = request.slice(0, 80)
    }
    if (request.length + pain.length > PAIR_TOTAL_MAX && pain.length > 60) {
      pain = pain.slice(0, 60)
      if (pain && !/[。！？!?]$/.test(pain)) pain = `${pain.replace(/[，,；;]$/, '')}。`
    }
  }

  if (request.length > CUSTOMER_REQUEST_HARD_MAX) {
    request = request.slice(0, CUSTOMER_REQUEST_HARD_MAX)
  }
  if (pain.length > PAIN_POINT_HARD_MAX) {
    pain = truncatePainPoint(pain)
  }

  return { customerRequest: request, painPoint: pain }
}
