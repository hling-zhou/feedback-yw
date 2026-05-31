import { useState, useEffect, useMemo } from 'react'
import {
  Button,
  Card,
  Checkbox,
  Descriptions,
  Drawer,
  Form,
  Input,
  message,
  Select,
  Tooltip,
  Typography,
} from 'antd'
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
  getComplaintCauseL1Display,
  isComplaintTicket,
} from '../domain/complaintCause.js'
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
  const [manualReviewOptimization, setManualReviewOptimization] = useState(
    feedback?.manualReviewOptimization || '',
  )
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
    setManualReviewOptimization(feedback.manualReviewOptimization || '')
  }, [feedback])

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

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const journey = { journeyL1, journeyL2 }
      await updateFeedback(feedback.id, {
        note,
        themes: themesFromJourney(journey),
        sentiment,
        urgencyLevel,
        requestScene,
        problemType,
        manualReviewOptimization: manualReviewOptimization.trim(),
        ...journey,
      })
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
        <Typography.Text type="secondary" className="block text-xs leading-snug">
          {ticketMetaLine}
        </Typography.Text>

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

        <Card title="处理意见（工单原文）" size="small">
          <Typography.Paragraph className="!mb-0 max-h-60 overflow-y-auto whitespace-pre-wrap">
            {handlingOriginalText || '—'}
          </Typography.Paragraph>
          <Typography.Text type="secondary" className="mt-2 block text-xs">
            优先展示「处理意见」列；若为空则展示「受理内容」。
          </Typography.Text>
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              客户请求内容
              <CustomerRequestSourceTag record={feedback} />
            </span>
          }
          size="small"
        >
          <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
            {getDisplayCustomerRequest(feedback) || '—'}
          </Typography.Paragraph>
          <Typography.Text type="secondary" className="mt-2 block text-xs">
            工单全流程中客户核心诉求的精炼摘要（≤80 字，最长 120）。
          </Typography.Text>
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              需求痛点挖掘
              <PainPointSourceTag record={feedback} />
            </span>
          }
          size="small"
        >
          <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
            {getDisplayPainPoint(feedback) || '—'}
          </Typography.Paragraph>
          <Typography.Text type="secondary" className="mt-2 block text-xs">
            从客户表述中提炼最核心的未满足诉求或问题本质（≤60 字，最长 80）。
          </Typography.Text>
        </Card>

        <Card
          title={
            <span className="inline-flex items-center gap-2">
              优化建议
              <OptimizationSourceTag record={feedback} />
            </span>
          }
          size="small"
        >
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
          {canEdit && (
            <Form layout="vertical" className="mt-3">
              <Typography.Text strong className="mb-2 block text-xs">
                人工复核后的优化建议
              </Typography.Text>
              <Typography.Text type="secondary" className="mb-2 block text-xs">
                若有人工复核后的优化建议，原优化建议不参与后续的聚类分析，以人工复核后的优化建议为准。
              </Typography.Text>
              <Form.Item className="!mb-0">
                <Input.TextArea
                  rows={3}
                  placeholder="默认为空"
                  value={manualReviewOptimization}
                  onChange={(e) => setManualReviewOptimization(e.target.value)}
                />
              </Form.Item>
            </Form>
          )}
          {!canEdit && manualReviewOptimization.trim() && (
            <div className="mt-3">
              <Typography.Text strong className="mb-2 block text-xs">
                人工复核后的优化建议
              </Typography.Text>
              <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
                {manualReviewOptimization.trim()}
              </Typography.Paragraph>
            </div>
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
