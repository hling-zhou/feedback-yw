import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Empty, Tag, Typography } from 'antd'
import { JOURNEY_EMPTY_HINT, isJourneyProductSelected } from '../../lib/ticketStoryModel.js'

const changeColors = { 新增: 'red', 增长: 'volcano', 持续: 'gold', 缓解: 'blue', 消失: 'green' }
const COMPLAINT_BAR = '#F87171'
const CONSULTATION_BAR = '#38BDF8'
const CURVE_STROKE = '#4F46E5'
const CHART_HEIGHT = 176

export function buildJourneyEvidenceHref({
  sourceType,
  sourceFilter,
  product,
  journeyL1,
}) {
  const params = new URLSearchParams()
  const productName = String(product || '').trim()
  if (productName && productName !== '全部产品') params.set('product', productName)
  const stage = String(journeyL1 || '').trim()
  if (stage) params.set('journeyL1', stage)
  if (sourceFilter === 'complaint') params.set('source', 'complaint_ticket')
  else if (sourceFilter === 'consultation') params.set('source', 'consultation_ticket')
  else if (sourceFilter !== 'all' && sourceType) params.set('source', sourceType)
  const query = params.toString()
  return query ? `/feedbacks?${query}` : '/feedbacks'
}

function formatDelta(delta) {
  if (!Number.isFinite(delta)) return '0'
  return delta > 0 ? `+${delta}` : String(delta)
}

function changePointClass(change) {
  if (change === '新增' || change === '增长') return 'bg-red-500'
  if (change === '缓解' || change === '消失') return 'bg-emerald-500'
  if (change === '持续') return 'bg-amber-400'
  return 'bg-ink-300'
}

function formatStageCountLine(stage) {
  if (stage.empty) return ''
  if (stage.delta == null && !stage.change) return String(stage.currentCount ?? 0)
  return `${stage.previousCount}→${stage.currentCount}（${formatDelta(stage.delta ?? stage.currentCount - stage.previousCount)}）`
}

function ChangeTag({ change }) {
  if (!change) return null
  return <Tag color={changeColors[change]}>{change}</Tag>
}

function LegendSwatch({ color, className = '' }) {
  return (
    <span
      className={`inline-block h-2 w-3 rounded-sm ${className}`}
      style={color ? { background: color } : undefined}
    />
  )
}

function StageDetail({
  stage,
  sourceType,
  sourceFilter,
  selectedProduct,
  previousPeriodLabel,
  currentPeriodLabel,
}) {
  const mixed = sourceFilter === 'all'
  const evidenceTo = buildJourneyEvidenceHref({
    sourceType,
    sourceFilter,
    product: selectedProduct,
    journeyL1: stage.journeyL1,
  })
  const showEvidence = Boolean(stage.currentCount || stage.previousCount || stage.ticketIds?.length)
  return (
    <div className="mt-3 space-y-2 border-t border-ink-100 pt-3">
      <Typography.Text type="secondary" className="text-xs">
        {stage.delta == null && !stage.change
          ? `本期 ${stage.currentCount}${stage.sharePct ? ` · 占 ${stage.sharePct}%` : ''}`
          : `${previousPeriodLabel} ${stage.previousCount} → ${currentPeriodLabel} ${stage.currentCount}${stage.sharePct ? ` · 本期占 ${stage.sharePct}%` : ''}`}
      </Typography.Text>
      {mixed ? (
        <Typography.Text type="secondary" className="text-xs">
          来源构成：投诉 {stage.complaintCount || 0} · 咨询 {stage.consultationCount || 0}
        </Typography.Text>
      ) : null}
      {stage.children?.filter((child) => child.count > 0 || child.previousCount > 0).length ? (
        <ul className="space-y-1">
          {stage.children.filter((child) => child.count > 0 || child.previousCount > 0).slice(0, 6).map((child) => (
            <li key={child.l2} className="flex items-center justify-between gap-2 text-xs text-ink-600">
              <span>{child.l2}</span>
              <span className="shrink-0 text-ink-400">
                {child.previousCount}→{child.count}
                {child.change ? ` · ${child.change}` : ''}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <Typography.Text type="secondary" className="text-xs">该环节暂无二级旅程明细</Typography.Text>
      )}
      {stage.topProblemTypes?.length ? (
        <div className="flex flex-wrap gap-1">
          {stage.topProblemTypes.map((item) => (
            <Tag key={item.name}>{item.name} {item.count}</Tag>
          ))}
        </div>
      ) : null}
      {showEvidence ? (
        <Link
          to={evidenceTo}
          className="inline-block text-xs text-indigo-600 hover:underline"
        >
          查看证据
        </Link>
      ) : null}
    </div>
  )
}

function FrictionCurve({
  stages,
  maxCount,
  sourceFilter,
  selectedKey,
  onSelect,
}) {
  const n = stages.length
  const plotMax = Math.max(1, maxCount)
  const stacked = sourceFilter === 'all'
  const points = stages.map((stage, index) => {
    const x = ((index + 0.5) / n) * 100
    const y = (1 - (stage.currentCount || 0) / plotMax) * 100
    return `${x},${y}`
  }).join(' ')

  return (
    <div>
      <div
        className="mb-1 grid h-8"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {stages.map((stage) => (
          <div key={`${stage.key}-peak`} className="min-w-0 px-0.5 text-center">
            {stage.isFrictionPeak ? (
              <span className="block text-[10px] font-medium leading-tight text-red-600">
                体验断点 · {stage.journeyL1}
              </span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="relative" style={{ height: CHART_HEIGHT }}>
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={points}
            fill="none"
            stroke={CURVE_STROKE}
            strokeWidth="1.75"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <div
          className="absolute inset-0 grid"
          style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
        >
          {stages.map((stage) => {
            const active = selectedKey === stage.key
            const heightPct = ((stage.currentCount || 0) / plotMax) * 100
            const complaintCount = stage.complaintCount || 0
            const consultationCount = stage.consultationCount || 0
            const stackTotal = complaintCount + consultationCount || stage.currentCount || 0
            return (
              <button
                key={stage.key}
                type="button"
                id={`ticket-journey-${encodeURIComponent(stage.journeyL1)}`}
                className={`relative flex h-full min-w-0 flex-col justify-end px-[10%] ${active ? 'bg-brand-50/60' : 'hover:bg-ink-50/80'}`}
                onClick={() => onSelect(active ? '' : stage.key)}
              >
                <div
                  className="flex w-full flex-col justify-end overflow-hidden rounded-t-sm"
                  style={{ height: `${heightPct}%` }}
                >
                  {stacked && stackTotal ? (
                    <>
                      <div
                        className="w-full"
                        style={{
                          height: `${(consultationCount / stackTotal) * 100}%`,
                          background: CONSULTATION_BAR,
                        }}
                      />
                      <div
                        className="w-full"
                        style={{
                          height: `${(complaintCount / stackTotal) * 100}%`,
                          background: COMPLAINT_BAR,
                        }}
                      />
                    </>
                  ) : (
                    <div
                      className="h-full w-full"
                      style={{ background: sourceFilter === 'consultation' ? CONSULTATION_BAR : COMPLAINT_BAR }}
                    />
                  )}
                </div>
                <span
                  className={`absolute left-1/2 z-10 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${changePointClass(stage.change)}`}
                  style={{ top: `${100 - heightPct}%` }}
                />
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function LifecycleMap({
  stages,
  maxCount,
  sourceType,
  sourceFilter,
  selectedProduct,
  previousPeriodLabel,
  currentPeriodLabel,
  selectedKey,
  onSelect,
}) {
  const selected = stages.find((stage) => stage.key === selectedKey)
  const n = stages.length
  return (
    <div className="space-y-3">
      <FrictionCurve
        stages={stages}
        maxCount={maxCount}
        sourceFilter={sourceFilter}
        selectedKey={selectedKey}
        onSelect={onSelect}
      />
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {stages.map((stage) => {
          const active = selectedKey === stage.key
          const stuck = stage.actionLabel || stage.headline
          const countLine = formatStageCountLine(stage)
          return (
            <button
              key={`${stage.key}-label`}
              type="button"
              className={`min-w-0 rounded px-0.5 py-1 text-center ${active ? 'bg-brand-50' : ''}`}
              onClick={() => onSelect(active ? '' : stage.key)}
            >
              <div className="line-clamp-2 text-[11px] font-medium leading-4 text-ink-800">{stage.journeyL1}</div>
              {countLine ? (
                <div className="mt-0.5 text-[10px] leading-4 text-ink-500">{countLine}</div>
              ) : null}
              <div className="mt-0.5 line-clamp-2 text-[10px] leading-4 text-ink-400">
                {stage.empty ? '本期无反馈' : stuck && stuck !== '—' ? `卡在 ${stuck}` : '—'}
              </div>
            </button>
          )
        })}
      </div>
      {selected ? (
        <div className="rounded-lg border border-ink-100 bg-ink-50 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <Typography.Text className="text-sm font-medium">{selected.journeyL1}</Typography.Text>
            <ChangeTag change={selected.change} />
            {selected.isFrictionPeak ? <Tag color="red">体验断点</Tag> : null}
          </div>
          {selected.description ? (
            <Typography.Text type="secondary" className="mt-1 block text-xs">{selected.description}</Typography.Text>
          ) : null}
          <StageDetail
            stage={selected}
            sourceType={sourceType}
            sourceFilter={sourceFilter}
            selectedProduct={selectedProduct}
            previousPeriodLabel={previousPeriodLabel}
            currentPeriodLabel={currentPeriodLabel}
          />
        </div>
      ) : null}
    </div>
  )
}

export default function TicketJourneyMap({
  layout = 'empty',
  stages = [],
  highlights = [],
  sourceType,
  sourceFilter = 'all',
  selectedProduct,
  previousPeriodLabel = '上期',
  currentPeriodLabel = '本期',
  products = [],
  onProductChange,
}) {
  const [selectedKey, setSelectedKey] = useState('')
  const maxCount = Math.max(0, ...stages.map((stage) => stage.currentCount || 0))
  const hasStages = stages.length > 0
  const productSelected = isJourneyProductSelected(selectedProduct)
  const resolvedLayout = productSelected && layout !== 'empty' ? 'lifecycle' : 'empty'
  const stacked = sourceFilter === 'all'
  const productOptions = (products || [])
    .map((item) => ({
      value: item.name,
      label: item.count != null ? `${item.name} (${item.count})` : item.name,
    }))
    .filter((item) => item.value)

  return (
    <div className="space-y-3">
      {resolvedLayout === 'empty' ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <div className="mx-auto max-w-xl space-y-3">
              <Typography.Text type="secondary">{JOURNEY_EMPTY_HINT}</Typography.Text>
              {typeof onProductChange === 'function' && productOptions.length ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {productOptions.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className="rounded-full border border-ink-200 bg-white px-3 py-1 text-xs text-ink-700 hover:border-indigo-300 hover:text-indigo-700"
                      onClick={() => onProductChange(item.value)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          }
        />
      ) : (
        <>
          <Typography.Text type="secondary" className="text-xs">
            按{selectedProduct}用户旅程一级环节排列，纵轴为体验摩擦（该站反馈量），环比对比{previousPeriodLabel}与{currentPeriodLabel}
          </Typography.Text>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-500">
            <span className="inline-flex items-center gap-1">
              <LegendSwatch className="h-0.5 w-4 bg-indigo-600" />
              反馈量
            </span>
            {stacked ? (
              <>
                <span className="inline-flex items-center gap-1">
                  <LegendSwatch color={COMPLAINT_BAR} />
                  投诉
                </span>
                <span className="inline-flex items-center gap-1">
                  <LegendSwatch color={CONSULTATION_BAR} />
                  咨询
                </span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1">
                <LegendSwatch color={sourceFilter === 'consultation' ? CONSULTATION_BAR : COMPLAINT_BAR} />
                {sourceFilter === 'consultation' ? '咨询' : '投诉'}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <span className="text-red-600">▾</span>
              体验断点
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-red-500" />
              变差
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              持平
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              变好
            </span>
          </div>
          {highlights.length ? (
            <div className="flex flex-wrap gap-2">
              {highlights.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="text-xs text-indigo-600 hover:underline"
                  onClick={() => setSelectedKey(item.key)}
                >
                  {item.text}
                </button>
              ))}
            </div>
          ) : null}
          {!hasStages ? (
            <Typography.Text type="secondary">当前范围暂无用户旅程数据</Typography.Text>
          ) : (
            <LifecycleMap
              stages={stages}
              maxCount={maxCount}
              sourceType={sourceType}
              sourceFilter={sourceFilter}
              selectedProduct={selectedProduct}
              previousPeriodLabel={previousPeriodLabel}
              currentPeriodLabel={currentPeriodLabel}
              selectedKey={selectedKey}
              onSelect={setSelectedKey}
            />
          )}
        </>
      )}
    </div>
  )
}
