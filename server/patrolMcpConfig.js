import { storageRepository } from './storageRepository.js'

/** 产品 API 日志诊断（云网工作台 MCP）配置在 meta 表中的 key（docs/DESIGN-API巡检.md §4.2） */
export const META_KEY_PATROL_MCP_CONFIG = 'api_patrol_mcp_config_v1'

/**
 * 读取库内 MCP 诊断配置（Settings「产品API日志诊断配置」面板维护）。
 * DB 未初始化或读取失败时返回 null（回退环境变量）。
 * @returns {{ mcpEndpoint?: string; mcpToken?: string; updatedAt?: string; updatedBy?: string } | null}
 */
function readPatrolMcpConfigFromDb() {
  try {
    const raw = storageRepository.getMeta(META_KEY_PATROL_MCP_CONFIG)
    if (!raw || typeof raw !== 'object') return null
    const cfg = /** @type {Record<string, unknown>} */ (raw)
    return {
      mcpEndpoint: typeof cfg.mcpEndpoint === 'string' ? cfg.mcpEndpoint.trim() : '',
      mcpToken: typeof cfg.mcpToken === 'string' ? cfg.mcpToken.trim() : '',
      updatedAt: typeof cfg.updatedAt === 'string' ? cfg.updatedAt : undefined,
      updatedBy: typeof cfg.updatedBy === 'string' ? cfg.updatedBy : undefined,
    }
  } catch {
    return null
  }
}

/**
 * 解析链（与 LLM 配置同构）：库 > 环境变量 PATROL_MCP_ENDPOINT / PATROL_MCP_TOKEN。
 * admin/process 显式传参优先于本函数（测试覆盖用），未传时走本链。
 * @returns {{ mcpEndpoint: string, mcpToken: string }}
 */
export function resolvePatrolMcpConfig() {
  const db = readPatrolMcpConfigFromDb()
  const mcpEndpoint = db?.mcpEndpoint || (process.env.PATROL_MCP_ENDPOINT || '').trim()
  const mcpToken = db?.mcpToken || (process.env.PATROL_MCP_TOKEN || '').trim()
  return { mcpEndpoint, mcpToken }
}

/**
 * token 脱敏（≤8 位只显示 ••••，其余显示尾 4 位）。
 * @param {string | null | undefined} token
 */
export function maskPatrolMcpToken(token) {
  const t = String(token || '')
  if (!t) return ''
  return t.length <= 8 ? '••••' : `••••${t.slice(-4)}`
}

/**
 * 状态汇总（脱敏 GET /api/patrol/admin/mcp-config 用，镜像 llm.js getLlmConfigStatus）。
 * @returns {{ source: 'db' | 'env' | 'none'; mcpEndpoint: string; tokenMasked: string; tokenConfigured: boolean; updatedAt?: string; updatedBy?: string }}
 */
export function getPatrolMcpConfigStatus() {
  const db = readPatrolMcpConfigFromDb()
  if (db && db.mcpEndpoint) {
    return {
      source: 'db',
      mcpEndpoint: db.mcpEndpoint,
      tokenMasked: maskPatrolMcpToken(db.mcpToken),
      tokenConfigured: Boolean(db.mcpToken),
      updatedAt: db.updatedAt,
      updatedBy: db.updatedBy,
    }
  }
  const envEndpoint = (process.env.PATROL_MCP_ENDPOINT || '').trim()
  const envToken = (process.env.PATROL_MCP_TOKEN || '').trim()
  if (envEndpoint) {
    return {
      source: 'env',
      mcpEndpoint: envEndpoint,
      tokenMasked: maskPatrolMcpToken(envToken),
      tokenConfigured: Boolean(envToken),
    }
  }
  return { source: 'none', mcpEndpoint: '', tokenMasked: '', tokenConfigured: false }
}
