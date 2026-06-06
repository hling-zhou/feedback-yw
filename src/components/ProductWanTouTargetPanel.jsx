import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, InputNumber, Select, Typography } from 'antd'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { getEnabledProducts } from '../lib/productCatalog.js'

/**
 * @param {Object} props
 * @param {import('../storage/wanTouTargetStore.js').WanTouTargetRow[]} props.wanTouTargets
 * @param {(row: { productKey: string; year: number; wanTouTarget?: number | null; customerExperienceWanTouTarget?: number | null }) => Promise<void>} props.onSave
 * @param {boolean} [props.loading]
 */
export default function ProductWanTouTargetPanel({ wanTouTargets, onSave, loading }) {
  const message = useAppMessage()
  const products = useMemo(() => getEnabledProducts(), [])
  const [productKey, setProductKey] = useState(() => products[0]?.key || '')
  const [year, setYear] = useState(() => new Date().getFullYear())
  const [wanTouTarget, setWanTouTarget] = useState(/** @type {number | null} */ (null))
  const [cxWanTouTarget, setCxWanTouTarget] = useState(/** @type {number | null} */ (null))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!productKey && products[0]?.key) setProductKey(products[0].key)
  }, [products, productKey])

  useEffect(() => {
    const row = wanTouTargets.find((item) => item.productKey === productKey && item.year === year)
    setWanTouTarget(row?.wanTouTarget ?? null)
    setCxWanTouTarget(row?.customerExperienceWanTouTarget ?? null)
  }, [wanTouTargets, productKey, year])

  const persist = useCallback(async () => {
    if (!productKey) {
      message.warning('请选择产品')
      return
    }
    setSaving(true)
    try {
      await onSave({
        productKey,
        year,
        wanTouTarget,
        customerExperienceWanTouTarget: cxWanTouTarget,
      })
      message.success('已保存万投比目标值')
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [productKey, year, wanTouTarget, cxWanTouTarget, onSave, message])

  return (
    <Card title="万投比目标值（每产品每年）">
      <Alert
        type="info"
        showIcon
        className="!mb-4"
        title="工作台按月对比达标情况"
        description="万投比目标用于全部投诉工单；客户体验类万投比目标仅统计「投诉原因一级（终判）= 客户体验类」的投诉工单。未达标时将计算超量单数。"
      />
      <div className="mb-4 flex flex-wrap items-end gap-x-4 gap-y-3">
        <div>
          <Typography.Text strong className="mb-1 block text-xs">
            产品
          </Typography.Text>
          <Select
            className="min-w-[200px]"
            value={productKey || undefined}
            options={products.map((product) => ({
              label: `${product.name}（${product.key}）`,
              value: product.key,
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
            options={[year - 1, year, year + 1].map((value) => ({
              label: `${value} 年`,
              value,
            }))}
            onChange={setYear}
          />
        </div>
        <div>
          <Typography.Text strong className="mb-1 block text-xs">
            万投比目标值
          </Typography.Text>
          <InputNumber
            className="w-[160px]"
            min={0}
            precision={2}
            placeholder="如 50"
            value={wanTouTarget}
            onChange={setWanTouTarget}
          />
        </div>
        <div>
          <Typography.Text strong className="mb-1 block text-xs">
            客户体验类万投比目标值
          </Typography.Text>
          <InputNumber
            className="w-[160px]"
            min={0}
            precision={2}
            placeholder="如 20"
            value={cxWanTouTarget}
            onChange={setCxWanTouTarget}
          />
        </div>
        <Button type="primary" loading={saving || loading} onClick={persist}>
          保存目标值
        </Button>
      </div>
    </Card>
  )
}
