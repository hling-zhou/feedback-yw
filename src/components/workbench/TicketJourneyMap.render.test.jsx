import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import TicketJourneyMap, { buildJourneyEvidenceHref } from './TicketJourneyMap.jsx'
import OverviewJourneyMap from './OverviewJourneyMap.jsx'
import { JOURNEY_EMPTY_HINT } from '../../lib/ticketStoryModel.js'

function renderMap(node) {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>)
}

describe('TicketJourneyMap', () => {
  it('shows the single-product empty state and does not draw a heatmap', () => {
    const html = renderMap(
      <TicketJourneyMap layout="heatmap" stages={[{ key: '使用', journeyL1: '使用', currentCount: 2 }]} selectedProduct="全部产品" />,
    )
    expect(html).toContain(JOURNEY_EMPTY_HINT)
    expect(html).not.toContain('一级环节热力')
    expect(html).not.toContain('体验断点')
  })

  it('offers the same product picker in the empty state', () => {
    const html = renderMap(
      <TicketJourneyMap
        layout="empty"
        selectedProduct=""
        products={[{ name: '弹性公网IP', count: 4 }, { name: '云主机', count: 2 }]}
        onProductChange={() => {}}
      />,
    )
    expect(html).toContain(JOURNEY_EMPTY_HINT)
    expect(html).toContain('弹性公网IP (4)')
    expect(html).toContain('云主机 (2)')
  })

  it('draws stacked complaint/consultation bars and mixed evidence without a locked source', () => {
    const html = renderMap(
      <TicketJourneyMap
        layout="lifecycle"
        sourceFilter="all"
        selectedProduct="弹性公网IP"
        previousPeriodLabel="上月"
        currentPeriodLabel="本月"
        stages={[
          {
            key: '认知与选型',
            journeyL1: '认知与选型',
            count: 0,
            currentCount: 0,
            previousCount: 0,
            delta: 0,
            change: null,
            actionLabel: '',
            headline: '—',
            complaintCount: 0,
            consultationCount: 0,
            isFrictionPeak: false,
            empty: true,
            children: [],
            topProblemTypes: [],
            ticketIds: [],
          },
          {
            key: '业务使用与连通',
            journeyL1: '业务使用与连通',
            count: 3,
            currentCount: 3,
            previousCount: 1,
            delta: 2,
            change: '增长',
            actionLabel: '公网访问不通',
            headline: '公网访问不通',
            complaintCount: 2,
            consultationCount: 1,
            isFrictionPeak: true,
            empty: false,
            children: [{ l2: '公网访问不通', count: 3, previousCount: 1, change: '增长', ticketIds: ['T-1'] }],
            topProblemTypes: [{ name: '可用性/连通性故障', count: 2 }],
            ticketIds: ['T-1', 'T-2'],
          },
          {
            key: '服务与体验',
            journeyL1: '服务与体验',
            count: 1,
            currentCount: 1,
            previousCount: 1,
            delta: 0,
            change: '持续',
            actionLabel: '投诉与服务',
            headline: '投诉与服务',
            complaintCount: 1,
            consultationCount: 0,
            isFrictionPeak: false,
            empty: false,
            children: [],
            topProblemTypes: [],
            ticketIds: ['T-3'],
          },
        ]}
        highlights={[{ key: '业务使用与连通', journeyL1: '业务使用与连通', text: '业务使用与连通 1→3，增长' }]}
      />,
    )
    expect(html).toContain('体验断点 · 业务使用与连通')
    expect(html).toContain('投诉')
    expect(html).toContain('咨询')
    expect(html).toContain('变差')
    expect(html).toContain('持平')
    expect(html).toContain('变好')
    expect(html).toContain('卡在 公网访问不通')
    expect(html).toContain('1→3（+2）')
    expect(html).toContain('#F87171')
    expect(html).toContain('#38BDF8')
    expect(html).toContain('bg-ink-300')
    expect(html).toContain('bg-amber-400')
    expect(html).toContain('本期无反馈')
    expect(html).not.toContain('0→0（0）')
  })

  it('labels every tied friction peak', () => {
    const html = renderMap(
      <TicketJourneyMap
        layout="lifecycle"
        sourceFilter="complaint"
        selectedProduct="弹性公网IP"
        stages={[
          {
            key: '认知与选型',
            journeyL1: '认知与选型',
            currentCount: 3,
            previousCount: 1,
            complaintCount: 3,
            consultationCount: 0,
            isFrictionPeak: true,
            empty: false,
            children: [],
            topProblemTypes: [],
            ticketIds: ['T-1'],
          },
          {
            key: '业务使用与连通',
            journeyL1: '业务使用与连通',
            currentCount: 3,
            previousCount: 2,
            complaintCount: 3,
            consultationCount: 0,
            isFrictionPeak: true,
            empty: false,
            children: [],
            topProblemTypes: [],
            ticketIds: ['T-2'],
          },
        ]}
      />,
    )
    expect(html).toContain('体验断点 · 认知与选型')
    expect(html).toContain('体验断点 · 业务使用与连通')
  })

  it('builds evidence links by product and L1 without ticket ids', () => {
    const mixed = buildJourneyEvidenceHref({
      sourceFilter: 'all',
      product: '弹性公网IP',
      journeyL1: '业务使用与连通',
    })
    const mixedParams = new URLSearchParams(mixed.split('?')[1])
    expect(mixed.startsWith('/feedbacks?')).toBe(true)
    expect(mixedParams.get('product')).toBe('弹性公网IP')
    expect(mixedParams.get('journeyL1')).toBe('业务使用与连通')
    expect(mixedParams.has('ticketIds')).toBe(false)
    expect(mixedParams.has('source')).toBe(false)

    const complaint = buildJourneyEvidenceHref({
      sourceFilter: 'complaint',
      product: '弹性公网IP',
      journeyL1: '认知与选型',
    })
    const complaintParams = new URLSearchParams(complaint.split('?')[1])
    expect(complaintParams.get('source')).toBe('complaint_ticket')
    expect(complaintParams.has('ticketIds')).toBe(false)
  })
})

describe('OverviewJourneyMap', () => {
  it('defaults to all-feedback with a product picker and empty map', () => {
    const html = renderMap(
      <OverviewJourneyMap
        currentPeriod={{
          id: 'period:month:2026-06',
          label: '2026年6月',
          startDate: '2026-06-01',
          endDate: '2026-06-30',
          granularity: 'month',
          anchorYear: 2026,
          anchorMonth: 6,
        }}
        feedbacks={[
          {
            id: '1',
            ticketId: 'T-1',
            dataSourceType: 'complaint_ticket',
            product: '弹性公网IP',
            importMonth: '2026-06',
            journeyL1: '业务使用与连通',
            complaintCauseL1Final: '客户体验类',
          },
        ]}
      />,
    )
    expect(html).toContain('全部反馈')
    expect(html).toContain('投诉仅含客户体验类')
    expect(html).toContain('选择一个产品')
    expect(html).toContain(JOURNEY_EMPTY_HINT)
    expect(html).not.toContain('体验断点')
  })
})
