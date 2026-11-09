import fs from 'node:fs'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../lib/mailClient.js', () => ({
  createMailChannel: vi.fn(),
  createMailGroup: vi.fn(),
  createMailTemplate: vi.fn(),
  deleteMailChannel: vi.fn(),
  deleteMailGroup: vi.fn(),
  deleteMailTemplate: vi.fn(),
  loadMailStatus: vi.fn(async () => ({
    publicAppUrl: 'https://x.example.com',
    channels: [],
    groups: [],
    templates: [],
  })),
  saveMailPublicUrl: vi.fn(),
  updateMailChannel: vi.fn(),
  updateMailGroup: vi.fn(),
  updateMailTemplate: vi.fn(),
}))

import MailSettingsPanel from './MailSettingsPanel.jsx'

const source = fs.readFileSync(new URL('./MailSettingsPanel.jsx', import.meta.url), 'utf8')

/**
 * 守卫（2026-11-09 收件人群组 cc 支持，拍板：收件人必填非空、抄送人可空）：
 * ① 真渲染：群组表格表头须含「收件人/抄送人」两列（renderToStaticMarkup 不跑
 *    useEffect，数据行为空——列头是静态 columns 定义，可验证）；
 * ② 源码结构断言：弹窗表单 cc 字段无 required（可空）、emails 有 required +
 *    openGroup/saveGroup 的 cc 读写链路存在（弹窗交互需真机确认）。
 */
describe('MailSettingsPanel 收件人群组 cc', () => {
  it('群组表格表头含「收件人」「抄送人」两列（真渲染空态）', () => {
    const html = renderToStaticMarkup(<MailSettingsPanel canEdit />)
    expect(html).toContain('收件人')
    expect(html).toContain('抄送人')
  })

  it('弹窗表单：收件人必填、抄送人可空，openGroup/saveGroup 含 cc 链路', () => {
    // 表单结构：emails required + cc 无 required
    const emailsItem = source.match(/name="emails"[^/]*?label="收件人"[^>]*>?/)
    expect(source).toContain('name="emails" label="收件人" rules={[{ required: true }]}')
    expect(source).toContain('name="cc" label="抄送人">')
    expect(source).not.toContain('name="cc" label="抄送人" rules')
    // openGroup 回填 cc、saveGroup 提交 cc
    expect(source).toContain("cc: (item?.cc || []).join('\\n')")
    expect(source).toContain('cc: splitEmails(values.cc)')
    // 表格列 dataIndex 指向 cc
    expect(source).toContain(`{ title: '抄送人', dataIndex: 'cc',`)
  })

  it('发信通道弹窗：label 为「授权码」，新建必填、编辑非必填，含获取提示', () => {
    // 2026-11-09 拍板：密码→授权码；新建 required、编辑留空保持原授权码；提示从邮箱原生客户端/网页版获取
    expect(source).not.toContain('label="密码"')
    expect(source).toContain('label="授权码"')
    expect(source).toContain("rules={editingChannel ? [] : [{ required: true, message: '请填写授权码' }]}")
    // 编辑态提示留空保持原值；新建态 placeholder
    expect(source).toContain("'留空则保持原授权码'")
    // 获取方式提示
    expect(source).toContain('从相应邮箱的原生客户端或网页版设置中获取（非登录密码）')
  })
})
