/** @type {import('json-schema').JSONSchema7} */
export const assistantChatBodySchema = {
  type: 'object',
  required: ['threadId', 'question'],
  properties: {
    threadId: { type: 'string', minLength: 1, maxLength: 128 },
    question: { type: 'string', minLength: 1, maxLength: 2000 },
    insightPeriodId: { type: 'string', maxLength: 128 },
    pageContext: {
      type: 'object',
      properties: {
        pathname: { type: 'string', maxLength: 256 },
        query: { type: 'object', additionalProperties: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
}

/** @type {import('json-schema').JSONSchema7} */
export const assistantThreadCreateBodySchema = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 80 },
    insightPeriodId: { type: 'string', maxLength: 128 },
    question: { type: 'string', maxLength: 2000 },
    pageContext: {
      type: 'object',
      properties: {
        pathname: { type: 'string', maxLength: 256 },
        query: { type: 'object', additionalProperties: { type: 'string' } },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
}
