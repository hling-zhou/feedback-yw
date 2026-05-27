/**
 * @deprecated P1-3 起 LLM 由 Fastify `POST /api/llm/chat` 代理；本文件仅作历史参考，不再挂入 Vite。
 * LLM 代理：按请求头 X-LLM-Base-URL 转发，避免 Vite http-proxy router 未生效时误连 OpenAI。
 */

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/** @param {import('http').IncomingMessage} req */
function resolveBaseUrl(req) {
  const raw =
    req.headers['x-llm-base-url'] ||
    req.headers['X-LLM-Base-URL'] ||
    ''
  return String(raw)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
}

function llmProxyMiddleware() {
  return async (req, res, next) => {
    const url = req.url || ''
    if (!url.startsWith('/api/llm-proxy')) return next()

    const base = resolveBaseUrl(req)
    if (!base) {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          error: {
            message: '缺少 API 基址（X-LLM-Base-URL）',
            hint: '请在设置中填写 API 地址（如 https://api.siliconflow.cn/v1）并保存后重试',
          },
        }),
      )
      return
    }

    const path = url.replace(/^\/api\/llm-proxy/, '') || '/chat/completions'
    const targetUrl = `${base}${path}`

    try {
      const body =
        req.method && req.method !== 'GET' && req.method !== 'HEAD'
          ? await readRequestBody(req)
          : undefined

      const forward = await fetch(targetUrl, {
        method: req.method || 'POST',
        headers: {
          'Content-Type': req.headers['content-type'] || 'application/json',
          Authorization: req.headers.authorization || '',
        },
        body: body?.length ? body : undefined,
      })

      const text = await forward.text()
      res.statusCode = forward.status
      res.setHeader('Content-Type', forward.headers.get('content-type') || 'application/json')
      res.end(text)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const isOpenAiTimeout =
        /ETIMEDOUT|ECONNREFUSED/.test(msg) && /openai\.com/i.test(base)
      res.statusCode = 502
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(
        JSON.stringify({
          error: {
            message: `代理连接失败: ${msg}`,
            target: targetUrl,
            hint: isOpenAiTimeout
              ? 'OpenAI 在国内常无法直连，请改用硅基流动（https://api.siliconflow.cn/v1）并在设置中选择对应预设'
              : '请检查 API 地址、网络与 Key 是否正确',
          },
        }),
      )
    }
  }
}

export function llmProxyPlugin() {
  const attach = (server) => {
    server.middlewares.use(llmProxyMiddleware())
  }
  return {
    name: 'vite-llm-proxy',
    configureServer: attach,
    configurePreviewServer: attach,
  }
}
