/**
 * LLM 辅助判定（方向C）—— 对复合工单/低置信工单，调 LLM 判定主诉归属
 *
 * 触发条件：散词匹配命中 ≥3 个家族（famHits≥3）或最高置信度 <0.4（低置信）
 * 调用方式：LLM_ASSIST=1 环境变量启用；需配置 LLM_API_KEY（.env 或库内 llm_config_v1）
 * 降级：未启用/未配置/调用失败 → 返回 null，引擎回退到散词匹配结果
 *
 * 设计原则（三方分离不破坏）：
 * - LLM 只做"判定主诉归属"（给出家族key + 理由），不改分类法、不写产物
 * - 判定结果作为 scoreFamilies 的额外加分（top1 家族 +bonus），不替代散词匹配
 * - 完整可审计：每次调用记录工单号/prompt/响应/判定到 dist/llm-assist-log.json
 */
const fs = require('fs');
const path = require('path');

const LLM_ASSIST_ENABLED = process.env.LLM_ASSIST === '1';
const ASSIST_LOG = path.resolve(__dirname, '..', 'dist', 'llm-assist-log.json');

/** 是否启用 LLM 辅助 */
function isLlmAssistEnabled() {
  return LLM_ASSIST_ENABLED;
}

/** 解析 LLM 配置（库 > 环境变量 > 默认），复用 server/llmConfig.js 逻辑但独立读取避免循环依赖 */
function resolveLlmConfig() {
  // 环境变量优先（脚本场景）
  const apiKey = process.env.LLM_API_KEY?.trim();
  const baseUrl = (process.env.LLM_BASE_URL || 'https://api.openai.com/v1').trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
  const model = (process.env.LLM_MODEL || 'gpt-4o-mini').trim();
  return { apiKey, baseUrl, model };
}

/** 判定是否需要 LLM 辅助：命中≥3家族 或 最高置信度<0.4 */
function needsAssist(famScores) {
  if (!LLM_ASSIST_ENABLED) return false;
  const validHits = famScores.filter(x => x.s > 0);
  if (validHits.length >= 3) return true;
  if (validHits.length >= 2) {
    const top = validHits[0], second = validHits[1];
    const conf = top.s > 0 ? (top.s - second.s) / top.s : 0;
    if (conf < 0.4) return true;
  }
  return false;
}

/** 调 LLM 判定主诉归属 */
async function llmJudgeMainIssue(ticket, famScores, tax) {
  if (!LLM_ASSIST_ENABLED) return null;
  const cfg = resolveLlmConfig();
  if (!cfg.apiKey) {
    console.warn('[llm-assist] LLM_API_KEY 未配置，跳过 LLM 辅助');
    return null;
  }

  // 构造 prompt
  const voice = ticket._voice || '';
  const pain = ticket['需求痛点'] || '';
  const reason = ticket['问题原因'] || '';
  const candidates = famScores.filter(x => x.s > 0).slice(0, 5).map(x => ({
    key: x.fam.key,
    name: x.fam.name,
    score: +x.s.toFixed(2),
  }));

  const prompt = `你是云产品工单分类专家。请判定这张工单的"主诉问题"属于哪个家族。

## 工单信息
- 客户请求（真声）：${voice.slice(0, 300)}
- 需求痛点：${pain.slice(0, 200)}
- 问题原因：${reason.slice(0, 200)}

## 候选家族（散词匹配得分 top5）
${candidates.map(c => `- ${c.key}（${c.name}）得分${c.score}`).join('\n')}

## 家族定义
${tax.families.map(f => `- ${f.key}（${f.name}）: ${f.re.source.slice(0, 120)}`).join('\n')}

## 要求
1. 判定主诉属于哪个家族（只选1个，给 key）
2. 用一句话说明理由
3. 输出 JSON：{"mainFamily": "家族key", "reason": "理由"}

只输出 JSON，不要其他文字。`;

  try {
    const body = JSON.stringify({
      model: cfg.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: 200,
    });
    const url = cfg.baseUrl + '/chat/completions';
    // 动态 import node:fetch 不行（Node22 内置 fetch），直接用 global fetch
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body,
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    // 解析 JSON（容错：提取 { ... }）
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('响应无 JSON: ' + content.slice(0, 100));
    const result = JSON.parse(m[0]);

    // 审计日志
    const logEntry = {
      ticketId: ticket['工单号'],
      ts: new Date().toISOString(),
      candidates,
      llmMainFamily: result.mainFamily,
      llmReason: result.reason,
    };
    appendLog(logEntry);

    return result;
  } catch (e) {
    console.warn(`[llm-assist] 工单 ${ticket['工单号']} LLM 调用失败: ${e.message}`);
    appendLog({ ticketId: ticket['工单号'], ts: new Date().toISOString(), error: e.message });
    return null;
  }
}

function appendLog(entry) {
  try {
    let logs = [];
    if (fs.existsSync(ASSIST_LOG)) logs = JSON.parse(fs.readFileSync(ASSIST_LOG, 'utf8'));
    logs.push(entry);
    fs.writeFileSync(ASSIST_LOG, JSON.stringify(logs, null, 2), 'utf8');
  } catch { /* 日志失败不影响主流程 */ }
}

module.exports = { isLlmAssistEnabled, needsAssist, llmJudgeMainIssue, resolveLlmConfig };
