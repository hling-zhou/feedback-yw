import { getDb } from './db.js'
import { storageRepository } from './storageRepository.js'
import { getPublicAppUrl } from './mailRepository.js'

/** 推送阈值口径（与溯源页/总览一致） */
const PUSH_THRESHOLD = 99.5

/** @typedef {{ productKey: string, productName: string, poolsCount: number, groups: number, preTotal: number, pendingGroups: number, pendingPre: number, simTaggedGroups: number, simTaggedPre: number, causeDist: Array<{ l1: string, count: number, pre: number }>, l2Top: Array<{ l2: string, count: number, pre: number }>, interfaces: Array<{ pool: string, metric: string, apiPath: string, bizType: string, successRate: number, belowThreshold: boolean }> }} PatrolReportProduct */

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
  /** @type {Map<string, {groups: number, sim: number}>} */ const simAggByInterface = new Map() // pool\0api → 仿真推导（11-07 拍板：纯仿真接口带标签排后；口径与溯源页异常接口列表同源）
  /** @type {Map<string, Map<string, {count: number, pre: number}>>} */ const l1ByProduct = new Map()
  /** @type {Map<string, Map<string, {count: number, pre: number}>>} */ const l2ByProduct = new Map()
  let simTaggedTotal = 0
  let undiagnosedTotal = 0
  for (const g of groupRows) {
    const pk = String(g.pk)
    const isSim = g.ctype === '仿真' || g.ctype === '测试账号'
    const undiagnosed = g.l1 == null
    if (isSim) simTaggedTotal += 1
    if (undiagnosed) undiagnosedTotal += 1
    const ikey = `${g.pool}\u0000${g.apiPath || ''}`
    if (!simAggByInterface.has(ikey)) simAggByInterface.set(ikey, { groups: 0, sim: 0 })
    const si = simAggByInterface.get(ikey)
    si.groups += 1
    if (isSim) si.sim += 1
    if (excludeSim && isSim) continue // 排除口径：不进任何统计（含待处理）
    const p = ensure(pk)
    p.groups += 1
    p.preTotal += Number(g.pre || 0)
    if (isSim) { p.simTaggedGroups += 1; p.simTaggedPre += Number(g.pre || 0) }
    const pool = String(g.pool || '')
    if (!poolsSeen.has(pk)) poolsSeen.set(pk, new Set())
    poolsSeen.get(pk).add(pool)
    if (g.status === '待处理') {
      p.pendingGroups += 1
      p.pendingPre += Number(g.pre || 0)
      // L1/L2 分布只统计待处理组（"问题分布"= 需产品侧关注的分布）
      if (!l1ByProduct.has(pk)) l1ByProduct.set(pk, new Map())
      const l1m = l1ByProduct.get(pk)
      const l1key = String(g.l1 || '未分类')
      const cur = l1m.get(l1key) || { count: 0, pre: 0 }
      cur.count += 1; cur.pre += Number(g.pre || 0)
      l1m.set(l1key, cur)
      if (!l2ByProduct.has(pk)) l2ByProduct.set(pk, new Map())
      const l2m = l2ByProduct.get(pk)
      const l2key = String(g.l2 || '未分类')
      const cur2 = l2m.get(l2key) || { count: 0, pre: 0 }
      cur2.count += 1; cur2.pre += Number(g.pre || 0)
      l2m.set(l2key, cur2)
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

  // 异常接口明细（stats 推送值原样）+ 纯仿真推导（同源口径：接口×池 全部失败组为仿真/测试 → pureSim）
  for (const s of statRows) {
    const pk = String(s.pk)
    const p = ensure(pk)
    const rate = Number(s.rate)
    const si = simAggByInterface.get(`${s.pool}\u0000${s.api}`) || { groups: 0, sim: 0 }
    const ca = countAgg.get(`${s.pool}\u0000${s.api}`) || { total: 0, fail: 0 }
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
    const l1m = l1ByProduct.get(p.productKey)
    if (l1m) p.causeDist = [...l1m.entries()].map(([l1, v]) => ({ l1, count: v.count, pre: v.pre }))
      .sort((a, b) => b.count - a.count)
    const l2m = l2ByProduct.get(p.productKey)
    if (l2m) p.l2Top = [...l2m.entries()].map(([l2, v]) => ({ l2, count: v.count, pre: v.pre }))
      .sort((a, b) => b.count - a.count).slice(0, 5)
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
    delta: {
      prevDate,
      prevInterfaceCount: Number(/** @type {{interfaces?: number}} */ (prevRow)?.interfaces || 0),
      prevFailTotal: Number(/** @type {{pre?: number}} */ (prevRow)?.pre || 0),
      failDelta: failTotalPre - Number(/** @type {{pre?: number}} */ (prevRow)?.pre || 0),
      interfaceDelta: statRows.length - Number(/** @type {{interfaces?: number}} */ (prevRow)?.interfaces || 0),
    },
  }

  return {
    date,
    hasData: statRows.length > 0 || groupRows.length > 0,
    products,
    overview,
    simTaggedGroups: simTaggedTotal,
    undiagnosedGroups: undiagnosedTotal,
  }
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 渲染日报 HTML 正文（§8.3：按产品分块；仿真/测试打标；未诊断末尾提示；详情链接）。
 * @param {ReturnType<typeof buildPatrolDailyReport>} report
 */
export function renderPatrolDailyReportHtml(report) {
  const lines = []
  lines.push('<div style="font-family:-apple-system,\'PingFang SC\',\'Microsoft YaHei\',sans-serif;color:#1f2329;font-size:14px;line-height:1.7;">')
  lines.push(`<p style="margin:0 0 12px;"><strong>AI 巡检日报</strong> · 报告窗口：${esc(report.date)}（全天）</p>`)

  // 总起概况段（2026-11-07 拍板：开门先看整体与最严重，再进产品分块；口径与产品块正文同源）
  if (report.overview && report.products.length > 0) {
    const o = report.overview
    lines.push(`<p style="margin:0 0 10px;padding:8px 10px;background:#f7f8fa;border-radius:6px;">`)
    lines.push(`<strong>昨日整体</strong>：检测覆盖 ${o.productCount} 个产品，发现 ${o.interfaceCount} 个异常接口（${o.belowThresholdCount} 个低于 99.5% 推送阈值），失败请求 ${o.failTotal} 次（压缩 ${o.groupsTotal} 组）。`)
    if (o.worst) {
      lines.push(`最严重：${esc(o.worst.productName)}·${esc(o.worst.metric)}（${esc(o.worst.pool)}，成功率 ${o.worst.successRate}%、失败 ${o.worst.failCount} 次${o.worst.pureSim ? '，全部为仿真/测试流量' : ''}）。`)
    }
    if (o.delta) {
      const d = o.delta
      lines.push(`较前日（${esc(d.prevDate)}）：失败 ${d.failDelta >= 0 ? '+' : ''}${d.failDelta} 次、异常接口 ${d.interfaceDelta >= 0 ? '+' : ''}${d.interfaceDelta} 个。`)
    }
    lines.push(`</p>`)
  }

  if (report.products.length === 0) {
    lines.push('<p style="margin:0 0 12px;color:#4e5969;">昨日无异常接口与失败请求，各产品运行平稳。</p>')
  }

  for (const p of report.products) {
    lines.push(`<div style="margin:14px 0;padding:10px 12px;border:1px solid #e5e6eb;border-radius:6px;">`)
    lines.push(`<p style="margin:0 0 6px;"><strong>■ ${esc(p.productName)}</strong>`)
    if (p.poolsCount > 0) lines.push(` <span style="color:#4e5969;font-size:12px;">（${p.poolsCount} 个资源池）</span>`)
    lines.push('</p>')
    const chips = []
    chips.push(`失败请求 <strong>${p.preTotal}</strong> 次（压缩 ${p.groups} 组）`)
    chips.push(`待产品侧处理 <strong style="color:#d4380d;">${p.pendingGroups}</strong> 组（压缩前 ${p.pendingPre} 次）`)
    if (p.simTaggedGroups > 0) {
      chips.push(`其中仿真/测试流量 ${p.simTaggedGroups} 组（压缩前 ${p.simTaggedPre} 次）<span style="color:#86909c;font-size:12px;">［仿真/测试标记］</span>`)
    }
    lines.push(`<p style="margin:0 0 6px;">${chips.join(' · ')}</p>`)
    if (p.causeDist.length > 0) {
      const dist = p.causeDist.map((d) => `${esc(d.l1)} ${d.count} 组`).join('；')
      lines.push(`<p style="margin:0 0 6px;">待处理根因分布：${dist}</p>`)
      if (p.l2Top.length > 0) {
        const l2 = p.l2Top.map((d) => `${esc(d.l2)} ${d.count}`).join('；')
        lines.push(`<p style="margin:0 0 6px;color:#4e5969;font-size:12px;">待处理细分（Top5）：${l2}</p>`)
      }
    }
    if (p.interfaces.length > 0) {
      lines.push(`<p style="margin:8px 0 4px;"><strong>异常接口（${p.interfaces.length}）</strong></p>`)
      lines.push('<table style="border-collapse:collapse;margin-top:0;width:100%;" cellspacing="0" cellpadding="0">')
      lines.push('<tr style="background:#f7f8fa;">')
      for (const h of ['指标', '资源池', '业务类型', '成功率', '总次数', '失败次数', '标记']) {
        lines.push(`<th style="border:1px solid #e5e6eb;padding:4px 8px;text-align:left;font-size:12px;">${h}</th>`)
      }
      lines.push('</tr>')
      for (const it of p.interfaces) {
        const rateColor = it.belowThreshold ? 'color:#d4380d;font-weight:bold;' : ''
        lines.push('<tr>')
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;">${esc(it.metric)}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;">${esc(it.pool)}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;">${esc(it.bizType)}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;${rateColor}">${it.successRate}%${it.belowThreshold ? ' ⚠' : ''}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;text-align:right;">${it.totalCount}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;text-align:right;">${it.failCount}</td>`)
        lines.push(`<td style="border:1px solid #e5e6eb;padding:4px 8px;font-size:12px;">${it.pureSim ? '仿真/测试' : (it.belowThreshold ? '未达推送阈值' : '—')}</td>`)
        lines.push('</tr>')
      }
      lines.push('</table>')
    }
    lines.push('</div>')
  }

  if (report.undiagnosedGroups > 0) {
    lines.push(`<p style="margin:10px 0 0;color:#86909c;font-size:12px;">另有未诊断 ${report.undiagnosedGroups} 组（诊断未完成），未计入待产品侧处理；详见平台。</p>`)
  }
  const base = getPublicAppUrl()
  if (base) {
    lines.push(`<p style="margin:12px 0 0;"><a href="${esc(base)}/api-patrol/failures" style="color:#165dff;">查看详情 → 平台 · 产品重点API巡检</a></p>`)
  }
  lines.push('</div>')
  return lines.join('\n')
}

/**
 * 平静日正文（includeQuiet=true 时发送）。
 * @param {string} date
 */
export function renderPatrolQuietReportHtml(date) {
  return `<div style="font-family:-apple-system,'PingFang SC',sans-serif;color:#1f2329;font-size:14px;line-height:1.7;">
<p><strong>AI 巡检日报</strong> · 报告窗口：${esc(date)}（全天）</p>
<p>昨日无异常接口与失败请求，各产品运行平稳。</p>
</div>`
}
