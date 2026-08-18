export const DELETE_TICKET_CONFIRM_PHRASE = '删除补录工单'

/**
 * @param {unknown} value
 */
export function matchesDeleteTicketConfirmPhrase(value) {
  return String(value ?? '').trim() === DELETE_TICKET_CONFIRM_PHRASE
}
