import { describe, expect, it, vi } from 'vitest'

vi.hoisted(() => {
  process.env.JWT_SECRET = 'test-jwt-secret-for-middleware-xx'
})

import { requireAdmin, requirePermission } from './middleware.js'

/**
 * @returns {{ code: number; body: unknown; sent: boolean; statusCode: number; json: unknown }}
 */
function mockReply() {
  /** @type {{ code: number; body: unknown; sent: boolean }} */
  const state = { code: 0, body: null, sent: false }
  const reply = {
    get statusCode() {
      return state.code
    },
    code(c) {
      state.code = c
      return reply
    },
    send(body) {
      state.body = body
      state.sent = true
      return reply
    },
    get json() {
      return state.body
    },
    get sent() {
      return state.sent
    },
  }
  return reply
}

describe('requirePermission(import)', () => {
  it('allows editor', async () => {
    const reply = mockReply()
    await requirePermission('import')(
      { user: { id: '1', role: 'editor', username: 'e', team: 't', status: 'active' } },
      reply,
    )
    expect(reply.sent).toBe(false)
  })

  it('blocks viewer', async () => {
    const reply = mockReply()
    await requirePermission('import')(
      { user: { id: '2', role: 'viewer', username: 'v', team: 't', status: 'active' } },
      reply,
    )
    expect(reply.statusCode).toBe(403)
    expect(reply.json).toMatchObject({ error: expect.stringMatching(/无权限/) })
  })
})

describe('requireAdmin', () => {
  it('allows admin', async () => {
    const reply = mockReply()
    await requireAdmin()(
      { user: { id: '3', role: 'admin', username: 'a', team: 't', status: 'active' } },
      reply,
    )
    expect(reply.sent).toBe(false)
  })

  it('blocks editor even with import permission', async () => {
    const reply = mockReply()
    await requireAdmin()(
      { user: { id: '4', role: 'editor', username: 'e', team: 't', status: 'active' } },
      reply,
    )
    expect(reply.statusCode).toBe(403)
    expect(reply.json).toMatchObject({ error: expect.stringMatching(/管理员/) })
  })
})
