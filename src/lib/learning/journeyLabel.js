/**
 * @param {string} l1
 * @param {string} [l2]
 */
export function formatJourneyPair(l1, l2) {
  const a = String(l1 || '').trim()
  const b = String(l2 || '').trim()
  if (!a && !b) return ''
  if (!b || b === a) return a
  return `${a} > ${b}`
}

/**
 * @param {string} label
 * @returns {{ journeyL1: string; journeyL2: string }}
 */
export function parseJourneyPair(label) {
  const parts = String(label || '')
    .split('>')
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length >= 2) return { journeyL1: parts[0], journeyL2: parts[1] }
  if (parts.length === 1) return { journeyL1: parts[0], journeyL2: parts[0] }
  return { journeyL1: '', journeyL2: '' }
}

/**
 * @param {string} a
 * @param {string} b
 */
export function labelsEqual(a, b) {
  return String(a ?? '').trim() === String(b ?? '').trim()
}
