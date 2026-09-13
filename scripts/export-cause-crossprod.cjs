#!/usr/bin/env node
/**
 * 四产品「原因家族」横向对照表生成器
 * 读取 validate-action-recs.cjs 导出的 dist/cause_counts.json（全量家族计数，已剔除未定位模板行）
 * 输出：
 *   - dist/四产品-原因家族-横向对照.html   （单页可视化）
 *   - docs/四产品-原因家族-横向对照.md     （纯文本表格）
 *
 * 映射原则：把各产品的原因家族归并到「共性根因主轴」(super-category)。
 * 每个家族归属唯一主轴，映射在 SUPER 常量中显式声明，可审计。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'dist', 'cause_counts.json'), 'utf8'));
const PRODS = data.map(s => s.product);

// ---- 共性根因主轴定义（顺序 = 跨产品总量降序，由脚本计算后排序）----
const SUPER = {
  CAP:  { name: '配额 / 容量供给', en: 'Quota & Capacity', desc: '资源不足、配额到期回收、带宽/资源交付受限' },
  NET:  { name: '网络质量与连通', en: 'Network Quality', desc: '丢包/时延/抖动/中断/不可达/转发/路由/对等连通' },
  BILL: { name: '计费与账单', en: 'Billing', desc: '费用、计费规则、误解与概念澄清' },
  PROV: { name: '开通 / 订购 / 权限 / 灰度', en: 'Provisioning & Permission', desc: '开通交付、订购渠道、审批透明度、灰度权限、控制台可见性' },
  LIFE: { name: '生命周期（退订/释放/到期冻结）', en: 'Lifecycle', desc: '退订释放、资源到期冻结与续订' },
  CFG:  { name: '配置 / 控制台 / 规格', en: 'Config & Console', desc: '安全组ACL、子网路由、证书、功能限制、对象存储访问' },
  SEC:  { name: '安全封堵与管控', en: 'Security', desc: '安全封堵、访问控制、攻击防护' },
  DIAG: { name: '监控 / 诊断 / 自助定位', en: 'Monitoring & Diagnosis', desc: '监控指标、日志诊断、自助定位能力' },
  DOC:  { name: '文档 / 自助能力缺口（横切·非缺陷）', en: 'Docs & Self-service', desc: '文档/API不清晰、支持体验、用户概念误解——横切项，单列不计入缺陷根因' },
};

// 家族 key → 主轴。覆盖 JSON 中出现的全部 key。
const MAP = {
  // EIP
  quota_validity: 'CAP', cap: 'CAP', quota_apply: 'PROV',
  netlink: 'NET', connect: 'NET', bw_quality: 'NET',
  billing: 'BILL', security: 'SEC', unsub: 'LIFE', freeze: 'LIFE',
  gray: 'PROV', provision: 'PROV', doc: 'DOC', monitor: 'DIAG',
  bind: 'CFG', spec: 'DOC',
  // VPC
  sg: 'CFG', peering: 'NET', netplan: 'NET', iconn: 'NET',
  order_flow: 'PROV', quota: 'CAP', doc_self: 'DOC', pub: 'CFG', console_order: 'PROV',
  // 云专线
  renew_flow: 'PROV', config: 'CFG', bw_delivery: 'CAP', support: 'DOC', perm_monitor: 'PROV',
  // ELB
  billing_res: 'BILL', fwd: 'NET', diag: 'DIAG', cert: 'CFG', mon: 'DIAG', func: 'CFG', api: 'DOC',
};

// 反查：某 key 未映射时回退到 DOC 并报警
for (const s of data) for (const f of s.fams) {
  if (!MAP[f.key]) { console.warn('⚠ 未映射家族 key:', f.key, f.name); MAP[f.key] = 'DOC'; }
}

// ---- 聚合：主轴 × 产品 = { count, fams:[{name,n}] } ----
const grid = {}; // grid[catKey][prod] = {n, fams:[]}
for (const cat of Object.keys(SUPER)) grid[cat] = {};
for (const p of PRODS) for (const cat of Object.keys(SUPER)) grid[cat][p] = { n: 0, fams: [] };

for (const s of data) {
  for (const f of s.fams) {
    const cat = MAP[f.key];
    grid[cat][s.product].n += f.n;
    grid[cat][s.product].fams.push({ name: f.name, n: f.n, cross: f.crossCut });
  }
}

// 各主轴跨产品总量，用于排序与热力图
const catTotals = {};
for (const cat of Object.keys(SUPER)) {
  catTotals[cat] = PRODS.reduce((a, p) => a + grid[cat][p].n, 0);
}
const sortedCats = Object.keys(SUPER).sort((a, b) => catTotals[b] - catTotals[a]);

// 全局最大单元格（热力图归一）
let maxCell = 1;
for (const cat of sortedCats) for (const p of PRODS) maxCell = Math.max(maxCell, grid[cat][p].n);

// 产品总量
const prodTotal = {};
for (const s of data) prodTotal[s.product] = s.T;

// 热力图配色
function bg(n, cross) {
  if (!n) return 'background:#f7f8fa;color:#b8bdc7;';
  const r = Math.pow(n / maxCell, 0.6);
  if (cross) {
    const a = (0.12 + r * 0.7).toFixed(2);
    return `background:rgba(217,119,6,${a});color:#5b3a06;`;
  }
  const a = (0.10 + r * 0.8).toFixed(2);
  return `background:rgba(37,99,235,${a});color:${r > 0.45 ? '#fff' : '#0f2a66'};`;
}

// ============ HTML ============
let html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>四产品原因家族 · 横向对照表</title>
<style>
  :root{ --bd:#e5e8ef; --ink:#1f2533; --mut:#6b7280; --bg:#fff; --soft:#f7f8fa; }
  *{box-sizing:border-box}
  body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--ink);margin:0;background:var(--soft);line-height:1.6}
  .wrap{max-width:1080px;margin:0 auto;padding:32px 24px 64px}
  h1{font-size:24px;margin:0 0 4px}
  .sub{color:var(--mut);font-size:13px;margin-bottom:20px}
  .card{background:var(--bg);border:1px solid var(--bd);border-radius:12px;padding:20px 22px;margin-bottom:22px;box-shadow:0 1px 3px rgba(16,24,40,.04)}
  h2{font-size:17px;margin:0 0 14px;padding-left:10px;border-left:4px solid #2563eb}
  table{border-collapse:collapse;width:100%;font-size:13px}
  th,td{border:1px solid var(--bd);padding:8px 9px;text-align:center;vertical-align:middle}
  thead th{background:var(--soft);font-weight:600;color:var(--ink)}
  tbody th{background:var(--soft);font-weight:600;text-align:left;width:188px}
  .cat-en{display:block;font-size:11px;color:var(--mut);font-weight:400}
  .cnt{font-size:16px;font-weight:700;display:block}
  .fams{font-size:10.5px;line-height:1.35;opacity:.85;margin-top:2px;word-break:break-all}
  .tag{display:inline-block;font-size:11px;padding:1px 7px;border-radius:10px;background:#eef2ff;color:#3730a3;margin-bottom:6px}
  .dash{color:#c2c7d0}
  .insight li{margin:6px 0}
  .legend{font-size:12px;color:var(--mut);margin-top:10px}
  .legend span{display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:-2px;margin:0 4px 0 12px}
  .note{font-size:12px;color:var(--mut);margin-top:8px}
  code{background:#eef2ff;padding:1px 5px;border-radius:4px;font-size:12px}
</style></head><body><div class="wrap">
<h1>四产品「原因家族」横向对照表</h1>
<div class="sub">数据源：<code>dist/cause_counts.json</code>（由 <code>validate-action-recs.cjs</code> 导出，已剔除「未定位·无根因模板」行）｜ 口径：原因优先分类法（家族+子议题两级按问题原因重派，无根因回退需求痛点）｜ 周期 2026-07~08</div>
`;

// ---- Section 1: 共性根因主轴 × 产品 ----
html += `<div class="card"><h2>一、共性根因主轴 × 四产品（横向对照）</h2><table><thead><tr><th>共性根因主轴</th>`;
for (const p of PRODS) html += `<th>${p}<br><span class="cat-en">T=${prodTotal[p]}</span></th>`;
html += `<th>跨产品合计</th><th>覆盖产品数</th></tr></thead><tbody>`;
for (const cat of sortedCats) {
  const cov = PRODS.filter(p => grid[cat][p].n > 0).length;
  html += `<tr><th>${SUPER[cat].name}<span class="cat-en">${SUPER[cat].en} · ${SUPER[cat].desc}</span></th>`;
  for (const p of PRODS) {
    const cell = grid[cat][p];
    if (cell.n === 0) { html += `<td style="background:#f7f8fa;color:#c2c7d0">—</td>`; continue; }
    const famsTxt = cell.fams.map(f => `${f.name}${f.cross ? '·横切' : ''}(${f.n})`).join('、');
    html += `<td style="${bg(cell.n, cell.fams.some(f => f.cross))}"><span class="cnt">${cell.n}</span><div class="fams">${famsTxt}</div></td>`;
  }
  html += `<td style="font-weight:700">${catTotals[cat]}</td>`;
  html += `<td>${'●'.repeat(cov)}<span class="dash">${'○'.repeat(4 - cov)}</span> ${cov}/4</td></tr>`;
}
html += `</tbody></table>`;
html += `<div class="legend">热力深度 = 该单元格量相对全局最大单元格（${maxCell} 单）的强度；<span> </span><span style="background:rgba(37,99,235,.55)"></span>蓝=缺陷根因家族，<span style="background:rgba(217,119,6,.55)"></span>橙=横切·非缺陷（文档/自助缺口）。</div>`;
html += `<div class="note">覆盖产品数：●=该产品有此根因家族，○=无。可一眼看出哪些根因是四产品共性、哪些是单产品特有。</div></div>`;

// ---- Section 2: 完整家族清单（家族级矩阵）----
html += `<div class="card"><h2>二、完整家族清单（家族级矩阵）</h2><table><thead><tr><th>原因家族 / 主轴</th>`;
for (const p of PRODS) html += `<th>${p}</th>`;
html += `</tr></thead><tbody>`;
// 按主轴分组输出全部家族
for (const cat of sortedCats) {
  // 收集该主轴下所有家族（跨产品去重 by name+key）
  const famSeen = new Map(); // key -> {name, cat, perProd:{p:n}}
  for (const s of data) for (const f of s.fams) {
    if (MAP[f.key] !== cat) continue;
    if (!famSeen.has(f.key)) famSeen.set(f.key, { name: f.name, cross: f.crossCut, perProd: {} });
    famSeen.get(f.key).perProd[s.product] = f.n;
  }
  const famList = [...famSeen.values()].sort((a, b) => {
    const ta = PRODS.reduce((x, p) => x + (a.perProd[p] || 0), 0);
    const tb = PRODS.reduce((x, p) => x + (b.perProd[p] || 0), 0);
    return tb - ta;
  });
  html += `<tr><th colspan="${PRODS.length + 1}" style="background:#eef2ff;color:#3730a3;font-size:12px">▸ ${SUPER[cat].name} <span class="cat-en">${SUPER[cat].en}</span></th></tr>`;
  for (const f of famList) {
    html += `<tr><th style="font-weight:500">${f.cross ? '⚑ ' : ''}${f.name}</th>`;
    for (const p of PRODS) {
      const n = f.perProd[p];
      if (!n) html += `<td class="dash">—</td>`;
      else html += `<td style="${bg(n, f.cross)}"><span class="cnt" style="font-size:14px">${n}</span></td>`;
    }
    html += `</tr>`;
  }
}
html += `</tbody></table><div class="note">⚑ = 横切项（非缺陷根因，文档/自助能力缺口），单列不计入缺陷原因家族。</div></div>`;

// ---- Section 3: 洞察 ----
// 计算跨产品共性
const universal = sortedCats.filter(c => PRODS.every(p => grid[c][p].n > 0));
const uniqueCats = sortedCats.filter(c => PRODS.filter(p => grid[c][p].n > 0).length === 1);
const topCat = sortedCats[0];
// 单产品主导的家族（某家族量占该主轴跨产品量 >60% 且该产品有量）
const dominant = [];
for (const s of data) {
  for (const f of s.fams) {
    const cat = MAP[f.key];
    if (f.n > 0 && f.n / catTotals[cat] > 0.6 && PRODS.filter(p => grid[cat][p].n > 0).length >= 2) {
      dominant.push({ p: s.product, fam: f.name, cat: SUPER[cat].name, n: f.n, share: (f.n / catTotals[cat] * 100).toFixed(0) });
    }
  }
}
html += `<div class="card"><h2>三、跨产品洞察</h2><ul class="insight">`;
html += `<li><span class="tag">共性根因</span>四产品<b>全部</b>出现的主轴：<b>${universal.map(c => SUPER[c].name).join('、')}</b>。说明这些是与网络产品形态伴生的结构性根因，应作为平台级统一动作主线。</li>`;
html += `<li><span class="tag">体量首位</span>跨产品量最大的根因主轴是 <b>${SUPER[topCat].name}</b>（合计 ${catTotals[topCat]} 单），其中 EIP 占绝对大头，是配额/容量治理的最高优先级战场。</li>`;
if (dominant.length) {
  html += `<li><span class="tag">产品特异</span>高度集中于单一产品的根因家族：`;
  html += dominant.map(d => `${d.p} 的「${d.fam}」(${d.n}单，占该主轴 ${d.share}%)`).join('；') + '。';
  html += `这些适合产品内单独立项，而非跨产品统一方案。</li>`;
}
if (uniqueCats.length) {
  html += `<li><span class="tag">仅单产品</span>仅在单一产品出现的根因主轴：${uniqueCats.map(c => `${SUPER[c].name}（${PRODS.find(p => grid[c][p].n > 0)}）`).join('、')}。</li>`;
}
const crossCats = sortedCats.filter(c => PRODS.some(p => grid[c][p].fams.some(f => f.cross)));
if (crossCats.length) {
  html += `<li><span class="tag">横切·非缺陷</span>${crossCats.map(c => SUPER[c].name).join('、')} 在部分产品表现为「文档/自助能力缺口」横切项（用户概念误解、文档/API 不清晰），不计入缺陷根因，但量不小，建议作为统一的教育/自助诊断动作主线。</li>`;
}
html += `</ul></div>`;

html += `</div></body></html>`;
fs.writeFileSync(path.join(ROOT, 'dist', '四产品-原因家族-横向对照.html'), html, 'utf8');

// ============ Markdown ============
let md = `# 四产品「原因家族」横向对照表\n\n`;
md += `> 数据源：\`dist/cause_counts.json\`（validate-action-recs.cjs 导出，已剔除「未定位·无根因模板」行）｜ 口径：原因优先分类法（家族+子议题两级按问题原因重派）｜ 周期 2026-07~08\n\n`;
md += `## 一、共性根因主轴 × 四产品\n\n`;
md += `| 共性根因主轴 | ` + PRODS.join(' | ') + ` | 合计 | 覆盖 |\n`;
md += `|---|` + PRODS.map(() => '---:').join('|') + `|---:|---|\n`;
for (const cat of sortedCats) {
  const cov = PRODS.filter(p => grid[cat][p].n > 0).length;
  const cells = PRODS.map(p => {
    const c = grid[cat][p];
    return c.n === 0 ? '—' : `${c.n}（${c.fams.map(f => f.name + (f.cross ? '·横' : '') + `·${f.n}`).join('、')}）`;
  });
  md += `| **${SUPER[cat].name}**<br><span class="m">${SUPER[cat].desc}</span> | ` + cells.join(' | ') + ` | ${catTotals[cat]} | ${cov}/4 |\n`;
}
md += `\n## 二、完整家族清单（家族级）\n\n`;
for (const cat of sortedCats) {
  md += `### ${SUPER[cat].name}\n\n`;
  md += `| 原因家族 | ` + PRODS.join(' | ') + ` |\n|---|` + PRODS.map(() => '---:').join('|') + `|\n`;
  const famSeen = new Map();
  for (const s of data) for (const f of s.fams) {
    if (MAP[f.key] !== cat) continue;
    if (!famSeen.has(f.key)) famSeen.set(f.key, { name: f.name, cross: f.crossCut, perProd: {} });
    famSeen.get(f.key).perProd[s.product] = f.n;
  }
  const famList = [...famSeen.values()].sort((a, b) => PRODS.reduce((x, p) => x + (a.perProd[p] || 0), 0) - PRODS.reduce((x, p) => x + (b.perProd[p] || 0), 0));
  for (const f of famList) {
    const cells = PRODS.map(p => f.perProd[p] ? `${f.perProd[p]}${f.cross ? '⚑' : ''}` : '—');
    md += `| ${f.cross ? '⚑ ' : ''}${f.name} | ` + cells.join(' | ') + ` |\n`;
  }
  md += `\n`;
}
md += `## 三、跨产品洞察\n\n`;
md += `- **共性根因**：四产品全部出现的主轴 —— ${universal.map(c => SUPER[c].name).join('、')}。\n`;
md += `- **体量首位**：跨产品量最大的主轴是 ${SUPER[topCat].name}（合计 ${catTotals[topCat]} 单），EIP 占绝对大头。\n`;
if (dominant.length) md += `- **产品特异**：` + dominant.map(d => `${d.p}「${d.fam}」(${d.n}单，占该主轴 ${d.share}%)`).join('；') + `。\n`;
if (uniqueCats.length) md += `- **仅单产品**：` + uniqueCats.map(c => `${SUPER[c].name}（${PRODS.find(p => grid[c][p].n > 0)}）`).join('、') + `。\n`;

fs.writeFileSync(path.join(ROOT, 'docs', '四产品-原因家族-横向对照.md'), md, 'utf8');
console.log('OK -> dist/四产品-原因家族-横向对照.html  +  docs/四产品-原因家族-横向对照.md');
console.log('主轴排序:', sortedCats.map(c => `${SUPER[c].name}=${catTotals[c]}`).join('  '));
console.log('四产品共性主轴:', universal.map(c => SUPER[c].name).join('、') || '（无）');
