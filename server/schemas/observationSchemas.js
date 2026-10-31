import { STRICT_OBJECT } from './common.js'
import {
  OBSERVATION_ISSUE_STATUSES,
  OBSERVATION_LINK_SOURCES,
  OBSERVATION_SUMMARY_MAX_LENGTH,
} from '../../src/domain/observationIssue.js'

/** @typedef {import('json-schema').JSONSchema7} JSONSchema7 */

const ISSUE_ID_PARAM = { type: 'string', minLength: 1, maxLength: 64 }

/** @type {JSONSchema7} */
export const observationIssueIdParamsSchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['id'],
  properties: { id: ISSUE_ID_PARAM },
}

/** @type {JSONSchema7} */
export const observationLinkParamsSchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['id', 'linkId'],
  properties: {
    id: ISSUE_ID_PARAM,
    linkId: { type: 'string', minLength: 1, maxLength: 64 },
  },
}

/** @type {JSONSchema7} */
export const observationLinkReviewParamsSchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['linkId'],
  properties: { linkId: { type: 'string', minLength: 1, maxLength: 64 } },
}

const summaryField = {
  type: 'string',
  minLength: 1,
  maxLength: OBSERVATION_SUMMARY_MAX_LENGTH,
}

const titleField = {
  type: 'string',
  minLength: 1,
  maxLength: OBSERVATION_SUMMARY_MAX_LENGTH,
}

/** @type {JSONSchema7} */
export const observationIssueCreateBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['productKey', 'productName', 'title', 'summary'],
  properties: {
    productKey: { type: 'string', minLength: 1, maxLength: 128 },
    productName: { type: 'string', minLength: 1, maxLength: 128 },
    title: titleField,
    summary: summaryField,
    keywords: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 32 },
    },
    notes: { type: 'string', maxLength: 2000 },
    // 可选：创建时同时挂首条证据（confirmed）
    firstLink: {
      type: 'object',
      ...STRICT_OBJECT,
      required: ['recordId', 'recordDataSource'],
      properties: {
        recordId: { type: 'string', minLength: 1, maxLength: 64 },
        recordDataSource: {
          type: 'string',
          enum: ['complaint_ticket', 'consultation_ticket', 'post_use_rating'],
        },
        ticketId: { type: 'string', maxLength: 64 },
      },
    },
  },
}

/** @type {JSONSchema7} */
export const observationIssuePatchBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  properties: {
    title: titleField,
    summary: summaryField,
    status: { type: 'string', enum: OBSERVATION_ISSUE_STATUSES },
    keywords: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', minLength: 1, maxLength: 32 },
    },
    notes: { type: 'string', maxLength: 2000 },
  },
}

/** @type {JSONSchema7} */
export const observationLinkCreateBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['recordId', 'recordDataSource'],
  properties: {
    recordId: { type: 'string', minLength: 1, maxLength: 64 },
    recordDataSource: {
      type: 'string',
      enum: ['complaint_ticket', 'consultation_ticket', 'post_use_rating'],
    },
    ticketId: { type: 'string', maxLength: 64 },
    // 人工推翻早前 dismissed（S3）：前端已做二次确认
    overrideDismissed: { type: 'boolean' },
  },
}

/** @type {JSONSchema7} */
export const observationLinkReviewBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['confirm', 'dismiss', 'new_issue'] },
    // action=new_issue 时：新问题本体（复用 create 字段子集）
    newIssue: {
      type: 'object',
      ...STRICT_OBJECT,
      required: ['title', 'summary', 'productKey', 'productName'],
      properties: {
        title: titleField,
        summary: summaryField,
        productKey: { type: 'string', minLength: 1, maxLength: 128 },
        productName: { type: 'string', minLength: 1, maxLength: 128 },
        keywords: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', minLength: 1, maxLength: 32 },
        },
        notes: { type: 'string', maxLength: 2000 },
      },
    },
  },
}

/** @type {JSONSchema7} */
export const observationRecordSearchParamsSchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['query'],
  properties: {
    query: { type: 'string', minLength: 1, maxLength: 128 },
    productKey: { type: 'string', maxLength: 128 },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
}

/** @type {JSONSchema7} */
export const observationScanBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  properties: {
    importMonth: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
    recordIds: {
      type: 'array',
      maxItems: 5000,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
  },
}

/** link_source 白名单（写路径用） */
export const OBSERVATION_LINK_SOURCE_ENUM = OBSERVATION_LINK_SOURCES
