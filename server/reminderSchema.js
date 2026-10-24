export const reminderPreviewBodySchema = {
  body: {
    type: 'object',
    required: [],
    properties: {
      insightPeriodId: { type: 'string' },
    },
    additionalProperties: false,
  },
}

export const reminderSendBodySchema = {
  body: {
    type: 'object',
    required: ['insightPeriodId'],
    properties: {
      insightPeriodId: { type: 'string' },
      skipLlm: { type: 'boolean', default: false },
    },
    additionalProperties: false,
  },
}
