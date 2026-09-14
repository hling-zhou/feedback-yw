import { useMemo, useState } from 'react'
import { Table, Tag, Typography, Empty, Tooltip, Button, Drawer, Space } from 'antd'
import { StarFilled } from '@ant-design/icons'
import ProblemDetailDrawer from './ProblemDetailDrawer.jsx'

const TIER_COLORS = {
  structural: 'red',
  change: 'orange',
  sharp: 'volcano',
  iteration: 'blue',
  tail: 'default',
  cross: 'purple',
  crossCut: 'purple',
}

/**
 * 提取问题家族名：取 summary 中 " · " 前面的部分。
 * @param {string} summary
 * @returns {string}
 */
function extractFamily(summary) {
  if (!summary) return '未分类'
  const idx = summary.indexOf(' · ')
  return idx > 0 ? summary.slice(0, idx) : summary
}

/**
 * 跨产品对比矩阵 — 按问题家族聚合，横向对比各产品的工单分布。
 * 跨产品的共性问题高亮，支持点击行展开详情。
 *
 * @param {Object} props
 * @param {import('../../domain/overviewConclusions.js').ActionRecsResult[]} props.recs - 全部行动建议
 * @param {import('../../lib/types.js').FeedbackRecord[]} [props.records=[]] - 全量工单，用于详情抽屉
 * @param {(record: import('../../lib/types.js').FeedbackRecord) => void} [props.onOpenFeedback]
 */
export default function CrossProductCompare({ recs, records = [], onOpenFeedback }) {
  const [selectedRec, setSelectedRec] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 按问题家族 × 产品 聚合
  const { matrix, families, products, crossFamilies } = useMemo(() => {
    const famMap = new Map() // family -> [{ product, rec, count, c, q }]
    const productSet = new Set()

    for (const rec of recs) {
      const family = extractFamily(rec.summary || rec.text)
      const product = rec.scope?.product || '未知'
      productSet.add(product)

      if (!famMap.has(family)) famMap.set(family, [])
      famMap.get(family).push({ product, rec, count: rec.scale?.ticketCount || 0, c: rec.scale?.complaintCount || 0, q: rec.scale?.consultationCount || 0 })
    }

    // 聚合：family -> { products: { product -> { total, c, q, recs: [] } }, grandTotal, isCross }
    const famAgg = []
    for (const [family, items] of famMap.entries()) {
      const productAgg = {}
      let grandTotal = 0
      let grandC = 0
      let grandQ = 0
      const famRecs = []

      for (const item of items) {
        if (!productAgg[item.product]) {
          productAgg[item.product] = { total: 0, c: 0, q: 0, recs: [] }
        }
        productAgg[item.product].total += item.count
        productAgg[item.product].c += item.c
        productAgg[item.product].q += item.q
        productAgg[item.product].recs.push(item.rec)
        grandTotal += item.count
        grandC += item.c
        grandQ += item.q
        famRecs.push(item.rec)
      }

      famAgg.push({
        key: family,
        family,
        products: productAgg,
        productCount: Object.keys(productAgg).length,
        grandTotal,
        grandC,
        grandQ,
        isCross: Object.keys(productAgg).length > 1,
        recs: famRecs,
      })
    }

    // 排序：跨产品的在前，然后按工单总数降序
    famAgg.sort((a, b) => {
      if (a.isCross !== b.isCross) return b.isCross ? 1 : -1
      return b.grandTotal - a.grandTotal
    })

    const crossCount = famAgg.filter((f) => f.isCross).length

    return {
      matrix: famAgg,
      families: famAgg,
      products: [...productSet],
      crossFamilies: crossCount,
    }
  }, [recs])

  if (!recs.length) {
    return <Empty description="本周期无可对比的行动建议数据" />
  }

  // 动态列：全部产品 + 汇总列
  const columns = [
    {
      title: '',
      key: 'cross',
      width: 36,
      fixed: 'left',
      render: (_, row) =>
        row.isCross ? (
          <Tooltip title="跨产品共性问题">
            <StarFilled style={{ color: '#faad14' }} />
          </Tooltip>
        ) : null,
    },
    {
      title: '问题家族',
      dataIndex: 'family',
      width: 200,
      fixed: 'left',
      render: (val, row) => (
        <span className={row.isCross ? 'font-semibold text-orange-600' : ''}>
          {val}
        </span>
      ),
    },
    ...products.map((p) => ({
      title: p,
      key: p,
      width: 100,
      align: 'center',
      render: (_, row) => {
        const cell = row.products[p]
        if (!cell) return <span className="text-gray-300">—</span>
        return (
          <div className="text-center">
            <div className="text-sm font-medium">{cell.total}</div>
            {cell.c > 0 || cell.q > 0 ? (
              <div className="text-[10px] text-gray-400">
                {cell.c > 0 ? <span className="text-red-500">{cell.c}投</span> : null}
                {cell.c > 0 && cell.q > 0 ? '·' : null}
                {cell.q > 0 ? <span className="text-blue-500">{cell.q}咨</span> : null}
              </div>
            ) : null}
          </div>
        )
      },
    })),
    {
      title: '合计',
      key: 'total',
      width: 80,
      align: 'center',
      fixed: 'right',
      render: (_, row) => (
        <span className="font-semibold">{row.grandTotal}</span>
      ),
    },
    {
      title: '产品数',
      key: 'productCount',
      width: 70,
      align: 'center',
      fixed: 'right',
      render: (_, row) => (
        <Tag color={row.isCross ? 'orange' : 'default'} className="!text-xs">
          {row.productCount}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 80,
      fixed: 'right',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          className="!px-0"
          onClick={() => {
            // 选中该家族中工单数最多的一条 rec 作为详情入口
            const top = row.recs.reduce((a, b) =>
              ((b.scale?.ticketCount || 0) > (a.scale?.ticketCount || 0)) ? b : a,
            row.recs[0])
            setSelectedRec(top)
            setDrawerOpen(true)
          }}
        >
          详情
        </Button>
      ),
    },
  ]

  return (
    <div>
      {/* 概要 */}
      <div className="mb-3 flex items-center gap-4 text-sm">
        <Typography.Text type="secondary">
          共 {families.length} 个问题家族
        </Typography.Text>
        <Tag color="orange" icon={<StarFilled />}>
          {crossFamilies} 个跨产品共性
        </Tag>
        <Typography.Text type="secondary" className="text-xs">
          ★ 标记为跨多个产品的共性问题，优先关注
        </Typography.Text>
      </div>

      {/* 矩阵表 */}
      <Table
        size="small"
        rowKey={(r) => r.key}
        dataSource={matrix}
        columns={columns}
        pagination={false}
        scroll={{ x: 'max-content' }}
        rowClassName={(row) =>
          row.isCross ? 'bg-orange-50/40' : ''
        }
      />

      {/* 详情抽屉 */}
      <ProblemDetailDrawer
        rec={selectedRec}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        records={records}
        onOpenFeedback={onOpenFeedback}
      />
    </div>
  )
}
