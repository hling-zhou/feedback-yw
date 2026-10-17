import { DATA_SOURCE_TYPES } from '../../src/domain/enums.js'
import { STRICT_OBJECT } from './common.js'

const emailArray = {
  type: 'array',
  items: { type: 'string', minLength: 3, maxLength: 254 },
  maxItems: 30,
}

export const mailChannelBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'dataSourceType', 'host', 'fromAddress'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    dataSourceType: { type: 'string', enum: [...DATA_SOURCE_TYPES] },
    host: { type: 'string', minLength: 1, maxLength: 255 },
    port: { type: 'integer', minimum: 1, maximum: 65535 },
    secure: { type: 'boolean' },
    username: { type: 'string', maxLength: 255 },
    password: { type: 'string', maxLength: 512 },
    fromAddress: { type: 'string', minLength: 3, maxLength: 254 },
  },
}

export const mailChannelPatchSchema = {
  type: 'object',
  additionalProperties: false,
  properties: mailChannelBodySchema.properties,
}

export const mailGroupBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    emails: { ...emailArray },
  },
}

export const mailTemplateBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'subject', 'body'],
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 80 },
    subject: { type: 'string', minLength: 1, maxLength: 200 },
    body: { type: 'string', minLength: 1, maxLength: 20000 },
  },
}

export const mailPublicUrlBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['publicAppUrl'],
  properties: {
    publicAppUrl: { type: 'string', maxLength: 500 },
  },
}

export const mailSendBodySchema = {
  type: 'object',
  additionalProperties: false,
  required: ['templateId', 'dataSourceType', 'to', 'attachment'],
  properties: {
    templateId: { type: 'string', minLength: 1, maxLength: 64 },
    dataSourceType: { type: 'string', enum: [...DATA_SOURCE_TYPES] },
    periodLabel: { type: 'string', maxLength: 80 },
    reportKey: { type: 'string', maxLength: 32 },
    reportKind: { type: 'string', enum: ['month', 'quarter'] },
    linkKind: { type: 'string', enum: ['report', 'workbench'] },
    to: { ...emailArray, minItems: 1 },
    cc: emailArray,
    note: { type: 'string', maxLength: 2000 },
    attachment: {
      type: 'object',
      additionalProperties: false,
      required: ['filename', 'mime', 'contentBase64'],
      properties: {
        filename: { type: 'string', minLength: 1, maxLength: 180 },
        mime: { type: 'string', minLength: 1, maxLength: 120 },
        contentBase64: { type: 'string', minLength: 1 },
      },
    },
  },
}

export { STRICT_OBJECT }
