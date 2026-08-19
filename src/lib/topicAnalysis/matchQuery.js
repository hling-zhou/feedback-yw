import { getAnalysisEnabledProducts } from '../productCatalog/analysisScope.js'
import { getCatalogProducts } from '../productCatalogLoader.js'
import { normalizeIdentityText } from './customerIdentity.js'

/** 问题词近义，避免原文必须与输入 100% 连写 */
const TOKEN_ALIASES = [
  ['限速', '限流', '限制带宽', '带宽限制', '被限速', '被限制', '速率限制'],
  ['卡顿', '卡住', '卡死', '很慢', '缓慢', '延迟高'],
  ['丢包', 'packetloss'],
  ['不通', '连不上', '无法连接', '连不了'],
  ['安全组', '防火墙策略'],
  ['不足', '已满', '超限', '不够'],
]

const TITLE_SUFFIXES = ['问题分析', '专题分析', '分析报告', '情况分析', '分析', '专题', '报告', '问题']
const STOP_TOKENS = new Set(['问题', '分析', '专题', '报告', '情况', '相关', '反馈', '工单', '用户', '系统', '看看', '一下', '本次', '这个'])
const CONJUNCTION_RE = /[与及和或、,，]/
const AND_LAYER_RE = /[；;]/

function uniqueNormalized(values) {
  const seen = new Set()
  const out = []
  for (const value of values) {
    const raw = String(value || '').trim()
    const token = normalizeIdentityText(raw)
    if (!token || token.length < 2 || seen.has(token) || STOP_TOKENS.has(token)) continue
    seen.add(token)
    out.push(raw)
  }
  return out
}

function stripTitleSuffixes(text) {
  let rest = String(text || '')
  const suffixes = [...TITLE_SUFFIXES].sort((a, b) => b.length - a.length)
  for (let i = 0; i < 6; i += 1) {
    const suffix = suffixes.find((item) => rest.endsWith(item) && rest.length - item.length >= 2)
    if (!suffix) break
    rest = rest.slice(0, -suffix.length)
  }
  return rest
}

/**
 * 产品目录中的名称与别名，长的优先，便于从「弹性公网IP带宽限速」里抽出产品。
 */
export function topicProductHints() {
  const names = []
  for (const product of getAnalysisEnabledProducts(getCatalogProducts())) {
    names.push(product.name, product.key)
    for (const spec of product.specs || []) {
      names.push(spec.name, ...(spec.match || []))
    }
  }
  return uniqueNormalized(names).sort((a, b) => b.length - a.length)
}

function tokenizeSegment(segment, phraseHints) {
  let rest = String(segment || '')
  const tokens = []
  for (const hint of phraseHints) {
    const normalizedHint = normalizeIdentityText(hint)
    if (normalizedHint.length < 2 || !rest.includes(normalizedHint) || STOP_TOKENS.has(normalizedHint)) continue
    tokens.push(hint)
    rest = rest.split(normalizedHint).join(' ')
  }
  const parts = rest.split(/[^a-z0-9\u4e00-\u9fff]+/).filter((part) => part.length >= 2)
  for (const part of parts) {
    if (/[\u4e00-\u9fff]/.test(part) && part.length >= 4) {
      let index = 0
      while (index < part.length) {
        const left = part.length - index
        if (left <= 3) {
          tokens.push(part.slice(index))
          break
        }
        tokens.push(part.slice(index, index + 2))
        index += 2
      }
    } else if (part.length >= 2) {
      tokens.push(part)
    }
  }
  return uniqueNormalized(tokens)
}

function clauseContains(outer, inner) {
  return inner.every((term) => outer.includes(term))
}

/** 去掉被更短子句覆盖的析取，避免 CNF 膨胀 */
function simplifyCnf(clauses) {
  const normalized = clauses.map((clause) => uniqueNormalized(clause)).filter((clause) => clause.length)
  const byLength = [...normalized].sort((a, b) => a.length - b.length || a.join('').localeCompare(b.join('')))
  const kept = []
  for (const clause of byLength) {
    if (kept.some((smaller) => clauseContains(clause, smaller))) continue
    kept.push(clause)
  }
  return kept
}

/**
 * DNF（组内且、组间或）转 CNF（层内或、层间且）。
 * (配额∧申请) ∨ (配额∧不足) → 配额 ∧ (申请∨不足)
 */
export function dnfGroupsToLayers(andGroups) {
  const groups = (andGroups || []).map((group) => uniqueNormalized(group)).filter((group) => group.length)
  if (!groups.length) return []
  let cnf = groups[0].map((term) => [term])
  for (const group of groups.slice(1)) {
    const next = []
    for (const clause of cnf) {
      for (const term of group) {
        next.push([...clause, term])
      }
    }
    cnf = simplifyCnf(next)
  }
  return simplifyCnf(cnf).map((terms) => ({ terms }))
}

export function normalizeMatchLayers(layers) {
  const out = []
  const aliases = phraseHints()
  for (const layer of layers || []) {
    const terms = uniqueNormalized(Array.isArray(layer?.terms) ? layer.terms : layer)
    if (!terms.length) continue
    if (terms.length === 1 && /^[\u4e00-\u9fff]{4}$/.test(terms[0])) {
      const bits = tokenizeSegment(terms[0], aliases)
      if (bits.length > 1) {
        bits.forEach((term) => out.push({ terms: [term] }))
        continue
      }
    }
    out.push({ terms })
  }
  return out
}

export function serializeTopicMatchLayers(layers) {
  return normalizeMatchLayers(layers).map((layer) => layer.terms.join('、')).join('；')
}

export function formatTopicMatchLayers(layers) {
  const normalized = normalizeMatchLayers(layers)
  if (!normalized.length) return ''
  return normalized.map((layer) => {
    if (layer.terms.length === 1) return `「${layer.terms[0]}」`
    return `（${layer.terms.map((term) => `「${term}」`).join(' 或 ')}）`
  }).join(' 且 ')
}

function emptyParse() {
  return { needle: '', productName: '', productTokens: [], tokens: [], groups: [], layers: [], problemText: '' }
}

function phraseHints() {
  return uniqueNormalized(TOKEN_ALIASES.flat()).sort((a, b) => b.length - a.length)
}

function parseExplicitAndLayers(rest, hints) {
  return rest.split(AND_LAYER_RE)
    .map((part) => uniqueNormalized(
      part.split(CONJUNCTION_RE).flatMap((segment) => tokenizeSegment(segment, hints)),
    ))
    .filter((terms) => terms.length)
    .map((terms) => ({ terms }))
}

/**
 * 将用户输入拆成产品 + 分层关键词。
 * 层内为或，层与层为且。标题里的「与/或」先当可替代说法，再收成这种分层。
 * @param {string} query
 * @param {{ productHints?: string[] }} [options]
 */
export function parseTopicSearchQuery(query, options = {}) {
  const needle = normalizeIdentityText(query)
  if (!needle) return emptyParse()

  const hints = options.productHints || topicProductHints()
  const productTokens = []
  let rest = needle
  for (const hint of hints) {
    const normalizedHint = normalizeIdentityText(hint)
    if (normalizedHint.length < 2 || !rest.includes(normalizedHint)) continue
    productTokens.push(hint)
    rest = rest.split(normalizedHint).join('')
  }

  rest = stripTitleSuffixes(rest)
  const aliases = phraseHints()
  const productLayer = uniqueNormalized(productTokens).length
    ? [{ terms: uniqueNormalized(productTokens) }]
    : []

  if (AND_LAYER_RE.test(query) || AND_LAYER_RE.test(rest)) {
    const layers = [...productLayer, ...parseExplicitAndLayers(rest, aliases)]
    const tokens = uniqueNormalized(layers.flatMap((layer) => layer.terms))
    return {
      needle,
      productName: productTokens[0] || '',
      productTokens: uniqueNormalized(productTokens),
      tokens,
      groups: layers.map((layer) => layer.terms),
      layers,
      problemText: rest.replace(AND_LAYER_RE, '与'),
    }
  }

  const segments = rest.split(CONJUNCTION_RE).map((item) => item.trim()).filter((item) => item.length >= 2)
  const groups = (segments.length ? segments : (rest ? [rest] : []))
    .map((segment) => tokenizeSegment(segment, aliases))
    .filter((group) => group.length)
  const layers = [...productLayer, ...dnfGroupsToLayers(groups)]
  const tokens = uniqueNormalized(layers.flatMap((layer) => layer.terms))

  return {
    needle,
    productName: productTokens[0] || '',
    productTokens: uniqueNormalized(productTokens),
    tokens,
    groups,
    layers,
    problemText: rest,
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

function layerMatches(text, layer) {
  const terms = (layer?.terms || []).filter((token) => token.length >= 2)
  if (!terms.length) return false
  return terms.some((token) => blobHasToken(text, token))
}

/**
 * 整句包含，或分层条件成立：每一层至少一个词命中，层与层全部成立。
 * @param {string} blob
 * @param {ReturnType<typeof parseTopicSearchQuery> | string} query
 */
export function blobMatchesTopicQuery(blob, query) {
  const parsed = typeof query === 'string' ? parseTopicSearchQuery(query) : query
  const text = normalizeIdentityText(blob)
  if (!parsed?.needle && !parsed?.layers?.length) return false
  if (!text) return false
  if (parsed.needle && text.includes(parsed.needle)) return true
  if (parsed.problemText && parsed.problemText.length >= 4 && text.includes(parsed.problemText)) return true

  const layers = normalizeMatchLayers(parsed.layers)
  if (layers.length) return layers.every((layer) => layerMatches(text, layer))

  const productTokens = (parsed.productTokens || []).filter((token) => token.length >= 2)
  if (productTokens.length && !productTokens.every((token) => blobHasToken(text, token))) return false
  const tokens = (parsed.tokens || []).filter((token) => token.length >= 2 && !productTokens.includes(token))
  if (tokens.length) return tokens.some((token) => blobHasToken(text, token))
  return productTokens.length > 0
}

/**
 * 已确认的分层优先；带分号的 matchQuery 次之，再回退到原标题。
 * @param {{ matchLayers?: object[], matchQuery?: string, query?: string, problemKey?: string }} topic
 */
export function parseTopicMatchInput(topic) {
  if (Array.isArray(topic?.matchLayers) && topic.matchLayers.length) {
    const layers = normalizeMatchLayers(topic.matchLayers)
    const serialized = serializeTopicMatchLayers(layers)
    return {
      needle: normalizeIdentityText(serialized || topic.query || topic.matchQuery || ''),
      productName: '',
      productTokens: [],
      tokens: uniqueNormalized(layers.flatMap((layer) => layer.terms)),
      groups: layers.map((layer) => layer.terms),
      layers,
      problemText: '',
    }
  }
  const structured = String(topic?.matchQuery || '')
  if (AND_LAYER_RE.test(structured)) return parseTopicSearchQuery(structured)
  return parseTopicSearchQuery(topic?.query || topic?.matchQuery || topic?.problemKey || '')
}
