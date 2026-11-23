import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Select, Spin, Typography, message } from 'antd'
import {
  autoJudgeReportIssueLinks,
  deleteReportIssueLink,
  listSourceReportIssues,
  saveReportIssueLink,
} from '../../lib/postUseRating/reportClient.js'

// 11-23 拍板（午后修订）：no_action 文案统一「产品部评估无需优改」——溯源结论与回访内部评估
// 两类来源共用（回访保持 3 选项：内部评估环节可承载无需优改结论）
// - no_dissatisfaction：无实际不满——回访核实客户根本没不满（误操作/情绪分），报告全模块不进（仅回访）
// - no_action：产品部评估无需优改——不进定性（关注项/核心结论）、进定量（低分原因汇总/主题分布）
const VERDICT_LABELS = {
  related: '问题存在',
  no_dissatisfaction: '无实际不满（不进分析）',
  no_action: '产品部评估无需优改（不进定性）',
}

export default function PostUseReportIssueLinker({ sourceType, sourceId, open, canEdit }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState('')
  const [autoJudging, setAutoJudging] = useState(false)

  useEffect(() => {
    if (!open || !sourceId) return undefined
    let cancelled = false
    setLoading(true)
    listSourceReportIssues(sourceType, sourceId)
      .then((result) => { if (!cancelled) setData(result) })
      .catch((error) => { if (!cancelled) message.error(error?.message || '加载问题关联失败') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [sourceType, sourceId, open])

  const links = useMemo(() => new Map((data?.links || []).map((row) => [row.issueId, row])), [data])

  const change = async (issueId, verdict) => {
    setSavingId(issueId)
    try {
      if (verdict) await saveReportIssueLink(sourceType, sourceId, issueId, verdict)
      else await deleteReportIssueLink(sourceType, sourceId, issueId)
      setData(await listSourceReportIssues(sourceType, sourceId))
      message.success(verdict ? '已保存关联判定' : '已解除问题关联')
    } catch (error) {
      message.error(error?.message || '保存问题关联失败')
    } finally {
      setSavingId('')
    }
  }

  const runAutoJudge = async () => {
    setAutoJudging(true)
    try {
      const result = await autoJudgeReportIssueLinks(sourceType, sourceId)
      setData(await listSourceReportIssues(sourceType, sourceId))
      // 11-23 晚修复：后端三触发点重构后契约={saved,skippedManual,judged,message}（旧 verdicts
      // 数组已废）——旧读法 result.verdicts 恒 undefined → 计数恒 0（用户实报"0 个候选"根因）。
      // 直接透传后端 message（已区分"无候选/全 uncertain/人工不覆盖"三态）。
      message.success(result?.message || 'LLM 判定完成')
    } catch (error) {
      message.error(error?.message || 'LLM 自动判定失败，请稍后重试')
    } finally {
      setAutoJudging(false)
    }
  }

  const options = Object.entries(VERDICT_LABELS)
    .filter(([value]) => value !== 'no_dissatisfaction' || sourceType === 'visit')
    .map(([value, label]) => ({ value, label }))

  return (
    <div className="space-y-2">
      <Typography.Text strong>关联原始负反馈的具体问题</Typography.Text>
      <Typography.Paragraph type="secondary" className="!mb-2">
        仅匹配同客户、同产品及对应数据月份。判定语义：「问题存在」保留并挂回访/溯源结论；
        「无实际不满」该问题不进报告分析；「产品部评估无需优改」不进定性分析（关注项/核心结论）、进定量统计。
      </Typography.Paragraph>
      {loading ? <Spin size="small" /> : null}
      {!loading && !data?.items?.length ? <Alert type="info" showIcon message="未找到可关联的原始负反馈" /> : null}
      {!loading && (data?.items || []).length && canEdit ? (
        <Button size="small" loading={autoJudging} onClick={() => void runAutoJudge()}>
          LLM 自动判定
        </Button>
      ) : null}
      {!loading && (data?.items || []).map((issue) => {
        const link = links.get(issue.id)
        return (
          <div key={issue.id} className="rounded border border-slate-200 p-3">
            <div>{issue.issueName} · {issue.month}{issue.score == null ? '' : ` · ${issue.score} 分`}</div>
            <Typography.Text type="secondary">{issue.kind === 'option' ? '选项' : '原话'}：{issue.text}</Typography.Text>
            <div className="mt-2">
              <Select
                aria-label={`${issue.issueName}的关联结论`}
                className="w-full"
                allowClear
                placeholder="未判定"
                disabled={!canEdit || Boolean(savingId)}
                loading={savingId === issue.id}
                value={link?.verdict || undefined}
                options={options}
                onChange={(value) => void change(issue.id, value)}
              />
              {link?.verdictSource === 'llm' && link?.verdict ? (
                <Typography.Text type="secondary" className="mt-1 block text-xs">LLM 自动判定（可修正）</Typography.Text>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
