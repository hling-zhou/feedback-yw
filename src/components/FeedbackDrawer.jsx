import { useState, useEffect, useMemo } from 'react'
import {
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
import { useFeedbacks } from '../context/FeedbackContext.jsx'
import { RETAG_IN_PROGRESS_TIP } from '../lib/retagSession.js'
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
import { CustomerRequestSourceTag, PainPointSourceTag, OptimizationSourceTag } from './tags/TicketAnalysisSourceTag.jsx'
import { renderDefinitionSelectOption } from './tags/DefinitionSelectOption.jsx'
import { themesFromJourney } from '../lib/applyThemes.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import {
  extractHandlingOriginalTextFromFields,
} from '../lib/taggingText.js'
import {
  buildCustomerRequestManualSavePatch,
  buildPainPointManualSavePatch,
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
import { persistEstablishedActionForTicket, syncFirstTicketSnapshotsForRecord } from '../lib/establishedActionPersist.js'
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
import { useAuth } from '../context/AuthContext.jsx'

export default function FeedbackDrawer({ feedback: selected, onClose }) {
  const { feedbacks, updateFeedback, reprocessOne, retagSession } = useFeedbacks()
  const { can } = useAuth()
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

  const taxonomy = useMemo(
    () => (feedback ? getTaxonomyForRecord(feedback) : null),
    [feedback],
  )

  const handlingOriginalText = useMemo(() => {
    if (!feedback) return ''
    return extractHandlingOriginalTextFromFields({
      handlingText: feedback.handlingText,
      rawText: feedback.rawText,
      sourceColumns: feedback.sourceColumns,
    })
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

  useEffect(() => {
    if (!feedback) return
    setNote(feedback.note || '')
    setSentiment(normalizeSentiment(feedback.sentiment))
    setUrgencyLevel(normalizeUrgencyLevel(feedback.urgencyLevel, feedback.sentiment))
    setRequestScene(feedback.requestScene || '')
    setProblemType(feedback.problemType || '')
    setJourneyL1(feedback.journeyL1 || '')
    setJourneyL2(feedback.journeyL2 || '')
    setEstablishedAction(getEstablishedActionDisplay(feedback))
    setActionId(feedback.actionId?.trim() || '')
    setLinkedFromLibrary(Boolean(feedback.actionId?.trim()))
    setCustomerRequest(getCustomerRequestDraftDisplay(feedback))
    setPainPoint(getPainPointDraftDisplay(feedback))
    setActionSchedule(feedback.actionSchedule || '')
    setProductGroupOptimization(feedback.productGroupOptimization || '')
    setDesignerOptimization(feedback.designerOptimization || '')
    setRootCauseReview(getRootCauseReviewDraftDisplay(feedback))
    setRootCauseReviewTouched(false)
  }, [feedback])

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

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const journey = { journeyL1, journeyL2 }
      const patch = {
        note,
        themes: themesFromJourney(journey),
        sentiment,
        urgencyLevel,
        requestScene,
        problemType,
        ...buildCustomerRequestManualSavePatch(customerRequest),
        ...buildPainPointManualSavePatch(painPoint),
        ...buildDetailOptimizationSavePatch({
          productGroupOptimization,
          designerOptimization,
        }),
        ...journey,
      }
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
      await updateFeedback(feedback.id, patch)
      const merged = { ...feedback, ...patch }
      if (merged.actionId?.trim()) {
        await syncFirstTicketSnapshotsForRecord(merged)
      }
      const label = feedback.ticketId ? `工单 ${feedback.ticketId}` : '工单'
      message.success(`${label} 已保存`)
      onClose()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  const bulkRetagActive = retagSession.active
  const manualTagHint = formatManualTagFieldsHint(feedback)

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
              <Tooltip
                title={
                  bulkRetagActive
                    ? RETAG_IN_PROGRESS_TIP
                    : manualTagHint
                      ? `重新打标将保留人工维护的：${manualTagHint}`
                      : undefined
                }
              >
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
              <Button type="primary" className="flex-1" loading={saving} onClick={save}>
                保存
              </Button>
            )}
          </div>
        ) : null
      }
    >
      <div className="space-y-4">
        {/* A · 基础信息 */}
        <Typography.Text type="secondary" className="block text-xs leading-snug">
          {ticketMetaLine}
        </Typography.Text>

        {/* B1 · 工单分类 */}
        <Card title="工单分类" size="small">
          {canEdit ? (
            <Form layout="vertical">
              <div className="grid gap-3 sm:grid-cols-2">
                <Form.Item label="请求场景" className="!mb-3">
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
                  label={isComplaintTicket(feedback) ? '问题类型（打标）' : '问题类型'}
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
                <Form.Item label="用户旅程（一级）" className="!mb-3">
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
              <Form.Item label="用户情绪" className="!mb-2">
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
          <Typography.Text type="secondary" className="mt-2 block text-xs">
            支持人工复核修改
          </Typography.Text>
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
            <>
              <Typography.Text type="secondary" className="mb-2 block text-xs">
                人工编辑并保存后，批量/单条重新打标默认保留此维度。
              </Typography.Text>
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
            </>
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
            <>
              <Typography.Text type="secondary" className="mb-2 block text-xs">
                人工编辑并保存后，批量/单条重新打标默认保留此维度。
              </Typography.Text>
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
            </>
          ) : (
            <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
              {getDisplayPainPoint(feedback) || '—'}
            </Typography.Paragraph>
          )}
        </Card>

        <Card title="优化建议" size="small">
          <Typography.Text strong className="mb-2 block text-xs">
            {/* 优化建议 · 自动生成 */}
            自动生成
          </Typography.Text>
          <div className="mb-1">
            <OptimizationSourceTag record={feedback} />
          </div>
          <Descriptions
            column={1}
            size="small"
            bordered
            items={[
              {
                key: 'product',
                label: '产品/技术优化',
                children: feedback.optimizationProduct?.trim() || '—',
              },
              ...(optimizationServiceText
                ? [
                    {
                      key: 'service',
                      label: '服务/流程改进',
                      children: optimizationServiceText,
                    },
                  ]
                : []),
            ]}
          />

          {canEdit ? (
            <div className="mt-4 space-y-3">
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
                <Form.Item label="设计师优化建议" className="!mb-3">
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
                <Form.Item label="从举措库选择" className="!mb-3">
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
                      setLinkedFromLibrary(false)
                    }}
                  />
                </Form.Item>
                <Form.Item label="确立举措" className="!mb-3">
                  <Input.TextArea
                    rows={3}
                    placeholder="默认为空"
                    maxLength={ESTABLISHED_ACTION_MAX_LENGTH}
                    showCount
                    readOnly={libraryLinked}
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
                <div className="mt-3">
                  <Typography.Text strong className="mb-2 block text-xs">
                    确立举措
                  </Typography.Text>
                  <Typography.Paragraph className="!mb-2 whitespace-pre-wrap">
                    {getEstablishedActionDisplay(feedback) || '—'}
                  </Typography.Paragraph>
                  <Typography.Text strong className="mb-1 block text-xs">
                    排期
                  </Typography.Text>
                  <Typography.Text className="block text-sm">
                    {getActionScheduleDisplay(feedback.actionSchedule)}
                  </Typography.Text>
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
            优先展示「处理意见」列；若为空则展示「受理内容」。
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
    </Drawer>
  )
}
