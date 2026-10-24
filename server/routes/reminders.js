/**
 * 邮件提醒 API 路由 — preview + send
 * 权限：仅 admin
 */

import { requireAdmin } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { reminderPreviewBodySchema, reminderSendBodySchema } from '../reminderSchema.js'
import { buildReminderData } from '../reminderRuleEngine.js'
import { enhanceWithLlm } from '../reminderLlmEnhancer.js'
import { renderReminderMail } from '../reminderMailRenderer.js'
import { describeMailSendError, sendSmtpMail } from '../mail/smtp.js'
import { getMailChannelByDataSource, getPublicAppUrl } from '../mailRepository.js'

function sendError(reply, code, error) {
  reply.code(code)
  return { error }
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerReminderRoutes(app) {
  // 预览：不调 LLM，不发送，只返回规则引擎查询结果
  app.post(
    '/api/reminders/preview',
    { preHandler: requireAdmin(), schema: { body: reminderPreviewBodySchema } },
    async (request, reply) => {
      try {
        const body = /** @type {{ insightPeriodId?: string }} */ (request.body)
        const data = buildReminderData({ insightPeriodId: body.insightPeriodId })
        // 预览不返回完整邮件，只返回摘要数据
        const preview = {
          products: data.products.map((p) => {
            const c = p.categories
            const total = c.complaintTickets.length + c.consultationSummary.total +
              c.internalTraces.length + c.visitEvaluations.length +
              c.pendingActions.length + c.openTodos.length
            return {
              productKey: p.productKey,
              productName: p.productName,
              total,
              distribution: {
                complaintTickets: c.complaintTickets.length,
                consultationTotal: c.consultationSummary.total,
                consultationScenes: c.consultationSummary.sceneDistribution,
                internalTraces: c.internalTraces.length,
                visitEvaluations: c.visitEvaluations.length,
                pendingActions: c.pendingActions.length,
                actionOverdue: c.pendingActions.filter((a) => a.overdue).length,
                actionNear: c.pendingActions.filter((a) => a.near).length,
                openTodos: c.openTodos.length,
              },
              attentionRoles: p.attentionRoles,
              owners: p.owners,
            }
          }),
          recipientEmails: data.recipientEmails,
          recipientCount: data.recipientEmails.length,
          totalCount: data.totalCount,
          periodLabel: data.periodLabel,
          generatedAt: data.generatedAt,
        }
        return preview
      } catch (err) {
        request.log.error(err)
        return sendError(reply, 500, err instanceof Error ? err.message : '预览失败')
      }
    },
  )

  // 发送：buildReminderData → enhanceWithLlm → renderReminderMail → sendSmtpMail
  app.post(
    '/api/reminders/send',
    { preHandler: requireAdmin(), schema: { body: reminderSendBodySchema } },
    async (request, reply) => {
      try {
        const body = /** @type {{ insightPeriodId: string, skipLlm?: boolean }} */ (request.body)
        const data = buildReminderData({ insightPeriodId: body.insightPeriodId })

        if (data.products.length === 0) {
          return sendError(reply, 400, '本周期无待办数据，无需发送提醒邮件')
        }

        if (data.recipientEmails.length === 0) {
          return sendError(reply, 400, '收件人为空，请检查产品负责人配置')
        }

        // LLM 增强
        const llmResults = await enhanceWithLlm(data.products, { skipLlm: body.skipLlm })

        // 检查 SMTP 通道
        const channel = getMailChannelByDataSource('reminder')
        if (!channel) {
          return sendError(reply, 503, '未配置提醒邮件发信通道，请在设置中为「提醒邮件」配置 SMTP 通道')
        }

        const publicAppUrl = getPublicAppUrl()
        if (!publicAppUrl) {
          return sendError(reply, 503, '未配置平台访问地址，请在设置中填写')
        }

        // 渲染邮件
        const mail = renderReminderMail(data, llmResults, { publicAppUrl })

        // 发送
        await sendSmtpMail(channel, {
          to: data.recipientEmails,
          subject: mail.subject,
          text: `请查看附件获取完整提醒详情。\n\n平台地址：${publicAppUrl}`,
          html: mail.bodyHtml,
          attachments: [
            {
              filename: mail.attachmentFilename,
              content: Buffer.from(mail.attachmentHtml, 'utf8'),
              contentType: 'text/html',
            },
          ],
        })

        logAuditFromRequest(request, 'reminder.send', {
          insightPeriodId: body.insightPeriodId,
          periodLabel: data.periodLabel,
          productCount: data.products.length,
          totalCount: data.totalCount,
          recipientCount: data.recipientEmails.length,
          skipLlm: Boolean(body.skipLlm),
          attachmentFilename: mail.attachmentFilename,
        })

        return {
          ok: true,
          sentTo: data.recipientEmails,
          recipientCount: data.recipientEmails.length,
          productCount: data.products.length,
          totalCount: data.totalCount,
          periodLabel: data.periodLabel,
        }
      } catch (err) {
        request.log.error(err)
        const message = err instanceof Error ? err.message : '发送失败'
        if (message.includes('未配置') || message.includes('无待办') || message.includes('收件人')) {
          return sendError(reply, 400, message)
        }
        if (message.includes('SMTP') || message.includes('连接') || message.includes('认证')) {
          return sendError(reply, 502, describeMailSendError(err))
        }
        return sendError(reply, 500, message)
      }
    },
  )
}
