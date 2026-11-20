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
    // 尾链渲染依赖（11-20 新增断言）：meta 里设平台地址
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('mail_public_app_url', 'http://test.example.com')").run()
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
    insGroup.run(D, 'eip', '华南-广州3', '/api/x', '其他', 'u3', 'r3', '12:00', 2, '普通', '资源锁定/并发冲突', '并发进行中', '—')
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

  it('① 聚合口径：待处理/未诊断/仿真分账正确；根因分布全组口径（11-20 拍板）', async () => {
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
    expect(eip.closedGroups).toBe(0)             // seed 无处理中/已处理组
    // 未诊断单列（eip 1 组），不计入待处理
    expect(r.undiagnosedGroups).toBe(1)
    // 11-20 拍板：根因分布改全组口径——锁定 4 组（待处理 3 + "—"组 1）、未诊断 1 组也计入
    expect(eip.causeDist).toEqual([
      { l1: '资源锁定/并发冲突', count: 4, pre: 19 },
      { l1: '未分类', count: 1, pre: 1 },
    ])
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

  it('④ HTML（11-20 优化版）：结论行/KPI 卡/根因分布列/待产品处理列/缺口分区/尾链分流齐备', async () => {
    seed()
    const { buildPatrolDailyReport, renderPatrolDailyReportHtml } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, {})
    const eip = r.products.find((p) => p.productKey === 'eip')
    // 总/失败次数 = 单日明细 Σ（/api/many/0 两请求一失败；该行排序第 3 位、必在 Top20 截断内）
    const many = eip.interfaces.find((it) => it.apiPath === '/api/many/0')
    expect(many).toMatchObject({ totalCount: 2, failCount: 1 })
    // 接口行新字段：待产品处理组数 + 根因 Top3（11-20 拍板）——用 /api/x（stats+组双在的接口）
    const xRow = eip.interfaces.find((it) => it.apiPath === '/api/x')
    expect(xRow).toBeTruthy()
    expect(xRow.pendingGroups).toBe(0)           // /api/x 组是「—」态非待处理
    expect(xRow.causeTop[0]).toEqual({ l1: '资源锁定/并发冲突', count: 1 })
    const html = renderPatrolDailyReportHtml(r)
    expect(html).toContain('AI 巡检日报')
    expect(html).toContain('待产品侧处理')
    // 仿真 chips：新文案（百分比+不计入以上数字）
    expect(html).toContain('仿真/测试')
    // 缺口分区新文案：从未诊断 N 组（华东-济南池名）
    expect(html).toContain('从未诊断 <strong>1</strong> 组')
    // 结论行（11-20：真实口径+最严重，无编辑性判断）
    expect(html).toContain('昨日失败（真实口径，剥离仿真/测试）')
    expect(html).toContain('最严重')
    expect(html).not.toContain('昨日整体')
    expect(html).not.toContain('平台故障')
    // KPI 卡 ×4（真实失败/待处理不含未诊断/异常接口/产品池）
    expect(html).toContain('失败请求（真实）')
    expect(html).toContain('待产品侧处理')
    expect(html).toContain('已闭环')
    expect(html).toContain('异常接口（&lt;99.5%）')
    expect(html).toContain('涉及产品 / 资源池')
    // 表格新列：根因分布 + 待产品处理（旧「标记」列退场）
    expect(html).toContain('根因分布')
    expect(html).toContain('待产品处理')
    expect(html).not.toContain('未达推送阈值')
    // 表格标题（2026-11-07 拍板保留：显实展数）
    expect(html).toContain('异常接口（20）')
    expect(html).not.toContain('异常接口（Top')
    expect(html).toContain('总次数')
    expect(html).toContain('失败次数')
    // 根因分布段落已删（信息进表格列）
    expect(html).not.toContain('待处理根因分布')
    expect(html).not.toContain('待处理细分')
    // 缺口分区（11-20 拍板：未诊断进缺口分区，不进待处理数字）
    expect(html).toContain('诊断能力缺口')
    expect(html).toContain('均未计入待产品侧处理')
    // 尾链分流带参（11-20 拍板）
    expect(html).toContain('按日期查看失败明细')
    expect(html).toContain('startDate=2026-11-06')
    expect(html).toContain('待处理组清单')
    expect(html).toContain('诊断能力需求')
    // overview 增补口径（11-20：真实口径数字）
    expect(r.overview).toMatchObject({
      productCount: 2, interfaceCount: 30, belowThresholdCount: 29,
      failTotal: 26, groupsTotal: 7, simFailTotal: 13, realFailTotal: 13,
      pendingTotal: 5, closedTotal: 0,  // eip 3 + slb 2 待处理
    })
    expect(r.overview.realWorst).toBeTruthy()
    expect(r.overview.realWorst.pureSim).toBe(false)
    expect(r.overview.delta).toMatchObject({
      prevDate: '2026-11-05', prevInterfaceCount: 0, prevFailTotal: 0,
      failDelta: 26, interfaceDelta: 30,
    })
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

  it('⑦ 闭环日根因分布仍显示（11-20 拍板全组口径红绿证明）：待处理=0 时表格根因列有内容、KPI 待处理=0', async () => {
    seed()
    // 全部组改已处理（闭环态）
    db.prepare("UPDATE api_patrol_failure_groups SET product_action_status='已处理' WHERE group_date=?").run(D)
    const { buildPatrolDailyReport, renderPatrolDailyReportHtml } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, {})
    const eip = r.products.find((p) => p.productKey === 'eip')
    expect(eip.pendingGroups).toBe(0)
    expect(eip.closedGroups).toBe(5)
    // 全组口径：根因分布仍统计（旧口径下闭环日 causeDist 为空数组=本用例红）
    expect(eip.causeDist.length).toBeGreaterThan(0)
    expect(eip.causeDist[0].l1).toBe('资源锁定/并发冲突')
    // 接口行根因列与待产品处理列（/api/x——stats+组双在）
    const xRow = eip.interfaces.find((it) => it.apiPath === '/api/x')
    expect(xRow.causeTop.length).toBe(1)
    expect(xRow.pendingGroups).toBe(0)
    expect(r.overview.pendingTotal).toBe(0)
    expect(r.overview.closedTotal).toBe(7)
    const html = renderPatrolDailyReportHtml(r)
    expect(html).toContain('资源锁定/并发冲突×')  // 表格根因分布列有内容
    expect(html).toContain('已闭环 7 组')
  })
})
