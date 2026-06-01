import { PASSWORD_MIN_LENGTH } from '../../src/domain/passwordPolicy.js'
import { STRICT_OBJECT } from './common.js'

/** @type {import('json-schema').JSONSchema7} */
export const loginBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['username', 'password'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64 },
    password: { type: 'string', minLength: 1, maxLength: 256 },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const changePasswordBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['username', 'currentPassword', 'newPassword'],
  properties: {
    username: { type: 'string', minLength: 1, maxLength: 64 },
    currentPassword: { type: 'string', minLength: 1, maxLength: 256 },
    newPassword: { type: 'string', minLength: PASSWORD_MIN_LENGTH, maxLength: 256 },
  },
}
