import { Table, Typography } from 'antd'

/**
 * @param {Object} props
 * @param {Array<{ id: string; ticketId?: string; modeLabel?: string; sourceHint?: string; customerQuote?: string }>} props.rows
 * @param {string} [props.versionLabel]
 * @param {string} [props.emptyText]
 */
export default function QuoteImportPreviewTable({
  rows,
  versionLabel,
  emptyText = '调整列映射后将显示客户原话抽取样例',
}) {
  return (
    <div className="mt-4 rounded-lg border border-ink-100 bg-ink-50/40 p-3">
      <Typography.Text strong className="text-xs">
        客户原话抽取预览（{rows.length} 条样例）
      </Typography.Text>
      {versionLabel ? (
        <Typography.Text type="secondary" className="mt-1 block font-mono text-xs">
          规则版本：{versionLabel}
        </Typography.Text>
      ) : null}
      <Table
        className="mt-2"
        rowKey="id"
        size="small"
        pagination={false}
        dataSource={rows}
        locale={{ emptyText }}
        columns={[
          {
            title: '工单号 / 样例',
            dataIndex: 'ticketId',
            width: 110,
            render: (v) => v || '—',
          },
          {
            title: '抽取方式',
            dataIndex: 'modeLabel',
            width: 180,
            render: (v) => <Typography.Text className="text-xs">{v || '—'}</Typography.Text>,
          },
          {
            title: '原始字段摘要',
            dataIndex: 'sourceHint',
            width: 160,
            render: (v) => (
              <Typography.Paragraph className="!mb-0 line-clamp-2 !text-xs text-ink-500">
                {v || '—'}
              </Typography.Paragraph>
            ),
          },
          {
            title: '客户原话（抽取结果）',
            dataIndex: 'customerQuote',
            render: (v) => (
              <Typography.Paragraph className="!mb-0 line-clamp-3 !text-xs">
                {v || '—'}
              </Typography.Paragraph>
            ),
          },
        ]}
      />
    </div>
  )
}
