import { describe, expect, it } from 'vitest'
import {
  buildComplaintVolumeWanTouExportRows,
  buildConsultationTrendExportRows,
  buildCustomProblemCategoryExportRows,
} from './ticketTrendTableExport.js'

describe('ticketTrendTableExport', () => {
  it('omits wan-tou columns until a product is selected', () => {
    const rows = buildComplaintVolumeWanTouExportRows(
      [{ date: '2026-06', count: 4, negative: 1, ratio: 1.2, orders: 100 }],
      { includeRatio: false, target: 0.5 },
    )
    expect(rows).toEqual([{ 月份: '2026-06', 工单量: 4, 负向工单: 1 }])
  })

  it('includes ratio, orders and target for a selected product, leaving missing ratio blank', () => {
    const rows = buildComplaintVolumeWanTouExportRows(
      [
        { date: '2026-05', count: 2, negative: 0, ratio: null, orders: null },
        { date: '2026-06', count: 4, negative: 1, ratio: 1.25, orders: 80 },
      ],
      { includeRatio: true, target: 0.5 },
    )
    expect(rows[0]).toMatchObject({ 客户体验类万投比: '', 月订单数: '', 目标值: 0.5 })
    expect(rows[1]).toMatchObject({ 客户体验类万投比: 1.25, 月订单数: 80, 目标值: 0.5 })
  })

  it('exports consultation negative share and custom category distribution', () => {
    expect(buildConsultationTrendExportRows([
      { date: '2026-06', count: 4, negative: 1, negativePct: 25 },
    ])).toEqual([{ 月份: '2026-06', 工单量: 4, 负向工单: 1, '负向占比（%）': 25 }])
    expect(buildCustomProblemCategoryExportRows([
      { name: '未填写', count: 3, sharePct: 100 },
    ])).toEqual([{ '问题分类（自定义）': '未填写', 工单量: 3, '占比（%）': 100 }])
  })
})
