import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * AI 巡检日报构建器口径守卫（docs/DESIGN-API巡检.md §8.3）：
 * 窗口=T-1 单日、待产品侧处理=待处理组、未诊断单列不计入、仿真/测试默认计入并打标、
 * 成功率=stats 推送值、<99.5 优先排序、明细上限截断、排除口径可选。
 */
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-report-'))
process.env.AUTH_DATABASE_PATH = path.join(TMP_DIR, 't.db')
process.env.SERVER_DATA_DIR = TMP_DIR
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-report-xx'

const sqliteMod = await import('./db.js').catch(() => null)
const sqliteAvailable = Boolean(sqliteMod?.getDb)
const { getDb, closeDb } = sqliteAvailable
  ? /** @type {typeof import('../db.js')} */ (sqliteMod)
  : /** @type {any} */ ({})

describe.skipIf(!sqliteAvailable)('patrolReportBuilder 口径守卫', () => {
  /** @type {any} */ let db = null

  beforeAll(async () => {
    getDb()
    const { initBusinessSchema } = await import('./businessDb.js')
    initBusinessSchema()
    db = getDb()
  })

  afterAll(() => closeDb())

  const D = '2026-11-06'

  /** 种子：eip（1 待处理锁定 + 1 待处理HAVIP + 1 "—"并发 + 1 未诊断 + 1 仿真 + stats 22 行）、slb（1 待处理） */
  const seed = () => {
    db.prepare('DELETE FROM api_patrol_stats').run()
    db.prepare('DELETE FROM api_patrol_failure_groups').run()
    db.prepare('DELETE FROM api_patrol_requests').run()
    const insStat = db.prepare(`
      INSERT INTO api_patrol_stats (stat_date, product_key, pool_name, api_path, metric_name, biz_type, success_rate, duration_normal_ratio, avg_duration, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 't', 't')
    `)
    insStat.run(D, 'eip', '华南-广州3', '/customer/v3/order/create/floatingip', '订购', '订购', 88.89)
    insStat.run(D, 'eip', '华南-广州3', '/acl/v3/floatingip/bind', '绑定', '绑定', 99.9)    // ≥99.5 不标低值
    insStat.run(D, 'eip', '华南-广州3', '/api/x', '伪造低值', '其他', -1)                    // 非常规数值 → 升序最先
    for (let i = 0; i < 25; i++) insStat.run(D, 'eip', '华东-济南', `/api/many/${i}`, '批量', '其他', 50 + i) // 25 行 → 截断 20
    insStat.run(D, 'slb', '华南-广州1', 'L7POLICY/CREATE', '创建7层访问策略', '创建', 0.0)
    insStat.run(D, 'slb', '华南-广州1', 'LISTENER/CREATE', '创建监听器', '创建', 50.0)
    const insGroup = db.prepare(`
      INSERT INTO api_patrol_failure_groups (group_date, product_key, pool_name, api_path, metric_name, user_name,
        first_request_id, first_request_time, pre_compress_count, suppressed_request_ids, customer_type,
        root_cause_l1, root_cause_l2, product_action_status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, 't', 't')
    `)
    insGroup.run(D, 'eip', '华南-广州3', '/customer/v3/order/delete', '退订', 'u1', 'r1', '10:00', 5, '普通', '资源锁定/并发冲突', '锁定机制待查', '待处理')
    insGroup.run(D, 'eip', '华南-广州3', '/acl/v3/havip/bind', '绑定', 'u2', 'r2', '11:00', 3, '普通', '资源锁定/并发冲突', 'HAVIP 校验拦截', '待处理')
    insGroup.run(D, 'eip', '华东-济南', '/api/x', '其他', 'u3', 'r3', '12:00', 2, '普通', '资源锁定/并发冲突', '并发进行中', '—')
    insGroup.run(D, 'eip', '华东-济南', '/api/y', '其他', 'u4', 'r4', '13:00', 1, '', null, null, 'pending_diagnosis')
    insGroup.run(D, 'eip', '华东-济南', '/api/z', '其他', 'cmic_sim', 'r5', '14:00', 9, '仿真', '资源锁定/并发冲突', '域名参数成对为空', '待处理')
    insGroup.run(D, 'slb', '华南-广州1', 'L7POLICY/CREATE', '创建7层访问策略', 'cmic_sim', 'r6', '15:00', 4, '仿真', '资源锁定/并发冲突', '域名参数成对为空', '待处理')
    insGroup.run(D, 'slb', '华南-广州1', 'LISTENER/CREATE', '创建监听器', 'real-user', 'r7', '16:00', 2, '普通', '资源锁定/并发冲突', '锁定机制待查', '待处理')
    // 明细 requests（总/失败次数列数据源）
    const insReq = db.prepare(`
      INSERT INTO api_patrol_requests (request_date, pool_name, product_key, request_id, api_path, user_id, user_name, is_success, request_time, created_at)
      VALUES (?, '华东-济南', 'eip', ?, ?, 'u-x', 'userX', ?, ?, 't')
    `)
    insReq.run(D, 'rb-1', '/api/many/0', 1, '09:00:00')
    insReq.run(D, 'rb-2', '/api/many/0', 0, '09:05:00')
  }

  it('① 聚合口径：待处理/未诊断/仿真分账正确', async () => {
    seed()
    const { buildPatrolDailyReport } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, { maxInterfacesPerProduct: 20 })
    const eip = r.products.find((p) => p.productKey === 'eip')
    expect(eip).toBeTruthy()
    expect(eip.groups).toBe(5)                    // 组总数（含仿真/未诊断）
    expect(eip.preTotal).toBe(5 + 3 + 2 + 1 + 9)  // 20
    expect(eip.pendingGroups).toBe(3)            // 锁定待查 + HAVIP + 仿真（默认不排除，仿真计入待处理）
    expect(eip.pendingPre).toBe(5 + 3 + 9)
    expect(eip.simTaggedGroups).toBe(1)
    // 未诊断单列（eip 1 组），不计入待处理
    expect(r.undiagnosedGroups).toBe(1)
    // L1/L2 分布只统计待处理组：锁定 3 组；"—"组（并发进行中）不入分布
    expect(eip.causeDist).toEqual([{ l1: '资源锁定/并发冲突', count: 3, pre: 17 }])
    expect(eip.l2Top[0].l2).toBe('锁定机制待查')
    expect(r.hasData).toBe(true)
  })

  it('② 明细表：<99.5 优先 + 升序、截断 20、非数值不标低值', async () => {
    seed()
    const { buildPatrolDailyReport } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, { maxInterfacesPerProduct: 20 })
    const eip = r.products.find((p) => p.productKey === 'eip')
    // eip 共 28 行（88.89 / 99.9 / -1 / 50..74×25），27 行 <99.5 → 升序截断 20：-1 最先、50 次之、99.9 被截断
    expect(eip.interfaces.length).toBe(20)
    expect(eip.interfaces[0].belowThreshold).toBe(true)
    expect(eip.interfaces[0].successRate).toBe(-1)
    expect(eip.interfaces[1].successRate).toBe(50)
    expect(eip.interfaces.some((it) => !it.belowThreshold)).toBe(false) // 截断内全为低值（99.9 在第 28 行被截掉）
  })

  it('③ excludeSimTagged=true：仿真组从全部统计中移除', async () => {
    seed()
    const { buildPatrolDailyReport } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, { excludeSimTagged: true })
    const eip = r.products.find((p) => p.productKey === 'eip')
    expect(eip.groups).toBe(4)          // 5 - 1 仿真
    expect(eip.pendingGroups).toBe(2)  // 仿真待处理组被排除
    expect(eip.simTaggedGroups).toBe(0)
  })

  it('④ HTML：产品名/待处理数/仿真标记/未诊断提示/低值标记齐备；表格标题"异常接口（Top N）"+总/失败次数列', async () => {
    seed()
    const { buildPatrolDailyReport, renderPatrolDailyReportHtml } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, {})
    const eip = r.products.find((p) => p.productKey === 'eip')
    // 总/失败次数 = 单日明细 Σ（/api/many/0 两请求一失败；该行排序第 3 位、必在 Top20 截断内）
    const many = eip.interfaces.find((it) => it.apiPath === '/api/many/0')
    expect(many).toMatchObject({ totalCount: 2, failCount: 1 })
    const html = renderPatrolDailyReportHtml(r)
    expect(html).toContain('AI 巡检日报')
    expect(html).toContain('待产品侧处理')
    expect(html).toContain('其中仿真/测试流量 1 组')  // eip 打标
    expect(html).toContain('未诊断 1 组')
    expect(html).toContain('未达推送阈值')
    expect(html).toContain('待处理根因分布')
    // 表格标题（2026-11-07 用户拍板：去"明细/Top"字样、显实展数）+ 新列；不含接口路径列
    expect(html).toContain('异常接口（20）')
    expect(html).not.toContain('异常接口（Top')
    expect(html).toContain('总次数')
    expect(html).toContain('失败次数')
    // 总起概况段（11-07 启发落地：整体+最严重+环比前日；口径与产品块正文同源）
    expect(r.overview).toMatchObject({
      productCount: 2, interfaceCount: 30, belowThresholdCount: 29,
      failTotal: 26, groupsTotal: 7,
    })
    expect(r.overview.delta).toMatchObject({
      prevDate: '2026-11-05', prevInterfaceCount: 0, prevFailTotal: 0,
      failDelta: 26, interfaceDelta: 30,
    })
    expect(html).toContain('昨日整体')
    expect(html).toContain('检测覆盖 2 个产品')
    expect(html).toContain('最严重：eip·伪造低值')
    expect(html).toContain('较前日（2026-11-05）')
  })

  it('⑤ 平静日：无 stats 无 groups → hasData=false', async () => {
    db.prepare('DELETE FROM api_patrol_stats').run()
    db.prepare('DELETE FROM api_patrol_failure_groups').run()
    const { buildPatrolDailyReport, renderPatrolQuietReportHtml } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport('2026-11-01', {})
    expect(r.hasData).toBe(false)
    expect(r.products).toEqual([])
    expect(renderPatrolQuietReportHtml('2026-11-01')).toContain('运行平稳')
  })

  it('⑥ 纯仿真接口排后（11-07 拍板）：真实接口（50%）在前、纯仿真接口（0%）最后；HTML 标记列显示仿真/测试', async () => {
    seed()
    const { buildPatrolDailyReport, renderPatrolDailyReportHtml } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, {})
    const slb = r.products.find((p) => p.productKey === 'slb')
    expect(slb.interfaces.length).toBe(2)
    // 不按成功率升序（那会让 0% 的 L7POLICY 排第一）——纯仿真规则把它压到最后
    expect(slb.interfaces[0].apiPath).toBe('LISTENER/CREATE')
    expect(slb.interfaces[0].pureSim).toBe(false)
    expect(slb.interfaces[1].apiPath).toBe('L7POLICY/CREATE')
    expect(slb.interfaces[1].pureSim).toBe(true)
    const html = renderPatrolDailyReportHtml(r)
    expect(html).toContain('仿真/测试')
  })
})
