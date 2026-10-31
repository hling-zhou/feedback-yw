import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Popconfirm, Space, Tag, Tooltip, Typography, message } from 'antd'
import {
  EyeOutlined,
} from '@ant-design/icons'
import {
  listObservationLinksByRecord,
  reviewObservationMatch,
  detachObservationLink,
} from '../../lib/observationClient.js'
import {
  OBSERVATION_MATCH_CONFIDENCE_LABELS,
} from '../../domain/observationIssue.js'
import ObservationAttachModal from './ObservationAttachModal.jsx'

/** @typedef {import('../../lib/observationClient.js').ObservationIssueLink} ObservationIssueLink */

const CONFIDENCE_TAG_COLOR = {
  high: 'gold',
  medium: 'blue',
  low: 'default',
}

/**
 * 抽屉内留观卡：疑似命中建议（三选一就地处理）+ 已关联列表 + 右上纳入观察。
 * 空态半显：保留标题行与「纳入观察」入口（S1/S2 主路径），内容区不渲染。
 *
 * @param {Object} props
 * @param {import('../../lib/types.js').FeedbackRecord | null} props.feedback
 * @param {boolean} props.canEdit
 * @param {'complaint_ticket' | 'consultation_ticket' | 'post_use_rating'} props.recordDataSource
 */
export default function ObservationCard({ feedback, canEdit, recordDataSource }) {
  const [links, setLinks] = useState(/** @type {ObservationIssueLink[]} */ ([]))
  const [loading, setLoading] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [actingLinkIds, setActingLinkIds] = useState(new Set())
  const [messageApi, contextHolder] = message.useMessage()

  const recordId = String(feedback?.id || '').trim()
  const productName = String(feedback?.product || feedback?.productName || '').trim()

  const reload = useCallback(async () => {
    if (!recordId) return
    setLoading(true)
    try {
      const rows = await listObservationLinksByRecord(recordId)
      setLinks(rows)
    } catch {
      // 拉取失败保持空态，不打扰抽屉主流程
    } finally {
      setLoading(false)
    }
  }, [recordId])

  useEffect(() => {
    void reload()
  }, [reload])

  const pendingSuggestions = useMemo(
    () => links.filter((l) => l.linkStatus === 'pending_suggest'),
    [links],
  )
  const confirmedLinks = useMemo(
    () => links.filter((l) => l.linkStatus === 'confirmed'),
    [links],
  )
  const hasContent = pendingSuggestions.length > 0 || confirmedLinks.length > 0

  const withActing = (linkId, fn) => async () => {
    setActingLinkIds((prev) => new Set(prev).add(linkId))
    try {
      await fn()
    } finally {
      setActingLinkIds((prev) => {
        const next = new Set(prev)
        next.delete(linkId)
        return next
      })
    }
  }

  const handleReview = (linkId, action, extra) =>
    withActing(linkId, async () => {
      try {
        const result = await reviewObservationMatch(linkId, action, extra)
        if (action === 'confirm') messageApi.success('已确认为同一留观问题')
        else if (action === 'new_issue') {
          messageApi.success(`已新建留观问题「${result.issue?.title || ''}」并关联`)
        }
        await reload()
      } catch (err) {
        messageApi.error(err instanceof Error ? err.message : '操作失败，请重试')
      }
    })

  const handleNewIssueFromSuggestion = (link) =>
    handleReview(link.id, 'new_issue', {
      newIssue: {
        title: String(link.matchedExcerpt || '新建留观问题').slice(0, 100),
        summary: String(link.matchedExcerpt || '').slice(0, 100) || '由建议卡新建',
        productKey: String(feedback?.productKey || '').trim(),
        productName,
      },
    })

  const handleDetach = (link) =>
    withActing(link.id, async () => {
      try {
        await detachObservationLink(link.issueId, link.id)
        messageApi.success('已解除关联')
        await reload()
      } catch (err) {
        messageApi.error(err instanceof Error ? err.message : '解除失败')
      }
    })

  return (
    <div className="page-card-sm">
      {contextHolder}
      <div className="page-card-header">
        <span className="page-card-title">
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="shrink-0">留观问题</span>
            {hasContent ? (
              <Badge
                count={pendingSuggestions.length || undefined}
                size="small"
                title={pendingSuggestions.length ? `${pendingSuggestions.length} 条待复核建议` : undefined}
              >
                <Typography.Text type="secondary" className="text-xs font-normal">
                  {confirmedLinks.length} 个关联 · {pendingSuggestions.length} 条建议
                </Typography.Text>
              </Badge>
            ) : (
              <Typography.Text type="secondary" className="text-xs font-normal">
                {loading
                  ? '加载中…'
                  : canEdit
                    ? '暂无。点「纳入观察」可关联已有问题或新建。'
                    : '暂无'}
              </Typography.Text>
            )}
          </span>
        </span>
        {canEdit ? (
          <Button
            size="small"
            icon={<EyeOutlined />}
            disabled={!recordId}
            onClick={() => setAttachOpen(true)}
          >
            纳入观察
          </Button>
        ) : null}
      </div>

      {hasContent ? (
        <div className="space-y-3">
          {pendingSuggestions.map((link) => (
            <div
              key={link.id}
              className="rounded-md border border-amber-200 bg-amber-50/60 p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Typography.Text strong className="text-sm">
                  疑似命中留观问题
                </Typography.Text>
                {link.matchConfidence ? (
                  <Tag color={CONFIDENCE_TAG_COLOR[link.matchConfidence] || 'default'}>
                    {OBSERVATION_MATCH_CONFIDENCE_LABELS[link.matchConfidence] || link.matchConfidence}
                  </Tag>
                ) : null}
                <Typography.Text type="secondary" className="text-xs">
                  {link.matchedExcerpt || '—'}
                </Typography.Text>
              </div>
              {link.matchReason ? (
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  理由：{link.matchReason}
                </Typography.Text>
              ) : null}
              <Space size="small" className="mt-2">
                <Button
                  size="small"
                  type="primary"
                  loading={actingLinkIds.has(link.id)}
                  onClick={() => void handleReview(link.id, 'confirm')}
                >
                  确认关联
                </Button>
                {canEdit ? (
                  <Button
                    size="small"
                    loading={actingLinkIds.has(link.id)}
                    onClick={() => void handleNewIssueFromSuggestion(link)}
                  >
                    新建留观
                  </Button>
                ) : null}
                <Button
                  size="small"
                  loading={actingLinkIds.has(link.id)}
                  onClick={() => void handleReview(link.id, 'dismiss')}
                >
                  不纳入
                </Button>
              </Space>
            </div>
          ))}

          {confirmedLinks.length ? (
            <div className="space-y-1.5">
              <Typography.Text type="secondary" className="block text-xs">
                已关联
              </Typography.Text>
              {confirmedLinks.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-ink-100 p-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {link.matchedExcerpt || `留观问题 ${link.issueId.slice(0, 8)}`}
                  </span>
                  <Space size={0}>
                    <Tooltip title="在「问题与举措 · 留观问题」Tab 中查看">
                      <Button size="small" type="link" disabled>
                        查看
                      </Button>
                    </Tooltip>
                    {canEdit ? (
                      <Popconfirm
                        title="解除此记录与留观问题的关联？"
                        okText="解除"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => void handleDetach(link)}
                      >
                        <Button
                          size="small"
                          type="link"
                          danger
                          loading={actingLinkIds.has(link.id)}
                        >
                          解除
                        </Button>
                      </Popconfirm>
                    ) : null}
                  </Space>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {attachOpen ? (
        <ObservationAttachModal
          open={attachOpen}
          onClose={() => setAttachOpen(false)}
          record={feedback}
          recordDataSource={recordDataSource}
          onAttached={() => void reload()}
        />
      ) : null}
    </div>
  )
}
