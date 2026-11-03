import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * generalizationRepository 单测。
 * 纪律：先设 AUTH_DATABASE_PATH 再动态 import（db.js 模块顶层算路径）。
 */

const tempDir = mkdtempSync(join(tmpdir(), 'gen-repo-test-'))
process.env.AUTH_DATABASE_PATH = join(tempDir, 'test.db')

/** @type {import('better-sqlite3').Database} */
let db
/** @type {typeof import('../../server/generalizationRepository.js').generalizationRepository} */
let repo

beforeAll(async () => {
  process.env.AUTH_DATABASE_PATH = join(tempDir, 'test.db')
  const businessDb = await import('./businessDb.js')
  const dbModule = await import('./db.js')
  db = dbModule.getDb()
  businessDb.initBusinessSchema()
  const repoModule = await import('./generalizationRepository.js')
  repo = repoModule.generalizationRepository
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

/** @param {Partial<Record<'productKey'|'productName'|'title'|'summary'|'category'|'scope'|'rootCause'|'optimization'|'originActionId'|'createdBy'>>} overrides */
const validIssueInput = (overrides = {}) => ({
  productKey: 'eip',
  productName: '弹性公网IP',
  title: '退订入口难找',
  summary: '控制台找不到退订入口，列表超 50 条翻不到',
  category: 'console_ux',
  scope: 'multi_scenario',
  ...overrides,
})

/** @param {string} issueId @param {string} n */
const putConfirmedLink = (issueId, n) => {
  const { link, errors } = repo // 借 build 函数
  void link
  void errors
  const { buildGeneralizationLinkFromInput } = /** @type {any} */ (globalThis)
  void buildGeneralizationLinkFromInput
  const result = repo.putLink({
    id: `link-${issueId}-${n}`,
    issueId,
    recordId: `rec-${n}`,
    recordDataSource: 'complaint_ticket',
    ticketId: `T${n}`,
    linkStatus: 'confirmed',
    linkSource: 'manual',
    matchConfidence: '',
    matchReason: '',
    matchedExcerpt: '',
    proposedAt: '',
    reviewedBy: '',
    reviewedAt: '',
    createdAt: `2026-11-0${(Number(n) % 9) + 1}T00:00:00Z`,
  })
  return result
}

describe('generalizationRepository issues CRUD', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM generalization_issue_action_refs').run()
    db.prepare('DELETE FROM generalization_issue_links').run()
    db.prepare('DELETE FROM generalization_issues').run()
    db.prepare('DELETE FROM generalization_hints').run()
  })

  it('putIssue 创建成功（root_cause/optimization 可空）+ getIssue 读取', () => {
    const issue = repo.putIssue(validIssueInput())
    expect(issue.id).toBeTruthy()
    expect(issue.status).toBe('in_progress')
    expect(issue.rootCause).toBe('')
    expect(issue.optimization).toBe('')
    expect(issue.category).toBe('console_ux')
  })

  it('putIssue 校验失败抛 VALIDATION（缺 category/scope）', () => {
    expect(() => repo.putIssue(validIssueInput({ category: '' }))).toThrow(/范畴/)
    expect(() => repo.putIssue(validIssueInput({ scope: '' }))).toThrow(/共性范围/)
  })

  it('putIssue 带首条 link：计数 1、first/last seen 就位', () => {
    const issue = repo.putIssue(validIssueInput(), {
      firstLink: { recordId: 'rec-1', recordDataSource: 'complaint_ticket', ticketId: 'T1' },
    })
    expect(issue.occurrenceCount).toBe(1)
    expect(issue.firstSeenAt).toBeTruthy()
    expect(issue.lastSeenAt).toBeTruthy()
  })

  it('updateIssue：PATCH rootCause 空值被拒（v3.4 防清空绕过）、字段缺席保持原值', () => {
    const issue = repo.putIssue(validIssueInput())
    // 创建可空 → 编辑补全
    const updated = repo.updateIssue(issue.id, { rootCause: '接口事务未包裹', optimization: '包裹事务并回滚' })
    expect(updated.rootCause).toBe('接口事务未包裹')
    // 补全后清空被拒
    expect(() => repo.updateIssue(issue.id, /** @type {any} */ ({ rootCause: '' }))).toThrow(/根因分析不能为空/)
    expect(() => repo.updateIssue(issue.id, /** @type {any} */ ({ optimization: '' }))).toThrow(/优化方案不能为空/)
    // 字段缺席（部分更新）不动该列
    const after = repo.updateIssue(issue.id, { title: '新标题' })
    expect(after.rootCause).toBe('接口事务未包裹')
    expect(after.title).toBe('新标题')
  })

  it('updateIssue 状态流转（in_progress → completed）', () => {
    const issue = repo.putIssue(validIssueInput())
    const done = repo.updateIssue(issue.id, { status: 'completed' })
    expect(done.status).toBe('completed')
  })

  it('纯状态流转豁免必填：未补全 root_cause 的 issue 可直接关闭（终止/完成）', () => {
    const issue = repo.putIssue(validIssueInput()) // rootCause/optimization 均空
    const terminated = repo.updateIssue(issue.id, { status: 'terminated' })
    expect(terminated.status).toBe('terminated')
    expect(terminated.rootCause).toBe('') // 原值保留
    // 但内容编辑（含任一内容字段）仍强制补全两字段
    expect(() => repo.updateIssue(issue.id, { title: '改标题' })).toThrow(/根因分析不能为空/)
  })

  it('deleteIssue 级联清理 links + action_refs（事务内）', () => {
    const issue = repo.putIssue(validIssueInput())
    putConfirmedLink(issue.id, '1')
    db.prepare(
      `INSERT INTO generalization_issue_action_refs (issue_id, action_item_id, kind, created_at)
       VALUES (?, 'act-1', 'created', '2026-11-01T00:00:00Z')`,
    ).run(issue.id)
    const { linksDeleted, actionRefsDeleted } = repo.deleteIssue(issue.id)
    expect(linksDeleted).toBe(1)
    expect(actionRefsDeleted).toBe(1)
    expect(db.prepare('SELECT COUNT(*) n FROM generalization_issues').get().n).toBe(0)
    // 再删抛 NOT_FOUND
    expect(() => repo.deleteIssue(issue.id)).toThrow(/不存在/)
  })
})

describe('generalizationRepository links 与优先级矩阵', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM generalization_issue_links').run()
    db.prepare('DELETE FROM generalization_issues').run()
  })

  it('putLink 新建 confirmed → 计数刷新；重复同组合 skipped_conflict（UNIQUE 幂等）', () => {
    const issue = repo.putIssue(validIssueInput())
    const r1 = putConfirmedLink(issue.id, '1')
    expect(r1.action).toBe('created')
    const r2 = putConfirmedLink(issue.id, '1') // 同 (issue, record)
    expect(r2.action).toBe('skipped_conflict')
    expect(repo.getIssue(issue.id).occurrenceCount).toBe(1)
  })

  it('自动建议不覆盖人工决定（auto vs dismissed → skipped）', () => {
    const issue = repo.putIssue(validIssueInput())
    // 先人工 dismissed
    repo.putLink({
      id: 'l-d', issueId: issue.id, recordId: 'rec-9',
      recordDataSource: 'complaint_ticket', ticketId: 'T9',
      linkStatus: 'dismissed', linkSource: 'manual',
      matchConfidence: '', matchReason: '', matchedExcerpt: '',
      proposedAt: '', reviewedBy: '', reviewedAt: '', createdAt: '2026-11-01T00:00:00Z',
    })
    const auto = repo.putLink({
      id: 'l-a', issueId: issue.id, recordId: 'rec-9',
      recordDataSource: 'complaint_ticket', ticketId: 'T9',
      linkStatus: 'pending_suggest', linkSource: 'auto_match',
      matchConfidence: 'medium', matchReason: '字面命中', matchedExcerpt: '摘录',
      proposedAt: '2026-11-02T00:00:00Z', reviewedBy: '', reviewedAt: '', createdAt: '2026-11-02T00:00:00Z',
    })
    expect(auto.action).toBe('skipped_auto_vs_manual')
  })

  it('pending_suggest + 自动重判 → upgraded（置信度更新状态不动）', () => {
    const issue = repo.putIssue(validIssueInput())
    repo.putLink({
      id: 'l-p', issueId: issue.id, recordId: 'rec-5',
      recordDataSource: 'complaint_ticket', ticketId: 'T5',
      linkStatus: 'pending_suggest', linkSource: 'auto_match',
      matchConfidence: 'low', matchReason: '初判', matchedExcerpt: '',
      proposedAt: '2026-11-01T00:00:00Z', reviewedBy: '', reviewedAt: '', createdAt: '2026-11-01T00:00:00Z',
    })
    const up = repo.putLink({
      id: 'l-p2', issueId: issue.id, recordId: 'rec-5',
      recordDataSource: 'complaint_ticket', ticketId: 'T5',
      linkStatus: 'pending_suggest', linkSource: 'auto_match',
      matchConfidence: 'high', matchReason: '重判命中', matchedExcerpt: '新摘录',
      proposedAt: '2026-11-02T00:00:00Z', reviewedBy: '', reviewedAt: '', createdAt: '2026-11-02T00:00:00Z',
    })
    expect(up.action).toBe('upgraded')
    expect(up.link?.matchConfidence).toBe('high')
    expect(up.link?.linkStatus).toBe('pending_suggest')
  })

  it('人工 confirmed 覆盖 pending（S1 兜底）/推翻 dismissed（S3）', () => {
    const issue = repo.putIssue(validIssueInput())
    repo.putLink({
      id: 'l-p', issueId: issue.id, recordId: 'rec-7',
      recordDataSource: 'complaint_ticket', ticketId: 'T7',
      linkStatus: 'pending_suggest', linkSource: 'auto_match',
      matchConfidence: 'medium', matchReason: '', matchedExcerpt: '',
      proposedAt: '', reviewedBy: '', reviewedAt: '', createdAt: '2026-11-01T00:00:00Z',
    })
    const up = repo.putLink({
      id: 'l-m', issueId: issue.id, recordId: 'rec-7',
      recordDataSource: 'complaint_ticket', ticketId: 'T7',
      linkStatus: 'confirmed', linkSource: 'manual',
      matchConfidence: '', matchReason: '', matchedExcerpt: '',
      proposedAt: '', reviewedBy: 'u1', reviewedAt: '2026-11-02T00:00:00Z', createdAt: '2026-11-02T00:00:00Z',
    })
    expect(up.action).toBe('upgraded')
    expect(repo.getIssue(issue.id).occurrenceCount).toBe(1)
  })
})

describe('generalizationRepository 队列与 pendingCount', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM generalization_issue_links').run()
    db.prepare('DELETE FROM generalization_issues').run()
  })

  it('listPendingSuggestions 先过滤后分页 + pendingCount breakdown', () => {
    const issue = repo.putIssue(validIssueInput())
    for (const [i, conf] of ['high', 'medium', 'medium'].entries()) {
      repo.putLink({
        id: `q-${i}`, issueId: issue.id, recordId: `rec-q${i}`,
        recordDataSource: 'complaint_ticket', ticketId: `TQ${i}`,
        linkStatus: 'pending_suggest', linkSource: 'auto_match',
        matchConfidence: conf, matchReason: 'r', matchedExcerpt: '',
        proposedAt: '', reviewedBy: '', reviewedAt: '', createdAt: `2026-11-01T00:0${i}:00Z`,
      })
    }
    const page1 = repo.listPendingSuggestions({ page: 1, pageSize: 2 })
    expect(page1.total).toBe(3)
    expect(page1.suggestions).toHaveLength(2)
    expect(page1.suggestions[0].issueTitle).toBe('退订入口难找')
    const breakdown = repo.pendingCount()
    expect(breakdown).toEqual({ total: 3, high: 1, medium: 2, low: 0, hints: 0, hintsHigh: 0, hintsMedium: 0 })
  })

  it('pendingCount 含 G-pass pending hints 分桶（G2-5 横幅第一行数据源）', () => {
    repo.putHint('rec-h1', { status: 'pending', confidence: 'high', category: 'code_logic' })
    repo.putHint('rec-h2', { status: 'pending', confidence: 'medium', category: 'api_doc' })
    repo.putHint('rec-h3', { status: 'pending', confidence: 'medium', category: 'console_ux' })
    repo.putHint('rec-h4', { status: 'dismissed', confidence: 'high' })
    repo.putHint('rec-h5', { status: 'adopted', confidence: 'high' })
    const breakdown = repo.pendingCount()
    expect(breakdown.hints).toBe(3)
    expect(breakdown.hintsHigh).toBe(1)
    expect(breakdown.hintsMedium).toBe(2)
    // links 全零不受影响
    expect(breakdown.total).toBe(0)
  })

  it('reviewSuggestion confirm：pending → confirmed + 计数刷新', () => {
    const issue = repo.putIssue(validIssueInput())
    repo.putLink({
      id: 'rv-1', issueId: issue.id, recordId: 'rec-rv',
      recordDataSource: 'complaint_ticket', ticketId: 'TRV',
      linkStatus: 'pending_suggest', linkSource: 'auto_match',
      matchConfidence: 'medium', matchReason: '', matchedExcerpt: '',
      proposedAt: '', reviewedBy: '', reviewedAt: '', createdAt: '2026-11-01T00:00:00Z',
    })
    const result = repo.reviewSuggestion('rv-1', 'confirm', { actor: { username: 'u1' } })
    expect(result.action).toBe('confirmed')
    expect(repo.getIssue(issue.id).occurrenceCount).toBe(1)
    // 重复处理被拒
    expect(() => repo.reviewSuggestion('rv-1', 'confirm')).toThrow(/已被处理/)
  })

  it('reviewSuggestion new_issue：原建议 dismissed + 新 issue（category/scope 必填）挂宿主记录', () => {
    const issue = repo.putIssue(validIssueInput())
    repo.putLink({
      id: 'rv-2', issueId: issue.id, recordId: 'rec-rv2',
      recordDataSource: 'complaint_ticket', ticketId: 'TRV2',
      linkStatus: 'pending_suggest', linkSource: 'auto_match',
      matchConfidence: 'medium', matchReason: '', matchedExcerpt: '',
      proposedAt: '', reviewedBy: '', reviewedAt: '', createdAt: '2026-11-01T00:00:00Z',
    })
    const result = repo.reviewSuggestion('rv-2', 'new_issue', {
      newIssue: {
        title: '带宽退订失败', summary: '退订按钮点击无响应',
        productKey: 'eip', productName: '弹性公网IP',
        category: 'code_logic', scope: 'cross_product',
      },
      actor: { username: 'u1' },
    })
    expect(result.action).toBe('new_issue')
    expect(result.issue.category).toBe('code_logic')
    expect(result.issue.occurrenceCount).toBe(1)
    expect(repo.getLink('rv-2')?.linkStatus).toBe('dismissed')
    // 已处理守卫：pending → dismissed 后再操作被拒（守卫先于 newIssue 校验）
    expect(() =>
      repo.reviewSuggestion('rv-2', 'new_issue', /** @type {any} */ ({})),
    ).toThrow(/已被处理/)
    // 未处理建议缺 newIssue 被拒
    repo.putLink({
      id: 'rv-3', issueId: issue.id, recordId: 'rec-rv3',
      recordDataSource: 'complaint_ticket', ticketId: 'TRV3',
      linkStatus: 'pending_suggest', linkSource: 'auto_match',
      matchConfidence: 'medium', matchReason: '', matchedExcerpt: '',
      proposedAt: '', reviewedBy: '', reviewedAt: '', createdAt: '2026-11-01T00:00:00Z',
    })
    expect(() => repo.reviewSuggestion('rv-3', 'new_issue')).toThrow(/newIssue/)
  })
})

describe('generalizationRepository 升级通路（from-action）', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM generalization_issue_action_refs').run()
    db.prepare('DELETE FROM generalization_issue_links').run()
    db.prepare('DELETE FROM generalization_issues').run()
  })

  it('createIssueFromAction：新建 + origin + 证据全量挂载（评价被过滤）+ kind=created', () => {
    const result = repo.createIssueFromAction({
      actionItemId: 'act-1',
      issueInput: {
        productKey: 'eip', productName: '弹性公网IP',
        title: '批量删除接口部分失败', summary: '批量删除安全组只成功一半',
        category: 'code_logic', scope: 'multi_scenario',
        optimization: '包裹事务并回滚部分失败',
      },
      evidence: [
        { recordId: 'ev-1', recordDataSource: 'complaint_ticket', ticketId: 'E1' },
        { recordId: 'ev-2', recordDataSource: 'consultation_ticket', ticketId: 'E2' },
        { recordId: 'ev-3', recordDataSource: 'post_use_rating' }, // 评价：必须被过滤
        { recordId: '', recordDataSource: 'complaint_ticket' },    // 空 id：跳过
      ],
      actor: { username: 'u1' },
    })
    expect(result.issue.originActionId).toBe('act-1')
    expect(result.issue.rootCause).toBe('')           // 23:39：不预填
    expect(result.issue.optimization).toBe('包裹事务并回滚部分失败')
    expect(result.evidenceLinked).toBe(2)
    expect(result.evidenceSkipped).toBe(2)
    expect(result.issue.occurrenceCount).toBe(2)
    const refs = repo.listIssuesForAction('act-1')
    expect(refs).toHaveLength(1)
    expect(refs[0].kind).toBe('created')
  })

  it('409 防重（00:07 定稿）：in_progress 升级件存在即拦；completed 允许再升级', () => {
    repo.createIssueFromAction({
      actionItemId: 'act-2',
      issueInput: validIssueInput({ title: 'A 问题' }),
      evidence: [],
    })
    // in_progress 存在 → 拦
    expect(() =>
      repo.createIssueFromAction({
        actionItemId: 'act-2',
        issueInput: validIssueInput({ title: 'B 问题' }),
        evidence: [],
      }),
    ).toThrow(/不能重复升级/)
    // 终态后允许再升级（开新一轮）
    const [existing] = repo.listIssuesForAction('act-2')
    repo.updateIssue(existing.issueId, { status: 'completed' })
    const again = repo.createIssueFromAction({
      actionItemId: 'act-2',
      issueInput: validIssueInput({ title: 'C 问题（新一轮）' }),
      evidence: [],
    })
    expect(again.issue.title).toContain('新一轮')
    expect(repo.listIssuesForAction('act-2')).toHaveLength(2)
  })

  it('linkIssueToAction：关联已有 in_progress issue + kind=linked + 证据挂载；终态 issue 拒绝关联', () => {
    const issue = repo.putIssue(validIssueInput({ title: '已有问题' }))
    const result = repo.linkIssueToAction({
      actionItemId: 'act-3',
      issueId: issue.id,
      evidence: [{ recordId: 'ev-9', recordDataSource: 'complaint_ticket', ticketId: 'E9' }],
      actor: { username: 'u1' },
    })
    expect(result.issue.occurrenceCount).toBe(1)
    const refs = repo.listIssuesForAction('act-3')
    expect(refs[0].kind).toBe('linked')

    // 终态 issue 不允许被升级关联
    const done = repo.putIssue(validIssueInput({ title: '已完成问题' }))
    repo.updateIssue(done.id, { status: 'completed' })
    expect(() =>
      repo.linkIssueToAction({ actionItemId: 'act-4', issueId: done.id, evidence: [] }),
    ).toThrow(/进行中/)
  })

  it('listActionRefsForIssue：中间表反查 + 举措删除后 actionExists=false（实时解析不快照）', () => {
    const issue = repo.putIssue(validIssueInput())
    db.prepare(
      `INSERT INTO generalization_issue_action_refs (issue_id, action_item_id, kind, created_at)
       VALUES (?, 'act-ghost', 'created', '2026-11-01T00:00:00Z')`,
    ).run(issue.id) // act-ghost 不存在于 action_items
    const refs = repo.listActionRefsForIssue(issue.id)
    expect(refs).toHaveLength(1)
    expect(refs[0].actionExists).toBe(false) // LEFT JOIN 空 → 已删除降级
    expect(refs[0].actionTitle).toBe('')
  })
})

describe('generalizationRepository hints 三态流转', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM generalization_hints').run()
    db.prepare('DELETE FROM generalization_issue_links').run()
    db.prepare('DELETE FROM generalization_issues').run()
    db.prepare('DELETE FROM records').run()
  })

  it('putHint/getHint upsert + promptVersion 落库', () => {
    repo.putHint('rec-1', {
      suggested: 'yes', category: 'api_doc', scope: 'multi_scenario',
      confidence: 'medium', reason: '文档遗漏', status: 'pending',
      promptVersion: 'g1',
    })
    const h = repo.getHint('rec-1')
    expect(h.status).toBe('pending')
    expect(h.promptVersion).toBe('g1')
    // upsert 覆盖
    repo.putHint('rec-1', { status: 'dismissed' })
    expect(repo.getHint('rec-1').status).toBe('dismissed')
  })

  it('decideHint dismiss：pending → dismissed（忽略记忆）', () => {
    repo.putHint('rec-2', { suggested: 'yes', status: 'pending' })
    const { hint } = repo.decideHint('rec-2', 'dismiss', { actor: { username: 'u1' } })
    expect(hint.status).toBe('dismissed')
    // 非 pending 再处理被拒
    expect(() => repo.decideHint('rec-2', 'dismiss')).toThrow(/没有待处理/)
  })

  it('decideHint adopt：新建 issue（预填 category/scope）+ 首条 link + adopted 回链', () => {
    // 种子宿主记录
    db.prepare(`INSERT INTO records (id, payload) VALUES ('rec-3', ?)`).run(
      JSON.stringify({
        id: 'rec-3', ticketId: 'TH1', productKey: 'eip', product: '弹性公网IP',
        dataSourceType: 'complaint_ticket', requestScene: '退订', painPoint: '退订入口找不到',
      }),
    )
    repo.putHint('rec-3', {
      suggested: 'yes', category: 'console_ux', scope: 'multi_scenario',
      confidence: 'medium', reason: '控制台路径过深', status: 'pending',
    })
    const { hint, issue } = repo.decideHint('rec-3', 'adopt', { actor: { username: 'u1' } })
    expect(hint.status).toBe('adopted')
    expect(hint.adoptedToIssueId).toBe(issue.id)
    expect(issue.category).toBe('console_ux')
    expect(issue.occurrenceCount).toBe(1)
    expect(repo.listLinksByRecord('rec-3')).toHaveLength(1)
  })

  it('decideHint adopt：宿主记录缺失被拒', () => {
    repo.putHint('rec-ghost', { suggested: 'yes', status: 'pending' })
    expect(() => repo.decideHint('rec-ghost', 'adopt')).toThrow(/宿主记录/)
  })
})

describe('generalizationRepository listIssues 筛选与分页', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM generalization_issue_links').run()
    db.prepare('DELETE FROM generalization_issues').run()
  })

  it('category/scope/status/keyword/反查筛选 + 先过滤后分页', () => {
    repo.putIssue(validIssueInput({ title: '甲问题' }))
    repo.putIssue(validIssueInput({ title: '乙问题', category: 'api_doc', scope: 'cross_product' }))
    repo.putIssue(validIssueInput({ title: '丙问题', category: 'api_doc', scope: 'multi_scenario' }))
    expect(repo.listIssues({ category: 'api_doc' }).total).toBe(2)
    expect(repo.listIssues({ scope: 'cross_product' }).total).toBe(1)
    expect(repo.listIssues({ keyword: '乙' }).total).toBe(1)
    expect(repo.listIssues({ status: 'in_progress' }).total).toBe(3)
    // actionItemId 反查（中间表 JOIN）
    const target = repo.putIssue(validIssueInput({ title: '丁问题' }))
    db.prepare(
      `INSERT INTO generalization_issue_action_refs (issue_id, action_item_id, kind, created_at)
       VALUES (?, 'act-x', 'created', '2026-11-01T00:00:00Z')`,
    ).run(target.id)
    const byAction = repo.listIssues({ actionItemId: 'act-x' })
    expect(byAction.total).toBe(1)
    expect(byAction.issues[0].title).toBe('丁问题')
    // 分页
    const page = repo.listIssues({ page: 1, pageSize: 2 })
    expect(page.total).toBe(4)
    expect(page.issues).toHaveLength(2)
    expect(page.pageSize).toBe(2)
  })

  it('findSimilarIssues：同产品 in_progress 轻量字面去重提示', () => {
    repo.putIssue(validIssueInput({ title: '退订入口难找' }))
    const hits = repo.findSimilarIssues({ title: '退订入口找不到', productKey: 'eip' })
    expect(hits.length).toBeGreaterThanOrEqual(1)
    expect(hits[0].title).toContain('退订')
    // 无相似时空数组
    expect(repo.findSimilarIssues({ title: '完全无关词汇', productKey: 'eip' })).toEqual([])
  })
})
