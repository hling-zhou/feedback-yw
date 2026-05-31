import { useCallback, useMemo } from 'react'
import { Modal, Radio, Typography, Checkbox, message } from 'antd'
import { useInsights } from '../context/InsightsContext.jsx'
import { usePeriodScope } from './usePeriodScope.js'
import { recordHasUnknownJourney } from '../lib/journeySemantic.js'
import { recordNeedsTicketLlmEnrichment } from '../lib/ticketAnalysis/ticketAnalysisSources.js'
import {
  BULK_RETAG_SCOPE_LABELS,
  RETAG_BACKGROUND_RUN_HINT,
  RETAG_BLOCKED_BY_IMPORT_TIP,
  RETAG_IN_PROGRESS_TIP,
} from '../lib/retagSession.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../lib/retagSession.js').BulkRetagScope} BulkRetagScope */

/**
 * 反馈库 / 洞察分析共用的「批量重新打标」确认弹窗与执行逻辑。
 *
 * @param {Object} options
 * @param {FeedbackRecord[]} options.filteredRecords 当前页筛选结果（洞察分析为 scoped，反馈库为 filtered）
 */
export function useBulkRetagModal({ filteredRecords }) {
  const { startBulkRetag, reprocessing, retagSession, importSession } = useInsights()
  const { periodFeedbacks, periodCount } = usePeriodScope()

  const unknownJourneyCount = useMemo(
    () => periodFeedbacks.filter(recordHasUnknownJourney).length,
    [periodFeedbacks],
  )

  const needsTicketLlmCount = useMemo(
    () => periodFeedbacks.filter(recordNeedsTicketLlmEnrichment).length,
    [periodFeedbacks],
  )

  const filteredCount = filteredRecords.length

  const resolveBulkRetagRecords = useCallback(
    /** @param {BulkRetagScope} scope */
    (scope) => {
      switch (scope) {
        case 'unknown_journey':
          return periodFeedbacks.filter(recordHasUnknownJourney)
        case 'needs_ticket_llm':
          return periodFeedbacks.filter(recordNeedsTicketLlmEnrichment)
        case 'filtered':
          return filteredRecords
        case 'period_all':
        default:
          return periodFeedbacks
      }
    },
    [periodFeedbacks, filteredRecords],
  )

  const bulkRetagBusy = reprocessing || retagSession.active
  const bulkRetagBlockedByImport = importSession.active
  const canOpenBulkRetag = periodCount > 0 || filteredCount > 0
  const bulkRetagDisabled = bulkRetagBusy || bulkRetagBlockedByImport || !canOpenBulkRetag
  const bulkRetagDisabledTip = bulkRetagBlockedByImport
    ? RETAG_BLOCKED_BY_IMPORT_TIP
    : bulkRetagBusy
      ? RETAG_IN_PROGRESS_TIP
      : !canOpenBulkRetag
        ? '当前洞察周期内暂无反馈数据'
        : undefined

  const openBulkRetagModal = useCallback(() => {
    if (!canOpenBulkRetag) {
      message.warning('当前洞察周期内暂无反馈数据')
      return
    }
    if (bulkRetagBlockedByImport) {
      message.warning(RETAG_BLOCKED_BY_IMPORT_TIP)
      return
    }
    if (bulkRetagBusy) {
      message.warning(RETAG_IN_PROGRESS_TIP)
      return
    }

    let selectedScope =
      periodCount > 0 && needsTicketLlmCount > 0
        ? 'needs_ticket_llm'
        : periodCount > 0
          ? 'period_all'
          : 'filtered'
    const scopeChoice = { value: selectedScope }
    const forceOverrideChoice = { value: false }

    Modal.confirm({
      title: '批量重新打标',
      width: 520,
      content: (
        <div className="pt-1">
          <Typography.Paragraph type="secondary" className="!mb-3">
            将重新执行四维打标（请求场景、问题类型、用户旅程、用户情绪）。以「处理意见」为主，并结合「受理内容」「追加信息」；匹配不到已配置标签时会调用大模型生成并写入待复核列表。用户情绪以客户请求内容、需求痛点为准。默认保留工单详情中人工保存过的标签维度。
          </Typography.Paragraph>
          <Radio.Group
            defaultValue={selectedScope}
            className="flex flex-col gap-2"
            onChange={(e) => {
              scopeChoice.value = e.target.value
            }}
          >
            <Radio value="period_all" disabled={periodCount === 0}>
              {BULK_RETAG_SCOPE_LABELS.period_all}（{periodCount} 条）
            </Radio>
            <Radio value="unknown_journey" disabled={unknownJourneyCount === 0}>
              {BULK_RETAG_SCOPE_LABELS.unknown_journey}（{unknownJourneyCount} 条）
            </Radio>
            <Radio value="needs_ticket_llm" disabled={needsTicketLlmCount === 0}>
              {BULK_RETAG_SCOPE_LABELS.needs_ticket_llm}（{needsTicketLlmCount} 条）
            </Radio>
            <Radio value="filtered" disabled={filteredCount === 0}>
              {BULK_RETAG_SCOPE_LABELS.filtered}（{filteredCount} 条）
            </Radio>
          </Radio.Group>
          <Checkbox
            className="!mt-3"
            onChange={(e) => {
              forceOverrideChoice.value = e.target.checked
            }}
          >
            强制覆盖全部人工内容
          </Checkbox>
          <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 text-xs">
            勾选后将清空各工单的人工标签标记与人工复核文本（根因、优化方案、举措、优化建议），用本次打标结果全量覆盖请求场景、问题类型、用户旅程、用户情绪及自动优化建议。
          </Typography.Paragraph>
          <Typography.Paragraph type="secondary" className="!mb-0 !mt-3 text-xs">
            {RETAG_BACKGROUND_RUN_HINT}。打标完成前请勿同时执行数据导入。
          </Typography.Paragraph>
        </div>
      ),
      okText: '继续',
      cancelText: '取消',
      onOk: () => {
        const records = resolveBulkRetagRecords(scopeChoice.value)
        if (!records.length) {
          message.warning('所选范围内没有可打标的工单')
          return Promise.reject(new Error('empty scope'))
        }
        const scope = scopeChoice.value
        void startBulkRetag({
          scope,
          records,
          forceOverrideManualTags: forceOverrideChoice.value,
        }).catch((e) => {
          message.error(e?.message || '批量重新打标失败')
        })
      },
    })
  }, [
    bulkRetagBlockedByImport,
    bulkRetagBusy,
    canOpenBulkRetag,
    filteredCount,
    periodCount,
    resolveBulkRetagRecords,
    startBulkRetag,
    unknownJourneyCount,
    needsTicketLlmCount,
  ])

  return {
    openBulkRetagModal,
    bulkRetagBusy,
    bulkRetagDisabled,
    bulkRetagDisabledTip,
    canOpenBulkRetag,
  }
}
