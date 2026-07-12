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
 * @property {string} [complaintCauseL1Review] - 投诉原因一级（终判）人工复核，重新打标不覆盖
 * @property {string} [complaintCauseL2Review] - 投诉原因二级（终判）人工复核
 * @property {string} [complaintCauseL3Review] - 投诉原因三级（终判）人工复核
 * @property {string} journeyL1 - 用户旅程一级
 * @property {string} journeyL2 - 用户旅程二级（即旅程标签，无二级时标签取一级）
 * @property {string} problemSummary - 需求痛点挖掘（与 painPoint 同步）
 * @property {string} [painPoint] - 需求痛点挖掘
 * @property {string} [customerRequest] - 用户请求内容（全生命周期精炼摘要，≤80 字，最长 120）
 * @property {'rule' | 'llm' | 'manual' | 'import'} [customerRequestSource] - 客户请求内容来源
 * @property {string} customerQuote - 客户原话（规则抽取，主要用于情绪/原话分析，≠ customerRequest）
 * @property {string} solutionSummary - 解决方案
 * @property {string} rootCause - 问题根因
 * @property {string} optimizationSuggestion - 优化建议（兼容汇总字段）
 * @property {string} [optimizationProduct] - 产品/技术优化
 * @property {string} [optimizationService] - 服务/流程改进
 * @property {'rule' | 'llm' | 'manual' | 'import'} [painPointSource] - 需求痛点来源
 * @property {'rule' | 'llm' | 'manual' | 'import'} [optimizationSource] - 单条优化建议来源（不含人工复核）
 * @property {string} [manualReviewRootCause] - @deprecated 人工复核根因，停止写入
 * @property {string} [manualReviewSolution] - @deprecated 人工复核优化方案，停止写入
 * @property {string} [manualReviewAction] - @deprecated 人工复核举措，停止写入
 * @property {string} [manualReviewOptimization] - 人工复核后的优化建议；过渡字段，见 establishedAction
 * @property {string} [establishedAction] - 确立举措文本副本（展示/导出/聚类）
 * @property {string} [establishedActionDetail] - 确立举措详情副本（可选）
 * @property {string} [actionId] - 关联举措库 ID（R4）
 * @property {string} [actionSchedule] - 排期（可空，空=待评估）
 * @property {string} [rootCauseReview] - 根因排查（人工复核，默认来自导入列「问题原因」）
 * @property {string} [productGroupOptimization] - 产品组优化建议（不参与聚类）
 * @property {string} [designerOptimization] - 设计师优化建议（不参与聚类）
 * @property {Record<string, string>} [sourceColumns] - 导入时原始工单列快照（中文列名 → 值）
 * @property {Sentiment} sentiment
 * @property {UrgencyLevel} [urgencyLevel] - 加急/催促（与主情绪独立）
 * @property {string[]} themes - 由 journeyL1/journeyL2 同步，与二级环节名一致（无二级时取一级）
 * @property {FeedbackStatus} status
 * @property {string} [note]
 * @property {('requestScene' | 'problemType' | 'journey' | 'sentiment' | 'urgency' | 'optimization' | 'customerRequest' | 'painPoint' | 'rootCauseReview')[]} [manualTagFields] - 人工维护维度；见 fieldRegistry.js
 * @property {string} [importMonth] - 数据月份，格式 YYYY-MM，用于按月导入后的历史趋势分析
 * @property {boolean} [outOfPeriodWarning]
 * @property {import('../domain/followUpSatisfaction.js').FollowUpSatisfaction} [followUpSatisfaction] - 满意度回访补全（投诉/咨询工单）
 * @property {string} [importBatchId]
 * @property {string} [importBatchName]
 * @property {string} [importFileName]
 * @property {string} [importSheetName]
 * @property {string} importedAt
 * @property {number} [recordRevision] - 乐观锁版本，每次业务写入 +1
 * @property {string} [updatedAt] - 最后一次业务写入时间 ISO 8601
 * @property {{ userId: string; username: string }} [updatedBy] - 最后一次写入用户
 * @property {{ items: { id: string; text: string; done: boolean; assigneeUserId?: string; assigneeUsername?: string; updatedAt?: string; updatedBy?: { userId: string; username: string } }[]; updatedAt?: string; updatedBy?: { userId: string; username: string } }} [ticketTodo] - 会议待办（与确立举措分离）
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
    label: '投诉产品',
    required: false,
    hint: '映射到工单 Excel 中的投诉产品列，常用列名「具体投诉产品」；系统据此匹配「目标产品」范围与规格。',
  },
  { key: 'resourcePool', label: '所属资源池', required: false },
  {
    key: 'customerTierCol',
    label: '客户等级',
    required: false,
    hint: '映射到「移动云客户服务等级」列（金牌/银牌/铜牌/普通）；用于行动建议高价值客户影响展示，不参与聚类评分。',
  },
  { key: 'rawText', label: '受理内容 / 主文本', required: false, hint: '投诉/咨询工单：客户侧问题描述，常用列「受理内容」；可与下方「合并到主文本」列拼接。非工单来源时映射正文列。' },
  { key: 'handlingText', label: '处理意见（打标必填）', required: true, hint: '客服处理记录，四维打标与客户请求/痛点抽取的主要语料；投诉工单常用列「处理意见」。' },
  { key: 'responseText', label: '优化举措/建议', required: false, hint: '可选。映射工单表「优化举措/建议」列，写入 solutionSummary，供工单详情展示与规则/LLM 优化建议参考；未映射时尝试从处理意见等文本解析。' },
  { key: 'rootCauseCol', label: '问题原因', required: false, hint: '可选。映射工单表「问题原因」列，写入 rootCause，用于规则优化建议与 LLM 上下文；≠ 投诉原因（终判）。未映射时尝试从正文解析。' },
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
