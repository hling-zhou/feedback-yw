import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { createRequire } from 'module'
import { CC_USER_JOURNEY } from './ccJourney.js'
import { matchJourneyFromTextWithScore } from '../ticketTagging.js'

const require = createRequire(import.meta.url)
const UNKNOWN_L1 = '未识别环节'
const DB_PATH = join(process.cwd(), 'server/data/auth.db')

function loadCcTicketsFromDb() {
  if (!existsSync(DB_PATH)) return []
  const Database = require('better-sqlite3')
  const db = new Database(DB_PATH, { readonly: true })
  try {
    const rows = db.prepare('SELECT payload FROM records').all()
    return rows
      .map((r) => JSON.parse(r.payload))
      // 工单类 only：旅程校准对象是投诉/咨询工单文本。用后即评记录无工单正文
      //（rawText 恒为「无」），7-31 导入 5.2 万条后混入会把匹配率稀释到 0.13~0.22
      //（11-18 实测四产品用后即评 0 命中）——测试 6-17 建立时库内只有工单类，
      // 口径本就是工单文本校准，这里显式恢复该口径。
      .filter((r) => r.productKey === 'cc' && (r.dataSourceType === 'complaint_ticket' || r.dataSourceType === 'consultation_ticket'))
  } finally {
    db.close()
  }
}

describe('CC_USER_JOURNEY calibration', () => {
  it('has 6 L1 and 14 L2 nodes', () => {
    expect(CC_USER_JOURNEY).toHaveLength(6)
    const l2Count = CC_USER_JOURNEY.reduce((n, l1) => n + (l1.children?.length || 0), 0)
    expect(l2Count).toBe(14)
    expect(CC_USER_JOURNEY.map((j) => j.id)).toEqual([
      'discover',
      'provision',
      'configure',
      'operate',
      'release',
      'service',
    ])
  })

  // 11-18 注：loader 同步全量 SELECT + 5 万次 JSON.parse，四文件并发时机器争用可超默认 5s
  //（单文件跑 2.4s 稳定绿）——超时上限放宽到 30s，断言不变。
  it('matches ≥90% of local cc tickets when DB present', () => {
    const tickets = loadCcTicketsFromDb()
    if (tickets.length === 0) return

    let matched = 0
    for (const r of tickets) {
      const text = `${r.rawText || ''}${r.handlingText || ''}${r.customerRequest || ''}`
      const { journeyL1 } = matchJourneyFromTextWithScore(text, CC_USER_JOURNEY, 'cc')
      if (journeyL1 !== UNKNOWN_L1) matched++
    }

    const rate = matched / tickets.length
    expect(rate).toBeGreaterThanOrEqual(0.9)
  }, 30_000)

  it('syncs cc.json journeys with builtin SSOT', () => {
    const jsonPath = join(process.cwd(), 'public/config/taxonomy/cc.json')
    const parsed = JSON.parse(readFileSync(jsonPath, 'utf8'))
    expect(parsed.key).toBe('cc')
    expect(parsed.name).toBe('云组网')
    expect(parsed.journeys).toHaveLength(CC_USER_JOURNEY.length)
    expect(parsed.journeys[1].id).toBe('provision')
    expect(parsed.journeys[1].label).toBe('开通与订购')
  })
})
