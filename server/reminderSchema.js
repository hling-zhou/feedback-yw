/** @type {import('json-schema').JSONSchema7} */
export const reminderPreviewBodySchema = {
  type: 'object',
  required: [],
  properties: {
    insightPeriodId: { type: 'string' },
  },
  additionalProperties: false,
}

/** @type {import('json-schema').JSONSchema7} */
export const reminderSendBodySchema = {
  type: 'object',
  required: ['insightPeriodId'],
  properties: {
    insightPeriodId: { type: 'string' },
    skipLlm: { type: 'boolean', default: false },
  },
  additionalProperties: false,
}
