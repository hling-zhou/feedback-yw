#!/usr/bin/env node
/* 行动建议模块呈现渲染器：把 validate-action-recs.cjs 生成的
   「行动建议-<产品>-验证.md」转换为工作台模块风格的自包含 HTML。
   用法: node scripts/render-action-recs-html.cjs <md路径> [输出html路径]
*/
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || 'docs/行动建议-弹性公网IP-验证.md';
const OUT = process.argv[3] || ('dist/' + path.basename(SRC, '.md') + '-module.html');

const md = fs.readFileSync(SRC, 'utf8');
const lines = md.split(/\r?\n/);

// 分段：顶层 ## 标题 划层
const TIER_META = {
  '长期结构性': { key: 'structural', color: '#2563eb', label: '长期结构性' },
  '本月异动': { key: 'change', color: '#ea580c', label: '本月异动' },
  '小而锐': { key: 'sharp', color: '#dc2626', label: '小而锐·高害' },
  '常规迭代池': { key: 'iteration', color: '#0891b2', label: '常规迭代池' },
  '平稳长尾': { key: 'tail', color: '#64748b', label: '平稳长尾' },
};

let meta = { title: '', scope: [], notes: [] };
let tier = null;          // 当前层 {name,key,color,items:[],list:[]}
const tiers = [];
const appendices = [];
let curApp = null;

function flushTier() {
  if (tier && (tier.items.length || tier.list.length)) tiers.push(tier);
  tier = null;
}
function flushApp() {
  if (curApp && curApp.lines.length) appendices.push(curApp);
  curApp = null;
}

let curItem = null;
function flushItem() {
  if (curItem) { tier.items.push(curItem); curItem = null; }
}

for (let i = 0; i < lines.length; i++) {
  const L = lines[i];
  if (L.startsWith('# ')) { meta.title = L.slice(2).trim(); continue; }
  if (L.startsWith('> ')) {
    const t = L.slice(2).trim();
    if (t.startsWith('周期') || t.startsWith('数据量') || /基线|派生主题/.test(t)) meta.scope.push(t);
    else meta.notes.push(t);
    continue;
  }
  if (L.startsWith('## ')) {
    const h = L.slice(3).trim();
    flushItem(); flushTier(); flushApp();
    const m = h.match(/^([一二三四五六七八九十]+)、(.+)$/);
    const name = (m ? m[2] : h).replace(/（.*?）/g, '').trim();
    if (TIER_META[name]) {
      const tm = TIER_META[name];
      tier = { name, key: tm.key, color: tm.color, label: tm.label, items: [], list: [] };
    } else {
      // 附 X：口径/审计 → 附录
      curApp = { title: h, lines: [] };
    }
    continue;
  }
  if (curApp) { if (L.trim()) curApp.lines.push(L); continue; }
  if (L.startsWith('### ')) {
    flushItem();
    const h = L.slice(4).trim();
    // 解析 「家族 · 子议题 〔tier〕」
    const badge = (h.match(/〔(.+?)〕/) || [])[1] || '';
    const core = h.replace(/〔.*?〕/, '').trim();
    const idx = core.indexOf(' · ');
    const fam = idx >= 0 ? core.slice(0, idx) : '';
    const sub = idx >= 0 ? core.slice(idx + 3) : core;
    curItem = { fam, sub, badge, metrics: '', voice: '', voiceSrc: '', pain: '', root: '', rec: '', src: '', note: '' };
    continue;
  }
  if (curItem) {
    if (L.startsWith('- 规模')) curItem.metrics = L.replace(/^- 规模[:：]?/, '').trim();
    else if (L.startsWith('- **真声')) {
      const mm = L.match(/\*\*真声（(.+?)）\*\*[：:]\s*「?(.+?)」?$/);
      if (mm) { curItem.voiceSrc = mm[1]; curItem.voice = mm[2].trim(); }
      else { const m2 = L.match(/\*\*真声（(.+?)）\*\*[：:]\s*(.+)$/); if (m2) { curItem.voiceSrc = m2[1]; curItem.voice = m2[2].trim(); } }
    }
    else if (L.startsWith('- 〔痛点摘要〕')) curItem.pain = L.replace(/^- 〔痛点摘要〕[：:]/, '').trim();
    else if (L.startsWith('- 〔复核根因〕')) curItem.root = L.replace(/^- 〔复核根因〕[：:]/, '').trim();
    else if (L.startsWith('- **建议')) curItem.rec = L.replace(/^- \*\*建议\*\*[：:]?/, '').trim();
    else if (L.startsWith('- 分类来源')) curItem.src = L.replace(/^- 分类来源[：:]?/, '').trim();
    else if (L.startsWith('- 收敛说明')) curItem.note = L.replace(/^- 收敛说明[：:]?/, '').trim();
    continue;
  }
  // 迭代池/长尾 的列表项
  if (tier && tier.list !== undefined && L.startsWith('- ') && !L.startsWith('- 规模') && !L.startsWith('- **') && !L.startsWith('- 〔')) {
    const body = L.slice(2).trim();
    const mm = body.match(/^(.+?)[：:](.+)$/);
    tier.list.push({ name: mm ? mm[1].trim() : body, rest: mm ? mm[2].trim() : '' });
  }
}
flushItem(); flushTier(); flushApp();

// ---- 渲染 ----
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function metricsChips(m) {
  if (!m) return '';
  const parts = m.split('｜').map(s => s.trim()).filter(Boolean);
  return '<div class="metrics">' + parts.map(p => `<span class="chip">${esc(p)}</span>`).join('') + '</div>';
}

function renderItem(it, color) {
  const badge = it.badge ? `<span class="badge" style="background:${color}">${esc(it.badge)}</span>` : '';
  const voice = it.voice ? `<div class="voice"><span class="vlabel">真声 · ${esc(it.voiceSrc || '客户原话')}</span><blockquote>${esc(it.voice)}</blockquote></div>` : '';
  const pain = it.pain ? `<div class="ana"><span class="alabel">〔痛点摘要〕</span>${esc(it.pain)}</div>` : '';
  const root = it.root ? `<div class="ana"><span class="alabel">〔复核根因〕</span>${esc(it.root)}</div>` : '';
  const rec = it.rec ? `<div class="rec"><span class="rlabel">建议</span>${esc(it.rec)}</div>` : '';
  const src = it.src ? `<div class="src">⚙ ${esc(it.src)}</div>` : '';
  return `<div class="card">
    <div class="card-h"><div class="title"><span class="fam">${esc(it.fam)}</span><span class="sep">·</span><span class="sub">${esc(it.sub)}</span></div>${badge}</div>
    ${metricsChips(it.metrics)}
    ${voice}${pain}${root}${rec}${src}
  </div>`;
}

function renderList(list) {
  if (!list.length) return '';
  return '<table class="ltab"><tbody>' + list.map(r =>
    `<tr><td class="lname">${esc(r.name)}</td><td class="lrest">${esc(r.rest)}</td></tr>`
  ).join('') + '</tbody></table>';
}

const tierSections = tiers.map(t => {
  const items = t.items.map(it => renderItem(it, t.color)).join('');
  const list = t.list.length ? `<div class="listwrap"><div class="listtitle">${esc(t.label)}（汇总）</div>${renderList(t.list)}</div>` : '';
  return `<section class="tier" style="--tc:${t.color}">
    <h2 class="tier-h"><span class="tdot"></span>${esc(t.name)}<span class="tcount">${t.items.length ? t.items.length + ' 项明细' : ''}</span></h2>
    <div class="tier-body">${items}${list}</div>
  </section>`;
}).join('');

const appSections = appendices.map(a => {
  const body = a.lines.map(l => `<div class="app-line">${esc(l.replace(/^- /, '• '))}</div>`).join('');
  return `<details class="appx"><summary>${esc(a.title)}</summary><div class="app-body">${body}</div></details>`;
}).join('');

const scopeChips = meta.scope.map(s => `<span class="scope-chip">${esc(s)}</span>`).join('');

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title)} · 行动建议模块</title>
<style>
* { box-sizing: border-box; }
body { margin:0; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;
  background:#f3f4f6; color:#1f2937; line-height:1.6; }
.wrap { max-width:1080px; margin:0 auto; padding:24px 20px 60px; }
.modhead { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:20px 24px; box-shadow:0 1px 2px rgba(0,0,0,.04); }
.modhead .kicker { font-size:12px; letter-spacing:.08em; color:#6b7280; text-transform:uppercase; }
.modhead h1 { margin:4px 0 10px; font-size:22px; }
.scope { display:flex; flex-wrap:wrap; gap:8px; }
.scope-chip { background:#eef2ff; color:#3730a3; border:1px solid #c7d2fe; border-radius:999px; padding:3px 12px; font-size:12.5px; }
.notes { margin-top:12px; font-size:13px; color:#4b5563; background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:10px 14px; }
.notes b{color:#92400e;}
.tier { background:#fff; border:1px solid #e5e7eb; border-radius:12px; margin-top:18px; overflow:hidden; }
.tier-h { margin:0; padding:12px 18px; font-size:16px; background:color-mix(in srgb, var(--tc) 8%, #fff); border-bottom:2px solid var(--tc); display:flex; align-items:center; gap:10px; }
.tdot { width:10px; height:10px; border-radius:3px; background:var(--tc); }
.tcount { margin-left:auto; font-size:12px; color:#6b7280; font-weight:400; }
.tier-body { padding:14px 18px 18px; }
.card { border:1px solid #eef0f3; border-left:4px solid var(--tc); border-radius:8px; padding:12px 14px; margin-bottom:12px; background:#fcfcfd; }
.card-h { display:flex; align-items:flex-start; justify-content:space-between; gap:10px; }
.title { font-size:14.5px; font-weight:600; }
.fam { color:#374151; } .sep { color:#9ca3af; margin:0 4px; } .sub { color:#111827; }
.badge { flex:0 0 auto; font-size:11.5px; color:#fff; padding:2px 9px; border-radius:999px; font-weight:600; white-space:nowrap; }
.metrics { display:flex; flex-wrap:wrap; gap:6px; margin:8px 0; }
.chip { background:#f3f4f6; border:1px solid #e5e7eb; border-radius:6px; padding:2px 9px; font-size:12px; color:#374151; }
.voice { margin:8px 0; }
.vlabel { font-size:11.5px; color:#0f766e; font-weight:600; background:#ccfbf1; border:1px solid #99f6e4; padding:1px 8px; border-radius:5px; display:inline-block; margin-bottom:5px; }
.voice blockquote { margin:0; padding:8px 12px; background:#f0fdfa; border-left:3px solid #14b8a6; border-radius:0 6px 6px 0; font-size:13.5px; color:#134e4a; }
.ana { font-size:13px; margin:5px 0; color:#374151; }
.alabel { color:#7c3aed; font-weight:600; margin-right:4px; }
.rec { font-size:13px; margin:6px 0 0; padding:7px 10px; background:#fef2f2; border:1px dashed #fca5a5; border-radius:6px; }
.rlabel { color:#b91c1c; font-weight:600; margin-right:4px; }
.src { font-size:11.5px; color:#6b7280; margin-top:6px; }
.listwrap { margin-top:6px; }
.listtitle { font-size:13px; font-weight:600; color:#374151; margin-bottom:6px; }
.ltab { width:100%; border-collapse:collapse; font-size:13px; }
.ltab td { border-bottom:1px solid #f1f3f5; padding:6px 8px; vertical-align:top; }
.lname { color:#111827; font-weight:500; width:62%; }
.lrest { color:#6b7280; }
.appx { margin-top:18px; background:#fff; border:1px solid #e5e7eb; border-radius:10px; padding:4px 16px; }
.appx summary { cursor:pointer; font-weight:600; font-size:14px; padding:10px 0; }
.app-body { padding:0 0 12px; font-size:12.5px; color:#4b5563; }
.app-line { padding:2px 0; }
.foot { margin-top:24px; text-align:center; font-size:12px; color:#9ca3af; }
</style></head>
<body><div class="wrap">
  <div class="modhead">
    <div class="kicker">洞察工作台 · 行动建议模块</div>
    <h1>${esc(meta.title)}</h1>
    <div class="scope">${scopeChips}</div>
    ${meta.notes.length ? `<div class="notes">${meta.notes.map(n => `<div>${esc(n)}</div>`).join('')}</div>` : ''}
  </div>
  ${tierSections}
  ${appSections}
  <div class="foot">由 scripts/render-action-recs-html.cjs 渲染 ｜ 数据来源：scripts/validate-action-recs.cjs 生成的验证备忘录</div>
</div></body></html>`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, html, 'utf8');
console.log('wrote', OUT, '(', html.length, 'bytes )');
console.log('tiers:', tiers.map(t => t.name + '=' + t.items.length + '明细/' + t.list.length + '汇总').join(' | '));
console.log('appendices:', appendices.map(a => a.title).join(' | '));
