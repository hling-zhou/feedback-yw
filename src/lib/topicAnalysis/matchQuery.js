import { getCatalogProducts } from '../productCatalogLoader.js'
import { normalizeIdentityText } from './customerIdentity.js'

/** 问题词近义，避免原文必须与输入 100% 连写 */
const TOKEN_ALIASES = [
  ['限速', '限流', '限制带宽', '带宽限制', '被限速', '被限制', '速率限制'],
  ['卡顿', '卡住', '卡死', '很慢', '缓慢', '延迟高'],
  ['丢包', 'packetloss'],
  ['不通', '连不上', '无法连接', '连不了'],
  ['安全组', '防火墙策略'],
]

function uniqueNormalized(values) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const token = normalizeIdentityText(value)
    if (!token || token.length < 2 || seen.has(token)) continue
    seen.add(token)
    out.push(token)
  }
  return out
}

/**
 * 产品目录中的名称与别名，长的优先，便于从「弹性公网IP带宽限速」里抽出产品。
 */
export function topicProductHints() {
  const names = []
  for (const product of getCatalogProducts() || []) {
    names.push(product.name, product.key)
    for (const spec of product.specs || []) {
      names.push(spec.name, ...(spec.match || []))
    }
  }
  return uniqueNormalized(names).sort((a, b) => b.length - a.length)
}

/**
 * 将用户输入拆成产品 + 问题片段，供包含匹配（允许中间夹字）。
 * @param {string} query
 * @param {{ productHints?: string[] }} [options]
 */
export function parseTopicSearchQuery(query, options = {}) {
  const needle = normalizeIdentityText(query)
  if (!needle) {
    return { needle: '', productName: '', productTokens: [], tokens: [] }
  }

  const hints = options.productHints || topicProductHints()
  const productTokens = []
  let rest = needle
  for (const hint of hints) {
    if (hint.length < 2 || !rest.includes(hint)) continue
    productTokens.push(hint)
    rest = rest.split(hint).join('')
  }

  const problemTokens = []
  const phraseHints = uniqueNormalized(TOKEN_ALIASES.flat()).sort((a, b) => b.length - a.length)
  for (const hint of phraseHints) {
    if (hint.length < 2 || !rest.includes(hint)) continue
    problemTokens.push(hint)
    rest = rest.split(hint).join('')
  }

  const parts = rest.split(/[^a-z0-9\u4e00-\u9fff]+/).filter((part) => part.length >= 2)
  for (const part of (parts.length ? parts : (rest ? [rest] : []))) {
    if (/[\u4e00-\u9fff]/.test(part) && part.length >= 4) {
      let index = 0
      while (index < part.length) {
        const left = part.length - index
        if (left <= 3) {
          problemTokens.push(part.slice(index))
          break
        }
        problemTokens.push(part.slice(index, index + 2))
        index += 2
      }
    } else if (part.length >= 2) {
      problemTokens.push(part)
    }
  }

  return {
    needle,
    productName: productTokens[0] || '',
    productTokens: uniqueNormalized(productTokens),
    tokens: uniqueNormalized([...productTokens, ...problemTokens]),
  }
}

function aliasGroupFor(token) {
  const normalized = normalizeIdentityText(token)
  return TOKEN_ALIASES.find((group) => group.some((item) => normalizeIdentityText(item) === normalized)) || null
}

export function blobHasToken(blob, token) {
  const text = normalizeIdentityText(blob)
  const needle = normalizeIdentityText(token)
  if (!text || !needle) return false
  if (text.includes(needle)) return true
  const group = aliasGroupFor(needle)
  if (!group) return false
  return group.some((item) => text.includes(normalizeIdentityText(item)))
}

/**
 * 整句包含，或产品/问题片段都出现（不必连写）。
 * @param {string} blob
 * @param {ReturnType<typeof parseTopicSearchQuery> | string} query
 */
export function blobMatchesTopicQuery(blob, query) {
  const parsed = typeof query === 'string' ? parseTopicSearchQuery(query) : query
  const text = normalizeIdentityText(blob)
  if (!parsed?.needle || !text) return false
  if (text.includes(parsed.needle)) return true
  const tokens = (parsed.tokens || []).filter((token) => token.length >= 2)
  if (tokens.length < 2) return tokens.length === 1 ? blobHasToken(text, tokens[0]) : false
  return tokens.every((token) => blobHasToken(text, token))
}
