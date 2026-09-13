import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = process.env.SCRIPTS_DIR || path.resolve(__dirname, '..', '..', 'scripts')

/**
 * 产品中文名 → curated taxonomy 文件名映射（与 actionRecsEngine.cjs loadCuratedAll 一致）。
 */
const PRODUCT_FILE_MAP = {
  '弹性公网IP': 'eip-taxonomy-curated.json',
  '云专线': 'ct-taxonomy-curated.json',
  '虚拟私有云': 'vpc-taxonomy-curated.json',
  '弹性负载均衡': 'elb-taxonomy-curated.json',
}

const FILE_PRODUCT_MAP = Object.fromEntries(
  Object.entries(PRODUCT_FILE_MAP).map(([product, file]) => [file, product]),
)

/**
 * 行动建议 curated 分类法管理路由。
 * GET  /api/curated-taxonomy           — 列出所有产品及其分类法
 * GET  /api/curated-taxonomy/:product  — 获取某产品的分类法 JSON
 * PUT  /api/curated-taxonomy/:product  — 更新某产品的分类法 JSON
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registerCuratedTaxonomyRoutes(app) {
  /** 列出所有产品及其分类法摘要 */
  app.get(
    '/api/curated-taxonomy',
    { preHandler: requirePermission('view') },
    async () => {
      const items = Object.entries(PRODUCT_FILE_MAP).map(([product, file]) => {
        const filePath = path.join(SCRIPTS_DIR, file)
        let exists = false
        let families = 0
        let version = ''
        let mtime = null
        try {
          const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
          exists = true
          families = Array.isArray(raw.families) ? raw.families.length : 0
          version = String(raw.version || '')
          mtime = fs.statSync(filePath).mtime.toISOString()
        } catch {
          /* file not found or invalid */
        }
        return { product, file, exists, families, version, lastModified: mtime }
      })
      return { items }
    },
  )

  /** 获取某产品的分类法 JSON */
  app.get(
    '/api/curated-taxonomy/:product',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const product = decodeURIComponent(request.params.product)
      const file = PRODUCT_FILE_MAP[product]
      if (!file) {
        return reply.code(404).send({ error: `未知产品：${product}` })
      }
      const filePath = path.join(SCRIPTS_DIR, file)
      try {
        const raw = fs.readFileSync(filePath, 'utf8')
        return JSON.parse(raw)
      } catch {
        return reply.code(404).send({ error: `分类法文件不存在：${file}` })
      }
    },
  )

  /** 更新某产品的分类法 JSON */
  app.put(
    '/api/curated-taxonomy/:product',
    { preHandler: requirePermission('manageTeamSettings') },
    async (request, reply) => {
      const product = decodeURIComponent(request.params.product)
      const file = PRODUCT_FILE_MAP[product]
      if (!file) {
        return reply.code(404).send({ error: `未知产品：${product}` })
      }

      const body = request.body
      if (!body || typeof body !== 'object') {
        return reply.code(400).send({ error: '请求体必须是 JSON 对象' })
      }
      if (!Array.isArray(body.families)) {
        return reply.code(400).send({ error: 'families 字段必须是数组' })
      }

      const filePath = path.join(SCRIPTS_DIR, file)

      // 读取旧版本做备份
      let oldContent = null
      try {
        oldContent = fs.readFileSync(filePath, 'utf8')
      } catch {
        /* 文件不存在，首次创建 */
      }

      // 写入新内容（原子写入：先写 tmp 再 rename）
      const newContent = JSON.stringify(body, null, 2) + '\n'
      const tmpPath = `${filePath}.update-${process.pid}.tmp`
      try {
        fs.writeFileSync(tmpPath, newContent, 'utf8')
        fs.renameSync(tmpPath, filePath)
      } catch (err) {
        try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
        return reply.code(500).send({
          error: `写入文件失败：${err instanceof Error ? err.message : String(err)}`,
        })
      }

      const stat = fs.statSync(filePath)
      logAuditFromRequest(request, 'curated_taxonomy.update', {
        product,
        file,
        familiesCount: body.families.length,
        bytes: newContent.length,
        hadPrevious: Boolean(oldContent),
      })

      return {
        ok: true,
        product,
        file,
        families: body.families.length,
        lastModified: stat.mtime.toISOString(),
      }
    },
  )
}
