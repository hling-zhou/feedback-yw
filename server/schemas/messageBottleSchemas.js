import { STRICT_OBJECT } from './common.js'
import {
  MESSAGE_BOTTLE_ATTACHMENT_MAX,
  MESSAGE_BOTTLE_CONTENT_MAX,
} from '../../src/domain/messageBottle.js'

/** @type {import('json-schema').JSONSchema7} */
export const messageBottleAttachmentSchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['dataUrl', 'fileName', 'mimeType'],
  properties: {
    dataUrl: { type: 'string', minLength: 16, maxLength: 4_000_000 },
    fileName: { type: 'string', minLength: 1, maxLength: 255 },
    mimeType: { type: 'string', minLength: 6, maxLength: 64 },
    size: { type: 'integer', minimum: 0, maximum: 10_000_000 },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const createMessageBottleBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['content'],
  properties: {
    content: { type: 'string', minLength: 1, maxLength: MESSAGE_BOTTLE_CONTENT_MAX },
    attachments: {
      type: 'array',
      maxItems: MESSAGE_BOTTLE_ATTACHMENT_MAX,
      items: messageBottleAttachmentSchema,
    },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const updateMessageBottleProgressBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['progress'],
  properties: {
    progress: { type: 'string', minLength: 1, maxLength: 500 },
  },
}
