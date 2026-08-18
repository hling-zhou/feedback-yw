import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { TICKET_TODO_UNASSIGNED_ASSIGNEE } from '../../src/domain/ticketTodo.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-ticket-todos-api-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-ticket-todos-xx'
process.env.CORS_ORIGINS = 'http://127.0.0.1:5175'

let sqliteAvailable = false
try {
  const { closeDb, getDb } = await import('../db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

/** @type {import('fastify').FastifyInstance} */
let app
/** @type {Record<string, string>} */
let tokens = {}

function authHeader(role) {
  return { authorization: `Bearer ${tokens[role]}` }
}

function makeTicket(overrides = {}) {
  return {
    id: 'rec-todo-1',
    ticketId: 'C-100',
    dataSourceType: 'complaint_ticket',
    tenantId: 'default',
    schemaVersion: 1,
    recordStatus: 'analyzed',
    importedAt: '2026-05-01T00:00:00.000Z',
    importMonth: '2026-05',
    productKey: 'vpc',
    product: 'VPC',
    painPoint: '控制台卡顿',
    problemType: '故障',
    journeyL1: '使用',
    ticketTodo: {
      items: [
        {
          id: 'td-open',
          text: '复盘跟进厂商',
          done: false,
          assigneeUserId: 'u1',
          assigneeUsername: '张三',
        },
        {
          id: 'td-done',
          text: '已沟通无需举措',
          done: true,
        },
      ],
    },
    ...overrides,
  }
}

const describeTicketTodos = sqliteAvailable ? describe : describe.skip

describeTicketTodos('ticket todos API', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const viewer = await createUser({
      username: 'todo_viewer',
      password: 'ViewerPass12345!',
      team: '测试',
      role: 'viewer',
    })
    tokens = { viewer: signAccessToken(viewer) }

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerTicketTodoRoutes } = await import('./ticketTodos.js')
    app = Fastify()
    registerAuthHooks(app)
    registerTicketTodoRoutes(app)
    await app.ready()

    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putRecord(makeTicket())
    storageRepository.putRecord(
      makeTicket({
        id: 'rec-todo-consult',
        ticketId: 'Z-200',
        dataSourceType: 'consultation_ticket',
        productKey: 'eip',
        product: '弹性公网IP',
        ticketTodo: {
          items: [
            {
              id: 'td-convert',
              text: '转举措',
              resolution: 'converted_to_action',
              done: true,
              linkedActionId: 'act-1',
            },
          ],
        },
      }),
    )
    storageRepository.putRecord(
      makeTicket({
        id: 'rec-todo-rating',
        ticketId: 'P-9',
        dataSourceType: 'post_use_rating',
        ticketTodo: {
          items: [{ id: 'td-skip', text: '不该出现', done: false }],
        },
      }),
    )
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('lists flattened meeting todos from complaint and consultation tickets', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/ticket-todos?limit=50',
      headers: authHeader('viewer'),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.total).toBe(3)
    expect(body.items.map((row) => row.ticketTodoItemId).sort()).toEqual([
      'td-convert',
      'td-done',
      'td-open',
    ])
    expect(body.items.find((row) => row.ticketTodoItemId === 'td-done').resolution).toBe(
      'processed_without_action',
    )
  })

  it('filters by assignee including unassigned and computes conversion stats', async () => {
    const unassigned = await app.inject({
      method: 'GET',
      url: `/api/ticket-todos?assigneeUserIds=${TICKET_TODO_UNASSIGNED_ASSIGNEE}`,
      headers: authHeader('viewer'),
    })
    expect(JSON.parse(unassigned.body).total).toBe(2)

    const stats = await app.inject({
      method: 'GET',
      url: '/api/ticket-todos/stats',
      headers: authHeader('viewer'),
    })
    expect(stats.statusCode).toBe(200)
    const body = JSON.parse(stats.body)
    expect(body.counts.open).toBe(1)
    expect(body.counts.converted_to_action).toBe(1)
    expect(body.counts.processed_without_action).toBe(1)
    expect(body.conversionRate).toBe(33.3)
    expect(body.byProduct.length).toBeGreaterThanOrEqual(2)
    expect(body.facets.hasUnassigned).toBe(true)
    expect(body.facets.products.map((item) => item.productKey).sort()).toEqual(['eip', 'vpc'])
    expect(body.facets.assignees).toEqual(
      expect.arrayContaining([{ userId: 'u1', username: '张三' }]),
    )
  })
})
