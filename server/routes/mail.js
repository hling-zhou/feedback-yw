import { requirePermission } from '../middleware.js'
import { hasPermission } from '../../src/domain/auth/permissions.js'
import { logAuditFromRequest } from '../audit.js'
import { uuidParamSchema } from '../schemas/common.js'
import {
  mailChannelBodySchema,
  mailChannelPatchSchema,
  mailGroupBodySchema,
  mailPublicUrlBodySchema,
  mailSendBodySchema,
  mailTemplateBodySchema,
} from '../schemas/mailSchemas.js'
import { canUsePostUseCallbackList } from '../../src/domain/auth/permissions.js'
import {
  applyMailPlaceholders,
  assertEmailList,
  MAIL_MAX_ATTACHMENT_BYTES,
  MAIL_PRESET_CALLBACK_VISIT,
  MAIL_PRESET_REPORT,
  resolveMailContentUrl,
  uniqueEmails,
} from '../../src/domain/mail.js'
import { sendSmtpMail } from '../mail/smtp.js'
import {
  createMailChannel,
  createMailGroup,
  createMailTemplate,
  deleteMailChannel,
  deleteMailGroup,
  deleteMailTemplate,
  ensureMailDefaults,
  getMailChannelByDataSource,
  getMailTemplate,
  getPublicAppUrl,
  listMailChannels,
  listMailGroups,
  listMailTemplates,
  setPublicAppUrl,
  updateMailChannel,
  updateMailGroup,
  updateMailTemplate,
} from '../mailRepository.js'

function sendError(reply, code, error) {
  reply.code(code)
  return { error }
}

function textToSimpleHtml(text) {
  const escaped = String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  const withLinks = escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
  return `<pre style="font-family:sans-serif;white-space:pre-wrap;line-height:1.6">${withLinks.replace(/\n/g, '<br />')}</pre>`
}

function assertManage(request, reply) {
  if (!request.user) {
    sendError(reply, 401, '未登录')
    return false
  }
  if (!hasPermission(request.user.role, 'manageTeamSettings')) {
    sendError(reply, 403, '无权限执行此操作')
    return false
  }
  return true
}

function canSendFromEntry(user, linkKind) {
  if (linkKind === 'workbench') return canUsePostUseCallbackList(user?.role)
  return hasPermission(user?.role, 'editRecord')
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerMailRoutes(app) {
  app.get('/api/mail/status', { preHandler: requirePermission('view') }, async () => {
    ensureMailDefaults()
    const channels = listMailChannels()
    return {
      configured: Boolean(getPublicAppUrl()) && channels.some((item) => item.dataSourceType === 'post_use_rating'),
      publicAppUrl: getPublicAppUrl(),
      channels,
      groups: listMailGroups(),
      templates: listMailTemplates(),
    }
  })

  app.put(
    '/api/mail/public-url',
    { preHandler: requirePermission('manageTeamSettings'), schema: { body: mailPublicUrlBodySchema } },
    async (request, reply) => {
      if (!assertManage(request, reply)) return
      const body = /** @type {{ publicAppUrl: string }} */ (request.body)
      try {
        const publicAppUrl = setPublicAppUrl(body.publicAppUrl)
        logAuditFromRequest(request, 'mail.public_url_update', { publicAppUrl })
        return { publicAppUrl }
      } catch (err) {
        return sendError(reply, 400, err instanceof Error ? err.message : '保存失败')
      }
    },
  )

  app.post(
    '/api/mail/channels',
    { preHandler: requirePermission('manageTeamSettings'), schema: { body: mailChannelBodySchema } },
    async (request, reply) => {
      if (!assertManage(request, reply)) return
      try {
        const item = createMailChannel(/** @type {any} */ (request.body))
        logAuditFromRequest(request, 'mail.channel_create', {
          id: item?.id,
          dataSourceType: item?.dataSourceType,
        })
        reply.code(201)
        return { item }
      } catch (err) {
        return sendError(reply, 400, err instanceof Error ? err.message : '保存失败')
      }
    },
  )

  app.patch(
    '/api/mail/channels/:id',
    {
      preHandler: requirePermission('manageTeamSettings'),
      schema: { params: uuidParamSchema, body: mailChannelPatchSchema },
    },
    async (request, reply) => {
      if (!assertManage(request, reply)) return
      const { id } = /** @type {{ id: string }} */ (request.params)
      try {
        const item = updateMailChannel(id, /** @type {any} */ (request.body))
        logAuditFromRequest(request, 'mail.channel_update', { id, dataSourceType: item?.dataSourceType })
        return { item }
      } catch (err) {
        const message = err instanceof Error ? err.message : '保存失败'
        return sendError(reply, message.includes('不存在') ? 404 : 400, message)
      }
    },
  )

  app.delete(
    '/api/mail/channels/:id',
    { preHandler: requirePermission('manageTeamSettings'), schema: { params: uuidParamSchema } },
    async (request, reply) => {
      if (!assertManage(request, reply)) return
      const { id } = /** @type {{ id: string }} */ (request.params)
      try {
        deleteMailChannel(id)
        logAuditFromRequest(request, 'mail.channel_delete', { id })
        return { ok: true }
      } catch (err) {
        return sendError(reply, 404, err instanceof Error ? err.message : '删除失败')
      }
    },
  )

  app.post(
    '/api/mail/groups',
    { preHandler: requirePermission('manageTeamSettings'), schema: { body: mailGroupBodySchema } },
    async (request, reply) => {
      if (!assertManage(request, reply)) return
      try {
        const item = createMailGroup(/** @type {any} */ (request.body))
        logAuditFromRequest(request, 'mail.group_create', { id: item?.id })
        reply.code(201)
        return { item }
      } catch (err) {
        return sendError(reply, 400, err instanceof Error ? err.message : '保存失败')
      }
    },
  )

  app.patch(
    '/api/mail/groups/:id',
    {
      preHandler: requirePermission('manageTeamSettings'),
      schema: { params: uuidParamSchema, body: mailGroupBodySchema },
    },
    async (request, reply) => {
      if (!assertManage(request, reply)) return
      const { id } = /** @type {{ id: string }} */ (request.params)
      try {
        const item = updateMailGroup(id, /** @type {any} */ (request.body))
        logAuditFromRequest(request, 'mail.group_update', { id })
        return { item }
      } catch (err) {
        const message = err instanceof Error ? err.message : '保存失败'
        return sendError(reply, message.includes('不存在') ? 404 : 400, message)
      }
    },
  )

  app.delete(
    '/api/mail/groups/:id',
    { preHandler: requirePermission('manageTeamSettings'), schema: { params: uuidParamSchema } },
    async (request, reply) => {
      if (!assertManage(request, reply)) return
      const { id } = /** @type {{ id: string }} */ (request.params)
      try {
        deleteMailGroup(id)
        logAuditFromRequest(request, 'mail.group_delete', { id })
        return { ok: true }
      } catch (err) {
        return sendError(reply, 404, err instanceof Error ? err.message : '删除失败')
      }
    },
  )

  app.post(
    '/api/mail/templates',
    { preHandler: requirePermission('manageTeamSettings'), schema: { body: mailTemplateBodySchema } },
    async (request, reply) => {
      if (!assertManage(request, reply)) return
      try {
        const item = createMailTemplate(/** @type {any} */ (request.body))
        logAuditFromRequest(request, 'mail.template_create', { id: item?.id })
        reply.code(201)
        return { item }
      } catch (err) {
        return sendError(reply, 400, err instanceof Error ? err.message : '保存失败')
      }
    },
  )

  app.patch(
    '/api/mail/templates/:id',
    {
      preHandler: requirePermission('manageTeamSettings'),
      schema: { params: uuidParamSchema, body: mailTemplateBodySchema },
    },
    async (request, reply) => {
      if (!assertManage(request, reply)) return
      const { id } = /** @type {{ id: string }} */ (request.params)
      try {
        const item = updateMailTemplate(id, /** @type {any} */ (request.body))
        logAuditFromRequest(request, 'mail.template_update', { id, preset: item?.preset })
        return { item }
      } catch (err) {
        const message = err instanceof Error ? err.message : '保存失败'
        return sendError(reply, message.includes('不存在') ? 404 : 400, message)
      }
    },
  )

  app.delete(
    '/api/mail/templates/:id',
    { preHandler: requirePermission('manageTeamSettings'), schema: { params: uuidParamSchema } },
    async (request, reply) => {
      if (!assertManage(request, reply)) return
      const { id } = /** @type {{ id: string }} */ (request.params)
      try {
        deleteMailTemplate(id)
        logAuditFromRequest(request, 'mail.template_delete', { id })
        return { ok: true }
      } catch (err) {
        const message = err instanceof Error ? err.message : '删除失败'
        return sendError(reply, message.includes('不能删除') ? 400 : 404, message)
      }
    },
  )

  app.post(
    '/api/mail/send',
    { preHandler: requirePermission('view'), schema: { body: mailSendBodySchema } },
    async (request, reply) => {
      const user = request.user
      if (!user) return sendError(reply, 401, '未登录')
      const body = /** @type {any} */ (request.body)
      const linkKind = body.linkKind || (body.reportKey ? 'report' : 'workbench')
      if (!canSendFromEntry(user, linkKind)) {
        return sendError(reply, 403, '无权限发送此邮件')
      }
      if (body.dataSourceType !== 'post_use_rating') {
        return sendError(reply, 400, '当前只支持用后即评内容发信')
      }
      try {
        const to = assertEmailList(body.to, '收件人')
        const cc = uniqueEmails(body.cc || [])
        if (cc.length) assertEmailList(cc, '抄送')
        if (to.length + cc.length > 30) return sendError(reply, 400, '收件人与抄送合计不能超过 30 个')
        const template = getMailTemplate(body.templateId)
        if (!template) return sendError(reply, 400, '邮件模板不存在')
        const publicAppUrl = getPublicAppUrl()
        if (!publicAppUrl) return sendError(reply, 503, '未配置平台访问地址，请在设置中填写')
        const channel = getMailChannelByDataSource(body.dataSourceType)
        if (!channel) return sendError(reply, 503, '未配置用后即评发信通道')
        const buffer = Buffer.from(String(body.attachment.contentBase64 || ''), 'base64')
        if (!buffer.length) return sendError(reply, 400, '附件为空')
        if (buffer.length > MAIL_MAX_ATTACHMENT_BYTES) {
          return sendError(reply, 400, '附件过大')
        }
        const linkTemplateId =
          linkKind === 'workbench' ? MAIL_PRESET_CALLBACK_VISIT : MAIL_PRESET_REPORT
        const vars = {
          periodLabel: body.periodLabel || '',
          reportKey: body.reportKey || '',
          reportKind: body.reportKind || 'month',
          absoluteUrl: resolveMailContentUrl(
            linkTemplateId,
            body.reportKind || 'month',
            body.reportKey || '',
            publicAppUrl,
          ),
        }
        let subject = applyMailPlaceholders(template.subject, vars)
        let text = applyMailPlaceholders(template.body, vars)
        const note = String(body.note || '').trim()
        if (note) text = `${text}\n\n发送说明：${note}`
        await sendSmtpMail(channel, {
          to,
          cc,
          subject,
          text,
          html: textToSimpleHtml(text),
          attachments: [
            {
              filename: body.attachment.filename,
              content: buffer,
              contentType: body.attachment.mime,
            },
          ],
        })
        logAuditFromRequest(request, 'mail.send', {
          templateId: template.id,
          dataSourceType: body.dataSourceType,
          channelId: channel.id,
          periodLabel: body.periodLabel || '',
          reportKey: body.reportKey || '',
          to,
          cc,
          absoluteUrl: vars.absoluteUrl,
          filename: body.attachment.filename,
          bytes: buffer.length,
        })
        return { ok: true }
      } catch (err) {
        request.log.error(err)
        const message = err instanceof Error ? err.message : '发送失败'
        if (message.includes('邮箱') || message.includes('请填写')) {
          return sendError(reply, 400, message)
        }
        return sendError(reply, 502, '邮件发送失败')
      }
    },
  )
}
