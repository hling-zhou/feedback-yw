/** @typedef {import('json-schema').JSONSchema7} JSONSchema7 */

/** 拒绝未声明字段 */
export const STRICT_OBJECT = { additionalProperties: false }

/** Fastify 构造选项：保留 additionalProperties 校验，避免 Ajv 默认 strip 未知字段 */
export const FASTIFY_SCHEMA_OPTIONS = {
  ajv: {
    customOptions: {
      removeAdditional: false,
    },
  },
}

/** @type {JSONSchema7} */
export const userRoleSchema = {
  type: 'string',
  enum: ['admin', 'editor', 'partial_editor', 'viewer'],
}

/** @type {JSONSchema7} */
export const userStatusSchema = {
  type: 'string',
  enum: ['active', 'disabled'],
}

/** @type {JSONSchema7} */
export const actionItemStatusSchema = {
  type: 'string',
  enum: ['pending_evaluation', 'in_progress', 'completed', 'suspended'],
}

/** @type {JSONSchema7} */
export const backgroundTaskTypeSchema = {
  type: 'string',
  enum: ['import', 'retag', 'pdf_export'],
}

/** @type {JSONSchema7} */
export const uuidParamSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 64 },
  },
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function formatSchemaValidationError(err) {
  const validation = /** @type {{ validation?: { message?: string; instancePath?: string }[] }} */ (
    err
  ).validation
  if (!Array.isArray(validation) || !validation.length) {
    return err instanceof Error ? err.message : '请求参数不合法'
  }
  const first = validation[0]
  const path = first.instancePath?.replace(/^\//, '') || 'body'
  const detail = first.message || '不合法'
  return `参数 ${path} ${detail}`
}
