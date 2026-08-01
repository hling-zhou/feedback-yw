export const overviewClusterProfile = {
  profileId: 'overview',
  scenario: 'overview',
  primaryThresholdBase: 0.3,
  secondaryThresholdBase: 0.2,
  lowValueProblemTypes: new Set(),
  enableHighRiskSingletons: true,
  singletonMinRiskScore: 4.5,
  scoreModel: 'overview_fusion_v1',
  scoreModelVersion: 'overview-fusion-score-v1',
  thresholdVersion: 'dynamic-threshold-v1',
  fingerprintVersion: 'cluster-fingerprint-v2',
  topN: 12,
  mergeSourcesInOverview: true,
}

