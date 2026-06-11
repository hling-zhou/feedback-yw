import { STRICT_OBJECT, actionItemStatusSchema } from './common.js'

/** @type {import('json-schema').JSONSchema7} */
export const requirementTicketProgressListQuerySchema = {
  type: 'object',
  properties: {
    ticketId: { type: 'string' },
    product: { type: 'string' },
    workflowStatus: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
    offset: { type: 'integer', minimum: 0 },
  },
  ...STRICT_OBJECT,
}

/** @type {import('json-schema').JSONSchema7} */
export const requirementTicketProgressImportBodySchema = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          ticketId: { type: 'string' },
          product: { type: 'string' },
          scheduleAt: { type: 'string' },
          workflowStatus: { type: 'string' },
        },
        required: ['ticketId'],
        ...STRICT_OBJECT,
      },
    },
  },
  required: ['rows'],
  ...STRICT_OBJECT,
}

/** @type {import('json-schema').JSONSchema7} */
/** @type {import('json-schema').JSONSchema7} */
export const requirementTicketProgressLookupBodySchema = {
  type: 'object',
  properties: {
    ticketIds: {
      type: 'array',
      maxItems: 100,
      items: { type: 'string', minLength: 1, maxLength: 128 },
    },
  },
  required: ['ticketIds'],
  ...STRICT_OBJECT,
}

export const requirementStatusMappingBodySchema = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          workflowStatus: { type: 'string' },
          mapsToActionStatus: actionItemStatusSchema,
          sortOrder: { type: 'integer' },
        },
        required: ['workflowStatus', 'mapsToActionStatus'],
        ...STRICT_OBJECT,
      },
    },
  },
  required: ['items'],
  ...STRICT_OBJECT,
}
