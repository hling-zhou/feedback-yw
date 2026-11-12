import { useEffect, useMemo, useState } from 'react'
import { Alert, Select, Spin, Typography, message } from 'antd'
import {
  deleteReportIssueLink,
  listSourceReportIssues,
  saveReportIssueLink,
} from '../../lib/postUseRating/reportClient.js'

export default function PostUseReportIssueLinker({ sourceType, sourceId, open, canEdit }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState('')

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
      message.success(verdict ? '已关联具体问题' : '已解除问题关联')
    } catch (error) {
      message.error(error?.message || '保存问题关联失败')
    } finally {
      setSavingId('')
    }
  }

  const options = [
    { value: 'related', label: '关联问题' },
    ...(data?.noProblemEligible ? [{ value: 'no_issue', label: '回访确认无问题，排除该问题' }] : []),
  ]

  return (
    <div className="space-y-2">
      <Typography.Text strong>关联原始负反馈的具体问题</Typography.Text>
      <Typography.Paragraph type="secondary" className="!mb-2">
        仅匹配同客户、同产品及对应数据月份。确认无问题仅排除所选具体问题，原始评分与原话统计保留。
      </Typography.Paragraph>
      {loading ? <Spin size="small" /> : null}
      {!loading && !data?.items?.length ? <Alert type="info" showIcon message="未找到可关联的原始负反馈" /> : null}
      {!loading && (data?.items || []).map((issue) => (
        <div key={issue.id} className="rounded border border-slate-200 p-3">
          <div>{issue.issueName} · {issue.month}{issue.score == null ? '' : ` · ${issue.score} 分`}</div>
          <Typography.Text type="secondary">原话：{issue.text}</Typography.Text>
          <div className="mt-2">
            <Select
              aria-label={`${issue.issueName}的关联结论`}
              className="w-full"
              allowClear
              placeholder="未关联"
              disabled={!canEdit || Boolean(savingId)}
              loading={savingId === issue.id}
              value={links.get(issue.id)?.verdict || undefined}
              options={options}
              onChange={(value) => void change(issue.id, value)}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
