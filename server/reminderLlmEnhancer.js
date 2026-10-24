/**
 * 邮件提醒 LLM 增强 — 每产品调 1 次 LLM，生成概述段落 + 趋势洞察。
 * 失败标记"LLM分析不可用"，不阻断流程。
 */

import { resolveLlmApiKey, resolveLlmBaseUrl, resolveLlmModel } from './llmConfig.js'
import { forwardLlmChatCompletion } from './llmProxy.js'
import { getLlmCompletionText } from '../src/lib/llmClient.js'

/**
 * @param {Array} products - buildReminderData 返回的 products 数组
 * @param {{ skipLlm?: boolean }} options
 * @returns {Promise<Map<string, { summary: string, trend: string } | { error: string }>>}
 */
export async function enhanceWithLlm(products, { skipLlm = false } = {}) {
  /** @type {Map<string, { summary: string, trend: string } | { error: string }>} */
  const results = new Map()

  if (skipLlm) {
    for (const product of products) {
      results.set(product.productKey, { error: '已跳过' })
    }
    return results
  }

  let apiKey
  try {
    apiKey = resolveLlmApiKey()
  } catch {
    for (const product of products) {
      results.set(product.productKey, { error: 'LLM 未配置' })
    }
    return results
  }

  const baseUrl = resolveLlmBaseUrl()
  const model = resolveLlmModel()

  // 串行处理每个产品（避免并发限流）
  for (const product of products) {
    try {
      const prompt = buildProductPrompt(product)
      const data = await forwardLlmChatCompletion({
        baseUrl,
        apiKey,
        body: {
          model,
          messages: [
            {
              role: 'system',
              content: '你是移动云反馈洞察平台的分析助手。根据以下产品待办数据，生成简明的产品概述和趋势洞察。不做行动建议，只描述现状和趋势。输出格式：先用"概述："开头写一段概述（100-200字），然后换行用"趋势："开头写趋势洞察（50-100字）。',
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 1024,
        },
      })

      const text = getLlmCompletionText(data)
      const { summary, trend } = parseLlmResponse(text)
      results.set(product.productKey, { summary, trend })
    } catch (err) {
      results.set(product.productKey, {
        error: err instanceof Error ? err.message : 'LLM分析不可用',
      })
    }
  }

  return results
}

/**
 * @param {object} product
 */
function buildProductPrompt(product) {
  const c = product.categories
  const parts = [`产品：${product.productName}`]

  if (c.complaintTickets.length > 0) {
    parts.push(`投诉工单待处理：${c.complaintTickets.length} 条`)
    const problems = c.complaintTickets
      .map((t) => t.problemSummary)
      .filter(Boolean)
      .slice(0, 5)
    if (problems.length) parts.push(`主要问题：${problems.join('；')}`)
    if (product.attentionRoles.length) {
      parts.push(`需关注角色：${product.attentionRoles.join('、')}`)
    }
  }

  if (c.consultationSummary.total > 0) {
    parts.push(`咨询工单：${c.consultationSummary.total} 条`)
    const scenes = Object.entries(c.consultationSummary.sceneDistribution)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([scene, count]) => `${scene}(${count})`)
      .join('、')
    if (scenes) parts.push(`请求场景分布：${scenes}`)
  }

  if (c.internalTraces.length > 0) {
    parts.push(`用后即评-产品部溯源待处理：${c.internalTraces.length} 条`)
  }

  if (c.visitEvaluations.length > 0) {
    parts.push(`用后即评-补充的回访结果待评估：${c.visitEvaluations.length} 条`)
  }

  if (c.pendingActions.length > 0) {
    parts.push(`未完成举措：${c.pendingActions.length} 条`)
    const overdue = c.pendingActions.filter((a) => a.overdue).length
    const near = c.pendingActions.filter((a) => a.near).length
    if (overdue > 0) parts.push(`其中超期 ${overdue} 条`)
    if (near > 0) parts.push(`临近排期 ${near} 条`)
  }

  if (c.openTodos.length > 0) {
    parts.push(`客户体验类分析会会后待办：${c.openTodos.length} 条`)
  }

  return parts.join('\n')
}

/**
 * @param {string} text
 */
function parseLlmResponse(text) {
  const full = String(text || '').trim()
  let summary = ''
  let trend = ''

  // 尝试按"概述："和"趋势："分割
  const summaryMatch = full.match(/概[述要][:：]([\s\S]*?)(?=趋[势势][:：]|$)/i)
  const trendMatch = full.match(/趋[势势][:：]([\s\S]*)$/i)

  if (summaryMatch) {
    summary = summaryMatch[1].trim()
  } else {
    // 没有标记，整段作为 summary
    summary = full
  }

  if (trendMatch) {
    trend = trendMatch[1].trim()
  }

  return { summary, trend }
}
