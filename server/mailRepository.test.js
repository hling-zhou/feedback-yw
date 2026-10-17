import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-mail-repo-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-mail-repo-xx'

const sqliteOk = await (async () => {
  try {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    closeDb()
    return true
  } catch {
    return false
  }
})()

const describeRepo = sqliteOk ? describe : describe.skip

describeRepo('mailRepository', () => {
  /** @type {typeof import('./mailRepository.js')} */
  let repo
  /** @type {typeof import('./db.js').getDb} */
  let getDb

  beforeAll(async () => {
    const dbMod = await import('./db.js')
    dbMod.closeDb()
    getDb = dbMod.getDb
    getDb()
    repo = await import('./mailRepository.js')
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    const db = getDb()
    db.exec('DELETE FROM mail_channels')
    db.exec('DELETE FROM mail_recipient_groups')
    db.exec('DELETE FROM mail_templates')
    db.exec("DELETE FROM meta WHERE key = 'mail_public_app_url'")
  })

  it('seeds preset templates that can be edited but not deleted', () => {
    const templates = repo.listMailTemplates()
    expect(templates.map((item) => item.id).sort()).toEqual(['callback_visit_list', 'post_use_report'])
    const updated = repo.updateMailTemplate('post_use_report', { subject: '自定义主题 {周期键}' })
    expect(updated.subject).toBe('自定义主题 {周期键}')
    expect(updated.preset).toBe(true)
    expect(() => repo.deleteMailTemplate('post_use_report')).toThrow(/不能删除/)
  })

  it('stores recipient groups without a data source and keeps emails as the only members', () => {
    const group = repo.createMailGroup({
      name: '客服',
      emails: ['a@x.com', 'b@x.com', 'a@x.com'],
    })
    expect(group).not.toHaveProperty('dataSourceType')
    expect(group.emails).toEqual(['a@x.com', 'b@x.com'])
  })

  it('keeps SMTP passwords server-side and one channel per data source', () => {
    const created = repo.createMailChannel({
      name: '用后即评',
      dataSourceType: 'post_use_rating',
      host: 'smtp.example.com',
      fromAddress: 'from@example.com',
      username: 'from@example.com',
      password: 'secret-pass',
    })
    expect(created.hasPassword).toBe(true)
    expect(created).not.toHaveProperty('password')
    expect(() =>
      repo.createMailChannel({
        name: '重复',
        dataSourceType: 'post_use_rating',
        host: 'smtp.example.com',
        fromAddress: 'other@example.com',
      }),
    ).toThrow(/已有发信通道/)

    const complaint = repo.createMailChannel({
      name: '投诉',
      dataSourceType: 'complaint_ticket',
      host: 'smtp.complaint.example',
      fromAddress: 'complaint@example.com',
      password: 'other-secret',
    })
    expect(complaint.dataSourceType).toBe('complaint_ticket')
    expect(repo.getMailChannelByDataSource('post_use_rating').password).toBe('secret-pass')
    expect(repo.getMailChannelByDataSource('complaint_ticket').fromAddress).toBe('complaint@example.com')

    const kept = repo.updateMailChannel(created.id, { name: '用后即评通道', password: '' })
    expect(kept.name).toBe('用后即评通道')
    expect(repo.getMailChannelByDataSource('post_use_rating').password).toBe('secret-pass')
  })
})
