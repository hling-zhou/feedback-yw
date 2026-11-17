/**
 * API 巡检诊断任务（docs/DESIGN-API巡检.md §4.2）。
 * 服务端轻量 MCP Client（JSON-RPC over HTTP → cni.mcp.server:31788/mcp-server/mcp）。
 * 流程：取当日该池未诊断组（pending_diagnosis）→ 并发 worker（默认 3）逐组调 log_search
 * （仅组首条 requestId）→ diagnoses 状态机（pending/success/failed）→ 回填 groups
 * root_cause_l1/l2 + product_action_status（根因映射值）。
 * 失败组保持 pending_diagnosis 可重试；超时/5xx/连接失败 → failed。
 *
 * 真实服务契约（2026-11-09 实测校准，serverInfo=cni-mcp-server-api-v2 v1.0.0）：
 * - 传输 = MCP Streamable HTTP：请求必须带 `Accept: application/json, text/event-stream`
 *   （缺头 → 400 空 body）；
 * - log_search 必填：startTime/endTime（yyyy-MM-dd HH:mm:ss）、productName（枚举）、
 *   poolName（枚举）；**无 requestId 参数**——requestId 走 filter 关键字过滤；
 * - 官方 tool_timeout_sec=300（时间窗口大/日志量大时慢）。
 */

const DEFAULT_TIMEOUT_MS = 300_000
const DEFAULT_CONCURRENCY = 3
const DEFAULT_TOOL_NAME = 'log_search'

/** MCP  productName 枚举映射（平台产品 key → 云网枚举）。 */
const MCP_PRODUCT_NAMES = /** @type {Record<string, string>} */ ({
  eip: 'fip/vpc',
  vpc: 'fip/vpc',
  slb: 'slb-console',
})

/**
 * 组首条时间 ±offsetMin 格式化（yyyy-MM-dd HH:mm:ss，本地时区）；无效日期回退当日零点。
 * @param {Date} d
 * @param {number} offsetMin
 */
function invalidDateGuard(d, offsetMin) {
  const base = Number.isFinite(d.getTime()) ? d : new Date()
  const t = new Date(base.getTime() + offsetMin * 60_000)
  const p = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
}

/**
 * MCP tools/call 单次调用（Streamable HTTP 传输）。
 * @param {{ mcpEndpoint: string, mcpToken: string, toolName?: string, timeoutMs?: number }} options
 * @param {Record<string, unknown>} args
 * @returns {Promise<{ ok: true, text: string } | { ok: false, error: string }>}
 */
export async function callMcpTool(options, args) {
  const {
    mcpEndpoint,
    mcpToken,
    toolName = DEFAULT_TOOL_NAME,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(mcpEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Streamable HTTP 必需（缺头 400——11-09 实测）
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${mcpToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `patrol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
      signal: controller.signal,
    })
    if (!res.ok) {
      return { ok: false, error: `MCP HTTP ${res.status}` }
    }
    const payload = await res.json()
    // MCP 返回形态：result.content[]（text 段落）——按协议拼回原文
    const content = /** @type {{ result?: { content?: Array<{ type: string, text?: string }>, isError?: boolean } }} */ (payload)?.result?.content
    if (Array.isArray(content)) {
      const text = content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => /** @type {{text: string}} */ (c).text)
        .join('\n')
      // isError=true：text 是错误描述（如下游平台 412/500），按失败处理保可重试
      if (payload?.result?.isError) {
        return { ok: false, error: text.slice(0, 300) || 'MCP 工具执行错误' }
      }
      if (text) return { ok: true, text }
    }
    // 兜底：result 直接是对象（非标准形态），原样 JSON 化
    if (payload?.result && typeof payload.result === 'object') {
      return { ok: true, text: JSON.stringify(payload.result) }
    }
    return { ok: false, error: 'MCP 响应无 content 文本' }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: `MCP 调用超时（${timeoutMs}ms）` }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 诊断日志全量拉取（11-17：分页缺失曾致关键证据截断——失败点常在第 2/3 页）。
 * log_search_full_param 循环翻页直到取完 total 或达安全上限；
 * 返回合成 MCP 响应文本（与 log_search 单页同形态：{code:'0000', data:{records, total}}），
 * 下游 extractDiagnosticText / buildDiagnosisReport 切分逻辑无需改动。
 * @param {{ mcpEndpoint: string, mcpToken: string, timeoutMs?: number, maxPages?: number, pageSize?: number }} options
 * @param {{ startTime: string, endTime: string, productName: string, poolName: string, filter: string }} args
 * @returns {Promise<{ ok: true, text: string, total: number, pagesFetched: number, truncated: boolean } | { ok: false, error: string }>}
 */
export async function fetchPatrolDiagnosticLogs(options, args) {
  const {
    mcpEndpoint,
    mcpToken,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxPages = 10,   // 安全上限：500/页 × 10 页 = 5000 行（超大日志截断并标记）
    pageSize = 100,
  } = options
  /** @type {Array<Record<string, unknown>>} */
  const records = []
  let total = 0
  let page = 1
  let truncated = false
  for (;;) {
    const res = await callMcpTool(
      { mcpEndpoint, mcpToken, toolName: 'log_search_full_param', timeoutMs },
      { ...args, indexList: [], pageNum: page, pageSize },
    )
    if (!res.ok) return { ok: false, error: res.error }
    /** @type {{ code?: string, data?: { records?: Array<Record<string, unknown>>, total?: number } } | null} */
    let parsed = null
    try {
      parsed = JSON.parse(res.text)
    } catch {
      // 非 JSON 原文（诊断文本形态）——单页即全量，原样返回
      return { ok: true, text: res.text, total: records.length + 1, pagesFetched: page, truncated: false }
    }
    if (parsed?.code !== '0000' || !Array.isArray(parsed?.data?.records)) {
      // 旧诊断文本形态（{final_conclusion,...} 或纯文本）——无分页概念，单页即全量，原样返回
      return { ok: true, text: res.text, total: 1, pagesFetched: 1, truncated: false }
    }
    const batch = parsed.data.records
    total = Number(parsed.data?.total ?? batch.length) || batch.length
    records.push(...batch)
    if (batch.length < pageSize) break          // 末页（不足一页）
    if (records.length >= total) break           // 取满
    if (page >= maxPages) { truncated = true; break }  // 安全上限
    page += 1
  }
  // 合成与 log_search 同形态的响应原文（下流切分单源复用）
  const text = JSON.stringify({ code: '0000', msg: null, tip: '成功', data: { records, total, pageNum: 1, pageSize: records.length, pages: 1, truncated } })
  return { ok: true, text, total, pagesFetched: page, truncated }
}

/**
 * 运行某日某池的诊断任务：pending_diagnosis 组 → MCP → 分类回填。
 * @param {{ date: string, pool: string, mcpEndpoint: string, mcpToken: string,
 *   toolName?: string, timeoutMs?: number, concurrency?: number }} options
 * @returns {Promise<{ diagnosed: number, succeeded: number, failed: number }>}
 */
export async function runPatrolDiagnose(options) {
  const { getDb } = await import('./db.js')
  const { classifyPatrolRootCause, extractDiagnosticText } = await import('./patrolRootCauseClassifier.js')
  const { readPatrolRootCauseRules } = await import('./patrolRepository.js')
  const { storageRepository } = await import('./storageRepository.js')
  const db = getDb()
  const {
    date, pool, mcpEndpoint, mcpToken,
    toolName = DEFAULT_TOOL_NAME,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    concurrency = DEFAULT_CONCURRENCY,
  } = options

  const groups = /** @type {Array<{ id: number, first_request_id: string, first_request_time: string, api_path: string, product_key: string | null }>} */ (
    db.prepare(`
      SELECT id, first_request_id, first_request_time, api_path, product_key
      FROM api_patrol_failure_groups
      WHERE group_date=? AND pool_name=? AND product_action_status='pending_diagnosis'
      ORDER BY first_request_time
    `).all(date, pool)
  )
  if (groups.length === 0) return { diagnosed: 0, succeeded: 0, failed: 0 }

  const rules = readPatrolRootCauseRules()
  const now = new Date().toISOString()

  // 经办人默认值：产品目录 owners.productManager[0].username（§2.3）——仅在诊断回填「待处理」时适用
  const catalog = /** @type {{ products?: Array<{ key: string, owners?: { productManager?: Array<{ username: string }> } }> } | null} */ (
    storageRepository.getMeta('product_catalog_managed_v1')
  )
  /** @type {Map<string, string>} productKey → defaultAssignee */
  const defaultAssigneeByProduct = new Map()
  for (const p of catalog?.products || []) {
    const pm = p.owners?.productManager?.[0]?.username
    if (pm) defaultAssigneeByProduct.set(p.key, pm)
  }

  // 诊断回填后补 assignee 默认值（仅当 status=待处理且 assignee 为空时）
  const fillDefaultAssignee = db.prepare(`
    UPDATE api_patrol_failure_groups SET assignee=?
    WHERE id=? AND assignee IS NULL AND product_action_status='待处理'
  `)

  const insertDiag = db.prepare(`
    INSERT INTO api_patrol_diagnoses
      (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion,
       root_cause_l1, root_cause_l2, suggestion, direct_cause, evidence, root_cause_source, diagnosed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const updateGroup = db.prepare(`
    UPDATE api_patrol_failure_groups
    SET root_cause_l1=?, root_cause_l2=?, product_action_status=?, updated_at=?
    WHERE id=?
  `)

  let succeeded = 0
  let failed = 0
  // 并发 worker：游标取组，上限 concurrency（设计 §4.2 拍板 N=3 可配）
  let cursor = 0
  /** @type {Array<Promise<void>>} */
  const workers = []
  const workerCount = Math.min(concurrency, groups.length)
  for (let w = 0; w < workerCount; w++) {
    workers.push((async () => {
      for (;;) {
        const idx = cursor++
        if (idx >= groups.length) break
        const group = groups[idx]
        // log_search 真实参数契约（11-09 实测）：必填 startTime/endTime/productName/poolName，
        // requestId 走 filter。时间窗口 = 组首条 ±30 分钟（log 时区与 request_time 同为本地）。
        const firstTime = new Date(String(group.first_request_time).replace(' ', 'T'))
        const startTime = invalidDateGuard(firstTime, -30)
        const endTime = invalidDateGuard(firstTime, 30)
        const productName = MCP_PRODUCT_NAMES[String(group.product_key || '')] || 'fip/vpc'
        // 11-17 实测：filter 含连字符（reqId- 前缀）触发下游 412 子查询失败——
        // 剥前缀只传 hex 段可精准命中（诊断内容仍含完整 reqId）。
        const filterKeyword = String(group.first_request_id || '').replace(/^reqId-/, '')
        // 11-17 分页拉全量（log_search_full_param 翻页）——单页截断曾致关键证据丢失
        const result = await fetchPatrolDiagnosticLogs(
          { mcpEndpoint, mcpToken, timeoutMs },
          {
            startTime,
            endTime,
            productName,
            poolName: pool,
            filter: filterKeyword,
          },
        )
        if (!result.ok) {
          failed += 1
          insertDiag.run(group.id, group.first_request_id, 'failed', toolName,
            JSON.stringify({ error: result.error }), null, null, null, null, null, null, null, now)
          // 组保持 pending_diagnosis（可重试）
          continue
        }
        const isElb = group.product_key === 'slb'
        // 分类输入构造：MCP 原文走真实解析链（extractDiagnosticText 支持 JSON 诊断原文；
        // ELB 需拼接 error_message —— MCP 返回已是诊断全文，errorMessage 传空由 MCP text 承载）
        const text = extractDiagnosticText(result.text, '', isElb)
        let classified = classifyPatrolRootCause(text, rules)
        // 11-17 LLM 主路径（规则为加速/兜底）：规则命中非兜底类 = 加速路径省 LLM 调用；
        // 未命中/判能力缺口 → LLM 结构化分析全量日志（五段 + 根因枚举）。
        /** @type {{ byLlm: boolean, llmFailed: boolean, attempts: number, conclusion: string | null, directCause: string[], evidence: string[], suggestion: string | null, rootCauseL1: string | null }} */
        let llmReport = { byLlm: false, llmFailed: false, attempts: 0, conclusion: null, directCause: [], evidence: [], suggestion: null, rootCauseL1: null }
        let rootCauseSource = 'rule'
        if (classified.l1 === '其他/未归类' || classified.l1 === '诊断能力缺口') {
          const { analyzeFailureByLlm } = await import('./patrolDiagnosisLlmAnalyzer.js')
          const analysis = await analyzeFailureByLlm(result.text, {
            apiPath: String(group.api_path || ''), poolName: pool, userName: '', productKey: String(group.product_key || ''),
          })
          // 11-17 用户拍板：LLM 重试 3 次仍失败 → 视为未诊断——组保持 pending_diagnosis（可重试）
          if (analysis.llmFailed) {
            failed += 1
            insertDiag.run(group.id, group.first_request_id, 'failed', toolName,
              JSON.stringify({ error: `LLM ${analysis.attempts} 次全失败（未诊断）` }), null, null, null, null, null, null, null, now)
            continue
          }
          if (analysis.byLlm) {
            llmReport = analysis
            rootCauseSource = 'llm'
            if (analysis.rootCauseL1) {
              classified = { ...classified, l1: analysis.rootCauseL1, l2: 'LLM结构化诊断' }
            }
          }
        }
        // 五段处理建议：LLM 产物优先；无则建议生成器兜底
        let suggestion = llmReport.suggestion
        if (!suggestion) {
          const { generateDiagnosisSuggestion } = await import('./patrolDiagnosisSuggestion.js')
          suggestion = await generateDiagnosisSuggestion(text, text, classified.l1)
        }
        const directCauseJson = llmReport.directCause.length > 0 ? JSON.stringify(llmReport.directCause) : null
        const evidenceJson = llmReport.evidence.length > 0 ? JSON.stringify(llmReport.evidence) : null
        const conclusionFinal = llmReport.conclusion || text || null
        succeeded += 1
        insertDiag.run(group.id, group.first_request_id, 'success', toolName,
          result.text, conclusionFinal, classified.l1, classified.l2,
          suggestion, directCauseJson, evidenceJson, rootCauseSource, now)
        updateGroup.run(classified.l1, classified.l2, classified.productAction, now, group.id)
        // 待处理 + assignee 为空 → 填 productManager[0] 默认经办人（§2.3）
        if (classified.productAction === '待处理') {
          const key = String(group.product_key || '')
          fillDefaultAssignee.run(defaultAssigneeByProduct.get(key) || null, group.id)
        }
      }
    })())
  }
  await Promise.all(workers)
  return { diagnosed: groups.length, succeeded, failed }
}
