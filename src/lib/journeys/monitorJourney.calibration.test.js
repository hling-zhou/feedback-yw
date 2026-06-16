import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import { MONITOR_USER_JOURNEY } from './monitorJourney.js'
import { matchJourneyFromTextWithScore } from '../ticketTagging.js'

const require = createRequire(import.meta.url)
const UNKNOWN_L1 = '未识别环节'
const DB_PATH = join(process.cwd(), 'server/data/auth.db')

function loadMonitorTicketsFromDb() {
  if (!existsSync(DB_PATH)) return []
  const Database = require('better-sqlite3')
  const db = new Database(DB_PATH, { readonly: true })
  try {
    const rows = db.prepare('SELECT payload FROM records').all()
    return rows
      .map((r) => JSON.parse(r.payload))
      .filter((r) => r.productKey === 'monitor')
  } finally {
    db.close()
  }
}

describe('MONITOR_USER_JOURNEY calibration', () => {
  it('has 5 L1 and 15 L2 nodes', () => {
    expect(MONITOR_USER_JOURNEY).toHaveLength(5)
    const l2Count = MONITOR_USER_JOURNEY.reduce((n, l1) => n + (l1.children?.length || 0), 0)
    expect(l2Count).toBe(15)
    expect(MONITOR_USER_JOURNEY.map((j) => j.id)).toEqual([
      'discover',
      'access',
      'configure',
      'operate',
      'service',
    ])
  })

  it('matches ≥90% of local monitor tickets when DB present', () => {
    const tickets = loadMonitorTicketsFromDb()
    if (tickets.length === 0) return

    let matched = 0
    for (const r of tickets) {
      const text = `${r.rawText || ''}${r.handlingText || ''}${r.customerRequest || ''}`
      const { journeyL1 } = matchJourneyFromTextWithScore(text, MONITOR_USER_JOURNEY, 'monitor')
      if (journeyL1 !== UNKNOWN_L1) matched++
    }

    const rate = matched / tickets.length
    expect(rate).toBeGreaterThanOrEqual(0.9)
  })

  it('syncs monitor.json journeys with builtin SSOT', () => {
    const jsonPath = join(process.cwd(), 'public/config/taxonomy/monitor.json')
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'))
    expect(parsed.key).toBe('monitor')
    expect(parsed.journeys).toHaveLength(MONITOR_USER_JOURNEY.length)
    expect(parsed.journeys[1].id).toBe('access')
    expect(parsed.journeys[1].label).toBe('接入与使用准备')
  })
})
