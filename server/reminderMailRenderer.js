/**
 * 邮件提醒 HTML 渲染 — A 部分邮件正文（内联摘要）+ B 部分附件 HTML（Tab 切换详情）。
 *
 * A 部分约束：CSS 全内联，无 <script>，无 <style> 标签（邮件客户端兼容）
 * B 部分约束：完整 HTML 文档，含 <style> 和 <script>，浏览器打开可交互
 */

import { joinPublicAppUrl } from '../src/domain/mail.js'

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function text(value, fallback = '—') {
  const raw = String(value ?? '').trim()
  return escapeHtml(raw || fallback)
}

function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/**
 * @param {object} data - buildReminderData 返回
 * @param {Map<string, { summary: string, trend: string } | { error: string }>} llmResults
 * @param {{ publicAppUrl: string }} options
 * @returns {{ subject: string, bodyHtml: string, attachmentHtml: string, attachmentFilename: string }}
 */
export function renderReminderMail(data, llmResults, { publicAppUrl }) {
  const { products, recipientEmails, totalCount, periodLabel, generatedAt } = data
  const dateStr = generatedAt.slice(0, 10).replace(/-/g, '年').replace(/-(\d{2})$/, '月$1日')

  const subject = `工单提醒周报（${periodLabel}）`

  return {
    subject,
    bodyHtml: renderBodyHtml(data, llmResults, { publicAppUrl }),
    attachmentHtml: renderAttachmentHtml(data, llmResults, { publicAppUrl }),
    attachmentFilename: `工单提醒周报_${periodLabel}_${nowStamp()}.html`,
  }
}

// ============ A 部分：邮件正文（内联 HTML 摘要） ============

function renderBodyHtml(data, llmResults, { publicAppUrl }) {
  const { products, recipientEmails, totalCount, periodLabel, generatedAt } = data

  const productRows = products.map((p) => {
    const c = p.categories
    const total = c.complaintTickets.length + c.consultationSummary.total +
      c.internalTraces.length + c.visitEvaluations.length +
      c.pendingActions.length + c.openTodos.length

    const distParts = []
    if (c.complaintTickets.length) distParts.push(`投诉工单 ${c.complaintTickets.length}`)
    if (c.consultationSummary.total) distParts.push(`咨询工单 ${c.consultationSummary.total}(统计)`)
    if (c.internalTraces.length) distParts.push(`用后即评-产品部溯源 ${c.internalTraces.length}`)
    if (c.visitEvaluations.length) distParts.push(`用后即评-补充的回访结果待评估 ${c.visitEvaluations.length}`)
    if (c.pendingActions.length) {
      const overdue = c.pendingActions.filter((a) => a.overdue).length
      const near = c.pendingActions.filter((a) => a.near).length
      let label = `未完成举措 ${c.pendingActions.length}`
      if (overdue || near) label += `（超期${overdue} 临近${near}）`
      distParts.push(label)
    }
    if (c.openTodos.length) distParts.push(`客户体验类分析会会后待办 ${c.openTodos.length}`)

    const attention = p.attentionRoles.length
      ? `需关注：${p.attentionRoles.join('、')}`
      : ''

    return `<tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 12px;font-weight:600;color:#1890ff">${escapeHtml(p.productName)}</td>
      <td style="padding:8px 12px;color:#cf1322;font-weight:600">${total}</td>
      <td style="padding:8px 12px;font-size:12px;color:#666">${escapeHtml(distParts.join(' - '))}</td>
      <td style="padding:8px 12px;font-size:12px;color:#d46b08">${escapeHtml(attention)}</td>
    </tr>`
  }).join('')

  const platformUrl = joinPublicAppUrl(publicAppUrl, '/feedbacks')

  return `<div style="font-family:sans-serif;max-width:680px;margin:0 auto">
  <div style="background:linear-gradient(135deg,#1890ff,#096dd9);color:#fff;padding:20px 24px;border-radius:8px 8px 0 0">
    <div style="font-size:18px;font-weight:bold">移动云 · 反馈洞察平台</div>
    <div style="font-size:14px;margin-top:4px;opacity:0.9">工单提醒周报 — ${escapeHtml(periodLabel)}</div>
  </div>
  <div style="padding:16px 24px;border:1px solid #ddd;border-top:none;border-radius:0 0 8px 8px">
    <p style="margin:0 0 12px;font-size:13px;color:#666">
      本邮件涵盖 <strong style="color:#333">${products.length}</strong> 个产品，共 <strong style="color:#cf1322">${totalCount}</strong> 项待处理事项。<br>
      收件人：${recipientEmails.length} 人（各产品 PM / 设计师 / 运维三线 / 运营 / 测试 负责人）<br>
      生成时间：${escapeHtml(generatedAt.replace('T', ' ').slice(0, 16))}
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <thead>
        <tr style="background:#f5f7fa;border-bottom:2px solid #ddd">
          <th style="padding:8px 12px;text-align:left">产品</th>
          <th style="padding:8px 12px;text-align:left;width:60px">总数</th>
          <th style="padding:8px 12px;text-align:left">各类待办分布</th>
          <th style="padding:8px 12px;text-align:left;width:140px">需关注</th>
        </tr>
      </thead>
      <tbody>${productRows}</tbody>
    </table>
    <p style="margin:16px 0 8px;font-size:12px;color:#999">
      完整分产品明细请查看附件 HTML（浏览器打开可按产品 Tab 切换查看）。
    </p>
    <p style="margin:8px 0;font-size:12px;color:#999">
      平台地址：<a href="${escapeHtml(platformUrl)}" style="color:#1890ff">${escapeHtml(platformUrl)}</a>
    </p>
    <p style="margin:8px 0 0;font-size:11px;color:#bbb">
      本邮件由系统自动生成。LLM 概述由大模型生成，仅供参考。
    </p>
  </div>
</div>`
}

// ============ B 部分：附件 HTML（完整详情，Tab 切换） ============

function renderAttachmentHtml(data, llmResults, { publicAppUrl }) {
  const { products, recipientEmails, totalCount, periodLabel, generatedAt } = data

  const tabButtons = products.map((p, i) => {
    const active = i === 0 ? 'active' : ''
    return `<button class="tab-btn ${active}" data-product-tab="${escapeHtml(p.productKey)}" onclick="switchTab('${escapeHtml(p.productKey)}')">${escapeHtml(p.productName)}</button>`
  }).join('')

  const tabPanels = products.map((p, i) => {
    const display = i === 0 ? '' : 'display:none'
    return `<div class="tab-panel" data-product-panel="${escapeHtml(p.productKey)}" style="${display}">
      ${renderProductPanel(p, llmResults.get(p.productKey))}
    </div>`
  }).join('')

  const platformUrl = joinPublicAppUrl(publicAppUrl, '/feedbacks')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>工单提醒周报 ${escapeHtml(periodLabel)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f7fa; color: #333; line-height: 1.6; }
  .header { background: linear-gradient(135deg, #1890ff, #096dd9); color: #fff; padding: 24px 32px; }
  .header h1 { font-size: 22px; margin-bottom: 4px; }
  .header .subtitle { font-size: 14px; opacity: 0.9; }
  .meta { padding: 12px 32px; background: #fff; border-bottom: 1px solid #e8e8e8; font-size: 13px; color: #666; }
  .meta strong { color: #333; }
  .tab-bar { display: flex; flex-wrap: wrap; gap: 4px; padding: 12px 32px 0; background: #fff; border-bottom: 1px solid #e8e8e8; }
  .tab-btn { padding: 8px 16px; border: 1px solid #ddd; border-bottom: none; border-radius: 6px 6px 0 0; background: #f5f7fa; cursor: pointer; font-size: 14px; color: #666; transition: all 0.2s; }
  .tab-btn:hover { background: #e6f7ff; color: #1890ff; }
  .tab-btn.active { background: #1890ff; color: #fff; border-color: #1890ff; }
  .tab-content { padding: 20px 32px; }
  .tab-panel { animation: fadeIn 0.3s; }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .product-header { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
  .product-title { font-size: 20px; font-weight: 600; color: #1890ff; }
  .product-attention { font-size: 13px; color: #d46b08; background: #fff7e6; padding: 4px 12px; border-radius: 12px; }
  .category-section { margin-bottom: 24px; }
  .category-title { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  .badge-red { background: #fff1f0; color: #cf1322; }
  .badge-blue { background: #e6f7ff; color: #096dd9; }
  .badge-orange { background: #fff7e6; color: #d46b08; }
  .badge-gray { background: #f5f5f5; color: #666; }
  .count-badge { background: #f0f0f0; color: #666; padding: 2px 8px; border-radius: 10px; font-size: 12px; }
  .data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .data-table th { background: #fafafa; padding: 8px 12px; text-align: left; border-bottom: 2px solid #e8e8e8; font-weight: 600; color: #666; }
  .data-table td { padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }
  .data-table tr:hover td { background: #f5f7fa; }
  .row-overdue td { background: #fff1f0 !important; }
  .row-near td { background: #fff7e6 !important; }
  .role-tag { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 11px; margin-right: 4px; }
  .role-pm { background: #fff7e6; color: #d46b08; }
  .role-design { background: #f9f0ff; color: #722ed1; }
  .role-ops { background: #e6fffb; color: #08979c; }
  .dist-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .dist-label { width: 120px; font-size: 13px; text-align: right; }
  .dist-bar-bg { flex: 1; height: 18px; background: #f5f5f5; border-radius: 4px; overflow: hidden; }
  .dist-bar-fill { height: 100%; border-radius: 4px; }
  .dist-count { width: 30px; font-size: 13px; font-weight: 600; }
  .llm-block { margin-top: 20px; padding: 12px 16px; background: #f5f7fa; border-radius: 8px; border-left: 4px solid #1890ff; }
  .llm-error { color: #999; font-style: italic; }
  .footer { padding: 16px 32px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #e8e8e8; margin-top: 32px; }
  .footer a { color: #1890ff; }
</style>
</head>
<body>
<div class="header">
  <h1>移动云 · 反馈洞察平台</h1>
  <div class="subtitle">工单提醒周报 — ${escapeHtml(periodLabel)}</div>
</div>
<div class="meta">
  本邮件涵盖 <strong>${products.length}</strong> 个产品，共 <strong style="color:#cf1322">${totalCount}</strong> 项待处理事项。<br>
  收件人：${recipientEmails.length} 人 &nbsp;|&nbsp; 生成时间：${escapeHtml(generatedAt.replace('T', ' ').slice(0, 16))}
</div>
<div class="tab-bar">${tabButtons}</div>
<div class="tab-content">${tabPanels}</div>
<div class="footer">
  <p>完整数据见 <a href="${escapeHtml(platformUrl)}">反馈洞察平台</a></p>
  <p style="margin-top:8px;color:#bbb">LLM 概述由大模型生成，仅供参考。</p>
</div>
<script>
function switchTab(key) {
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.classList.toggle('active', btn.getAttribute('data-product-tab') === key);
  });
  document.querySelectorAll('.tab-panel').forEach(function(panel) {
    panel.style.display = panel.getAttribute('data-product-panel') === key ? '' : 'none';
  });
}
</script>
</body>
</html>`
}

function renderProductPanel(product, llmResult) {
  const c = product.categories
  const attention = product.attentionRoles.length
    ? `<span class="product-attention">需关注：${escapeHtml(product.attentionRoles.join('、'))}</span>`
    : ''

  const parts = [`<div class="product-header"><span class="product-title">${escapeHtml(product.productName)}</span>${attention}</div>`]

  // 1a 投诉工单
  if (c.complaintTickets.length > 0) {
    parts.push(renderComplaintTickets(c.complaintTickets))
  }

  // 1b 咨询工单
  if (c.consultationSummary.total > 0) {
    parts.push(renderConsultationSummary(c.consultationSummary))
  }

  // 2 用后即评-产品部溯源
  if (c.internalTraces.length > 0) {
    parts.push(renderInternalTraces(c.internalTraces))
  }

  // 3 用后即评-补充的回访结果待评估
  if (c.visitEvaluations.length > 0) {
    parts.push(renderVisitEvaluations(c.visitEvaluations))
  }

  // 4 未完成举措
  if (c.pendingActions.length > 0) {
    parts.push(renderPendingActions(c.pendingActions))
  }

  // 5 客户体验类分析会会后待办
  if (c.openTodos.length > 0) {
    parts.push(renderOpenTodos(c.openTodos))
  }

  // LLM 概述
  if (llmResult) {
    if (llmResult.error) {
      parts.push(`<div class="llm-block"><p class="llm-error">LLM分析不可用：${escapeHtml(llmResult.error)}</p></div>`)
    } else {
      parts.push(`<div class="llm-block">`)
      if (llmResult.summary) parts.push(`<p><strong>LLM 产品概述：</strong>${escapeHtml(llmResult.summary)}</p>`)
      if (llmResult.trend) parts.push(`<p style="margin-top:8px"><strong>趋势洞察：</strong>${escapeHtml(llmResult.trend)}</p>`)
      parts.push(`</div>`)
    }
  }

  return parts.join('\n')
}

function renderComplaintTickets(items) {
  const rows = items.map((t) => {
    const roleTags = (t.missingRoles || []).map((r) => {
      const cls = r === '产品经理' ? 'role-pm' : r === '设计师' ? 'role-design' : r === '运维三线' ? 'role-ops' : ''
      return `<span class="role-tag ${cls}">${escapeHtml(r)}</span>`
    }).join('')
    return `<tr>
      <td>${escapeHtml(t.ticketId)}</td>
      <td>${escapeHtml(t.customerName)}</td>
      <td>${text(t.problemSummary, '')}</td>
      <td>${roleTags || '<span style="color:#999">—</span>'}</td>
      <td>${escapeHtml(t.tagStatus)}</td>
    </tr>`
  }).join('')
  return `<div class="category-section">
    <div class="category-title">
      <span class="badge badge-red">投诉工单</span> 待处理工单
      <span class="count-badge">${items.length} 条</span>
    </div>
    <table class="data-table">
      <thead><tr><th style="width:100px">工单号</th><th style="width:80px">客户</th><th>问题摘要</th><th style="width:100px">未完成角色</th><th style="width:80px">闸门状态</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

function renderConsultationSummary(summary) {
  const entries = Object.entries(summary.sceneDistribution).sort((a, b) => b[1] - a[1])
  const maxCount = Math.max(...entries.map(([, n]) => n), 1)
  const colors = ['#cf1322', '#096dd9', '#08979c', '#d46b08', '#722ed1', '#389e0d', '#c41d7f', '#13c2c2', '#fa541c']
  const rows = entries.map(([scene, count], i) => {
    const pct = Math.round((count / maxCount) * 100)
    const color = colors[i % colors.length]
    return `<div class="dist-row">
      <span class="dist-label">${escapeHtml(scene)}</span>
      <div class="dist-bar-bg"><div class="dist-bar-fill" style="width:${pct}%;background:${color}"></div></div>
      <span class="dist-count">${count}</span>
    </div>`
  }).join('')
  return `<div class="category-section">
    <div class="category-title">
      <span class="badge badge-blue">咨询工单</span> 本周期统计概览
      <span class="count-badge">${summary.total} 条</span>
    </div>
    <div style="padding:4px 0">${rows}</div>
  </div>`
}

function renderInternalTraces(items) {
  const rows = items.map((t) => {
    const statusBadge = t.status === '待处理'
      ? '<span class="badge badge-gray">待处理</span>'
      : t.status === '进行中'
        ? '<span class="badge badge-blue">进行中</span>'
        : `<span class="badge">${escapeHtml(t.status)}</span>`
    return `<tr>
      <td>${escapeHtml(t.customerName)}</td>
      <td>${escapeHtml(t.productName)}</td>
      <td>${text(t.feedbackSummary, '')}</td>
      <td>${escapeHtml(t.assigneeName)}</td>
      <td>${statusBadge}</td>
    </tr>`
  }).join('')
  return `<div class="category-section">
    <div class="category-title">
      <span class="badge badge-orange">用后即评-产品部溯源</span> 待处理
      <span class="count-badge">${items.length} 条</span>
    </div>
    <table class="data-table">
      <thead><tr><th style="width:80px">客户</th><th style="width:80px">产品</th><th>反馈摘要</th><th style="width:70px">经办人</th><th style="width:70px">处理状态</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

function renderVisitEvaluations(items) {
  const rows = items.map((t) => {
    return `<tr>
      <td>${escapeHtml(t.customerName)}</td>
      <td>${escapeHtml(t.productName)}</td>
      <td>${text(t.visitResult, '')}</td>
      <td><span style="color:#cf1322">未填写</span></td>
    </tr>`
  }).join('')
  return `<div class="category-section">
    <div class="category-title">
      <span class="badge badge-orange">用后即评-补充的回访结果待评估</span>
      <span class="count-badge">${items.length} 条</span>
    </div>
    <table class="data-table">
      <thead><tr><th style="width:80px">客户</th><th style="width:80px">产品</th><th>回访结果</th><th style="width:70px">内部评估</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

function renderPendingActions(items) {
  const overdue = items.filter((a) => a.overdue).length
  const near = items.filter((a) => a.near).length
  const urgentLabel = (overdue || near) ? ` <span style="font-size:12px;color:#cf1322">超期${overdue} 临近${near}</span>` : ''
  const rows = items.map((a) => {
    const rowCls = a.overdue ? 'row-overdue' : a.near ? 'row-near' : ''
    const urgentTag = a.overdue
      ? '<span class="badge badge-red">超期</span>'
      : a.near
        ? '<span class="badge badge-orange">临近</span>'
        : '<span style="color:#999">—</span>'
    const statusBadge = a.status === 'in_progress'
      ? '<span class="badge badge-blue">进行中</span>'
      : a.status === 'pending_evaluation'
        ? '<span class="badge badge-gray">待评估</span>'
        : '<span class="badge badge-gray">挂起</span>'
    return `<tr class="${rowCls}">
      <td>${text(a.content, '')}</td>
      <td>${statusBadge}</td>
      <td>${a.scheduleAt ? escapeHtml(a.scheduleAt) : '—'}</td>
      <td>${urgentTag}</td>
      <td>${a.firstProposedAt ? escapeHtml(a.firstProposedAt) : '—'}</td>
    </tr>`
  }).join('')
  return `<div class="category-section">
    <div class="category-title">
      <span class="badge badge-orange">未完成举措</span>
      ${urgentLabel}
      <span class="count-badge">${items.length} 条</span>
    </div>
    <table class="data-table">
      <thead><tr><th>举措内容</th><th style="width:60px">状态</th><th style="width:70px">排期</th><th style="width:60px">提醒</th><th style="width:90px">首次提出</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}

function renderOpenTodos(items) {
  const rows = items.map((t) => {
    return `<tr>
      <td>${text(t.text, '')}</td>
      <td>${(t.linkedTicketIds || []).map(escapeHtml).join(', ') || '—'}</td>
      <td>${escapeHtml(t.assigneeName)}</td>
    </tr>`
  }).join('')
  return `<div class="category-section">
    <div class="category-title">
      <span class="badge badge-orange">客户体验类分析会会后待办</span>
      <span class="count-badge">${items.length} 条</span>
    </div>
    <table class="data-table">
      <thead><tr><th>待办内容</th><th style="width:100px">关联工单</th><th style="width:70px">指派人</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`
}
