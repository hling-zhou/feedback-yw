import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  Alert,
  Badge,
  Button,
  Card,
  Collapse,
  Checkbox,
  DatePicker,
  Descriptions,
  Divider,
  Drawer,
  Form,
  Input,
  Modal,
  message,
  Select,
  Tooltip,
  Typography,
} from 'antd'
import { ExpandOutlined, DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { TICKET_DETAIL_DRAWER_WIDTH } from '../constants/appLayout.js'
import dayjs from 'dayjs'
import { useAuth } from '../context/AuthContext.jsx'
import { useFeedbacks } from '../context/FeedbackContext.jsx'
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
  ESTABLISHED_ACTION_DETAIL_MAX_LENGTH,
  getEstablishedActionDisplay,
  getEstablishedActionDetailDisplay,
} from '../domain/establishedAction.js'
import { persistEstablishedActionForTicket, syncFirstTicketSnapshotsForRecord, syncLinkedTicketsForActionIds } from '../lib/establishedActionPersist.js'
import ActionItemSelect from './ActionItemSelect.jsx'
import { getActionItem } from '../lib/actionItemClient.js'
import { getActionItemDisplayScheduleAt } from '../domain/requirementTicketProgress.js'
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
  COMPLAINT_CAUSE_REVIEW_MAX_LENGTH,
  getComplaintCauseReviewDraftDisplay,
  isComplaintCauseReviewManuallyMaintained,
  normalizeComplaintCauseReviewInput,
  shouldIncludeComplaintCauseReviewInSave,
} from '../domain/complaintCauseReview.js'
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
  buildTicketTodoSavePatch,
  createEmptyTicketTodoItem,
  formatTicketTodoAssigneeLabel,
  formatTicketTodoItemUpdatedLine,
  getTicketTodoDraftItems,
  TICKET_TODO_TEXT_MAX_LENGTH,
} from '../domain/ticketTodo.js'
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
 * @typedef {{ groupId: string; itemIndex: number; start: number; end: number; text: string } | null} HandlingTextSelection
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
  if (!node || !root.contains(node)) return null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let total = 0
  /** @type {Node | null} */
  let current = walker.nextNode()
  while (current) {
    if (current === node) return total + offset
    total += current.textContent?.length || 0
    current = walker.nextNode()
  }
  return null
}

/**
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

  const startEl =
    range.startContainer.nodeType === Node.ELEMENT_NODE
      ? /** @type {Element} */ (range.startContainer)
      : range.startContainer.parentElement
  const endEl =
    range.endContainer.nodeType === Node.ELEMENT_NODE
      ? /** @type {Element} */ (range.endContainer)
      : range.endContainer.parentElement
  const startHost = startEl?.closest('[data-handling-group-id][data-handling-item-index]')
  const endHost = endEl?.closest('[data-handling-group-id][data-handling-item-index]')
  if (!startHost || startHost !== endHost) {
    return {
      groupId: '',
      itemIndex: -1,
      start: -1,
      end: -1,
      text: selectedText,
    }
  }

  const start = offsetWithinElement(startHost, range.startContainer, range.startOffset)
  const end = offsetWithinElement(startHost, range.endContainer, range.endOffset)
  if (start == null || end == null || end <= start) {
    return {
      groupId: '',
      itemIndex: -1,
      start: -1,
      end: -1,
      text: selectedText,
    }
  }

  return {
    groupId: String(startHost.getAttribute('data-handling-group-id') || ''),
    itemIndex: Number(startHost.getAttribute('data-handling-item-index')),
    start,
    end,
    text: selectedText,
  }
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

function scrollToTicketDetailSection(sectionId) {
  document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function TicketDetailSectionNav() {
  return (
    <nav
      aria-label="工单详情分区导航"
      className="flex min-w-0 flex-wrap items-center justify-center gap-x-1"
    >
      {TICKET_DETAIL_SECTIONS.map((section, index) => (
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

  const handleCopy = async () => {
    const ok = await copyTextToClipboard(text)
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

  const canHighlight = Boolean(
    activeSelection &&
      activeSelection.groupId &&
      activeSelection.itemIndex >= 0 &&
      activeSelection.end > activeSelection.start,
  )
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

  const handleAddHighlight = useCallback(() => {
    const selection = readHandlingTextSelection(leftPaneRef.current) || activeSelection
    if (
      !selection?.groupId ||
      selection.itemIndex < 0 ||
      selection.end <= selection.start
    ) {
      message.warning('请先在左侧同一段落内框选文本')
      return
    }
    setHighlights((prev) => [
      ...prev,
      {
        id: randomId(),
        groupId: selection.groupId,
        itemIndex: selection.itemIndex,
        start: selection.start,
        end: selection.end,
      },
    ])
    clearSelectionUi()
  }, [activeSelection, clearSelectionUi])

  const handleAddExcerpt = useCallback(() => {
    const selection = readHandlingTextSelection(leftPaneRef.current) || activeSelection
    const snippet = selection?.text?.trim()
    if (!snippet) {
      message.warning('请先框选要摘录的文本')
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
      message.warning('请先框选文本')
      return
    }
    const canMark =
      Boolean(selection?.groupId) &&
      (selection?.itemIndex ?? -1) >= 0 &&
      (selection?.end ?? 0) > (selection?.start ?? 0)
    if (canMark && selection) {
      setHighlights((prev) => [
        ...prev,
        {
          id: randomId(),
          groupId: selection.groupId,
          itemIndex: selection.itemIndex,
          start: selection.start,
          end: selection.end,
        },
      ])
    } else {
      message.warning('跨段落选区仅加入摘录，未高亮；请在同一段落内框选以同时高亮')
    }
    setExcerpt((prev) => (prev.trim() ? `${prev.trim()}\n\n${snippet}` : snippet))
    clearSelectionUi()
    message.success(canMark ? '已高亮并加入摘录' : '已加入摘录')
  }, [activeSelection, clearSelectionUi])

  const handleCopyExcerpt = async () => {
    const ok = await copyTextToClipboard(excerpt)
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
          description="框选原文可高亮、加入右侧摘录；也可一键「高亮并加入摘录」。内容仅本次有效，关闭弹窗后清空，不会保存到工单。"
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
        框选左侧原文后，可在选区旁点「高亮 / 加入摘录 / 高亮并加入摘录」；关闭弹窗后清空，不会保存。
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
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
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
            placeholder="框选左侧后点「加入摘录」，或在此直接粘贴编辑"
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

/** @param {{ metaLine: string }} props */
function TicketDetailDrawerTitle({ metaLine }) {
  const showMetaTooltip = Boolean(metaLine?.trim() && metaLine !== '—')
  return (
    <div className="flex w-full min-w-0 flex-col gap-1">
      <div className="relative min-h-[1.25rem] w-full">
        <span className="relative z-[1] shrink-0 text-base font-semibold leading-none">
          工单详情
        </span>
        <div className="pointer-events-none absolute inset-y-0 left-20 right-0 flex items-center justify-center">
          <div className="pointer-events-auto">
            <TicketDetailSectionNav />
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
    updateFeedback,
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
  const [complaintCauseL2Review, setComplaintCauseL2Review] = useState('')
  const [complaintCauseL3Review, setComplaintCauseL3Review] = useState('')
  const [complaintCauseReviewTouched, setComplaintCauseReviewTouched] = useState(false)
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
    setComplaintCauseL2Review(causeReview.l2)
    setComplaintCauseL3Review(causeReview.l3)
    setComplaintCauseReviewTouched(false)
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

  const drawerFormSnapshot = useMemo(
    () => ({
      note,
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
      complaintCauseL2Review,
      complaintCauseL3Review,
      ticketTodoItems,
    }),
    [
      note,
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
      complaintCauseL2Review,
      complaintCauseL3Review,
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

  useEffect(() => {
    if (!feedback) {
      onDirtyChange?.(false)
      return
    }
    onDirtyChange?.(Boolean(isDrawerDirty))
    return () => onDirtyChange?.(false)
  }, [feedback, isDrawerDirty, onDirtyChange])

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
    if (shouldIncludeComplaintCauseReviewInSave(feedback, complaintCauseReviewTouched)) {
      draft = {
        ...draft,
        ...normalizeComplaintCauseReviewInput({
          l2: complaintCauseL2Review,
          l3: complaintCauseL3Review,
        }),
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
      Object.assign(
        patch,
        normalizeComplaintCauseReviewInput({
          l2: complaintCauseL2Review,
          l3: complaintCauseL3Review,
        }),
      )
    }
    Object.assign(
      patch,
      buildTicketTodoSavePatch(
        feedback,
        ticketTodoItems,
        user?.id ? { userId: user.id, username: user.username || user.id } : null,
      ),
    )
    const actionPatch = await persistEstablishedActionForTicket(feedback, {
      content: establishedAction,
      detail: establishedActionDetail,
      scheduleAt: actionSchedule,
      actionId,
      linkedFromLibrary,
    })
    Object.assign(patch, actionPatch)
    if ('actionId' in actionPatch) {
      setActionId(String(actionPatch.actionId ?? '').trim())
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
    <Drawer
      title={<TicketDetailDrawerTitle metaLine={ticketMetaLine} />}
      size={TICKET_DETAIL_DRAWER_WIDTH}
      open={Boolean(feedback)}
      onClose={handleRequestClose}
      closable={{ placement: 'end' }}
      destroyOnClose
      styles={{ body: { overflowX: 'hidden' } }}
      footer={
        reviewEnabled || canEdit || canRetag ? (
          <div className="flex items-center gap-3">
            {reviewEnabled ? (
              <Checkbox
                checked={Boolean(feedback?.id && isReviewDone(feedback.id))}
                disabled={!feedback?.id || reviewToggling}
                onChange={(event) => void handleReviewToggle(event)}
              >
                已处理
              </Checkbox>
            ) : null}
            <div className="flex flex-1 gap-2">
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

        {/* 1 · 工单内容 */}
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

        {/* 2 · 工单分析 */}
        <div id="ticket-detail-analysis" className="scroll-mt-2 space-y-3">
          <Typography.Title level={5} className="!mb-0 !text-sm !font-semibold">
            工单分析
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
                <div className="space-y-3">
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
                </div>

                <div className="space-y-3">
                  <Typography.Text strong className="text-xs">
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
                    <Collapse
                      ghost
                      className="!mb-3 [&_.ant-collapse-header]:!px-0 [&_.ant-collapse-content-box]:!px-0"
                      items={[
                        {
                          key: 'detail',
                          label: '举措详情（可选）',
                          children: (
                            <Input.TextArea
                              rows={3}
                              placeholder="默认为空"
                              maxLength={ESTABLISHED_ACTION_DETAIL_MAX_LENGTH}
                              showCount
                              disabled={libraryLinked || saving}
                              value={establishedActionDetail}
                              onChange={(e) => {
                                setEstablishedActionDetail(
                                  e.target.value.slice(0, ESTABLISHED_ACTION_DETAIL_MAX_LENGTH),
                                )
                              }}
                            />
                          ),
                        },
                      ]}
                    />
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
                {ticketTodoItems.map((item, index) => (
                  <div key={item.id} className="rounded-md border border-ink-100 p-2">
                    <div className="flex items-start gap-2">
                      <Checkbox
                        className="mt-1"
                        checked={item.done}
                        disabled={saving}
                        onChange={(event) => {
                          const next = [...ticketTodoItems]
                          next[index] = { ...item, done: event.target.checked }
                          setTicketTodoItems(next)
                        }}
                      />
                      <Input
                        className="min-w-0 flex-1"
                        placeholder="输入待办内容"
                        maxLength={TICKET_TODO_TEXT_MAX_LENGTH}
                        value={item.text}
                        disabled={saving}
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
                        className="w-[132px] shrink-0"
                        placeholder="负责人"
                        disabled={saving || !todoAssigneeOptions.length}
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
                    {formatTicketTodoItemUpdatedLine(item) ? (
                      <Typography.Text type="secondary" className="mt-1 block pl-6 text-xs">
                        最近编辑：{formatTicketTodoItemUpdatedLine(item)}
                      </Typography.Text>
                    ) : null}
                  </div>
                ))}
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
                      <Checkbox checked={item.done} disabled className="mt-0.5" />
                      <span className={item.done ? 'text-ink-400 line-through' : undefined}>
                        {item.text}
                      </span>
                    </div>
                    <Typography.Text type="secondary" className="mt-1 block pl-6 text-xs">
                      负责人：{formatTicketTodoAssigneeLabel(item)}
                      {formatTicketTodoItemUpdatedLine(item)
                        ? ` · 最近编辑：${formatTicketTodoItemUpdatedLine(item)}`
                        : ''}
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
        <div id="ticket-detail-classification" className="scroll-mt-2 space-y-3">
          <Typography.Title level={5} className="!mb-0 !text-sm !font-semibold">
            工单分类
          </Typography.Title>

          <Card size="small">
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
                只读展示工单导入的终判字段；下方人工复核（二级/三级）为可选，保存后重新打标不会覆盖。
              </Typography.Text>
              {canEdit ? (
                <Form layout="vertical">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Form.Item label="二级（人工复核）" className="!mb-0">
                      <Input
                        placeholder="默认为空"
                        maxLength={COMPLAINT_CAUSE_REVIEW_MAX_LENGTH}
                        value={complaintCauseL2Review}
                        onChange={(e) => {
                          setComplaintCauseReviewTouched(true)
                          setComplaintCauseL2Review(
                            e.target.value.slice(0, COMPLAINT_CAUSE_REVIEW_MAX_LENGTH),
                          )
                        }}
                      />
                    </Form.Item>
                    <Form.Item label="三级（人工复核）" className="!mb-0">
                      <Input
                        placeholder="默认为空"
                        maxLength={COMPLAINT_CAUSE_REVIEW_MAX_LENGTH}
                        value={complaintCauseL3Review}
                        onChange={(e) => {
                          setComplaintCauseReviewTouched(true)
                          setComplaintCauseL3Review(
                            e.target.value.slice(0, COMPLAINT_CAUSE_REVIEW_MAX_LENGTH),
                          )
                        }}
                      />
                    </Form.Item>
                  </div>
                  {isComplaintCauseReviewManuallyMaintained(feedback) ? (
                    <Typography.Text type="secondary" className="mt-2 block text-xs">
                      已人工复核；重新打标默认保留此维度。
                    </Typography.Text>
                  ) : null}
                </Form>
              ) : (
                <Descriptions column={2} size="small" bordered className="max-w-full">
                  <Descriptions.Item label="二级（人工复核）">
                    {complaintCauseL2Review || '—'}
                  </Descriptions.Item>
                  <Descriptions.Item label="三级（人工复核）">
                    {complaintCauseL3Review || '—'}
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
  )
}
