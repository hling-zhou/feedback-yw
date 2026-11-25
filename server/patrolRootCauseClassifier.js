/**
 * API 巡检根因分类器（docs/DESIGN-API巡检.md §4.3/§6）。
 * 输入构造（底稿硬规则）：final_conclusion → 无则 conclusion → 解析失败截前 800 字；
 * ELB 拼 errorMessage（前 40 字不在诊断中才拼）；值为字符串 "null" 视同空。
 * 分类：有序规则表（seeds/运营维护），先命中先返回；DNAT 规则在锁定类之前（匹配层硬约束）。
 * 产品侧处理映射挂 L2 行（规则行 productAction）。
 */

/**
 * 日志行清洗（11-17 抽出共享）：剥时间戳/级别/线程/reqId/堆栈噪声，取核心语义。
 * 详情端点 diagnosisReport（五段之「关键证据/直接原因」）与本提取逻辑同源复用。
 * @param {string} line 原始日志行
 * @returns {string} 清洗后语义（可空）
 */
export function cleanLogLine(line) {
  return String(line || '')
    .replace(/\tat\s+[^\s]*/g, ' ')
    .replace(/\[\d{4}-\d{2}-\d{2}[^\]]*\]/g, ' ')
    .replace(/\[\s*(ERROR|WARN|FATAL|INFO)\s*\]/g, ' ')
    .replace(/\[[^\]]*exec-\d+[^\]]*\]/g, ' ')
    .replace(/\[reqId-[^\]]*\]/g, ' ')
    .replace(/\[[cC]\.[^\]]*:[0-9]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {string} diagnoseRaw diagnoseResult 原文（JSON 字符串或纯文本）
 * @param {string} errorMessage ELB errorMessage（EIP/VPC 传空）
 * @param {boolean} isElb
 * @returns {string} 分类输入文本（已拼接/截断/清洗）
 */
export function extractDiagnosticText(diagnoseRaw, errorMessage, isElb) {
  let text = ''
  const raw = String(diagnoseRaw || '').trim()
  if (raw) {
    try {
      const d = JSON.parse(raw)
      text = String(d?.final_conclusion ?? d?.conclusion ?? '').trim()
      // 真实 MCP log_search 返回（日志平台 JSON，11-09 实测）：提取失败上下文——
      // records 的 ERROR/WARN 日志行 + errorCode/errorMessage 字段，拼为分类输入。
      // 11-17 修复①无失败语义守卫：所选行既无 ERROR/WARN 级别又无 errorMessage/errorCode
      //   片段时，是正常调用日志（伪输入，曾致 22 组归兜底）→ 返回空文本归「诊断能力缺口」。
      // 11-17 修复②行级清洗：超长行（堆栈整行可 98k 字符）先剥日志前缀+堆栈噪声再取核心语义，
      //   防 ERROR 行语义被 WARN 行的 800 字窗口挤占（先例 #25 组：WARN 调用方法行 98k 字符，
      //   真正的「查询用户下角色信息异常」排第 2 行被截断）。
      if (!text && d?.code === '0000' && d?.data?.records) {
        /** @type {Array<{ content?: string, level?: string }>} */
        const records = Array.isArray(d.data.records) ? d.data.records : []
        const lines = records
          .map((r) => String(r?.content || '').trim())
          .filter(Boolean)
        const errLines = lines.filter((l) => /\[\s*(ERROR|WARN|FATAL)\s*\]/.test(l))
        const picked = (errLines.length > 0 ? errLines : lines).slice(0, 10)
        // 行内提取 errorMessage=/errorCode= 片段优先（根因关键词常在此）
        const frag = []
        for (const l of picked) {
          const m = /errorMessage=([^,\]]*)/.exec(l)
          if (m && m[1] && m[1] !== 'null') frag.push(m[1])
          const e = /errorCode=([^,\]]*)/.exec(l)
          if (e && e[1] && e[1] !== 'null') frag.push(`code=${e[1]}`)
        }
        // 无失败语义守卫：无 ERROR/WARN 行 且 无 errorMessage/errorCode 片段 → 空文本
        const hasErrorLevel = errLines.length > 0
        const hasErrorFrag = frag.length > 0
        if (!hasErrorLevel && !hasErrorFrag) return ''
        // 行级清洗（cleanLogLine 共享单源——详情端点五段同源复用）
        const cleaned = (frag.length > 0 ? frag : picked).map(cleanLogLine).filter(Boolean)
        text = cleaned.join('；').slice(0, 800)
      }
    } catch {
      text = raw.slice(0, 800) // 底稿：解析失败截取原文前 800 字
    }
  }
  // 字符串 "null" 视同空（样例实测 7 条；11-17：含尾随标点变体如 "null)" 一并视同）
  if (/^null[\s)）；;.,]*$/i.test(text)) text = ''
  // ELB 拼 errorMessage（底稿 §4：ELB 同时读 errorMessage；§5.1：前 40 字不在诊断中才拼）
  if (isElb) {
    const err = String(errorMessage || '').trim()
    if (err) {
      const prefix = err.slice(0, 40)
      if (!text.includes(prefix)) {
        text = text ? `${text}｜错误信息：${err}` : err
      }
    }
  }
  return text
}

/**
 * @param {string} text 分类输入（extractDiagnosticText 产出）
 * @param {import('./patrolSeeds.js').PatrolRootCauseRule[]} rules 有序规则（seed/运营维护）
 * @returns {{ l1: string, l2: string, productAction: '待处理' | '—', matchedOrder?: number }}
 */
export function classifyPatrolRootCause(text, rules) {
  const t = String(text || '')
  // 无诊断结论（文本与错误信息均空——错误信息已在输入构造层拼入）
  if (!t.trim()) {
    return { l1: '诊断能力缺口', l2: '无诊断结论', productAction: '—' }
  }

  const enabled = rules.filter((r) => r.enabled !== false)
  // 兜底规则恒在末位（防御：即使运营误删也能归兜底）
  const fallback = enabled.find((r) => r.isFallback)
  const ordered = [
    ...enabled.filter((r) => !r.isFallback),
    ...(fallback ? [fallback] : []),
  ]

  for (const rule of ordered) {
    if (ruleMatches(t, rule)) {
      return {
        l1: rule.l1,
        l2: rule.l2,
        productAction: rule.productAction === '—' ? '—' : '待处理',
        matchedOrder: rule.order,
      }
    }
  }
  // 无兜底规则配置（异常防御）：归其他&未归类
  return { l1: '其他&未归类', l2: '兜底', productAction: '待处理' }
}

/**
 * 规则匹配：或组合取一（组间 OR，组内 AND）> requiresAll（组间 AND，组内 OR）> anyOf（单组 OR）。
 * orGroups 与 requiresAll 可叠加（orGroups 命中后还须 requiresAll 全组满足）——表达底稿规则 6 的
 * "（锁定 或 冲突 或 IS_LOCKING 或（正处于 且 绑定/解绑））且（正在执行/正在进行/并发）"复合条件。
 * @param {string} text
 * @param {import('./patrolSeeds.js').PatrolRootCauseRule} rule
 */
function ruleMatches(text, rule) {
  const t = text
  let base = true
  if (Array.isArray(rule.orGroups) && rule.orGroups.length > 0) {
    base = rule.orGroups.some((group) =>
      Array.isArray(group) && group.length > 0 && group.every((kw) => t.includes(kw)),
    )
  } else if (Array.isArray(rule.anyOf) && rule.anyOf.length > 0) {
    base = rule.anyOf.some((kw) => t.includes(kw))
  }
  if (!base) return false
  if (Array.isArray(rule.requiresAll) && rule.requiresAll.length > 0) {
    return rule.requiresAll.every((group) =>
      Array.isArray(group) && group.length > 0 ? group.some((kw) => t.includes(kw)) : true,
    )
  }
  return true
}
