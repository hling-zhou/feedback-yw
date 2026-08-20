import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Card, Table } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { useInsights } from '../../context/InsightsContext.jsx'
import {
  loadVisitRecords,
} from '../../lib/postUseRating/visitRecords.js'
import { postUseVisitMonthsForPeriod } from '../../lib/postUseRating/periodScope.js'
import { buildImportUrl } from '../../lib/importRoute.js'

/**
 * @param {{ period?: import('../../domain/insightPeriod.js').InsightPeriod | null }} props
 */
export default function PostUseVisitPanel({ period }) {
  const { adapter } = useInsights()
  const [records, setRecords] = useState([])

  const visitMonths = useMemo(() => postUseVisitMonthsForPeriod(period), [period])
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (!adapter) return
      const list = await loadVisitRecords(adapter)
      if (!cancelled) setRecords(list)
    })()
    return () => {
      cancelled = true
    }
  }, [adapter])

  const visible = useMemo(() => {
    const monthSet = new Set(visitMonths)
    return records.filter((r) => monthSet.has(r.importMonth || r.visitMonth))
  }, [records, visitMonths])

  const monthLabel =
    visitMonths.length > 1
      ? `${visitMonths[0]} 至 ${visitMonths.at(-1)}`
      : visitMonths[0] || '—'

  return (
    <Card
      size="small"
      title={`客服部回访（${monthLabel}）`}
      extra={
        <Link to={buildImportUrl({ source: 'post_use_rating', subType: 'customer_visit' })}>
          <Button type="primary" size="small" icon={<UploadOutlined />}>
            前往数据导入
          </Button>
        </Link>
      }
    >
      <Table
        size="small"
        rowKey="id"
        pagination={{ pageSize: 5 }}
        dataSource={visible}
        columns={[
          { title: '数据月份', width: 96, render: (_, row) => row.importMonth || row.visitMonth || '—' },
          { title: '实际回访月', dataIndex: 'visitMonth', width: 100 },
          { title: '产品', dataIndex: 'productName', width: 120 },
          { title: '客户名称', dataIndex: 'customerName', width: 160, ellipsis: true, render: (value, row) => value || row.userInfoDetail || row.userInfo || '—' },
          { title: '客户编码', dataIndex: 'customerCode', width: 160, ellipsis: true, render: (value) => value || '—' },
          { title: '回访反馈信息', dataIndex: 'visitFeedbackDetail', ellipsis: true, render: (value, row) => value || row.visitResult || row.feedbackSummary || '—' },
          { title: '内部评估', dataIndex: 'internalEvaluationDetail', width: 180, ellipsis: true, render: (value, row) => value || row.internalConclusion || '—' },
        ]}
        locale={{ emptyText: '暂无回访记录，请通过数据导入关联用后即评明细' }}
      />
    </Card>
  )
}
