import fs from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// db.js 在模块顶层即计算 DB 路径，任何依赖 DB 的模块必须在赋值之后再动态引入，
// 否则会落回 server/data/auth.db 真库
process.env.AUTH_DATABASE_PATH = `/tmp/fi-rem-recipients-${process.pid}.db`
fs.rmSync(process.env.AUTH_DATABASE_PATH, { force: true })

const { registerReminderRoutes } = await import('./reminders.js')
const { storageRepository } = await import('../storageRepository.js')
const { getDb, closeDb } = await import('../db.js')
const Fastify = (await import('fastify')).default

const PM1_EMAIL = 'pm01@example-corp.cn'
const PM2_EMAIL = 'pm02@example-corp.cn'
const CATALOG_META_KEY = 'product_catalog_managed_v1'

function putCatalogWithPm(username, email) {
  storageRepository.putMeta(CATALOG_META_KEY, {
    version: 1,
    updatedAt: new Date().toISOString(),
    products: [
      {
        key: 'eip',
        name: '弹性公网IP',
        enabled: true,
        taxonomyKey: 'eip',
        acceptParentName: true,
        specs: [],
        owners: {
          productManager: [
            {
              userId: `u-${username}`,
              username,
              displayName: `负责人${username}`,
              email,
            },
          ],
        },
      },
      {
        key: 'vpc',
        name: '虚拟私有云',
        enabled: true,
        taxonomyKey: 'vpc',
        acceptParentName: true,
        specs: [],
        owners: {
          productManager: [
            {
              userId: `u-${username}`,
              username,
              displayName: `负责人${username}`,
              email,
            },
          ],
        },
      },
    ],
    deletedKeys: [],
    disabledAnalysisKeys: [],
  })
}

function insertUser(id, username, email) {
  getDb()
    .prepare(
      `INSERT INTO users (id, username, password_hash, team, role, status, created_at, updated_at, display_name, email)
       VALUES (?, ?, 'x', '产品', 'viewer', 'active', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', ?, ?)`,
    )
    .run(id, username, `负责人${username}`, email)
}

function insertComplaintRecord() {
  storageRepository.putRecords([
    {
      id: 'rec-reminder-eip-1',
      ticketId: 'T-REM-1',
      dataSourceType: 'complaint_ticket',
      importMonth: '2026-07',
      productKey: 'eip',
      productName: '弹性公网IP',
      customerName: '某某公司',
      problemSummary: '提醒邮件收件人回归测试',
      handlingText: '处理中',
      tagStatus: 'manual_review',
    },
  ])
}

// 真实数据形态：records 仅存 productKey（如 vpc），productName 为空。
// 提醒邮件/预览展示名必须是产品目录中文名，不得回退英文 key。
function insertKeyOnlyComplaintRecord() {
  storageRepository.putRecords([
    {
      id: 'rec-reminder-vpc-1',
      ticketId: 'T-REM-VPC-1',
      dataSourceType: 'complaint_ticket',
      importMonth: '2026-07',
      productKey: 'vpc',
      productName: '',
      customerName: '某某公司',
      problemSummary: '产品名中文显示回归测试',
      handlingText: '处理中',
      tagStatus: 'manual_review',
    },
  ])
}

// 真实数据形态二：record 无 productKey，中文名在 product 字段（productName 是
// 用后即评字段，投诉/咨询恒为空）。须通过「产品名→key」反查归组到真实产品，
// 否则落 unknown 假组、丢失 owners/收件人解析。
function insertNameOnlyComplaintRecord() {
  storageRepository.putRecords([
    {
      id: 'rec-reminder-name-only-1',
      ticketId: 'T-REM-NAME-1',
      dataSourceType: 'complaint_ticket',
      importMonth: '2026-07',
      productKey: '',
      product: '虚拟私有云',
      productName: '',
      customerName: '某某公司',
      problemSummary: '无键名映射回归测试',
      handlingText: '处理中',
      tagStatus: 'manual_review',
    },
  ])
}

async function buildApp() {
  const app = Fastify()
  app.decorateRequest('user', null)
  app.decorateRequest('apiKey', null)
  app.addHook('onRequest', async (request) => {
    request.user = { id: 'u-admin', username: 'admin', role: 'admin' }
  })
  registerReminderRoutes(app)
  await app.ready()
  return app
}

let app

beforeAll(async () => {
  insertUser('u-pm01', 'pm01', PM1_EMAIL)
  insertUser('u-pm02', 'pm02', PM2_EMAIL)
  insertComplaintRecord()
  insertKeyOnlyComplaintRecord()
  insertNameOnlyComplaintRecord()
  putCatalogWithPm('pm01', PM1_EMAIL)
  app = await buildApp()
})

afterAll(async () => {
  await app.close()
  closeDb()
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(`${process.env.AUTH_DATABASE_PATH}${suffix}`, { force: true })
  }
})

describe('POST /api/reminders/preview 收件人解析', () => {
  it('服务端目录缓存未初始化时也能解析出产品负责人收件人', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/reminders/preview', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const eip = body.products.find((p) => p.productKey === 'eip')
    expect(eip).toBeTruthy()
    expect(eip.owners?.productManager?.[0]?.username).toBe('pm01')
    expect(body.recipientEmails).toContain(PM1_EMAIL)
    expect(body.recipientCount).toBe(1)
  })

  it('DB 中负责人更新后，下一次预览立即用新值（缓存不陈旧）', async () => {
    putCatalogWithPm('pm02', PM2_EMAIL)
    const res = await app.inject({ method: 'POST', url: '/api/reminders/preview', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const eip = body.products.find((p) => p.productKey === 'eip')
    expect(eip.owners?.productManager?.[0]?.username).toBe('pm02')
    expect(body.recipientEmails).toContain(PM2_EMAIL)
    expect(body.recipientEmails).not.toContain(PM1_EMAIL)
  })
})

describe('提醒产品展示名（中文）', () => {
  it('record 仅存 productKey（productName 为空）时，展示名用目录中文名而非英文 key', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/reminders/preview', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    const vpc = body.products.find((p) => p.productKey === 'vpc')
    expect(vpc).toBeTruthy()
    expect(vpc.productName).toBe('虚拟私有云')
    expect(vpc.productName).not.toBe('vpc')
  })

  it('record 无 productKey 但 product 字段有产品名时，反查归组到真实产品（不落 unknown）', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/reminders/preview', payload: {} })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.products.some((p) => p.productKey === 'unknown')).toBe(false)
    const vpc = body.products.find((p) => p.productKey === 'vpc')
    expect(vpc).toBeTruthy()
    // T-REM-NAME-1 应归入 vpc 组
    const inVpcGroup = vpc && vpc.distribution && vpc.distribution.complaintTickets >= 2
    expect(Boolean(inVpcGroup)).toBe(true)
  })
})
