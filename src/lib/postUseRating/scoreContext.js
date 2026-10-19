function round2(n) {
  return Math.round(Number(n) * 100) / 100
}

function formatAbsDelta(delta) {
  return String(Math.abs(round2(delta)))
}

function toneFromDelta(delta) {
  if (delta == null || !Number.isFinite(delta) || delta === 0) return 'flat'
  return delta > 0 ? 'up' : 'down'
}

/**
 * 分数相对公司均分、相对上一周期。
 * 公司对比和环比都用调用方传入的同一套分数，不在这里另算指标。
 * @param {{
 *   avgScore?: number | null
 *   companyAvg?: number | null
 *   companySample?: number
 *   previousAvg?: number | null
 *   previousSample?: number
 *   momPrefix?: string
 * }} input
 */
/**
 * 投诉回访满意度环比：本期或上期无样本时一律「—」。0% 仍可对比。
 * @param {{
 *   currentRate?: number | null
 *   currentSample?: number
 *   previousRate?: number | null
 *   previousSample?: number
 *   momPrefix?: string
 * }} input
 */
export function compareSatisfactionMom(input = {}) {
  const hasCurrent = Number(input.currentSample) > 0 && Number.isFinite(Number(input.currentRate))
  const hasPrevious = Number(input.previousSample) > 0 && Number.isFinite(Number(input.previousRate))
  if (!hasCurrent || !hasPrevious) return { label: '—', tone: 'na' }
  const current = Number(input.currentRate)
  const previous = Number(input.previousRate)
  const delta = round2(current - previous)
  const prefix = input.momPrefix || '较上月'
  if (delta === 0) return { label: `${prefix}持平`, tone: 'flat' }
  const abs = formatAbsDelta(delta)
  return delta > 0
    ? { label: `${prefix}高 ${abs} 个百分点`, tone: 'up' }
    : { label: `${prefix}低 ${abs} 个百分点`, tone: 'down' }
}

export function buildYunwangScoreContext(input = {}) {
  const current = Number(input.avgScore)
  const hasCurrent = Number.isFinite(current)
  const momPrefix = input.momPrefix || '较上月'
  const missingMomLabel = `暂无${momPrefix.replace(/^较/, '')}对比`

  let companyDelta = null
  let vsCompanyLabel = '暂无公司均分对比'
  let vsCompanyTone = 'na'
  const companyAvg = Number(input.companyAvg)
  if (hasCurrent && Number(input.companySample) > 0 && Number.isFinite(companyAvg)) {
    companyDelta = round2(current - companyAvg)
    vsCompanyTone = toneFromDelta(companyDelta)
    vsCompanyLabel = companyDelta === 0
      ? '与公司均分持平'
      : companyDelta > 0
        ? `高于公司均分 ${formatAbsDelta(companyDelta)}`
        : `低于公司均分 ${formatAbsDelta(companyDelta)}`
  }

  let momDelta = null
  let momLabel = missingMomLabel
  let momTone = 'na'
  const previousAvg = Number(input.previousAvg)
  if (hasCurrent && Number(input.previousSample) > 0 && Number.isFinite(previousAvg)) {
    momDelta = round2(current - previousAvg)
    momTone = toneFromDelta(momDelta)
    momLabel = momDelta === 0
      ? `${momPrefix}持平`
      : momDelta > 0
        ? `${momPrefix}高 ${formatAbsDelta(momDelta)}`
        : `${momPrefix}低 ${formatAbsDelta(momDelta)}`
  }

  return {
    companyAvg: Number(input.companySample) > 0 && Number.isFinite(companyAvg) ? companyAvg : null,
    companyDelta,
    vsCompanyLabel,
    vsCompanyTone,
    previousAvg: Number(input.previousSample) > 0 && Number.isFinite(previousAvg) ? previousAvg : null,
    previousSample: Number(input.previousSample) || 0,
    momDelta,
    momLabel,
    momTone,
  }
}
