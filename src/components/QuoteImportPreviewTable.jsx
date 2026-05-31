import { Table, Typography } from 'antd'

/**
 * @param {Object} props
 * @param {Array<{ id: string; ticketId?: string; sourceHint?: string; taggingText?: string }>} props.rows
 * @param {string} [props.emptyText]
 */
export default function QuoteImportPreviewTable({
  rows,
  emptyText = '调整列映射后将显示打标语料样例',
}) {
  return (
    <div className="mt-4 rounded-lg border border-ink-100 bg-ink-50/40 p-3">
      <Typography.Text strong className="text-xs">
        打标语料预览（{rows.length} 条样例）
      </Typography.Text>
      <Typography.Text type="secondary" className="mt-1 block text-xs">
        导入后将用大模型生成客户请求精炼摘要与需求痛点，并用于用户情绪分析。
      </Typography.Text>
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
            title: '原始字段摘要',
            dataIndex: 'sourceHint',
            width: 180,
            render: (v) => (
              <Typography.Paragraph className="!mb-0 line-clamp-2 !text-xs text-ink-500">
                {v || '—'}
              </Typography.Paragraph>
            ),
          },
          {
            title: '打标语料（预览）',
            dataIndex: 'taggingText',
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
