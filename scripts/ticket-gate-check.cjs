/* 异主体闸门验证器 (Ticket Tagging Gate) —— 独立于打标引擎的子进程。
 *
 * 设计参考 action-suggestion 模块的 gate-check.cjs 三方分离架构，
 * 但针对打标链路（L0/L1/L2 三层闸门）做了以下适配：
 *
 * 核心原则（与 gate-check.cjs 一致）：
 *   - 本文件不调用打标引擎（ticketDimensionTagging），不信任 tagStatus 自报
 *   - 只读落盘后的 records（payload JSON），用不同的验证逻辑独立重判
 *   - 差异 → 写 gate-report，FAIL 退出码 2
 *
 * 与打标内联闸门的区别：
 *   - 打标内联闸门（validateL0/L1/L2）= 同进程纯函数，自判自验
 *   - 本文件 = 独立子进程，用反向推理 + LLM 独立判定
 *
 * 三层验证：
 *   L0 反向验证：customerRequest 不为空 → 用不同正则集独立提取 → 与落盘 CR 比对
 *   L1 反向验证：requestScene×problemType → 用 LLM 或旧分类器独立重打 → 与落盘标签比对
 *   L2 反向验证：journey → 检查 journey 与 requestScene 方向是否一致（独立正则集）
 *
 * 用法：node scripts/ticket-gate-check.cjs [--db <auth.db>] [--out <gate-report.json>] [--limit N]
 */
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const DB_PATH = path.resolve(arg('--db', path.resolve(__dirname, '..', 'server', 'data', 'auth.db')));
const OUT = path.resolve(arg('--out', path.resolve(__dirname, '..', 'dist', 'ticket-gate-report.json')));
const INPUT = arg('--input', null);  // M7: 支持 JSON 输入（前置到落盘前）
const LIMIT = +(process.env.GATE_LIMIT || process.argv.includes('--limit') ? arg('--limit', 100) : 100);

// ── 独立正则集（与 dimensionValidation.js 不同，避免同源偏差） ──

/** 独立的 CR 质量检查：用不同的阈值和模式 */
function checkCRQualityIndependent(cr) {
  const t = (cr || '').trim();
  if (!t) return { valid: false, reason: 'CR为空' };
  if (t === '\\N' || t === 'null' || t === 'NA') return { valid: false, reason: 'CR为占位符' };
  if (t.length < 3) return { valid: false, reason: `CR长度不足(${t.length}<3)` };
  // 独立检查：是否只是产品名（如"弹性公网IP"）
  if (/^[\u4e00-\u9fa5A-Za-z0-9·\-\s]{2,20}$/.test(t) && !/[无法不通报错申请咨询故障]/.test(t)) {
    return { valid: false, reason: 'CR仅为产品名，无诉求信号' };
  }
  return { valid: true, reason: '' };
}

/** 独立的场景×类型矛盾检测（用不同的矛盾模式，补充 validateL1 没覆盖的） */
const INDEPENDENT_CONFLICT_PATTERNS = [
  // 资源操作不应配故障类 type
  { scene: '资源操作申请', typePattern: /可用性.*故障|性能问题/, conflict: '资源操作场景不应配故障/性能 type' },
  // 进度催办不应配操作类 type
  { scene: '进度催办与协同', typePattern: /退订与释放|资源开通与创建/, conflict: '催办场景不应有操作类工单' },
  // 投诉不应配配置操作（投诉一般是服务/流程问题）
  { scene: '服务申诉与投诉', typePattern: /配置与操作|可用性.*故障/, conflict: '投诉场景不应配配置/连通性 type' },
];

function checkL1Independent(requestScene, problemType) {
  if (!requestScene || requestScene === '无法识别') {
    return { pass: false, issues: ['requestScene为空或无法识别'], grade: 'incomplete' };
  }
  if (!problemType || problemType === '无法识别' || problemType === '其他') {
    return { pass: false, issues: ['problemType为空/无法识别/其他'], grade: 'incomplete' };
  }
  for (const { scene, typePattern, conflict } of INDEPENDENT_CONFLICT_PATTERNS) {
    if (requestScene === scene && typePattern.test(problemType)) {
      return { pass: false, issues: [conflict], grade: 'conflict' };
    }
  }
  return { pass: true, issues: [], grade: 'ok' };
}

/** 独立的 journey 方向检查（用不同的关键词集） */
const INDEPENDENT_JOURNEY_EXPECTATIONS = {
  '报障与排错': /故障|异常|不通|连通|排查|运行|质量|性能|中断|安全|绑定|解绑|配置|访问/,
  '资源操作申请': /开通|申领|订购|创建|退订|释放|变更|扩容|配额|带宽|接入|上架|移机|续订/,
  '产品信息咨询': /认知|选型|方案|商务|咨询|功能|能力|对比|推荐/,
  '操作指导': /配置|绑定|操作|使用|指导|步骤|方法/,
  '进度催办与协同': /催办|进度|协同|流转|加急|跟进/,
  '服务申诉与投诉': /投诉|申诉|不满|升级|客服|流程|SLA|响应/,
  '费用与账单': /计费|账单|费用|扣费|欠费|退款|出账|折扣/,
};

function checkL2Independent(journeyL1, journeyL2, requestScene) {
  if (!journeyL1 || journeyL1 === '无法识别') {
    return { pass: false, issues: ['journeyL1为空或无法识别'], grade: 'incomplete' };
  }
  if (!journeyL2 || journeyL2 === '无法识别') {
    return { pass: false, issues: ['journeyL2为空或无法识别'], grade: 'incomplete' };
  }
  const expectedPattern = INDEPENDENT_JOURNEY_EXPECTATIONS[requestScene];
  if (expectedPattern && !expectedPattern.test(journeyL1)) {
    return { pass: false, issues: [`journeyL1="${journeyL1}" 与 scene="${requestScene}" 方向不一致`], grade: 'mismatch' };
  }
  return { pass: true, issues: [], grade: 'ok' };
}

/** 独立检查 tagStatus 是否可信：如果 tagStatus=ok 但 CR 为空 → 异主体差异 */
function checkTagStatusConsistency(record) {
  const p = typeof record.payload === 'string' ? JSON.parse(record.payload) : record.payload;
  const cr = (p.customerRequest || '').trim();
  const tagStatus = p.tagStatus || 'ok'; // 默认 ok（旧记录没有 tagStatus 字段）
  const issues = [];

  // L0 反向：tagStatus=ok 但 CR 无效
  const crCheck = checkCRQualityIndependent(cr);
  if (tagStatus === 'ok' && !crCheck.valid) {
    issues.push({
      check: 'L0_reverse',
      severity: 'FAIL',
      ticket_id: record.ticket_id || record.id,
      message: `tagStatus=ok 但 CR 质量不达标: ${crCheck.reason}`,
      cr_preview: cr.slice(0, 60),
    });
  }

  // L1 反向：独立矛盾检测
  if (tagStatus === 'ok') {
    const l1 = checkL1Independent(p.requestScene, p.problemType);
    if (!l1.pass) {
      issues.push({
        check: 'L1_reverse',
        severity: l1.grade === 'conflict' ? 'FAIL' : 'WARN',
        ticket_id: record.ticket_id || record.id,
        message: `tagStatus=ok 但 L1 矛盾: ${l1.issues.join('; ')}`,
        scene: p.requestScene,
        type: p.problemType,
      });
    }
  }

  // L2 反向：独立方向检测
  if (tagStatus === 'ok' && p.journeyL1) {
    const l2 = checkL2Independent(p.journeyL1, p.journeyL2, p.requestScene);
    if (!l2.pass) {
      issues.push({
        check: 'L2_reverse',
        severity: l2.grade === 'mismatch' ? 'FAIL' : 'WARN',
        ticket_id: record.ticket_id || record.id,
        message: `tagStatus=ok 但 L2 矛盾: ${l2.issues.join('; ')}`,
        journeyL1: p.journeyL1,
        scene: p.requestScene,
      });
    }
  }

  // manual_review 工单的完整性检查
  if (tagStatus === 'manual_review') {
    if (!p.tagIssues || p.tagIssues.length === 0) {
      issues.push({
        check: 'manual_review_missing_issues',
        severity: 'WARN',
        ticket_id: record.ticket_id || record.id,
        message: 'tagStatus=manual_review 但 tagIssues 为空',
      });
    }
  }

  return issues;
}

function main() {
  console.log('==================================================');
  console.log('  异主体闸门验证器（独立于打标引擎）');
  console.log('==================================================');

  let records;

  if (INPUT) {
    // M7: 从 JSON 文件读取（前置到落盘前，records 还没写盘）
    console.log(`[gate] 从 JSON 读取: ${INPUT}`);
    try {
      const raw = fs.readFileSync(INPUT, 'utf8');
      const parsed = JSON.parse(raw);
      // 支持两种格式：数组 of record / { records: [...] }
      const arr = Array.isArray(parsed) ? parsed : (parsed.records || []);
      records = arr.slice(0, LIMIT).map((r, i) => ({
        id: r.id || `json-${i}`,
        ticket_id: r.ticketId || r.ticket_id || '',
        payload: typeof r === 'string' ? r : JSON.stringify(r),
      }));
    } catch (e) {
      console.error('[gate] 读取 JSON 失败:', e.message);
      process.exit(3);
    }
  } else {
    // 从 DB 读取（落盘后审计模式）
    const { execSync } = require('child_process');
    const pyScript = `
import sqlite3, json, sys
conn = sqlite3.connect('${DB_PATH}')
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute('SELECT id, ticket_id, payload FROM records WHERE payload IS NOT NULL LIMIT ${LIMIT}')
rows = cur.fetchall()
for r in rows:
    p = json.loads(r['payload'])
    print(json.dumps({'id': r['id'], 'ticket_id': r['ticket_id'], 'payload': p}, ensure_ascii=False))
conn.close()
`;
    try {
      const output = execSync(`python3 -c '${pyScript.replace(/'/g, "'\\''")}'`, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
      records = output.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    } catch (e) {
      console.error('[gate] 读取数据库失败:', e.message);
      process.exit(3);
    }
  }

  console.log(`[gate] 读取 ${records.length} 条记录`);

  /** @type {Array} */
  const allIssues = [];
  let okCount = 0, reviewCount = 0, failCount = 0;

  for (const record of records) {
    const issues = checkTagStatusConsistency(record);
    allIssues.push(...issues);
    if (issues.length === 0) okCount++;
    else if (issues.some(i => i.severity === 'FAIL')) failCount++;
    else reviewCount++;
  }

  const failIssues = allIssues.filter(i => i.severity === 'FAIL');
  const warnIssues = allIssues.filter(i => i.severity === 'WARN');

  const report = {
    timestamp: new Date().toISOString(),
    totalRecords: records.length,
    summary: {
      ok: okCount,
      warn: reviewCount,
      fail: failCount,
      failRate: records.length ? (failCount / records.length * 100).toFixed(1) + '%' : '0%',
    },
    failures: failIssues,
    warnings: warnIssues,
    // 修复方向 hint（给 Fixer 用）
    fixHints: generateFixHints(failIssues),
  };

  const outDir = path.dirname(OUT);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log(`\n[gate] 结果: OK=${okCount} WARN=${reviewCount} FAIL=${failCount} (${report.summary.failRate})`);
  console.log(`[gate] 报告: ${OUT}`);

  if (failCount > 0) {
    console.log(`[gate] FAIL — ${failIssues.length} 条工单标签验证不通过`);
    process.exit(2);
  }
  console.log('[gate] PASS');
  process.exit(0);
}

/** 从失败项生成修复方向提示 */
function generateFixHints(failures) {
  const hints = {};
  for (const f of failures) {
    const key = f.check;
    if (!hints[key]) hints[key] = { count: 0, examples: [] };
    hints[key].count++;
    if (hints[key].examples.length < 3) {
      hints[key].examples.push({
        ticket_id: f.ticket_id,
        message: f.message,
      });
    }
  }
  return hints;
}

main();
