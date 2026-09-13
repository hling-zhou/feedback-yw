/* 第三方门禁（自动复核）—— 与"写(Producer)/修(Fixer)"完全独立的子进程。
 *
 * 治理原则：本文件不调用分类引擎、不读 records、不信任 Producer 的自报聚合数。
 * 它只读取 Producer 写出的产物（pipeline-results.json + evidence-rows.json + taxonomy-current.json），
 * 并用 evidence-rows 里逐工单的 status 独立重算 未归类率/待确认率，
 * 若与 Producer 自报数不一致 → 触发"完整性"失败（三方互相校验的抓手）。
 *
 * 两层检查：
 *   层 1（完整性+率）：独立重算未归类率/待确认率、小而锐、横切项、出处标注
 *   层 2（分类准确性，借鉴 ticket-intel eval harness）：
 *     A 独立再分类（全量）：对每张 classified 工单，用 family 正则独立打分，
 *       断言 Producer 指派家族 = 门禁 top-1（或在 top-3 且领先 #2 ≤1 hit 的 margin 内）。
 *     B 排除失效：指派家族的 exclude 正则命中该工单 → FAIL。
 *     C 泛词误吸嫌疑：家族种子词中泛词（≥3 家族共用）占比 > 40% → WARN。
 *     D 多数类基线 + 混淆方向（信息性，非 pass/fail）。
 *
 * 输出 gate-report.json（含结构化失败 + 证据工单 + 修复方向 hint + 准确性指标），FAIL 退出码 2。
 *
 * 用法：node scripts/gate-check.cjs [--in <results.json>] [--evidence <evidence.json>] [--tax <taxonomy-current.json>] [--out <gate-report.json>]
 */
const fs = require('fs');
const path = require('path');
const DOCS = path.resolve(__dirname, '..', 'docs');
const DIST = path.resolve(__dirname, '..', 'dist');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const IN = path.resolve(arg('--in', path.join(DIST, 'pipeline-results.json')));
const EVID = path.resolve(arg('--evidence', path.join(DIST, 'evidence-rows.json')));
const TAX_CUR = path.resolve(arg('--tax', path.join(DIST, 'taxonomy-current.json')));
const OUT = path.resolve(arg('--out', path.join(DIST, 'gate-report.json')));

const MAX_UNC = +(process.env.GATE_MAX_UNCLASSIFIED || 5);
const MAX_PEND = +(process.env.GATE_MAX_PENDING || 20);
const MAX_MISMATCH = +(process.env.GATE_MAX_MISMATCH || 15); // 误归属率阈值（%）

/* ─── 分类准确性评估（借鉴 ticket-intel eval harness）──────────────────
 * 独立于 Producer 的轻量再分类校验，解决"门禁只查率不查对不对"的盲点。
 *
 * 注意：evidence-rows 的 text = 问题原因+需求痛点(80字截断)，比 Producer 的
 * 三段真声(voiceOf+痛点+cleanReason)短。因此门禁"匹配不到"不代表 Producer
 * 错——但"匹配到了别的家族"是更强的误归属信号。
 * ─────────────────────────────────────────────────────────────────────── */
const RE_META_G = /[\\^$.*+?()[\]{}|]/;

/** 从 taxonomy-current.json 的 family 正则源串构建轻量匹配器 */
function buildFamMatchers(taxProduct) {
  return (taxProduct.families || []).map(f => {
    const terms = String(f.re || '').split('|').map(t => t.trim()).filter(t => t.length >= 2);
    const matchers = terms.map(t => {
      try {
        if (!RE_META_G.test(t)) return { w: t, test: txt => txt.indexOf(t) >= 0 };
        const rx = new RegExp(t, 'i');
        return { w: t, test: txt => rx.test(txt) };
      } catch { return null; }
    }).filter(Boolean);
    let reExc = null;
    try { reExc = f.exclude ? new RegExp(f.exclude, 'i') : null; } catch {}
    return { key: f.key, name: f.name, matchers, reExc, terms };
  });
}

/** 轻量打分：对每家族统计命中种子词数（无 IDF 加权，纯计数） */
function scoreTicketLite(text, famMatchers) {
  if (!text) return [];
  const scores = [];
  for (const fam of famMatchers) {
    let hits = 0;
    for (const m of fam.matchers) { if (m.test(text)) hits++; }
    scores.push({ key: fam.key, name: fam.name, hits });
  }
  scores.sort((a, b) => b.hits - a.hits);
  return scores;
}

function main() {
  const res = JSON.parse(fs.readFileSync(IN, 'utf8'));
  const ev = JSON.parse(fs.readFileSync(EVID, 'utf8'));
  const evByP = new Map(ev.map(e => [e.p, e.rows]));
  const checks = [];
  const push = (name, ok, detail, level) => checks.push({ name, ok, detail, level: level || (ok ? 'PASS' : 'FAIL') });

  // —— 1) 解析完整性（来自 dataMeta，独立重算）——
  const dm = res.dataMeta;
  const unparsed = (dm.sheets || []).filter(m => !m.src || !m.month);
  push('解析·sheet维度', unparsed.length === 0,
    unparsed.length ? `${unparsed.length} 个 sheet 未解析来源/月份` : `${(dm.sheets || []).length} 个 sheet 均解析「来源+月份」`);
  const emptySheets = (dm.sheets || []).filter(m => m.rows === 0);
  push('解析·非空', emptySheets.length === 0 && dm.rows > 0,
    emptySheets.length ? `空 sheet：${emptySheets.map(m => m.sheet).join('、')}` : `共 ${dm.rows} 行，${(dm.sheets || []).length} 个 sheet 均非空`);
  push('解析·月份覆盖', (dm.months || []).length >= 2, `月份 ${(dm.months || []).join('、') || '无'}（需 ≥2 月）`);
  push('解析·来源类型', (dm.srcs || []).length >= 2, `来源 ${(dm.srcs || []).join('、') || '无'}（需含投诉与咨询）`);
  push('解析·工单号', (dm.missingId || 0) === 0, `缺工单号 ${dm.missingId || 0} 行`);
  push('解析·产品名称', (dm.missingProd || 0) === 0, `缺产品名称 ${dm.missingProd || 0} 行`);

  const failures = [];
  const accuracyByProduct = [];

  // 加载 taxonomy-current.json 供分类准确性评估（层 2）
  let taxByP = null;
  try {
    const taxCur = JSON.parse(fs.readFileSync(TAX_CUR, 'utf8'));
    taxByP = new Map(taxCur.map(t => [t.p, t]));
  } catch { /* taxonomy-current.json 不存在——跳过准确性检查 */ }

  // —— 2~5) 逐产品：独立重算率，并做完整性校验 ——
  for (const s of res.products) {
    const rows = evByP.get(s.p) || [];
    const T = s.T;
    const recomputedUnc = rows.filter(r => r.status === 'unclassified').length;
    const recomputedPend = rows.filter(r => r.status === 'pending').length;
    const uncRate = recomputedUnc / T * 100;
    const pendRate = recomputedPend / T * 100;
    // 完整性：重算数与 Producer 自报数偏差 > 容差 → 互相校验失败
    const integrityOk = Math.abs(recomputedUnc - s.unclassified) <= Math.max(1, Math.ceil(0.01 * T))
                     && Math.abs(recomputedPend - (s.pending || 0)) <= Math.max(1, Math.ceil(0.01 * T));
    push(`完整性·${s.p}`, integrityOk,
      integrityOk ? `重算未归类 ${recomputedUnc} / 待确认 ${recomputedPend} 与自报一致`
                 : `重算未归类 ${recomputedUnc}(自报${s.unclassified}) / 待确认 ${recomputedPend}(自报${s.pending}) 偏差超容差`);

    push(`未归类率·${s.p}`, uncRate < MAX_UNC, `${uncRate.toFixed(1)}%（阈值 <${MAX_UNC}%）${s.derived ? ' [派生草稿·待确认]' : ''}`);
    push(`待确认率·${s.p}`, pendRate < MAX_PEND, `${pendRate.toFixed(1)}%（阈值 <${MAX_PEND}%）${s.derived ? ' [派生草稿·待确认]' : ''}`);

    const badSharp = (s.items || []).filter(i => i.tier === 'sharp' && i.n < 3);
    push(`小而锐样本·${s.p}`, badSharp.length === 0,
      badSharp.length ? `${badSharp.length} 项 n<3：${badSharp.slice(0, 3).map(i => `${i.sub}(${i.n})`).join('、')}` : '均满足 n≥3');

    const TIERS5 = ['structural', 'change', 'sharp', 'iteration', 'tail'];
    const badCross = (s.items || []).filter(i => i.crossCut && TIERS5.includes(i.tier));
    push(`横切项单列·${s.p}`, badCross.length === 0, badCross.length ? `${badCross.length} 个横切项混入 5 层` : '横切项已单列');

    let txt = '';
    try { txt = fs.readFileSync(path.join(DOCS, `行动建议-${s.p}-验证.md`), 'utf8'); } catch { /* noop */ }
    const annotated = txt.includes('〔痛点摘要〕') || txt.includes('〔复核根因〕');
    push(`出处标注·${s.p}`, annotated, annotated ? '已标注〔痛点摘要〕/〔复核根因〕' : '未检出分析层标注，疑似裸引');

    // 收集失败项（含证据），供 Fixer 独立消费
    const collect = (checkName, fixHint) => {
      const c = checks.find(x => x.name === checkName);
      if (c && c.level === 'FAIL') {
        const evRows = rows.filter(r => {
          if (checkName.startsWith('未归类率')) return r.status === 'unclassified';
          if (checkName.startsWith('待确认率')) return r.status === 'pending';
          return false;
        }).slice(0, 12).map(r => ({ id: r.id, text: r.text, fam: r.fam || null }));
        failures.push({ check: checkName, product: s.p, derived: !!s.derived, detail: c.detail, evidence: evRows, fixHint });
      }
    };
    collect(`未归类率·${s.p}`, 'add_coverage');
    collect(`待确认率·${s.p}`, 'restrict_overbroad');

    // —— 6) 分类准确性评估（借鉴 ticket-intel eval harness）——
    if (taxByP) {
      const taxP = taxByP.get(s.p);
      if (taxP) {
        const famMatchers = buildFamMatchers(taxP);
        const classified = rows.filter(r => r.status === 'classified' && r.fam);

        // A) 独立再分类校验（全量轻量打分）
        let mismatches = 0, noMatch = 0, agreeCount = 0, marginAgree = 0;
        const mismatchDetails = [];
        const confusionPairs = {};

        for (const r of classified) {
          const scores = scoreTicketLite(r.text, famMatchers);
          const top = scores[0];
          const gateFam = (top && top.hits > 0) ? top.key : '_none';
          // 混淆矩阵
          const cmKey = r.fam + '\u2192' + gateFam;
          confusionPairs[cmKey] = (confusionPairs[cmKey] || 0) + 1;

          if (!top || top.hits === 0) { noMatch++; continue; } // 门禁文本太短，无法独立验证
          if (top.key === r.fam) { agreeCount++; }
          else {
            // Producer 指派家族在门禁 top-3 且与 top-1 差距 ≤1 hit → margin 同意
            const pRank = scores.findIndex(x => x.key === r.fam);
            if (pRank >= 0 && pRank < 3 && top.hits - scores[pRank].hits <= 1) { marginAgree++; }
            else {
              mismatches++;
              if (mismatchDetails.length < 12) mismatchDetails.push({
                id: r.id, text: (r.text || '').slice(0, 60),
                producerFam: r.fam, gateFam: top.key,
                gateHits: top.hits, producerHits: pRank >= 0 ? scores[pRank].hits : 0,
              });
            }
          }
        }

        const total = classified.length;
        const accuracy = total ? ((agreeCount + marginAgree) / total * 100) : 0;
        const mismatchRate = total ? (mismatches / total * 100) : 0;
        const noMatchRate = total ? (noMatch / total * 100) : 0;

        // 多数类基线（"全猜最大类"的准确率）
        const famCounts = {};
        for (const r of classified) famCounts[r.fam] = (famCounts[r.fam] || 0) + 1;
        const majority = Object.entries(famCounts).sort((a, b) => b[1] - a[1])[0];
        const baselineAcc = majority ? (majority[1] / total * 100) : 0;

        // Top 混淆方向（排除 _none）
        const topConfusions = Object.entries(confusionPairs)
          .filter(([k]) => { const [f, t] = k.split('\u2192'); return f !== t && f !== '_none' && t !== '_none'; })
          .sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([k, c]) => { const [f, t] = k.split('\u2192'); return { from: f, to: t, count: c }; });

        push(`准确性·误归属·${s.p}`, mismatchRate < MAX_MISMATCH,
          `${mismatches} 张误归属（${mismatchRate.toFixed(1)}%，阈值 <${MAX_MISMATCH}%）；门禁重分类准确率 ${accuracy.toFixed(1)}%（含 margin 同意 ${marginAgree}）；多数类基线 ${baselineAcc.toFixed(1)}%（${majority ? majority[0] : '?'}）；门禁无匹配 ${noMatchRate.toFixed(1)}%（文本较短限制）`);

        // B) 排除失效检查
        let excViolations = 0;
        const excDetails = [];
        for (const r of classified) {
          const fam = famMatchers.find(f => f.key === r.fam);
          if (!fam || !fam.reExc) continue;
          try { if (fam.reExc.test(r.text || '')) { excViolations++; if (excDetails.length < 12) excDetails.push({ id: r.id, text: (r.text || '').slice(0, 60), fam: r.fam }); } } catch {}
        }
        push(`准确性·排除失效·${s.p}`, excViolations === 0,
          excViolations ? `${excViolations} 张工单命中指派家族的 exclude 正则` : '所有工单未命中指派家族的 exclude 正则');

        // C) 泛词误吸嫌疑（WARN 级，始终 PASS，仅信息标注）
        let genericWarn = 0;
        const genericDetails = [];
        for (const fam of famMatchers) {
          if (!fam.terms.length) continue;
          let gc = 0;
          for (const t of fam.terms) { if (famMatchers.filter(f => f.terms.includes(t)).length >= 3) gc++; }
          const ratio = gc / fam.terms.length;
          if (ratio > 0.4) { genericWarn++; genericDetails.push({ family: fam.key, ratio: Math.round(ratio * 100) + '%', gc, total: fam.terms.length }); }
        }
        push(`准确性·泛词误吸·${s.p}`, true,
          genericWarn ? `⚠️ ${genericWarn} 个家族泛词占比 >40%：${genericDetails.map(d => `${d.family}(${d.ratio})`).join('、')}` : '各家族泛词占比均 <40%');

        // 收集准确性失败项供 Fixer 独立消费
        if (mismatches > 0 && mismatchRate >= MAX_MISMATCH) {
          failures.push({ check: `准确性·误归属·${s.p}`, product: s.p, derived: !!s.derived,
            detail: `${mismatches} 张工单 Producer 指派家族 ≠ 门禁 top-1（${mismatchRate.toFixed(1)}%）`,
            evidence: mismatchDetails.slice(0, 12).map(d => ({ id: d.id, text: d.text, fam: d.producerFam })), fixHint: 'restrict_term' });
        }
        if (excViolations > 0) {
          failures.push({ check: `准确性·排除失效·${s.p}`, product: s.p, derived: !!s.derived,
            detail: `${excViolations} 张工单命中指派家族的 exclude 正则`,
            evidence: excDetails.slice(0, 12).map(d => ({ id: d.id, text: d.text, fam: d.fam })), fixHint: 'adjust_boundary' });
        }

        accuracyByProduct.push({
          product: s.p, total,
          reclassification: { agree: agreeCount, marginAgree, mismatch: mismatches, noMatch, accuracy: +accuracy.toFixed(1), mismatchRate: +mismatchRate.toFixed(1), noMatchRate: +noMatchRate.toFixed(1) },
          baseline: { family: majority ? majority[0] : null, accuracy: +baselineAcc.toFixed(1) },
          topConfusions,
          genericWarnings: genericDetails,
          mismatchSamples: mismatchDetails.slice(0, 5),
          excludeSamples: excDetails.slice(0, 5),
        });
      }
    }
  }

  const fails = checks.filter(c => c.level === 'FAIL');
  const passed = fails.length === 0;

  const report = {
    generator: 'gate-check.cjs (independent third-party reviewer)',
    generatedAt: new Date().toISOString(),
    passed,
    thresholds: { MAX_UNC, MAX_PEND, MAX_MISMATCH },
    checks,
    failures,
    accuracy: accuracyByProduct.length ? accuracyByProduct : undefined,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2), 'utf8');

  console.log('\n===== 第三方门禁（gate-check.cjs，独立进程）=====');
  for (const c of checks) console.log(`  [${c.level}] ${c.name} — ${c.detail}`);
  console.log(`  ---- PASS ${checks.filter(c => c.level === 'PASS').length} / FAIL ${fails.length} ----`);
  if (accuracyByProduct.length) {
    console.log('\n  —— 分类准确性评估（借鉴 ticket-intel eval harness）——');
    for (const a of accuracyByProduct) {
      console.log(`  [${a.product}] 重分类准确率 ${a.reclassification.accuracy}% / 多数类基线 ${a.baseline.accuracy}%(${a.baseline.family}) / 误归属 ${a.reclassification.mismatchRate}% / 无匹配 ${a.reclassification.noMatchRate}%`);
      if (a.topConfusions.length) console.log(`    混淆方向: ${a.topConfusions.map(c => `${c.from}→${c.to}(${c.count})`).join(', ')}`);
    }
  }
  console.log(`  → 写出 ${path.relative(process.cwd(), OUT)}（passed=${passed}）`);
  process.exit(passed ? 0 : 2);
}

try { main(); }
catch (e) { console.error('[gate-check] 致命错误:', e.message); process.exit(3); }
