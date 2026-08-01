import { Link } from 'react-router-dom'
import { Button, Empty, Table, Tag, Typography } from 'antd'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { formatFollowUpSatisfactionDisplay } from '../domain/followUpSatisfaction.js'
import { recordSourceType } from '../snapshots/recordScope.js'
import SentimentBadge from './SentimentBadge.jsx'
import {
  formatListOptimizationPreview,
  getDisplayCustomerRequest,
  getDisplayPainPoint,
} from '../lib/ticketAnalysis/ticketAnalysisSources.js'
import { getEstablishedActionDisplay } from '../domain/establishedAction.js'
import { hasOpenTicketTodos } from '../domain/ticketTodo.js'
import { extractTicketActualDate } from '../domain/ticketActualDate.js'

const CHANNEL_LABELS = {
  sms: '短信',
  console: '控制台',
  option: '选项类',
  callback: '投诉回访',
}

/**
 * @param {string | undefined} channel
 * @param {string | undefined} sourceSubType
 */
function channelLabel(channel, sourceSubType) {
  if (channel && CHANNEL_LABELS[channel]) return CHANNEL_LABELS[channel]
  if (sourceSubType === 'sms_survey') return '短信'
  if (sourceSubType === 'web_survey') return '控制台'
  if (sourceSubType === 'web_option') return '选项类'
  return channel || sourceSubType || '—'
}

/**
 * @param {import('../lib/types.js').FeedbackRecord[]} items
 */
function buildPostUseColumns() {
  return [
    {
      title: '产品',
      dataIndex: 'product',
      width: 140,
      fixed: 'left',
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
      title: '客户',
      dataIndex: 'customerName',
      width: 140,
      fixed: 'left',
      ellipsis: true,
      render: (_, fb) => fb.customerName || fb.customerCode || '—',
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
      title: '渠道',
      dataIndex: 'channel',
      width: 88,
      render: (_, fb) => <Tag color="blue">{channelLabel(fb.channel, fb.sourceSubType)}</Tag>,
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
      title: '原文 / 意见',
      dataIndex: 'rawText',
      width: 280,
      render: (_, fb) => (
        <Typography.Paragraph className="!mb-0 line-clamp-2 text-xs">
          {fb.rawText || fb.commentText || fb.lowScoreReason || '—'}
        </Typography.Paragraph>
      ),
    },
    {
      title: '客服回访',
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
        const ticketActualDate = extractTicketActualDate(fb.ticketId)
        return (
          <div>
            <Typography.Text strong>{fb.ticketId || '-'}</Typography.Text>
            {ticketActualDate ? (
              <Typography.Text type="secondary" className="block text-xs">
                工单日期：{ticketActualDate}
              </Typography.Text>
            ) : null}
            <Typography.Text type="secondary" className="block text-xs">
              {fb.createdAt || '-'}
            </Typography.Text>
            {fb.product && (
              <Typography.Text type="secondary" className="block text-xs">
                {fb.product}
                {fb.productSpec && fb.productSpec !== fb.product && (
                  <span className="block text-ink-400">{fb.productSpec}</span>
                )}
              </Typography.Text>
            )}
            <Typography.Text type="secondary" className="block text-xs">
              数据月份：{fb.importMonth || '未知月份'}
            </Typography.Text>
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
      title: '用户情绪',
      dataIndex: 'sentiment',
      width: 96,
      render: (_, fb) => <SentimentBadge record={fb} />,
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
      title: '优化建议（自动）',
      dataIndex: 'optimizationProduct',
      width: 180,
      render: (_, fb) => (
        <Typography.Paragraph className="!mb-0 line-clamp-2 text-xs" type="secondary">
          {formatListOptimizationPreview(fb) || '—'}
        </Typography.Paragraph>
      ),
    },
    {
      title: '资源池',
      dataIndex: 'resourcePool',
      width: 130,
      render: (value) => (
        <Typography.Text type="secondary" className="text-xs">
          {value || '-'}
        </Typography.Text>
      ),
    },
  ]
}

export default function FeedbackTable({
  items,
  onSelect,
  reviewEnabled = false,
  doneRecordIds = /** @type {ReadonlySet<string>} */ (new Set()),
  /** 数据来源筛选；为 post_use_rating 时使用评价专用列 */
  dataSource = '',
}) {
  if (items.length === 0) {
    return (
      <Empty
        className="rounded-xl border border-ink-200 bg-white py-12"
        description="暂无反馈数据"
      >
        <Link to="/import">
          <Button type="primary">导入数据</Button>
        </Link>
      </Empty>
    )
  }

  const postUseView =
    dataSource === 'post_use_rating' ||
    (items.length > 0 && items.every((fb) => recordSourceType(fb) === 'post_use_rating'))

  const columns = postUseView
    ? buildPostUseColumns()
    : buildTicketColumns(reviewEnabled, doneRecordIds)

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={items}
      scroll={{ x: postUseView ? 1300 : reviewEnabled ? 1648 : 1560 }}
      pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
      onRow={(record) => ({
        onClick: () => onSelect(record),
        className: 'cursor-pointer',
      })}
    />
  )
}
