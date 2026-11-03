import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Popconfirm, Space, Tag, Tooltip, Typography, message } from 'antd'
import { BulbOutlined } from '@ant-design/icons'
import {
  listGeneralizationLinksByRecord,
  getGeneralizationHint,
  adoptGeneralizationHint,
  dismissGeneralizationHint,
  detachGeneralizationLink,
  getGeneralizationIssue,
} from '../../lib/generalizationClient.js'
import {
  GENERALIZATION_CATEGORY_LABELS,
  GENERALIZATION_ISSUE_STATUS_LABELS,
  GENERALIZATION_MATCH_CONFIDENCE_LABELS,
} from '../../domain/generalizationIssue.js'
import GeneralizationAttachModal from './GeneralizationAttachModal.jsx'

/** @typedef {import('../../lib/generalizationClient.js').GeneralizationIssueLink} GeneralizationIssueLink */
/** @typedef {import('../../lib/generalizationClient.js').GeneralizationHint} GeneralizationHint */

const CONFIDENCE_TAG_COLOR = {
  high: 'gold',
  medium: 'blue',
  low: 'default',
}

/**
 * 截断展示（根因分析/优化方案只读两行——v3.4 23:46 定稿）。
 * @param {string} text
 * @returns {string}
 */
export function clipReadOnlyField(text) {
  const t = String(text || '').trim()
  if (!t) return '待补全'
  return t.length > 40 ? `${t.slice(0, 40)}…` : t
}

/**
 * 抽屉内举一反三卡：AI 建议条（创建/忽略）+ 已关联列表（含根因/优化只读）+ 纳入入口。
 * 空态半显：保留标题行与「纳入举一反三」入口，内容区不渲染。
 * 位置：确立举措卡之后（抽屉最末卡），浅蓝底色补偿可见性——v3.3 ⑨ / TASKS G1-2。
 *
 * @param {Object} props
 * @param {import('../../lib/types.js').FeedbackRecord | null} props.feedback
 * @param {boolean} props.canEdit
 */
export default function GeneralizationCard({ feedback, canEdit }) {
  const [links, setLinks] = useState(/** @type {GeneralizationIssueLink[]} */ ([]))
  const [hint, setHint] = useState(/** @type {GeneralizationHint | null} */ (null))
  const [issueDetails, setIssueDetails] = useState(/** @type {Record<string, { rootCause: string, optimization: string, status: string, title: string }>} */ ({}))
  const [loading, setLoading] = useState(false)
  const [attachOpen, setAttachOpen] = useState(false)
  const [acting, setActing] = useState(false)
  const [messageApi, contextHolder] = message.useMessage()

  const recordId = String(feedback?.id || '').trim()

  const reload = useCallback(async () => {
    if (!recordId) return
    setLoading(true)
    try {
      const [rows, hintData] = await Promise.all([
        listGeneralizationLinksByRecord(recordId),
        getGeneralizationHint(recordId),
      ])
      setLinks(rows)
      setHint(hintData)
      // 批量补齐 confirmed link 指向 issue 的只读两字段（根因/优化）
      const confirmed = rows.filter((l) => l.linkStatus === 'confirmed')
      if (confirmed.length) {
        const details = /** @type {Record<string, { rootCause: string, optimization: string, status: string, title: string }>} */ ({})
        await Promise.all(
          confirmed.map(async (link) => {
            if (details[link.issueId]) return
            try {
              const { issue } = await getGeneralizationIssue(link.issueId)
              details[link.issueId] = {
                rootCause: issue?.rootCause || '',
                optimization: issue?.optimization || '',
                status: issue?.status || '',
                title: issue?.title || '',
              }
            } catch {
              // 单个 issue 拉取失败不阻塞卡片
            }
          }),
        )
        setIssueDetails(details)
      }
    } catch {
      // 拉取失败保持空态，不打扰抽屉主流程
    } finally {
      setLoading(false)
    }
  }, [recordId])

  useEffect(() => {
    void reload()
  }, [reload])

  const pendingHint = useMemo(
    () => (hint?.status === 'pending' ? hint : null),
    [hint],
  )
  const confirmedLinks = useMemo(
    () => links.filter((l) => l.linkStatus === 'confirmed'),
    [links],
  )
  const hasContent = Boolean(pendingHint) || confirmedLinks.length > 0

  const handleAdopt = async () => {
    setActing(true)
    try {
      const result = await adoptGeneralizationHint(recordId)
      messageApi.success(`已创建举一反三问题「${result.issue?.title || ''}」并关联本记录`)
      await reload()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '采纳失败，请重试')
    } finally {
      setActing(false)
    }
  }

  const handleDismiss = async () => {
    setActing(true)
    try {
      await dismissGeneralizationHint(recordId)
      messageApi.success('已忽略该建议')
      await reload()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setActing(false)
    }
  }

  const handleDetach = async (link) => {
    setActing(true)
    try {
      await detachGeneralizationLink(link.issueId, link.id)
      messageApi.success('已解除关联')
      await reload()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '解除失败')
    } finally {
      setActing(false)
    }
  }

  return (
    <div className="page-card-sm" style={{ backgroundColor: '#f0f7ff' }}>
      {contextHolder}
      <div className="page-card-header">
        <span className="page-card-title">
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="shrink-0">举一反三</span>
            {hasContent ? (
              <Badge
                count={pendingHint ? 1 : undefined}
                size="small"
                title={pendingHint ? '1 条 AI 建议待确认' : undefined}
              >
                <Typography.Text type="secondary" className="text-xs font-normal">
                  {confirmedLinks.length} 个关联{pendingHint ? ' · 1 条 AI 建议' : ''}
                </Typography.Text>
              </Badge>
            ) : (
              <Typography.Text type="secondary" className="text-xs font-normal">
                {loading
                  ? '加载中…'
                  : canEdit
                    ? '暂无。若此问题在多个场景或多个产品反复出现、且原因可改进（如代码缺陷、文档错误、规则设计），可纳入举一反三横向排查。'
                    : '暂无'}
              </Typography.Text>
            )}
          </span>
        </span>
        {canEdit ? (
          <Button
            size="small"
            icon={<BulbOutlined />}
            disabled={!recordId}
            onClick={() => setAttachOpen(true)}
          >
            纳入举一反三
          </Button>
        ) : null}
      </div>

      {hasContent ? (
        <div className="space-y-3">
          {pendingHint ? (
            <div className="rounded-md border border-amber-200 bg-amber-50/60 p-2">
              <div className="flex flex-wrap items-center gap-2">
                <Typography.Text strong className="text-sm">
                  AI 建议：需要举一反三
                </Typography.Text>
                {pendingHint.category ? (
                  <Tag color="geekblue">
                    范畴：{GENERALIZATION_CATEGORY_LABELS[pendingHint.category] || pendingHint.category}
                  </Tag>
                ) : null}
                {pendingHint.confidence ? (
                  <Tag color={CONFIDENCE_TAG_COLOR[pendingHint.confidence] || 'default'}>
                    把握：{GENERALIZATION_MATCH_CONFIDENCE_LABELS[pendingHint.confidence] || pendingHint.confidence}
                  </Tag>
                ) : null}
              </div>
              {pendingHint.reason ? (
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  理由：{pendingHint.reason}
                </Typography.Text>
              ) : null}
              <Space size="small" className="mt-2">
                {canEdit ? (
                  <Button
                    size="small"
                    type="primary"
                    loading={acting}
                    onClick={() => void handleAdopt()}
                  >
                    创建举一反三问题
                  </Button>
                ) : null}
                <Button
                  size="small"
                  loading={acting}
                  onClick={() => void handleDismiss()}
                >
                  忽略
                </Button>
              </Space>
            </div>
          ) : null}

          {confirmedLinks.length ? (
            <div className="space-y-1.5">
              <Typography.Text type="secondary" className="block text-xs">
                已关联
              </Typography.Text>
              {confirmedLinks.map((link) => {
                const detail = issueDetails[link.issueId]
                return (
                  <div
                    key={link.id}
                    className="rounded-md border border-ink-100 bg-white/70 p-2"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {detail?.title || link.matchedExcerpt || `举一反三问题 ${link.issueId.slice(0, 8)}`}
                      </span>
                      <Space size={0}>
                        {detail?.status ? (
                          <Tag className="!mr-1">
                            {GENERALIZATION_ISSUE_STATUS_LABELS[detail.status] || detail.status}
                          </Tag>
                        ) : null}
                        {detail?.rootCause !== undefined ? (
                          <Tooltip title={`根因分析：${clipReadOnlyField(detail.rootCause)}`}>
                            <Button size="small" type="link" disabled>
                              查看详情
                            </Button>
                          </Tooltip>
                        ) : (
                          <Tooltip title="在「问题与举措 · 举一反三」Tab 中查看">
                            <Button size="small" type="link" disabled>
                              查看
                            </Button>
                          </Tooltip>
                        )}
                        {canEdit ? (
                          <Popconfirm
                            title="解除此记录与举一反三问题的关联？"
                            okText="解除"
                            okButtonProps={{ danger: true }}
                            onConfirm={() => void handleDetach(link)}
                          >
                            <Button
                              size="small"
                              type="link"
                              danger
                              loading={acting}
                            >
                              解除
                            </Button>
                          </Popconfirm>
                        ) : null}
                      </Space>
                    </div>
                    {detail ? (
                      <div className="mt-1 space-y-0.5">
                        <Tooltip title={detail.rootCause || '待补全'}>
                          <div className="truncate text-xs text-ink-500">
                            根因分析:{' '}
                            <span className={detail.rootCause ? '' : 'text-ink-400'}>
                              {clipReadOnlyField(detail.rootCause)}
                            </span>
                          </div>
                        </Tooltip>
                        <Tooltip title={detail.optimization || '待补全'}>
                          <div className="truncate text-xs text-ink-500">
                            优化方案:{' '}
                            <span className={detail.optimization ? '' : 'text-ink-400'}>
                              {clipReadOnlyField(detail.optimization)}
                            </span>
                          </div>
                        </Tooltip>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {attachOpen ? (
        <GeneralizationAttachModal
          open={attachOpen}
          onClose={() => setAttachOpen(false)}
          record={feedback}
          suggested={
            pendingHint
              ? { category: pendingHint.category, scope: pendingHint.scope }
              : undefined
          }
          onAttached={() => void reload()}
        />
      ) : null}
    </div>
  )
}
