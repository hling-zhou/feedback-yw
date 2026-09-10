/* 异主体闸门闭环编排器 (Ticket Tagging Gate Loop) —— 依次 spawn 三个独立子进程。
 *
 * 架构参考 action-suggestion 模块的 run-loop.cjs，适配打标链路：
 *   1) Gate  (ticket-gate-check.cjs)  → 独立验证标签
 *   2) Fixer (ticket-gate-fix.cjs)    → 独立读报告，外科式修复
 *   3) (可选) Apply 修复 → 重跑 Gate 验证
 *
 * 三方互相独立：Gate 不调打标引擎；Fixer 不读 Gate 内存、只读书面报告。
 * 有界 3 轮：Gate 通过即停；Fixer 无可修项或 3 轮仍不过 → 升级人工。
 *
 * 用法：
 *   落盘后审计: node scripts/ticket-gate-loop.cjs [--db <auth.db>] [--limit N]
 *   前置模式:    node scripts/ticket-gate-loop.cjs --input <records.json> [--limit N]
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE = process.env.NODE_BIN || '/Users/UI/.workbuddy/binaries/node/versions/22.22.2-2/bin/node';
const SCRIPT_DIR = __dirname;
const DIST = path.resolve(SCRIPT_DIR, '..', 'dist');
const MAX = Math.max(1, +(process.env.GATE_MAX_ATTEMPTS || 3));

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const INPUT = arg('--input', null);

function run(script, args = [], env = {}) {
  const fullEnv = { ...process.env, ...env };
  try {
    const out = execFileSync(NODE, [path.join(SCRIPT_DIR, script), ...args], {
      encoding: 'utf8',
      env: fullEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function summarize(report) {
  if (!report) return '(无报告)';
  return `OK=${report.summary.ok} WARN=${report.summary.warn} FAIL=${report.summary.fail} (${report.summary.failRate})`;
}

function main() {
  console.log('==================================================');
  console.log('  异主体闸门闭环（Gate/Fixer 独立子进程）  有界 ' + MAX + ' 轮');
  if (INPUT) {
    console.log('  前置模式: input=' + INPUT);
  }
  console.log('==================================================');

  let success = false, lastReport = null, escalate = null;

  for (let attempt = 1; attempt <= MAX; attempt++) {
    console.log(`\n----------- 第 ${attempt}/${MAX} 轮 -----------`);

    // 1. Gate 验证
    const gateArgs = [];
    if (INPUT) gateArgs.push('--input', INPUT);
    const gate = run('ticket-gate-check.cjs', gateArgs);
    if (gate.code === 0) {
      success = true;
      lastReport = JSON.parse(fs.readFileSync(path.join(DIST, 'ticket-gate-report.json'), 'utf8'));
      break;
    }
    if (gate.code === 3) {
      escalate = { fatal: 'Gate 致命错误', log: gate.out };
      break;
    }

    lastReport = JSON.parse(fs.readFileSync(path.join(DIST, 'ticket-gate-report.json'), 'utf8'));
    console.log(`  Gate: ${summarize(lastReport)}`);

    // 2. Fixer 修复
    const fixArgs = [];
    if (INPUT) fixArgs.push('--input', INPUT);
    const fix = run('ticket-gate-fix.cjs', fixArgs);
    if (fix.code === 1) {
      // needs_human → 但前置模式下 Fixer 已直接标了 manual_review
      // 检查是否有 fix-actions（L1 修复了部分）
      console.log('  Fixer: 部分升级人工（已标 manual_review）');
      // 前置模式下，即使有 needs_human，records 已被更新
      if (INPUT) {
        // 更新 input 文件为修复后的 records
        const gatedPath = path.resolve(DIST, 'ticket-records-gated.json');
        if (fs.existsSync(gatedPath)) {
          fs.copyFileSync(gatedPath, INPUT);
          console.log('  Fixer: 已更新 input 文件');
        }
      }
      // 继续下一轮 Gate 复验（已标 manual_review 的会被 Gate 跳过）
      continue;
    }
    if (fix.code !== 0) {
      escalate = { fatal: 'Fixer 致命错误', log: fix.out };
      break;
    }
    // code 0 → 已写修复指令
    console.log('  Fixer: 已写修复指令');

    // 前置模式下，更新 input 文件为修复后的 records
    if (INPUT) {
      const gatedPath = path.resolve(DIST, 'ticket-records-gated.json');
      if (fs.existsSync(gatedPath)) {
        fs.copyFileSync(gatedPath, INPUT);
        console.log('  Fixer: 已更新 input 文件');
      }
    }
  }

  console.log('\n==================================================');
  if (success) {
    console.log('  PASS — 异主体闸门验证通过');
    console.log('  ' + summarize(lastReport));
    process.exit(0);
  }
  if (escalate) {
    console.log('  ESCALATE — 升级人工');
    console.log('  原因: ' + escalate.fatal);
    if (escalate.log) console.log(escalate.log);
    process.exit(2);
  }
  // 前置模式：超轮次但有修复后的 records，返回 exit 1（部分通过）
  if (INPUT) {
    console.log('  PARTIAL — 部分通过，manual_review 工单已标记');
    process.exit(1);
  }
  console.log('  超出最大轮次，升级人工');
  process.exit(2);
}

main();
