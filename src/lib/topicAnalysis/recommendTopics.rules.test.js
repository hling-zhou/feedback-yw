import { describe, expect, it } from 'vitest'
import {
  applyUnresolvedOverlay,
  compactRecommendCardsForCache,
  isDirtyCustomerName,
  recommendTopics,
} from './recommendTopics.js'

function ticket(overrides = {}) {
  return {
    id: 'r1',
    ticketId: 'T-1',
    dataSourceType: 'complaint_ticket',
    product: '弹性公网IP',
    problemType: '带宽限速',
    importMonth: '2026-08',
    sourceColumns: { 集团名称: '甲公司', 集团客户编码: 'C001' },
    ...overrides,
  }
}

describe('recommendTopics rules', () => {
  it('skips placeholder problem keys for product and common cards', () => {
    const cards = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket({ id: 'a1', product: '弹性公网IP', problemType: '无/不涉及' }),
        ticket({ id: 'a2', product: '弹性公网IP', problemType: '无/不涉及' }),
        ticket({ id: 'a3', product: '云主机', problemType: '其他' }),
        ticket({ id: 'a4', product: '云主机', problemType: '其他' }),
        ticket({ id: 'a5', product: '弹性公网IP', problemType: '其他' }),
        ticket({ id: 'ok1', problemType: '退订' }),
        ticket({ id: 'ok2', product: '云主机', problemType: '退订' }),
        ticket({ id: 'ok3', product: '云主机', problemType: '退订' }),
      ],
    })
    expect(cards.some((card) => /无\/不涉及|其他/.test(card.title))).toBe(false)
    expect(cards.some((card) => card.title.includes('退订'))).toBe(true)
  })

  it('skips phone and placeholder customer names without a code, but keeps YDY_ accounts', () => {
    const cards = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket({
          id: 'p1',
          customerName: '13800138000',
          customerCode: '',
          sourceColumns: { 集团名称: '13800138000' },
          importMonth: '2026-08',
        }),
        ticket({
          id: 'p2',
          customerName: '13800138000',
          customerCode: '',
          sourceColumns: { 集团名称: '13800138000' },
          importMonth: '2026-07',
        }),
        ticket({
          id: 'n1',
          customerName: '无/不涉及',
          customerCode: '',
          sourceColumns: { 集团名称: '无/不涉及' },
        }),
        ticket({
          id: 'n2',
          customerName: '无/不涉及',
          customerCode: '',
          sourceColumns: { 集团名称: '无/不涉及' },
        }),
        ticket({
          id: 'y1',
          customerName: 'YDY_abc001',
          customerCode: '',
          sourceColumns: { 集团名称: 'YDY_abc001' },
          sentiment: 'negative',
        }),
        ticket({
          id: 'y2',
          customerName: 'YDY_abc001',
          customerCode: '',
          sourceColumns: { 集团名称: 'YDY_abc001' },
          sentiment: 'negative',
        }),
      ],
    })
    expect(isDirtyCustomerName('13800138000')).toBe(true)
    expect(isDirtyCustomerName('YDY_abc001')).toBe(false)
    expect(cards.some((card) => card.title.includes('13800138000'))).toBe(false)
    expect(cards.some((card) => card.title.includes('无/不涉及'))).toBe(false)
    expect(cards.some((card) => card.title.includes('YDY_abc001'))).toBe(true)
  })

  it('still groups by customer code when the display name is a phone number', () => {
    const cards = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket({
          id: 'c1',
          customerName: '13900001111',
          customerCode: 'G-9',
          sourceColumns: { 集团名称: '13900001111', 集团客户编码: 'G-9' },
        }),
        ticket({
          id: 'c2',
          customerName: '13900001111',
          customerCode: 'G-9',
          sourceColumns: { 集团名称: '13900001111', 集团客户编码: 'G-9' },
        }),
      ],
    })
    expect(cards.some((card) => card.type === 'customer' && card.customerCode === 'G-9')).toBe(true)
  })

  it('emits product and common cards from journey L2 in parallel with problem keys', () => {
    const cards = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket({ id: 'e1', product: '弹性公网IP', problemType: '无法访问', journeyL2: '退订/释放' }),
        ticket({ id: 'e2', product: '弹性公网IP', problemType: '无法访问', journeyL2: '退订/释放' }),
        ticket({ id: 'h1', product: '云主机', problemType: '控制台卡顿', journeyL2: '退订/释放' }),
        ticket({ id: 'h2', product: '云主机', problemType: '控制台卡顿', journeyL2: '退订/释放' }),
        ticket({ id: 'h3', product: '云主机', problemType: '控制台卡顿', journeyL2: '退订/释放' }),
      ],
    })
    expect(cards.some((card) => card.id === 'product:弹性公网IP:无法访问')).toBe(true)
    expect(cards.some((card) => card.id === 'product:弹性公网IP:l2:退订/释放')).toBe(true)
    expect(cards.some((card) => card.id === 'common:l2:退订/释放')).toBe(true)
  })

  it('skips unrecognized journey L2 placeholders', () => {
    const cards = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket({ id: 'u1', journeyL2: '未识别子环节', problemType: '' }),
        ticket({ id: 'u2', journeyL2: '未识别子环节', problemType: '' }),
        ticket({ id: 'u3', product: '云主机', journeyL2: '未识别子环节', problemType: '' }),
      ],
    })
    expect(cards.some((card) => String(card.title).includes('未识别子环节'))).toBe(false)
  })

  it('dedupes when L2 text equals the problem key title', () => {
    const cards = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket({ id: 'd1', problemType: '退订', journeyL2: '退订' }),
        ticket({ id: 'd2', problemType: '退订', journeyL2: '退订' }),
      ],
    })
    const titled = cards.filter((card) => card.type === 'product_issue' && card.title === '弹性公网IP · 退订')
    expect(titled).toHaveLength(1)
  })

  it('ranks recent-negative small cards above high-volume baseline-heavy customers', () => {
    const bulky = Array.from({ length: 40 }, (_, index) => ticket({
      id: `old-${index}`,
      importMonth: '2026-01',
      dataSourceType: 'post_use_rating',
      ratingScore: 8,
      problemType: '',
      customerName: '大客户甲',
      customerCode: 'BIG',
      sourceColumns: { 集团名称: '大客户甲', 集团客户编码: 'BIG' },
    }))
    bulky.push(
      ticket({
        id: 'old-recent-1',
        importMonth: '2026-08',
        dataSourceType: 'post_use_rating',
        ratingScore: 8,
        problemType: '',
        customerName: '大客户甲',
        customerCode: 'BIG',
        sourceColumns: { 集团名称: '大客户甲', 集团客户编码: 'BIG' },
      }),
      ticket({
        id: 'old-recent-2',
        importMonth: '2026-08',
        dataSourceType: 'post_use_rating',
        ratingScore: 8,
        problemType: '',
        customerName: '大客户甲',
        customerCode: 'BIG',
        sourceColumns: { 集团名称: '大客户甲', 集团客户编码: 'BIG' },
      }),
    )
    const hot = [
      ticket({ id: 'n1', product: '弹性公网IP', problemType: '退订', importMonth: '2026-06', sentiment: 'negative' }),
      ticket({ id: 'n2', product: '弹性公网IP', problemType: '退订', importMonth: '2026-07', sentiment: 'negative' }),
      ticket({ id: 'n3', product: '弹性公网IP', problemType: '退订', importMonth: '2026-08', sentiment: 'strong_negative' }),
      ticket({ id: 'n4', product: '弹性公网IP', problemType: '退订', importMonth: '2026-08', sentiment: 'negative' }),
    ]
    const cards = recommendTopics({
      toMonth: '2026-08',
      records: [...bulky, ...hot],
    })
    const customer = cards.find((card) => card.type === 'customer' && card.customerCode === 'BIG')
    const issue = cards.find((card) => card.id === 'product:弹性公网IP:退订')
    expect(customer && issue).toBeTruthy()
    expect(issue.score).toBeGreaterThan(customer.score)
  })

  it('counts neutral inquiries in density but not in recent negative', () => {
    const cards = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket({
          id: 'q1',
          dataSourceType: 'consultation_ticket',
          sentiment: 'neutral_inquiry',
          problemType: '配额咨询',
          importMonth: '2026-08',
        }),
        ticket({
          id: 'q2',
          dataSourceType: 'consultation_ticket',
          sentiment: 'neutral_inquiry',
          problemType: '配额咨询',
          importMonth: '2026-08',
        }),
      ],
    })
    const issue = cards.find((card) => card.id === 'product:弹性公网IP:配额咨询')
    expect(issue?.sampleSize).toBe(2)
    expect(issue?.negative).toBe(0)
    expect(issue?.score).toBeGreaterThan(0)
  })

  it('overlays unresolved from action items without dropping other scenarios', () => {
    const cards = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket({ id: 'a1', problemType: '退订' }),
        ticket({ id: 'a2', problemType: '退订' }),
      ],
    })
    const before = cards.find((card) => card.id === 'product:弹性公网IP:退订')
    expect(before.scenarios).not.toContain('unresolved')
    const overlaid = applyUnresolvedOverlay(cards, [
      { status: 'in_progress', content: '处理退订', productName: '弹性公网IP' },
    ])
    const after = overlaid.find((card) => card.id === 'product:弹性公网IP:退订')
    expect(after.scenarios).toContain('unresolved')
    expect(after.score).toBe(before.score + 3)
  })

  it('strips full records when compacting cards for cache', () => {
    const cards = recommendTopics({
      toMonth: '2026-08',
      records: [
        ticket({ id: 'a1' }),
        ticket({ id: 'a2' }),
      ],
    })
    const compact = compactRecommendCardsForCache(cards)
    expect(compact.every((card) => card.records == null)).toBe(true)
    expect(compact.some((card) => (card.recordIds || []).includes('a1'))).toBe(true)
  })
})
