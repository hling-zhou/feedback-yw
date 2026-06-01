import { DATA_SOURCE_TYPES } from '../../src/domain/enums.js'
import { STRICT_OBJECT, backgroundTaskTypeSchema, uuidParamSchema } from './common.js'

/** @type {import('json-schema').JSONSchema7} */
const entityWithIdSchema = {
  type: 'object',
  additionalProperties: true,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 128 },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const backgroundTaskAcquireBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['type'],
  properties: {
    type: backgroundTaskTypeSchema,
    progress: { type: 'string', maxLength: 500 },
    meta: { type: 'object', additionalProperties: true },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const backgroundTaskTouchBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  minProperties: 1,
  properties: {
    progress: { type: 'string', maxLength: 500 },
    meta: { type: 'object', additionalProperties: true },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const insightRebuildBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['insightPeriodId'],
  properties: {
    insightPeriodId: { type: 'string', minLength: 1, maxLength: 128 },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const recordsBatchBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['records'],
  properties: {
    records: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: { type: 'object', additionalProperties: true },
    },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const recordPatchBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['record'],
  properties: {
    record: entityWithIdSchema,
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const recordIdParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1, maxLength: 128 },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const periodPutBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['period'],
  properties: {
    period: entityWithIdSchema,
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const recordsReplaceBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['records'],
  properties: {
    records: {
      type: 'array',
      maxItems: 50000,
      items: { type: 'object', additionalProperties: true },
    },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const runPutBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['run'],
  properties: {
    run: entityWithIdSchema,
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const artifactPutBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['artifact'],
  properties: {
    artifact: entityWithIdSchema,
    debug: { type: 'boolean' },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const snapshotPutBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['snapshot'],
  properties: {
    snapshot: entityWithIdSchema,
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const metaPutBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['value'],
  properties: {
    value: {},
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const metaKeyParamsSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['key'],
  properties: {
    key: { type: 'string', minLength: 1, maxLength: 128, pattern: '^[A-Za-z0-9_.-]+$' },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const clearImportedDataQuerySchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    all: { type: 'string', enum: ['true', 'false'] },
    scope: { type: 'string', enum: ['all'] },
    insightPeriodId: { type: 'string', minLength: 1, maxLength: 128 },
    dataSourceType: { type: 'string', enum: [...DATA_SOURCE_TYPES] },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const tagCandidatesPutBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  minProperties: 1,
  properties: {
    candidate: {
      type: 'object',
      additionalProperties: true,
      required: ['id'],
      properties: {
        id: { type: 'string', minLength: 1, maxLength: 128 },
      },
    },
    candidates: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: true,
        required: ['id'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
  },
}

export const tagCandidateIdParamsSchema = uuidParamSchema
