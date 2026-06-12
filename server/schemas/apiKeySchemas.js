import { STRICT_OBJECT } from './common.js'
import { API_KEY_SCOPES } from '../../src/domain/apiKey.js'

/** @type {import('json-schema').JSONSchema7} */
export const createApiKeyBodySchema = {
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 128 },
    scopes: {
      type: 'array',
      minItems: 1,
      maxItems: API_KEY_SCOPES.length,
      items: { type: 'string', enum: [...API_KEY_SCOPES] },
    },
    expiresAt: { type: 'string' },
  },
  required: ['name', 'scopes'],
  ...STRICT_OBJECT,
}

/** @type {import('json-schema').JSONSchema7} */
export const revokeApiKeyParamsSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 64 },
  },
  required: ['id'],
  ...STRICT_OBJECT,
}
