/** Build the editable display values. Product cards contain the current evidence-based drafts. */
export function initialReportIssueNarratives(model) {
  return Object.fromEntries([
    ...(model?.issues || []).map((issue) => [
      issue.key,
      { conclusion: issue.conclusion ?? issue.conclusionDraft ?? '', action: issue.action ?? issue.actionDraft ?? '' },
    ]),
    ...(model?.productCards || []).map((card) => [
      card.conclusionKey,
      {
        conclusion: card.conclusion ?? card.conclusionDraft ?? '',
        action: card.issue?.action ?? card.issue?.actionDraft ?? '',
      },
    ]),
  ])
}

/** Only fields actually edited by a person become saved overrides. */
export function mergeManualReportIssueNarratives(saved, current, editedFields) {
  const merged = { ...(saved || {}) }
  for (const [key, fields] of Object.entries(editedFields || {})) {
    const edits = {}
    if (fields?.conclusion) edits.conclusion = current?.[key]?.conclusion ?? ''
    if (fields?.action) edits.action = current?.[key]?.action ?? ''
    if (Object.keys(edits).length) merged[key] = { ...(merged[key] || {}), ...edits }
  }
  return merged
}
