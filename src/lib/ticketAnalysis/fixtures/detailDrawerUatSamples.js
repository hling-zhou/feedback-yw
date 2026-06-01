/**
 * 工单详情 Drawer UAT 样例：投诉 5 + 咨询 5（复用 export v2 前 5 条）。
 * @see docs/FEEDBACK-DRAWER-UAT.md
 */

import {
  EXPORT_V2_UAT_COMPLAINT_SAMPLES,
  EXPORT_V2_UAT_CONSULTATION_SAMPLES,
} from './exportV2UatSamples.js'

/** @typedef {import('../../types.js').FeedbackRecord} FeedbackRecord */

/** @type {FeedbackRecord[]} */
export const DETAIL_DRAWER_UAT_COMPLAINT_SAMPLES = EXPORT_V2_UAT_COMPLAINT_SAMPLES.slice(0, 5)

/** @type {FeedbackRecord[]} */
export const DETAIL_DRAWER_UAT_CONSULTATION_SAMPLES = EXPORT_V2_UAT_CONSULTATION_SAMPLES.slice(
  0,
  5,
).map((record) =>
  record.id === 'uat-z-05'
    ? {
        ...record,
        customerRequestSource: 'import',
        painPointSource: 'import',
        optimizationSource: 'import',
      }
    : record,
)

/** @type {FeedbackRecord[]} */
export const DETAIL_DRAWER_UAT_ALL_SAMPLES = [
  ...DETAIL_DRAWER_UAT_COMPLAINT_SAMPLES,
  ...DETAIL_DRAWER_UAT_CONSULTATION_SAMPLES,
]
