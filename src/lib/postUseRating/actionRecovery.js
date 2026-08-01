/**
 * Compare the metric that triggered an action with the latest comparable metric.
 * Higher-is-better metrics recover when they reach baseline or improve materially.
 */
export function evaluateActionRecovery(action, latestMetric) {
  const trigger = action?.triggerMetric
  if (action?.status !== 'completed') return { status: 'not_applicable', label: '未完成' }
  if (!trigger || !Number.isFinite(Number(trigger.value)) || !latestMetric || !Number.isFinite(Number(latestMetric.value))) {
    return { status: 'pending', label: '待验证', explanation: '缺少完成前或完成后的同口径指标' }
  }
  const before = Number(trigger.value)
  const after = Number(latestMetric.value)
  const baseline = Number(trigger.baseline)
  const recovered = Number.isFinite(baseline) ? after >= baseline : after > before
  return {
    status: recovered ? 'recovered' : 'not_recovered',
    label: recovered ? '已恢复' : '未恢复',
    explanation: `${trigger.period || '完成前'} ${before}${trigger.unit || ''} → ${latestMetric.period || '完成后'} ${after}${trigger.unit || ''}${Number.isFinite(baseline) ? `，目标 ${baseline}${trigger.unit || ''}` : ''}`,
    before: trigger,
    after: latestMetric,
  }
}

export function listCompletedButNotRecovered(actions, latestMetricByProduct = new Map()) {
  return (actions || []).flatMap((action) => {
    const validation = evaluateActionRecovery(action, latestMetricByProduct.get(action.productName))
    return validation.status === 'not_recovered' ? [{ ...action, recoveryValidation: validation }] : []
  })
}

export function buildInsightEvidencePackage(insight) {
  return {
    insightId: `post-use:${insight.productName}:${insight.need || insight.issue || 'experience'}`,
    productName: insight.productName,
    theme: insight.need || insight.issue || '产品体验',
    evidenceRecordIds: [...new Set(insight.evidenceIds || [])],
    quotes: (insight.quotes || []).slice(0, 3),
    metrics: {
      count: insight.count ?? insight.nonTenCount ?? 0,
      customerCount: insight.customerCount ?? 0,
      avgScore: insight.avgScore ?? null,
      priorityScore: insight.priorityScore ?? null,
    },
    explanation: insight.explanation || '',
  }
}
