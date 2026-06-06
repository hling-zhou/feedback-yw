import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, InputNumber, Select, Table, Typography } from 'antd'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { getEnabledProducts } from '../lib/productCatalog.js'
import { monthsInYear } from '../lib/wanTouRatio.js'

/**
 * @param {Object} props
 * @param {import('../storage/orderVolumeStore.js').OrderVolumeRow[]} props.orderVolumes
 * @param {(row: { productKey: string; month: string; orderCount: number }) => Promise<void>} props.onSave
 * @param {boolean} [props.loading]
 */
export default function ProductOrderVolumePanel({ orderVolumes, onSave, loading }) {
  const message = useAppMessage()
  const products = useMemo(() => getEnabledProducts(), [])
  const [productKey, setProductKey] = useState(() => products[0]?.key || '')
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [draft, setDraft] = useState(/** @type {Record<string, number | null>} */ ({}))
  const [saving, setSaving] = useState(false)

  const months = useMemo(() => monthsInYear(year), [year])

  useEffect(() => {
    if (!productKey && products[0]?.key) setProductKey(products[0].key)
  }, [products, productKey])

  useEffect(() => {
    /** @type {Record<string, number | null>} */
    const next = {}
    for (const m of months) {
      const row = orderVolumes.find((v) => v.productKey === productKey && v.month === m)
      next[m] = row?.orderCount ?? null
    }
    setDraft(next)
  }, [orderVolumes, productKey, months])

  const persistAll = useCallback(async () => {
    if (!productKey) {
      message.warning('请选择产品')
      return
    }
    setSaving(true)
    try {
      for (const month of months) {
        const count = draft[month]
        if (count == null || count === '') continue
        await onSave({ productKey, month, orderCount: Number(count) })
      }
      message.success('已保存产品月订单数')
    } catch (e) {
      message.error(e.message || '保存失败')
    } finally {
      setSaving(false)
    }
  }, [productKey, months, draft, onSave])

  const columns = [
    { title: '月份', dataIndex: 'month', width: 110 },
    {
      title: '订单数',
      dataIndex: 'month',
      render: (month) => (
        <InputNumber
          className="w-full max-w-[200px]"
          min={0}
          precision={0}
          placeholder="手动填写"
          value={draft[month] ?? null}
          onChange={(v) => setDraft((d) => ({ ...d, [month]: v }))}
        />
      ),
    },
  ]

  return (
    <Card title="产品月订单数（万投比分母）">
      <Alert
        type="info"
        showIcon
        className="!mb-4"
        title="万投比 = 投诉工单数 ÷ 产品订单数 × 10000"
        description="按产品、按自然月维护订单数。工作台选择月/年洞察周期后，在综合概述与各产品投诉 Tab 中展示对应万投比。"
      />
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <Typography.Text strong className="mb-1 block text-xs">
            产品
          </Typography.Text>
          <Select
            className="min-w-[200px]"
            value={productKey || undefined}
            options={products.map((p) => ({
              label: `${p.name}（${p.key}）`,
              value: p.key,
            }))}
            onChange={setProductKey}
          />
        </div>
        <div>
          <Typography.Text strong className="mb-1 block text-xs">
            年份
          </Typography.Text>
          <Select
            className="min-w-[120px]"
            value={year}
            options={[year - 1, year, year + 1].map((y) => ({
              label: `${y} 年`,
              value: y,
            }))}
            onChange={setYear}
          />
        </div>
        <Button type="primary" loading={saving || loading} onClick={persistAll}>
          保存本年 12 个月
        </Button>
      </div>
      <Table
        size="small"
        pagination={false}
        rowKey="month"
        dataSource={months.map((month) => ({ month }))}
        columns={columns}
      />
    </Card>
  )
}
