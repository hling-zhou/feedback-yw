/**
 * API 巡检诊断任务（docs/DESIGN-API巡检.md §4.2）。
 * 服务端轻量 MCP Client（JSON-RPC over HTTP → cni.api.mcp:31788/mcp）。
 * 流程：取当日该池未诊断组（pending_diagnosis）→ 并发 worker（默认 3）逐组调 log_search
 * （仅组首条 requestId）→ diagnoses 状态机（pending/success/failed）→ 回填 groups
 * root_cause_l1/l2 + product_action_status（根因映射值）。
 * 失败组保持 pending_diagnosis 可重试；超时/5xx/连接失败 → failed。
 */

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_CONCURRENCY = 3
const DEFAULT_TOOL_NAME = 'log_search'

/**
 * MCP tools/call 单次调用。
 * @param {{ mcpEndpoint: string, mcpToken: string, toolName?: string, timeoutMs?: number }} options
 * @param {{ requestId: string }} args
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
        accept: 'application/json',
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
    const content = /** @type {{ result?: { content?: Array<{ type: string, text?: string }> } }} */ (payload)?.result?.content
    if (Array.isArray(content)) {
      const text = content
        .filter((c) => c.type === 'text' && typeof c.text === 'string')
        .map((c) => /** @type {{text: string}} */ (c).text)
        .join('\n')
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
 * 运行某日某池的诊断任务：pending_diagnosis 组 → MCP → 分类回填。
 * @param {{ date: string, pool: string, mcpEndpoint: string, mcpToken: string,
 *   toolName?: string, timeoutMs?: number, concurrency?: number }} options
 * @returns {Promise<{ diagnosed: number, succeeded: number, failed: number }>}
 */
export async function runPatrolDiagnose(options) {
  const { getDb } = await import('./db.js')
  const { classifyPatrolRootCause, extractDiagnosticText } = await import('./patrolRootCauseClassifier.js')
  const { readPatrolRootCauseRules } = await import('./patrolRepository.js')
  const db = getDb()
  const {
    date, pool, mcpEndpoint, mcpToken,
    toolName = DEFAULT_TOOL_NAME,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    concurrency = DEFAULT_CONCURRENCY,
  } = options

  const groups = /** @type {Array<{ id: number, first_request_id: string, api_path: string, product_key: string | null }>} */ (
    db.prepare(`
      SELECT id, first_request_id, api_path, product_key
      FROM api_patrol_failure_groups
      WHERE group_date=? AND pool_name=? AND product_action_status='pending_diagnosis'
      ORDER BY first_request_time
    `).all(date, pool)
  )
  if (groups.length === 0) return { diagnosed: 0, succeeded: 0, failed: 0 }

  const rules = readPatrolRootCauseRules()
  const now = new Date().toISOString()

  const insertDiag = db.prepare(`
    INSERT INTO api_patrol_diagnoses
      (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion,
       root_cause_l1, root_cause_l2, diagnosed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        // 只诊断组首条 requestId（需求原文）
        const result = await callMcpTool(
          { mcpEndpoint, mcpToken, toolName, timeoutMs },
          { requestId: group.first_request_id },
        )
        if (!result.ok) {
          failed += 1
          insertDiag.run(group.id, group.first_request_id, 'failed', toolName,
            JSON.stringify({ error: result.error }), null, null, null, now)
          // 组保持 pending_diagnosis（可重试）
          continue
        }
        const isElb = group.product_key === 'slb'
        // 分类输入构造：MCP 原文走真实解析链（extractDiagnosticText 支持 JSON 诊断原文；
        // ELB 需拼接 error_message —— MCP 返回已是诊断全文，errorMessage 传空由 MCP text 承载）
        const text = extractDiagnosticText(result.text, '', isElb)
        const classified = classifyPatrolRootCause(text, rules)
        succeeded += 1
        insertDiag.run(group.id, group.first_request_id, 'success', toolName,
          result.text, text || null, classified.l1, classified.l2, now)
        updateGroup.run(classified.l1, classified.l2, classified.productAction, now, group.id)
      }
    })())
  }
  await Promise.all(workers)
  return { diagnosed: groups.length, succeeded, failed }
}
