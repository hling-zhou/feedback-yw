import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-req-progress-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-req-progress'

let sqliteAvailable = false

try {
  const { closeDb, getDb } = await import('./db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

describe.skipIf(!sqliteAvailable)('requirementTicketProgressRepository', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const { initBusinessSchema } = await import('./businessDb.js')
    initBusinessSchema()
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('imports incrementally and updates existing rows without deleting others', async () => {
    const { requirementTicketProgressRepository } = await import('./requirementTicketProgressRepository.js')

    const first = requirementTicketProgressRepository.importProgressRows([
      { ticketId: 'REQ-A', product: 'VPC', scheduleAt: '2026-06-01', workflowStatus: '开发中' },
      { ticketId: 'REQ-B', product: 'EIP', scheduleAt: '2026-07-01', workflowStatus: '联调中' },
    ])
    expect(first.inserted).toBe(2)
    expect(first.updated).toBe(0)

    const second = requirementTicketProgressRepository.importProgressRows([
      { ticketId: 'REQ-A', product: 'VPC', scheduleAt: '2026-08-01', workflowStatus: '测试中' },
      { ticketId: 'REQ-C', product: 'SLB', scheduleAt: '2026-09-01', workflowStatus: '未排期' },
    ])
    expect(second.inserted).toBe(1)
    expect(second.updated).toBe(1)

    const listed = requirementTicketProgressRepository.listProgress({ limit: 50 })
    expect(listed.total).toBe(3)
    const reqA = listed.items.find((item) => item.ticketId === 'REQ-A')
    expect(reqA?.scheduleAt).toBe('2026-08-01')
    expect(reqA?.workflowStatus).toBe('测试中')

    const byIds = requirementTicketProgressRepository.getProgressByTicketIds(['REQ-B', 'REQ-C'])
    expect(byIds.get('REQ-B')?.product).toBe('EIP')
    expect(byIds.get('REQ-C')?.product).toBe('SLB')
  })

  it('replaces status mappings', async () => {
    const { requirementTicketProgressRepository } = await import('./requirementTicketProgressRepository.js')

    const saved = requirementTicketProgressRepository.replaceStatusMappings([
      { workflowStatus: '开发中', mapsToActionStatus: 'in_progress', sortOrder: 0 },
      { workflowStatus: '已上线', mapsToActionStatus: 'completed', sortOrder: 1 },
    ])
    expect(saved.ok).toBe(true)
    expect(saved.items).toHaveLength(2)

    const map = requirementTicketProgressRepository.getStatusMappingMap()
    expect(map.get('开发中')?.mapsToActionStatus).toBe('in_progress')
    expect(map.get('已上线')?.mapsToActionStatus).toBe('completed')
  })

  it('allows multiple external workflow statuses to map to the same action status', async () => {
    const { requirementTicketProgressRepository } = await import('./requirementTicketProgressRepository.js')

    const saved = requirementTicketProgressRepository.replaceStatusMappings([
      { workflowStatus: '开发中', mapsToActionStatus: 'in_progress', sortOrder: 0 },
      { workflowStatus: '联调中', mapsToActionStatus: 'in_progress', sortOrder: 1 },
      { workflowStatus: '测试中', mapsToActionStatus: 'in_progress', sortOrder: 2 },
      { workflowStatus: '已上线', mapsToActionStatus: 'completed', sortOrder: 3 },
    ])
    expect(saved.ok).toBe(true)
    expect(saved.items).toHaveLength(4)

    const map = requirementTicketProgressRepository.getStatusMappingMap()
    expect(map.get('开发中')?.mapsToActionStatus).toBe('in_progress')
    expect(map.get('联调中')?.mapsToActionStatus).toBe('in_progress')
    expect(map.get('测试中')?.mapsToActionStatus).toBe('in_progress')
    expect(map.get('已上线')?.mapsToActionStatus).toBe('completed')
  })

  it('rejects duplicate workflow statuses when saving mappings', async () => {
    const { requirementTicketProgressRepository } = await import('./requirementTicketProgressRepository.js')

    requirementTicketProgressRepository.replaceStatusMappings([
      { workflowStatus: '开发中', mapsToActionStatus: 'in_progress', sortOrder: 0 },
    ])

    const saved = requirementTicketProgressRepository.replaceStatusMappings([
      { workflowStatus: '开发中', mapsToActionStatus: 'in_progress', sortOrder: 0 },
      { workflowStatus: '开发中', mapsToActionStatus: 'completed', sortOrder: 1 },
    ])
    expect(saved.ok).toBe(false)
    expect(saved.errors[0]?.message).toContain('重复')

    const map = requirementTicketProgressRepository.getStatusMappingMap()
    expect(map.get('开发中')?.mapsToActionStatus).toBe('in_progress')
  })
})
