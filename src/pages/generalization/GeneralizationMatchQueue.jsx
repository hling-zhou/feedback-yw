import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Modal, Radio, Select, Space, Table, Tag, Typography, message } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import {
  listGeneralizationPendingMatches,
  reviewGeneralizationMatch,
  getGeneralizationPendingCount,
} from '../../lib/generalizationClient.js'
import {
  GENERALIZATION_MATCH_CONFIDENCE_LABELS,
  GENERALIZATION_CATEGORIES,
  GENERALIZATION_CATEGORY_LABELS,
  GENERALIZATION_SCOPES,
  GENERALIZATION_SCOPE_LABELS,
} from '../../domain/generalizationIssue.js'
import { useAuth } from '../../context/AuthContext.jsx'
import FieldLabel from '../../components/FieldLabel.jsx'
import { paginationShowTotal } from '../../lib/paginationTotal.js'

/** @typedef {import('../../lib/generalizationClient.js').GeneralizationPendingSuggestion} GeneralizationPendingSuggestion */

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
 * 举一反三待复核队列（下段）：pending_suggest 反向集中视图，时间倒序批量清账。
 * 与抽屉建议卡同数据双视图——处理完两侧按 API 实时拉取自然同步。
 *
 * @param {Object} props
 * @param {() => void} [props.onCountChange] - 处理后通知宿主刷新横幅计数
 * @param {(recordId: string, dataSourceType: string) => void} [props.onOpenRecord]
 */
export default function GeneralizationMatchQueue({ onCountChange, onOpenRecord }) {
  const { can } = useAuth()
  const canEdit = can('editRecord')
  const [messageApi, contextHolder] = message.useMessage()

  const [suggestions, setSuggestions] = useState(
    /** @type {GeneralizationPendingSuggestion[]} */ ([]),
  )
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [confidenceFilter, setConfidenceFilter] = useState('')
  const [reviewing, setReviewing] = useState(null)
  const [acting, setActing] = useState(false)
  const [count, setCount] = useState({ total: 0, high: 0, medium: 0, low: 0 })

  // new_issue 分支的补全表单（category/scope 创建即必填——gen 定义性属性；categoryOther 11-04）
  const [newIssueDraft, setNewIssueDraft] = useState({
    title: '', summary: '', category: '', scope: '', categoryOther: '',
  })

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const result = await listGeneralizationPendingMatches({
        page,
        pageSize: 20,
        confidence: /** @type {any} */ (confidenceFilter || undefined),
      })
      setSuggestions(result.suggestions)
      setTotal(result.total)
      const c = await getGeneralizationPendingCount()
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
      await reviewGeneralizationMatch(suggestion.id, action, extra)
      messageApi.success(
        action === 'confirm'
          ? '已确认为同一举一反三问题'
          : action === 'dismiss'
            ? '已否决建议'
            : '已新建举一反三问题',
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

  /** new_issue 载荷：摘录预填 + category/scope 必填（弹窗内表单） */
  const newIssuePayload = (s) => {
    const excerpt = String(s.matchedExcerpt || '').trim()
    const record = s.record
    const base = excerpt || record?.painPoint || record?.customerRequest || '新建举一反三问题'
    const trimmedOther = String(newIssueDraft.categoryOther || '').trim()
    return {
      newIssue: {
        title: newIssueDraft.title.trim() || base.slice(0, 100),
        summary: newIssueDraft.summary.trim() || base.slice(0, 100),
        productKey: record?.productKey || '',
        productName: record?.product || s.productName || '',
        category: /** @type {any} */ (newIssueDraft.category),
        scope: /** @type {any} */ (newIssueDraft.scope),
        ...(newIssueDraft.category === 'other_intervenable' && trimmedOther
          ? { categoryOther: trimmedOther.slice(0, 100) }
          : {}),
      },
    }
  }

  const openReview = (s) => {
    const excerpt = String(s.matchedExcerpt || '').trim()
    const base = excerpt || s.record?.painPoint || s.record?.customerRequest || ''
    setNewIssueDraft({ title: base.slice(0, 100), summary: base.slice(0, 100), category: '', scope: '', categoryOther: '' })
    setReviewing(s)
  }

  const handleNewIssue = (s) => {
    if (!newIssueDraft.category) {
      messageApi.warning('新建需选择可介入原因范畴')
      return
    }
    if (newIssueDraft.category === 'other_intervenable' && !String(newIssueDraft.categoryOther || '').trim()) {
      messageApi.warning('选择「其他」时请填写具体原因')
      return
    }
    if (!newIssueDraft.scope) {
      messageApi.warning('新建需选择共性范围')
      return
    }
    void handleReview(s, 'new_issue', newIssuePayload(s))
  }

  const columns = /** @type {import('antd').TableColumnsType<GeneralizationPendingSuggestion>} */ ([
    {
      title: '举一反三问题',
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
        const label =
          s.ticketId ||
          s.record?.ticketId ||
          (s.record?.painPoint || s.matchedExcerpt || '').slice(0, 40) ||
          '—'
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
        v ? (
          <Tag color={CONFIDENCE_TAG_COLOR[v]}>
            {GENERALIZATION_MATCH_CONFIDENCE_LABELS[v] || v}
          </Tag>
        ) : (
          '—'
        ),
    },
    {
      title: '理由',
      dataIndex: 'matchReason',
      ellipsis: true,
      render: (v) => (
        <Typography.Text type="secondary" className="text-xs">
          {v || '—'}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 90,
      fixed: 'right',
      render: (_, s) =>
        canEdit ? (
          <Button size="small" type="link" onClick={() => openReview(s)}>
            处理
          </Button>
        ) : null,
    },
  ])

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
          onSearch={(v) => {
            setPage(1)
            setConfidenceFilter(v)
          }}
        />
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
        locale={{
          emptyText:
            '暂无待复核建议。导入投诉/咨询工单后，系统会自动将疑似命中已有举一反三问题的新工单列在此处（也可在留观页触发重新扫描）。',
        }}
      />

      <Modal
        open={Boolean(s)}
        title="复核建议"
        onCancel={() => setReviewing(null)}
        footer={null}
        width={600}
        destroyOnClose
      >
        {s ? (
          <div className="space-y-3">
            <div className="rounded-md border border-ink-100 p-2">
              <Typography.Text type="secondary" className="mb-1 block text-xs">
                举一反三问题（{s.productName}）
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
                {s.record?.painPoint || s.record?.customerRequest || s.matchedExcerpt || '—'}
              </Typography.Paragraph>
              {s.matchedExcerpt && s.record?.painPoint ? (
                <Typography.Text type="secondary" className="mt-1 block text-xs">
                  命中摘录：{s.matchedExcerpt}
                </Typography.Text>
              ) : null}
            </div>
            {/* new_issue 补全表单（category/scope 必填——点击"新建问题"时校验） */}
            <div className="rounded-md border border-dashed border-ink-200 p-2">
              <Typography.Text type="secondary" className="mb-2 block text-xs">
                新建问题时需补全：
              </Typography.Text>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <FieldLabel required>可介入原因范畴</FieldLabel>
                  <Select
                    className="!w-full"
                    placeholder="六选一"
                    value={newIssueDraft.category || undefined}
                    options={GENERALIZATION_CATEGORIES.map((c) => ({
                      value: c,
                      label: GENERALIZATION_CATEGORY_LABELS[c],
                    }))}
                    onChange={(v) => {
                      setNewIssueDraft((f) => ({ ...f, category: v || '', categoryOther: v === 'other_intervenable' ? f.categoryOther : '' }))
                    }}
                  />
                </div>
                <div>
                  <FieldLabel required>共性范围</FieldLabel>
                  <Radio.Group
                    value={newIssueDraft.scope || undefined}
                    onChange={(e) => setNewIssueDraft((f) => ({ ...f, scope: e.target.value }))}
                    options={GENERALIZATION_SCOPES.map((sc) => ({
                      value: sc,
                      label: GENERALIZATION_SCOPE_LABELS[sc],
                    }))}
                  />
                </div>
              </div>
              {newIssueDraft.category === 'other_intervenable' ? (
                <div className="mt-2">
                  <FieldLabel required>具体原因</FieldLabel>
                  <Input
                    value={newIssueDraft.categoryOther || ''}
                    onChange={(e) => setNewIssueDraft((f) => ({ ...f, categoryOther: e.target.value }))}
                    placeholder="如：服务端资源配置默认值不合理"
                    maxLength={100}
                    showCount
                  />
                </div>
              ) : null}
            </div>
            <Space className="w-full justify-end">
              <Button onClick={() => setReviewing(null)}>取消</Button>
              <Button danger loading={acting} onClick={() => void handleReview(s, 'dismiss')}>
                不纳入
              </Button>
              <Button loading={acting} onClick={() => handleNewIssue(s)}>
                新建问题
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
