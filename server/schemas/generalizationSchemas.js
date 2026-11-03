import { STRICT_OBJECT } from './common.js'
import {
  GENERALIZATION_CATEGORIES,
  GENERALIZATION_ISSUE_STATUSES,
  GENERALIZATION_LINK_SOURCES,
  GENERALIZATION_SCOPES,
  GENERALIZATION_ROOT_CAUSE_MAX_LENGTH,
  GENERALIZATION_OPTIMIZATION_MAX_LENGTH,
  GENERALIZATION_SUMMARY_MAX_LENGTH,
} from '../../src/domain/generalizationIssue.js'

/** @typedef {import('json-schema').JSONSchema7} JSONSchema7 */

/**
 * 举一反三路由 schema —— docs/DESIGN-20261102-1.md §4.1
 * 口径：创建 category/scope 必填；root_cause/optimization 创建可空、PATCH 出现即必填非空（防"先填后清空"绕过）。
 */

const ISSUE_ID_PARAM = { type: 'string', minLength: 1, maxLength: 64 }

/** @type {JSONSchema7} */
export const generalizationIssueIdParamsSchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['id'],
  properties: { id: ISSUE_ID_PARAM },
}

/** @type {JSONSchema7} */
export const generalizationLinkParamsSchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['id', 'linkId'],
  properties: {
    id: ISSUE_ID_PARAM,
    linkId: { type: 'string', minLength: 1, maxLength: 64 },
  },
}

/** @type {JSONSchema7} */
export const generalizationLinkReviewParamsSchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['linkId'],
  properties: { linkId: { type: 'string', minLength: 1, maxLength: 64 } },
}

/** @type {JSONSchema7} */
export const generalizationHintParamsSchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['recordId'],
  properties: { recordId: { type: 'string', minLength: 1, maxLength: 64 } },
}

const titleField = {
  type: 'string',
  minLength: 1,
  maxLength: GENERALIZATION_SUMMARY_MAX_LENGTH,
}

const summaryField = {
  type: 'string',
  minLength: 1,
  maxLength: GENERALIZATION_SUMMARY_MAX_LENGTH,
}

const categoryField = {
  type: 'string',
  enum: GENERALIZATION_CATEGORIES,
}

const scopeField = {
  type: 'string',
  enum: GENERALIZATION_SCOPES,
}

const keywordsField = {
  type: 'array',
  maxItems: 20,
  items: { type: 'string', minLength: 1, maxLength: 32 },
}

/** @type {JSONSchema7} */
export const generalizationIssueCreateBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['productKey', 'productName', 'title', 'summary', 'category', 'scope'],
  properties: {
    productKey: { type: 'string', minLength: 1, maxLength: 128 },
    productName: { type: 'string', minLength: 1, maxLength: 128 },
    title: titleField,
    summary: summaryField,
    category: categoryField,
    scope: scopeField,
    // 创建可空（v3.4：创建后到 Tab 侧滑补全，编辑时必填）
    rootCause: { type: 'string', maxLength: GENERALIZATION_ROOT_CAUSE_MAX_LENGTH },
    optimization: { type: 'string', maxLength: GENERALIZATION_OPTIMIZATION_MAX_LENGTH },
    keywords: keywordsField,
    notes: { type: 'string', maxLength: 2000 },
    // 「其他」范畴自定义说明（11-04：category=other_intervenable 时前端必填；≤100 字）
    categoryOther: { type: 'string', maxLength: 100 },
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

/**
 * PATCH：字段出现即校验；root_cause/optimization 出现即必填非空
 * —— JSON Schema 层用 minLength:1 保证"出现且空串"被拒（fastify 400），
 * 字段不出现在 body 时不动该列（部分更新语义），由 repository 区分。
 */
const patchTextField = (max) => ({
  type: 'string',
  minLength: 1,
  maxLength: max,
})

/** @type {JSONSchema7} */
export const generalizationIssuePatchBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  properties: {
    title: titleField,
    summary: summaryField,
    category: categoryField,
    scope: scopeField,
    // PATCH 出现即必填非空（防清空绕过——v3.4）
    rootCause: patchTextField(GENERALIZATION_ROOT_CAUSE_MAX_LENGTH),
    optimization: patchTextField(GENERALIZATION_OPTIMIZATION_MAX_LENGTH),
    status: { type: 'string', enum: GENERALIZATION_ISSUE_STATUSES },
    keywords: keywordsField,
    notes: { type: 'string', maxLength: 2000 },
  },
}

/** @type {JSONSchema7} */
export const generalizationLinkCreateBodySchema = {
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
    // 人工推翻早前 dismissed：前端已做二次确认
    overrideDismissed: { type: 'boolean' },
  },
}

/** @type {JSONSchema7} */
export const generalizationLinkReviewBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['action'],
  properties: {
    action: { type: 'string', enum: ['confirm', 'dismiss', 'new_issue'] },
    // action=new_issue 时：新问题本体（复用 create 字段子集）
    newIssue: {
      type: 'object',
      ...STRICT_OBJECT,
      required: ['title', 'summary', 'productKey', 'productName', 'category', 'scope'],
      properties: {
        title: titleField,
        summary: summaryField,
        productKey: { type: 'string', minLength: 1, maxLength: 128 },
        productName: { type: 'string', minLength: 1, maxLength: 128 },
        category: categoryField,
        scope: scopeField,
        keywords: keywordsField,
        notes: { type: 'string', maxLength: 2000 },
        categoryOther: { type: 'string', maxLength: 100 },
      },
    },
  },
}

/** @type {JSONSchema7} */
export const generalizationRecordSearchParamsSchema = {
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
export const generalizationScanBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  properties: {
    importMonth: { type: 'string', pattern: '^\\d{4}-\\d{2}$' },
    recordIds: {
      type: 'array',
      maxItems: 5000,
      items: { type: 'string', minLength: 1, maxLength: 64 },
    },
    // 跳过留观段只跑举一反三段（手动补跑口径，TASKS §1）
    generalizationOnly: { type: 'boolean' },
    // G-pass 显式重判（默认三态 hint 均跳过）
    gPassRetry: { type: 'boolean' },
  },
}

/**
 * 举措升级（from-action）——设计 §4.1 / §5.3。
 * mode=create：新建 gen issue（仅 optimization 可预填透传；root_cause 不预填——23:39 定稿）。
 * mode=link：关联已有 in_progress issue。
 */
/** @type {JSONSchema7} */
export const generalizationFromActionBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['actionItemId', 'mode'],
  properties: {
    actionItemId: { type: 'string', minLength: 1, maxLength: 64 },
    mode: { type: 'string', enum: ['create', 'link'] },
    // mode=link 必填（schema 层无法条件必填，由路由层二次校验返回 400）
    issueId: { type: 'string', minLength: 1, maxLength: 64 },
    // mode=create 时的本体（title/summary/category/scope 必填；root_cause 不出现——升级后在 Tab 补全）
    title: titleField,
    summary: summaryField,
    category: categoryField,
    scope: scopeField,
    // 仅 optimization 预填=举措内容（可改可清空——创建允许空口径）
    optimization: { type: 'string', maxLength: GENERALIZATION_OPTIMIZATION_MAX_LENGTH },
    keywords: keywordsField,
    notes: { type: 'string', maxLength: 2000 },
    categoryOther: { type: 'string', maxLength: 100 },
  },
}

/** link_source 白名单（写路径用） */
export const GENERALIZATION_LINK_SOURCE_ENUM = GENERALIZATION_LINK_SOURCES
