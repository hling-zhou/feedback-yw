/**
 * keywords 自动建议（F3，DESIGN §5.2）：纯本地 n-gram 候选 + 跨 issue 稀有度加权。
 * 建议不代判：只出 chips，人工逐个点击采纳，绝不自动写库。
 *
 * LLM 增强路径由调用方决定（可用时单次调用提取，失败静默回退本模块）。
 */

/** 通用停用词：低区分度的功能词与高频虚词（不进 keywords 建议） */
const STOPWORDS = new Set([
  '问题', '反馈', '客户', '用户', '产品', '系统', '平台', '控制台', '无法', '不能',
  '没有', '出现', '发生', '使用', '进行', '操作', '相关', '以及', '但是', '之后',
  '以后', '可以', '应该', '需要', '已经', '还是', '导致', '影响', '显示', '提示',
  '一下', '一直', '比较', '非常', '特别', '其他', '他们', '我们', '这个', '那个',
  '失败', '异常', '报错', '错误', 'not', 'the', 'and',
])

/** 单个建议词长度区间（中文有效词 2-6 字） */
const MIN_LEN = 2
const MAX_LEN = 6

/**
 * @param {string} text
 * @returns {string[]}
 */
function splitSegments(text) {
  return String(text || '')
    .split(/[，。；、！？\n\r\t,;.!?{}\[\]()（）【】《》"'\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 中文 n-gram 切分（2-6 字滑窗，词边界按段）。
 * @param {string} segment
 */
function ngrams(segment) {
  /** @type {string[]} */
  const out = []
  const len = segment.length
  for (let n = MIN_LEN; n <= Math.min(MAX_LEN, len); n += 1) {
    for (let i = 0; i + n <= len; i += 1) {
      out.push(segment.slice(i, i + n))
    }
  }
  return out
}

/**
 * 生成 keywords 建议候选。
 *
 * @param {Object} params
 * @param {string} params.summary - 问题描述（主语料）
 * @param {string[]} [params.evidenceTexts] - 代表证据摘要（辅助语料）
 * @param {string[]} [params.existingKeywords] - 已有 keywords（去重）
 * @param {string[][]} [params.otherIssuesKeywords] - 其他 issue 的 keywords（稀有度加权：常见于别处的词降权）
 * @param {number} [params.limit] - 返回条数（默认 5）
 * @returns {string[]}
 */
export function suggestObservationKeywords({
  summary,
  evidenceTexts = [],
  existingKeywords = [],
  otherIssuesKeywords = [],
  limit = 5,
}) {
  const corpus = [summary, ...evidenceTexts].filter(Boolean).join('\n')
  const segments = splitSegments(corpus)
  if (!segments.length) return []

  const existing = new Set(existingKeywords.map((k) => String(k).trim()).filter(Boolean))
  /** @type {Map<string, { count: number, corpusHits: number, len: number }>} */
  const stats = new Map()

  for (const segment of segments) {
    const grams = ngrams(segment)
    for (const gram of grams) {
      if (STOPWORDS.has(gram)) continue
      if (existing.has(gram)) continue
      const prev = stats.get(gram)
      if (prev) prev.count += 1
      else stats.set(gram, { count: 1, corpusHits: 1, len: gram.length })
    }
  }

  // 稀有度：出现在多个其他 issue keywords 里的词降权（通用词）
  const foreignDocFreq = new Map()
  for (const kws of otherIssuesKeywords || []) {
    for (const kw of kws || []) {
      const k = String(kw).trim()
      if (k) foreignDocFreq.set(k, (foreignDocFreq.get(k) || 0) + 1)
    }
  }

  // 评分：长度（长词区分度高）+ 频次 + 稀有度
  const scored = [...stats.entries()].map(([gram, s]) => {
    const rarity = 1 / (1 + (foreignDocFreq.get(gram) || 0))
    const lengthWeight = 1 + (s.len - MIN_LEN) * 0.35
    return { gram, score: s.count * lengthWeight * rarity }
  })
  scored.sort((a, b) => b.score - a.score)

  // 抑制子串：高分长词已覆盖的子词剔除（如「退订入口」覆盖「退订」「入口」）
  /** @type {string[]} */
  const picked = []
  for (const { gram } of scored) {
    if (picked.length >= limit) break
    if (picked.some((p) => p.includes(gram) || gram.includes(p))) continue
    picked.push(gram)
  }
  return picked
}
