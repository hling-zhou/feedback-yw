/** 中文/英文停用词（轻量） */
const STOP_WORDS = new Set([
  '的',
  '了',
  '在',
  '是',
  '我',
  '有',
  '和',
  '就',
  '不',
  '人',
  '都',
  '一',
  '一个',
  '上',
  '也',
  '很',
  '到',
  '说',
  '要',
  '去',
  '你',
  '会',
  '着',
  '没有',
  '看',
  '好',
  '自己',
  '这',
  '那',
  '为',
  '与',
  '及',
  '等',
  '中',
  '对',
  '请',
  '帮忙',
  '进行',
  '问题',
  '用户',
  '客户',
  'the',
  'and',
  'for',
  'with',
])

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizePainPointText(text) {
  const normalized = (text || '')
    .toLowerCase()
    .replace(/[^\u4e00-\u9fa5a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!normalized) return []

  /** @type {string[]} */
  const tokens = []
  const zhParts = normalized.match(/[\u4e00-\u9fa5]+|[a-z0-9]+/g) || []

  for (const part of zhParts) {
    if (/^[a-z0-9]+$/.test(part)) {
      if (part.length >= 2 && !STOP_WORDS.has(part)) tokens.push(part)
      continue
    }
    // unigram：2+ 字中文片段
    for (let i = 0; i < part.length - 1; i += 1) {
      const uni = part.slice(i, i + 2)
      if (uni.length >= 2 && !STOP_WORDS.has(uni)) tokens.push(uni)
    }
    // 2-gram 滑动
    for (let i = 0; i < part.length - 1; i += 1) {
      const bi = part.slice(i, i + 2)
      if (bi.length === 2 && !STOP_WORDS.has(bi)) tokens.push(bi)
    }
  }

  return [...new Set(tokens)]
}

/**
 * @param {string} text
 * @returns {Set<string>}
 */
export function tokenSetFromPainPoint(text) {
  return new Set(tokenizePainPointText(text))
}

/**
 * @param {Set<string>} a
 * @param {Set<string>} b
 */
export function jaccardSimilarity(a, b) {
  if (!a.size && !b.size) return 1
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter += 1
  return inter / (a.size + b.size - inter)
}
