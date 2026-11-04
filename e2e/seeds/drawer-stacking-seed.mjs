// @ts-check
/**
 * 抽屉叠加 E2E 种子脚本：给独立 e2e 实例（默认 http://127.0.0.1:3211）灌
 * 1 条投诉工单 + 1 条 in_progress 举措（带 linkedTicketIds）+ 1 个举一反三 issue
 * （带 confirmed link 指向同一工单）。
 *
 * 幂等：以 product_key='e2e-drawer-stack' 为标记——经 API 查旧种子，先删后插
 * （API 无批量删除，走列表 + 逐条 DELETE）。
 * 用法：node e2e/seeds/drawer-stacking-seed.mjs [baseUrl]
 */
const BASE = process.argv[2] || 'http://127.0.0.1:3211'
const ADMIN_USER = 'admin'
const ADMIN_PASS = process.env.E2E_ADMIN_INITIAL_PASSWORD || 'E2eTestPass123!'

const MARKER = 'e2e-drawer-stack'
const RUN = Date.now()
const TICKET_ID = `E2E-DS-${RUN}`
const PERIOD_ID = 'period:month:2026-09'

/** @param {string} path @param {RequestInit} [init] */
async function api(path, init) {
  const hasBody = init?.body != null
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  })
  const text = await res.text()
  if (!res.ok) {
    throw new Error(`${init?.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 300)}`)
  }
  return text ? JSON.parse(text) : {}
}

async function main() {
  // 登录拿 token（响应 { user, accessToken }）
  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
  })
  const token = login.accessToken
  if (!token) throw new Error(`登录响应无 accessToken：${JSON.stringify(login).slice(0, 200)}`)
  const auth = { Authorization: `Bearer ${token}` }

  // ⓪ 幂等清理：按标记删旧种子（举措带工单关联须先解关联再删）
  try {
    const oldActions = await api('/api/actions?search=E2E%E5%8F%A0%E5%8A%A0&limit=500', { headers: auth })
    for (const it of oldActions.items || []) {
      if (it.productKey !== MARKER) continue
      if (it.linkedTicketIds?.length) {
        await api('/api/actions/unlink-tickets', {
          method: 'POST',
          headers: auth,
          body: JSON.stringify({ links: it.linkedTicketIds.map((ticketId) => ({ actionId: it.id, ticketId })) }),
        })
      }
      await api(`/api/actions/${it.id}`, { method: 'DELETE', headers: auth })
    }
    const oldIssues = await api('/api/generalization/issues?keyword=E2E%E5%8F%A0%E5%8A%A0&pageSize=100', { headers: auth })
    for (const iss of oldIssues.issues || []) {
      if (iss.productKey === MARKER) {
        await api(`/api/generalization/issues/${iss.id}`, { method: 'DELETE', headers: auth })
      }
    }
  } catch (err) {
    console.warn(`[seed] 旧数据清理跳过：${err.message}`)
  }

  // ① 投诉工单记录（POST /api/storage/records/batch，宽松 schema）
  const recordId = `rec-${MARKER}-${RUN}`
  const recordPayload = {
    id: recordId,
    dataSourceType: 'complaint_ticket',
    insightPeriodId: PERIOD_ID,
    importMonth: '2026-09',
    ticketId: TICKET_ID,
    productName: 'E2E叠加测试产品',
    channel: 'email',
    urgency: '加急',
    problemType: '功能异常',
    requestScene: '使用中',
    journey: '交付-使用',
    sentiment: '负面',
    emotion: '不满',
    summary: 'E2E 抽屉叠加冒烟工单：重复出现功能异常',
    customerQuote: '功能一直报错，影响使用',
    rawText: `E2E叠加测试工单 ${TICKET_ID}：功能异常多次出现，客户反复报障`,
    handlingText: '处理意见：已定位为已知问题',
    handlingResult: '已解决',
    linkedRequirementTicketIds: [],
  }
  await api('/api/storage/records/batch', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ records: [recordPayload] }),
  })
  console.info(`[seed] record ok: ${recordId}`)

  // ② in_progress 举措（linkedTicketIds 指向该工单）
  const action = await api('/api/actions', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      productKey: MARKER,
      productName: 'E2E叠加测试产品',
      content: 'E2E叠加：修复功能异常',
      detail: 'E2E 抽屉叠加冒烟举措：关联工单可点开详情抽屉',
      status: 'in_progress',
      scheduleAt: '2026-09-01',
      linkedTicketIds: [TICKET_ID],
      source: 'ticket',
    }),
  })
  const actionItem = action.item
  if (!actionItem?.id) throw new Error(`举措创建失败：${JSON.stringify(action).slice(0, 200)}`)
  console.info(`[seed] action ok: ${actionItem.id}`)

  // ③ 举一反三 issue（in_progress + confirmed link → 同一工单）
  const issue = await api('/api/generalization/issues', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      productKey: MARKER,
      productName: 'E2E叠加测试产品',
      title: 'E2E叠加：功能异常反复出现',
      summary: 'E2E 抽屉叠加冒烟举一反三：功能异常多单同因',
      category: 'code_logic',
      scope: 'multi_scenario',
      keywords: ['E2E'],
      notes: 'E2E seed',
      firstLink: {
        recordId,
        recordDataSource: 'complaint_ticket',
        ticketId: TICKET_ID,
      },
    }),
  })
  if (!issue.issue?.id) throw new Error(`举一反三创建失败：${JSON.stringify(issue).slice(0, 300)}`)
  console.info(`[seed] generalization ok: ${issue.issue.id}`)

  // 输出上下文供 spec 消费（spec 自身也会重新查询）
  console.info(
    JSON.stringify({ ok: true, ticketId: TICKET_ID, recordId, actionId: actionItem.id, issueId: issue.issue.id }),
  )
}

main().catch((err) => {
  console.error('[seed] FAILED:', err.message)
  process.exit(1)
})
