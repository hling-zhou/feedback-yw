import { PASSWORD_MIN_LENGTH } from '../../src/domain/passwordPolicy.js'
import { STRICT_OBJECT, userRoleSchema, userStatusSchema, uuidParamSchema } from './common.js'

/** @type {import('json-schema').JSONSchema7} */
export const createUserBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['username', 'password', 'team', 'role'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64 },
    password: { type: 'string', minLength: PASSWORD_MIN_LENGTH, maxLength: 256 },
    team: { type: 'string', minLength: 1, maxLength: 128 },
    role: userRoleSchema,
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const updateUserBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  minProperties: 1,
  properties: {
    team: { type: 'string', minLength: 1, maxLength: 128 },
    role: userRoleSchema,
    status: userStatusSchema,
    password: { type: 'string', minLength: PASSWORD_MIN_LENGTH, maxLength: 256 },
  },
}

export const updateUserParamsSchema = uuidParamSchema

/** @type {import('json-schema').JSONSchema7} */
export const batchCreateUsersBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['users'],
  properties: {
    users: {
      type: 'array',
      minItems: 1,
      maxItems: 200,
      items: createUserBodySchema,
    },
  },
}
