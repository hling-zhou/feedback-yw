import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

/**
 * AI 巡检日报调度与发送链守卫（docs/DESIGN-API巡检.md §8）：
 * nextSendAt 数学、收件人合并去重、全链路发送（mock SMTP 断言 to/subject/html）、
 * 同日幂等、手动 force 旁路、平静日 skip/简报。
 */
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-report-sch-'))
process.env.AUTH_DATABASE_PATH = path.join(TMP_DIR, 't.db')
process.env.SERVER_DATA_DIR = TMP_DIR
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-report-sch'

const sqliteMod = await import('./db.js').catch(() => null)
const sqliteAvailable = Boolean(sqliteMod?.getDb)
const { getDb, closeDb } = sqliteAvailable
  ? /** @type {typeof import('./db.js')} */ (sqliteMod)
  : /** @type {any} */ ({})

describe.skipIf(!sqliteAvailable)('patrolReportScheduler 发送链守卫', () => {
  /** @type {any} */ let db = null
  /** @type {any[]} */ let sent = []
  /** @type {any} */ let mod = null
  /** @type {any} */ let restoreTransport = null
  let yesterday = ''
  let groupId = ''
  let channelId = ''

  beforeAll(async () => {
    getDb()
    const { initBusinessSchema } = await import('./businessDb.js')
    initBusinessSchema()
    db = getDb()
    mod = await import('./patrolReportScheduler.js')
    // mock SMTP 传输（setMailTransportFactory 注入点）
    const smtp = await import('./mail/smtp.js')
    smtp.setMailTransportFactory(() => ({
      sendMail: async (msg) => {
        sent.push(msg)
        return { messageId: `mock-${sent.length}` }
      },
    }))
    restoreTransport = () => smtp.setMailTransportFactory(undefined)
    // 发信通道（合法数据源类型 'other'——日报按 channelId 选通道，不动全局枚举）+ 收件人群组
    const mailRepo = await import('./mailRepository.js')
    const channel = mailRepo.createMailChannel({
      dataSourceType: 'other', name: '巡检日报通道', host: 'smtp.test.local', port: 465, secure: true,
      username: 'patrol@test.local', fromAddress: 'patrol@test.local', password: 'secret',
    })
    channelId = channel.id
    const g1 = mailRepo.createMailGroup({ name: '产品组A', emails: ['a1@test.local', 'a2@test.local'] })
    const g2 = mailRepo.createMailGroup({ name: '产品组B', emails: ['a2@test.local', 'b1@test.local'] })
    groupId = [g1.id, g2.id]
    yesterday = mod.yesterdayStr(new Date())
  })

  afterAll(() => {
    restoreTransport?.()
    closeDb()
  })

  beforeEach(() => {
    sent = []
    db.prepare('DELETE FROM api_patrol_stats').run()
    db.prepare('DELETE FROM api_patrol_failure_groups').run()
    mod.savePatrolReportConfig({
      enabled: true, groupIds: [groupId[0], groupId[1]], channelId, sendTime: '10:30',
      includeQuiet: true, excludeSimTagged: false, maxInterfacesPerProduct: 20,
    })
    db.prepare("DELETE FROM meta WHERE key='api_patrol_daily_report_state_v1'").run()
  })

  const seedYesterday = () => {
    db.prepare(`
      INSERT INTO api_patrol_stats (stat_date, product_key, pool_name, api_path, metric_name, biz_type, success_rate, duration_normal_ratio, avg_duration, created_at, updated_at)
      VALUES (?, 'eip', '华南-广州3', '/customer/v3/order/create/floatingip', '订购', '订购', 88.89, NULL, NULL, 't', 't')
    `).run(yesterday)
    db.prepare(`
      INSERT INTO api_patrol_failure_groups (group_date, product_key, pool_name, api_path, metric_name, user_name,
        first_request_id, first_request_time, pre_compress_count, suppressed_request_ids, customer_type,
        root_cause_l1, root_cause_l2, product_action_status, created_at, updated_at)
      VALUES (?, 'eip', '华南-广州3', '/customer/v3/order/delete', '退订', 'u1', 'sch-1', '10:00', 5, '[]', '普通',
        '资源锁定/并发冲突', '锁定机制待查', '待处理', 't', 't')
    `).run(yesterday)
  }

  it('① nextSendAt：今日未到=今日；已过=明日', () => {
    const at = (h, m) => new Date(2026, 10, 7, h, m, 0, 0)
    const t1 = mod.nextSendAt(at(10, 29), '10:30')
    expect([t1.getDate(), t1.getHours(), t1.getMinutes()]).toEqual([7, 10, 30])
    const t2 = mod.nextSendAt(at(10, 30), '10:30') // 恰好已到 → 明日
    expect(t2.getDate()).toBe(8)
    const t3 = mod.nextSendAt(at(23, 59), '10:30')
    expect(t3.getDate()).toBe(8)
  })

  it('② 收件人多群组合并去重', () => {
    const emails = mod.resolveReportRecipients([groupId[0], groupId[1]])
    expect(emails.sort()).toEqual(['a1@test.local', 'a2@test.local', 'b1@test.local'])
  })

  it('③ 全链路：schedule 触发 → 发送昨日报告（to 去重、subject 含日期、html 含产品与待处理），状态+审计落库', async () => {
    seedYesterday()
    const r = await mod.sendPatrolDailyReport({ trigger: 'schedule' })
    expect(r.ok).toBe(true)
    expect(r.recipients).toBe(3)
    expect(sent.length).toBe(1)
    // join 顺序不作断言（Set 迭代实现细节），按集合断言
    expect(sent[0].to.split(', ').sort()).toEqual(['a1@test.local', 'a2@test.local', 'b1@test.local'])
    expect(sent[0].subject).toBe(`【AI巡检日报】${yesterday}`)
    expect(sent[0].html).toContain('待产品侧处理')
    expect(sent[0].html).toContain('华南-广州3')
    // 状态 + 审计
    const state = mod.readPatrolReportState()
    expect(state.lastResult).toBe('sent')
    const audit = db.prepare("SELECT detail_json d FROM audit_log WHERE action='api_patrol.daily_report_send' ORDER BY id DESC LIMIT 1").get()
    const detail = JSON.parse(String(audit.d))
    expect(detail.result).toBe('sent')
    expect(detail.recipients).toBe(3)
  })

  it('④ 同日幂等：schedule 二次触发 → skipped，mock 只发过一封', async () => {
    seedYesterday()
    await mod.sendPatrolDailyReport({ trigger: 'schedule' })
    const r2 = await mod.sendPatrolDailyReport({ trigger: 'schedule' })
    expect(r2.skipped).toBe('already-sent')
    expect(sent.length).toBe(1)
  })

  it('⑤ 手动 force 旁路：同日已发后 manual 仍可发（测试/补发语义）', async () => {
    seedYesterday()
    await mod.sendPatrolDailyReport({ trigger: 'schedule' })
    const r2 = await mod.sendPatrolDailyReport({ trigger: 'manual' })
    expect(r2.ok).toBe(true)
    expect(sent.length).toBe(2)
  })

  it('⑥ 平静日：includeQuiet=false → quiet_skipped 且占当日；=true → 发平静简报', async () => {
    // 无种子数据（beforeEach 已清）
    const cfg = mod.readPatrolReportConfig()
    mod.savePatrolReportConfig({ ...cfg, includeQuiet: false })
    const r1 = await mod.sendPatrolDailyReport({ trigger: 'schedule' })
    expect(r1.skipped).toBe('quiet')
    expect(sent.length).toBe(0)
    expect(mod.readPatrolReportState().lastResult).toBe('quiet_skipped')
    // 幂等：同日再触发不再执行
    const r1b = await mod.sendPatrolDailyReport({ trigger: 'schedule' })
    expect(r1b.skipped).toBe('already-sent')
    // includeQuiet=true → 平静简报发出
    db.prepare("DELETE FROM meta WHERE key='api_patrol_daily_report_state_v1'").run()
    mod.savePatrolReportConfig({ ...cfg, includeQuiet: true })
    const r2 = await mod.sendPatrolDailyReport({ trigger: 'schedule' })
    expect(r2.ok).toBe(true)
    expect(sent.length).toBe(1)
    expect(sent[0].html).toContain('运行平稳')
  })
})
