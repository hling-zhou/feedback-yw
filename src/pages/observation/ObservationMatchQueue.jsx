import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Modal, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import {
  listObservationPendingMatches,
  reviewObservationMatch,
  getObservationPendingCount,
  triggerObservationScan,
} from '../../lib/observationClient.js'
import {
  OBSERVATION_MATCH_CONFIDENCE_LABELS,
} from '../../domain/observationIssue.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { paginationShowTotal } from '../lib/paginationTotal.js'

/** @typedef {import('../../lib/observationClient.js').ObservationPendingSuggestion} ObservationPendingSuggestion */

const CONFIDENCE_TAG_COLOR = {
  high: 'gold',
  medium: 'blue',
  low: 'default',
}

const DATA_SOURCE_LABELS = {
  complaint_ticket: '投诉工单',
  consultation_ticket: '咨询工单',
  post_use_rating: '用后即评',
}

/**
 * 待复核建议队列（下段）：pending_suggest 反向集中视图，时间倒序批量清账。
 * 与抽屉建议卡同数据双视图——处理完两侧按 API 实时拉取自然同步。
 *
 * @param {Object} props
 * @param {() => void} [props.onCountChange] - 处理后通知宿主刷新横幅计数
 * @param {(recordId: string, dataSourceType: string) => void} [props.onOpenRecord]
 */
export default function ObservationMatchQueue({ onCountChange, onOpenRecord }) {
  const { can } = useAuth()
  const canEdit = can('editRecord')
  const [messageApi, contextHolder] = message.useMessage()

  const [suggestions, setSuggestions] = useState(/** @type {ObservationPendingSuggestion[]} */ ([]))
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [confidenceFilter, setConfidenceFilter] = useState('')
  const [reviewing, setReviewing] = useState(null)
  const [acting, setActing] = useState(false)
  const [count, setCount] = useState({ total: 0, high: 0, medium: 0, low: 0 })
  const [scanning, setScanning] = useState(false)
  const canScan = can('import')

  const handleManualScan = async () => {
    setScanning(true)
    try {
      const res = await triggerObservationScan({})
      messageApi.success(res?.taskId ? '手动扫描已在后台启动，稍后自动刷新结果' : '当前有任务占用，稍后再试')
      if (res?.taskId) {
        setTimeout(() => { void reload() }, 5000)
      }
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '触发失败')
    } finally {
      setScanning(false)
    }
  }

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listObservationPendingMatches({
        page,
        pageSize: 20,
        confidence: confidenceFilter || undefined,
      })
      setSuggestions(result.suggestions)
      setTotal(result.total)
      const c = await getObservationPendingCount()
      setCount(c)
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '加载建议队列失败')
    } finally {
      setLoading(false)
    }
  }, [page, confidenceFilter, messageApi])

  useEffect(() => {
    void reload()
  }, [reload])

  const handleReview = async (suggestion, action, extra) => {
    setActing(true)
    try {
      await reviewObservationMatch(suggestion.id, action, extra)
      messageApi.success(
        action === 'confirm' ? '已确认为同一留观问题'
          : action === 'dismiss' ? '已否决建议'
            : '已新建留观问题',
      )
      setReviewing(null)
      await reload()
      onCountChange?.()
    } catch (err) {
      messageApi.error(err instanceof Error ? err.message : '操作失败')
    } finally {
      setActing(false)
    }
  }

  const newIssuePayload = (s) => {
    const excerpt = String(s.matchedExcerpt || '').trim()
    const record = s.record
    const base = excerpt || record?.painPoint || record?.customerRequest || '新建留观问题'
    return {
      newIssue: {
        title: base.slice(0, 100),
        summary: base.slice(0, 100),
        productKey: record?.productKey || '',
        productName: record?.product || s.productName || '',
      },
    }
  }

  const columns = [
    {
      title: '留观问题',
      dataIndex: 'issueTitle',
      width: 200,
      ellipsis: true,
      render: (v) => <Typography.Text strong>{v || '—'}</Typography.Text>,
    },
    {
      title: '来自记录',
      key: 'record',
      ellipsis: true,
      render: (_, s) => {
        const label = s.ticketId || s.record?.ticketId || (s.record?.painPoint || s.matchedExcerpt || '').slice(0, 40) || '—'
        return s.record && onOpenRecord ? (
          <Button
            type="link"
            size="small"
            className="!px-0"
            onClick={() => onOpenRecord(s.recordId, s.recordDataSource)}
          >
            {label}
          </Button>
        ) : (
          <Typography.Text className="text-xs">{label}</Typography.Text>
        )
      },
    },
    {
      title: '来源',
      dataIndex: 'recordDataSource',
      width: 90,
      render: (v) => DATA_SOURCE_LABELS[v] || v || '—',
    },
    {
      title: '置信度',
      dataIndex: 'matchConfidence',
      width: 80,
      render: (v) =>
        v ? <Tag color={CONFIDENCE_TAG_COLOR[v]}>{OBSERVATION_MATCH_CONFIDENCE_LABELS[v] || v}</Tag> : '—',
    },
    { title: '理由', dataIndex: 'matchReason', ellipsis: true,
      render: (v) => <Typography.Text type="secondary" className="text-xs">{v || '—'}</Typography.Text> },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      fixed: 'right',
      render: (_, s) =>
        canEdit ? (
          <Button size="small" type="link" onClick={() => setReviewing(s)}>
            处理
          </Button>
        ) : null,
    },
  ]

  const s = reviewing

  return (
    <div className="page-card-sm page-section-sm space-y-3">
      {contextHolder}
      <div className="flex flex-wrap items-center gap-2">
        <Typography.Text strong>待复核建议</Typography.Text>
        <Tag color={count.total ? 'orange' : 'default'}>{count.total} 待处理</Tag>
        {count.high ? <Tag color="gold">高 {count.high}</Tag> : null}
        {count.medium ? <Tag color="blue">中 {count.medium}</Tag> : null}
        <Input.Search
          allowClear
          placeholder="筛选置信度"
          className="!w-40"
          onSearch={(v) => { setPage(1); setConfidenceFilter(v) }}
        />
        {canScan ? (
          <Tooltip title="重新扫描全部反馈记录，识别疑似命中留观问题的新反馈；已确认或已否决的关联不会重复推荐。">
            <Button loading={scanning} onClick={() => void handleManualScan()}>
              手动扫描
            </Button>
          </Tooltip>
        ) : null}
        <Button icon={<ReloadOutlined />} onClick={() => void reload()}>
          刷新
        </Button>
      </div>

      <Table
        rowKey="id"
        size="small"
        loading={loading}
        columns={columns}
        dataSource={suggestions}
        pagination={{
          current: page,
          pageSize: 20,
          total,
          showSizeChanger: false,
          onChange: (p) => setPage(p),
          showTotal: paginationShowTotal,
        }}
        locale={{ emptyText: '暂无待复核建议。导入完成后系统会自动识别疑似命中的反馈；也可在上方触发手动扫描。' }}
      />

      <Modal
        open={Boolean(s)}
        title="复核建议"
        onCancel={() => setReviewing(null)}
        footer={null}
        width={560}
        destroyOnClose
      >
        {s ? (
          <div className="space-y-3">
            <div className="rounded-md border border-ink-100 p-2">
              <Typography.Text type="secondary" className="mb-1 block text-xs">
                留观问题（{s.productName}）
              </Typography.Text>
              <Typography.Text strong className="block">
                {s.issueTitle}
              </Typography.Text>
              <Typography.Text type="secondary" className="mt-1 block text-xs">
                {s.matchReason || '—'}
              </Typography.Text>
            </div>
            <div className="rounded-md border border-ink-100 p-2">
              <Typography.Text type="secondary" className="mb-1 block text-xs">
                新记录（{DATA_SOURCE_LABELS[s.recordDataSource] || s.recordDataSource}）
              </Typography.Text>
              <Typography.Paragraph className="!mb-0" ellipsis={{ rows: 4 }}>
                {s.record?.painPoint || s.record?.customerRequest || s.matchedExcerpt || s.record?.commentText || '—'}
              </Typography.Paragraph>
              {s.matchedExcerpt && s.record?.painPoint ? (
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  命中摘录：{s.matchedExcerpt}
                </Typography.Text>
              ) : null}
            </div>
            <Space className="w-full justify-end">
              <Button onClick={() => setReviewing(null)}>取消</Button>
              <Button danger loading={acting} onClick={() => void handleReview(s, 'dismiss')}>
                不纳入
              </Button>
              <Button loading={acting} onClick={() => void handleReview(s, 'new_issue', newIssuePayload(s))}>
                新建留观
              </Button>
              <Button type="primary" loading={acting} onClick={() => void handleReview(s, 'confirm')}>
                确认关联
              </Button>
            </Space>
          </div>
        ) : null}
      </Modal>
    </div>
  )
}
