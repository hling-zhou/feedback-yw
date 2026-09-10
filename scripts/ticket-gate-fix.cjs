/* 异主体闸门修复器 (Ticket Tagging Fixer) —— 独立于打标引擎和闸门验证器。
 *
 * 设计参考 action-suggestion 模块的 fix-classification.cjs 三方分离架构。
 *
 * 核心原则：
 *   - 本文件不调用打标引擎，不信任 Gate 的判定
 *   - 只读 Gate 报告 + records，独立判断能否修复
 *   - 能修则写修复指令（JSON 增量），不直接改 records
 *   - 不能修则标 needs_human 升级人工
 *
 * 修复策略（第三方有权修订）：
 *   A. tagStatus=ok 但 CR 质量不达标 → 标 needs_human（CR 提取是规则引擎职责，Fixer 不改规则）
 *   B. tagStatus=ok 但 L1 矛盾 → 尝试用 Gate 的矛盾方向修正标签 → 写修复指令
 *   C. tagStatus=ok 但 L2 矛盾 → 标 needs_human（journey 匹配是规则引擎职责）
 *   D. manual_review 缺 issues → 补充 issues 标记
 *
 * 均只能收紧/升人工，不能放水。
 *
 * 用法：node scripts/ticket-gate-fix.cjs [--report <gate-report.json>] [--out <fix-actions.json>]
 */
const fs = require('fs');
const path = require('path');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const REPORT = path.resolve(arg('--report', path.resolve(__dirname, '..', 'dist', 'ticket-gate-report.json')));
const OUT = path.resolve(arg('--out', path.resolve(__dirname, '..', 'dist', 'ticket-fix-actions.json')));
const INPUT = arg('--input', null);  // M7: 支持 JSON 输入（前置模式，直接修改 records）

/** L1 矛盾的修复方向：基于 Gate 发现的 conflict 模式反推正确标签 */
const L1_CONFLICT_FIX_MAP = {
  '资源操作场景不应配故障/性能 type': {
    fixScene: '报障与排错',
    fixType: null, // 保持原 type，改 scene
    reason: 'type=故障/性能 → scene 应为报障，非资源操作',
  },
  '催办场景不应有操作类工单': {
    fixScene: '资源操作申请',
    fixType: null,
    reason: 'type=操作类 → scene 应为资源操作，非催办',
  },
  '投诉场景不应配配置/连通性 type': {
    fixScene: null, // 保持原 scene
    fixType: '人工服务与流程',
    reason: 'scene=投诉 → type 应为人工服务与流程，非配置/连通性',
  },
};

function main() {
  console.log('==================================================');
  console.log('  异主体闸门修复器（独立于打标引擎和闸门验证器）');
  console.log('==================================================');

  if (!fs.existsSync(REPORT)) {
    console.error('[fixer] Gate 报告不存在:', REPORT);
    process.exit(3);
  }

  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const failures = report.failures || [];

  if (!failures.length) {
    console.log('[fixer] 无 FAIL 项，无需修复');
    process.exit(0);
  }

  console.log(`[fixer] 处理 ${failures.length} 条 FAIL 项`);

  // M7: 前置模式——读取输入 records 并直接应用修复
  let inputRecords = null;
  if (INPUT) {
    try {
      const raw = fs.readFileSync(INPUT, 'utf8');
      const parsed = JSON.parse(raw);
      inputRecords = Array.isArray(parsed) ? parsed : (parsed.records || []);
      console.log(`[fixer] 前置模式: 读取 ${inputRecords.length} 条 records`);
    } catch (e) {
      console.error('[fixer] 读取输入 records 失败:', e.message);
      process.exit(3);
    }
  }

  /** @type {Array} 修复动作 */
  const fixActions = [];
  /** @type {Array} 需人工处理 */
  const needsHuman = [];

  for (const f of failures) {
    // L0 reverse：CR 质量问题 → needs_human（Fixer 不改 CR 提取规则）
    if (f.check === 'L0_reverse') {
      // M7: 前置模式下直接标 manual_review
      if (inputRecords) {
        const rec = inputRecords.find(r => (r.ticketId || r.ticket_id || r.id) === f.ticket_id);
        if (rec) {
          rec.tagStatus = 'manual_review';
          rec.tagIssues = [...(rec.tagIssues || []), `异主体闸门 L0 复验失败: ${f.message}`];
        }
      }
      needsHuman.push({
        ticket_id: f.ticket_id,
        issue: f.message,
        reason: 'CR 提取是规则引擎职责，Fixer 不改规则；需人工审查 CR 提取逻辑',
      });
      continue;
    }

    // L1 reverse：矛盾 → 尝试修复
    if (f.check === 'L1_reverse') {
      const fixEntry = Object.entries(L1_CONFLICT_FIX_MAP).find(
        ([pattern]) => f.message.includes(pattern.split(' → ')[0].split('不应')[0]),
      );
      if (fixEntry) {
        const [pattern, fix] = fixEntry[1];
        if (inputRecords) {
          const rec = inputRecords.find(r => (r.ticketId || r.ticket_id || r.id) === f.ticket_id);
          if (rec) {
            if (fix.fixScene) rec.requestScene = fix.fixScene;
            if (fix.fixType) rec.problemType = fix.fixType;
            rec.tagIssues = [...(rec.tagIssues || []), `异主体闸门 L1 修复: ${fix.reason}`];
          }
        }
        fixActions.push({
          ticket_id: f.ticket_id,
          type: 'adjust_tag',
          field: fix.fixScene ? 'requestScene' : 'problemType',
          old_value: fix.fixScene ? f.scene : f.type,
          new_value: fix.fixScene || fix.fixType,
          reason: fix.reason,
        });
      } else {
        if (inputRecords) {
          const rec = inputRecords.find(r => (r.ticketId || r.ticket_id || r.id) === f.ticket_id);
          if (rec) {
            rec.tagStatus = 'manual_review';
            rec.tagIssues = [...(rec.tagIssues || []), `异主体闸门 L1 矛盾无匹配修复: ${f.message}`];
          }
        }
        needsHuman.push({
          ticket_id: f.ticket_id,
          issue: f.message,
          reason: 'L1 矛盾无匹配修复模式',
        });
      }
      continue;
    }

    // L2 reverse：journey 矛盾 → needs_human
    if (f.check === 'L2_reverse') {
      if (inputRecords) {
        const rec = inputRecords.find(r => (r.ticketId || r.ticket_id || r.id) === f.ticket_id);
        if (rec) {
          rec.tagStatus = 'manual_review';
          rec.tagIssues = [...(rec.tagIssues || []), `异主体闸门 L2 复验失败: ${f.message}`];
        }
      }
      needsHuman.push({
        ticket_id: f.ticket_id,
        issue: f.message,
        reason: 'journey 匹配是规则引擎职责，Fixer 不改 journey 匹配逻辑',
      });
      continue;
    }

    // 其他 → needs_human
    if (inputRecords) {
      const rec = inputRecords.find(r => (r.ticketId || r.ticket_id || r.id) === f.ticket_id);
      if (rec) {
        rec.tagStatus = 'manual_review';
        rec.tagIssues = [...(rec.tagIssues || []), `异主体闸门未知失败: ${f.message}`];
      }
    }
    needsHuman.push({
      ticket_id: f.ticket_id,
      issue: f.message,
      reason: '未知失败类型',
    });
  }

  // M7: 前置模式下输出修复后的 records
  if (inputRecords) {
    const fixedPath = path.resolve(OUT, '..', 'ticket-records-gated.json');
    fs.writeFileSync(fixedPath, JSON.stringify(inputRecords, null, 2));
    console.log(`[fixer] 前置模式: 输出修复后 records → ${fixedPath}`);
  }

  const result = {
    timestamp: new Date().toISOString(),
    totalFailures: failures.length,
    fixActions: fixActions.length,
    needsHuman: needsHuman.length,
    actions: fixActions,
    needsHuman,
  };

  const outDir = path.dirname(OUT);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 2));

  console.log(`\n[fixer] 修复: ${fixActions.length} 条, 升级人工: ${needsHuman.length} 条`);
  console.log(`[fixer] 输出: ${OUT}`);

  if (needsHuman.length > 0) {
    console.log(`[fixer] ${needsHuman.length} 条需人工处理`);
    process.exit(1); // 有 needs_human → 退出码 1
  }
  process.exit(0);
}

main();
