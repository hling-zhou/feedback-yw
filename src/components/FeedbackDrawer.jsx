import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Descriptions,
  Drawer,
  Form,
  Input,
  message,
  Select,
  Tooltip,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useAuth } from '../context/AuthContext.jsx'
import { useFeedbacks } from '../context/FeedbackContext.jsx'
import { useSharedBackgroundTaskBlock } from '../hooks/useSharedBackgroundTaskBlock.js'
import { RETAG_DETAIL_IN_PROGRESS_TIP } from '../lib/retagSession.js'
import { formatManualTagFieldsHint } from '../lib/manualTagFields.js'
import {
  getDisplayCustomerRequest,
  getDisplayPainPoint,
} from '../lib/ticketAnalysis/ticketAnalysisSources.js'
import { getSentimentDisplayLabel } from '../lib/sentiment.js'
import { TAG_UNRECOGNIZED } from '../lib/ticketAnalysis/tagLabels.js'
import { normalizeSentiment, normalizeUrgencyLevel, SENTIMENT_LABELS } from '../lib/sentiment.js'
import { getTaxonomyForRecord } from '../lib/productTaxonomy.js'
import { mapTaxonomySelectOptions, resolveTagDefinition } from '../lib/tagDefinitions.js'
import {
  AutoOptimizationSourceTag,
  CustomerRequestSourceTag,
  JourneySourceTag,
  PainPointSourceTag,
  RuleManualDimensionSourceTag,
} from './tags/TicketAnalysisSourceTag.jsx'
import { renderDefinitionSelectOption } from './tags/DefinitionSelectOption.jsx'
import { themesFromJourney } from '../lib/applyThemes.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import {
  extractHandlingOriginalTextForRecord,
} from '../lib/taggingText.js'
import {
  buildCustomerRequestSavePatch,
  buildPainPointSavePatch,
  CUSTOMER_REQUEST_MANUAL_MAX_LENGTH,
  getCustomerRequestDraftDisplay,
  getPainPointDraftDisplay,
  normalizeManualCustomerRequest,
  normalizeManualPainPoint,
  PAIN_POINT_MANUAL_MAX_LENGTH,
} from '../domain/ticketAnalysisManualFields.js'
import {
  getActionScheduleDisplay,
  normalizeActionSchedule,
} from '../domain/actionSchedule.js'
import {
  ESTABLISHED_ACTION_MAX_LENGTH,
  getEstablishedActionDisplay,
} from '../domain/establishedAction.js'
import { persistEstablishedActionForTicket, syncFirstTicketSnapshotsForRecord, syncLinkedTicketsForActionIds } from '../lib/establishedActionPersist.js'
import ActionItemSelect from './ActionItemSelect.jsx'
import { getActionItem } from '../lib/actionItemClient.js'
import {
  buildDetailOptimizationSavePatch,
  DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH,
  hasDetailOptimizationContent,
} from '../domain/detailOptimizationFields.js'
import {
  getComplaintCauseL1Display,
  isComplaintTicket,
} from '../domain/complaintCause.js'
import {
  getRootCauseReviewDraftDisplay,
  isRootCauseReviewManuallyMaintained,
  normalizeRootCauseReviewInput,
  ROOT_CAUSE_REVIEW_MAX_LENGTH,
  shouldIncludeRootCauseReviewInSave,
} from '../domain/rootCauseReview.js'
import RecordConflictModal from './RecordConflictModal.jsx'
import { getRecordRevision, toRecordConflictError } from '../domain/recordRevision.js'
import { shouldShowRemoteRecordStale } from '../domain/recordRemoteStale.js'
import { formatRecordUpdatedByLine } from '../lib/recordConflictDiff.js'

const RETAG_DEFAULT_TIP =
  '按当前规则与大模型重新分析本工单，将覆盖：四维标签、客户请求内容、需求痛点，以及优化建议（自动生成）。其他不修改。'

const SAVE_DETAIL_TIP =
  '将当前编辑内容写入本工单，已修改维度将标记为「人工维护」，后续单条/批量重新打标默认保留，不会被自动覆盖。'

export default function FeedbackDrawer({ feedback: selected, onClose }) {
  const {
    feedbacks,
    updateFeedback,
    reprocessOne,
    retagSession,
    importSession,
    sharedBackgroundTask,
    reprocessing,
  } = useFeedbacks()
  const { can, user } = useAuth()
  const { detailSaveBlocked, detailSaveBlockedTip } = useSharedBackgroundTaskBlock()
  const canEdit = can('editRecord')
  const canRetag = can('retag')
  const feedback = selected
    ? feedbacks.find((f) => f.id === selected.id) ?? selected
    : null
  const [note, setNote] = useState(feedback?.note || '')
  const [sentiment, setSentiment] = useState(
    () => normalizeSentiment(feedback?.sentiment),
  )
  const [urgencyLevel, setUrgencyLevel] = useState(
    () => normalizeUrgencyLevel(feedback?.urgencyLevel, feedback?.sentiment),
  )
  const [requestScene, setRequestScene] = useState(feedback?.requestScene || '')
  const [problemType, setProblemType] = useState(feedback?.problemType || '')
  const [journeyL1, setJourneyL1] = useState(feedback?.journeyL1 || '')
  const [journeyL2, setJourneyL2] = useState(feedback?.journeyL2 || '')
  const [establishedAction, setEstablishedAction] = useState('')
  const [actionId, setActionId] = useState('')
  const [linkedFromLibrary, setLinkedFromLibrary] = useState(false)
  const [customerRequest, setCustomerRequest] = useState('')
  const [painPoint, setPainPoint] = useState('')
  const [actionSchedule, setActionSchedule] = useState('')
  const [productGroupOptimization, setProductGroupOptimization] = useState('')
  const [designerOptimization, setDesignerOptimization] = useState('')
  const [rootCauseReview, setRootCauseReview] = useState('')
  const [rootCauseReviewTouched, setRootCauseReviewTouched] = useState(false)
  const [retagging, setRetagging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [remoteStale, setRemoteStale] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [conflictServerRecord, setConflictServerRecord] = useState(
    /** @type {import('../lib/types.js').FeedbackRecord | null} */ (null),
  )
  const [conflictRevision, setConflictRevision] = useState(0)
  const [forceSaving, setForceSaving] = useState(false)
  const baseRevisionRef = useRef(0)

  const taxonomy = useMemo(
    () => (feedback ? getTaxonomyForRecord(feedback) : null),
    [feedback],
  )

  const handlingOriginalText = useMemo(() => {
    if (!feedback) return ''
    return extractHandlingOriginalTextForRecord(feedback)
  }, [feedback])

  const l2Options = useMemo(() => {
    if (!taxonomy) return []
    const l1 = taxonomy.journeys.find((j) => j.label === journeyL1)
    return l1?.children || []
  }, [taxonomy, journeyL1])

  const sentimentSelectOptions = useMemo(
    () =>
      Object.entries(SENTIMENT_LABELS).map(([value, label]) => {
        const def = resolveTagDefinition({ dimension: 'sentiment', sentimentKey: value })
        return { value, label, title: def.body }
      }),
    [],
  )

  const applyFeedbackToForm = useCallback((record) => {
    if (!record) return
    setNote(record.note || '')
    setSentiment(normalizeSentiment(record.sentiment))
    setUrgencyLevel(normalizeUrgencyLevel(record.urgencyLevel, record.sentiment))
    setRequestScene(record.requestScene || '')
    setProblemType(record.problemType || '')
    setJourneyL1(record.journeyL1 || '')
    setJourneyL2(record.journeyL2 || '')
    setEstablishedAction(getEstablishedActionDisplay(record))
    setActionId(record.actionId?.trim() || '')
    setLinkedFromLibrary(Boolean(record.actionId?.trim()))
    setCustomerRequest(getCustomerRequestDraftDisplay(record))
    setPainPoint(getPainPointDraftDisplay(record))
    setActionSchedule(record.actionSchedule || '')
    setProductGroupOptimization(record.productGroupOptimization || '')
    setDesignerOptimization(record.designerOptimization || '')
    setRootCauseReview(getRootCauseReviewDraftDisplay(record))
    setRootCauseReviewTouched(false)
  }, [])

  useEffect(() => {
    if (!feedback?.id) return
    baseRevisionRef.current = getRecordRevision(feedback)
    setRemoteStale(false)
    applyFeedbackToForm(feedback)
    // 仅在切换工单时重置表单，避免轮询同步覆盖编辑中内容
    // eslint-disable-next-line react-hooks/exhaustive-deps -- feedback fields intentionally omitted
  }, [feedback?.id, applyFeedbackToForm])

  useEffect(() => {
    if (!feedback?.id) return
    const latestRevision = getRecordRevision(feedback)
    if (
      !shouldShowRemoteRecordStale(feedback, baseRevisionRef.current, {
        userId: user?.id,
        retagActive: retagSession.active,
        importActive: importSession.active,
        reprocessingActive: reprocessing,
        sharedBackgroundTask,
      })
    ) {
      baseRevisionRef.current = latestRevision
      setRemoteStale(false)
      return
    }
    setRemoteStale(true)
  }, [
    feedback?.id,
    feedback?.recordRevision,
    feedback?.updatedBy?.userId,
    importSession.active,
    retagSession.active,
    reprocessing,
    sharedBackgroundTask,
    user?.id,
  ])

  useEffect(() => {
    if (!feedback?.actionId?.trim()) return
    let cancelled = false
    ;(async () => {
      const item = await getActionItem(feedback.actionId)
      if (cancelled || !item) return
      if (linkedFromLibrary) {
        setEstablishedAction(item.content)
        setActionSchedule(item.scheduleAt || '')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [feedback?.actionId, feedback?.id, linkedFromLibrary])

  const optimizationServiceText = feedback?.optimizationService?.trim() || ''

  const journeyDisplay = useMemo(() => {
    const l1 = journeyL1?.trim() || TAG_UNRECOGNIZED
    const l2 = journeyL2?.trim()
    return l2 ? `${l1}、${l2}` : l1
  }, [journeyL1, journeyL2])

  const ticketMetaLine = useMemo(() => {
    if (!feedback) return '—'
    const product = feedback.product?.trim()
    const spec = feedback.productSpec?.trim()
    let productText = product || spec || ''
    if (product && spec && spec !== product) {
      productText = `${product}（${spec}）`
    }
    const source =
      DATA_SOURCE_LABELS[feedback.dataSourceType] || feedback.dataSourceType || ''
    return [feedback.ticketId?.trim(), productText, source].filter(Boolean).join(' · ') || '—'
  }, [feedback])

  if (!feedback) return null

  const libraryLinked = linkedFromLibrary && Boolean(actionId?.trim())
  const schedulePickerValue = (() => {
    const normalized = normalizeActionSchedule(actionSchedule)
    if (!normalized) return null
    const parsed = dayjs(normalized, 'YYYY-MM-DD', true)
    return parsed.isValid() ? parsed : null
  })()

  const buildSavePatch = () => {
    const journey = { journeyL1, journeyL2 }
    return {
      note,
      themes: themesFromJourney(journey),
      sentiment,
      urgencyLevel,
      requestScene,
      problemType,
      ...buildCustomerRequestSavePatch(feedback, customerRequest),
      ...buildPainPointSavePatch(feedback, painPoint),
      ...buildDetailOptimizationSavePatch({
        productGroupOptimization,
        designerOptimization,
      }),
      ...journey,
    }
  }

  const buildDraftRecord = () => {
    const patch = buildSavePatch()
    let draft = { ...feedback, ...patch }
    if (shouldIncludeRootCauseReviewInSave(feedback, rootCauseReviewTouched)) {
      draft = {
        ...draft,
        rootCauseReview: normalizeRootCauseReviewInput(rootCauseReview),
      }
    }
    return draft
  }

  const finalizeSave = async (patch, saveOptions = {}) => {
    Object.assign(
      patch,
      await persistEstablishedActionForTicket(feedback, {
        content: establishedAction,
        scheduleAt: actionSchedule,
        actionId,
        linkedFromLibrary,
      }),
    )
    if (shouldIncludeRootCauseReviewInSave(feedback, rootCauseReviewTouched)) {
      patch.rootCauseReview = normalizeRootCauseReviewInput(rootCauseReview)
    }
    const saved = await updateFeedback(feedback.id, patch, {
      expectedRevision: saveOptions.expectedRevision ?? baseRevisionRef.current,
      mergeBase: saveOptions.mergeBase,
      skipConflictCheck: saveOptions.skipConflictCheck,
      forceOverwrite: saveOptions.forceOverwrite,
    })
    const merged = { ...feedback, ...saved }
    if (merged.actionId?.trim()) {
      await syncFirstTicketSnapshotsForRecord(merged)
      if (!linkedFromLibrary) {
        await syncLinkedTicketsForActionIds([merged.actionId], feedbacks, updateFeedback)
      }
    }
    baseRevisionRef.current = getRecordRevision(saved)
    setRemoteStale(false)
    const label = feedback.ticketId ? `工单 ${feedback.ticketId}` : '工单'
    message.success(`${label} 已保存`)
    onClose()
  }

  const save = async (saveOptions = {}) => {
    if (saving || forceSaving) return
    if (detailSaveBlocked) {
      message.warning(detailSaveBlockedTip || '当前无法保存工单')
      return
    }
    setSaving(true)
    try {
      const patch = buildSavePatch()
      await finalizeSave(patch, saveOptions)
    } catch (err) {
      const conflict = toRecordConflictError(err)
      if (conflict) {
        setConflictServerRecord(conflict.current)
        setConflictRevision(conflict.currentRevision)
        setConflictOpen(true)
        return
      }
      message.error(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const handleReloadLatestAfterConflict = () => {
    if (!conflictServerRecord) {
      setConflictOpen(false)
      return
    }
    applyFeedbackToForm(conflictServerRecord)
    baseRevisionRef.current = getRecordRevision(conflictServerRecord)
    setRemoteStale(false)
    setConflictOpen(false)
    message.info('已加载服务器最新内容')
  }

  const handleForceSaveAfterConflict = async () => {
    if (!conflictServerRecord || !canEdit) return
    setForceSaving(true)
    try {
      const patch = buildSavePatch()
      await finalizeSave(patch, {
        expectedRevision: conflictRevision,
        mergeBase: conflictServerRecord,
        forceOverwrite: true,
      })
      setConflictOpen(false)
    } catch (err) {
      const again = toRecordConflictError(err)
      if (again) {
        setConflictServerRecord(again.current)
        setConflictRevision(again.currentRevision)
        message.warning('服务器版本再次变化，请重新加载后再试')
        return
      }
      message.error(err instanceof Error ? err.message : '覆盖保存失败')
    } finally {
      setForceSaving(false)
    }
  }

  const handleReloadStaleRemote = () => {
    if (!feedback) return
    applyFeedbackToForm(feedback)
    baseRevisionRef.current = getRecordRevision(feedback)
    setRemoteStale(false)
    message.info('已同步列表中的最新内容')
  }

  const bulkRetagActive = retagSession.active
  const manualTagHint = formatManualTagFieldsHint(feedback)
  const retagTooltipTitle = bulkRetagActive
    ? RETAG_DETAIL_IN_PROGRESS_TIP
    : manualTagHint
      ? `${RETAG_DEFAULT_TIP}\n以下维度已人工保存，重新打标时将保留：${manualTagHint}。`
      : RETAG_DEFAULT_TIP

  const handleRetag = async () => {
    if (bulkRetagActive) return
    setRetagging(true)
    try {
      await reprocessOne(feedback.id)
      const label = feedback.ticketId ? `工单 ${feedback.ticketId}` : '工单'
      message.success(`${label} 已重新打标`)
    } catch (err) {
      message.error(err instanceof Error ? err.message : '重新打标失败，请重试')
    } finally {
      setRetagging(false)
    }
  }

  return (
    <Drawer
      title="工单详情"
      size={640}
      open={Boolean(feedback)}
      onClose={onClose}
      destroyOnClose
      footer={
        (canEdit || canRetag) ? (
          <div className="flex gap-2">
            {canRetag && (
              <Tooltip title={retagTooltipTitle}>
                <span className="flex flex-1">
                  <Button
                    block
                    className="flex-1"
                    loading={retagging}
                    disabled={bulkRetagActive}
                    onClick={handleRetag}
                  >
                    重新打标
                  </Button>
                </span>
              </Tooltip>
            )}
            {canEdit && (
              <Tooltip
                title={
                  detailSaveBlocked
                    ? detailSaveBlockedTip
                    : SAVE_DETAIL_TIP
                }
              >
                <span className="flex flex-1">
                  <Button
                    type="primary"
                    className="flex-1"
                    loading={saving}
                    disabled={detailSaveBlocked}
                    onClick={() => save()}
                  >
                    保存
                  </Button>
                </span>
              </Tooltip>
            )}
          </div>
        ) : null
      }
    >
      <div className="space-y-4">
        {remoteStale ? (
          <Alert
            type="warning"
            showIcon
            message="此工单已被他人更新"
            description={
              <>
                {formatRecordUpdatedByLine(feedback) || '列表数据已同步为较新版本。'}
                {' '}
                继续编辑可能覆盖他人修改；保存时将再次校验。
              </>
            }
            action={
              <Button size="small" onClick={handleReloadStaleRemote}>
                加载最新
              </Button>
            }
          />
        ) : null}
        {/* A · 基础信息 */}
        <Typography.Text type="secondary" className="block text-xs leading-snug">
          {ticketMetaLine}
        </Typography.Text>

        {/* B1 · 工单分类 */}
        <Card title="工单分类" size="small">
          {canEdit ? (
            <Form layout="vertical">
              <div className="grid gap-3 sm:grid-cols-2">
                <Form.Item
                  label={
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      请求场景
                      <RuleManualDimensionSourceTag
                        record={feedback}
                        dimension="requestScene"
                        title="请求场景来源（规则或人工）"
                      />
                    </span>
                  }
                  className="!mb-3"
                >
                  <Select
                    value={requestScene}
                    optionRender={renderDefinitionSelectOption}
                    options={[
                      { label: TAG_UNRECOGNIZED, value: '', title: '清空后保存为无法识别' },
                      ...mapTaxonomySelectOptions(taxonomy?.requestScenes, 'requestScene', taxonomy),
                    ]}
                    onChange={setRequestScene}
                  />
                </Form.Item>
                <Form.Item
                  label={
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      {isComplaintTicket(feedback) ? '问题类型（打标）' : '问题类型'}
                      <RuleManualDimensionSourceTag
                        record={feedback}
                        dimension="problemType"
                        title="问题类型来源（规则或人工）"
                      />
                    </span>
                  }
                  className="!mb-3"
                >
                  <Select
                    value={problemType}
                    optionRender={renderDefinitionSelectOption}
                    options={[
                      { label: TAG_UNRECOGNIZED, value: '', title: '清空后保存为无法识别' },
                      ...mapTaxonomySelectOptions(taxonomy?.problemTypes, 'problemType', taxonomy),
                    ]}
                    onChange={setProblemType}
                  />
                </Form.Item>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Form.Item
                  label={
                    <span className="inline-flex flex-wrap items-center gap-1.5">
                      用户旅程（一级）
                      <JourneySourceTag record={feedback} />
                    </span>
                  }
                  className="!mb-3"
                >
                  <Select
                    value={journeyL1}
                    optionRender={renderDefinitionSelectOption}
                    options={[
                      { label: TAG_UNRECOGNIZED, value: '', title: '清空后保存为无法识别' },
                      ...(taxonomy?.journeys || []).map((j) => {
                        const def = resolveTagDefinition({
                          dimension: 'journey',
                          journeyL1: j.label,
                          taxonomy,
                        })
                        return { label: j.label, value: j.label, title: def.body }
                      }),
                    ]}
                    onChange={(value) => {
                      setJourneyL1(value)
                      setJourneyL2('')
                    }}
                  />
                </Form.Item>
                <Form.Item
                  label="用户旅程（二级）"
                  className="!mb-3"
                  extra={
                    <Typography.Text type="secondary" className="text-xs">
                      列表与导出中的「旅程标签」与此处二级环节一致；无二级时取一级。
                    </Typography.Text>
                  }
                >
                  <Select
                    value={journeyL2}
                    disabled={!journeyL1}
                    optionRender={renderDefinitionSelectOption}
                    options={[
                      { label: TAG_UNRECOGNIZED, value: '', title: '清空后保存为无法识别' },
                      ...l2Options.map((c) => {
                        const def = resolveTagDefinition({
                          dimension: 'journey',
                          journeyL1,
                          journeyL2: c.label,
                          taxonomy,
                        })
                        return { label: c.label, value: c.label, title: def.body }
                      }),
                    ]}
                    onChange={setJourneyL2}
                  />
                </Form.Item>
              </div>
              <Form.Item
                label={
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    用户情绪
                    <RuleManualDimensionSourceTag
                      record={feedback}
                      dimension="sentiment"
                      title="用户情绪来源（规则或人工）"
                    />
                  </span>
                }
                className="!mb-2"
              >
                <Select
                  value={sentiment}
                  optionRender={renderDefinitionSelectOption}
                  options={sentimentSelectOptions}
                  onChange={setSentiment}
                />
              </Form.Item>
              <Form.Item className="!mb-0">
                <Checkbox
                  checked={urgencyLevel === 'high'}
                  onChange={(e) => setUrgencyLevel(e.target.checked ? 'high' : 'none')}
                >
                  加急 / 催促
                </Checkbox>
                <Typography.Text type="secondary" className="ml-1 text-xs">
                  与主情绪独立；强调时效、催办或业务影响时可勾选
                </Typography.Text>
              </Form.Item>
            </Form>
          ) : (
            <Descriptions column={1} size="small" bordered>
              <Descriptions.Item label="请求场景">
                {requestScene || TAG_UNRECOGNIZED}
              </Descriptions.Item>
              <Descriptions.Item
                label={isComplaintTicket(feedback) ? '问题类型（打标）' : '问题类型'}
              >
                {problemType || TAG_UNRECOGNIZED}
              </Descriptions.Item>
              <Descriptions.Item label="用户旅程">{journeyDisplay}</Descriptions.Item>
              <Descriptions.Item label="用户情绪">
                {getSentimentDisplayLabel({ ...feedback, sentiment, urgencyLevel })}
              </Descriptions.Item>
            </Descriptions>
          )}
        </Card>

        {/* B2 · 投诉原因（终判） */}
        {isComplaintTicket(feedback) && (
          <Card title="投诉原因（终判）" size="small" className="!bg-ink-50/50">
            <Typography.Text type="secondary" className="mb-2 block text-xs">
              来自工单系统终判字段，不参与上方「问题类型（打标）」自动打标。
            </Typography.Text>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="一级（终判）">
                {getComplaintCauseL1Display(feedback)}
              </Descriptions.Item>
              <Descriptions.Item label="二级（终判）">
                {feedback.complaintCauseL2Final?.trim() || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="三级（终判）">
                {feedback.complaintCauseL3Final?.trim() || '—'}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        )}

        {/* C · 分析内容区 */}
        <Card
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="shrink-0">客户请求内容</span>
              <Typography.Text type="secondary" className="text-xs font-normal">
                工单全流程中客户核心诉求的精炼摘要（≤80 字，最长 120）。
              </Typography.Text>
              <CustomerRequestSourceTag record={feedback} />
            </span>
          }
          size="small"
        >
          {canEdit ? (
            <Input.TextArea
              rows={2}
              placeholder="默认为空"
              maxLength={CUSTOMER_REQUEST_MANUAL_MAX_LENGTH}
              showCount
              value={customerRequest}
              onChange={(e) => {
                setCustomerRequest(
                  normalizeManualCustomerRequest(e.target.value),
                )
              }}
            />
          ) : (
            <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
              {getDisplayCustomerRequest(feedback) || '—'}
            </Typography.Paragraph>
          )}
        </Card>

        <Card
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="shrink-0">需求痛点挖掘</span>
              <Typography.Text type="secondary" className="text-xs font-normal">
                从客户表述中提炼最核心的未满足诉求或问题本质（≤60 字，最长 80）。
              </Typography.Text>
              <PainPointSourceTag record={feedback} />
            </span>
          }
          size="small"
        >
          {canEdit ? (
            <Input.TextArea
              rows={2}
              placeholder="默认为空"
              maxLength={PAIN_POINT_MANUAL_MAX_LENGTH}
              showCount
              value={painPoint}
              onChange={(e) => {
                setPainPoint(normalizeManualPainPoint(e.target.value))
              }}
            />
          ) : (
            <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
              {getDisplayPainPoint(feedback) || '—'}
            </Typography.Paragraph>
          )}
        </Card>

        <Card title="优化建议" size="small">
          <div className="mb-2 inline-flex flex-wrap items-center gap-2">
            <Typography.Text strong className="text-xs">
              {/* 优化建议 · 自动生成 */}
              自动生成
            </Typography.Text>
            <AutoOptimizationSourceTag record={feedback} />
          </div>
          <Descriptions
            column={1}
            size="small"
            bordered
            items={[
              {
                key: 'product',
                label: '产品/技术优化（自动）',
                children: feedback.optimizationProduct?.trim() || '—',
              },
              ...(optimizationServiceText
                ? [
                    {
                      key: 'service',
                      label: '服务/流程改进（自动）',
                      children: optimizationServiceText,
                    },
                  ]
                : []),
            ]}
          />

          {canEdit ? (
            <div className="mt-4 space-y-4">
              <div className="space-y-3">
                <Typography.Text strong className="block text-xs">
                  {/* 优化建议 · 人工复核 */}
                  人工复核
                </Typography.Text>
                <Form layout="vertical">
                  <Form.Item label="产品组优化建议" className="!mb-3">
                    <Input.TextArea
                      rows={2}
                      placeholder="默认为空"
                      maxLength={DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH}
                      showCount
                      value={productGroupOptimization}
                      onChange={(e) => {
                        setProductGroupOptimization(
                          e.target.value.slice(0, DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH),
                        )
                      }}
                    />
                  </Form.Item>
                  <Form.Item label="设计师优化建议" className="!mb-0">
                    <Input.TextArea
                      rows={2}
                      placeholder="默认为空"
                      maxLength={DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH}
                      showCount
                      value={designerOptimization}
                      onChange={(e) => {
                        setDesignerOptimization(
                          e.target.value.slice(0, DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH),
                        )
                      }}
                    />
                  </Form.Item>
                </Form>
              </div>

              <div className="space-y-3">
                <Typography.Text strong className="block text-xs">
                  {/* 优化建议 · 确立举措 */}
                  确立举措
                </Typography.Text>
                <Form layout="vertical">
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <Typography.Text className="shrink-0 text-sm after:content-[':']">
                      从举措库选择
                    </Typography.Text>
                    <div className="min-w-0 flex-1">
                      <ActionItemSelect
                        value={actionId || undefined}
                        productKey={feedback.productKey || feedback.taxonomyKey}
                        disabled={saving}
                        onSelect={(item) => {
                          setActionId(item.id)
                          setEstablishedAction(item.content)
                          setActionSchedule(item.scheduleAt || '')
                          setLinkedFromLibrary(true)
                        }}
                        onClear={() => {
                          setActionId('')
                          setEstablishedAction('')
                          setActionSchedule('')
                          setLinkedFromLibrary(false)
                        }}
                      />
                    </div>
                  </div>
                  <Form.Item label="举措内容" className="!mb-3">
                    <Input.TextArea
                      rows={3}
                      placeholder="默认为空"
                      maxLength={ESTABLISHED_ACTION_MAX_LENGTH}
                      showCount
                      disabled={libraryLinked || saving}
                      value={establishedAction}
                      onChange={(e) => {
                        setEstablishedAction(
                          e.target.value.slice(0, ESTABLISHED_ACTION_MAX_LENGTH),
                        )
                      }}
                    />
                  </Form.Item>
                  <Form.Item label="排期" className="!mb-0">
                    <DatePicker
                      className="w-full"
                      format="YYYY-MM-DD"
                      placeholder="留空 = 待评估"
                      value={schedulePickerValue}
                      disabled={libraryLinked || saving}
                      allowClear={!libraryLinked}
                      onChange={(date) =>
                        setActionSchedule(date ? date.format('YYYY-MM-DD') : '')
                      }
                    />
                  </Form.Item>
                </Form>
              </div>
            </div>
          ) : (
            <>
              {hasDetailOptimizationContent(feedback) && (
                <Descriptions
                  className="mt-4"
                  column={1}
                  size="small"
                  bordered
                  title="人工复核"
                  items={[
                    ...(feedback.productGroupOptimization?.trim()
                      ? [
                          {
                            key: 'productGroup',
                            label: '产品组优化建议',
                            children: feedback.productGroupOptimization.trim(),
                          },
                        ]
                      : []),
                    ...(feedback.designerOptimization?.trim()
                      ? [
                          {
                            key: 'designer',
                            label: '设计师优化建议',
                            children: feedback.designerOptimization.trim(),
                          },
                        ]
                      : []),
                  ]}
                />
              )}
              {(getEstablishedActionDisplay(feedback) || feedback.actionSchedule?.trim()) && (
                <div className="mt-4 space-y-2">
                  <Typography.Text strong className="block text-xs">
                    确立举措
                  </Typography.Text>
                  <Descriptions
                    column={1}
                    size="small"
                    bordered
                    items={[
                      {
                        key: 'content',
                        label: '举措内容',
                        children: getEstablishedActionDisplay(feedback) || '—',
                      },
                      {
                        key: 'schedule',
                        label: '排期',
                        children: getActionScheduleDisplay(feedback.actionSchedule),
                      },
                    ]}
                  />
                </div>
              )}
            </>
          )}
        </Card>

        {/* D · 处理与备注 */}
        <Card title="处理意见（工单原文）" size="small">
          <Typography.Paragraph className="!mb-0 max-h-60 overflow-y-auto whitespace-pre-wrap">
            {handlingOriginalText || '—'}
          </Typography.Paragraph>
          <Typography.Text type="secondary" className="mt-2 block text-xs">
            优先展示「处理意见」列；若为「无/不涉及」等占位或无内容，则展示「受理内容」。
          </Typography.Text>
        </Card>

        <Card title="根因排查" size="small">
          {canEdit ? (
            <>
              <Typography.Text type="secondary" className="mb-2 block text-xs">
                {isRootCauseReviewManuallyMaintained(feedback)
                  ? '已人工复核；重新打标默认保留此维度。'
                  : '默认展示工单「问题原因」或结构化根因；编辑并保存后将作为人工复核值写入。'}
              </Typography.Text>
              <Input.TextArea
                rows={3}
                placeholder="默认为空"
                maxLength={ROOT_CAUSE_REVIEW_MAX_LENGTH}
                showCount
                value={rootCauseReview}
                onChange={(e) => {
                  setRootCauseReviewTouched(true)
                  setRootCauseReview(
                    e.target.value.slice(0, ROOT_CAUSE_REVIEW_MAX_LENGTH),
                  )
                }}
              />
            </>
          ) : (
            <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
              {getRootCauseReviewDraftDisplay(feedback) || '—'}
            </Typography.Paragraph>
          )}
        </Card>

        <div>
          <Typography.Text strong className="text-xs">备注</Typography.Text>
          <Input.TextArea className="mt-1" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <RecordConflictModal
        open={conflictOpen}
        ticketLabel={feedback.ticketId || feedback.id}
        serverRecord={conflictServerRecord}
        draftRecord={buildDraftRecord()}
        onReloadLatest={handleReloadLatestAfterConflict}
        onForceSave={handleForceSaveAfterConflict}
        onCancel={() => setConflictOpen(false)}
        forceSaving={forceSaving}
        canForceSave={canEdit}
      />
    </Drawer>
  )
}
