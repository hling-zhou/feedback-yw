import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Input, Modal, Select, Space, Table, Tag, Typography } from 'antd'
import { CopyOutlined, ReloadOutlined } from '@ant-design/icons'
import { useInsights } from '../../context/InsightsContext.jsx'
import { useAppMessage } from '../../hooks/useAppMessage.js'
import { copyTextToClipboard } from '../../lib/clipboard.js'
import { TAG_CORRECTION_DIMENSION_LABELS } from '../../lib/learning/constants.js'
import { loadCorrectionEvents } from '../../lib/learning/tagCorrectionStore.js'
import { loadCorrectionRules } from '../../lib/learning/tagCorrectionRules.js'
import { mineTagCorrectionCandidates } from '../../lib/learning/tagCorrectionMining.js'
import { upsertCorrectionRule } from '../../lib/learning/tagCorrectionApprove.js'
import { buildDecisionTreeDevSpec } from '../../lib/learning/buildDecisionTreeDevSpec.js'
import { replayCorrectionsNow } from '../../lib/learning/hydrateLearning.js'
import { listAllFeedbacks } from '../../storage/feedbackStore.js'

const STATUS_META = {
  pending: { color: 'orange', text: '待复核' },
  approved: { color: 'green', text: '已采纳' },
  rejected: { color: 'default', text: '已拒绝' },
  needs_tree_patch: { color: 'purple', text: '建议补决策树' },
  tree_patched: { color: 'blue', text: '已补决策树' },
}

/**
 * @param {{ readOnly?: boolean }} props
 */
export default function TagCorrectionReviewPanel({ readOnly = false }) {
  const { adapter, feedbacks, reloadTaxonomy } = useInsights()
  const message = useAppMessage()
  const [loading, setLoading] = useState(false)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [candidates, setCandidates] = useState(/** @type {import('../../lib/learning/tagCorrectionRules.js').TagCorrectionRule[]} */ ([]))
  const [rules, setRules] = useState(/** @type {import('../../lib/learning/tagCorrectionRules.js').TagCorrectionRule[]} */ ([]))
  const [keywordDraft, setKeywordDraft] = useState(/** @type {Record<string, string>} */ ({}))
  const [specOpen, setSpecOpen] = useState(false)
  const [specText, setSpecText] = useState('')
  const [specRule, setSpecRule] = useState(/** @type {import('../../lib/learning/tagCorrectionRules.js').TagCorrectionRule | null} */ (null))

  const refresh = useCallback(async () => {
    if (!adapter) return
    setLoading(true)
    try {
      const [events, storedRules] = await Promise.all([
        loadCorrectionEvents(adapter),
        loadCorrectionRules(adapter),
      ])
      setRules(storedRules)
      setCandidates(mineTagCorrectionCandidates(events, feedbacks, storedRules))
    } catch (err) {
      console.warn('[learning] 加载改标学习失败', err)
      message.error('加载改标学习失败')
    } finally {
      setLoading(false)
    }
  }, [adapter, feedbacks, message])

  useEffect(() => {
    refresh()
  }, [refresh])

  const rows = useMemo(() => {
    if (statusFilter === 'all') return candidates
    return candidates.filter((c) => c.status === statusFilter)
  }, [candidates, statusFilter])

  const pendingCount = candidates.filter((c) => c.status === 'pending').length

  const applyStatus = async (row, status, extra = {}) => {
    const keywords = (keywordDraft[row.id] ?? row.keywords.join('、'))
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
    const result = await upsertCorrectionRule(adapter, rules, row, {
      status,
      keywords,
      ...extra,
    })
    setRules(result.rules)
    await reloadTaxonomy()
    await refresh()
  }

  const columns = [
    {
      title: '维度',
      dataIndex: 'dimension',
      width: 100,
      render: (v) => TAG_CORRECTION_DIMENSION_LABELS[v] || v,
    },
    {
      title: '系统 → 人工',
      key: 'pair',
      render: (_, row) => (
        <span>
          {row.fromLabel || '（空）'}
          <Typography.Text type="secondary"> → </Typography.Text>
          <Typography.Text strong>{row.toLabel}</Typography.Text>
        </span>
      ),
    },
    {
      title: '证据',
      key: 'evidence',
      width: 110,
      render: (_, row) => `${row.evidenceCount} 单 / ${row.distinctMonths || 0} 月`,
    },
    {
      title: '关键词',
      dataIndex: 'keywords',
      render: (_, row) =>
        readOnly ? (
          (row.keywords || []).join('、')
        ) : (
          <Input
            size="small"
            value={keywordDraft[row.id] ?? row.keywords.join('、')}
            onChange={(e) => setKeywordDraft((prev) => ({ ...prev, [row.id]: e.target.value }))}
            placeholder="逗号分隔"
          />
        ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (v) => {
        const meta = STATUS_META[v] || STATUS_META.pending
        return <Tag color={meta.color}>{meta.text}</Tag>
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      render: (_, row) =>
        readOnly ? null : (
          <Space wrap size="small">
            {row.status === 'pending' && (
              <>
                <Button size="small" type="primary" onClick={() => applyStatus(row, 'approved')}>
                  采纳
                </Button>
                <Button size="small" onClick={() => applyStatus(row, 'rejected')}>
                  拒绝
                </Button>
              </>
            )}
            {(row.status === 'approved' || row.status === 'pending') && (
              <Button
                size="small"
                onClick={async () => {
                  if (row.status === 'pending') await applyStatus(row, 'needs_tree_patch')
                  else await applyStatus(row, 'needs_tree_patch')
                  const spec = buildDecisionTreeDevSpec(row)
                  setSpecRule(row)
                  setSpecText(spec)
                  setSpecOpen(true)
                }}
              >
                建议补决策树
              </Button>
            )}
            {(row.status === 'approved' || row.status === 'needs_tree_patch') && (
              <Button
                size="small"
                icon={<CopyOutlined />}
                onClick={() => {
                  const spec = buildDecisionTreeDevSpec(row)
                  setSpecRule(row)
                  setSpecText(spec)
                  setSpecOpen(true)
                }}
              >
                复制需求
              </Button>
            )}
            {row.status === 'needs_tree_patch' && (
              <Button size="small" onClick={() => applyStatus(row, 'tree_patched')}>
                已补决策树
              </Button>
            )}
          </Space>
        ),
    },
  ]

  return (
    <div>
      <Alert
        type="info"
        showIcon
        title={`改标学习 · 待复核 ${pendingCount} 条`}
        description={
          <ul className="mb-0 list-disc pl-5 text-sm">
            <li>反馈库手动改标会沉淀「系统标签 → 人工标签」。同类纠错达到 3 单或跨 2 个月后出现在此。</li>
            <li>采纳后写入对象与标签关键词；请求场景/问题类型还会生成纠错 overlay，发布后影响后续打标。</li>
            <li>不会自动改决策树源码。反复纠错可「建议补决策树」并一键复制给开发的需求。</li>
          </ul>
        }
      />
      <Card className="mt-4">
        <Space wrap className="mb-4">
          <Select
            value={statusFilter}
            onChange={setStatusFilter}
            style={{ width: 160 }}
            options={[
              { value: 'pending', label: '待复核' },
              { value: 'approved', label: '已采纳' },
              { value: 'needs_tree_patch', label: '建议补决策树' },
              { value: 'tree_patched', label: '已补决策树' },
              { value: 'rejected', label: '已拒绝' },
              { value: 'all', label: '全部' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
            刷新
          </Button>
          {!readOnly && (
            <Button
              onClick={async () => {
                setLoading(true)
                try {
                  let records = feedbacks
                  try {
                    const all = await listAllFeedbacks(adapter)
                    if (all?.length) records = all
                  } catch {
                    /* 用当前周期 */
                  }
                  const count = await replayCorrectionsNow(adapter, records)
                  message.success(count ? `已补采 ${count} 条历史改标` : '没有新的历史改标')
                  await refresh()
                } finally {
                  setLoading(false)
                }
              }}
            >
              从反馈库补采历史改标
            </Button>
          )}
        </Space>
        <Table
          rowKey="id"
          size="small"
          loading={loading}
          dataSource={rows}
          columns={columns}
          pagination={{ pageSize: 20 }}
          expandable={{
            expandedRowRender: (row) => (
              <div className="text-xs text-neutral-500">
                {(row.samples || []).map((s) => (
                  <div key={s.recordId} className="mb-1">
                    <Typography.Text code>{s.recordId}</Typography.Text>
                    {' '}
                    {String(s.taggingText || '').slice(0, 200)}
                  </div>
                ))}
              </div>
            ),
          }}
        />
      </Card>
      <Modal
        title="开发需求（可编辑后复制）"
        open={specOpen}
        onCancel={() => setSpecOpen(false)}
        width={720}
        footer={[
          <Button key="close" onClick={() => setSpecOpen(false)}>
            关闭
          </Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={async () => {
              const ok = await copyTextToClipboard(specText)
              if (ok) message.success('已复制开发需求')
              else message.error('复制失败，请手动选择文本')
            }}
          >
            复制
          </Button>,
        ]}
      >
        {specRule ? (
          <Typography.Paragraph type="secondary" className="text-xs">
            {TAG_CORRECTION_DIMENSION_LABELS[specRule.dimension]}：{specRule.fromLabel} → {specRule.toLabel}
          </Typography.Paragraph>
        ) : null}
        <Input.TextArea value={specText} onChange={(e) => setSpecText(e.target.value)} rows={18} />
      </Modal>
    </div>
  )
}
