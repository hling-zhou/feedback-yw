/** @type {import('json-schema').JSONSchema7} */
export const knowledgeBaseRetrieveBodySchema = {
  type: 'object',
  required: ['queries'],
  properties: {
    queries: {
      type: 'array',
      maxItems: 200,
      items: {
        type: 'object',
        required: ['productKeys', 'text'],
        properties: {
          productKeys: {
            type: 'array',
            maxItems: 20,
            items: { type: 'string', maxLength: 64 },
          },
          text: { type: 'string', maxLength: 8000 },
          tags: {
            type: 'array',
            maxItems: 40,
            items: { type: 'string', maxLength: 64 },
          },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
}

/** 上传知识库：body 即整份 KB JSON（含 productLine / details）。 */
export const knowledgeBaseUploadBodySchema = {
  type: 'object',
  required: ['productLine', 'details'],
  properties: {
    productLine: { type: 'string', minLength: 1, maxLength: 64 },
    productName: { type: 'string', maxLength: 128 },
    exportDate: { type: 'string', maxLength: 32 },
    details: {
      type: 'array',
      maxItems: 5000,
      items: { type: 'object', additionalProperties: true },
    },
  },
  additionalProperties: true,
}

/** @type {import('json-schema').JSONSchema7} */
export const knowledgeBaseProductKeyParamsSchema = {
  type: 'object',
  required: ['productKey'],
  properties: {
    productKey: { type: 'string', minLength: 1, maxLength: 64 },
  },
  additionalProperties: false,
}

