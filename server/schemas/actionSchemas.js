import { STRICT_OBJECT, actionItemStatusSchema, uuidParamSchema } from './common.js'

/** @type {import('json-schema').JSONSchema7} */
export const createActionBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['content'],
  properties: {
    content: { type: 'string', minLength: 1, maxLength: 1000 },
    productKey: { type: 'string', maxLength: 64 },
    productName: { type: 'string', maxLength: 128 },
    status: actionItemStatusSchema,
    firstProposedAt: { type: 'string', maxLength: 32 },
    scheduleAt: { type: 'string', maxLength: 128 },
    painPointSnapshot: { type: 'string', maxLength: 2000 },
    problemTypeSnapshot: { type: 'string', maxLength: 256 },
    journeyL1Snapshot: { type: 'string', maxLength: 256 },
    linkedTicketIds: {
      type: 'array',
      maxItems: 500,
      items: { type: 'string', minLength: 1, maxLength: 128 },
    },
    linkedDataSources: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', maxLength: 64 },
    },
    scheduleChanged: { type: 'boolean' },
    warningLevel: { type: 'string', enum: ['none', 'orange', 'red'] },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const batchCreateActionsBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: createActionBodySchema,
    },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const patchActionBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  minProperties: 1,
  properties: {
    content: { type: 'string', minLength: 1, maxLength: 1000 },
    productKey: { type: 'string', maxLength: 64 },
    productName: { type: 'string', maxLength: 128 },
    status: actionItemStatusSchema,
    firstProposedAt: { type: 'string', maxLength: 32 },
    scheduleAt: { type: 'string', maxLength: 128 },
    painPointSnapshot: { type: 'string', maxLength: 2000 },
    problemTypeSnapshot: { type: 'string', maxLength: 256 },
    journeyL1Snapshot: { type: 'string', maxLength: 256 },
    linkedTicketIds: {
      type: 'array',
      maxItems: 500,
      items: { type: 'string', minLength: 1, maxLength: 128 },
    },
    linkedDataSources: {
      type: 'array',
      maxItems: 20,
      items: { type: 'string', maxLength: 64 },
    },
    scheduleChanged: { type: 'boolean' },
    warningLevel: { type: 'string', enum: ['none', 'orange', 'red'] },
    expectedRevision: { type: 'integer', minimum: 0 },
  },
}

/** @type {import('json-schema').JSONSchema7} */
export const unlinkTicketsBodySchema = {
  type: 'object',
  ...STRICT_OBJECT,
  required: ['links'],
  properties: {
    links: {
      type: 'array',
      minItems: 1,
      maxItems: 500,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['actionId', 'ticketId'],
        properties: {
          actionId: { type: 'string', minLength: 1, maxLength: 64 },
          ticketId: { type: 'string', minLength: 1, maxLength: 128 },
        },
      },
    },
  },
}

export const actionIdParamsSchema = uuidParamSchema
