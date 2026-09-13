/* 第三方修复方（Fixer）—— 与"写(Producer)/复核(Gate)"完全独立的子进程。
 *
 * 治理原则：本文件不调用分类引擎、不读 records、不改人类基线 CAUSE_TAX_MAP。
 * 它只读三方产物（gate-report.json + evidence-rows.json + taxonomy-current.json），
 * 独立判断"失败能否用分类法修复"，能修则做【外科式最小改动】并写入：
 *   scripts/taxonomy-overrides.json  —— 机器增量（基线 + 此增量 = 生效分类法；删此文件即回滚）
 *   docs/变更日志-YYYY-MM-DD.md      —— 每条改动 before/after + 门禁信号 + 证据工单（可审计、非黑箱）
 * 不能修的（派生草稿/阈值/横切/出处/解析，或证据不足）→ 标 needs_human，由编排器升级人工。
 *
 * 修复策略（仅两类可证、可外科式 + 两类准确性修订）：
 *   A add_coverage       ：未归类率 FAIL → 在未归类工单文本里挖高频未覆盖短语，作为新子议题补进最相关家族。
 *   B restrict_term      ：待确认率 FAIL → 用内置"泛词收窄表"把过宽正则收窄（仅当证据显示跨家族歧义时）。
 *   C restrict_term(误归属)：准确性·误归属 FAIL → 同策略收窄导致误吸的泛词（来源=分类准确性门禁层）。
 *   D adjust_boundary    ：准确性·排除失效 FAIL → 标 needs_human 供人工审核（安全起见不自动改边界）。
 *
 * 退出码：0 = 已应用至少一处可修改动（编排器复跑）；1 = 无可修项（全部 needs_human，编排器升级人工）。
 *
 * 用法：node scripts/fix-classification.cjs [--report <gate-report.json>] [--evidence <evidence.json>]
 *                                      [--tax <taxonomy-current.json>] [--overrides <taxonomy-overrides.json>]
 *                                      [--changelog <docs/变更日志-日期.md>]
 */
const fs = require('fs');
const path = require('path');
const DIST = path.resolve(__dirname, '..', 'dist');
const DOCS = path.resolve(__dirname, '..', 'docs');
const OVERRIDES_PATH = path.resolve(__dirname, 'taxonomy-overrides.json');

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const REPORT = path.resolve(arg('--report', path.join(DIST, 'gate-report.json')));
const EVID = path.resolve(arg('--evidence', path.join(DIST, 'evidence-rows.json')));
const TAX = path.resolve(arg('--tax', path.join(DIST, 'taxonomy-current.json')));
const OVERRIDES_OUT = path.resolve(arg('--overrides', OVERRIDES_PATH));
const CHANGELOG = path.resolve(arg('--changelog', path.join(DOCS, `变更日志-${new Date().toISOString().slice(0, 10)}.md`)));

const CJK = /[一-龥]/;
const STOP = new Set(['客户','反馈','问题','无法','需要','处理','情况','导致','影响','进行','通过','没有','不是','我们','他们','这个','那个','什么','怎么','可以','应该','已经','还是','因为','所以','但是','而且','相关','目前','出现','存在','使用','操作','功能','需求','咨询','申请','协助','确认','查看','提供','业务','资源','信息','系统','平台','页面','流程','人员','时间','方式','内容','结果','原因','状态','支持','服务','产品','用户','实际','直接','及时','尽快','沟通','联系','回复','告知','说明','了解','以及','或者','如果','由于','对于','工程师','排查','定位','解决','优化','提升','增加','减少','调整','修改','完善','希望','要求','表示','反映','描述','现象','场景','环境','版本','设置']);
// 泛词收窄表：过宽正则里的"裸泛词" → 安全收窄形式（仅在证据显示跨家族歧义时应用）
const NARROW = {
  '中断': '(网络|链路|线路)中断',
  '轻载': '(轻载通道|轻载IP)',
  '配额': '(配额|份额)',
  '子网': '(子网(段|路由|IP)|IPv6|双栈)',
  '带宽': '(带宽(不足|不符|超限)|限速)',
  '无法判断': '(无法判断|未能判定)',
};

function cjkNGrams(text, lo, hi) {
  const out = [];
  for (let len = lo; len <= hi; len++)
    for (let i = 0; i + len <= text.length; i++) {
      const q = text.slice(i, i + len);
      if (!/^[一-龥]+$/.test(q)) continue;   // 必须纯汉字，剔除跨标点/含符号的碎片
      if (q.length < 2) continue;
      if (/[的了和与或在是为无有未不此于对至向等中时后前内外上下该其之]$/.test(q)) continue;
      out.push(q);
    }
  return out;
}
function familyVocab(fam) {
  const terms = [];
  const src = (fam.re || '') + '|' + (fam.subs || []).map(s => s.re).join('|');
  for (const raw of src.split('|')) {
    const w = raw.trim();
    if (w && !/[\\^$.*+?()[\]{}|]/.test(w) && CJK.test(w[0])) terms.push(w);
  }
  return terms;
}
// 字形重叠度：短语 q 与字符串 s 共享的汉字数（家族名/词表作为归属信号）
function charOverlap(q, s) {
  const sq = new Set([...String(q)].filter(c => CJK.test(c)));
  let n = 0;
  for (const c of sq) if (String(s).includes(c)) n++;
  return n;
}
function coveredBy(text, fam) {
  try { if (fam.re && new RegExp(fam.re).test(text)) return true; } catch {}
  for (const s of (fam.subs || [])) { try { if (s.re && new RegExp(s.re).test(text)) return true; } catch {} }
  return false;
}

function minePhrase(rows, taxProduct) {
  const cnt = new Map();
  for (const r of rows) for (const q of cjkNGrams(r.text || '', 2, 4)) {
    if (STOP.has(q)) continue;
    cnt.set(q, (cnt.get(q) || 0) + 1);
  }
  const ranked = [...cnt.entries()].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]);
  for (const [q] of ranked) {
    // 该短语必须确实未被任何家族覆盖（否则加了也是冗余）
    const covered = (taxProduct.families || []).some(f => coveredBy(q, f));
    if (covered) continue;
    // 选最相关家族：含有该短语的未归类工单里，也含该家族既有词表的工单数最多者
    let bestFam = null, bestScore = 0;
    for (const f of (taxProduct.families || [])) {
      const vocab = familyVocab(f);
      if (!vocab.length) continue;
      let score = 0;
      for (const r of rows) {
        if (!(r.text || '').includes(q)) continue;
        if (vocab.some(v => (r.text || '').includes(v))) score++;
      }
      if (score > bestScore) { bestScore = score; bestFam = f; }
    }
    if (bestFam && bestScore >= 2) return { phrase: q, fam: bestFam.name, score: bestScore };
    // 兜底：未归类工单不含任何家族既有词时，按"短语 ↔ 家族名+词表"的字形重叠选最相关家族
    // （家族名本就指示归属，可辩护；用于被移除词恰为该族唯一匹配的真实场景）
    let fbFam = null, fbScore = 0;
    for (const f of (taxProduct.families || [])) {
      const name = f.name || '';
      let ov = charOverlap(q, name) * 3;            // 家族名权重更高
      for (const v of familyVocab(f)) ov += charOverlap(q, v);
      if (ov > fbScore) { fbScore = ov; fbFam = f; }
    }
    if (fbFam && fbScore >= 2) return { phrase: q, fam: fbFam.name, score: fbScore, fallback: true };
  }
  return null;
}

function main() {
  const report = JSON.parse(fs.readFileSync(REPORT, 'utf8'));
  const ev = JSON.parse(fs.readFileSync(EVID, 'utf8'));
  const tax = JSON.parse(fs.readFileSync(TAX, 'utf8'));
  const evByP = new Map(ev.map(e => [e.p, e.rows]));
  const taxByP = new Map(tax.map(t => [t.p, t]));

  let existing = {};
  try { existing = JSON.parse(fs.readFileSync(OVERRIDES_OUT, 'utf8')); } catch { existing = {}; }

  const applied = [];   // {product, check, strategy, before, after, evidence, gateSignal}
  const needsHuman = [];

  for (const f of (report.failures || [])) {
    const p = f.product;
    if (f.derived) { needsHuman.push({ ...f, reason: '派生草稿：需人工审核注册为 curated 分类法，机制不自动注册' }); continue; }
    if (f.fixHint === 'add_coverage') {
      const rows = (evByP.get(p) || []).filter(r => r.status === 'unclassified');
      const taxP = taxByP.get(p);
      const mined = minePhrase(rows, taxP);
      if (!mined) { needsHuman.push({ ...f, reason: '未归类工单无高频未覆盖短语可补，需人工补正则/子议题' }); continue; }
      const ov = existing[p] || (existing[p] = { families: [] });
      let famOv = ov.families.find(x => x.name === mined.fam);
      if (!famOv) { famOv = { name: mined.fam, addSubs: [] }; ov.families.push(famOv); }
      const key = 'auto_' + Date.now().toString(36) + '_' + mined.phrase.length;
      const re = mined.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (famOv.addSubs.some(s => s.re === re)) { needsHuman.push({ ...f, reason: '该短语已存在于增量，勿重复' }); continue; }
      famOv.addSubs.push({ key, name: mined.phrase, re });
      applied.push({
        product: p, check: f.check, strategy: 'add_coverage',
        before: `（其他/通用）未覆盖`, after: `家族「${mined.fam}」新增子议题「${mined.phrase}」(re=${re})`,
        evidence: (f.evidence || []).slice(0, 5).map(e => e.id),
        gateSignal: f.detail,
      });
    } else if (f.fixHint === 'restrict_overbroad') {
      const rows = (evByP.get(p) || []).filter(r => r.status === 'pending');
      const taxP = taxByP.get(p);
      // 仅在"待确认工单文本含泛词，且同产品其他家族也含该泛词"时才收窄（跨家族歧义信号）
      let narrowed = null;
      for (const [term, narrow] of Object.entries(NARROW)) {
        const inPend = rows.some(r => (r.text || '').includes(term));
        if (!inPend) continue;
        const crossFam = (taxP.families || []).some(f => (f.re || '').includes(term) || (f.subs || []).some(s => (s.re || '').includes(term)));
        if (!crossFam) continue;
        narrowed = { term, narrow };
        break;
      }
      if (!narrowed) { needsHuman.push({ ...f, reason: '待确认率偏高但无明确跨家族泛词歧义，需人工复核置信度/字段权重' }); continue; }
      const ov = existing[p] || (existing[p] = { families: [] });
      // 找到含该泛词的家族，收窄其正则源串里裸 term 的出现
      let done = false;
      for (const fam of (taxP.families || [])) {
        if (!(fam.re || '').includes(narrowed.term)) continue;
        // 避免重复收窄
        const already = ov.families.find(x => x.name === fam.name && x.re && x.re.includes(narrowed.narrow));
        if (already) { done = true; break; }
        const newRe = fam.re.split('|').map(seg => seg.includes(narrowed.term) ? seg.replace(narrowed.term, narrowed.narrow) : seg).join('|');
        let famOv = ov.families.find(x => x.name === fam.name);
        if (!famOv) { famOv = { name: fam.name }; ov.families.push(famOv); }
        famOv.re = newRe;
        done = true;
        applied.push({
          product: p, check: f.check, strategy: 'restrict_term',
          before: `家族「${fam.name}」正则含裸「${narrowed.term}」`, after: `收窄为「${narrowed.narrow}」`,
          evidence: (f.evidence || []).slice(0, 5).map(e => e.id),
          gateSignal: f.detail,
        });
        break;
      }
      if (!done) needsHuman.push({ ...f, reason: '待确认率：未找到可安全收窄的泛词' });
    } else if (f.fixHint === 'restrict_term') {
      // 准确性·误归属 FAIL → 收窄导致误吸的泛词（与 restrict_overbroad 同策略，但触发来源不同）
      // 误归属意味着 Producer 把工单分到了错误家族，通常因某家族正则含泛词吸了不该吸的工单
      const rows = (evByP.get(p) || []).filter(r => r.status === 'classified');
      const taxP = taxByP.get(p);
      // 证据工单：Producer 指派 fam 与门禁 top-1 不同的那些
      const evidRows = (f.evidence || []);
      let narrowed = null;
      for (const [term, narrow] of Object.entries(NARROW)) {
        // 误归属工单里是否含该泛词
        const inMismatch = evidRows.some(e => (e.text || '').includes(term));
        if (!inMismatch) continue;
        // 该泛词是否出现在误归属指向的家族正则里
        const crossFam = (taxP.families || []).some(f => (f.re || '').includes(term) || (f.subs || []).some(s => (s.re || '').includes(term)));
        if (!crossFam) continue;
        narrowed = { term, narrow };
        break;
      }
      if (!narrowed) { needsHuman.push({ ...f, reason: '误归属率偏高但无明确泛词可收窄，需人工复核家族边界/分类标准' }); continue; }
      const ov = existing[p] || (existing[p] = { families: [] });
      let done = false;
      for (const fam of (taxP.families || [])) {
        if (!(fam.re || '').includes(narrowed.term)) continue;
        const already = ov.families.find(x => x.name === fam.name && x.re && x.re.includes(narrowed.narrow));
        if (already) { done = true; break; }
        const newRe = fam.re.split('|').map(seg => seg.includes(narrowed.term) ? seg.replace(narrowed.term, narrowed.narrow) : seg).join('|');
        let famOv = ov.families.find(x => x.name === fam.name);
        if (!famOv) { famOv = { name: fam.name }; ov.families.push(famOv); }
        famOv.re = newRe;
        done = true;
        applied.push({
          product: p, check: f.check, strategy: 'restrict_term',
          before: `家族「${fam.name}」正则含裸「${narrowed.term}」`, after: `收窄为「${narrowed.narrow}」`,
          evidence: evidRows.slice(0, 5).map(e => e.id),
          gateSignal: f.detail,
        });
        break;
      }
      if (!done) needsHuman.push({ ...f, reason: '误归属：未找到可安全收窄的泛词（可能需调分类边界）' });
    } else if (f.fixHint === 'adjust_boundary') {
      // 准确性·排除失效 FAIL → 工单命中指派家族 exclude 正则但未被拦截
      // 可修策略：把 exclude 模式从正则提升为更宽的排除（加量），或给 exclude 补正则段
      // 但这本质是"调整分类边界"——安全起见，仅标 needs_human 并附证据工单供人工审核
      needsHuman.push({ ...f, reason: '排除失效：工单命中指派家族的 exclude 正则但未被 Producer 拦截。需人工复核 exclude 正则是否在引擎中正确编译/加载，以及是否需要补充 exclude 条件' });
    } else {
      needsHuman.push({ ...f, reason: '非分类法可修类（阈值/横切/出处/解析）' });
    }
  }

  fs.mkdirSync(path.dirname(OVERRIDES_OUT), { recursive: true });
  fs.writeFileSync(OVERRIDES_OUT, JSON.stringify(existing, null, 2), 'utf8');

  // 落盘变更日志（追加）
  if (applied.length || needsHuman.length) {
    const L = ['\n---\n### 修复轮次 ' + new Date().toISOString()];
    for (const a of applied) L.push(`- ✅ [${a.product}] ${a.check} · ${a.strategy}\n  - 改动：${a.before} → ${a.after}\n  - 门禁信号：${a.gateSignal}\n  - 证据工单：${(a.evidence || []).join('、') || '（无）'}`);
    for (const h of needsHuman) L.push(`- ⚠️ [${h.product}] ${h.check} · 需人工：${h.reason}`);
    const block = L.join('\n') + '\n';
    fs.mkdirSync(path.dirname(CHANGELOG), { recursive: true });
    fs.appendFileSync(CHANGELOG, block, 'utf8');
  }

  console.log('\n===== 第三方修复方（fix-classification.cjs，独立进程）=====');
  console.log(`  已应用改动 ${applied.length} 处；需人工 ${needsHuman.length} 项`);
  for (const a of applied) console.log(`  ✅ ${a.product}/${a.check}: ${a.after}`);
  for (const h of needsHuman) console.log(`  ⚠️ ${h.product}/${h.check}: 需人工 — ${h.reason}`);
  console.log(`  → 增量写出 ${path.relative(process.cwd(), OVERRIDES_OUT)}；变更日志 ${path.relative(process.cwd(), CHANGELOG)}`);
  process.exit(applied.length ? 0 : 1);
}

try { main(); }
catch (e) { console.error('[fix-classification] 致命错误:', e.message); process.exit(3); }
