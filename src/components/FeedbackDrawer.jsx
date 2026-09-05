import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  Cascader,
  Collapse,
  Checkbox,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  Modal,
  message,
  Select,
  Switch,
  Tooltip,
  Typography,
} from 'antd'
import { ExpandOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { TICKET_DETAIL_DRAWER_WIDTH } from '../constants/appLayout.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useFeedbacks } from '../context/FeedbackContext.jsx'
import DeleteTicketConfirmModal from './DeleteTicketConfirmModal.jsx'
import { useUserTicketReviews } from '../context/UserTicketReviewContext.jsx'
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
  AutoRootCauseTag,
  CustomerRequestSourceTag,
  JourneySourceTag,
  PainPointSourceTag,
  RuleManualDimensionSourceTag,
} from './tags/TicketAnalysisSourceTag.jsx'
import { renderDefinitionSelectOption } from './tags/DefinitionSelectOption.jsx'
import { themesFromJourney } from '../lib/applyThemes.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import {
  isPostUseRatingLibraryRecord,
  isPostUseNon10LibraryRecord,
} from '../domain/postUseRatingImport.js'
import { enrichPostUseJourneyRecord } from '../lib/postUseRating/enrichPostUseJourney.js'
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
} from '../domain/actionSchedule.js'
import {
  getEstablishedActionDisplay,
  getEstablishedActionDetailDisplay,
} from '../domain/establishedAction.js'
import EstablishedActionFields, {
  getActionItemDisplayScheduleAt,
} from './actions/EstablishedActionFields.jsx'
import { persistEstablishedActionForTicket, syncFirstTicketSnapshotsForRecord, syncLinkedTicketsForActionIds } from '../lib/establishedActionPersist.js'
import { getActionItem } from '../lib/actionItemClient.js'
import {
  buildDetailOptimizationSavePatch,
  DETAIL_OPTIMIZATION_TEXT_MAX_LENGTH,
  hasDetailOptimizationContent,
} from '../domain/detailOptimizationFields.js'
import {
  EMPTY_COMPLAINT_CAUSE_LABEL,
  getComplaintCauseL1Final,
  isComplaintTicket,
} from '../domain/complaintCause.js'
import {
  COMPLAINT_CAUSE_REVIEW_REASON_MAX_LENGTH,
  clearComplaintCauseReviewFields,
  getComplaintCauseReviewDraftDisplay,
  isCompleteComplaintCauseReview,
  isComplaintCauseReviewManuallyMaintained,
  normalizeComplaintCauseReviewInput,
  shouldIncludeComplaintCauseReviewInSave,
} from '../domain/complaintCauseReview.js'
import { getComplaintCauseCascaderOptions } from '../domain/complaintCauseTaxonomy.js'
import { isFollowUpEnrichableRecord } from '../lib/feedbackFilters.js'
import {
  getFollowUpDissatisfiedReasonsDisplay,
  getFollowUpSatisfactionDisplay,
} from '../lib/ticketDetailDisplay.js'
import {
  getAutoRootCauseDisplay,
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
import { areFeedbackDrawerFormSnapshotsEqual } from '../domain/feedbackDrawerDirty.js'
import {
  applyTicketTodoResolutionToItem,
  buildTicketTodoSavePatch,
  createEmptyTicketTodoItem,
  formatTicketTodoAssigneeLabel,
  getTicketTodoDraftItems,
  getTicketTodoResolution,
  isTicketTodoOpen,
  markOpenTicketTodosConvertedWhenEstablishingAction,
  TICKET_TODO_MANUAL_RESOLUTION_SELECT_OPTIONS,
  TICKET_TODO_RESOLUTION_SELECT_OPTIONS,
  TICKET_TODO_TEXT_MAX_LENGTH,
} from '../domain/ticketTodo.js'
import TicketTodoStatusTag from './tags/TicketTodoStatusTag.jsx'
import { apiFetch } from '../lib/apiClient.js'
import { copyTextToClipboard } from '../lib/clipboard.js'
import {
  countHandlingKeywordHitsInGroup,
  defaultExpandedPhaseIds,
  groupHandlingOriginalByPhase,
  mergeHighlightRanges,
  phaseIdsMatchingKeyword,
  segmentHandlingOriginalText,
  shouldUseStructuredHandlingDisplay,
  splitTextWithManualHighlights,
} from '../lib/handlingOriginalDisplay.js'
import {
  hasSeenHandlingExpandWhatsNew,
  markHandlingExpandWhatsNewSeen,
} from '../lib/whatsNew.js'
import { randomId } from '../lib/randomId.js'

const RETAG_DEFAULT_TIP =
  '按当前规则与大模型重新分析本工单，将覆盖：四维标签、客户请求内容、需求痛点、根因排查（自动生成）与优化建议（自动生成）。其他不修改。'

const SAVE_DETAIL_TIP =
  '将当前编辑内容写入本工单，已修改维度将标记为「人工维护」，后续单条/批量重新打标默认保留，不会被自动覆盖。'

const HANDLING_ORIGINAL_TEXT_MODAL_MAX_WIDTH = 1280
const HANDLING_ORIGINAL_TEXT_MODAL_Z_INDEX = 1100
const HANDLING_ORIGINAL_TEXT_MODAL_BODY_MAX_HEIGHT = '78vh'
const HANDLING_PLAIN_GROUP_ID = 'plain'

/**
 * @typedef {{ id: string; groupId: string; itemIndex: number; start: number; end: number }} ManualHighlightRange
 * @typedef {{ groupId: string; itemIndex: number; start: number; end: number }} HandlingHighlightSpan
 * @typedef {{ spans: HandlingHighlightSpan[]; text: string } | null} HandlingTextSelection
 */

/**
 * @param {string} text
 * @param {string} keyword
 * @param {string} [keyPrefix]
 * @returns {import('react').ReactNode}
 */
function highlightHandlingKeyword(text, keyword, keyPrefix = 'k') {
  const value = String(text ?? '')
  const needle = String(keyword ?? '').trim()
  if (!value || !needle) return value
  const lower = value.toLowerCase()
  const needleLower = needle.toLowerCase()
  /** @type {import('react').ReactNode[]} */
  const parts = []
  let start = 0
  let index = lower.indexOf(needleLower)
  let key = 0
  while (index !== -1) {
    if (index > start) parts.push(value.slice(start, index))
    parts.push(
      <mark key={`${keyPrefix}-${key}`} className="rounded-sm bg-amber-200 px-0.5 text-ink-900">
        {value.slice(index, index + needle.length)}
      </mark>,
    )
    key += 1
    start = index + needle.length
    index = lower.indexOf(needleLower, start)
  }
  if (start < value.length) parts.push(value.slice(start))
  return parts.length ? parts : value
}

/**
 * @param {string} text
 * @param {string} keyword
 * @param {{ start: number; end: number }[]} manualRanges
 * @returns {import('react').ReactNode}
 */
function renderHandlingTextWithHighlights(text, keyword, manualRanges) {
  const slices = splitTextWithManualHighlights(text, manualRanges)
  if (slices.length === 1 && !slices[0].manual) {
    return highlightHandlingKeyword(slices[0].text, keyword)
  }
  return slices.map((slice, index) => {
    const inner = highlightHandlingKeyword(slice.text, keyword, `s${index}`)
    if (!slice.manual) return <span key={`slice-${index}`}>{inner}</span>
    return (
      <mark key={`slice-${index}`} className="rounded-sm bg-yellow-200 px-0.5 text-ink-900">
        {inner}
      </mark>
    )
  })
}

/**
 * @param {Node | null | undefined} node
 * @param {Element} root
 */
function offsetWithinElement(root, node, offset) {
  if (!node || !(root === node || root.contains(node))) return null
  try {
    const probe = document.createRange()
    probe.selectNodeContents(root)
    probe.setEnd(node, offset)
    return probe.toString().length
  } catch {
    return null
  }
}

/**
 * @param {Element} host
 * @returns {HandlingHighlightSpan | null}
 */
function highlightSpanFromHost(host, start, end) {
  if (start == null || end == null || end <= start) return null
  const groupId = String(host.getAttribute('data-handling-group-id') || '')
  const itemIndex = Number(host.getAttribute('data-handling-item-index'))
  if (!groupId || Number.isNaN(itemIndex) || itemIndex < 0) return null
  return { groupId, itemIndex, start, end }
}

/**
 * @param {Element} root
 * @param {Range} range
 * @returns {Element[]}
 */
function handlingHostsIntersectingRange(root, range) {
  return [...root.querySelectorAll('[data-handling-group-id][data-handling-item-index]')].filter(
    (host) => {
      try {
        return range.intersectsNode(host)
      } catch {
        return false
      }
    },
  )
}

/**
 * @param {Element} host
 * @param {Range} range
 * @param {boolean} isFirst
 * @param {boolean} isLast
 * @returns {{ start: number; end: number } | null}
 */
function selectionOffsetsInHost(host, range, isFirst, isLast) {
  const fullEnd = host.textContent?.length || 0
  if (!fullEnd) return null

  let start = 0
  let end = fullEnd

  if (isFirst && (host === range.startContainer || host.contains(range.startContainer))) {
    const offset = offsetWithinElement(host, range.startContainer, range.startOffset)
    if (offset == null) return null
    start = offset
  }
  if (isLast && (host === range.endContainer || host.contains(range.endContainer))) {
    const offset = offsetWithinElement(host, range.endContainer, range.endOffset)
    if (offset == null) return null
    end = offset
  }

  if (end <= start) return null
  return { start, end }
}

/**
 * 读取左侧原文选区；同一段落或多段/跨行选中均可得到可高亮的 spans。
 *
 * @param {ParentNode | null | undefined} scope
 * @returns {HandlingTextSelection}
 */
function readHandlingTextSelection(scope) {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const selectedText = selection.toString()
  if (!selectedText.trim()) return null
  const range = selection.getRangeAt(0)
  if (scope && (!scope.contains(range.startContainer) || !scope.contains(range.endContainer))) {
    return null
  }

  const root =
    scope instanceof Element
      ? scope
      : range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? /** @type {Element} */ (range.commonAncestorContainer)
        : range.commonAncestorContainer.parentElement
  if (!root) return { spans: [], text: selectedText }

  const hosts = handlingHostsIntersectingRange(root, range)
  /** @type {HandlingHighlightSpan[]} */
  const spans = []
  hosts.forEach((host, index) => {
    const offsets = selectionOffsetsInHost(host, range, index === 0, index === hosts.length - 1)
    if (!offsets) return
    const span = highlightSpanFromHost(host, offsets.start, offsets.end)
    if (span) spans.push(span)
  })

  return { spans, text: selectedText }
}

/**
 * @param {{
 *   item: import('../lib/handlingOriginalDisplay.js').HandlingOriginalSegment
 *   keyword: string
 *   index: number
 *   groupId: string
 *   manualRanges: { start: number; end: number }[]
 * }} props
 */
function HandlingOriginalSegmentBlock({ item, keyword, index, groupId, manualRanges }) {
  const bodyProps = {
    'data-handling-group-id': groupId,
    'data-handling-item-index': String(index),
  }
  if (item.kind === 'field') {
    return (
      <div className="space-y-1">
        <Typography.Text type="secondary" className="block text-xs">
          {highlightHandlingKeyword(item.label || '', keyword)}
        </Typography.Text>
        <Typography.Paragraph
          className="!mb-0 whitespace-pre-wrap"
          {...bodyProps}
        >
          {renderHandlingTextWithHighlights(item.text, keyword, manualRanges)}
        </Typography.Paragraph>
      </div>
    )
  }
  return (
    <Typography.Paragraph className="!mb-0 whitespace-pre-wrap" {...bodyProps}>
      {renderHandlingTextWithHighlights(item.text, keyword, manualRanges)}
    </Typography.Paragraph>
  )
}

const TICKET_DETAIL_SECTIONS = [
  { id: 'ticket-detail-content', label: '工单内容' },
  { id: 'ticket-detail-analysis', label: '工单分析' },
  { id: 'ticket-detail-classification', label: '工单分类' },
]

const RATING_DETAIL_SECTIONS = [
  { id: 'rating-detail-content', label: '评价内容' },
  { id: 'rating-detail-analysis', label: '评价分析' },
  { id: 'rating-detail-classification', label: '评价分类' },
]

function scrollToTicketDetailSection(sectionId) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function TicketDetailSectionNav({ postUse = false }) {
  const sections = postUse ? RATING_DETAIL_SECTIONS : TICKET_DETAIL_SECTIONS
  return (
    <nav
      aria-label={postUse ? '评价详情分区导航' : '工单详情分区导航'}
      className="flex min-w-0 flex-wrap items-center justify-center gap-x-1"
    >
      {sections.map((section, index) => (
        <span key={section.id} className="inline-flex items-center">
          {index > 0 ? (
            <Typography.Text type="secondary" className="mx-1 text-xs">
              |
            </Typography.Text>
          ) : null}
          <Button
            type="link"
            size="small"
            className="!h-auto !px-0 !py-0 text-sm font-normal"
            onClick={() => scrollToTicketDetailSection(section.id)}
          >
            {section.label}
          </Button>
        </span>
      ))}
    </nav>
  )
}

/**
 * @param {{
 *   open: boolean
 *   onClose: () => void
 *   ticketId: string
 *   text: string
 *   showWhatsNew?: boolean
 *   onDismissWhatsNew?: () => void
 * }} props
 */
function HandlingOriginalTextModal({
  open,
  onClose,
  ticketId,
  text,
  showWhatsNew = false,
  onDismissWhatsNew,
}) {
  const bodyScrollRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const leftPaneRef = useRef(/** @type {HTMLDivElement | null} */ (null))
  const [locateKeyword, setLocateKeyword] = useState('')
  const [expandedIds, setExpandedIds] = useState(/** @type {string[]} */ ([]))
  const [locateHint, setLocateHint] = useState(/** @type {string | null} */ (null))
  const [highlights, setHighlights] = useState(/** @type {ManualHighlightRange[]} */ ([]))
  const [excerpt, setExcerpt] = useState('')
  const [activeSelection, setActiveSelection] = useState(/** @type {HandlingTextSelection} */ (null))
  const [selectionBubble, setSelectionBubble] = useState(
    /** @type {{ top: number; left: number } | null} */ (null),
  )
  const copyHostRef = useRef(/** @type {HTMLDivElement | null} */ (null))

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(text, { container: copyHostRef.current })
    if (ok) message.success('已复制全文')
    else message.error('复制失败，请手动选择复制')
  }

  const segments = useMemo(() => segmentHandlingOriginalText(text), [text])
  const structured = shouldUseStructuredHandlingDisplay(segments)
  const groups = useMemo(
    () => (structured ? groupHandlingOriginalByPhase(segments) : []),
    [structured, segments],
  )

  useEffect(() => {
    if (!open) return
    setLocateKeyword('')
    setLocateHint(null)
    setHighlights([])
    setExcerpt('')
    setActiveSelection(null)
    setSelectionBubble(null)
    setExpandedIds(defaultExpandedPhaseIds(groups))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- groups derived from text
  }, [open, text])

  useEffect(() => {
    if (!open) return
    const scroller = bodyScrollRef.current
    const hideBubble = () => setSelectionBubble(null)
    scroller?.addEventListener('scroll', hideBubble, { passive: true })
    window.addEventListener('scroll', hideBubble, true)
    return () => {
      scroller?.removeEventListener('scroll', hideBubble)
      window.removeEventListener('scroll', hideBubble, true)
    }
  }, [open])

  const hitCountById = useMemo(() => {
    /** @type {Record<string, number>} */
    const map = {}
    const needle = locateKeyword.trim()
    if (!needle) return map
    for (const group of groups) {
      map[group.id] = countHandlingKeywordHitsInGroup(group, needle)
    }
    return map
  }, [groups, locateKeyword])

  const rangesByItemKey = useMemo(() => {
    /** @type {Record<string, { start: number; end: number }[]>} */
    const map = {}
    for (const item of highlights) {
      const key = `${item.groupId}:${item.itemIndex}`
      if (!map[key]) map[key] = []
      map[key].push({ start: item.start, end: item.end })
    }
    for (const key of Object.keys(map)) {
      map[key] = mergeHighlightRanges(map[key])
    }
    return map
  }, [highlights])

  const canHighlight = Boolean(activeSelection?.spans?.length)
  const canAddExcerpt = Boolean(activeSelection?.text?.trim())

  const clearSelectionUi = useCallback(() => {
    setActiveSelection(null)
    setSelectionBubble(null)
    window.getSelection()?.removeAllRanges()
  }, [])

  const captureSelection = useCallback(() => {
    const selection = readHandlingTextSelection(leftPaneRef.current)
    setActiveSelection(selection)
    if (!selection?.text?.trim()) {
      setSelectionBubble(null)
      return
    }
    const range = window.getSelection()?.rangeCount
      ? window.getSelection()?.getRangeAt(0)
      : null
    const rect = range?.getBoundingClientRect()
    if (!rect || (rect.width === 0 && rect.height === 0)) {
      setSelectionBubble(null)
      return
    }
    const bubbleWidth = 280
    const left = Math.min(
      Math.max(8, rect.left + rect.width / 2 - bubbleWidth / 2),
      window.innerWidth - bubbleWidth - 8,
    )
    const top = Math.min(rect.bottom + 8, window.innerHeight - 48)
    setSelectionBubble({ top, left })
  }, [])

  const jumpToPhase = useCallback((phaseId) => {
    setExpandedIds((prev) => (prev.includes(phaseId) ? prev : [...prev, phaseId]))
    window.requestAnimationFrame(() => {
      bodyScrollRef.current
        ?.querySelector(`[data-handling-phase-id="${phaseId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  const applyLocate = useCallback(() => {
    const needle = locateKeyword.trim()
    if (!needle) {
      setLocateHint(null)
      setExpandedIds(defaultExpandedPhaseIds(groups))
      return
    }
    const matched = phaseIdsMatchingKeyword(groups, needle)
    if (!matched.length) {
      setLocateHint('无匹配')
      return
    }
    setLocateHint(null)
    setExpandedIds((prev) => [...new Set([...prev, ...matched])])
    window.requestAnimationFrame(() => {
      bodyScrollRef.current
        ?.querySelector(`[data-handling-phase-id="${matched[0]}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [groups, locateKeyword])

  const appendHighlightSpans = useCallback((spans) => {
    if (!spans?.length) return
    setHighlights((prev) => [
      ...prev,
      ...spans.map((span) => ({
        id: randomId(),
        groupId: span.groupId,
        itemIndex: span.itemIndex,
        start: span.start,
        end: span.end,
      })),
    ])
  }, [])

  const handleAddHighlight = useCallback(() => {
    const selection = readHandlingTextSelection(leftPaneRef.current) || activeSelection
    if (!selection?.spans?.length) {
      message.warning('请先在左侧选中文本')
      return
    }
    appendHighlightSpans(selection.spans)
    clearSelectionUi()
  }, [activeSelection, appendHighlightSpans, clearSelectionUi])

  const handleAddExcerpt = useCallback(() => {
    const selection = readHandlingTextSelection(leftPaneRef.current) || activeSelection
    const snippet = selection?.text?.trim()
    if (!snippet) {
      message.warning('请先选中要摘录的文本')
      return
    }
    setExcerpt((prev) => (prev.trim() ? `${prev.trim()}\n\n${snippet}` : snippet))
    clearSelectionUi()
    message.success('已加入摘录')
  }, [activeSelection, clearSelectionUi])

  const handleHighlightAndExcerpt = useCallback(() => {
    const selection = readHandlingTextSelection(leftPaneRef.current) || activeSelection
    const snippet = selection?.text?.trim()
    if (!snippet) {
      message.warning('请先选中文本')
      return
    }
    const canMark = Boolean(selection?.spans?.length)
    if (canMark && selection) {
      appendHighlightSpans(selection.spans)
    }
    setExcerpt((prev) => (prev.trim() ? `${prev.trim()}\n\n${snippet}` : snippet))
    clearSelectionUi()
    message.success(canMark ? '已高亮并加入摘录' : '已加入摘录')
  }, [activeSelection, appendHighlightSpans, clearSelectionUi])

  const handleCopyExcerpt = async () => {
    const ok = await copyTextToClipboard(excerpt, { container: copyHostRef.current })
    if (ok) message.success('已复制摘录')
    else message.error('复制失败，请手动选择复制')
  }

  const collapseItems = useMemo(
    () =>
      groups.map((group) => {
        const fieldCount = group.items.filter((item) => item.kind === 'field' || item.text?.trim()).length
        const hits = hitCountById[group.id] || 0
        return {
          key: group.id,
          forceRender: true,
          label: (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span>{group.label}</span>
              <Typography.Text type="secondary" className="text-xs font-normal">
                {fieldCount} 段
              </Typography.Text>
              {hits > 0 ? (
                <Typography.Text type="warning" className="text-xs font-normal">
                  {hits} 处命中
                </Typography.Text>
              ) : null}
            </span>
          ),
          children: (
            <div className="space-y-3 scroll-mt-2" data-handling-phase-id={group.id}>
              {group.items.length ? (
                group.items.map((item, index) => (
                  <HandlingOriginalSegmentBlock
                    key={`${group.id}-${index}`}
                    item={item}
                    keyword={locateKeyword}
                    index={index}
                    groupId={group.id}
                    manualRanges={rangesByItemKey[`${group.id}:${index}`] || []}
                  />
                ))
              ) : (
                <Typography.Text type="secondary">（无正文）</Typography.Text>
              )}
            </div>
          ),
        }
      }),
    [groups, hitCountById, locateKeyword, rangesByItemKey],
  )

  const toolbar = (
    <div className="mb-3 space-y-2 border-b border-ink-100 pb-3">
      {showWhatsNew ? (
        <Alert
          type="info"
          showIcon
          closable
          className="!mb-0"
          message="功能上新"
          description="选中原文可高亮、加入右侧摘录；也可一键「高亮并加入摘录」。内容仅本次有效，关闭弹窗后清空，不会保存到工单。"
          onClose={() => onDismissWhatsNew?.()}
          action={
            <Button size="small" type="link" onClick={() => onDismissWhatsNew?.()}>
              不再显示
            </Button>
          }
        />
      ) : null}
      {structured && groups.length ? (
        <div className="flex flex-wrap gap-1.5">
          {groups.map((group) => {
            const hits = hitCountById[group.id] || 0
            return (
              <Button
                key={group.id}
                size="small"
                type={expandedIds.includes(group.id) ? 'primary' : 'default'}
                ghost={expandedIds.includes(group.id)}
                onClick={() => jumpToPhase(group.id)}
              >
                {group.label}
                {hits > 0 ? ` · ${hits}` : ''}
              </Button>
            )
          })}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {structured && groups.length ? (
          <>
            <Input
              allowClear
              size="small"
              className="max-w-xs"
              placeholder="定位关键字"
              value={locateKeyword}
              onChange={(event) => {
                setLocateKeyword(event.target.value)
                setLocateHint(null)
              }}
              onPressEnter={applyLocate}
            />
            <Button size="small" onClick={applyLocate}>
              定位
            </Button>
            {locateHint ? (
              <Typography.Text type="secondary" className="text-xs">
                {locateHint}
              </Typography.Text>
            ) : null}
          </>
        ) : null}
        {highlights.length ? (
          <Button size="small" type="link" className="!px-0" onClick={() => setHighlights([])}>
            清除全部高亮
          </Button>
        ) : null}
      </div>
      <Typography.Text type="secondary" className="block text-xs">
        选中左侧原文后，可在选区旁点「高亮 / 加入摘录 / 高亮并加入摘录」；关闭弹窗后清空，不会保存。
      </Typography.Text>
    </div>
  )

  const leftContent =
    structured && groups.length ? (
      <Collapse
        activeKey={expandedIds}
        onChange={(keys) => {
          setExpandedIds(Array.isArray(keys) ? keys.map(String) : [String(keys)])
        }}
        items={collapseItems}
      />
    ) : (
      <Typography.Paragraph
        className="!mb-0 whitespace-pre-wrap"
        data-handling-group-id={HANDLING_PLAIN_GROUP_ID}
        data-handling-item-index="0"
      >
        {renderHandlingTextWithHighlights(
          text,
          locateKeyword,
          rangesByItemKey[`${HANDLING_PLAIN_GROUP_ID}:0`] || [],
        )}
      </Typography.Paragraph>
    )

  const selectionBubbleNode =
    selectionBubble && canAddExcerpt ? (
      <div
        className="fixed z-[1200] flex gap-1 rounded-md border border-ink-200 bg-white p-1 shadow-lg"
        style={{ top: selectionBubble.top, left: selectionBubble.left }}
        onMouseDown={(event) => event.preventDefault()}
      >
        <Button size="small" type="primary" disabled={!canHighlight} onClick={handleAddHighlight}>
          高亮
        </Button>
        <Button size="small" onClick={handleAddExcerpt}>
          加入摘录
        </Button>
        <Button size="small" type="primary" ghost disabled={!canAddExcerpt} onClick={handleHighlightAndExcerpt}>
          高亮并加入摘录
        </Button>
      </div>
    ) : null

  return (
    <Modal
      title={`处理意见（工单原文）${ticketId ? ` · ${ticketId}` : ''}`}
      open={open}
      onCancel={onClose}
      centered
      width={`min(96vw, ${HANDLING_ORIGINAL_TEXT_MODAL_MAX_WIDTH}px)`}
      zIndex={HANDLING_ORIGINAL_TEXT_MODAL_Z_INDEX}
      destroyOnClose
      footer={[
        <Button key="copy" onClick={handleCopy}>
          复制全文
        </Button>,
        <Button key="close" type="primary" onClick={onClose}>
          关闭
        </Button>,
      ]}
      styles={{
        body: {
          maxHeight: HANDLING_ORIGINAL_TEXT_MODAL_BODY_MAX_HEIGHT,
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          paddingTop: 12,
        },
      }}
    >
      {toolbar}
      <div ref={copyHostRef} className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div
          ref={leftPaneRef}
          className="flex min-h-0 min-w-0 flex-[2] flex-col"
          onMouseUp={captureSelection}
        >
          <div ref={bodyScrollRef} className="min-h-0 flex-1 overflow-y-auto pr-1">
            {leftContent}
          </div>
        </div>
        <div className="flex min-h-[180px] min-w-0 flex-1 flex-col border-t border-ink-100 pt-3 lg:border-l lg:border-t-0 lg:pl-3 lg:pt-0">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <Typography.Text strong className="text-sm">
              摘录
            </Typography.Text>
            <div className="flex flex-wrap gap-1">
              <Button size="small" disabled={!excerpt.trim()} onClick={handleCopyExcerpt}>
                复制摘录
              </Button>
              <Button size="small" disabled={!excerpt} onClick={() => setExcerpt('')}>
                清空
              </Button>
            </div>
          </div>
          <Input.TextArea
            className="min-h-0 flex-1"
            style={{ height: '100%', resize: 'none' }}
            placeholder="选中左侧后点「加入摘录」，或在此直接粘贴编辑"
            value={excerpt}
            onChange={(event) => setExcerpt(event.target.value)}
          />
        </div>
      </div>
      {selectionBubbleNode
        ? createPortal(selectionBubbleNode, document.body)
        : null}
    </Modal>
  )
}

/** @param {{ metaLine: string; postUse?: boolean }} props */
function TicketDetailDrawerTitle({ metaLine, postUse = false }) {
  const showMetaTooltip = Boolean(metaLine?.trim() && metaLine !== '—')
  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="relative min-h-[1.25rem] w-full">
        <span className="relative z-[1] shrink-0 text-base font-semibold leading-none">
          {postUse ? '评价详情' : '工单详情'}
        </span>
        <div className="pointer-events-none absolute inset-y-0 left-20 right-0 flex items-center justify-center">
          <div className="pointer-events-auto">
            <TicketDetailSectionNav postUse={postUse} />
          </div>
        </div>
      </div>
      <Tooltip
        title={showMetaTooltip ? metaLine : undefined}
        getPopupContainer={() => document.body}
      >
        <Typography.Text
          type="secondary"
          className="block min-w-0 text-xs leading-snug"
          ellipsis={{ tooltip: false }}
        >
          {metaLine}
        </Typography.Text>
      </Tooltip>
    </div>
  )
}

/**
 * @param {{
 *   feedback: import('../lib/types.js').FeedbackRecord | null
 *   onClose: () => void
 *   onSavedClose?: () => void
 *   onDirtyChange?: (dirty: boolean) => void
 * }} props
 */
export default function FeedbackDrawer({ feedback: selected, onClose, onSavedClose, onDirtyChange }) {
  const {
    feedbacks,
    adapter,
    updateFeedback,
    removeFeedback,
    reprocessOne,
    retagSession,
    importSession,
    sharedBackgroundTask,
    reprocessing,
  } = useFeedbacks()
  const { can, user } = useAuth()
  const {
    enabled: reviewEnabled,
    isReviewDone,
    markReviewDone,
    clearReview,
  } = useUserTicketReviews()
  const { detailSaveBlocked, detailSaveBlockedTip } = useSharedBackgroundTaskBlock()
  const canEdit = can('editRecord')
  const canRetag = can('retag')
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const cachedFeedback = selected
    ? feedbacks.find((f) => f.id === selected.id) ?? selected
    : null
  // list 投影裁剪了大文本字段；抽屉需要全量，缺 rawText 键时按需拉单条
  const needsHydration = cachedFeedback != null && !('rawText' in cachedFeedback)
  const [fullFeedback, setFullFeedback] = useState(
    /** @type {import('../lib/types.js').FeedbackRecord | null} */ (null),
  )
  useEffect(() => {
    if (!selected?.id || !needsHydration) {
      setFullFeedback(null)
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const full = await adapter.getRecord(selected.id)
        if (!cancelled && full) setFullFeedback(full)
      } catch (err) {
        if (!cancelled) console.warn('[drawer] 拉取全量记录失败', err)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selected?.id, needsHydration, adapter])
  const feedback = fullFeedback ?? cachedFeedback
  const isPostUseLibrary = isPostUseRatingLibraryRecord(feedback)
  const isPostUseNon10 = isPostUseNon10LibraryRecord(feedback)
  const canDeleteTicket = can('deleteData') && !isPostUseLibrary
  const [journeyEnriching, setJourneyEnriching] = useState(false)
  const [note, setNote] = useState(feedback?.note || '')
  const [listeningReviewed, setListeningReviewed] = useState(Boolean(feedback?.listeningReviewed))
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
  const [establishedActionDetail, setEstablishedActionDetail] = useState('')
  const [actionId, setActionId] = useState('')
  const [linkedFromLibrary, setLinkedFromLibrary] = useState(false)
  const [customerRequest, setCustomerRequest] = useState('')
  const [painPoint, setPainPoint] = useState('')
  const [actionSchedule, setActionSchedule] = useState('')
  const [productGroupOptimization, setProductGroupOptimization] = useState('')
  const [designerOptimization, setDesignerOptimization] = useState('')
  const [rootCauseReview, setRootCauseReview] = useState('')
  const [rootCauseReviewTouched, setRootCauseReviewTouched] = useState(false)
  const [complaintCauseL1Review, setComplaintCauseL1Review] = useState('')
  const [complaintCauseL2Review, setComplaintCauseL2Review] = useState('')
  const [complaintCauseL3Review, setComplaintCauseL3Review] = useState('')
  const [complaintCauseReviewReason, setComplaintCauseReviewReason] = useState('')
  const [complaintCauseReviewTouched, setComplaintCauseReviewTouched] = useState(false)
  const [complaintCauseReviewEnabled, setComplaintCauseReviewEnabled] = useState(false)
  const [ticketTodoItems, setTicketTodoItems] = useState(/** @type {import('../domain/ticketTodo.js').TicketTodoItem[]} */ ([]))
  const [todoAssigneeOptions, setTodoAssigneeOptions] = useState(
    /** @type {{ value: string; label: string; team?: string }[]} */ ([]),
  )
  const [retagging, setRetagging] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reviewToggling, setReviewToggling] = useState(false)
  const [remoteStale, setRemoteStale] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [conflictServerRecord, setConflictServerRecord] = useState(
    /** @type {import('../lib/types.js').FeedbackRecord | null} */ (null),
  )
  const [conflictRevision, setConflictRevision] = useState(0)
  const [forceSaving, setForceSaving] = useState(false)
  const baseRevisionRef = useRef(0)
  const baselineFormRef = useRef(/** @type {import('../domain/feedbackDrawerDirty.js').FeedbackDrawerFormSnapshot | null} */ (null))
  const pendingBaselineCaptureRef = useRef(false)
  const saveInFlightRef = useRef(false)
  const [drawerFormReady, setDrawerFormReady] = useState(false)
  const [handlingExpandOpen, setHandlingExpandOpen] = useState(false)
  const [showHandlingWhatsNew, setShowHandlingWhatsNew] = useState(
    () => !hasSeenHandlingExpandWhatsNew(),
  )

  const taxonomy = useMemo(
    () => (feedback ? getTaxonomyForRecord(feedback) : null),
    [feedback],
  )

  const handlingOriginalText = useMemo(() => {
    if (!feedback) return ''
    return extractHandlingOriginalTextForRecord(feedback)
  }, [feedback])

  useEffect(() => {
    setHandlingExpandOpen(false)
  }, [feedback?.id])

  useEffect(() => {
    if (!canEdit) {
      setTodoAssigneeOptions([])
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const data = await apiFetch('/api/users/assignees')
        if (cancelled) return
        const options = (data.users || []).map(
          (/** @type {{ id: string; username: string; team?: string }} */ u) => ({
            value: u.id,
            label: u.username,
            team: u.team,
          }),
        )
        setTodoAssigneeOptions(options)
      } catch {
        if (!cancelled && user?.id) {
          setTodoAssigneeOptions([{ value: user.id, label: user.username, team: user.team }])
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [canEdit, user?.id, user?.username, user?.team])

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
    setListeningReviewed(Boolean(record.listeningReviewed))
    setSentiment(normalizeSentiment(record.sentiment))
    setUrgencyLevel(normalizeUrgencyLevel(record.urgencyLevel, record.sentiment))
    setRequestScene(record.requestScene || '')
    setProblemType(record.problemType || '')
    setJourneyL1(record.journeyL1 || '')
    setJourneyL2(record.journeyL2 || '')
    setEstablishedAction(getEstablishedActionDisplay(record))
    setEstablishedActionDetail(getEstablishedActionDetailDisplay(record))
    setActionId(record.actionId?.trim() || '')
    setLinkedFromLibrary(Boolean(record.actionId?.trim()))
    setCustomerRequest(getCustomerRequestDraftDisplay(record))
    setPainPoint(getPainPointDraftDisplay(record))
    setActionSchedule(record.actionSchedule || '')
    setProductGroupOptimization(record.productGroupOptimization || '')
    setDesignerOptimization(record.designerOptimization || '')
    setRootCauseReview(getRootCauseReviewDraftDisplay(record))
    setRootCauseReviewTouched(false)
    const causeReview = getComplaintCauseReviewDraftDisplay(record)
    setComplaintCauseL1Review(causeReview.l1)
    setComplaintCauseL2Review(causeReview.l2)
    setComplaintCauseL3Review(causeReview.l3)
    setComplaintCauseReviewReason(causeReview.reason)
    setComplaintCauseReviewTouched(false)
    setComplaintCauseReviewEnabled(isCompleteComplaintCauseReview(record))
    setTicketTodoItems(getTicketTodoDraftItems(record))
  }, [])

  useEffect(() => {
    if (!feedback?.id) {
      setDrawerFormReady(false)
      baselineFormRef.current = null
      pendingBaselineCaptureRef.current = false
      return
    }

    let cancelled = false
    setDrawerFormReady(false)
    baselineFormRef.current = null
    pendingBaselineCaptureRef.current = false
    baseRevisionRef.current = getRecordRevision(feedback)
    setRemoteStale(false)
    applyFeedbackToForm(feedback)

    ;(async () => {
      const actionId = feedback.actionId?.trim()
      if (actionId) {
        try {
          const item = await getActionItem(actionId)
          if (!cancelled && item) {
            setEstablishedAction(item.content)
            setEstablishedActionDetail(item.detail || '')
            setActionSchedule(getActionItemDisplayScheduleAt(item))
          }
        } catch {
          /* 保留工单副本 */
        }
      }
      if (!cancelled) {
        pendingBaselineCaptureRef.current = true
        setDrawerFormReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
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

  const optimizationServiceText = feedback?.optimizationService?.trim() || ''

  const journeyDisplay = useMemo(() => {
    const l1 = journeyL1?.trim() || TAG_UNRECOGNIZED
    const l2 = journeyL2?.trim()
    return l2 ? `${l1}、${l2}` : l1
  }, [journeyL1, journeyL2])

  const ticketMetaLine = useMemo(() => {
    if (!feedback) return '—'
    if (isPostUseRatingLibraryRecord(feedback)) {
      const product = feedback.productName || feedback.product || ''
      const channel =
        feedback.channel === 'sms'
          ? '短信'
          : feedback.channel === 'console'
            ? '控制台'
            : feedback.channel || ''
      const score =
        feedback.ratingScore != null && Number.isFinite(Number(feedback.ratingScore))
          ? `${Number(feedback.ratingScore)} 分`
          : ''
      return [channel, score, product, DATA_SOURCE_LABELS.post_use_rating || '用后即评']
        .filter(Boolean)
        .join(' · ') || '—'
    }
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

  const handleEnrichPostUseJourney = async () => {
    if (!feedback?.id || !isPostUseNon10) return
    setJourneyEnriching(true)
    try {
      const patch = enrichPostUseJourneyRecord(feedback)
      const saved = await updateFeedback(feedback.id, patch, {
        expectedRevision: baseRevisionRef.current,
        mergeBase: feedback,
      })
      setJourneyL1(patch.journeyL1)
      setJourneyL2(patch.journeyL2)
      if (saved) {
        baseRevisionRef.current = getRecordRevision(saved)
      }
      message.success('已补全用户旅程')
    } catch (err) {
      message.error(err instanceof Error ? err.message : '旅程补全失败')
    } finally {
      setJourneyEnriching(false)
    }
  }

  const drawerFormSnapshot = useMemo(
    () => ({
      note,
      listeningReviewed,
      sentiment,
      urgencyLevel,
      requestScene,
      problemType,
      journeyL1,
      journeyL2,
      customerRequest,
      painPoint,
      productGroupOptimization,
      designerOptimization,
      establishedAction,
      establishedActionDetail,
      actionSchedule,
      actionId,
      rootCauseReview,
      complaintCauseL1Review,
      complaintCauseL2Review,
      complaintCauseL3Review,
      complaintCauseReviewReason,
      ticketTodoItems,
    }),
    [
      note,
      listeningReviewed,
      sentiment,
      urgencyLevel,
      requestScene,
      problemType,
      journeyL1,
      journeyL2,
      customerRequest,
      painPoint,
      productGroupOptimization,
      designerOptimization,
      establishedAction,
      establishedActionDetail,
      actionSchedule,
      actionId,
      rootCauseReview,
      complaintCauseL1Review,
      complaintCauseL2Review,
      complaintCauseL3Review,
      complaintCauseReviewReason,
      ticketTodoItems,
    ],
  )

  useEffect(() => {
    if (!pendingBaselineCaptureRef.current) return
    baselineFormRef.current = drawerFormSnapshot
    pendingBaselineCaptureRef.current = false
  }, [drawerFormSnapshot])

  const isDrawerDirty = useMemo(() => {
    if (!canEdit || !feedback || !drawerFormReady) return false
    const baseline = baselineFormRef.current
    if (!baseline) return false
    return !areFeedbackDrawerFormSnapshotsEqual(baseline, drawerFormSnapshot)
  }, [canEdit, feedback, drawerFormReady, drawerFormSnapshot])

  const handleRequestClose = useCallback(() => {
    onClose()
  }, [onClose])

  const handleDeleteTicket = async () => {
    if (!can('deleteData') || !feedback?.id || deleting) return
    setDeleting(true)
    try {
      await removeFeedback(feedback.id)
      const label = feedback.ticketId ? `工单 ${feedback.ticketId}` : '工单'
      message.success(`${label} 已删除`)
      setDeleteOpen(false)
      onDirtyChange?.(false)
      ;(onSavedClose ?? onClose)()
    } catch (err) {
      message.error(err instanceof Error ? err.message : '删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

  useEffect(() => {
    if (!feedback) {
      onDirtyChange?.(false)
      return
    }
    onDirtyChange?.(Boolean(isDrawerDirty))
    return () => onDirtyChange?.(false)
  }, [feedback, isDrawerDirty, onDirtyChange])

  if (!feedback) return null

  const buildSavePatch = () => {
    const journey = { journeyL1, journeyL2 }
    return {
      note,
      // 一旦保存为已听音，不可再取消
      listeningReviewed: Boolean(feedback.listeningReviewed) || Boolean(listeningReviewed),
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
    if (shouldIncludeComplaintCauseReviewInSave(feedback, complaintCauseReviewTouched)) {
      if (complaintCauseReviewEnabled) {
        draft = {
          ...draft,
          ...normalizeComplaintCauseReviewInput({
            l1: complaintCauseL1Review,
            l2: complaintCauseL2Review,
            l3: complaintCauseL3Review,
            reason: complaintCauseReviewReason,
          }),
        }
      } else {
        draft = { ...draft, ...clearComplaintCauseReviewFields() }
      }
    }
    return draft
  }

  const handleReviewToggle = async (event) => {
    const checked = event.target.checked
    if (!feedback?.id || reviewToggling) return
    setReviewToggling(true)
    try {
      if (checked) {
        await markReviewDone(feedback.id, 'manual')
      } else {
        await clearReview(feedback.id)
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '更新处理状态失败')
    } finally {
      setReviewToggling(false)
    }
  }

  const finalizeSave = async (patch, saveOptions = {}) => {
    // Validate local patches before creating/updating library items, so a later
    // failure cannot leave orphan action items after the user retries save.
    if (shouldIncludeRootCauseReviewInSave(feedback, rootCauseReviewTouched)) {
      patch.rootCauseReview = normalizeRootCauseReviewInput(rootCauseReview)
    }
    if (shouldIncludeComplaintCauseReviewInSave(feedback, complaintCauseReviewTouched)) {
      if (complaintCauseReviewEnabled) {
        const causePatch = normalizeComplaintCauseReviewInput({
          l1: complaintCauseL1Review,
          l2: complaintCauseL2Review,
          l3: complaintCauseL3Review,
          reason: complaintCauseReviewReason,
        })
        if (!isCompleteComplaintCauseReview(causePatch)) {
          throw new Error('发起复核需选择完整的一/二/三级投诉原因并填写申请原因')
        }
        Object.assign(patch, causePatch)
      } else {
        Object.assign(patch, clearComplaintCauseReviewFields())
      }
    }
    const hadAction = Boolean(
      getEstablishedActionDisplay(feedback) || String(feedback.actionId || '').trim(),
    )
    const actionPatch = await persistEstablishedActionForTicket(feedback, {
      content: establishedAction,
      detail: establishedActionDetail,
      scheduleAt: actionSchedule,
      actionId,
      linkedFromLibrary,
    })
    Object.assign(patch, actionPatch)
    const nextActionId = String(actionPatch.actionId ?? actionId ?? '').trim()
    if ('actionId' in actionPatch) {
      setActionId(nextActionId)
    }
    Object.assign(
      patch,
      buildTicketTodoSavePatch(
        feedback,
        markOpenTicketTodosConvertedWhenEstablishingAction(ticketTodoItems, {
          hadAction,
          nowHasAction: Boolean(String(establishedAction || '').trim() || nextActionId),
          linkedActionId: nextActionId,
        }).map((item) => {
          if (getTicketTodoResolution(item) !== 'converted_to_action' || item.linkedActionId?.trim()) {
            return item
          }
          return nextActionId ? { ...item, linkedActionId: nextActionId } : item
        }),
        user?.id ? { userId: user.id, username: user.username || user.id } : null,
      ),
    )
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
    applyFeedbackToForm(merged)
    pendingBaselineCaptureRef.current = true
    onDirtyChange?.(false)
    if (reviewEnabled) {
      try {
        await markReviewDone(merged.id, 'save')
      } catch {
        message.warning('工单已保存，但「已处理」标记同步失败')
      }
    }
    const label = feedback.ticketId ? `工单 ${feedback.ticketId}` : '工单'
    message.success(`${label} 已保存`)
    ;(onSavedClose ?? onClose)()
  }

  const save = async (saveOptions = {}) => {
    if (saveInFlightRef.current || saving || forceSaving) return
    if (detailSaveBlocked) {
      message.warning(detailSaveBlockedTip || '当前无法保存工单')
      return
    }
    saveInFlightRef.current = true
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
      saveInFlightRef.current = false
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
    if (saveInFlightRef.current || forceSaving) return
    saveInFlightRef.current = true
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
      saveInFlightRef.current = false
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
    <>
    <Drawer
      title={<TicketDetailDrawerTitle metaLine={ticketMetaLine} postUse={isPostUseLibrary} />}
      size={TICKET_DETAIL_DRAWER_WIDTH}
      open={Boolean(feedback)}
      onClose={handleRequestClose}
      closable={{ placement: 'end' }}
      destroyOnClose
      styles={{
        section: { overflow: 'hidden' },
        body: { overflowX: 'hidden', overflowY: 'auto' },
      }}
      footer={
        reviewEnabled || canEdit || canDeleteTicket || (canRetag && !isPostUseLibrary) || isPostUseNon10 ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {reviewEnabled ? (
              <Checkbox
                checked={Boolean(feedback?.id && isReviewDone(feedback.id))}
                disabled={!feedback?.id || reviewToggling}
                onChange={(event) => void handleReviewToggle(event)}
              >
                已处理
              </Checkbox>
            ) : null}
            {!isPostUseLibrary && (canEdit || Boolean(feedback?.listeningReviewed)) ? (
              <Checkbox
                checked={Boolean(listeningReviewed || feedback?.listeningReviewed)}
                disabled={Boolean(feedback?.listeningReviewed) || !canEdit}
                onChange={(event) => {
                  if (feedback?.listeningReviewed) return
                  setListeningReviewed(event.target.checked)
                }}
              >
                听音
              </Checkbox>
            ) : null}
            <div className="ml-auto flex shrink-0 gap-2">
              {canDeleteTicket && (
                <Button
                  danger
                  className="min-w-[4.5rem]"
                  disabled={!feedback?.id || deleting}
                  onClick={() => setDeleteOpen(true)}
                >
                  删除
                </Button>
              )}
              {isPostUseNon10 && (
                <Button
                  className="min-w-[5.5rem]"
                  loading={journeyEnriching}
                  onClick={() => void handleEnrichPostUseJourney()}
                >
                  补全旅程
                </Button>
              )}
              {canRetag && !isPostUseLibrary && (
                <Tooltip title={retagTooltipTitle}>
                  <Button
                    className="min-w-[5.5rem]"
                    loading={retagging}
                    disabled={bulkRetagActive}
                    onClick={handleRetag}
                  >
                    重新打标
                  </Button>
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
                  <Button
                    type="primary"
                    className="min-w-[4.5rem]"
                    loading={saving}
                    disabled={detailSaveBlocked}
                    onClick={() => save()}
                  >
                    保存
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        ) : null
      }
    >
      <div className="min-w-0 max-w-full space-y-4 overflow-x-hidden">
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

        {isPostUseLibrary ? (
          <div id="rating-detail-content" className="scroll-mt-2 space-y-3">
            <Typography.Title level={5} className="!mb-0 !text-sm !font-semibold">
              用后即评
            </Typography.Title>
            <Card size="small" title="评价摘要">
              <Descriptions size="small" column={1} bordered>
                <Descriptions.Item label="渠道">
                  {feedback.channel === 'sms'
                    ? '短信'
                    : feedback.channel === 'console'
                      ? '控制台'
                      : feedback.channel || feedback.sourceSubType || '—'}
                </Descriptions.Item>
                <Descriptions.Item label="评分">
                  {feedback.ratingScore != null && Number.isFinite(Number(feedback.ratingScore))
                    ? Number(feedback.ratingScore)
                    : '—'}
                </Descriptions.Item>
                <Descriptions.Item label="产品">
                  {feedback.productName || feedback.product || '—'}
                  {feedback.productSpec &&
                  feedback.productSpec !== (feedback.productName || feedback.product)
                    ? ` / ${feedback.productSpec}`
                    : ''}
                </Descriptions.Item>
                <Descriptions.Item label="原文">
                  <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
                    {feedback.rawText || feedback.commentText || feedback.lowScoreReason || '—'}
                  </Typography.Paragraph>
                </Descriptions.Item>
                <Descriptions.Item label="用户旅程">
                  {[journeyL1 || feedback.journeyL1, journeyL2 || feedback.journeyL2]
                    .filter(Boolean)
                    .join(' / ') || '待补全'}
                </Descriptions.Item>
              </Descriptions>
            </Card>
            {feedback.customerVisit ? (
              <Card size="small" title="客服部回访">
                <Descriptions size="small" column={1} bordered>
                  <Descriptions.Item label="客户名称">
                    {feedback.customerVisit.customerName || feedback.customerVisit.userInfoDetail || feedback.customerVisit.userInfo || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="客户编码">
                    {feedback.customerVisit.customerCode || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="回访反馈信息">
                    <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
                      {feedback.customerVisit.visitFeedbackDetail || feedback.customerVisit.visitResult || '—'}
                    </Typography.Paragraph>
                  </Descriptions.Item>
                  <Descriptions.Item label="回访反馈信息-内部评估">
                    <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
                      {feedback.customerVisit.internalEvaluationDetail || feedback.customerVisit.internalConclusion || '—'}
                    </Typography.Paragraph>
                  </Descriptions.Item>
                  <Descriptions.Item label="内部结论">
                    {feedback.customerVisit.internalConclusion || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="反馈摘要">
                    <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
                      {feedback.customerVisit.feedbackSummary || '—'}
                    </Typography.Paragraph>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            ) : null}
          </div>
        ) : null}

        {/* 1 · 工单内容 */}
        {!isPostUseLibrary ? (
        <div id="ticket-detail-content" className="scroll-mt-2 space-y-3">
          <Typography.Title level={5} className="!mb-0 !text-sm !font-semibold">
            工单内容
          </Typography.Title>

          <Card
            title="处理意见（工单原文）"
            size="small"
            extra={
              handlingOriginalText ? (
                <Badge
                  count={showHandlingWhatsNew ? '新' : 0}
                  size="small"
                  offset={[4, -2]}
                  styles={{ indicator: { fontSize: 10, lineHeight: '14px', height: 14, minWidth: 16, padding: '0 3px' } }}
                >
                  <Button
                    type="link"
                    size="small"
                    className="!h-auto !px-0 !py-0 text-xs"
                    icon={<ExpandOutlined />}
                    onClick={() => setHandlingExpandOpen(true)}
                  >
                    放大查看
                  </Button>
                </Badge>
              ) : null
            }
          >
            <Typography.Paragraph className="!mb-0 line-clamp-3 overflow-hidden whitespace-pre-wrap">
              {handlingOriginalText || '—'}
            </Typography.Paragraph>
            <Typography.Text type="secondary" className="mt-2 block text-xs">
              默认预览约 3 行，完整内容请点右上角「放大查看」。优先展示「处理意见」列；若为「无/不涉及」等占位或无内容，则展示「受理内容」。
            </Typography.Text>
          </Card>

          {isFollowUpEnrichableRecord(feedback) ? (
            <>
              <Card title="回访满意度" size="small">
                <Typography.Text>{getFollowUpSatisfactionDisplay(feedback)}</Typography.Text>
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  来自满意度回访导入，只读
                </Typography.Text>
              </Card>
              <Card
                title={
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="shrink-0">不满意原因</span>
                    <Typography.Text type="secondary" className="text-xs font-normal">
                      来自满意度回访汇总
                    </Typography.Text>
                  </span>
                }
                size="small"
                className="!bg-ink-50/50"
              >
                <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
                  {getFollowUpDissatisfiedReasonsDisplay(feedback)}
                </Typography.Paragraph>
              </Card>
            </>
          ) : null}
        </div>
        ) : null}

        {/* 2 · 工单分析 */}
        <div
          id={isPostUseLibrary ? 'rating-detail-analysis' : 'ticket-detail-analysis'}
          className="scroll-mt-2 space-y-3"
        >
          <Typography.Title level={5} className="!mb-0 !text-sm !font-semibold">
            {isPostUseLibrary ? '评价分析' : '工单分析'}
          </Typography.Title>

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

          <Card title="根因排查" size="small">
            <div className="mb-2 inline-flex flex-wrap items-center gap-2">
              <Typography.Text strong className="text-xs">
                自动生成
              </Typography.Text>
              <AutoRootCauseTag />
            </div>
            <Descriptions
              column={1}
              size="small"
              bordered
              items={[
                {
                  key: 'auto',
                  label: '根因（自动）',
                  children: getAutoRootCauseDisplay(feedback) || '—',
                },
              ]}
            />

            {canEdit ? (
              <div className="mt-4 space-y-3">
                <Typography.Text strong className="block text-xs">
                  人工复核
                </Typography.Text>
                <Typography.Text type="secondary" className="block text-xs">
                  {isRootCauseReviewManuallyMaintained(feedback)
                    ? '已人工复核；重新打标默认保留此维度。'
                    : '默认展示导入列「问题原因」；编辑并保存后将作为人工复核值写入。'}
                </Typography.Text>
                <Input.TextArea
                  rows={3}
                  placeholder="默认展示导入列「问题原因」"
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
              </div>
            ) : (
              <Descriptions
                className="mt-4"
                column={1}
                size="small"
                bordered
                title="人工复核"
                items={[
                  {
                    key: 'manual',
                    label: '根因排查',
                    children: getRootCauseReviewDraftDisplay(feedback) || '—',
                  },
                ]}
              />
            )}
          </Card>

          <Card title="优化建议" size="small">
            <div className="mb-2 inline-flex flex-wrap items-center gap-2">
              <Typography.Text strong className="text-xs">
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
                {!isPostUseLibrary ? <div className="space-y-3">
                  <Typography.Text strong className="block text-xs">
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
                </div> : null}

                <div className="space-y-3">
                  <Typography.Text strong className="text-xs">
                    确立举措
                  </Typography.Text>
                  <EstablishedActionFields
                    productKey={feedback.productKey || feedback.taxonomyKey}
                    actionId={actionId}
                    establishedAction={establishedAction}
                    establishedActionDetail={establishedActionDetail}
                    actionSchedule={actionSchedule}
                    linkedFromLibrary={linkedFromLibrary}
                    disabled={saving}
                    onSelect={(item) => {
                      setActionId(item.id)
                      setEstablishedAction(item.content)
                      setEstablishedActionDetail(item.detail || '')
                      setActionSchedule(getActionItemDisplayScheduleAt(item))
                      setLinkedFromLibrary(true)
                    }}
                    onClear={() => {
                      setActionId('')
                      setEstablishedAction('')
                      setEstablishedActionDetail('')
                      setActionSchedule('')
                      setLinkedFromLibrary(false)
                    }}
                    onContentChange={setEstablishedAction}
                    onDetailChange={setEstablishedActionDetail}
                    onScheduleChange={setActionSchedule}
                  />
                </div>
              </div>
            ) : (
              <>
                {!isPostUseLibrary && hasDetailOptimizationContent(feedback) && (
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
                {(getEstablishedActionDisplay(feedback) ||
                  getEstablishedActionDetailDisplay(feedback) ||
                  feedback.actionSchedule?.trim()) && (
                  <div className="mt-4 space-y-2">
                    <Typography.Text strong className="text-xs">
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
                    {getEstablishedActionDetailDisplay(feedback) ? (
                      <Collapse
                        ghost
                        className="[&_.ant-collapse-header]:!px-0 [&_.ant-collapse-content-box]:!px-0"
                        items={[
                          {
                            key: 'detail',
                            label: '举措详情',
                            children: (
                              <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-sm">
                                {getEstablishedActionDetailDisplay(feedback)}
                              </Typography.Paragraph>
                            ),
                          },
                        ]}
                      />
                    ) : null}
                  </div>
                )}
              </>
            )}
          </Card>

          <Card
            title={
              <span className="inline-flex flex-wrap items-center gap-2">
                <span className="shrink-0">会议待办</span>
                <Typography.Text type="secondary" className="text-xs font-normal">
                  客诉复盘后的跟进事项，与「确立举措」分开维护
                </Typography.Text>
              </span>
            }
            size="small"
          >
            {canEdit ? (
              <div className="space-y-3">
                {ticketTodoItems.map((item, index) => {
                  const openItem = isTicketTodoOpen(item)
                  const itemDisabled = saving || !openItem
                  return (
                  <div key={item.id} className="rounded-md border border-ink-100 p-2">
                    <div className="flex items-center gap-2">
                      <Select
                        className="w-[168px] shrink-0"
                        value={getTicketTodoResolution(item)}
                        disabled={saving || !openItem}
                        options={
                          openItem
                            ? TICKET_TODO_MANUAL_RESOLUTION_SELECT_OPTIONS
                            : TICKET_TODO_RESOLUTION_SELECT_OPTIONS
                        }
                        onChange={(resolution) => {
                          if (resolution === 'converted_to_action') return
                          const next = [...ticketTodoItems]
                          next[index] = applyTicketTodoResolutionToItem(item, resolution)
                          setTicketTodoItems(next)
                        }}
                      />
                      <Input
                        className="min-w-0 flex-1"
                        placeholder="输入待办内容"
                        maxLength={TICKET_TODO_TEXT_MAX_LENGTH}
                        value={item.text}
                        disabled={itemDisabled}
                        onChange={(event) => {
                          const next = [...ticketTodoItems]
                          next[index] = {
                            ...item,
                            text: event.target.value.slice(0, TICKET_TODO_TEXT_MAX_LENGTH),
                          }
                          setTicketTodoItems(next)
                        }}
                      />
                      <Select
                        className="w-[160px] shrink-0"
                        placeholder="负责人"
                        showSearch
                        optionFilterProp="label"
                        allowClear
                        disabled={itemDisabled || !todoAssigneeOptions.length}
                        value={item.assigneeUserId || undefined}
                        options={todoAssigneeOptions.map((option) => ({
                          value: option.value,
                          label: option.label,
                        }))}
                        onChange={(assigneeUserId) => {
                          const option = todoAssigneeOptions.find((o) => o.value === assigneeUserId)
                          const next = [...ticketTodoItems]
                          next[index] = {
                            ...item,
                            assigneeUserId: assigneeUserId || '',
                            assigneeUsername: option?.label || '',
                          }
                          setTicketTodoItems(next)
                        }}
                      />
                      <Button
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        disabled={saving}
                        onClick={() => {
                          setTicketTodoItems(ticketTodoItems.filter((_, i) => i !== index))
                        }}
                      />
                    </div>
                  </div>
                  )
                })}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  disabled={saving}
                  onClick={() =>
                    setTicketTodoItems([...ticketTodoItems, createEmptyTicketTodoItem()])
                  }
                >
                  添加待办
                </Button>
              </div>
            ) : ticketTodoItems.length ? (
              <ul className="mb-0 list-none space-y-2 pl-0">
                {ticketTodoItems.map((item) => (
                  <li key={item.id} className="rounded-md border border-ink-100 p-2 text-sm">
                    <div className="flex items-start gap-2">
                      <TicketTodoStatusTag className="mt-0.5" item={item} />
                      <span className={!isTicketTodoOpen(item) ? 'text-ink-400' : undefined}>
                        {item.text}
                      </span>
                    </div>
                    <Typography.Text type="secondary" className="mt-1 block pl-6 text-xs">
                      负责人：{formatTicketTodoAssigneeLabel(item)}
                    </Typography.Text>
                  </li>
                ))}
              </ul>
            ) : (
              <Typography.Text type="secondary">—</Typography.Text>
            )}
          </Card>

          <Card title="备注" size="small">
            {canEdit ? (
              <Input.TextArea rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
            ) : (
              <Typography.Paragraph className="!mb-0 whitespace-pre-wrap">
                {note?.trim() || '—'}
              </Typography.Paragraph>
            )}
          </Card>
        </div>

        {/* 3 · 工单分类 */}
        <div
          id={isPostUseLibrary ? 'rating-detail-classification' : 'ticket-detail-classification'}
          className="scroll-mt-2 space-y-3"
        >
          <Typography.Title level={5} className="!mb-0 !text-sm !font-semibold">
            {isPostUseLibrary ? '评价分类' : '工单分类'}
          </Typography.Title>

          <Card size="small">
          {isPostUseLibrary ? (
            canEdit ? (
              <Form layout="vertical">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Form.Item
                    label={
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        用户旅程（一级）
                        <JourneySourceTag record={feedback} />
                      </span>
                    }
                    className="!mb-0"
                  >
                    <Select
                      value={journeyL1}
                      optionRender={renderDefinitionSelectOption}
                      options={[
                        { label: TAG_UNRECOGNIZED, value: '', title: '清空后保存为无法识别' },
                        ...(taxonomy?.journeys || []).map((journey) => {
                          const definition = resolveTagDefinition({
                            dimension: 'journey',
                            journeyL1: journey.label,
                            taxonomy,
                          })
                          return {
                            label: journey.label,
                            value: journey.label,
                            title: definition.body,
                          }
                        }),
                      ]}
                      onChange={(value) => {
                        setJourneyL1(value)
                        setJourneyL2('')
                      }}
                    />
                  </Form.Item>
                  <Form.Item label="用户旅程（二级）" className="!mb-0">
                    <Select
                      value={journeyL2}
                      disabled={!journeyL1}
                      optionRender={renderDefinitionSelectOption}
                      options={[
                        { label: TAG_UNRECOGNIZED, value: '', title: '清空后保存为无法识别' },
                        ...l2Options.map((child) => {
                          const definition = resolveTagDefinition({
                            dimension: 'journey',
                            journeyL1,
                            journeyL2: child.label,
                            taxonomy,
                          })
                          return {
                            label: child.label,
                            value: child.label,
                            title: definition.body,
                          }
                        }),
                      ]}
                      onChange={setJourneyL2}
                    />
                  </Form.Item>
                </div>
              </Form>
            ) : (
              <Descriptions column={1} size="small" bordered>
                <Descriptions.Item label="用户旅程">{journeyDisplay}</Descriptions.Item>
              </Descriptions>
            )
          ) : canEdit ? (
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

          {isComplaintTicket(feedback) ? (
            <>
              <Divider className="!my-4" />
              <Typography.Text strong className="mb-2 block text-sm">
                投诉原因（终判）
              </Typography.Text>
              <Descriptions column={1} size="small" bordered className="!mb-3">
                <Descriptions.Item label="一级（终判）">
                  {getComplaintCauseL1Final(feedback) || EMPTY_COMPLAINT_CAUSE_LABEL}
                </Descriptions.Item>
                <Descriptions.Item label="二级（终判）">
                  {feedback.complaintCauseL2Final?.trim() || EMPTY_COMPLAINT_CAUSE_LABEL}
                </Descriptions.Item>
                <Descriptions.Item label="三级（终判）">
                  {feedback.complaintCauseL3Final?.trim() || EMPTY_COMPLAINT_CAUSE_LABEL}
                </Descriptions.Item>
              </Descriptions>
              <Typography.Text type="secondary" className="mb-2 block text-xs">
                只读展示导入终判；开启「发起投诉原因复核」后填写拟复核三级与申请原因，保存后不改写终判，需管理员在「投诉原因复核」中同意后才会更新终判。
              </Typography.Text>
              {canEdit ? (
                <Form layout="vertical">
                  <Form.Item label="发起投诉原因复核" className="!mb-3">
                    <Switch
                      checked={complaintCauseReviewEnabled}
                      onChange={(checked) => {
                        setComplaintCauseReviewTouched(true)
                        setComplaintCauseReviewEnabled(checked)
                        if (!checked) {
                          setComplaintCauseL1Review('')
                          setComplaintCauseL2Review('')
                          setComplaintCauseL3Review('')
                          setComplaintCauseReviewReason('')
                        }
                      }}
                    />
                  </Form.Item>
                  {complaintCauseReviewEnabled ? (
                    <>
                  <Form.Item label="拟复核投诉原因（一/二/三级）" className="!mb-3">
                    <Cascader
                      className="w-full"
                      allowClear
                      changeOnSelect={false}
                      placeholder="默认为空，请选择"
                      options={getComplaintCauseCascaderOptions()}
                      value={
                        complaintCauseL1Review
                          ? [
                              complaintCauseL1Review,
                              ...(complaintCauseL2Review ? [complaintCauseL2Review] : []),
                              ...(complaintCauseL3Review ? [complaintCauseL3Review] : []),
                            ].filter(Boolean)
                          : []
                      }
                      onChange={(path) => {
                        setComplaintCauseReviewTouched(true)
                        const [l1 = '', l2 = '', l3 = ''] = Array.isArray(path) ? path : []
                        setComplaintCauseL1Review(String(l1 || ''))
                        setComplaintCauseL2Review(String(l2 || ''))
                        setComplaintCauseL3Review(String(l3 || ''))
                      }}
                      displayRender={(labels) => labels.join(' / ')}
                    />
                  </Form.Item>
                  <Form.Item label="申请复核原因" className="!mb-0">
                    <Input.TextArea
                      rows={2}
                      placeholder="请填写申请复核原因"
                      maxLength={COMPLAINT_CAUSE_REVIEW_REASON_MAX_LENGTH}
                      showCount
                      value={complaintCauseReviewReason}
                      onChange={(e) => {
                        setComplaintCauseReviewTouched(true)
                        setComplaintCauseReviewReason(
                          e.target.value.slice(0, COMPLAINT_CAUSE_REVIEW_REASON_MAX_LENGTH),
                        )
                      }}
                    />
                  </Form.Item>
                  {isComplaintCauseReviewManuallyMaintained(feedback) ? (
                    <Typography.Text type="secondary" className="mt-2 block text-xs">
                      已填写拟复核；重新打标默认保留此维度。审批同意前系统仍显示上方终判。
                    </Typography.Text>
                  ) : null}
                    </>
                  ) : null}
                </Form>
              ) : (
                <Descriptions column={1} size="small" bordered className="max-w-full">
                  <Descriptions.Item label="拟复核一级">
                    {complaintCauseL1Review || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="拟复核二级">
                    {complaintCauseL2Review || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="拟复核三级">
                    {complaintCauseL3Review || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="申请复核原因">
                    {complaintCauseReviewReason || '—'}
                  </Descriptions.Item>
                </Descriptions>
              )}
            </>
          ) : null}
          </Card>
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
      <HandlingOriginalTextModal
        open={handlingExpandOpen}
        onClose={() => setHandlingExpandOpen(false)}
        ticketId={feedback.ticketId || ''}
        text={handlingOriginalText}
        showWhatsNew={showHandlingWhatsNew}
        onDismissWhatsNew={() => {
          markHandlingExpandWhatsNewSeen()
          setShowHandlingWhatsNew(false)
        }}
      />
    </Drawer>
    {canDeleteTicket ? (
      <DeleteTicketConfirmModal
        open={deleteOpen}
        ticketId={feedback?.ticketId}
        confirming={deleting}
        onCancel={() => {
          if (!deleting) setDeleteOpen(false)
        }}
        onConfirm={handleDeleteTicket}
      />
    ) : null}
    </>
  )
}
