/** @typedef {import('./storage.js').AppSettings} AppSettings */

/** @typedef {{ extraLinePatterns?: string[]; extraInlineLabels?: string[] }} QuoteNoiseConfig */

/** 内置整行剔除（客服模板、元数据标签行） */
const BUILTIN_LINE_RES = [
  /^联系时间[:：]/,
  /^问题原因[:：]/,
  /^请求节点[:：]/,
  /^客户标签[:：]/,
  /^归档时间[:：]/,
  /^受理时间[:：]/,
  /^如有(?:问题|其他问题|疑问|任何疑问).*请随时联系/,
  /^如有问题随时咨询/,
  /^感谢您的(?:理解|支持|配合)/,
  /^请知悉[。.]?$/,
  /^以上(?:为|是).*(?:处理|答复|说明)/,
]

export const DEFAULT_INLINE_TRUNCATE_LABELS = [
  '联系时间',
  '问题原因',
  '请求节点',
  '客户标签',
]

/**
 * @param {string} s
 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {QuoteNoiseConfig | null | undefined} partial
 * @returns {{ extraLinePatterns: string[]; extraInlineLabels: string[] }}
 */
export function normalizeQuoteNoiseConfig(partial) {
  const extraLinePatterns = Array.isArray(partial?.extraLinePatterns)
    ? partial.extraLinePatterns.map((s) => String(s).trim()).filter(Boolean).slice(0, 50)
    : []
  const extraInlineLabels = Array.isArray(partial?.extraInlineLabels)
    ? partial.extraInlineLabels.map((s) => String(s).trim()).filter(Boolean).slice(0, 20)
    : []
  return { extraLinePatterns, extraInlineLabels }
}

/**
 * @param {string} pattern
 * @returns {RegExp | null}
 */
function compileExtraLinePattern(pattern) {
  if (!pattern) return null
  if (pattern.startsWith('regex:')) {
    try {
      return new RegExp(pattern.slice(6).trim(), 'i')
    } catch {
      return null
    }
  }
  return new RegExp(`^${escapeRegExp(pattern)}`, 'i')
}

/**
 * @param {QuoteNoiseConfig | null | undefined} noiseConfig
 */
function buildLineMatchers(noiseConfig) {
  const matchers = [...BUILTIN_LINE_RES]
  for (const p of normalizeQuoteNoiseConfig(noiseConfig).extraLinePatterns) {
    const re = compileExtraLinePattern(p)
    if (re) matchers.push(re)
  }
  return matchers
}

/**
 * @param {QuoteNoiseConfig | null | undefined} noiseConfig
 */
function buildInlineTruncateRe(noiseConfig) {
  const labels = [
    ...DEFAULT_INLINE_TRUNCATE_LABELS,
    ...normalizeQuoteNoiseConfig(noiseConfig).extraInlineLabels,
  ]
  const unique = [...new Set(labels.filter(Boolean))]
  if (!unique.length) return null
  const part = unique.map(escapeRegExp).join('|')
  return new RegExp(`(?:\\n|^)\\s*(?:${part})[:：]`, 'i')
}

/**
 * @param {string} text
 * @param {AppSettings | null | undefined} [settings]
 */
export function stripQuoteNoise(text, settings = null) {
  if (!text?.trim()) return ''

  const noiseConfig = settings?.quoteNoise
  const lineMatchers = buildLineMatchers(noiseConfig)
  const inlineRe = buildInlineTruncateRe(noiseConfig)

  let working = text.replace(/\r\n/g, '\n').trim()

  if (inlineRe) {
    const cut = working.search(inlineRe)
    if (cut > 0) working = working.slice(0, cut).trim()
  }

  const lines = working.split('\n')
  const kept = lines.filter((line) => {
    const t = line.trim()
    if (!t) return false
    return !lineMatchers.some((re) => re.test(t))
  })

  const joined = kept.join('\n').trim()
  if (joined) return joined

  return working.slice(0, 500).trim()
}

/**
 * @param {string} textarea
 * @returns {string[]}
 */
export function parseNoisePatternsFromTextarea(textarea) {
  return String(textarea || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
}
