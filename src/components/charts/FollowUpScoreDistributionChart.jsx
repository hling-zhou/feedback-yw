import { useMemo } from 'react'
import { Table, Typography } from 'antd'

/**
 * 非 10 分 · 得分分布（1–9 分，≤5 分标红），按产品列表展示。
 *
 * @param {Object} props
 * @param {import('../../lib/followUpSatisfactionAnalytics.js').FollowUpScoreDistributionRow[]} props.rows
 */
export default function FollowUpScoreDistributionChart({ rows }) {
  const columns = useMemo(() => {
    /** @type {import('antd/es/table').ColumnsType<import('../../lib/followUpSatisfactionAnalytics.js').FollowUpScoreDistributionRow>} */
    const scoreColumns = Array.from({ length: 9 }, (_, index) => {
      const score = String(index + 1)
      const low = index + 1 <= 5
      return {
        title: low ? (
          <span className="text-red-500">{score}分</span>
        ) : (
          `${score}分`
        ),
        key: `score-${score}`,
        width: 52,
        align: 'center',
        render: (_value, row) => {
          const count = row.scores[score] || 0
          if (!count) return '—'
          return low ? (
            <Typography.Text type="danger">{count}</Typography.Text>
          ) : (
            count
          )
        },
      }
    })

    return [
      {
        title: '产品',
        dataIndex: 'productName',
        ellipsis: true,
        fixed: 'left',
        width: 120,
      },
      {
        title: '非 10 分',
        dataIndex: 'nonTenTotal',
        width: 72,
        align: 'center',
      },
      {
        title: '≤5 分',
        dataIndex: 'lowScoreCount',
        width: 64,
        align: 'center',
        render: (value) =>
          value > 0 ? <Typography.Text type="danger">{value}</Typography.Text> : value || '—',
      },
      ...scoreColumns,
    ]
  }, [])

  if (!rows?.length) {
    return (
      <div className="flex h-[120px] items-center justify-center text-sm text-ink-400">
        暂无非 10 分回访数据
      </div>
    )
  }

  return (
    <Table
      size="small"
      pagination={false}
      rowKey="productKey"
      dataSource={rows}
      columns={columns}
      scroll={{ x: 'max-content' }}
    />
  )
}
