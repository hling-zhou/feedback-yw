import { Tag, Typography } from 'antd'
import { formatWanTouRatio, formatWanTouTargetStatus } from '../../lib/wanTouRatio.js'

/**
 * @param {{ hasTarget?: boolean; met?: boolean | null; excessComplaints?: number | null }} evaluation
 */
export function WanTouTargetStatusInline({ evaluation }) {
  if (!evaluation?.hasTarget) return null
  if (evaluation.met == null) {
    return (
      <Typography.Text type="secondary" className="text-xs">
        待对比
      </Typography.Text>
    )
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Tag color={evaluation.met ? 'success' : 'error'} className="mr-0">
        {formatWanTouTargetStatus(evaluation.met)}
      </Tag>
      {!evaluation.met && evaluation.excessComplaints ? (
        <Typography.Text type="danger" className="text-xs">
          超量 {evaluation.excessComplaints} 单
        </Typography.Text>
      ) : null}
    </span>
  )
}

/**
 * @param {Object} props
 * @param {number | null | undefined} props.ratio
 * @param {{ hasTarget?: boolean; met?: boolean | null; excessComplaints?: number | null }} [props.evaluation]
 */
export function WanTouRatioWithTargetCell({ ratio, evaluation }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
      <span className="tabular-nums">{formatWanTouRatio(ratio)}</span>
      <WanTouTargetStatusInline evaluation={evaluation} />
    </span>
  )
}

/**
 * @param {Object} [options]
 * @param {boolean} [options.fixedProduct]
 */
export function buildWanTouProductTableColumns(options = {}) {
  /** @type {import('antd/es/table/interface').ColumnsType<Record<string, unknown>>} */
  const columns = []

  if (!options.fixedProduct) {
    columns.push({
      title: '产品',
      dataIndex: 'productName',
      ellipsis: true,
      fixed: 'left',
      width: 140,
    })
  }

  columns.push(
    {
      title: '全部投诉',
      dataIndex: 'totalComplaints',
      width: 88,
      align: 'center',
    },
    {
      title: '万投比',
      width: 148,
      render: (_, row) => (
        <WanTouRatioWithTargetCell
          ratio={row.displayRatio}
          evaluation={row.periodWanTouTargetEval}
        />
      ),
    },
    {
      title: '客户体验类投诉',
      dataIndex: 'totalCxComplaints',
      width: 132,
      align: 'center',
    },
    {
      title: '客户体验类万投比',
      width: 168,
      render: (_, row) => (
        <WanTouRatioWithTargetCell
          ratio={row.displayCxRatio}
          evaluation={row.periodCxWanTouTargetEval}
        />
      ),
    },
  )

  return columns
}
