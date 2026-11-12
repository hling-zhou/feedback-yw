/** Return only products whose saved text no longer matches the current evidence. */
export function pendingReportProductDrafts(cards, savedDrafts) {
  const savedByProduct = new Map((savedDrafts || []).map((row) => [row.productName, row]))
  return (cards || []).filter((card) => (
    card?.productName && card?.narrative && card?.evidenceFingerprint
    && savedByProduct.get(card.productName)?.fingerprint !== card.evidenceFingerprint
  ))
}

/** Apply an arriving AI draft without replacing saved or in-progress human edits. */
export function mergeGeneratedReportDraft(current, conclusionKey, draft, savedManual, editedFields) {
  const previous = current?.[conclusionKey] || {}
  return {
    ...current,
    [conclusionKey]: {
      conclusion: savedManual?.conclusion ?? (editedFields?.conclusion ? previous.conclusion : draft.conclusion),
      action: savedManual?.action ?? (editedFields?.action ? previous.action : draft.action),
    },
  }
}

/** Run one product at a time; a failure must not prevent the remaining products. */
export async function runReportDraftQueue({
  cards, savedDrafts, reportKey, settings, generate, save, isCurrent, onSaved = null, onProgress = null,
}) {
  const pending = pendingReportProductDrafts(cards, savedDrafts)
  const failures = []
  let completed = 0
  onProgress?.({ completed, total: pending.length, failures: [] })

  for (const card of pending) {
    if (!isCurrent()) break
    try {
      const draft = await generate(settings, card.narrative)
      if (!isCurrent()) break
      const saved = await save(reportKey, card.productName, card.evidenceFingerprint, draft)
      if (!isCurrent()) break
      onSaved?.(card, saved?.item || saved)
    } catch (error) {
      if (!isCurrent()) break
      failures.push({ productName: card.productName, message: error instanceof Error ? error.message : String(error) })
    }
    completed += 1
    onProgress?.({ completed, total: pending.length, failures: [...failures] })
  }

  return { completed, total: pending.length, failures }
}
