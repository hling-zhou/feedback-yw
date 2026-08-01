export const consultationClusterProfile = {
  profileId: 'consultation',
  scenario: 'consultation',
  primaryThresholdBase: 0.28,
  secondaryThresholdBase: 0.18,
  lowValueProblemTypes: new Set(['其他']),
  enableHighRiskSingletons: true,
  singletonMinRiskScore: 4.2,
  scoreModel: 'consultation_v1',
  scoreModelVersion: 'consultation-score-v1',
  thresholdVersion: 'dynamic-threshold-v1',
  fingerprintVersion: 'cluster-fingerprint-v2',
  topN: 10,
  mergeSourcesInOverview: false,
}

