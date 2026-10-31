import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-obs-repo-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-observation-repo'

let sqliteAvailable = false

try {
  const { closeDb, getDb } = await import('./db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

describe.skipIf(!sqliteAvailable)('observationRepository', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const { initBusinessSchema } = await import('./businessDb.js')
    initBusinessSchema()
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  async function repo() {
    return (await import('./observationRepository.js')).observationRepository
  }

  it('putIssue creates issue with first link and refreshes aggregates', async () => {
    const r = await repo()
    const issue = r.putIssue(
      {
        productKey: 'EIP',
        productName: '弹性公网IP',
        title: '退订入口难找',
        summary: '控制台找不到退订/取消入口，列表超50条翻不到',
        keywords: ['退订', '取消入口'],
      },
      {
        firstLink: {
          recordId: 'rec-001',
          recordDataSource: 'complaint_ticket',
          ticketId: 'T101',
        },
        actor: { userId: 'u1', username: 'alice' },
      },
    )
    expect(issue.id).toBeTruthy()
    expect(issue.status).toBe('watching')
    expect(issue.occurrenceCount).toBe(1)
    expect(issue.firstSeenAt).toBeTruthy()
    expect(issue.payload?.keywords).toEqual(['退订', '取消入口'])

    const links = r.listLinksByIssue(issue.id)
    expect(links).toHaveLength(1)
    expect(links[0].linkStatus).toBe('confirmed')
    expect(links[0].linkSource).toBe('manual')
  })

  it('putIssue rejects invalid input with OBSERVATION_VALIDATION', async () => {
    const r = await repo()
    expect(() =>
      r.putIssue({ productKey: 'EIP', productName: 'x', title: '', summary: '' }),
    ).toThrowError(/不能为空/)
  })

  it('putLink upsert priority matrix: manual confirmed upgrades pending; auto never overrides manual', async () => {
    const r = await repo()
    const issue = r.putIssue({
      productKey: 'EIP',
      productName: '弹性公网IP',
      title: '转发表加载慢',
      summary: '转发表超过100条时控制台加载超过10秒',
    })
    const { buildObservationLinkFromInput } = await import(
      '../src/domain/observationIssue.js'
    )

    // 自动建议写入 pending
    const autoPending = buildObservationLinkFromInput({
      issueId: issue.id,
      recordId: 'rec-100',
      recordDataSource: 'complaint_ticket',
      linkStatus: 'pending_suggest',
      linkSource: 'auto_match',
      matchConfidence: 'medium',
      matchReason: '两者均为列表规模大时加载慢',
      matchedExcerpt: '转发表加载慢',
    })
    expect(autoPending.errors).toHaveLength(0)
    const created = r.putLink(autoPending.link)
    expect(created.action).toBe('created')

    // 再次自动建议：pending 已存在 → 升级更新而非重复
    const autoAgain = buildObservationLinkFromInput({
      issueId: issue.id,
      recordId: 'rec-100',
      recordDataSource: 'complaint_ticket',
      linkStatus: 'pending_suggest',
      linkSource: 'auto_match',
      matchConfidence: 'high',
      matchReason: 'reason v2',
    })
    const updated = r.putLink(autoAgain.link)
    expect(updated.action).toBe('upgraded')
    expect(updated.link?.matchConfidence).toBe('high')
    expect(r.listLinksByIssue(issue.id)).toHaveLength(1)

    // 人工 confirm 覆盖 pending
    const manualConfirm = buildObservationLinkFromInput({
      issueId: issue.id,
      recordId: 'rec-100',
      recordDataSource: 'complaint_ticket',
      linkStatus: 'confirmed',
      linkSource: 'manual',
    })
    const upgraded = r.putLink(manualConfirm.link, { actor: { userId: 'u1', username: 'alice' } })
    expect(upgraded.action).toBe('upgraded')
    expect(upgraded.link?.linkStatus).toBe('confirmed')
    expect(issue ? r.getIssue(issue.id)?.occurrenceCount : 0).toBe(1)

    // 自动建议撞已 confirmed → 跳过
    const autoVsConfirmed = buildObservationLinkFromInput({
      issueId: issue.id,
      recordId: 'rec-100',
      recordDataSource: 'complaint_ticket',
      linkStatus: 'pending_suggest',
      linkSource: 'auto_match',
      matchConfidence: 'high',
    })
    const skipped = r.putLink(autoVsConfirmed.link)
    expect(skipped.action).toBe('skipped_conflict')
  })

  it('reviewSuggestion confirm / dismiss / new_issue all work', async () => {
    const r = await repo()
    const issue = r.putIssue({
      productKey: 'VPC',
      productName: '虚拟私有云',
      title: '子网删除失败',
      summary: '存在关联资源时删除报错但提示不清',
    })
    const { buildObservationLinkFromInput } = await import(
      '../src/domain/observationIssue.js'
    )
    const mkLink = (recordId) =>
      buildObservationLinkFromInput({
        issueId: issue.id,
        recordId,
        recordDataSource: 'complaint_ticket',
        linkStatus: 'pending_suggest',
        linkSource: 'auto_match',
        matchConfidence: 'medium',
        matchReason: '测试建议',
      })
    const s1 = r.putLink(mkLink('rec-201').link).link
    const s2 = r.putLink(mkLink('rec-202').link).link
    const s3 = r.putLink(mkLink('rec-203').link).link

    // confirm
    const confirmed = r.reviewSuggestion(s1.id, 'confirm', { actor: { username: 'bob' } })
    expect(confirmed.action).toBe('confirmed')
    expect(confirmed.link.linkStatus).toBe('confirmed')
    expect(r.getIssue(issue.id)?.occurrenceCount).toBe(1)

    // dismiss
    const dismissed = r.reviewSuggestion(s2.id, 'dismiss', { actor: { username: 'bob' } })
    expect(dismissed.action).toBe('dismissed')
    expect(dismissed.link.linkStatus).toBe('dismissed')

    // dismissed 组合的自动建议不再产生：人工否决是终态，矩阵按"自动不覆盖人工"拦截
    const reSuggest = r.putLink(mkLink('rec-202').link)
    expect(reSuggest.action).toBe('skipped_auto_vs_manual')

    // dismissed 组合人工可推翻（S3）
    const manualOverturn = buildObservationLinkFromInput({
      issueId: issue.id,
      recordId: 'rec-202',
      recordDataSource: 'complaint_ticket',
      linkStatus: 'confirmed',
      linkSource: 'manual',
    })
    const overturn = r.putLink(manualOverturn.link, { overrideDismissed: true })
    expect(overturn.action).toBe('upgraded')

    // new_issue
    const newIssueResult = r.reviewSuggestion(
      s3.id,
      'new_issue',
      {
        newIssue: {
          title: '全新问题',
          summary: '与已有留观问题不同',
          productKey: 'VPC',
          productName: '虚拟私有云',
        },
        actor: { username: 'bob' },
      },
    )
    expect(newIssueResult.action).toBe('new_issue')
    expect(newIssueResult.issue.id).not.toBe(issue.id)
    expect(newIssueResult.issue.occurrenceCount).toBe(1)
    expect(r.getLink(s3.id)?.linkStatus).toBe('dismissed')
  })

  it('reviewSuggestion rejects already-reviewed suggestion', async () => {
    const r = await repo()
    const issue = r.putIssue({
      productKey: 'VPC',
      productName: '虚拟私有云',
      title: '重复复核测试',
      summary: '重复复核测试问题描述',
    })
    const { buildObservationLinkFromInput } = await import(
      '../src/domain/observationIssue.js'
    )
    const s = r.putLink(
      buildObservationLinkFromInput({
        issueId: issue.id,
        recordId: 'rec-301',
        recordDataSource: 'complaint_ticket',
        linkStatus: 'pending_suggest',
        linkSource: 'auto_match',
        matchConfidence: 'low',
      }).link,
    ).link
    r.reviewSuggestion(s.id, 'dismiss', { actor: { username: 'bob' } })
    expect(() => r.reviewSuggestion(s.id, 'confirm')).toThrowError(/已被处理/)
  })

  it('deleteLink refreshes aggregates; deleteIssue cascades links explicitly', async () => {
    const r = await repo()
    const issue = r.putIssue({
      productKey: 'EIP',
      productName: '弹性公网IP',
      title: '级联删除测试',
      summary: '级联删除测试问题描述',
    })
    const { buildObservationLinkFromInput } = await import(
      '../src/domain/observationIssue.js'
    )
    r.putLink(
      buildObservationLinkFromInput({
        issueId: issue.id,
        recordId: 'rec-401',
        recordDataSource: 'complaint_ticket',
        linkStatus: 'confirmed',
        linkSource: 'manual',
      }).link,
    )
    r.putLink(
      buildObservationLinkFromInput({
        issueId: issue.id,
        recordId: 'rec-402',
        recordDataSource: 'post_use_rating',
        linkStatus: 'confirmed',
        linkSource: 'manual',
      }).link,
    )
    expect(r.getIssue(issue.id)?.occurrenceCount).toBe(2)

    const links = r.listLinksByIssue(issue.id)
    r.deleteLink(links[0].id)
    expect(r.getIssue(issue.id)?.occurrenceCount).toBe(1)

    const { linksDeleted } = r.deleteIssue(issue.id)
    expect(linksDeleted).toBe(1)
    expect(r.getIssue(issue.id)).toBeNull()
    expect(r.listLinksByIssue(issue.id)).toHaveLength(0)
    expect(() => r.deleteIssue(issue.id)).toThrowError(/不存在/)
  })

  it('listIssues filters by sourceMix and keyword; returns ticket/rating counts', async () => {
    const r = await repo()
    const issue = r.putIssue({
      productKey: 'SLB',
      productName: '弹性负载均衡',
      title: '证书替换失败',
      summary: '控制台替换证书按钮报错',
    })
    const { buildObservationLinkFromInput } = await import(
      '../src/domain/observationIssue.js'
    )
    r.putLink(
      buildObservationLinkFromInput({
        issueId: issue.id,
        recordId: 'rec-501',
        recordDataSource: 'complaint_ticket',
        linkStatus: 'confirmed',
        linkSource: 'manual',
      }).link,
    )
    r.putLink(
      buildObservationLinkFromInput({
        issueId: issue.id,
        recordId: 'rec-502',
        recordDataSource: 'post_use_rating',
        linkStatus: 'confirmed',
        linkSource: 'manual',
      }).link,
    )

    const all = r.listIssues({ productKey: 'SLB' })
    expect(all.total).toBe(1)
    expect(all.issues[0].ticketCount).toBe(1)
    expect(all.issues[0].ratingCount).toBe(1)
    expect(all.issues[0].occurrenceCount).toBe(2)

    const ratingOnly = r.listIssues({ sourceMix: 'rating_only' })
    expect(ratingOnly.total).toBe(0)
    const hasTicket = r.listIssues({ sourceMix: 'has_ticket' })
    expect(hasTicket.total).toBeGreaterThanOrEqual(1)

    const kw = r.listIssues({ keyword: '证书' })
    expect(kw.total).toBe(1)
  })

  it('pendingCount returns breakdown by confidence', async () => {
    const r = await repo()
    const issue = r.putIssue({
      productKey: 'SLB',
      productName: '弹性负载均衡',
      title: 'pendingCount测试',
      summary: 'pendingCount测试描述',
    })
    const { buildObservationLinkFromInput } = await import(
      '../src/domain/observationIssue.js'
    )
    const before = r.pendingCount()
    r.putLink(
      buildObservationLinkFromInput({
        issueId: issue.id,
        recordId: 'rec-601',
        recordDataSource: 'complaint_ticket',
        linkStatus: 'pending_suggest',
        linkSource: 'auto_match',
        matchConfidence: 'high',
      }).link,
    )
    r.putLink(
      buildObservationLinkFromInput({
        issueId: issue.id,
        recordId: 'rec-602',
        recordDataSource: 'complaint_ticket',
        linkStatus: 'pending_suggest',
        linkSource: 'auto_anchor',
        matchConfidence: 'medium',
      }).link,
    )
    const after = r.pendingCount()
    expect(after.total - before.total).toBe(2)
    expect(after.high - before.high).toBe(1)
    expect(after.medium - before.medium).toBe(1)
  })

  it('searchRecordsForAttach finds by ticketId and prefers same product', async () => {
    const r = await repo()
    // 插入测试记录
    const { getDb } = await import('./db.js')
    const db = getDb()
    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO records (id, payload, import_month, data_source_type, tenant_id, import_batch_id, ticket_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'rec-search-1',
      JSON.stringify({
        id: 'rec-search-1',
        ticketId: 'T-SEARCH-1',
        product: '弹性公网IP',
        productKey: 'EIP',
        dataSourceType: 'complaint_ticket',
        painPoint: '退订入口找不到',
        createdAt: '2026-10-01',
      }),
      '2026-10',
      'complaint_ticket',
      'local',
      '',
      'T-SEARCH-1',
    )
    db.prepare(
      `INSERT INTO records (id, payload, import_month, data_source_type, tenant_id, import_batch_id, ticket_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'rec-search-2',
      JSON.stringify({
        id: 'rec-search-2',
        ticketId: 'T-SEARCH-2',
        product: '虚拟私有云',
        productKey: 'VPC',
        dataSourceType: 'post_use_rating',
        commentText: '退订太麻烦了想退退不了',
        createdAt: '2026-10-02',
      }),
      '2026-10',
      'post_use_rating',
      'local',
      '',
      'T-SEARCH-2',
    )

    const byTicket = r.searchRecordsForAttach({ query: 'T-SEARCH-1' })
    expect(byTicket).toHaveLength(1)
    expect(byTicket[0].recordId).toBe('rec-search-1')

    const byText = r.searchRecordsForAttach({ query: '退订', productKey: 'EIP' })
    expect(byText.length).toBe(2)
    expect(byText[0].sameProduct).toBe(true)
  })
})
