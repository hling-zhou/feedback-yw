export const complaintClusterProfile = {
  profileId: 'complaint',
  scenario: 'complaint',
  primaryThresholdBase: 0.3,
  secondaryThresholdBase: 0.2,
  lowValueProblemTypes: new Set(['配额与权限申请', '其他']),
  enableHighRiskSingletons: true,
  singletonMinRiskScore: 4.8,
  scoreModel: 'complaint_v1',
  scoreModelVersion: 'complaint-score-v1',
  thresholdVersion: 'dynamic-threshold-v1',
  fingerprintVersion: 'cluster-fingerprint-v2',
  topN: 10,
  mergeSourcesInOverview: false,
}

