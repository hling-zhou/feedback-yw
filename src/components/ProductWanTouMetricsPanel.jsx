import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Divider,
  InputNumber,
  Select,
  Space,
  Table,
  Typography,
} from 'antd'
import { useAppMessage } from '../hooks/useAppMessage.js'
import { getEnabledProducts } from '../lib/productCatalog.js'
import { monthsInYear } from '../lib/wanTouRatio.js'

const METRICS_HINT_TITLE = '万投比 = 投诉工单数 ÷ 产品订单数 × 10000'
const METRICS_HINT_DESCRIPTION =
  '按产品分别维护目标值与月订单数；每个产品独立编辑。有未保存修改时底部会出现保存条。工作台选择洞察周期后，在综合概述与各产品投诉 Tab 中展示对应万投比及达标情况。'

/**
 * @param {object} params
 * @param {string} params.productKey
 * @param {number} params.year
 * @param {string[]} params.months
 * @param {import('../storage/orderVolumeStore.js').OrderVolumeRow[]} params.orderVolumes
 * @param {import('../storage/wanTouTargetStore.js').WanTouTargetRow[]} params.wanTouTargets
 */
function pickMetricsBaseline({ productKey, year, months, orderVolumes, wanTouTargets }) {
  const targetRow = wanTouTargets.find((item) => item.productKey === productKey && item.year === year)
  /** @type {Record<string, number | null>} */
  const orderDraft = {}
  for (const month of months) {
    const row = orderVolumes.find((v) => v.productKey === productKey && v.month === month)
    orderDraft[month] = row?.orderCount ?? null
  }
  return {
    wanTouTarget: targetRow?.wanTouTarget ?? null,
    cxWanTouTarget: targetRow?.customerExperienceWanTouTarget ?? null,
    orderDraft,
  }
}

/**
 * @param {number | null | undefined} a
 * @param {number | null | undefined} b
 */
function sameNullableNumber(a, b) {
  const left = a == null || a === '' ? null : Number(a)
  const right = b == null || b === '' ? null : Number(b)
  if (left == null && right == null) return true
  if (left == null || right == null) return false
  return left === right
}

/**
 * @param {{
 *   wanTouTarget: number | null
 *   cxWanTouTarget: number | null
 *   orderDraft: Record<string, number | null>
 * }} draft
 * @param {ReturnType<typeof pickMetricsBaseline>} baseline
 * @param {string[]} months
 */
function isMetricsDraftDirty(draft, baseline, months) {
  if (!sameNullableNumber(draft.wanTouTarget, baseline.wanTouTarget)) return true
  if (!sameNullableNumber(draft.cxWanTouTarget, baseline.cxWanTouTarget)) return true
  for (const month of months) {
    if (!sameNullableNumber(draft.orderDraft[month], baseline.orderDraft[month])) return true
  }
  return false
}

/**
 * @param {Object} props
 * @param {string} props.productKey
 * @param {string} props.productName
 * @param {import('../storage/orderVolumeStore.js').OrderVolumeRow[]} props.orderVolumes
 * @param {import('../storage/wanTouTargetStore.js').WanTouTargetRow[]} props.wanTouTargets
 * @param {(row: { productKey: string; year: number; wanTouTarget?: number | null; customerExperienceWanTouTarget?: number | null }) => Promise<void>} props.onSaveWanTouTarget
 * @param {(row: { productKey: string; month: string; orderCount: number }) => Promise<void>} props.onSaveOrderVolume
 * @param {boolean} [props.loading]
 */
function ProductWanTouMetricsTabContent({
  productKey,
  productName,
  orderVolumes,
  wanTouTargets,
  onSaveWanTouTarget,
  onSaveOrderVolume,
  loading,
}) {
  const message = useAppMessage()
  const currentYear = new Date().getFullYear()
  const [year, setYear] = useState(currentYear)
  const [wanTouTarget, setWanTouTarget] = useState(/** @type {number | null} */ (null))
  const [cxWanTouTarget, setCxWanTouTarget] = useState(/** @type {number | null} */ (null))
  const [orderDraft, setOrderDraft] = useState(/** @type {Record<string, number | null>} */ ({}))
  const [saving, setSaving] = useState(false)

  const months = useMemo(() => monthsInYear(year), [year])
  const yearOptions = useMemo(
    () => [currentYear - 1, currentYear, currentYear + 1].map((y) => ({ label: `${y} 年`, value: y })),
    [currentYear],
  )

  const baseline = useMemo(
    () => pickMetricsBaseline({ productKey, year, months, orderVolumes, wanTouTargets }),
    [productKey, year, months, orderVolumes, wanTouTargets],
  )

  useEffect(() => {
    setWanTouTarget(baseline.wanTouTarget)
    setCxWanTouTarget(baseline.cxWanTouTarget)
    setOrderDraft(baseline.orderDraft)
  }, [baseline])

  const dirty = isMetricsDraftDirty(
    { wanTouTarget, cxWanTouTarget, orderDraft },
    baseline,
    months,
  )

  const persist = useCallback(async () => {
    setSaving(true)
    try {
      await onSaveWanTouTarget({
        productKey,
        year,
        wanTouTarget,
        customerExperienceWanTouTarget: cxWanTouTarget,
      })
      for (const month of months) {
        const count = orderDraft[month]
        if (count == null || count === '') continue
        await onSaveOrderVolume({ productKey, month, orderCount: Number(count) })
      }
      message.success(`已保存「${productName}」${year} 年万投比指标`)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }, [
    productKey,
    productName,
    year,
    wanTouTarget,
    cxWanTouTarget,
    months,
    orderDraft,
    onSaveWanTouTarget,
    onSaveOrderVolume,
    message,
  ])

  const handleDiscard = () => {
    setWanTouTarget(baseline.wanTouTarget)
    setCxWanTouTarget(baseline.cxWanTouTarget)
    setOrderDraft({ ...baseline.orderDraft })
  }

  const orderColumns = [
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
          value={orderDraft[month] ?? null}
          onChange={(value) => setOrderDraft((draft) => ({ ...draft, [month]: value }))}
        />
      ),
    },
  ]

  return (
    <>
      <div className={`space-y-4 ${dirty ? 'pb-20' : ''}`}>
        <div>
          <Typography.Text strong className="mb-1 block text-xs">
            年份
          </Typography.Text>
          <Select className="min-w-[120px]" value={year} options={yearOptions} onChange={setYear} />
        </div>

        <div>
          <Typography.Text strong className="mb-3 block text-sm">
            万投比目标值
          </Typography.Text>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <div>
              <Typography.Text className="mb-1 block text-xs text-ink-600">万投比目标值</Typography.Text>
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
              <Typography.Text className="mb-1 block text-xs text-ink-600">
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
          </div>
        </div>

        <Divider className="!my-2" />

        <div>
          <Typography.Text strong className="mb-3 block text-sm">
            产品月订单数
          </Typography.Text>
          <Table
            size="small"
            pagination={false}
            rowKey="month"
            dataSource={months.map((month) => ({ month }))}
            columns={orderColumns}
          />
        </div>
      </div>

      {dirty ? (
        <div className="page-sticky-footer">
          <div className="flex max-w-4xl flex-wrap items-center justify-between gap-3 px-3 py-3 sm:px-4 lg:px-5">
            <Typography.Text type="secondary" className="text-sm">
              有未保存的修改（{productName} · {year} 年）
            </Typography.Text>
            <Space wrap>
              <Button disabled={saving || loading} onClick={handleDiscard}>
                放弃更改
              </Button>
              <Button type="primary" loading={saving || loading} onClick={() => void persist()}>
                保存当前产品
              </Button>
            </Space>
          </div>
        </div>
      ) : null}
    </>
  )
}

/**
 * @param {Object} props
 * @param {import('../storage/orderVolumeStore.js').OrderVolumeRow[]} props.orderVolumes
 * @param {import('../storage/wanTouTargetStore.js').WanTouTargetRow[]} props.wanTouTargets
 * @param {(row: { productKey: string; month: string; orderCount: number }) => Promise<void>} props.onSaveOrderVolume
 * @param {(row: { productKey: string; year: number; wanTouTarget?: number | null; customerExperienceWanTouTarget?: number | null }) => Promise<void>} props.onSaveWanTouTarget
 * @param {boolean} [props.loading]
 */
export default function ProductWanTouMetricsPanel({
  orderVolumes,
  wanTouTargets,
  onSaveOrderVolume,
  onSaveWanTouTarget,
  loading = false,
}) {
  const products = useMemo(() => getEnabledProducts(), [])
  const [activeProductKey, setActiveProductKey] = useState(() => products[0]?.key || '')

  useEffect(() => {
    if (!activeProductKey && products[0]?.key) setActiveProductKey(products[0].key)
  }, [products, activeProductKey])

  const activeProduct = useMemo(
    () => products.find((product) => product.key === activeProductKey) || products[0],
    [products, activeProductKey],
  )

  const tabList = useMemo(
    () => products.map((product) => ({ key: product.key, tab: product.name })),
    [products],
  )

  if (!products.length) {
    return (
      <Card>
        <Typography.Text type="secondary">暂无已启用产品，请先在产品目录中配置。</Typography.Text>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Alert type="info" showIcon title={METRICS_HINT_TITLE} description={METRICS_HINT_DESCRIPTION} />
      <Card
        tabList={tabList}
        activeTabKey={activeProductKey || products[0]?.key}
        onTabChange={setActiveProductKey}
      >
        {activeProduct ? (
          <ProductWanTouMetricsTabContent
            key={activeProduct.key}
            productKey={activeProduct.key}
            productName={activeProduct.name}
            orderVolumes={orderVolumes}
            wanTouTargets={wanTouTargets}
            onSaveWanTouTarget={onSaveWanTouTarget}
            onSaveOrderVolume={onSaveOrderVolume}
            loading={loading}
          />
        ) : null}
      </Card>
    </div>
  )
}
