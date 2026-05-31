/** @typedef {import('./sentiment.js').Sentiment} Sentiment */
/** @typedef {import('./sentiment.js').UrgencyLevel} UrgencyLevel */
/** @typedef {'open' | 'reviewed' | 'actioned'} FeedbackStatus */

/**
 * v1 反馈记录。v2 工单类见 {@link import('../domain/records.js').TicketRecord}，
 * 可用 `ticketRecordFromLegacy()` 转换。
 * @typedef {Object} FeedbackRecord
 * @property {string} id
 * @property {string} [source]
 * @property {string} rawText
 * @property {string} customerQuote
 * @property {string} [quoteExtractionVersion] - 客户原话抽取规则指纹（见 quoteExtraction.js）
 * @property {string} [responseText]
 * @property {string} [handlingText] - 处理意见（打标主文本）
 * @property {string} [createdAt]
 * @property {string} [product] - 目标产品（由产品规格解析）
 * @property {string} [productSpec] - 工单中的产品规格（原「具体投诉产品」列）
 * @property {string} [productKey]
 * @property {string} [version]
 * @property {string} [ticketId]
 * @property {string} [resourcePool]
 * @property {import('../domain/customerTier.js').CustomerTier} [customerTier] - 客户等级：金牌/银牌/铜牌/普通（导入列，不参与聚类评分）
 * @property {string} requestScene - 请求场景（用户角度，通用）
 * @property {string} problemType - 问题类型（配置打标，与工单终判投诉原因无关）
 * @property {string} [complaintCauseL1Final] - 投诉原因一级（终判），仅 complaint_ticket
 * @property {string} [complaintCauseL2Final] - 投诉原因二级（终判）
 * @property {string} [complaintCauseL3Final] - 投诉原因三级（终判）
 * @property {string} journeyL1 - 用户旅程一级
 * @property {string} journeyL2 - 用户旅程二级（即旅程标签，无二级时标签取一级）
 * @property {string} problemSummary - 需求痛点挖掘（与 painPoint 同步）
 * @property {string} [painPoint] - 需求痛点挖掘
 * @property {string} [customerRequest] - 用户请求内容（全生命周期精炼摘要，≤80 字，最长 120）
 * @property {'rule' | 'llm'} [customerRequestSource] - 客户请求内容来源
 * @property {string} customerQuote - 客户原话（规则抽取，主要用于情绪/原话分析，≠ customerRequest）
 * @property {string} solutionSummary - 解决方案
 * @property {string} rootCause - 问题根因
 * @property {string} optimizationSuggestion - 优化建议（兼容汇总字段）
 * @property {string} [optimizationProduct] - 产品/技术优化
 * @property {string} [optimizationService] - 服务/流程改进
 * @property {'rule' | 'llm'} [painPointSource] - 需求痛点来源
 * @property {'rule' | 'llm'} [optimizationSource] - 单条优化建议来源（不含人工复核）
 * @property {string} [manualReviewRootCause] - 人工复核根因，默认空
 * @property {string} [manualReviewSolution] - 人工复核优化方案，默认空
 * @property {string} [manualReviewAction] - 人工复核举措，默认空
 * @property {string} [manualReviewOptimization] - 人工复核后的优化建议（优先于自动建议）
 * @property {Record<string, string>} [sourceColumns] - 导入时原始工单列快照（中文列名 → 值）
 * @property {Sentiment} sentiment
 * @property {UrgencyLevel} [urgencyLevel] - 加急/催促（与主情绪独立）
 * @property {string[]} themes - 由 journeyL1/journeyL2 同步，与二级环节名一致（无二级时取一级）
 * @property {FeedbackStatus} status
 * @property {string} [note]
 * @property {('requestScene' | 'problemType' | 'journey' | 'sentiment' | 'urgency')[]} [manualTagFields] - 人工在工单详情中更正过的标签维度；重新打标时不覆盖
 * @property {string} [importMonth] - 数据月份，格式 YYYY-MM，用于按月导入后的历史趋势分析
 * @property {string} [importBatchId]
 * @property {string} [importBatchName]
 * @property {string} [importFileName]
 * @property {string} [importSheetName]
 * @property {string} importedAt
 */

export const STANDARD_FIELDS = [
  {
    key: 'ticketId',
    label: '工单流水号',
    required: false,
    hint: '导入时若表头含「工单展示流水号」或「工单流水号」将自动映射（前者优先）；也可手动选择其它列。',
  },
  { key: 'createdAt', label: '创建时间', required: false },
  {
    key: 'productSpec',
    label: '产品规格',
    required: false,
    hint: '映射到原始表中的「对××的反馈」类列，例如「具体投诉产品」「产品名称」「产品规格」等；系统据此匹配「目标产品」。',
  },
  { key: 'resourcePool', label: '所属资源池', required: false },
  {
    key: 'customerTierCol',
    label: '客户等级',
    required: false,
    hint: '映射到「移动云客户服务等级」列（金牌/银牌/铜牌/普通）；用于行动建议高价值客户影响展示，不参与聚类评分。',
  },
  { key: 'rawText', label: '受理内容 / 主文本', required: false },
  { key: 'handlingText', label: '处理意见（打标必填）', required: true },
  { key: 'responseText', label: '解决方案', required: false },
  { key: 'rootCauseCol', label: '根因列', required: false },
  {
    key: 'problemTypeL1FinalCol',
    label: '投诉原因一级（终判）',
    required: false,
    hint: '写入投诉原因（终判）字段与原始列快照；不参与「问题类型」自动打标。',
  },
  { key: 'problemTypeL2FinalCol', label: '投诉原因二级（终判）', required: false },
  { key: 'problemTypeL3FinalCol', label: '投诉原因三级（终判）', required: false },
  { key: 'source', label: '渠道', required: false },
]

export const FIELD_LABELS = Object.fromEntries(
  STANDARD_FIELDS.map((f) => [f.key, f.label]),
)
