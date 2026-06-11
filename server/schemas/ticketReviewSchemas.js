import { STRICT_OBJECT } from './common.js'

/** @typedef {import('json-schema').JSONSchema7} JSONSchema7 */

/** @type {JSONSchema7} */
export const ticketReviewRecordIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['recordId'],
  properties: {
    recordId: { type: 'string', minLength: 1, maxLength: 128 },
  },
}

/** @type {JSONSchema7} */
export const putTicketReviewBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['source'],
  properties: {
    source: { type: 'string', enum: ['manual', 'save'] },
  },
}
