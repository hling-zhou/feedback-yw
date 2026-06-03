import { useCallback, useMemo } from 'react'
import { Modal, Radio, Typography, Checkbox, message } from 'antd'
import { useInsights } from '../context/InsightsContext.jsx'
import { useAuth } from '../context/AuthContext.jsx'
import { canBulkRetagScope } from '../domain/auth/permissions.js'
import { useSharedBackgroundTaskBlock } from './useSharedBackgroundTaskBlock.js'
import { usePeriodScope } from './usePeriodScope.js'
import { recordHasUnknownJourney } from '../lib/journeySemantic.js'
import {
  recordNeedsJourneyLlmEnrichment,
  recordNeedsTicketLlmEnrichment,
} from '../lib/ticketAnalysis/ticketAnalysisSources.js'
import {
  BULK_RETAG_SCOPE_LABELS,
  RETAG_BACKGROUND_RUN_HINT,
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
  const { startBulkRetag, reprocessing, retagSession, settings } = useInsights()
  const { user } = useAuth()
  const { retagBlocked, retagBlockedTip } = useSharedBackgroundTaskBlock()
  const { periodFeedbacks, periodCount } = usePeriodScope()
  const canPeriodAll = canBulkRetagScope(user?.role, 'period_all')

  const unknownJourneyCount = useMemo(
    () => periodFeedbacks.filter(recordHasUnknownJourney).length,
    [periodFeedbacks],
  )

  const needsTicketLlmCount = useMemo(
    () => periodFeedbacks.filter(recordNeedsTicketLlmEnrichment).length,
    [periodFeedbacks],
  )

  const needsJourneyLlmCount = useMemo(
    () => periodFeedbacks.filter((r) => recordNeedsJourneyLlmEnrichment(r, settings)).length,
    [periodFeedbacks, settings],
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
        case 'needs_journey_llm':
          return periodFeedbacks.filter((r) => recordNeedsJourneyLlmEnrichment(r, settings))
        case 'filtered':
          return filteredRecords
        case 'period_all':
        default:
          return periodFeedbacks
      }
    },
    [periodFeedbacks, filteredRecords, settings],
  )

  const bulkRetagBusy = reprocessing || retagSession.active
  const canOpenBulkRetag = periodCount > 0 || filteredCount > 0
  const bulkRetagDisabled = bulkRetagBusy || retagBlocked || !canOpenBulkRetag
  const bulkRetagDisabledTip = retagBlocked
    ? retagBlockedTip
    : bulkRetagBusy
      ? '打标进行中'
      : !canOpenBulkRetag
        ? '当前洞察周期内暂无反馈数据'
        : undefined

  const isScopeAvailable = useCallback(
    /** @param {BulkRetagScope} scope */
    (scope) => {
      switch (scope) {
        case 'unknown_journey':
          return unknownJourneyCount > 0
        case 'needs_ticket_llm':
          return needsTicketLlmCount > 0
        case 'needs_journey_llm':
          return needsJourneyLlmCount > 0
        case 'filtered':
          return filteredCount > 0
        case 'period_all':
          return periodCount > 0 && canPeriodAll
        default:
          return false
      }
    },
    [
      unknownJourneyCount,
      needsTicketLlmCount,
      needsJourneyLlmCount,
      filteredCount,
      periodCount,
      canPeriodAll,
    ],
  )

  const resolveDefaultScope = useCallback(
    /** @param {BulkRetagScope | undefined} preferred */
    (preferred) => {
      if (preferred && isScopeAvailable(preferred)) return preferred
      if (!canPeriodAll && filteredCount > 0) return 'filtered'
      if (periodCount > 0 && needsTicketLlmCount > 0) return 'needs_ticket_llm'
      if (periodCount > 0 && canPeriodAll) return 'period_all'
      return 'filtered'
    },
    [isScopeAvailable, periodCount, needsTicketLlmCount, canPeriodAll, filteredCount],
  )

  const runBulkRetag = useCallback(
    /** @param {{ scope: BulkRetagScope; forceOverrideManualTags?: boolean; retagDimensionsAfterTicketLlm?: boolean }} opts */
    (opts) => {
      const records = resolveBulkRetagRecords(opts.scope)
      if (!records.length) {
        message.warning('所选范围内没有可打标的工单')
        return
      }
      void startBulkRetag({
        scope: opts.scope,
        records,
        forceOverrideManualTags: opts.forceOverrideManualTags === true,
        retagDimensionsAfterTicketLlm:
          opts.retagDimensionsAfterTicketLlm ?? settings.retagDimensionsAfterTicketLlm !== false,
      }).catch((e) => {
        message.error(e?.message || '批量重新打标失败')
      })
    },
    [resolveBulkRetagRecords, startBulkRetag, settings.retagDimensionsAfterTicketLlm],
  )

  const guardBulkRetagStart = useCallback(() => {
    if (!canOpenBulkRetag) {
      message.warning('当前洞察周期内暂无反馈数据')
      return false
    }
    if (retagBlocked) {
      message.warning(retagBlockedTip || '当前无法批量重新打标')
      return false
    }
    if (bulkRetagBusy) {
      message.warning('打标进行中')
      return false
    }
    return true
  }, [retagBlocked, retagBlockedTip, bulkRetagBusy, canOpenBulkRetag])

  /** 跳过确认弹窗，按固定 scope 直接启动（反馈库「补打 / 补打旅程」） */
  const startScopedBulkRetag = useCallback(
    /** @param {BulkRetagScope} scope */
    (scope) => {
      if (!guardBulkRetagStart()) return
      if (!isScopeAvailable(scope)) {
        message.warning('所选范围内没有可打标的工单')
        return
      }
      runBulkRetag({ scope })
    },
    [guardBulkRetagStart, isScopeAvailable, runBulkRetag],
  )

  const openBulkRetagModal = useCallback(
    /** @param {{ initialScope?: BulkRetagScope }} [options] */
    (options = {}) => {
      if (!guardBulkRetagStart()) return

      const selectedScope = resolveDefaultScope(options.initialScope)
      const scopeChoice = { value: selectedScope }
      const forceOverrideChoice = { value: false }
      const retagDimensionsChoice = { value: settings.retagDimensionsAfterTicketLlm !== false }

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
              <Radio value="period_all" disabled={periodCount === 0 || !canPeriodAll}>
                {BULK_RETAG_SCOPE_LABELS.period_all}（{periodCount} 条）
              </Radio>
              <Radio value="unknown_journey" disabled={unknownJourneyCount === 0}>
                {BULK_RETAG_SCOPE_LABELS.unknown_journey}（{unknownJourneyCount} 条）
              </Radio>
              <Radio value="needs_ticket_llm" disabled={needsTicketLlmCount === 0}>
                {BULK_RETAG_SCOPE_LABELS.needs_ticket_llm}（{needsTicketLlmCount} 条）
              </Radio>
              <Radio value="needs_journey_llm" disabled={needsJourneyLlmCount === 0}>
                {BULK_RETAG_SCOPE_LABELS.needs_journey_llm}（{needsJourneyLlmCount} 条）
              </Radio>
              <Radio value="filtered" disabled={filteredCount === 0}>
                {BULK_RETAG_SCOPE_LABELS.filtered}（{filteredCount} 条）
              </Radio>
            </Radio.Group>
            <Checkbox
              className="!mt-3"
              defaultChecked={retagDimensionsChoice.value}
              onChange={(e) => {
                retagDimensionsChoice.value = e.target.checked
              }}
            >
              工单 LLM 成功后重打请求场景与问题类型
            </Checkbox>
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 text-xs">
              默认与团队设置一致。仅对 ticket LLM 成功写入客户请求或痛点的工单生效；不勾选则保留规则初标结果。
            </Typography.Paragraph>
            <Checkbox
              className="!mt-3"
              onChange={(e) => {
                forceOverrideChoice.value = e.target.checked
              }}
            >
              强制覆盖全部人工内容
            </Checkbox>
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-1 text-xs">
              勾选后将：清空人工维护标记与本工单的确立举措、排期、产品组/设计师优化建议（不删除举措库中其他工单共用的举措）；根因排查回退为导入「问题原因」；覆盖请求场景、问题类型、用户旅程、用户情绪、加急；若本次含工单 LLM，客户请求与需求痛点一并重算；自动优化建议（规则/大模型）可随 LLM 重算。不修改受理/处理原文、备注、跟进状态、投诉原因（终判）等。补打/补打旅程与全量重打规则一致。
            </Typography.Paragraph>
            <Typography.Paragraph type="secondary" className="!mb-0 !mt-3 text-xs">
              {RETAG_BACKGROUND_RUN_HINT}。打标完成前请勿同时执行数据导入。
            </Typography.Paragraph>
          </div>
        ),
        okText: '继续',
        cancelText: '取消',
        onOk: () => {
          const scope = scopeChoice.value
          const records = resolveBulkRetagRecords(scope)
          if (!records.length) {
            message.warning('所选范围内没有可打标的工单')
            return Promise.reject(new Error('empty scope'))
          }
          runBulkRetag({
            scope,
            forceOverrideManualTags: forceOverrideChoice.value,
            retagDimensionsAfterTicketLlm: retagDimensionsChoice.value,
          })
        },
      })
    },
    [
      guardBulkRetagStart,
      filteredCount,
      periodCount,
      resolveBulkRetagRecords,
      resolveDefaultScope,
      runBulkRetag,
      unknownJourneyCount,
      needsTicketLlmCount,
      needsJourneyLlmCount,
      settings.retagDimensionsAfterTicketLlm,
      canPeriodAll,
    ],
  )

  return {
    openBulkRetagModal,
    startScopedBulkRetag,
    bulkRetagBusy,
    bulkRetagDisabled,
    bulkRetagDisabledTip,
    canOpenBulkRetag,
  }
}
