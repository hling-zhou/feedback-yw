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
    db.prepare('DELETE FROM api_patrol_diagnoses').run() // ⑧ 用例插入今日诊断——seed 必清防跨用例残留
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
    insGroup.run(D, 'eip', '华南-广州3', '/customer/v3/order/delete', '退订', 'u1', 'r1', '10:00', 5, '普通', '资源锁定&并发冲突', '锁定机制待查', '待处理')
    insGroup.run(D, 'eip', '华南-广州3', '/acl/v3/havip/bind', '绑定', 'u2', 'r2', '11:00', 3, '普通', '资源锁定&并发冲突', 'HAVIP 校验拦截', '待处理')
    insGroup.run(D, 'eip', '华南-广州3', '/api/x', '其他', 'u3', 'r3', '12:00', 2, '普通', '资源锁定&并发冲突', '并发进行中', '—')
    insGroup.run(D, 'eip', '华东-济南', '/api/y', '其他', 'u4', 'r4', '13:00', 1, '', null, null, 'pending_diagnosis')
    insGroup.run(D, 'eip', '华东-济南', '/api/z', '其他', 'cmic_sim', 'r5', '14:00', 9, '仿真', '资源锁定&并发冲突', '域名参数成对为空', '待处理')
    insGroup.run(D, 'slb', '华南-广州1', 'L7POLICY/CREATE', '创建7层访问策略', 'cmic_sim', 'r6', '15:00', 4, '仿真', '资源锁定&并发冲突', '域名参数成对为空', '待处理')
    insGroup.run(D, 'slb', '华南-广州1', 'LISTENER/CREATE', '创建监听器', 'real-user', 'r7', '16:00', 2, '普通', '资源锁定&并发冲突', '锁定机制待查', '待处理')
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
    // 11-25 拍板：显示到二级——seed 4 组 L2 各不同 → L1/L2 复合口径拆 4 行各 1 组（原 L1 合计口径拆行=二级呈现本质）
    const distOf = (l1, l2) => eip.causeDist.find((d) => d.l1 === l1 && d.l2 === l2)
    expect(eip.causeDist.length).toBe(5)
    expect(distOf('资源锁定&并发冲突', '锁定机制待查')).toEqual({ l1: '资源锁定&并发冲突', l2: '锁定机制待查', count: 1, pre: 5 })
    expect(distOf('资源锁定&并发冲突', 'HAVIP 校验拦截')).toEqual({ l1: '资源锁定&并发冲突', l2: 'HAVIP 校验拦截', count: 1, pre: 3 })
    expect(distOf('资源锁定&并发冲突', '并发进行中')).toEqual({ l1: '资源锁定&并发冲突', l2: '并发进行中', count: 1, pre: 2 })
    expect(distOf('资源锁定&并发冲突', '域名参数成对为空')).toEqual({ l1: '资源锁定&并发冲突', l2: '域名参数成对为空', count: 1, pre: 9 })
    expect(distOf('未分类', '')).toEqual({ l1: '未分类', l2: '', count: 1, pre: 1 })
    expect(r.hasData).toBe(true)
  }, 20000)

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

  it('③ excludeSimTagged=true（11-25 口径）：剔除豁免白名单命中组；白名单外仿真组不剔除', async () => {
    seed()
    // 预置白名单：cmic_sim × /api/z（seed 的 eip 仿真组）；slb 侧 cmic_sim×L7POLICY 白名单外接口不预置
    const { putPatrolActionExemptions, clearPatrolActionExemptionsCache } = await import('./patrolActionExemptions.js')
    clearPatrolActionExemptionsCache()
    putPatrolActionExemptions([{ id: 't1', userName: 'cmic_sim', apiPath: '/api/z', poolName: '华东-济南', note: '', enabled: true, createdAt: 't' }], { username: 'test' })
    const { buildPatrolDailyReport } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, { excludeSimTagged: true })
    const eip = r.products.find((p) => p.productKey === 'eip')
    expect(eip.groups).toBe(4)          // 5 - 1 白名单命中组（cmic_sim×/api/z 华东-济南）
    expect(eip.pendingGroups).toBe(2)  // 白名单命中待处理组被剔除
    expect(eip.simTaggedGroups).toBe(0)
    // 白名单外仿真组不剔除（slb 的 cmic_sim×L7POLICY 未预置——cmic_sim 的其他接口/池不在豁免内）
    const slb = r.products.find((p) => p.productKey === 'slb')
    expect(slb.groups).toBe(2)          // slb 2 组全保留（r6 cmic_sim 未命中 + r7 真实）
    expect(slb.simTaggedGroups).toBe(1) // 仿真打标展示语义保留（不剥离）
    putPatrolActionExemptions([], { username: 'test' })
    clearPatrolActionExemptionsCache()
  })

  it('④ HTML（11-20 优化版）：结论行/KPI 卡/根因分布列/待产品处理列/缺口分区/尾链分流齐备', async () => {
    seed()
    const { buildPatrolDailyReport, renderPatrolDailyReportHtml } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, {})
    const eip = r.products.find((p) => p.productKey === 'eip')
    // 总/失败次数 = 单日明细 Σ（/api/many/0 两请求一失败；该行排序第 3 位、必在 Top20 截断内）
    const many = eip.interfaces.find((it) => it.apiPath === '/api/many/0')
    expect(many).toMatchObject({ totalCount: 2, failCount: 1 })
    // 接口行新字段：待产品处理组数 + 根因 Top3（11-20 拍板；11-25 二级——带 l2）
    const xRow = eip.interfaces.find((it) => it.apiPath === '/api/x')
    expect(xRow).toBeTruthy()
    expect(xRow.pendingGroups).toBe(0)           // /api/x 组是「—」态非待处理
    // 11-25 11:08 拍板：Top3 按 L1 去重、L2 并列——条目形态 {l1, l2s:[{l2,count}], count=L1 合计}
    expect(xRow.causeTop[0]).toEqual({ l1: '资源锁定&并发冲突', l2s: [{ l2: '并发进行中', count: 1 }], count: 1 })
    const html = renderPatrolDailyReportHtml(r)
    expect(html).toContain('AI 巡检日报')
    expect(html).toContain('待产品侧处理')
    // 仿真 chips：新文案（百分比+不计入以上数字）
    expect(html).toContain('仿真/测试')
    // 缺口分区新文案：从未诊断 N 组（华东-济南池名）
    expect(html).toContain('从未诊断 <strong>1</strong> 组')
    // 结论行（11-25 拍板：去「真实口径」前缀，剔除对象=豁免白名单命中）
    expect(html).toContain('昨日失败（剔除豁免白名单命中）')
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
    // overview 增补口径（11-25 豁免白名单口径：realFailTotal=failTotal-豁免命中 pre；
    // seed 无白名单预置 → 白名单外仿真组回归真实口径，realFailTotal=26 全量）
    expect(r.overview).toMatchObject({
      productCount: 2, interfaceCount: 30, belowThresholdCount: 29,
      failTotal: 26, groupsTotal: 7, simFailTotal: 13, realFailTotal: 26,
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

  it('⑥ 全豁免接口排后（11-07 排序 + 11-25 口径）：白名单命中接口压底，白名单外仿真组按正常排序', async () => {
    seed()
    // 预置白名单：cmic_sim × L7POLICY/CREATE → 该接口×池全部组豁免=pureSim 口径压底
    const { putPatrolActionExemptions, clearPatrolActionExemptionsCache } = await import('./patrolActionExemptions.js')
    clearPatrolActionExemptionsCache()
    putPatrolActionExemptions([{ id: 't1', userName: 'cmic_sim', apiPath: 'L7POLICY/CREATE', poolName: '华南-广州1', note: '', enabled: true, createdAt: 't' }], { username: 'test' })
    const { buildPatrolDailyReport, renderPatrolDailyReportHtml } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, {})
    const slb = r.products.find((p) => p.productKey === 'slb')
    expect(slb.interfaces.length).toBe(2)
    // 不按成功率升序（那会让 0% 的 L7POLICY 排第一）——全豁免规则把它压到最后
    expect(slb.interfaces[0].apiPath).toBe('LISTENER/CREATE')
    expect(slb.interfaces[0].pureSim).toBe(false)
    expect(slb.interfaces[1].apiPath).toBe('L7POLICY/CREATE')
    expect(slb.interfaces[1].pureSim).toBe(true)
    const html = renderPatrolDailyReportHtml(r)
    expect(html).toContain('仿真/测试')   // 打标展示语义保留
    putPatrolActionExemptions([], { username: 'test' })
    clearPatrolActionExemptionsCache()
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
    // 11-25 二级：条目带 l2（count 拆行后并列 1，不锚首条顺序——锚「存在」）
    expect(eip.causeDist.length).toBeGreaterThan(0)
    const lockRow = eip.causeDist.find((d) => d.l1 === '资源锁定&并发冲突')
    expect(lockRow).toBeTruthy()
    expect(lockRow.l2).toBeTruthy()
    // 接口行根因列与待产品处理列（/api/x——stats+组双在）
    const xRow = eip.interfaces.find((it) => it.apiPath === '/api/x')
    expect(xRow.causeTop.length).toBe(1)
    expect(xRow.pendingGroups).toBe(0)
    expect(r.overview.pendingTotal).toBe(0)
    expect(r.overview.closedTotal).toBe(7)
    const html = renderPatrolDailyReportHtml(r)
    expect(html).toContain('资源锁定&amp;并发冲突[')  // 11-25 11:08 格式：L1[L2×N]×合计；&经 esc 转 &amp;
    expect(html).toContain('已闭环 7 组')
  })

  // ---------- 11-20 15:09 拍板：历史 pending 转待处理（trapped）双提醒 ----------
  it('⑧ trapped 红绿：今日诊断转出的历史待处理组 → 总览数字+提示条+产品角标/chips；K=0 全不渲染', async () => {
    seed()
    // 构造 trapped 场景：r1（eip 待处理，报告日内——不 trapped）之外的组改成历史日期+今日诊断成功。
    // r5（eip 仿真待处理）改历史日期+今日 success 诊断 → trapped 1 组（仿真豁免只在诊断管线层，
    // 手工构造状态不经过管线——builder 如实按 product_action_status 聚合，不重复豁免）。
    const OLD_DATE = '2026-10-30'
    // 11-26 修复（时区脆弱性，11-21 patrolQuery trapped-pending 同型实锤）：「今日诊断」种子必须
    // 本地日期拼串——builder 的 trapped 锚是 localDateStr(new Date())（本地日期），而 toISOString
    // 是 UTC：CST 00:00-08:00 期间 UTC 日期比本地早一天 → 种子"今日"变"昨日"，trapped 判 0、用例
    // 每晚必红 8 小时。与消费端同源：本地日期 + ISO 完整时间戳。
    const now = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, '0')}Z`
    db.prepare("UPDATE api_patrol_failure_groups SET group_date=? WHERE first_request_id IN ('r5','r6')").run(OLD_DATE)
    const insDiag = db.prepare(`
      INSERT INTO api_patrol_diagnoses (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion, root_cause_l1, root_cause_l2, root_cause_source, diagnosed_at)
      VALUES (?, ?, 'success', 'log_search', '{}', '结论', '资源锁定&并发冲突', '锁定机制待查', 'llm', ?)
    `)
    for (const rid of ['r5', 'r6']) {
      const g = db.prepare('SELECT id FROM api_patrol_failure_groups WHERE first_request_id=?').get(rid)
      insDiag.run(g.id, rid, todayIso)
    }
    // 调试定位（临时）已移除——根因已定：builder 首版 SQL 漏 GROUP BY（聚合退化为整表一行）
    // 无今日诊断的待处理历史组（r1 改历史日期但无 diagnoses 记录）→ 不 trapped（判定锚=diagnoses 今日 success）
    db.prepare("UPDATE api_patrol_failure_groups SET group_date=? WHERE first_request_id='r1'").run(OLD_DATE)

    const { buildPatrolDailyReport, renderPatrolDailyReportHtml } = await import('./patrolReportBuilder.js')
    const r = buildPatrolDailyReport(D, {})
    // 总览：r5(eip)+r6(slb) = 2 组 trapped（r1 不算——无今日 success 诊断）
    expect(r.overview.trappedPendingGroups).toBe(2)
    expect(r.overview.trappedPreTotal).toBe(9 + 4)
    // 产品级角标素材
    const eip = r.products.find((p) => p.productKey === 'eip')
    const slb = r.products.find((p) => p.productKey === 'slb')
    expect(eip.trappedPendingGroups).toBe(1)
    expect(slb.trappedPendingGroups).toBe(1)
    // HTML：提示条 + 角标 + chips（11-20 15:09 修订文案）齐备
    const html = renderPatrolDailyReportHtml(r)
    expect(html).toContain('2 组历史遗留失败今日完成诊断并转待产品处理')
    expect(html).toContain('历史遗留失败今日完成诊断并转待产品处理 <strong>1</strong> 组')
    expect(html).toContain('近7日 处理')
    expect(html).toContain('⚡1')

    // K=0 回归：删除今日诊断 → 全部不渲染（改前红：空场景若仍渲染提示条）
    db.prepare("DELETE FROM api_patrol_diagnoses").run()
    const r2 = buildPatrolDailyReport(D, {})
    expect(r2.overview.trappedPendingGroups).toBe(0)
    const html2 = renderPatrolDailyReportHtml(r2)
    expect(html2).not.toContain('历史遗留失败今日完成诊断')
    expect(html2).not.toContain('⚡')
  })
})
