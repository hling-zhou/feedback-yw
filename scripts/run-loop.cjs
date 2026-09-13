/* 自适应闭环编排器（三方分离的"总指挥"）—— 本身不做分类、不判定、不改分类法。
 *
 * 每轮依次 spawn 三个【互相独立】的子进程：
 *   1) Producer  (validate-action-recs.cjs --emit)  → 写 dist 产物（不自判）
 *   2) Gate      (gate-check.cjs)                   → 独立重算 26 项，FAIL 退出码 2
 *   3) Fixer     (fix-classification.cjs)           → 独立读证据，外科式改分类法（仅写 overrides 增量）
 * 门禁通过即停（可发布）；有界 5 轮仍不过 / 数据级失败 / Fixer 无可修项 → 升级人工并附 changelog。
 * 任何一方都不信任另一方的产物：Gate 重算 Producer 的自报数；Fixer 不读 Producer 内存、只读书面证据。
 *
 * 用法：node scripts/run-loop.cjs            （默认作用域=4 curated；可用 PRODUCTS=* 或 PRODUCTS=a,b 同前缀环境变量）
 *       KEEP_OVERRIDES=1 保留上一轮 overrides；否则每次启动清空（干净可复现）。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const NODE = process.env.NODE_BIN || process.execPath || 'node';
const SCRIPT_DIR = __dirname;
const OVERRIDES_PATH = path.resolve(SCRIPT_DIR, 'taxonomy-overrides.json');
const DIST = path.resolve(SCRIPT_DIR, '..', 'dist');
const MAX = Math.max(1, +(process.env.GATE_MAX_ATTEMPTS || 5));

function run(script, env) {
  const fullEnv = { ...process.env, ...env };
  try {
    const out = execFileSync(NODE, [path.join(SCRIPT_DIR, script)], { encoding: 'utf8', env: fullEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout || '') + (e.stderr || '') };
  }
}

function main() {
  console.log('==================================================');
  console.log('  自适应闭环（写/复核/修 三方独立子进程）  有界 ' + MAX + ' 轮');
  console.log('==================================================');
  if (!process.env.KEEP_OVERRIDES && fs.existsSync(OVERRIDES_PATH)) {
    fs.rmSync(OVERRIDES_PATH);
    console.log('[loop] 已清空上一轮 overrides（干净启动；KEEP_OVERRIDES=1 可保留）');
  }

  let success = false, lastReport = null, escalate = null;
  for (let attempt = 1; attempt <= MAX; attempt++) {
    console.log(`\n----------- 第 ${attempt}/${MAX} 轮 -----------`);
    const prod = run('validate-action-recs.cjs', { EMIT_RESULTS: '1' });
    if (prod.code !== 0) { escalate = { fatal: 'Producer 运行失败', log: prod.out }; break; }

    const gate = run('gate-check.cjs');
    if (gate.code === 0) { success = true; lastReport = JSON.parse(fs.readFileSync(path.join(DIST, 'gate-report.json'), 'utf8')); break; }
    if (gate.code === 3) { escalate = { fatal: 'Gate 致命错误', log: gate.out }; break; }
    lastReport = JSON.parse(fs.readFileSync(path.join(DIST, 'gate-report.json'), 'utf8'));

    const dataFatal = (lastReport.failures || []).some(f => f.check.startsWith('解析') || f.check.startsWith('完整性'));
    if (dataFatal) { escalate = { fatal: '数据级/完整性失败，机制无法自动修', log: summarize(lastReport) }; break; }

    const fix = run('fix-classification.cjs');
    if (fix.code === 1) { escalate = { fatal: 'Fixer 无可修项，需人工', log: summarize(lastReport) + '\n' + fix.out }; break; }
    if (fix.code !== 0) { escalate = { fatal: 'Fixer 致命错误', log: fix.out }; break; }
    // code 0 → 已应用改动，进入下一轮复跑
  }

  console.log('\n==================================================');
  if (success) {
    const n = (lastReport.checks || []).length;
    const pass = (lastReport.checks || []).filter(c => c.level === 'PASS').length;
    console.log(`[OK] 第三方门禁通过（${pass}/${n}），可发布。`);
    console.log('  发布前请确保：docs/变更日志-* 中的机器改动已人工过目（可审计、可回滚）。');
    process.exit(0);
  } else {
    console.log('[ESCALATE] 门禁未通过，需人工介入（不发布）。');
    if (escalate) {
      console.log('  原因：' + escalate.fatal);
      console.log(escalate.log || '');
    }
    console.log('  修复轨迹见 docs/变更日志-*.md；机器增量见 scripts/taxonomy-overrides.json（可删除回滚）。');
    process.exit(2);
  }
}

function summarize(report) {
  const lines = ['  门禁失败项：'];
  for (const f of (report.failures || [])) lines.push(`   - [${f.product}] ${f.check}: ${f.detail}${f.derived ? '（派生草稿·需人工注册）' : ''}`);
  return lines.join('\n');
}

try { main(); }
catch (e) { console.error('[run-loop] 致命错误:', e.message); process.exit(3); }
