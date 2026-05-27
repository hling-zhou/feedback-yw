import { useState, useEffect, useMemo } from 'react'
import {
  Alert,
  Button,
  Card,
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
import { normalizeSentiment, SENTIMENT_LABELS } from '../lib/sentiment.js'
import { getTaxonomyForRecord } from '../lib/productTaxonomy.js'
import { mapTaxonomySelectOptions, resolveTagDefinition } from '../lib/tagDefinitions.js'
import DimensionTag from './tags/DimensionTag.jsx'
import JourneyTags from './tags/JourneyTags.jsx'
import SentimentTagWithTooltip from './tags/SentimentTagWithTooltip.jsx'
import { renderDefinitionSelectOption } from './tags/DefinitionSelectOption.jsx'
import { themesFromJourney } from '../lib/applyThemes.js'
import {
  extractAppendTextForDisplay,
  extractHandlingTextFromFields,
} from '../lib/taggingText.js'
import { buildTicketDetailDisplay } from '../lib/ticketDetailDisplay.js'
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
  const [requestScene, setRequestScene] = useState(feedback?.requestScene || '')
  const [problemType, setProblemType] = useState(feedback?.problemType || '')
  const [journeyL1, setJourneyL1] = useState(feedback?.journeyL1 || '')
  const [journeyL2, setJourneyL2] = useState(feedback?.journeyL2 || '')
  const [manualReviewRootCause, setManualReviewRootCause] = useState(
    feedback?.manualReviewRootCause || '',
  )
  const [manualReviewSolution, setManualReviewSolution] = useState(
    feedback?.manualReviewSolution || '',
  )
  const [manualReviewAction, setManualReviewAction] = useState(feedback?.manualReviewAction || '')
  const [retagging, setRetagging] = useState(false)
  const [saving, setSaving] = useState(false)

  const taxonomy = useMemo(
    () => (feedback ? getTaxonomyForRecord(feedback) : null),
    [feedback],
  )

  const ticketSourceTexts = useMemo(() => {
    if (!feedback) {
      return {
        handlingText: '',
        appendInfo: '',
        customerRequestText: '',
        solutionAndResultText: '',
      }
    }
    const fields = {
      handlingText: feedback.handlingText,
      rawText: feedback.rawText,
      customerQuote: feedback.customerQuote,
      responseText: feedback.responseText,
      solutionSummary: feedback.solutionSummary,
      sourceColumns: feedback.sourceColumns,
    }
    const detail = buildTicketDetailDisplay(feedback)
    return {
      handlingText: extractHandlingTextFromFields(fields),
      appendInfo: extractAppendTextForDisplay(fields),
      customerRequestText: detail.customerRequestText,
      solutionAndResultText: detail.solutionAndResultText,
    }
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
    setRequestScene(feedback.requestScene || '')
    setProblemType(feedback.problemType || '')
    setJourneyL1(feedback.journeyL1 || '')
    setJourneyL2(feedback.journeyL2 || '')
    setManualReviewRootCause(feedback.manualReviewRootCause || '')
    setManualReviewSolution(feedback.manualReviewSolution || '')
    setManualReviewAction(feedback.manualReviewAction || '')
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
        requestScene,
        problemType,
        manualReviewRootCause: manualReviewRootCause.trim(),
        manualReviewSolution: manualReviewSolution.trim(),
        manualReviewAction: manualReviewAction.trim(),
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
        <div className="flex flex-wrap gap-2">
          <SentimentTagWithTooltip sentiment={feedback.sentiment} />
          <DimensionTag
            dimension="requestScene"
            label={requestScene}
            displayLabel={requestScene || '未分类'}
            taxonomy={taxonomy}
            color="blue"
          />
          <DimensionTag
            dimension="problemType"
            label={problemType}
            displayLabel={problemType || '未分类'}
            taxonomy={taxonomy}
          />
          <JourneyTags journeyL1={journeyL1} journeyL2={journeyL2} taxonomy={taxonomy} max={6} />
        </div>

        <Card title="打标维度" size="small">
          <Form layout="vertical">
            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item label="请求场景" className="!mb-3">
                <Select
                  value={requestScene}
                  optionRender={renderDefinitionSelectOption}
                  options={[
                    { label: '未分类', value: '', title: '清空后保存为未分类' },
                    ...mapTaxonomySelectOptions(taxonomy?.requestScenes, 'requestScene', taxonomy),
                  ]}
                  onChange={setRequestScene}
                />
              </Form.Item>
              <Form.Item label="问题类型" className="!mb-3">
                <Select
                  value={problemType}
                  optionRender={renderDefinitionSelectOption}
                  options={[
                    { label: '未分类', value: '', title: '清空后保存为未分类' },
                    ...mapTaxonomySelectOptions(taxonomy?.problemTypes, 'problemType', taxonomy),
                  ]}
                  onChange={setProblemType}
                />
              </Form.Item>
              <Form.Item label="资源池" className="!mb-3">
                <Typography.Text>{feedback.resourcePool || '—'}</Typography.Text>
              </Form.Item>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Form.Item label="用户旅程（一级）" className="!mb-3">
                <Select
                  value={journeyL1}
                  optionRender={renderDefinitionSelectOption}
                  options={[
                    { label: '未识别', value: '', title: '清空后保存为未识别' },
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
                label="用户旅程（二级 · 即旅程标签）"
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
                    { label: '未识别', value: '', title: '清空后保存为未识别' },
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
          </Form>

          <Descriptions
            column={1}
            size="small"
            items={[
              { key: 'problem', label: '问题摘要', children: feedback.problemSummary || '—' },
              { key: 'solution', label: '解决方案（平台）', children: feedback.solutionSummary || '—' },
              { key: 'rootCause', label: '根因（平台）', children: feedback.rootCause || '—' },
              {
                key: 'llmSuggestion',
                label: '优化建议（平台）',
                children: feedback.optimizationSuggestion || '—',
              },
            ]}
          />
          <Form layout="vertical" className="mt-3">
            <Typography.Text strong className="mb-2 block text-xs">
              人工复核
            </Typography.Text>
            <Form.Item label="根因（人工复核）" className="!mb-3">
              <Input.TextArea
                rows={2}
                placeholder="默认为空"
                value={manualReviewRootCause}
                onChange={(e) => setManualReviewRootCause(e.target.value)}
              />
            </Form.Item>
            <Form.Item label="优化方案（人工复核）" className="!mb-3">
              <Input.TextArea
                rows={2}
                placeholder="默认为空"
                value={manualReviewSolution}
                onChange={(e) => setManualReviewSolution(e.target.value)}
              />
            </Form.Item>
            <Form.Item label="人工复核举措" className="!mb-0">
              <Input.TextArea
                rows={2}
                placeholder="默认为空"
                value={manualReviewAction}
                onChange={(e) => setManualReviewAction(e.target.value)}
              />
            </Form.Item>
          </Form>
        </Card>

        {feedback.ticketId && (
          <Typography.Text type="secondary" className="text-xs">
            工单号 {feedback.ticketId} · {feedback.product}
            {feedback.productSpec && feedback.productSpec !== feedback.product
              ? ` / ${feedback.productSpec}`
              : ''}{' '}
            · {feedback.createdAt}
          </Typography.Text>
        )}

        <div>
          <Typography.Text strong className="text-xs">处理意见（打标依据）</Typography.Text>
          <Typography.Paragraph className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-ink-50 p-3 !text-xs whitespace-pre-wrap">
            {ticketSourceTexts.handlingText || '—'}
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Text strong className="text-xs">追加信息</Typography.Text>
          <Typography.Paragraph className="mt-1 max-h-40 overflow-y-auto rounded-lg bg-ink-50 p-3 !text-xs whitespace-pre-wrap">
            {ticketSourceTexts.appendInfo || '—'}
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Text strong className="text-xs">客户请求</Typography.Text>
          <Typography.Paragraph className="mt-1 rounded-lg bg-brand-50/50 p-3 !text-sm whitespace-pre-wrap">
            {ticketSourceTexts.customerRequestText || '—'}
          </Typography.Paragraph>
        </div>

        <div>
          <Typography.Text strong className="text-xs">
            解决方案&amp;处理结果
            <Typography.Text type="secondary" className="font-normal">
              {' '}
              （来自工单）
            </Typography.Text>
          </Typography.Text>
          <Typography.Paragraph className="mt-1 max-h-48 overflow-y-auto rounded-lg bg-emerald-50/60 p-3 !text-sm whitespace-pre-wrap">
            {ticketSourceTexts.solutionAndResultText || '—'}
          </Typography.Paragraph>
        </div>

        <Form layout="vertical">
          <Form.Item label="情绪" className="!mb-0">
            <Select
              value={sentiment}
              optionRender={renderDefinitionSelectOption}
              options={sentimentSelectOptions}
              onChange={setSentiment}
            />
          </Form.Item>
        </Form>

        <div>
          <Typography.Text strong className="text-xs">备注</Typography.Text>
          <Input.TextArea className="mt-1" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
    </Drawer>
  )
}
