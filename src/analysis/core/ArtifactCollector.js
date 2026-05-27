/**
 * 分析过程产物收集（NFR-R-021 精简模式默认）
 */

const EXCERPT_MAX = 200

/**
 * @param {string} text
 */
export async function hashText(text) {
  const data = new TextEncoder().encode(text || '')
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', data)
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
  return `len:${(text || '').length}`
}

/**
 * @param {string} text
 * @param {number} [maxLen]
 */
export function excerptText(text, maxLen = EXCERPT_MAX) {
  const s = (text || '').replace(/\s+/g, ' ').trim()
  if (s.length <= maxLen) return s
  return `${s.slice(0, maxLen)}…`
}

export class ArtifactCollector {
  /**
   * @param {string} runId
   * @param {boolean} [debugMode]
   */
  constructor(runId, debugMode = false) {
    this.runId = runId
    this.debugMode = debugMode
    /** @type {import('../../domain/analysisRun.js').RecordArtifact[]} */
    this.recordArtifacts = []
    /** @type {Record<string, unknown>} */
    this.runParams = {}
  }

  /**
   * @param {Record<string, unknown>} params
   */
  setRunParams(params) {
    this.runParams = { ...params }
  }

  /**
   * @param {Object} input
   * @param {string} input.recordId
   * @param {string} [input.sourceText]
   * @param {object} [input.localTags]
   * @param {object} [input.mergedTags]
   * @param {string} [input.mergeReason]
   * @param {number} [input.confidence]
   * @param {unknown} [input.llmRaw]
   */
  async addRecordResult(input) {
    const hash = await hashText(input.sourceText || '')
    /** @type {import('../../domain/analysisRun.js').RecordArtifact} */
    const artifact = {
      id: `${this.runId}:${input.recordId}`,
      runId: this.runId,
      recordId: input.recordId,
      artifactType: 'record',
      inputTextHash: hash,
      excerpt: excerptText(input.sourceText),
      localTags: input.localTags,
      mergedTags: input.mergedTags,
      mergeReason: input.mergeReason,
      confidence: input.confidence,
    }
    this.recordArtifacts.push(artifact)

    if (this.debugMode && input.llmRaw != null) {
      artifact.llmRaw = input.llmRaw
    }
    return artifact
  }

  /**
   * @returns {import('../../domain/analysisRun.js').RunArtifact}
   */
  buildRunArtifact() {
    return {
      id: this.runId,
      runId: this.runId,
      artifactType: 'run',
      paramsSnapshot: this.runParams,
    }
  }
}
