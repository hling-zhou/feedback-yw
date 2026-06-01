/** @type {import('json-schema').JSONSchema7} */
export const llmChatBodySchema = {
  type: 'object',
  minProperties: 1,
  properties: {
    apiKey: { type: 'string', maxLength: 512 },
    baseUrl: { type: 'string', maxLength: 512 },
    model: { type: 'string', maxLength: 128 },
    messages: {
      type: 'array',
      maxItems: 100,
      items: { type: 'object', additionalProperties: true },
    },
    temperature: { type: 'number', minimum: 0, maximum: 2 },
    max_tokens: { type: 'integer', minimum: 1, maximum: 128000 },
    stream: { type: 'boolean' },
  },
  additionalProperties: true,
}
