/**
 * API 巡检 MCP 池枚举注册表（11-20 14:48 拍板：需求池分区一判定真源升级）。
 *
 * 背景（11-20 实测确证，cni.mcp.server:31788）：
 * - tools/list 可调用，log_search.inputSchema.properties.poolName 是 enum 枚举——
 *   MCP 明确列出当前支持接管的资源池清单（判定「池未接入」的数据驱动真源）；
 * - 枚举外池名调 log_search **不报错**——静默返回 {code:'0000', records:[]}，
 *   与「日志未采集」形态完全相同（曾致枚举外池被误判进分区二）；
 * - 反之「调 MCP 报错」不能证明池未接入（接入的池也会临时故障报错）。
 *
 * 读取链：内存缓存 → meta 持久缓存（24h 陈旧标记）→ 现拉 tools/list。
 * summary 端点每次调用时若缓存陈旧则 fire-and-forget 后台刷新（不阻塞响应）。
 * 测试不真连 MCP：预置 meta 缓存 + clearPatrolMcpPoolEnumCache() 复位内存态。
 */
import { resolvePatrolMcpConfig } from './patrolMcpConfig.js'
import { storageRepository } from './storageRepository.js'

/** meta 表池枚举缓存 key */
export const META_KEY_PATROL_MCP_POOL_ENUM = 'api_patrol_mcp_pool_enum_v1'

/** 缓存陈旧阈值：24h（枚举随 MCP 侧池增减漂移，页面展示获取时间，可接受滞后） */
const POOL_ENUM_STALE_MS = 24 * 60 * 60 * 1000

/** 超时（tools/list 是轻量元数据调用，秒级即可，远低于 log_search 的 300s） */
const TOOLS_LIST_TIMEOUT_MS = 15_000

/**
 * 默认 fetcher（可注入——测试与未来更换传输层用；签名与全局 fetch 一致）。
 * @type {typeof fetch}
 */
let toolsListFetcher = globalThis.fetch

/**
 * 真拉 tools/list 提取 log_search 的 poolName 枚举。
 * Streamable HTTP 传输（与 callMcpTool 同款双协议头——缺 Accept 头 400，11-09 实测）；
 * 响应可能是 application/json 或 text/event-stream（SSE 需取 data: 行拼接）。
 * @param {{ mcpEndpoint?: string, mcpToken?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ ok: true, pools: string[], fetchedAt: string } | { ok: false, error: string }>}
 */
export async function fetchPatrolMcpPoolEnum(options = {}) {
  const { mcpEndpoint, mcpToken } = options.mcpEndpoint ? options : resolvePatrolMcpConfig()
  if (!mcpEndpoint || !mcpToken) return { ok: false, error: 'MCP 端点或 Token 未配置' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? TOOLS_LIST_TIMEOUT_MS)
  try {
    const res = await toolsListFetcher(mcpEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Streamable HTTP 必需（缺头 400——11-09 实测）
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${mcpToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `patrol-enum-${Date.now()}`,
        method: 'tools/list',
        params: {},
      }),
      signal: controller.signal,
    })
    if (!res.ok) return { ok: false, error: `MCP HTTP ${res.status}` }
    let text = await res.text()
    const ct = String(res.headers.get('content-type') || '')
    if (ct.includes('text/event-stream')) {
      // SSE：取全部 data: 行拼接为 JSON（实测 tools/list 走 JSON，SSE 兼容防形态漂移）
      text = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('\n')
    }
    const parsed = JSON.parse(text)
    const tools = parsed?.result?.tools
    if (!Array.isArray(tools)) return { ok: false, error: 'tools/list 响应无 tools 数组' }
    const logSearch = tools.find((t) => t && typeof t.name === 'string' && t.name === 'log_search')
    if (!logSearch) return { ok: false, error: 'tools/list 无 log_search 工具' }
    const enumVals = logSearch?.inputSchema?.properties?.poolName?.enum
    if (!Array.isArray(enumVals) || enumVals.length === 0) return { ok: false, error: 'log_search.poolName 无枚举清单' }
    const pools = enumVals.map(String)
    const fetchedAt = new Date().toISOString()
    // 成功即写持久缓存（下次进程重启/24h 内免再拉）
    try {
      storageRepository.putMeta(META_KEY_PATROL_MCP_POOL_ENUM, { pools, fetchedAt })
      poolEnumMemCache = { pools, fetchedAt }
    } catch { /* meta 写失败不影响本次返回 */ }
    return { ok: true, pools, fetchedAt }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, error: `tools/list 超时（${options.timeoutMs ?? TOOLS_LIST_TIMEOUT_MS}ms）` }
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  } finally {
    clearTimeout(timer)
  }
}

/** 内存缓存（进程内；meta 持久缓存才是主存，内存只是免 DB 读的热路径） */
let poolEnumMemCache = null

/**
 * 读取池枚举（判定真源入口）：
 * 内存 → meta 缓存 → 都没有时现拉一次（失败降级）。
 * 24h 视为陈旧（stale=true——仍可用；调用方应 fire-and-forget 刷新）。
 * @returns {{ pools: string[] | null, fetchedAt: string | null, stale: boolean, degraded: boolean }}
 *   degraded=true 表示完全没有可用清单（判定走降级文本推断）。
 */
export function getPatrolMcpPoolEnum() {
  try {
    const cached = poolEnumMemCache || storageRepository.getMeta(META_KEY_PATROL_MCP_POOL_ENUM)
    if (cached && typeof cached === 'object' && Array.isArray(cached.pools) && cached.pools.length > 0) {
      poolEnumMemCache = cached
      const age = Date.now() - new Date(String(cached.fetchedAt || '')).getTime()
      return {
        pools: cached.pools.map(String),
        fetchedAt: String(cached.fetchedAt || ''),
        stale: !Number.isFinite(age) || age > POOL_ENUM_STALE_MS,
        degraded: false,
      }
    }
  } catch { /* meta 读失败走降级 */ }
  return { pools: null, fetchedAt: null, stale: true, degraded: true }
}

/**
 * 池是否在 MCP 枚举内（classifyGapKind 第四参素材）。
 * @param {string} poolName 组池名
 * @param {{ pools: string[] | null }} poolEnum getPatrolMcpPoolEnum() 的返回
 * @returns {boolean | null} true=在枚举内 / false=不在（分区一）/ null=清单不可达（降级判定）
 */
export function poolInMcpEnum(poolName, poolEnum) {
  if (!poolEnum || !Array.isArray(poolEnum.pools)) return null
  const name = String(poolName || '')
  return poolEnum.pools.includes(name)
}

/** 复位内存+meta 缓存（测试隔离用）。 */
export function clearPatrolMcpPoolEnumCache() {
  poolEnumMemCache = null
  try {
    storageRepository.putMeta(META_KEY_PATROL_MCP_POOL_ENUM, null)
  } catch { /* 忽略 */ }
}

/** 注入/复位 fetcher（测试 mock tools/list 用；不传恢复全局 fetch）。 */
export function setPatrolMcpPoolEnumFetcher(fetcher) {
  toolsListFetcher = fetcher || globalThis.fetch
}
