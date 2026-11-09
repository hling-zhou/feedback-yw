import { Link } from 'react-router-dom'
import { useState } from 'react'
import { Button, Empty, Modal, Table, Tag, Tooltip, Typography } from 'antd'
import { ExpandOutlined } from '@ant-design/icons'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { buildImportUrl } from '../lib/importRoute.js'
import { formatFollowUpSatisfactionDisplay } from '../domain/followUpSatisfaction.js'
import { recordSourceType } from '../snapshots/recordScope.js'
import {
  getDisplayCustomerRequest,
  getDisplayPainPoint,
} from '../lib/ticketAnalysis/ticketAnalysisSources.js'
import KeyCustomerStar from './common/KeyCustomerStar.jsx'
import { getEstablishedActionDisplay } from '../domain/establishedAction.js'
import { hasOpenTicketTodos } from '../domain/ticketTodo.js'
import { getProblemCauseDisplay } from '../domain/rootCauseReview.js'
import { getPostUseChannelLabel } from '../lib/postUseRating/libraryFilters.js'
import { isComplaintTicket } from '../domain/complaintCause.js'
import { normalizeCustomProblemCategory } from '../domain/customProblemCategory.js'
import { getSourceColumnValue } from '../lib/sourceColumns.js'

/**
 * @param {string | undefined} channel
 * @param {string | undefined} sourceSubType
 */
function channelLabel(channel, sourceSubType) {
  return getPostUseChannelLabel({ channel, sourceSubType })
}

/**
 * @param {import('../lib/types.js').FeedbackRecord[]} items
 */
/**
 * 2026-11-09 拍板：原始数据 tab 去详情抽屉后，原文全文改列内「放大查看」（纯只读）。
 * @param {string[] | undefined} keyCustomers 重点客户名单（settings.postUseKeyCustomers）
 * @param {(record: import('../lib/types.js').FeedbackRecord) => void} onViewRaw
 */
function buildPostUseColumns(keyCustomers, onViewRaw) {
  return [
    {
      title: '渠道',
      dataIndex: 'channel',
      width: 88,
      fixed: 'left',
      render: (_, fb) => <Tag color="blue">{channelLabel(fb.channel, fb.sourceSubType)}</Tag>,
    },
    {
      title: '评分',
      dataIndex: 'ratingScore',
      width: 72,
      render: (v) =>
        v != null && Number.isFinite(Number(v)) ? (
          <Typography.Text strong>{Number(v)}</Typography.Text>
        ) : (
          '—'
        ),
    },
    {
      title: '产品',
      dataIndex: 'product',
      width: 140,
      render: (_, fb) => (
        <div>
          <Typography.Text>{fb.productName || fb.product || '—'}</Typography.Text>
          {fb.productSpec && fb.productSpec !== (fb.productName || fb.product) ? (
            <Typography.Text type="secondary" className="block text-xs">
              {fb.productSpec}
            </Typography.Text>
          ) : null}
        </div>
      ),
    },
    {
      title: '数据月份',
      dataIndex: 'importMonth',
      width: 100,
      render: (v) => v || '未知月份',
    },
    {
      title: '导入批次',
      dataIndex: 'importBatchName',
      width: 160,
      ellipsis: true,
      render: (_, fb) => fb.importBatchName || fb.importBatchId || '—',
    },
    {
      title: '客户',
      dataIndex: 'customerName',
      width: 140,
      ellipsis: true,
      render: (_, fb) => <span>{fb.customerName || fb.customerCode || '—'}<KeyCustomerStar customerName={fb.customerName} keyCustomers={keyCustomers} /></span>,
    },
    {
      title: '原文 / 意见',
      dataIndex: 'rawText',
      width: 280,
      render: (_, fb) => {
        const raw = fb.rawText || fb.commentText || fb.lowScoreReason || ''
        return (
          <div>
            <Typography.Paragraph className="!mb-0 line-clamp-2 text-xs">
              {raw || '—'}
            </Typography.Paragraph>
            {raw ? (
              <Button
                type="link"
                size="small"
                className="!h-auto !px-0 !py-0 !text-xs"
                icon={<ExpandOutlined />}
                onClick={(e) => {
                  // 防御：行点击（onSelect 存在时）不因放大按钮触发
                  e.stopPropagation()
                  onViewRaw(fb)
                }}
              >
                放大查看
              </Button>
            ) : null}
          </div>
        )
      },
    },
    {
      title: '客服部回访',
      dataIndex: 'customerVisit',
      width: 180,
      render: (_, fb) => {
        const visit = fb.customerVisit
        const text =
          visit?.internalConclusion || visit?.feedbackSummary || ''
        return text ? (
          <Typography.Paragraph className="!mb-0 line-clamp-2 text-xs">{text}</Typography.Paragraph>
        ) : (
          '—'
        )
      },
    },
    {
      title: '用户旅程',
      dataIndex: 'journeyL1',
      width: 140,
      render: (_, fb) => (
        <div>
          <Typography.Text
            type={!fb.journeyL1 || fb.journeyL1 === '未识别环节' ? 'warning' : undefined}
          >
            {fb.journeyL1 || '待打标'}
          </Typography.Text>
          <Typography.Text type="secondary" className="block text-xs">
            {fb.journeyL2 || '-'}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '数据来源',
      dataIndex: 'dataSourceType',
      width: 100,
      render: () => <Tag>{DATA_SOURCE_LABELS.post_use_rating || '用后即评'}</Tag>,
    },
  ]
}

function buildTicketColumns(reviewEnabled, doneRecordIds) {
  return [
    {
      title: '工单',
      dataIndex: 'ticketId',
      width: 180,
      fixed: 'left',
      render: (_, fb) => {
        return (
          <div>
            <Typography.Text strong className="transition-colors group-hover:text-brand-600">{fb.ticketId || '-'}</Typography.Text>
            {fb.product && (
              <Typography.Text type="secondary" className="block text-xs">
                {fb.product}
                {fb.productSpec && fb.productSpec !== fb.product && (
                  <span className="block text-ink-400">{fb.productSpec}</span>
                )}
              </Typography.Text>
            )}
          </div>
        )
      },
    },
    {
      title: '数据来源',
      dataIndex: 'dataSourceType',
      width: 100,
      render: (_, fb) => (
        <Tag>{DATA_SOURCE_LABELS[recordSourceType(fb)] || recordSourceType(fb)}</Tag>
      ),
    },
    ...(reviewEnabled
      ? [
          {
            title: '我的状态',
            dataIndex: 'myReview',
            width: 88,
            render: (_, fb) =>
              doneRecordIds.has(fb.id) ? (
                <Tag color="success">已处理</Tag>
              ) : (
                <Tag>未处理</Tag>
              ),
          },
        ]
      : []),
    {
      title: '客户名称',
      dataIndex: 'groupName',
      width: 140,
      ellipsis: true,
      render: (_, fb) => {
        const val = getSourceColumnValue(fb, '集团名称') || '-'
        return (
          <Tooltip title={val !== '-' ? val : undefined} getPopupContainer={() => document.body}>
            <Typography.Text ellipsis>{val}</Typography.Text>
          </Tooltip>
        )
      },
    },
    {
      title: '登录账号名称',
      dataIndex: 'loginAccountName',
      width: 140,
      ellipsis: true,
      render: (_, fb) => {
        const val = getSourceColumnValue(fb, '登录账号名称') || '-'
        return (
          <Tooltip title={val !== '-' ? val : undefined} getPopupContainer={() => document.body}>
            <Typography.Text ellipsis>{val}</Typography.Text>
          </Tooltip>
        )
      },
    },
    {
      title: '回访满意度',
      dataIndex: 'followUpSatisfaction',
      width: 108,
      render: (_, fb) => {
        const text = formatFollowUpSatisfactionDisplay(fb.followUpSatisfaction)
        return text || '—'
      },
    },
    {
      title: '客户请求',
      dataIndex: 'customerRequest',
      width: 140,
      render: (_, fb) => (
        <Typography.Paragraph className="!mb-0 line-clamp-2 text-xs">
          {getDisplayCustomerRequest(fb) || '—'}
        </Typography.Paragraph>
      ),
    },
    {
      title: '请求场景',
      dataIndex: 'requestScene',
      width: 120,
      render: (_, fb) => <Tag color="blue">{fb.requestScene || '未分类'}</Tag>,
    },
    {
      title: '问题类型',
      dataIndex: 'problemType',
      width: 150,
      render: (_, fb) => (
        <div className="flex flex-col items-start gap-1">
          <Tag>{fb.problemType || '-'}</Tag>
          {hasOpenTicketTodos(fb) ? <Tag color="orange">有待办</Tag> : null}
        </div>
      ),
    },
    {
      title: '问题分类（自定义）',
      dataIndex: 'customProblemCategory',
      width: 160,
      ellipsis: true,
      render: (_, fb) => {
        if (!isComplaintTicket(fb)) return '—'
        return normalizeCustomProblemCategory(fb.customProblemCategory) || '—'
      },
    },
    {
      title: '用户旅程',
      dataIndex: 'journeyL1',
      width: 160,
      render: (_, fb) => (
        <div>
          <Typography.Text type={!fb.journeyL1 || fb.journeyL1 === '未识别环节' ? 'warning' : undefined}>
            {fb.journeyL1 || '待打标'}
          </Typography.Text>
          <Typography.Text type="secondary" className="block text-xs">
            {fb.journeyL2 || '-'}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '需求痛点',
      dataIndex: 'painPoint',
      width: 160,
      render: (_, fb) => (
        <Typography.Paragraph className="!mb-0 line-clamp-2 text-xs">
          {getDisplayPainPoint(fb) || '—'}
        </Typography.Paragraph>
      ),
    },
    {
      title: '问题原因',
      dataIndex: 'rootCauseReview',
      width: 170,
      render: (_, fb) => {
        const { value, tag } = getProblemCauseDisplay(fb)
        if (!value) return '—'
        return (
          <div className="flex flex-col items-start gap-1">
            <Typography.Paragraph className="!mb-0 line-clamp-2 text-xs">
              {value}
            </Typography.Paragraph>
            {tag ? <Tag color={tag === '人工' ? 'purple' : 'blue'}>{tag}</Tag> : null}
          </div>
        )
      },
    },
    {
      title: '确立举措',
      dataIndex: 'establishedAction',
      width: 160,
      render: (_, fb) => (
        <Typography.Paragraph className="!mb-0 line-clamp-2 text-xs">
          {getEstablishedActionDisplay(fb) || '—'}
        </Typography.Paragraph>
      ),
    },
    {
      title: '资源池',
      dataIndex: 'resourcePool',
      width: 130,
      render: (value) => value || '-',
    },
  ]
}

/**
 * 按隐藏列集合过滤可见列。hiddenColumns 中的 dataIndex 对应列将被移除。
 * @param {Array<{dataIndex?: string}>} columns
 * @param {Set<string> | string[] | undefined} hiddenColumns
 * @returns {Array<{dataIndex?: string}>}
 */
export function filterVisibleColumns(columns, hiddenColumns) {
  if (!hiddenColumns) return columns
  const hidden = hiddenColumns instanceof Set ? hiddenColumns : new Set(hiddenColumns)
  if (hidden.size === 0) return columns
  return columns.filter((col) => !hidden.has(col.dataIndex))
}

export default function FeedbackTable({
  items,
  /** 行点击回调；不传（用后即评原始数据 tab，2026-11-09 去详情抽屉拍板）则行不可点击 */
  onSelect,
  reviewEnabled = false,
  doneRecordIds = /** @type {ReadonlySet<string>} */ (new Set()),
  /** 数据来源筛选；为 post_use_rating 时使用评价专用列 */
  dataSource = '',
  /** 用户选择不显示的列 dataIndex；空集合表示可切换列全部显示 */
  hiddenColumns,
  /** 表头吸顶偏移量（来自外层 sticky chrome 高度）；不传则不吸顶 */
  stickyOffset = 0,
  /** 用后即评重点客户名单（settings.postUseKeyCustomers） */
  keyCustomers,
}) {
  /** 2026-11-09：原文放大查看（纯只读，替代原始数据 tab 的详情抽屉原文区）。
   *  类型按仓库惯例放宽 any：评价记录运行时字段（customerName/importMonth/ratingScore 等）
   *  均由导入链保证有值，但 FeedbackRecord 类型定义未声明（既有欠账，不在此扩大检查面）。 */
  const [viewingRaw, setViewingRaw] = useState(/** @type {any} */ (null))

  if (items.length === 0) {
    return (
      <Empty
        className="rounded-xl border border-ink-200 bg-white py-12"
        description="暂无反馈数据"
      >
        <Link to={buildImportUrl({ source: dataSource })}>
          <Button type="primary">导入数据</Button>
        </Link>
      </Empty>
    )
  }

  const postUseView =
    dataSource === 'post_use_rating' ||
    (items.length > 0 && items.every((fb) => recordSourceType(fb) === 'post_use_rating'))

  const allColumns = postUseView
    ? buildPostUseColumns(keyCustomers, (fb) => setViewingRaw(fb))
    : buildTicketColumns(reviewEnabled, doneRecordIds)
  const columns = filterVisibleColumns(allColumns, hiddenColumns)
  const scrollX = columns.reduce((sum, col) => sum + (col.width || 140), 0)
  const stickyProps = stickyOffset > 0 ? { sticky: { offsetHeader: stickyOffset } } : {}

  return (
    <>
    <Table
      rowKey="id"
      columns={columns}
      dataSource={items}
      scroll={{ x: scrollX }}
      {...stickyProps}
      pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
      onRow={onSelect
        ? (record) => ({
            onClick: () => onSelect(record),
            className: 'group cursor-pointer',
          })
        : undefined}
    />
    {/* 原文放大查看（纯只读）：抽屉下线后的全文兜底入口 */}
    {viewingRaw ? (
      <Modal
        open
        title={`评价原文 · ${viewingRaw.customerName || viewingRaw.customerCode || '—'} · ${viewingRaw.importMonth || '未知月份'}`}
        width={720}
        footer={null}
        onCancel={() => setViewingRaw(null)}
      >
        <Typography.Text type="secondary" className="mb-2 block text-xs">
          {channelLabel(viewingRaw.channel, viewingRaw.sourceSubType)}
          {viewingRaw.ratingScore != null && Number.isFinite(Number(viewingRaw.ratingScore))
            ? ` · ${Number(viewingRaw.ratingScore)} 分`
            : ''}
          {' · '}
          {viewingRaw.product || viewingRaw.productName || '—'}
        </Typography.Text>
        <Typography.Paragraph className="!mb-0 whitespace-pre-wrap text-[13px] leading-[1.7]">
          {viewingRaw.rawText || viewingRaw.commentText || viewingRaw.lowScoreReason || '—'}
        </Typography.Paragraph>
      </Modal>
    ) : null}
    </>
  )
}
