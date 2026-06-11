import { describe, expect, it } from 'vitest'
import {
  enrichActionItemWithRequirementProgress,
  getActionItemDisplayScheduleAt,
  getActionItemDisplayStatus,
  isActionItemInRequirementLinkMode,
  pickMostSevereMappedStatus,
  pickDerivedScheduleAtForAggregatedStatus,
  computeRequirementScheduleWarningLevel,
  resolveRequirementTicketDetails,
} from './requirementTicketProgress.js'

describe('requirementTicketProgress', () => {
  const progressById = new Map([
    [
      'REQ-1',
      {
        ticketId: 'REQ-1',
        product: 'VPC',
        scheduleAt: '2026-06-30',
        workflowStatus: '开发中',
        importedAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ],
    [
      'REQ-2',
      {
        ticketId: 'REQ-2',
        product: 'EIP',
        scheduleAt: '2026-08-15',
        workflowStatus: '未排期',
        importedAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ],
  ])

  const mappingByWorkflowStatus = new Map([
    ['开发中', { workflowStatus: '开发中', mapsToActionStatus: 'in_progress', sortOrder: 0 }],
    ['未排期', { workflowStatus: '未排期', mapsToActionStatus: 'pending_evaluation', sortOrder: 1 }],
    ['已上线', { workflowStatus: '已上线', mapsToActionStatus: 'completed', sortOrder: 2 }],
  ])

  it('resolves synced, missing, and unmapped ticket details', () => {
    const details = resolveRequirementTicketDetails(
      ['REQ-1', 'REQ-2', 'REQ-9'],
      progressById,
      mappingByWorkflowStatus,
    )
    expect(details).toHaveLength(3)
    expect(details[0]).toMatchObject({
      ticketId: 'REQ-1',
      mappedStatus: 'in_progress',
      syncState: 'synced',
    })
    expect(details[1]).toMatchObject({
      ticketId: 'REQ-2',
      mappedStatus: 'pending_evaluation',
    })
    expect(details[2]).toMatchObject({
      ticketId: 'REQ-9',
      syncState: 'missing',
      mappedStatus: null,
    })
  })

  it('picks most severe mapped status', () => {
    const details = resolveRequirementTicketDetails(['REQ-1', 'REQ-2'], progressById, mappingByWorkflowStatus)
    expect(pickMostSevereMappedStatus(details)).toBe('in_progress')
  })

  it('uses schedule from tickets matching aggregated status only', () => {
    const details = resolveRequirementTicketDetails(['REQ-1', 'REQ-2'], progressById, mappingByWorkflowStatus)
    const derivedStatus = pickMostSevereMappedStatus(details)
    expect(derivedStatus).toBe('in_progress')
    expect(pickDerivedScheduleAtForAggregatedStatus(details, derivedStatus, new Date('2026-07-01'))).toBe(
      '2026-06-30',
    )
  })

  it('picks farthest past schedule among tickets with same aggregated status', () => {
    const map = new Map([
      [
        'REQ-A',
        {
          ticketId: 'REQ-A',
          product: 'VPC',
          scheduleAt: '2026-05-01',
          workflowStatus: '开发中',
          importedAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
      [
        'REQ-B',
        {
          ticketId: 'REQ-B',
          product: 'VPC',
          scheduleAt: '2026-06-15',
          workflowStatus: '联调中',
          importedAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    ])
    const mappings = new Map([
      ['开发中', { workflowStatus: '开发中', mapsToActionStatus: 'in_progress', sortOrder: 0 }],
      ['联调中', { workflowStatus: '联调中', mapsToActionStatus: 'in_progress', sortOrder: 1 }],
    ])
    const details = resolveRequirementTicketDetails(['REQ-A', 'REQ-B'], map, mappings)
    expect(
      pickDerivedScheduleAtForAggregatedStatus(details, 'in_progress', new Date('2026-07-01')),
    ).toBe('2026-05-01')
  })

  it('prefers past schedules over future when both exist for aggregated status', () => {
    const map = new Map([
      [
        'REQ-A',
        {
          ticketId: 'REQ-A',
          product: 'VPC',
          scheduleAt: '2026-06-15',
          workflowStatus: '开发中',
          importedAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
      [
        'REQ-B',
        {
          ticketId: 'REQ-B',
          product: 'VPC',
          scheduleAt: '2026-08-01',
          workflowStatus: '联调中',
          importedAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    ])
    const mappings = new Map([
      ['开发中', { workflowStatus: '开发中', mapsToActionStatus: 'in_progress', sortOrder: 0 }],
      ['联调中', { workflowStatus: '联调中', mapsToActionStatus: 'in_progress', sortOrder: 1 }],
    ])
    const details = resolveRequirementTicketDetails(['REQ-A', 'REQ-B'], map, mappings)
    expect(
      pickDerivedScheduleAtForAggregatedStatus(details, 'in_progress', new Date('2026-07-01')),
    ).toBe('2026-06-15')
  })

  it('picks nearest future schedule when only future dates match aggregated status', () => {
    const map = new Map([
      [
        'REQ-A',
        {
          ticketId: 'REQ-A',
          product: 'VPC',
          scheduleAt: '2026-08-15',
          workflowStatus: '开发中',
          importedAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
      [
        'REQ-B',
        {
          ticketId: 'REQ-B',
          product: 'VPC',
          scheduleAt: '2026-09-01',
          workflowStatus: '联调中',
          importedAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    ])
    const mappings = new Map([
      ['开发中', { workflowStatus: '开发中', mapsToActionStatus: 'in_progress', sortOrder: 0 }],
      ['联调中', { workflowStatus: '联调中', mapsToActionStatus: 'in_progress', sortOrder: 1 }],
    ])
    const details = resolveRequirementTicketDetails(['REQ-A', 'REQ-B'], map, mappings)
    expect(
      pickDerivedScheduleAtForAggregatedStatus(details, 'in_progress', new Date('2026-07-01')),
    ).toBe('2026-08-15')
  })

  it('uses completed ticket schedule when aggregated status is completed', () => {
    const completedMap = new Map([
      [
        'REQ-3',
        {
          ticketId: 'REQ-3',
          product: 'VPC',
          scheduleAt: '2026-05-01',
          workflowStatus: '已上线',
          importedAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ],
    ])
    const details = resolveRequirementTicketDetails(['REQ-3'], completedMap, mappingByWorkflowStatus)
    expect(pickDerivedScheduleAtForAggregatedStatus(details, 'completed', new Date('2026-07-01'))).toBe(
      '2026-05-01',
    )
  })

  it('computes orange and red schedule warnings', () => {
    expect(computeRequirementScheduleWarningLevel('2026-06-10', new Date('2026-06-01'))).toBe('orange')
    expect(computeRequirementScheduleWarningLevel('2026-05-01', new Date('2026-06-01'))).toBe('red')
    expect(computeRequirementScheduleWarningLevel('2026-12-01', new Date('2026-06-01'))).toBe('none')
  })

  it('display helpers use derived fields in requirement link mode', () => {
    const item = {
      id: 'a1',
      content: '举措',
      status: 'suspended',
      scheduleAt: '2026-06-01',
      linkedRequirementTicketIds: ['REQ-1'],
      requirementLinkMode: true,
      derivedStatus: 'in_progress',
      derivedScheduleAt: '2026-05-14',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }
    expect(isActionItemInRequirementLinkMode(item)).toBe(true)
    expect(getActionItemDisplayStatus(item)).toBe('in_progress')
    expect(getActionItemDisplayScheduleAt(item)).toBe('2026-05-14')
  })

  it('display helpers use library fields when not requirement linked', () => {
    const item = {
      id: 'a2',
      content: '举措',
      status: 'in_progress',
      scheduleAt: '2026-08-01',
      linkedRequirementTicketIds: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    }
    expect(isActionItemInRequirementLinkMode(item)).toBe(false)
    expect(getActionItemDisplayStatus(item)).toBe('in_progress')
    expect(getActionItemDisplayScheduleAt(item)).toBe('2026-08-01')
  })

  it('enriches linked action items for list display', () => {
    const enriched = enrichActionItemWithRequirementProgress(
      {
        id: 'a1',
        content: '举措',
        status: 'pending_evaluation',
        scheduleAt: '',
        linkedRequirementTicketIds: ['REQ-1', 'REQ-9'],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      progressById,
      mappingByWorkflowStatus,
      new Date('2026-06-20'),
    )
    expect(enriched.requirementLinkMode).toBe(true)
    expect(enriched.derivedStatus).toBe('in_progress')
    expect(enriched.derivedScheduleAt).toBe('2026-06-30')
    expect(enriched.requirementTickets).toHaveLength(2)
    expect(enriched.derivedWarningLevel).toBe('orange')
    expect(enriched.warningLevel).toBe('orange')
  })
})
