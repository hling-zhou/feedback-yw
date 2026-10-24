/**
 * MCP Server 入口 — SSE 传输模式。
 *
 * 启动方式：
 *   MCP_TRANSPORT=sse MCP_PORT=3002 node server/mcp-server.mjs
 *
 * Agent 连接方式：
 *   SSE URL: http://<server-host>:3002/sse
 *   认证: Authorization: Bearer <api-key>
 *
 * 架构：
 *   - 独立 Node 进程，监听独立端口（默认 3002）
 *   - 直接 import Repository 层访问数据，不经 Fastify 路由
 *   - API Key 认证 + mcp:read / mcp:full scope 校验
 *   - 复用 ticketAnalysisDesensitize.js 脱敏逻辑
 */

import './loadEnv.js'
import http from 'node:http'
import { getDb } from './db.js'
import { storageRepository } from './storageRepository.js'
import { MCP_TOOLS } from './mcp/tools.js'
import { authenticateMcpRequest, extractBearerToken } from './mcp/auth.js'

const PORT = Number(process.env.MCP_PORT || 3002)
const HOST = process.env.MCP_HOST || '0.0.0.0'

// 确保 DB 初始化
getDb()
await storageRepository.init()

/**
 * JSON-RPC 2.0 消息处理。
 * @param {Record<string, unknown>} message
 * @param {string} token
 * @returns {Record<string, unknown>}
 */
function handleJsonRpc(message, token) {
  const id = message.id ?? null
  const method = String(message.method || '')

  // 认证（tools/list 和 tools/call 都需要认证）
  const auth = authenticateMcpRequest(token)
  if (!auth.ok) {
    return {
      jsonrpc: '2.0',
      id,
      error: { code: auth.status === 401 ? -32001 : -32003, message: auth.error },
    }
  }

  // initialize — MCP 协议握手
  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: 'feedback-insights-mcp',
          version: '1.0.0',
        },
      },
    }
  }

  // notifications/initialized — 握手完成通知（无响应）
  if (method === 'notifications/initialized') {
    return null // 通知不需要响应
  }

  // tools/list — 列出所有可用 Tool
  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    }
  }

  // tools/call — 执行 Tool
  if (method === 'tools/call') {
    const params = /** @type {{ name?: string, arguments?: Record<string, unknown> }} */ (message.params || {})
    const toolName = params.name
    const toolArgs = params.arguments || {}

    const tool = MCP_TOOLS.find((t) => t.name === toolName)
    if (!tool) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `未知 Tool: ${toolName}` },
      }
    }

    // 执行 Tool handler
    return (async () => {
      try {
        const result = await tool.handler(toolArgs, auth.apiKey)
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2),
              },
            ],
          },
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`[MCP] Tool "${toolName}" 执行失败:`, errorMsg)
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: `Tool 执行失败: ${errorMsg}` },
        }
      }
    })()
  }

  // ping
  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `未知方法: ${method}` },
  }
}

/**
 * 处理 SSE 连接。
 * Agent 通过 GET /sse 建立 SSE 连接，通过 POST /messages 发送 JSON-RPC 请求。
 *
 * MCP SSE 传输协议：
 * - GET /sse → 建立 SSE 长连接，Server 返回 endpoint URI
 * - POST /messages?sessionId=xxx → Agent 发送 JSON-RPC 请求
 * - SSE 推送 → Server 通过 SSE 通道返回 JSON-RPC 响应
 */
const sessions = new Map()

function generateSessionId() {
  return `mcp_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`)

  // GET /sse — 建立 SSE 连接
  if (req.method === 'GET' && url.pathname === '/sse') {
    const token = extractBearerToken(req)
    const auth = authenticateMcpRequest(token)
    if (!auth.ok) {
      res.writeHead(auth.status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: auth.error }))
      return
    }

    const sessionId = generateSessionId()
    const messageQueue = []
    sessions.set(sessionId, { messageQueue, apiKey: auth.apiKey })

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    // 发送 endpoint 事件（告诉 Agent 往哪发消息）
    res.write(`event: endpoint\ndata: /messages?sessionId=${sessionId}\n\n`)

    // 定时心跳
    const heartbeat = setInterval(() => {
      try {
        res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`)
      } catch {
        clearInterval(heartbeat)
      }
    }, 30000)

    // 处理消息队列
    const flushQueue = () => {
      while (messageQueue.length > 0) {
        const msg = messageQueue.shift()
        try {
          res.write(`event: message\ndata: ${JSON.stringify(msg)}\n\n`)
        } catch {
          // 连接已断开
          messageQueue.unshift(msg)
          break
        }
      }
    }

    const queueInterval = setInterval(flushQueue, 100)

    req.on('close', () => {
      clearInterval(heartbeat)
      clearInterval(queueInterval)
      sessions.delete(sessionId)
    })

    return
  }

  // POST /messages — 接收 JSON-RPC 请求
  if (req.method === 'POST' && url.pathname === '/messages') {
    const sessionId = url.searchParams.get('sessionId')
    if (!sessionId || !sessions.has(sessionId)) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: '无效或缺失 sessionId' }))
      return
    }

    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
      // 防止大请求体攻击
      if (body.length > 1024 * 1024) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: '请求体过大' }))
        req.destroy()
      }
    })

    req.on('end', () => {
      try {
        const message = JSON.parse(body)
        const session = sessions.get(sessionId)
        if (!session) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: '会话已失效' }))
          return
        }

        // 用会话建立时的 API Key 处理
        const token = extractBearerToken(req)
        // POST 请求也可以带新的 token，优先用 POST 的；否则用会话的
        const apiKey = token ? authenticateMcpRequest(token) : null
        const effectiveToken = apiKey?.ok
          ? token
          : `fi_live_session_${session.apiKey.id}` // 用会话的 apiKey

        // 异步处理消息
        Promise.resolve()
          .then(async () => {
            // 如果 POST 带了新 token，用它认证；否则用会话的 apiKey
            let result
            if (apiKey?.ok) {
              result = handleJsonRpc(message, token)
            } else {
              // 用会话存储的 apiKey 重新构建 token 验证——
              // 实际上会话已认证过，直接用会话的 apiKey
              result = handleJsonRpcWithApiKey(message, session.apiKey)
            }

            if (result === null) {
              // 通知类消息，不需要响应
              return
            }

            if (result instanceof Promise) {
              result = await result
            }
            if (result !== null) {
              session.messageQueue.push(result)
            }
          })
          .catch((err) => {
            console.error('[MCP] 消息处理错误:', err)
            session.messageQueue.push({
              jsonrpc: '2.0',
              id: message.id ?? null,
              error: { code: -32603, message: `内部错误: ${err instanceof Error ? err.message : String(err)}` },
            })
          })

        res.writeHead(202, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ accepted: true }))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: '无效的 JSON' }))
      }
    })

    return
  }

  // GET /health — 健康检查
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', tools: MCP_TOOLS.map((t) => t.name) }))
    return
  }

  // CORS 预检
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    })
    res.end()
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not Found' }))
})

/**
 * 直接用已认证的 apiKey 处理 JSON-RPC 消息（POST /messages 无新 token 时使用）。
 * @param {Record<string, unknown>} message
 * @param {import('./apiKeyRepository.js').ApiKeyRecord} apiKey
 */
function handleJsonRpcWithApiKey(message, apiKey) {
  const id = message.id ?? null
  const method = String(message.method || '')

  if (method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'feedback-insights-mcp', version: '1.0.0' },
      },
    }
  }

  if (method === 'notifications/initialized') {
    return null
  }

  if (method === 'tools/list') {
    return {
      jsonrpc: '2.0',
      id,
      result: {
        tools: MCP_TOOLS.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
    }
  }

  if (method === 'tools/call') {
    const params = /** @type {{ name?: string, arguments?: Record<string, unknown> }} */ (message.params || {})
    const toolName = params.name
    const toolArgs = params.arguments || {}

    const tool = MCP_TOOLS.find((t) => t.name === toolName)
    if (!tool) {
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `未知 Tool: ${toolName}` },
      }
    }

    return (async () => {
      try {
        const result = await tool.handler(toolArgs, apiKey)
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error(`[MCP] Tool "${toolName}" 执行失败:`, errorMsg)
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: `Tool 执行失败: ${errorMsg}` },
        }
      }
    })()
  }

  if (method === 'ping') {
    return { jsonrpc: '2.0', id, result: {} }
  }

  return {
    jsonrpc: '2.0',
    id,
    error: { code: -32601, message: `未知方法: ${method}` },
  }
}

server.listen(PORT, HOST, () => {
  console.log(`[MCP Server] SSE 监听 http://${HOST}:${PORT}`)
  console.log(`[MCP Server] SSE 端点: http://${HOST}:${PORT}/sse`)
  console.log(`[MCP Server] 消息端点: http://${HOST}:${PORT}/messages`)
  console.log(`[MCP Server] 健康检查: http://${HOST}:${PORT}/health`)
  console.log(`[MCP Server] 已注册 ${MCP_TOOLS.length} 个 Tool: ${MCP_TOOLS.map((t) => t.name).join(', ')}`)
})
