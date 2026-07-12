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

export default function FeedbackTable({
  items,
  onSelect,
  reviewEnabled = false,
  doneRecordIds = /** @type {ReadonlySet<string>} */ (new Set()),
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

  const columns = [
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
      render: (_, fb) => (
        <Tag color="blue">{fb.requestScene || '未分类'}</Tag>
      ),
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

  return (
    <Table
      rowKey="id"
      columns={columns}
      dataSource={items}
      scroll={{ x: reviewEnabled ? 1648 : 1560 }}
      pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
      onRow={(record) => ({
        onClick: () => onSelect(record),
        className: 'cursor-pointer',
      })}
    />
  )
}

