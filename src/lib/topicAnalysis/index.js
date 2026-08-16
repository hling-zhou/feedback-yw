import {
  applyUnresolvedOverlay,
  compactRecommendCardsForCache,
  recommendTopics,
  topicFromUserQuery,
} from './recommendTopics.js'
import {
  buildRecommendCacheKey,
  loadRecommendCache,
  recommendCacheMatches,
  saveRecommendCache,
} from './recommendCache.js'
import {
  customTopicQueryHint,
  customTopicTypeMismatch,
  topicForPersist,
  topicRequestErrorMessage,
} from './customTopic.js'
import { collectTopicEvidence } from './collectEvidence.js'
import { buildTopicBrief } from './buildBrief.js'
import { polishTopicBriefWithLlm } from './llmBrief.js'
import { polishRecommendationsWithLlm } from './llmRecommend.js'
import { interpretCustomTopic } from './interpretTopic.js'
import { parseTopicSearchQuery } from './matchQuery.js'
import { parseTopicSupplementFile } from './parseSupplement.js'
import { preserveTopicReportActors } from './reportActors.js'
import {
  createTopicReport,
  findReportByRecommendationId,
  getTopicReport,
  loadTopicReports,
  mergeTopicReports,
  saveTopicReport,
  deleteTopicReport,
} from './store.js'
import { generateTopicReportBrief } from './generateReport.js'
import { runTopicReportJob } from './generateJob.js'
import { buildTopicMarkdown } from './markdown.js'
import {
  buildRollingMonthPeriod,
  loadRecordsForTopicPeriod,
  periodFromSnapshot,
  snapshotPeriod,
} from './period.js'

export {
  recommendTopics,
  topicFromUserQuery,
  applyUnresolvedOverlay,
  compactRecommendCardsForCache,
  customTopicQueryHint,
  customTopicTypeMismatch,
  topicForPersist,
  topicRequestErrorMessage,
  collectTopicEvidence,
  buildTopicBrief,
  polishTopicBriefWithLlm,
  polishRecommendationsWithLlm,
  interpretCustomTopic,
  parseTopicSearchQuery,
  parseTopicSupplementFile,
  preserveTopicReportActors,
  createTopicReport,
  findReportByRecommendationId,
  getTopicReport,
  loadTopicReports,
  mergeTopicReports,
  saveTopicReport,
  deleteTopicReport,
  generateTopicReportBrief,
  runTopicReportJob,
  buildTopicMarkdown,
  buildRollingMonthPeriod,
  loadRecordsForTopicPeriod,
  periodFromSnapshot,
  snapshotPeriod,
  buildRecommendCacheKey,
  loadRecommendCache,
  recommendCacheMatches,
  saveRecommendCache,
}
