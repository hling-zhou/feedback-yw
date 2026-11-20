import { getDb } from './db.js'
import { storageRepository } from './storageRepository.js'
import { getPublicAppUrl } from './mailRepository.js'

/** 推送阈值口径（与溯源页/总览一致） */
const PUSH_THRESHOLD = 99.5

/** 本地日期串（yyyy-MM-dd）——trapped 判定的「今日」锚点（diagnosed_at 为 ISO 文本，取前 10 位比对）。 */
function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** @typedef {{ productKey: string, productName: string, poolsCount: number, groups: number, preTotal: number, pendingGroups: number, pendingPre: number, simTaggedGroups: number, simTaggedPre: number, closedGroups: number, causeDist: Array<{ l1: string, count: number, pre: number }>, l2Top: Array<never>, interfaces: Array<{ pool: string, metric: string, apiPath: string, bizType: string, successRate: number, belowThreshold: boolean, pendingGroups: number, causeTop: Array<{ l1: string, count: number }> }}> }} PatrolReportProduct */

/** 产品 key→中文名（目录优先，缺则回退 key）。 */
export function productNameMap() {
  /** @type {Record<string, string>} */
  const map = {}
  try {
    const parsed = storageRepository.getMeta('product_catalog_managed_v1')
    const products = parsed && Array.isArray(parsed.products) ? parsed.products : []
    for (const p of products) {
      if (p && typeof p.key === 'string') map[p.key] = String(p.name || p.key)
    }
  } catch { /* 目录缺失时回退 key */ }
  return map
}

/**
 * 聚合某报告日的巡检数据（docs/DESIGN-API巡检.md §8.3 口径）。
 * - 待产品侧处理 = product_action_status='待处理'；未诊断（root_cause_l1 IS NULL）单列不计入
 * - 仿真/测试标签组：excludeSimTagged=true 排除；false 计入并单独计数（打标用）
 * - 明细表：stats 推送值原样（不重算），<99.5 优先、其余按序，maxInterfacesPerProduct 截断
 * @param {string} date YYYY-MM-DD（报告日）
 * @param {{ maxInterfacesPerProduct?: number, excludeSimTagged?: boolean }} [options]
 * @returns {{ date: string, hasData: boolean, products: PatrolReportProduct[], simTaggedGroups: number, undiagnosedGroups: number }}
 */
export function buildPatrolDailyReport(date, options = {}) {
  const maxInterfaces = Number(options.maxInterfacesPerProduct) > 0 ? Number(options.maxInterfacesPerProduct) : 20
  const excludeSim = options.excludeSimTagged === true
  const db = getDb()
  const names = productNameMap()

  const statRows = db.prepare(
    `SELECT product_key pk, pool_name pool, metric_name metric, api_path api, biz_type biz, success_rate rate
     FROM api_patrol_stats WHERE stat_date = ?`,
  ).all(date)
  const groupRows = db.prepare(
    `SELECT product_key pk, product_action_status status, customer_type ctype,
            root_cause_l1 l1, root_cause_l2 l2, pre_compress_count pre, pool_name pool, api_path AS apiPath
     FROM api_patrol_failure_groups WHERE group_date = ?`,
  ).all(date)

  /** @type {Map<string, PatrolReportProduct>} */
  const byProduct = new Map()
  const ensure = (pk) => {
    if (!byProduct.has(pk)) {
      byProduct.set(pk, {
        productKey: pk,
        productName: names[pk] || pk,
        poolsCount: 0,
        groups: 0,
        preTotal: 0,
        pendingGroups: 0,
        pendingPre: 0,
        simTaggedGroups: 0,
        simTaggedPre: 0,
        causeDist: [],
        l2Top: [],
        interfaces: [],
      })
    }
    return /** @type {PatrolReportProduct} */ (byProduct.get(pk))
  }

  // 组聚合
  const poolsSeen = new Map() // pk -> Set(pool)
  /** @type {Map<string, { groups: number, sim: number, pending: number, l1: Map<string, number> }>} */
  const simAggByInterface = new Map() // pool\0api → 组数/仿真数/待处理数/L1 计数（11-20 拍板：表格根因分布+待产品处理列）
  /** @type {Map<string, Map<string, {count: number, pre: number}>>} */ const l1ByProduct = new Map()
  /** @type {Map<string, number>} */ const statusByProduct = new Map() // pk -> {待处理/处理中/已处理...} 组数（11-20 全组口径闭环计数）
  let simTaggedTotal = 0
  let undiagnosedTotal = 0
  /** @type {Map<string, number>} */ const undiagByPool = new Map() // pool -> 未诊断组数（11-20 缺口分区素材）
  for (const g of groupRows) {
    const pk = String(g.pk)
    const isSim = g.ctype === '仿真' || g.ctype === '测试账号'
    const undiagnosed = g.l1 == null
    if (isSim) simTaggedTotal += 1
    if (undiagnosed) {
      undiagnosedTotal += 1
      const poolKey = String(g.pool || '')
      undiagByPool.set(poolKey, (undiagByPool.get(poolKey) || 0) + 1)
    }
    const ikey = `${g.pool}\u0000${g.apiPath || ''}`
    if (!simAggByInterface.has(ikey)) simAggByInterface.set(ikey, { groups: 0, sim: 0, pending: 0, l1: new Map() })
    const si = simAggByInterface.get(ikey)
    si.groups += 1
    if (isSim) si.sim += 1
    if (g.status === '待处理') si.pending += 1
    const l1Key = String(g.l1 || '未诊断')
    si.l1.set(l1Key, (si.l1.get(l1Key) || 0) + 1)
    if (excludeSim && isSim) continue // 排除口径：不进任何统计（含待处理）
    const p = ensure(pk)
    p.groups += 1
    p.preTotal += Number(g.pre || 0)
    if (isSim) { p.simTaggedGroups += 1; p.simTaggedPre += Number(g.pre || 0) }
    const pool = String(g.pool || '')
    if (!poolsSeen.has(pk)) poolsSeen.set(pk, new Set())
    poolsSeen.get(pk).add(pool)
    // 11-20 拍板：根因分布改全组口径（闭环日也显示"昨天失败都是什么原因"）——
    // 去掉原 status='待处理' 条件；产品级状态计数同步保留（KPI 副注已闭环 C 组）
    const statusKey = String(g.status || '—')
    const sm = statusByProduct.get(pk) || new Map()
    sm.set(statusKey, (sm.get(statusKey) || 0) + 1)
    statusByProduct.set(pk, sm)
    if (!l1ByProduct.has(pk)) l1ByProduct.set(pk, new Map())
    const l1m = l1ByProduct.get(pk)
    const l1key2 = String(g.l1 || '未分类')
    const cur = l1m.get(l1key2) || { count: 0, pre: 0 }
    cur.count += 1; cur.pre += Number(g.pre || 0)
    l1m.set(l1key2, cur)
    if (g.status === '待处理') {
      p.pendingGroups += 1
      p.pendingPre += Number(g.pre || 0)
    }
  }

  // 明细次数 Σ（单日：requests 按池×接口聚合——总/失败次数列，对齐设计 §8.3 表格口径）
  const countAgg = new Map()
  const countRows = db.prepare(`
    SELECT pool_name, api_path, SUM(CASE WHEN is_success = 1 THEN 1 ELSE 0 END) ok,
           SUM(CASE WHEN is_success = 0 THEN 1 ELSE 0 END) fail
    FROM api_patrol_requests WHERE request_date = ?
    GROUP BY pool_name, api_path
  `).all(date)
  for (const c of countRows) {
    countAgg.set(`${c.pool_name}\u0000${c.api_path}`, { total: Number(c.ok || 0) + Number(c.fail || 0), fail: Number(c.fail || 0) })
  }

  // 异常接口明细（stats 推送值原样）+ 纯仿真推导 + 待产品处理组数 + 根因 Top3（11-20 拍板两新列）
  for (const s of statRows) {
    const pk = String(s.pk)
    const p = ensure(pk)
    const rate = Number(s.rate)
    const si = simAggByInterface.get(`${s.pool}\u0000${s.api}`) || { groups: 0, sim: 0, pending: 0, l1: new Map() }
    const ca = countAgg.get(`${s.pool}\u0000${s.api}`) || { total: 0, fail: 0 }
    // 根因分布 Top3：L1 计数降序（11-20 拍板：L1 Top3+组数；未诊断组如实标注）
    const causeTop = [...si.l1.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([l1, n]) => ({ l1, count: n }))
    p.interfaces.push({
      pool: String(s.pool || ''),
      metric: String(s.metric || ''),
      apiPath: String(s.api || ''),
      bizType: String(s.biz || ''),
      successRate: rate,
      totalCount: ca.total,
      failCount: ca.fail,
      belowThreshold: Number.isFinite(rate) && rate < PUSH_THRESHOLD,
      pureSim: si.groups > 0 && si.sim === si.groups,
      pendingGroups: si.pending,
      causeTop,
    })
  }

  const products = [...byProduct.values()].map((p) => {
    p.poolsCount = poolsSeen.get(p.productKey)?.size || 0
    p.interfaces.sort((a, b) => {
      // 仿真/测试标签行最后（11-07 拍板，与溯源页同源）→ 低值优先 → 升序
      const pa = a.pureSim ? 1 : 0
      const pb = b.pureSim ? 1 : 0
      if (pa !== pb) return pa - pb
      if (a.belowThreshold !== b.belowThreshold) return a.belowThreshold ? -1 : 1
      return a.successRate - b.successRate
    })
    p.interfaces = p.interfaces.slice(0, maxInterfaces)
    // 11-20 拍板：根因分布全组口径（l1m 已在组循环里全量聚合）；l2Top 段落删除（信息进表格列）
    const l1m = l1ByProduct.get(p.productKey)
    if (l1m) p.causeDist = [...l1m.entries()].map(([l1, v]) => ({ l1, count: v.count, pre: v.pre }))
      .sort((a, b) => b.count - a.count)
    p.l2Top = []
    // 已闭环组数（处理中+已处理——11-20 KPI 副注「已闭环 C 组」）
    const sm = statusByProduct.get(p.productKey) || new Map()
    p.closedGroups = Number(sm.get('处理中') || 0) + Number(sm.get('已处理') || 0)
    return p
  }).sort((a, b) => b.pendingGroups - a.pendingGroups || b.groups - a.groups)
  // 总起概况（2026-11-07 启发落地：邮件第一段=整体概况+最严重+环比前日；口径与产品块正文同源）
  const groupsTotal = products.reduce((a, p) => a + p.groups, 0)
  const failTotalPre = products.reduce((a, p) => a + p.preTotal, 0)
  const belowThresholdCount = statRows.filter((s) => Number.isFinite(Number(s.rate)) && Number(s.rate) < PUSH_THRESHOLD).length
  const allInterfaces = []
  for (const p of products) {
    for (const it of p.interfaces) allInterfaces.push({ productName: p.productName, ...it })
  }
  allInterfaces.sort((a, b) => {
    const pa = a.pureSim ? 1 : 0
    const pb = b.pureSim ? 1 : 0
    if (pa !== pb) return pa - pb
    if (a.belowThreshold !== b.belowThreshold) return a.belowThreshold ? -1 : 1
    return a.successRate - b.successRate
  })
  const prevDate = (() => {
    const d = new Date(`${date}T00:00:00`)
    d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()
  const prevRow = db.prepare(
    `SELECT (SELECT COUNT(*) FROM api_patrol_stats WHERE stat_date = ?) AS interfaces,
            (SELECT SUM(pre_compress_count) FROM api_patrol_failure_groups WHERE group_date = ?) AS pre`,
  ).get(prevDate, prevDate)
  const overview = {
    productCount: products.length,
    interfaceCount: statRows.length,
    belowThresholdCount,
    failTotal: failTotalPre,
    groupsTotal,
    worst: allInterfaces.length ? allInterfaces[0] : null,
    // 11-20 拍板：真实口径（剥离仿真）——KPI 卡/结论行用；realWorst 排除纯仿真接口
    simFailTotal: products.reduce((a, p) => a + p.simTaggedPre, 0),
    realFailTotal: failTotalPre - products.reduce((a, p) => a + p.simTaggedPre, 0),
    realWorst: allInterfaces.find((it) => !it.pureSim) || null,
    pendingTotal: products.reduce((a, p) => a + p.pendingGroups, 0),
    closedTotal: products.reduce((a, p) => a + (p.closedGroups || 0), 0),
    realBelowThresholdCount: allInterfaces.filter((it) => !it.pureSim && it.belowThreshold).length,
    delta: {
      prevDate,
      prevInterfaceCount: Number(/** @type {{interfaces?: number}} */ (prevRow)?.interfaces || 0),
      prevFailTotal: Number(/** @type {{pre?: number}} */ (prevRow)?.pre || 0),
      failDelta: failTotalPre - Number(/** @type {{pre?: number}} */ (prevRow)?.pre || 0),
      interfaceDelta: statRows.length - Number(/** @type {{interfaces?: number}} */ (prevRow)?.interfaces || 0),
    },
  }

  // 11-20 拍板：诊断能力缺口分区素材——缺口组按 L1='诊断能力缺口' 全组口径聚合（l1ByProduct 已含）；
  // 从未诊断组（undiagnosedTotal/undiagByPool）单列，两者都不进待处理数字
  const gapL1ByProduct = new Map()
  for (const [pk, l1m] of l1ByProduct.entries()) {
    const gap = l1m.get('诊断能力缺口')
    if (gap) gapL1ByProduct.set(pk, gap.count)
  }
  const gapGroups = [...gapL1ByProduct.values()].reduce((a, n) => a + n, 0)

  // 11-20 15:09 拍板：历史 pending 转待处理（trapped）——今日诊断成功且转待产品处理、
  // 但失败发生在报告日之前（历史日期）的组。不在日报窗口内易漏处理，需显式提醒。
  // 判定锚点=diagnoses 表（status='success' AND 今日 diagnosed_at）——精确锚定「今日诊断成功」
  // 动作，不受 groups.updated_at 手工改状态污染；次日自动失配退出（零维护）。
  const todayStr = localDateStr(new Date())
  const trappedRows = db.prepare(`
    SELECT g.product_key pk, COUNT(*) n, SUM(g.pre_compress_count) pre
    FROM api_patrol_failure_groups g
    JOIN (SELECT DISTINCT failure_group_id FROM api_patrol_diagnoses
          WHERE status='success' AND substr(diagnosed_at, 1, 10) = ?) d
      ON d.failure_group_id = g.id
    WHERE g.product_action_status='待处理' AND g.group_date < ?
    GROUP BY g.product_key
  `).all(todayStr, date)
  /** @type {Map<string, { groups: number, pre: number }>} */
  const trappedByProduct = new Map()
  let trappedTotal = 0
  let trappedPreTotal = 0
  for (const t of trappedRows) {
    const pk = String(t.pk)
    const n = Number(t.n || 0)
    const pre = Number(t.pre || 0)
    trappedByProduct.set(pk, { groups: n, pre })
    trappedTotal += n
    trappedPreTotal += pre
  }
  // 产品级 trapped 角标素材（11-20 15:09 拍板：产品块标题行角标 + chips 行）
  for (const p of products) {
    const tp = trappedByProduct.get(p.productKey)
    if (tp) p.trappedPendingGroups = tp.groups
  }
  // 总览分布素材（产品分布文案数据源）：从 trappedByProduct 全量取——不依赖 products 数组
  // （trapped 组的产品当日可能无数据无产品块，如仅历史日有失败——分布仍须完整）
  const names2 = productNameMap()

  return {
    date,
    hasData: statRows.length > 0 || groupRows.length > 0,
    products,
    overview: {
      ...overview,
      // 11-20 15:09：trapped 提示素材（总览提示条 + subject 追加段）
      trappedPendingGroups: trappedTotal,
      trappedPreTotal: trappedPreTotal,
      trappedByProduct: [...trappedByProduct.entries()].map(([pk, v]) => ({
        productName: names2[pk] || pk, groups: v.groups,
      })).sort((a, b) => b.groups - a.groups),
    },
    simTaggedGroups: simTaggedTotal,
    undiagnosedGroups: undiagnosedTotal,
    // 缺口分区素材（11-20）：诊断能力缺口组数 + 从未诊断组池分布
    gapGroups,
    undiagByPool: [...undiagByPool.entries()].map(([pool, n]) => ({ pool, count: n })),
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 渲染日报 HTML 正文（§8.3：按产品分块；仿真/测试打标；未诊断末尾提示；详情链接）。
 * @param {ReturnType<typeof buildPatrolDailyReport>} report
 */
export function renderPatrolDailyReportHtml(report) {
  const lines = []
  // 11-20 11:15 拍板：字体全部命中系统默认（system-ui 各平台解析为原生 UI 字体，sans-serif 兜底）——不硬编码具体字体名
  lines.push('<div style="font-family:system-ui,sans-serif;color:#1f2329;font-size:14px;line-height:1.7;">')
  lines.push(`<p style="margin:0 0 12px;"><strong>AI 巡检日报</strong> · 报告窗口：${esc(report.date)}（全天）</p>`)

  // ① 结论行（11-20 拍板：纯数据事实，无编辑性判断；真实口径=剥离仿真）
  if (report.overview && report.products.length > 0) {
    const o = report.overview
    lines.push(`<p style="margin:0 0 10px;padding:8px 10px;background:#f7f8fa;border-left:3px solid #534ab7;border-radius:0 6px 6px 0;">`)
    lines.push(`<strong>昨日失败（真实口径，剥离仿真/测试）${o.realFailTotal} 次</strong>（压缩 ${o.groupsTotal} 组）；`)
    if (o.realWorst) {
      lines.push(`最严重 ${esc(o.realWorst.productName)}·${esc(o.realWorst.metric)}（${esc(o.realWorst.pool)}，成功率 ${o.realWorst.successRate}%、失败 ${o.realWorst.failCount} 次）；`)
    }
    lines.push(`待产品侧处理 <strong style="color:#d4380d;">${o.pendingTotal}</strong> 组${o.pendingTotal > 0 && report.products.some((p) => p.causeDist.length > 0) ? '，待处理根因：' + esc(report.products.flatMap((p) => p.causeDist.filter((d) => d.l1 !== '未分类').map((d) => `${d.l1} ${d.count}`)).slice(0, 4).join('、')) : ''}。`)
    lines.push(`</p>`)
  }

  // ①b 历史 pending 转待处理提示条（11-20 15:09 拍板：橙黄提示条——今日诊断转出但不在窗口内易漏处理）
  const base = getPublicAppUrl()
  const trapped = report.overview?.trappedPendingGroups || 0
  if (trapped > 0) {
    // 产品分布文案（EIP 3 组 / SLB 1 组）——从 overview.trappedByProduct 全量取（含当日无产品块的产品）
    const distStr = (report.overview?.trappedByProduct || [])
      .map((t) => `${esc(t.productName)} ${t.groups} 组`)
      .join(' / ')
    lines.push(`<p style="margin:0 0 10px;padding:8px 10px;background:#fff7e8;border-left:3px solid #d48806;border-radius:0 6px 6px 0;">`)
    lines.push(`<strong style="color:#d48806;">⚡ ${trapped} 组历史遗留失败今日完成诊断并转待产品处理${distStr ? `（${distStr}）` : ''}</strong>`)
    lines.push(`<div style="color:#d48806;font-size:12px;">——不在本日报窗口内，请前往「失败请求列表」-近7日 处理${base ? `（<a href="${esc(base)}/api-patrol/failures?status=${encodeURIComponent('需产品侧处理')}" style="color:#165dff;">按状态查看待处理组清单</a>）` : ''}</div>`)
    lines.push(`</p>`)
  }

  if (report.products.length === 0) {
    lines.push('<p style="margin:0 0 12px;color:#4e5969;">昨日无异常接口与失败请求，各产品运行平稳。</p>')
  }

  // ② KPI 卡 ×4（11-20 拍板：table 布局 Outlook 兼容；未诊断不进待处理卡）
  if (report.overview && report.products.length > 0) {
    const o = report.overview
    const kpiTd = 'width:25%;padding:10px 12px;background:#f7f8fa;border-radius:6px;'
    const kpiLabel = 'font-size:12px;color:#4e5969;'
    const kpiValue = 'font-size:22px;font-weight:bold;margin-top:2px;'
    const kpiSub = 'font-size:11px;color:#86909c;margin-top:2px;'
    const d = o.delta
    const failDeltaStr = d ? `较前日 ${d.failDelta >= 0 ? '+' : ''}${d.failDelta} 次` : ''
    const simStr = o.simFailTotal > 0 ? `仿真另计 ${o.simFailTotal} 次` : ''
    lines.push('<table style="border-collapse:separate;border-spacing:8px 8px;margin:-8px -8px 4px;width:100%;" cellspacing="0" cellpadding="0"><tr>')
    lines.push(`<td style="${kpiTd}"><div style="${kpiLabel}">失败请求（真实）</div><div style="${kpiValue}">${o.realFailTotal}<span style="font-size:12px;font-weight:normal;"> 次</span></div><div style="${kpiSub}">${[failDeltaStr, simStr].filter(Boolean).join(' · ') || '压缩 ' + o.groupsTotal + ' 组'}</div></td>`)
    lines.push(`<td style="${kpiTd}"><div style="${kpiLabel}">待产品侧处理</div><div style="${kpiValue}color:#d4380d;">${o.pendingTotal}<span style="font-size:12px;font-weight:normal;"> 组</span></div><div style="${kpiSub}">已闭环 ${o.closedTotal} 组</div></td>`)
    lines.push(`<td style="${kpiTd}"><div style="${kpiLabel}">异常接口（&lt;99.5%）</div><div style="${kpiValue}">${o.belowThresholdCount}</div><div style="${kpiSub}">真实口径 ${o.realBelowThresholdCount} 个</div></td>`)
    lines.push(`<td style="${kpiTd}"><div style="${kpiLabel}">涉及产品 / 资源池</div><div style="${kpiValue}">${o.productCount}<span style="font-size:12px;font-weight:normal;"> / </span>${report.products.reduce((a, p) => a + p.poolsCount, 0)}</div><div style="${kpiSub}">检测覆盖</div></td>`)
    lines.push('</tr></table>')
  }

  // ③ 产品分块（11-20 拍板：根因分布进表格列；顶部段落删除）
  for (const p of report.products) {
    lines.push(`<div style="margin:14px 0;padding:10px 12px;border:1px solid #e5e6eb;border-radius:6px;">`)
    lines.push(`<p style="margin:0 0 6px;"><strong>■ ${esc(p.productName)}</strong>`)
    // 11-20 15:09 拍板：trapped 角标（历史遗留失败今日转待产品处理——不在本日报窗口内）
    if (Number(p.trappedPendingGroups || 0) > 0) {
      lines.push(` <strong style="color:#d48806;">⚡${p.trappedPendingGroups}</strong>`)
    }
    if (p.poolsCount > 0) lines.push(` <span style="color:#4e5969;font-size:12px;">（${p.poolsCount} 个资源池）</span>`)
    lines.push('</p>')
    const chips = []
    chips.push(`失败请求 <strong>${p.preTotal}</strong> 次（压缩 ${p.groups} 组）`)
    chips.push(`待产品侧处理 <strong style="color:#d4380d;">${p.pendingGroups}</strong> 组（压缩前 ${p.pendingPre} 次）`)
    // 11-20 15:09 拍板文案：历史遗留失败今日完成诊断并转待产品处理 N 组
    if (Number(p.trappedPendingGroups || 0) > 0) {
      chips.push(`<span style="color:#d48806;">历史遗留失败今日完成诊断并转待产品处理 <strong>${p.trappedPendingGroups}</strong> 组</span>`)
    }
    if (p.simTaggedGroups > 0) {
      const simPct = p.preTotal > 0 ? Math.round((p.simTaggedPre / p.preTotal) * 100) : 0
      chips.push(`仿真/测试 ${p.simTaggedGroups} 组（${p.simTaggedPre} 次，${simPct}%）<span style="color:#86909c;font-size:12px;">［不计入以上数字］</span>`)
    }
    if (p.closedGroups > 0) chips.push(`已闭环 ${p.closedGroups} 组`)
    lines.push(`<p style="margin:0 0 6px;">${chips.join(' · ')}</p>`)
    if (p.interfaces.length > 0) {
      lines.push(`<p style="margin:8px 0 4px;"><strong>异常接口（${p.interfaces.length}）</strong></p>`)
      lines.push('<table style="border-collapse:collapse;margin-top:0;width:100%;" cellspacing="0" cellpadding="0">')
      lines.push('<tr style="background:#f7f8fa;">')
      for (const h of ['指标', '资源池', '业务类型', '成功率', '总次数', '失败次数', '根因分布', '待产品处理']) {
        lines.push(`<th style="border:1px solid #e5e6eb;padding:4px 8px;text-align:left;font-size:12px;">${h}</th>`)
      }
      lines.push('</tr>')
      for (const it of p.interfaces) {
        const rateColor = it.belowThreshold ? 'color:#d4380d;font-weight:bold;' : ''
        // 根因分布列（11-20 拍板：L1 Top3+组数；未诊断/缺口如实标注；无失败组「—」）
        const causeStr = (it.causeTop || []).length > 0
          ? it.causeTop.map((c) => `${esc(c.l1)}×${c.count}`).join(' · ')
          : '—'
        // 待产品处理列（11-20 拍板：该接口×池的待处理组数；0 显「—」；纯仿真接口并列标识）
        const pendingStr = it.pendingGroups > 0
          ? `<span style="color:#d4380d;font-weight:bold;">${it.pendingGroups} 组</span>`
          : '—'
        lines.push('<tr>')
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;">${esc(it.metric)}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;">${esc(it.pool)}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;">${esc(it.bizType)}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;${rateColor}">${it.successRate}%${it.belowThreshold ? ' ⚠' : ''}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;text-align:right;">${it.totalCount}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;text-align:right;">${it.failCount}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:11px;color:#4e5969;">${causeStr}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;">${pendingStr}${it.pureSim ? '<div style="font-size:11px;color:#86909c;">仿真/测试</div>' : ''}</td>`)
        lines.push('</tr>')
      }
      lines.push('</table>')
    }
    lines.push('</div>')
  }

  // ④ 诊断能力缺口分区（11-20 拍板：独立卡片给建设方；未诊断与缺口都不进待处理数字）
  if ((report.gapGroups || 0) > 0 || report.undiagnosedGroups > 0) {
    lines.push(`<div style="margin:14px 0;padding:10px 12px;border:1px solid #e5e6eb;border-radius:6px;background:#f7f8fa;">`)
    lines.push(`<p style="margin:0 0 4px;"><strong>诊断能力缺口</strong> <span style="font-size:12px;color:#4e5969;">（日志查不到根因的失败——诊断能力建设需求）</span></p>`)
    const parts = []
    if ((report.gapGroups || 0) > 0) parts.push(`日志查不到失败原因 <strong>${report.gapGroups}</strong> 组`)
    if (report.undiagnosedGroups > 0) {
      const poolStr = report.undiagByPool.map((u) => `${esc(u.pool)} ${u.count}`).join('、')
      parts.push(`从未诊断 <strong>${report.undiagnosedGroups}</strong> 组（${poolStr}）`)
    }
    lines.push(`<p style="margin:0 0 4px;">${parts.join('；')}——均未计入待产品侧处理。</p>`)
    lines.push(`</div>`)
  }

  // ⑤ 尾链分流（11-20 拍板：按意图带参直达）——base 已在 ①b 声明（trapped>0 时也用）
  if (base) {
    const q = `startDate=${encodeURIComponent(report.date)}&endDate=${encodeURIComponent(report.date)}`
    lines.push(`<p style="margin:12px 0 0;">`)
    lines.push(`<a href="${esc(base)}/api-patrol/failures?${q}" style="color:#165dff;">按日期查看失败明细</a>`)
    lines.push(`　<a href="${esc(base)}/api-patrol/failures?status=${encodeURIComponent('需产品侧处理')}" style="color:#165dff;">待处理组清单</a>`)
    lines.push(`　<a href="${esc(base)}/api-patrol/diagnosis-gaps" style="color:#165dff;">诊断能力需求</a>`)
    lines.push(`</p>`)
  }
  lines.push('</div>')
  return lines.join('\n')
}

/**
 * 平静日正文（includeQuiet=true 时发送）。
 * @param {string} date
 */
export function renderPatrolQuietReportHtml(date) {
  return `<div style="font-family:system-ui,sans-serif;color:#1f2329;font-size:14px;line-height:1.7;">
<p><strong>AI 巡检日报</strong> · 报告窗口：${esc(date)}（全天）</p>
<p>昨日无异常接口与失败请求，各产品运行平稳。</p>
</div>`
}
