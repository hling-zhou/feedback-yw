import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import { NAT_USER_JOURNEY } from './natJourney.js'
import { matchJourneyFromTextWithScore } from '../ticketTagging.js'

const require = createRequire(import.meta.url)
const UNKNOWN_L1 = '未识别环节'
const DB_PATH = join(process.cwd(), 'server/data/auth.db')

function loadNatTicketsFromDb() {
  if (!existsSync(DB_PATH)) return []
  const Database = require('better-sqlite3')
  const db = new Database(DB_PATH, { readonly: true })
  try {
    const rows = db.prepare('SELECT payload FROM records').all()
    return rows
      .map((r) => JSON.parse(r.payload))
      .filter((r) => r.productKey === 'nat')
  } finally {
    db.close()
  }
}

describe('NAT_USER_JOURNEY calibration', () => {
  it('has 6 L1 and 15 L2 nodes', () => {
    expect(NAT_USER_JOURNEY).toHaveLength(6)
    const l2Count = NAT_USER_JOURNEY.reduce((n, l1) => n + (l1.children?.length || 0), 0)
    expect(l2Count).toBe(15)
    expect(NAT_USER_JOURNEY.map((j) => j.id)).toEqual([
      'discover',
      'provision',
      'configure',
      'operate',
      'release',
      'service',
    ])
  })

  it('matches ≥90% of local nat tickets when DB present', () => {
    const tickets = loadNatTicketsFromDb()
    if (tickets.length === 0) return

    let matched = 0
    for (const r of tickets) {
      const text = `${r.rawText || ''}${r.handlingText || ''}${r.customerRequest || ''}`
      const { journeyL1 } = matchJourneyFromTextWithScore(text, NAT_USER_JOURNEY, 'nat')
      if (journeyL1 !== UNKNOWN_L1) matched++
    }

    const rate = matched / tickets.length
    expect(rate).toBeGreaterThanOrEqual(0.9)
  })

  it('syncs nat.json journeys with builtin SSOT', () => {
    const jsonPath = join(process.cwd(), 'public/config/taxonomy/nat.json')
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'))
    expect(parsed.key).toBe('nat')
    expect(parsed.name).toBe('NAT网关')
    expect(parsed.journeys).toHaveLength(NAT_USER_JOURNEY.length)
    expect(parsed.journeys[1].id).toBe('provision')
    expect(parsed.journeys[1].label).toBe('开通与订购')
  })
})
