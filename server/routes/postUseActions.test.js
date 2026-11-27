import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-post-use-actions-api-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-post-use-actions'
process.env.CORS_ORIGINS = 'http://127.0.0.1:5175'

let sqliteAvailable = false
try {
  const { closeDb, getDb } = await import('../db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

const describeApi = sqliteAvailable ? describe : describe.skip

describeApi('post-use multiple actions API', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app
  let traceId
  let legacyActionId
  let editorToken
  let viewerToken
  let adminToken

  const editorHeaders = () => ({ authorization: `Bearer ${editorToken}` })
  const viewerHeaders = () => ({ authorization: `Bearer ${viewerToken}` })
  const adminHeaders = () => ({ authorization: `Bearer ${adminToken}` })

  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'action_editor', password: 'EditorPass12345!', team: '产品运营组', role: 'editor',
    })
    const viewer = await createUser({
      username: 'action_viewer', password: 'ViewerPass12345!', team: '产品运营组', role: 'viewer',
    })
    const admin = await createUser({
      username: 'action_admin', password: 'AdminPass12345!', team: '产品运营组', role: 'admin',
    })
    editorToken = signAccessToken(editor)
    viewerToken = signAccessToken(viewer)
    adminToken = signAccessToken(admin)

    const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
    traceId = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-C1:云专线:2026-10', importMonth: '2026-10',
      productName: '云专线', customerName: '举措客户A', customerCode: 'ACTION-C1',
    }])[0].id
    const legacyTrace = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-OLD:云专线:2026-09', importMonth: '2026-09',
      productName: '云专线', customerName: '旧关联客户', customerCode: 'ACTION-OLD',
    }])[0]
    const { validateActionItemCreate } = await import('../../src/domain/actionItem.js')
    const { actionItemRepository } = await import('../actionItemRepository.js')
    const validated = validateActionItemCreate({ content: '旧版回访举措' })
    if (!validated.ok) throw new Error(validated.error)
    const { source: _legacySource, ...legacyItem } = validated.item
    actionItemRepository.putActionItem(legacyItem)
    legacyActionId = legacyItem.id
    postUseJiraRepository.patch(legacyTrace.id, { actionId: legacyActionId })
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta('post_use_visit_records_v1', {
      version: 1,
      records: [{
        id: 'action-visit-1', importMonth: '2026-10', visitMonth: '2026-10',
        productName: '云专线', customerName: '举措客户B', customerCode: 'ACTION-C2',
        actionIds: [], actionId: '', updatedAt: '2026-10-01T00:00:00.000Z',
      }],
    })

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPostUseActionRoutes } = await import('./postUseActions.js')
    const { registerActionRoutes } = await import('./actions.js')
    app = Fastify()
    registerAuthHooks(app)
    registerActionRoutes(app)
    registerPostUseActionRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
  })

  it('adds two actions, reuses one on a visit, and removes only one link', async () => {
    const url = `/api/post-use-actions/trace/${traceId}`
    const first = await app.inject({
      method: 'POST', url, headers: editorHeaders(),
      payload: { newAction: { content: '完善开通校验', detail: '补充错误提示' } },
    })
    expect(first.statusCode).toBe(200)
    const firstId = first.json().action.id
    expect(first.json().item.actionIds).toEqual([firstId])
    expect(first.json().item.actionId).toBe(firstId)

    const second = await app.inject({
      method: 'POST', url, headers: editorHeaders(),
      payload: { newAction: { content: '增加告警', scheduleAt: '2026-12-15' } },
    })
    expect(second.statusCode).toBe(200)
    const secondId = second.json().action.id
    expect(second.json().item.actionIds).toEqual([firstId, secondId])
    expect(second.json().item.actionId).toBe(firstId)

    const duplicate = await app.inject({
      method: 'POST', url, headers: editorHeaders(), payload: { actionId: firstId },
    })
    expect(duplicate.statusCode, duplicate.body).toBe(200)
    expect(duplicate.json().item.actionIds).toEqual([firstId, secondId])

    const visit = await app.inject({
      method: 'POST', url: '/api/post-use-actions/visit/action-visit-1',
      headers: editorHeaders(), payload: { actionId: firstId },
    })
    expect(visit.statusCode).toBe(200)
    const visitSecond = await app.inject({
      method: 'POST', url: '/api/post-use-actions/visit/action-visit-1',
      headers: editorHeaders(), payload: { actionId: secondId },
    })
    expect(visitSecond.statusCode).toBe(200)
    expect(visitSecond.json().item.actionIds).toEqual([firstId, secondId])
    expect(visit.json().item).toMatchObject({
      actionIds: [firstId],
      manualEditedFields: expect.arrayContaining(['actionIds']),
      fieldEditMeta: { actionIds: { username: 'action_editor' } },
    })

    const { executeCustomerVisitImport } = await import('../../src/lib/postUseRating/customerVisitImport.js')
    const { storageRepository } = await import('../storageRepository.js')
    await executeCustomerVisitImport({
      adapter: {
        getMeta: async (key) => storageRepository.getMeta(key),
        putMeta: async (key, value) => { storageRepository.putMeta(key, value) },
      },
      rows: [{
        数据月份: '2026-10', 产品名称: '云专线', 客户名称: '举措客户B',
        客户编码: 'ACTION-C2', 回访结果: '重新导入的回访结果',
      }],
      importMonth: '2026-10', libraryRecords: [], updateRecords: async () => {},
    })
    const importedVisit = storageRepository.getMeta('post_use_visit_records_v1').records[0]
    expect(importedVisit.actionIds).toEqual([firstId, secondId])
    expect(importedVisit.fieldEditMeta.actionIds.username).toBe('action_editor')

    const linked = await app.inject({
      method: 'GET', url: `/api/post-use-actions/linked/${firstId}`, headers: viewerHeaders(),
    })
    expect(linked.json().traces.map((item) => item.id)).toContain(traceId)
    expect(linked.json().visits.map((item) => item.id)).toContain('action-visit-1')
    // 2026-11-25 拍板：删除限制放开——被溯源/回访关联的举措也可删（前端二次确认兜底），
    // 删除时联动摘除全部 actionIds 引用（防详情抽屉出现 missing 悬挂）
    const deleteRes = await app.inject({
      method: 'DELETE', url: `/api/actions/${firstId}`, headers: adminHeaders(),
    })
    expect(deleteRes.statusCode).toBe(200)

    const { actionItemRepository } = await import('../actionItemRepository.js')
    expect(actionItemRepository.getActionItem(firstId)).toBeNull()
    const after = await app.inject({
      method: 'GET', url: `/api/post-use-actions/linked/${firstId}`, headers: viewerHeaders(),
    })
    expect(after.json().traces).toHaveLength(0)
    expect(after.json().visits).toHaveLength(0)
    // trace/visit 上的其余举措关联（secondId）不受牵连——反向查证 secondId 的关联方仍在
    const secondLinked = await app.inject({
      method: 'GET', url: `/api/post-use-actions/linked/${secondId}`, headers: viewerHeaders(),
    })
    expect(secondLinked.json().traces.map((item) => item.id)).toContain(traceId)
    expect(secondLinked.json().visits.map((item) => item.id)).toContain('action-visit-1')

    const removed = await app.inject({
      method: 'DELETE', url: `${url}/${firstId}`, headers: editorHeaders(),
    })
    expect(removed.statusCode).toBe(200)
    expect(removed.json().item.actionIds).toEqual([secondId])

    const visitUrl = '/api/post-use-actions/visit/action-visit-1'
    for (const id of [firstId, secondId]) {
      const unlinked = await app.inject({
        method: 'DELETE', url: `${visitUrl}/${id}`, headers: editorHeaders(),
      })
      expect(unlinked.statusCode).toBe(200)
    }
    const cleared = storageRepository.getMeta('post_use_visit_records_v1').records[0]
    expect(cleared.actionIds).toEqual([])
    expect(cleared.actionId).toBe('')
    await executeCustomerVisitImport({
      adapter: {
        getMeta: async (key) => storageRepository.getMeta(key),
        putMeta: async (key, value) => { storageRepository.putMeta(key, value) },
      },
      rows: [{
        数据月份: '2026-10', 产品名称: '云专线', 客户名称: '举措客户B',
        客户编码: 'ACTION-C2', 回访结果: '再次导入的回访结果',
      }],
      importMonth: '2026-10', libraryRecords: [], updateRecords: async () => {},
    })
    const reimported = storageRepository.getMeta('post_use_visit_records_v1').records[0]
    expect(reimported.actionIds).toEqual([])
    expect(reimported.actionId).toBe('')
    expect(reimported.manualEditedFields).toContain('actionIds')
  })

  it('allows read-only viewing but rejects edits by viewers', async () => {
    const url = `/api/post-use-actions/trace/${traceId}`
    const read = await app.inject({ method: 'GET', url, headers: viewerHeaders() })
    expect(read.statusCode).toBe(200)
    expect(read.json().items).toHaveLength(1)
    const write = await app.inject({
      method: 'POST', url, headers: viewerHeaders(), payload: { newAction: { content: '无权限' } },
    })
    expect(write.statusCode).toBe(403)
  })

  it('migrates legacy single links and restores their post-use source', async () => {
    const { actionItemRepository } = await import('../actionItemRepository.js')
    expect(actionItemRepository.getActionItem(legacyActionId)?.source).toBe('post_use')
    const list = await app.inject({
      method: 'GET', url: '/api/actions?sources=post_use', headers: viewerHeaders(),
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().items.map((item) => item.id)).toContain(legacyActionId)
  })

  it('new action stores catalog product key when catalog is loaded (11-18 写入口径)', async () => {
    // 11-18 写入口径修正链路验证：注入 managed 目录 → POST newAction（trace 产品名=云专线）
    // → 路由刷新缓存 + service 解析 → 落库 product_key 应为目录 key dc（旧口径为中文名）。
    // 真实链路证据（04 §2）：走完整路由而非直调 resolve 函数。
    // 注：目录刷新会经 ensureTargetProductsInCatalog 自动补种子产品（dc 必在），
    // 注入是为了让本用例不依赖种子行为；测试库本用例独享，结束不恢复全局目录。
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta('product_catalog_managed_v1', {
      version: 1, updatedAt: 't', products: [
        { key: 'dc', name: '云专线', enabled: true, specs: [] },
      ], deletedKeys: [], disabledAnalysisKeys: [],
    })

    const url = `/api/post-use-actions/trace/${traceId}`
    const created = await app.inject({
      method: 'POST', url, headers: editorHeaders(),
      payload: { newAction: { content: '口径修正链路验证举措' } },
    })
    expect(created.statusCode, created.body).toBe(200)
    const createdId = created.json().action.id
    expect(created.json().action.productKey).toBe('dc')
    expect(created.json().action.productName).toBe('云专线')

    // 落库 payload 双通道（productKey/productName）经 repository 读回验证——迁移脚本的同步写口径
    const { actionItemRepository } = await import('../actionItemRepository.js')
    const item = actionItemRepository.getActionItem(createdId)
    expect(item?.productKey).toBe('dc')
    expect(item?.productName).toBe('云专线')

    // 清理：移除该关联与举措行（构造型身份唯一纪律——不残留影响其他用例）
    const removed = await app.inject({
      method: 'DELETE', url: `${url}/${createdId}`, headers: editorHeaders(),
    })
    expect(removed.statusCode).toBe(200)
    const { getDb } = await import('../db.js')
    getDb().prepare('DELETE FROM action_items WHERE id = ?').run(createdId)
  })

  it('new action falls back to raw product name when catalog misses (旧口径兜底)', async () => {
    // 兜底路径：owner 产品名不在目录（自定义产品）→ 原样写入，不阻断业务。
    // 注意：种子目标产品（云专线/dc 等）会在目录刷新时被 ensureTargetProductsInCatalog
    // 自动补回，不能用来构造"不在目录"场景——用真实自定义产品名。
    const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
    const customTrace = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-CUSTOM-X:自定义神秘产品:2026-10', importMonth: '2026-10',
      productName: '自定义神秘产品', customerName: '兜底客户', customerCode: 'ACTION-CUSTOM-X',
    }])[0]

    const created = await app.inject({
      method: 'POST', url: `/api/post-use-actions/trace/${customTrace.id}`, headers: editorHeaders(),
      payload: { newAction: { content: '兜底口径验证举措' } },
    })
    expect(created.statusCode, created.body).toBe(200)
    expect(created.json().action.productKey).toBe('自定义神秘产品')

    // 清理
    const createdId = created.json().action.id
    await app.inject({
      method: 'DELETE', url: `/api/post-use-actions/trace/${customTrace.id}/${createdId}`,
      headers: editorHeaders(),
    })
    const { getDb } = await import('../db.js')
    getDb().prepare('DELETE FROM action_items WHERE id = ?').run(createdId)
    getDb().prepare('DELETE FROM post_use_jira_items WHERE id = ?').run(customTrace.id)
  })

  it('new action carries owner customer feedback as painPointSnapshot (11-27 问题字段带过来)', async () => {
    // 真实链路（04 §2）：trace 带 customerFeedback → POST newAction → 落库 painPointSnapshot。
    // 身份全库唯一（11 规则 §11）：独立 itemKey/产品名，不与前用例共用。
    const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
    const feedbackTrace = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-PAIN-FB:神秘产品FB:2026-10', importMonth: '2026-10',
      productName: '神秘产品FB', customerName: '反馈客户', customerCode: 'ACTION-PAIN-FB',
      customerFeedback: '7分以下分布：神秘产品FB*1分*1次；反馈原因：功能有缺失（1）',
    }])[0]

    const created = await app.inject({
      method: 'POST', url: `/api/post-use-actions/trace/${feedbackTrace.id}`, headers: editorHeaders(),
      payload: { newAction: { content: '问题快照验证举措' } },
    })
    expect(created.statusCode, created.body).toBe(200)
    const createdId = created.json().action.id
    // 响应与落库 payload 双通道断言（11-18 用例先例）
    expect(created.json().action.painPointSnapshot).toBe(
      '7分以下分布：神秘产品FB*1分*1次；反馈原因：功能有缺失（1）')
    const { actionItemRepository } = await import('../actionItemRepository.js')
    expect(actionItemRepository.getActionItem(createdId)?.painPointSnapshot).toBe(
      '7分以下分布：神秘产品FB*1分*1次；反馈原因：功能有缺失（1）')

    // 空反馈路径：customerFeedback 缺失的 owner → 问题保持空，不造占位文案
    const silentTrace = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-PAIN-SILENT:神秘产品FB:2026-10', importMonth: '2026-10',
      productName: '神秘产品FB', customerName: '沉默客户', customerCode: 'ACTION-PAIN-SILENT',
    }])[0]
    const silent = await app.inject({
      method: 'POST', url: `/api/post-use-actions/trace/${silentTrace.id}`, headers: editorHeaders(),
      payload: { newAction: { content: '空反馈验证举措' } },
    })
    expect(silent.statusCode, silent.body).toBe(200)
    expect(silent.json().action.painPointSnapshot).toBe('')
    const silentId = silent.json().action.id

    // visit 路径：owner 字段名不同（userFeedbackText），显式分支验证
    const { storageRepository } = await import('../storageRepository.js')
    const visitMeta = storageRepository.getMeta('post_use_visit_records_v1')
    storageRepository.putMeta('post_use_visit_records_v1', {
      ...visitMeta,
      records: [...visitMeta.records, {
        id: 'action-visit-pain-fb', importMonth: '2026-10', visitMonth: '2026-10',
        productName: '神秘产品FB', customerName: '回访反馈客户', customerCode: 'ACTION-PAIN-VISIT',
        userFeedbackText: '客户反馈原文：批量导出缺入口',
        actionIds: [], actionId: '', updatedAt: '2026-10-01T00:00:00.000Z',
      }],
    })
    const visitCreated = await app.inject({
      method: 'POST', url: '/api/post-use-actions/visit/action-visit-pain-fb',
      headers: editorHeaders(), payload: { newAction: { content: '回访问题快照验证举措' } },
    })
    expect(visitCreated.statusCode, visitCreated.body).toBe(200)
    expect(visitCreated.json().action.painPointSnapshot).toBe('客户反馈原文：批量导出缺入口')
    const visitCreatedId = visitCreated.json().action.id

    // 清理：移除关联行与举措行（构造型身份唯一纪律）
    const { getDb } = await import('../db.js')
    await app.inject({
      method: 'DELETE', url: `/api/post-use-actions/trace/${feedbackTrace.id}/${createdId}`,
      headers: editorHeaders(),
    })
    await app.inject({
      method: 'DELETE', url: `/api/post-use-actions/trace/${silentTrace.id}/${silentId}`,
      headers: editorHeaders(),
    })
    await app.inject({
      method: 'DELETE', url: `/api/post-use-actions/visit/action-visit-pain-fb/${visitCreatedId}`,
      headers: editorHeaders(),
    })
    for (const id of [createdId, silentId, visitCreatedId]) {
      getDb().prepare('DELETE FROM action_items WHERE id = ?').run(id)
    }
    getDb().prepare('DELETE FROM post_use_jira_items WHERE id IN (?, ?)').run(feedbackTrace.id, silentTrace.id)
    const afterVisitMeta = storageRepository.getMeta('post_use_visit_records_v1')
    storageRepository.putMeta('post_use_visit_records_v1', {
      ...afterVisitMeta,
      records: afterVisitMeta.records.filter((row) => row.id !== 'action-visit-pain-fb'),
    })
  })

  it('library link backfills empty painPointSnapshot even when legacy links exist (11-27 fill-if-empty 二次修复)', async () => {
    // 选库路径 fill-if-empty 补齐（二次修复）：存量举措带旧关联（修复前建的，
    // 问题为空）从举措库选它关联新溯源记录时也必须补齐——首版"无任何关联才补"
    // 条件过严，部署库实测永不命中。已有值不覆盖。身份全库唯一。
    const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
    const { validateActionItemCreate } = await import('../../src/domain/actionItem.js')
    const { actionItemRepository } = await import('../actionItemRepository.js')

    // 存量形态：修复前建的举措，问题为空，且已带旧溯源关联（直接 patch actionIds 模拟）
    const validated = validateActionItemCreate({ content: '选库补齐验证举措', source: 'post_use' })
    if (!validated.ok) throw new Error(validated.error)
    actionItemRepository.putActionItem(validated.item)
    const libraryId = validated.item.id
    const legacyTrace = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-LINK-LEGACY:神秘产品LK:2026-09', importMonth: '2026-09',
      productName: '神秘产品LK', customerName: '旧关联客户', customerCode: 'ACTION-LINK-LEGACY',
      customerFeedback: '反馈原因：旧关联的反馈',
    }])[0]
    postUseJiraRepository.patch(legacyTrace.id, { actionId: libraryId })

    // fill-if-empty：带旧关联的空问题举措关联新溯源 → 从本次 owner 客户反馈补齐
    const traceA = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-LINK-FB-A:神秘产品LK:2026-10', importMonth: '2026-10',
      productName: '神秘产品LK', customerName: '选库客户A', customerCode: 'ACTION-LINK-FB-A',
      customerFeedback: '反馈原因：控制台找不到退订入口（1）',
    }])[0]
    const first = await app.inject({
      method: 'POST', url: `/api/post-use-actions/trace/${traceA.id}`, headers: editorHeaders(),
      payload: { actionId: libraryId },
    })
    expect(first.statusCode, first.body).toBe(200)
    expect(first.json().action.painPointSnapshot).toBe('反馈原因：控制台找不到退订入口（1）')
    expect(actionItemRepository.getActionItem(libraryId)?.painPointSnapshot).toBe(
      '反馈原因：控制台找不到退订入口（1）')

    // 二次关联（另一 owner）：问题已有值不覆盖
    const traceB = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-LINK-FB-B:神秘产品LK:2026-10', importMonth: '2026-10',
      productName: '神秘产品LK', customerName: '选库客户B', customerCode: 'ACTION-LINK-FB-B',
      customerFeedback: '反馈原因：另一个不相关的反馈（2）',
    }])[0]
    const second = await app.inject({
      method: 'POST', url: `/api/post-use-actions/trace/${traceB.id}`, headers: editorHeaders(),
      payload: { actionId: libraryId },
    })
    expect(second.statusCode, second.body).toBe(200)
    expect(second.json().action.painPointSnapshot).toBe('反馈原因：控制台找不到退订入口（1）')

    // 清理
    for (const trace of [legacyTrace, traceA, traceB]) {
      await app.inject({
        method: 'DELETE', url: `/api/post-use-actions/trace/${trace.id}/${libraryId}`,
        headers: editorHeaders(),
      })
    }
    const { getDb } = await import('../db.js')
    getDb().prepare('DELETE FROM action_items WHERE id = ?').run(libraryId)
    const ids = [legacyTrace.id, traceA.id, traceB.id]
    getDb().prepare(`DELETE FROM post_use_jira_items WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
  })

  it('backfill writeback must not persist derived enrichment fields (11-27 污染守卫)', async () => {
    // 11-27 验证轮发现：getActionItem 返回 enriched 形态（requirementLinkMode/
    // requirementTickets/derivedStatus/derivedWarningLevel），补齐若直接 {...action} 展开
    // 写回会把派生字段持久化进 payload——先例 unlinkTicketsFromActionItems（domain 层
    // 重建对象）无此问题。守卫：补齐后原始 payload 不得新增派生键。身份全库唯一。
    const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
    const { validateActionItemCreate } = await import('../../src/domain/actionItem.js')
    const { actionItemRepository } = await import('../actionItemRepository.js')
    const { getDb } = await import('../db.js')

    const validated = validateActionItemCreate({
      content: '污染守卫验证举措', source: 'post_use',
      linkedRequirementTicketIds: ['REQ-GUARD-1127'],
    })
    if (!validated.ok) throw new Error(validated.error)
    actionItemRepository.putActionItem(validated.item)
    const guardId = validated.item.id
    const beforeKeys = new Set(Object.keys(JSON.parse(
      getDb().prepare('SELECT payload FROM action_items WHERE id = ?').get(guardId).payload,
    )))

    const guardTrace = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-GUARD-PT:神秘产品PT:2026-10', importMonth: '2026-10',
      productName: '神秘产品PT', customerName: '守卫客户', customerCode: 'ACTION-GUARD-PT',
      customerFeedback: '反馈原因：污染守卫用例反馈（1）',
    }])[0]
    const res = await app.inject({
      method: 'POST', url: `/api/post-use-actions/trace/${guardTrace.id}`, headers: editorHeaders(),
      payload: { actionId: guardId },
    })
    expect(res.statusCode, res.body).toBe(200)
    expect(res.json().action.painPointSnapshot).toBe('反馈原因：污染守卫用例反馈（1）')

    const afterPayload = JSON.parse(
      getDb().prepare('SELECT payload FROM action_items WHERE id = ?').get(guardId).payload,
    )
    const polluted = Object.keys(afterPayload).filter(
      (k) => !beforeKeys.has(k)
        && ['requirementLinkMode', 'requirementTickets', 'derivedStatus', 'derivedWarningLevel'].includes(k),
    )
    expect(polluted, `补齐写回污染了 payload: ${polluted.join(',')}`).toEqual([])

    // 清理
    await app.inject({
      method: 'DELETE', url: `/api/post-use-actions/trace/${guardTrace.id}/${guardId}`,
      headers: editorHeaders(),
    })
    getDb().prepare('DELETE FROM action_items WHERE id = ?').run(guardId)
    getDb().prepare('DELETE FROM post_use_jira_items WHERE id = ?').run(guardTrace.id)
  })
})
