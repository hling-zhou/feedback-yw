/* 行动建议规则补充（Keyword Discovery）—— 定期跑新词发现补充 taxonomy + 混淆方向指导补 exclude。
 *
 * 定位：独立工具脚本，不在 run-loop.cjs 的三方闭环内（不参与自动修复轮次）。
 * 它是"离线定期运行"的辅助工具，产出供 Fixer 和人工审核消费的候选清单。
 *
 * 职责边界（与 Fixer 的区别）：
 *   - Fixer (fix-classification.cjs)：在门禁 FAIL 时被动触发，外科式最小改动修复。
 *   - 本脚本：主动出击，不管门禁过没过，定期扫描"引擎正则未覆盖的高区分度词"
 *     + "家族混淆方向"，产出候选清单供 Fixer 的 add_coverage/restrict_term 策略消费。
 *
 * 产出物（全部到 dist/，可审计）：
 *   1. dist/keyword-discovery-report.json  — 新词候选清单（含区分度验证）
 *   2. dist/confusion-report.json         — 家族混淆热力图（哪些家族互相混）
 *   3. dist/taxonomy-override-candidates.json — 可直接喂回 taxonomy-overrides.json 的候选增量
 *
 * 用法：
 *   node scripts/keyword-discovery.cjs                     # 跑全量四产品
 *   node scripts/keyword-discovery.cjs --products EIP      # 只跑 EIP
 *   node scripts/keyword-discovery.cjs --apply             # 把候选直接写入 taxonomy-overrides.json
 *
 * 依赖：Python 3 + jieba（通过 scripts/_jieba_bridge.py 桥接分词）
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT_DIR = __dirname;
const PROJECT = path.resolve(SCRIPT_DIR, '..');
const DIST = path.join(PROJECT, 'dist');
// 路径可配置：优先环境变量，其次 `which` 查找，最后回退硬编码
const PYTHON = process.env.PYTHON_BIN || 'python3';
const NODE = process.env.NODE_BIN || process.execPath || 'node';
const JIEBA_BRIDGE = path.join(SCRIPT_DIR, '_jieba_bridge.py');

// ─── 产品→taxonomy 文件映射 ───
const TAX_FILES = {
  '弹性公网IP': 'eip-taxonomy-curated.json',
  '云专线': 'ct-taxonomy-curated.json',
  '虚拟私有云': 'vpc-taxonomy-curated.json',
  '弹性负载均衡': 'elb-taxonomy-curated.json',
  '云监控': 'monitor-taxonomy-curated.json',
};

// ─── 泛词黑名单（引擎 STOP 集合的子集 + 验证中他类命中率高的词）───
const GENERIC = new Set([
  '客户', '反馈', '问题', '无法', '需要', '处理', '情况', '导致', '影响', '进行', '通过', '没有', '不是',
  '我们', '他们', '这个', '那个', '什么', '怎么', '可以', '应该', '已经', '还是', '因为', '所以', '但是', '而且',
  '相关', '目前', '出现', '存在', '使用', '操作', '功能', '需求', '咨询', '申请', '协助', '确认', '查看', '提供',
  '业务', '资源', '信息', '系统', '平台', '页面', '流程', '人员', '时间', '方式', '内容', '结果', '原因', '状态',
  '支持', '服务', '产品', '用户', '实际', '直接', '及时', '尽快', '沟通', '联系', '回复', '告知', '说明', '了解',
  '以及', '或者', '如果', '由于', '对于', '关于', '工程师', '排查', '定位', '解决', '优化', '提升', '增加', '减少',
  '调整', '修改', '完善', '希望', '要求', '表示', '反映', '描述', '现象', '场景', '环境', '版本', '设置',
  '异常', '网络', '主机', '服务器', '设备', '面临', '故障', '影响', '中断', '失败', '报错', '请求', '返回',
  '人工', '缺乏', '满足', '数据', '获取', '实现', '知道', '发现', '认为', '担心',
  '明确', '清晰', '不同', '相同', '一样', '部分', '全部', '多个', '单个', '各种', '若干',
  '当前', '可能',
]);

const CJK = /[\u4e00-\u9fa5]/;
const MIN_SUPPORT = 5;        // 每类至少 5 样本才合成规则
const MIN_IN_FAM = 3;         // 本类命中至少 3 次
const MAX_OTHER_RATE = 15;    // 他类命中率 < 15%
const FAM_RATIO_MULT = 3;    // 本类命中率必须 > 他类 × 3
const TOP_K = 8;             // 每类取 top-8 关键词

// ─── jieba 分词桥接 ───
function jiebaTokenize(texts) {
  if (!fs.existsSync(JIEBA_BRIDGE)) {
    console.warn('[keyword-discovery] jieba bridge 不存在，跳过分词');
    return texts.map(() => []);
  }
  // jieba bridge 对长输入有限制，分批处理（每批 500 条）
  const BATCH_SIZE = 500;
  const allResults = [];
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    try {
      const input = JSON.stringify(batch);
      const result = execFileSync(PYTHON, [JIEBA_BRIDGE], {
        input,
        encoding: 'utf8',
        maxBuffer: 50 * 1024 * 1024,
        timeout: 120000,
      });
      const parsed = JSON.parse(result.trim());
      // jieba bridge 返回空格分隔的字符串，split 回 token 数组
      for (const s of parsed) {
        allResults.push(typeof s === 'string' ? s.split(' ').filter(Boolean) : (Array.isArray(s) ? s : []));
      }
    } catch (e) {
      console.warn(`[keyword-discovery] jieba 分批失败 (batch ${i}):`, e.message);
      for (let j = 0; j < batch.length; j++) allResults.push([]);
    }
  }
  return allResults;
}

// ─── 工具函数 ───
function loadEvidence() {
  const evPath = path.join(DIST, 'evidence-rows.json');
  if (!fs.existsSync(evPath)) {
    console.error('[keyword-discovery] evidence-rows.json 不存在，请先跑 validate-action-recs.cjs --emit');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(evPath, 'utf8'));
}

function loadTaxonomy(product) {
  const file = TAX_FILES[product];
  if (!file) return null;
  const p = path.join(SCRIPT_DIR, file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function getEngineWords(tax) {
  const words = new Set();
  for (const fam of (tax.families || [])) {
    for (const term of (fam.re || '').split('|')) {
      const t = term.trim();
      if (t) words.add(t);
    }
    for (const sub of (fam.subs || [])) {
      for (const term of (sub.re || '').split('|')) {
        const t = term.trim();
        if (t) words.add(t);
      }
    }
  }
  return words;
}

function isInEngine(word, engineWords) {
  for (const ew of engineWords) {
    if (word === ew || word.includes(ew) || ew.includes(word)) return true;
  }
  return false;
}

function tokenize(text, stopwords) {
  // 简单分词兜底（jieba 不用时）：按 2-3 字 n-gram 拆
  const tokens = [];
  const clean = text.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, ' ');
  // 提取 2-4 字汉字片段
  const matches = clean.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
  for (const m of matches) {
    if (!stopwords.has(m)) tokens.push(m);
  }
  return tokens;
}

// ─── 新词发现 ───
function discoverKeywords(product, rows, tax) {
  const families = (tax.families || []);
  const engineWords = getEngineWords(tax);
  const classified = rows.filter(r => r.status === 'classified' && r.fam);

  // 收集每类的文本
  const famTexts = {};
  const famCounts = {};
  for (const r of classified) {
    if (!famTexts[r.fam]) { famTexts[r.fam] = []; famCounts[r.fam] = 0; }
    famTexts[r.fam].push(r.text);
    famCounts[r.fam]++;
  }

  // jieba 分词所有文本
  const allTexts = classified.map(r => r.text);
  const allTokens = jiebaTokenize(allTexts);

  // 按 family 分组 token
  const famTokens = {};
  for (let i = 0; i < classified.length; i++) {
    const fam = classified[i].fam;
    if (!famTokens[fam]) famTokens[fam] = [];
    famTokens[fam].push(allTokens[i] || []);
  }

  // 对每类计算区分度
  const discoveries = [];
  for (const fam of families) {
    const famKey = fam.key;
    if ((famCounts[famKey] || 0) < MIN_SUPPORT) continue;

    const myDocs = famTokens[famKey] || [];
    if (myDocs.length < MIN_SUPPORT) continue;

    // 本类词频（文档级）
    const myTf = new Map();
    for (const tokens of myDocs) {
      for (const w of new Set(tokens)) {
        if (GENERIC.has(w) || !CJK.test(w) || w.length < 2) continue;
        myTf.set(w, (myTf.get(w) || 0) + 1);
      }
    }

    // 他类文档频率
    const otherDocs = [];
    for (const f2 of families) {
      if (f2.key === famKey) continue;
      const docs = famTokens[f2.key] || [];
      otherDocs.push(...docs);
    }
    const otherDf = new Map();
    for (const tokens of otherDocs) {
      for (const w of new Set(tokens)) {
        otherDf.set(w, (otherDf.get(w) || 0) + 1);
      }
    }

    // 全局文档频率
    const allDocs = [];
    for (const f2 of families) {
      allDocs.push(...(famTokens[f2.key] || []));
    }
    const globalDf = new Map();
    for (const tokens of allDocs) {
      for (const w of new Set(tokens)) {
        globalDf.set(w, (globalDf.get(w) || 0) + 1);
      }
    }

    const nTotal = allDocs.length;
    const myDocCount = myDocs.length;
    const otherDocCount = otherDocs.length;

    // 区分度评分
    const scored = [];
    for (const [w, tf] of myTf) {
      const myDf = tf; // 文档级频率
      const oDf = otherDf.get(w) || 0;
      const gDf = globalDf.get(w) || 0;

      const myRate = myDf / myDocCount;
      const otherRate = otherDocCount > 0 ? oDf / otherDocCount : 0;
      const globalRate = nTotal > 0 ? gDf / nTotal : 0;

      // 过滤：泛词
      if (globalRate > 0.50) continue;
      if (otherRate > 0.30 && myRate < 0.50) continue;

      // IDF
      const idf = Math.log((nTotal + 1) / (gDf + 1)) + 1;
      const discrimination = myRate * (1 - otherRate);
      const score = tf * idf * discrimination;

      if (score <= 0) continue;
      scored.push({ word: w, score, myDf, myRate, otherDf: oDf, otherRate, globalDf: gDf });
    }

    scored.sort((a, b) => b.score - a.score);

    // 筛选 + 检查引擎是否已覆盖
    for (const s of scored.slice(0, TOP_K)) {
      if (s.myDf < MIN_IN_FAM) continue;
      if (s.otherRate >= MAX_OTHER_RATE) continue;
      if (s.myRate < s.otherRate * FAM_RATIO_MULT && s.otherRate > 0) continue;
      if (isInEngine(s.word, engineWords)) continue;

      discoveries.push({
        product,
        famKey,
        famName: fam.name,
        word: s.word,
        score: Math.round(s.score * 1000) / 1000,
        inFam: s.myDf,
        famRate: Math.round(s.myRate * 1000) / 10,
        inOther: s.otherDf,
        otherRate: Math.round(s.otherRate * 1000) / 10,
      });
    }
  }

  return discoveries;
}

// ─── 混淆方向分析 ───
function analyzeConfusions(product, rows, tax) {
  // 读 pipeline-results 获取引擎分类结果
  const prPath = path.join(DIST, 'pipeline-results.json');
  if (!fs.existsSync(prPath)) return [];
  const pr = JSON.parse(fs.readFileSync(prPath, 'utf8'));
  const prodData = Object.values(pr.products || {}).find(p => p.p === product);
  if (!prodData || !prodData.items) return [];

  // 从 items 提取家族级混淆统计
  const confusions = {};
  for (const item of prodData.items) {
    if (!item.tier || item.tier === 'cross') continue;
    const fam = item.fam;
    if (!fam) continue;

    // 该 family 的子议题分布（如果引擎有 sub 但 fam 一样，说明子议题层混淆）
    if (!confusions[fam]) confusions[fam] = { total: 0, subs: {} };
    confusions[fam].total++;
    const subKey = item.sub || '(none)';
    if (!confusions[fam].subs[subKey]) confusions[fam].subs[subKey] = 0;
    confusions[fam].subs[subKey]++;
  }

  // 从 evidence-rows 找 pending 工单（引擎不确定的，最容易混淆的）
  const ev = loadEvidence();
  const evBlock = ev.find(e => e.p === product);
  if (!evBlock) return [];

  const pending = evBlock.rows.filter(r => r.status === 'pending');
  const pendingByFam = {};
  for (const r of pending) {
    const fam = r.fam;
    if (!fam) continue;
    if (!pendingByFam[fam]) pendingByFam[fam] = [];
    pendingByFam[fam].push(r);
  }

  // 从 RuleChef PoC 的 holdout 评估拿混淆矩阵
  const rcPath = path.join(DIST, 'poc-rulechef-report.json');
  let rcConfusions = [];
  if (fs.existsSync(rcPath)) {
    const rc = JSON.parse(fs.readFileSync(rcPath, 'utf8'));
    const rcProd = rc.products.find(p => p.product === product);
    if (rcProd && rcProd.best) {
      rcConfusions = rcProd.best.topConfusions || [];
    }
  }

  return {
    pendingByFam: Object.entries(pendingByFam).map(([fam, rs]) => ({
      fam,
      count: rs.length,
      samples: rs.slice(0, 3).map(r => ({ id: r.id, text: (r.text || '').substring(0, 80) })),
    })),
    ruleChefConfusions: rcConfusions,
  };
}

// ─── 生成 override 候选 ───
function generateOverrideCandidates(discoveries, tax) {
  const byProduct = {};
  for (const d of discoveries) {
    if (!byProduct[d.product]) byProduct[d.product] = {};
    if (!byProduct[d.product][d.famKey]) byProduct[d.product][d.famKey] = [];
    byProduct[d.product][d.famKey].push(d);
  }

  const candidates = {};
  for (const [product, fams] of Object.entries(byProduct)) {
    candidates[product] = { families: [] };
    for (const [famKey, words] of Object.entries(fams)) {
      const fam = (tax.families || []).find(f => f.key === famKey);
      if (!fam) continue;
      const addSubs = words.map((w, i) => ({
        key: `disc_${famKey}_${w.word.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '')}_${i}`,
        name: w.word,
        re: w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
      }));
      candidates[product].families.push({
        key: famKey,
        name: fam.name,
        addSubs,
      });
    }
  }
  return candidates;
}

// ─── 环境自检（--check-env）───
if (process.argv.includes('--check-env')) {
  console.log('=== keyword-discovery 环境自检 ===');
  console.log('Python:', PYTHON);
  try {
    const ver = execFileSync(PYTHON, ['-c', 'import sys; print(sys.version)'], { encoding: 'utf8', timeout: 10000 });
    console.log('  Python 版本:', ver.trim());
  } catch (e) { console.log('  ❌ Python 不可用:', e.message); }

  try {
    const jiebaOk = execFileSync(PYTHON, ['-c', 'import jieba; print("OK", jieba.__version__)'], { encoding: 'utf8', timeout: 15000 });
    console.log('  jieba:', jiebaOk.trim());
  } catch (e) { console.log('  ❌ jieba 不可用 — 请运行: pip install jieba'); }

  console.log('Node:', NODE, process.version);
  console.log('jieba bridge:', fs.existsSync(JIEBA_BRIDGE) ? '✅ ' + JIEBA_BRIDGE : '❌ 不存在');
  console.log('evidence-rows:', fs.existsSync(path.join(DIST, 'evidence-rows.json')) ? '✅ 存在' : '❌ 不存在（需先跑 validate-action-recs.cjs --emit）');
  console.log('taxonomy-overrides:', fs.existsSync(path.join(SCRIPT_DIR, 'taxonomy-overrides.json')) ? '✅ 存在' : '（无增量，纯基线）');
  process.exit(0);
}

// ─── 主流程 ───
function main() {
  const applyFlag = process.argv.includes('--apply');
  const productsArg = process.argv.indexOf('--products');
  const filterProducts = productsArg >= 0 && process.argv[productsArg + 1]
    ? process.argv[productsArg + 1].split(',').map(s => s.trim())
    : null;

  console.log('======================================================');
  console.log('  行动建议规则补充 · 关键词发现 + 混淆分析');
  console.log('======================================================');

  const evidence = loadEvidence();
  const allDiscoveries = [];
  const allConfusions = {};

  for (const block of evidence) {
    const product = block.p;
    if (filterProducts && !filterProducts.some(fp => product.includes(fp))) continue;

    console.log(`\n--- ${product} ---`);
    const tax = loadTaxonomy(product);
    if (!tax) { console.log('  taxonomy 不存在，跳过'); continue; }

    const rows = block.rows;
    console.log(`  工单: ${rows.length}`);

    // 新词发现
    const discoveries = discoverKeywords(product, rows, tax);
    console.log(`  新词发现: ${discoveries.length} 个`);
    for (const d of discoveries.slice(0, 5)) {
      console.log(`    ${d.famKey}: ${d.word} (score=${d.score}, 本类=${d.inFam}(${d.famRate}%), 他类=${d.inOther}(${d.otherRate}%))`);
    }
    allDiscoveries.push(...discoveries);

    // 混淆分析
    const confusions = analyzeConfusions(product, rows, tax);
    allConfusions[product] = confusions;
    if (confusions.pendingByFam) {
      console.log(`  待确认家族分布:`);
      for (const p of confusions.pendingByFam.slice(0, 3)) {
        console.log(`    ${p.fam}: ${p.count}张`);
      }
    }
    if (confusions.ruleChefConfusions && confusions.ruleChefConfusions.length) {
      console.log(`  规则合成混淆:`);
      for (const c of confusions.ruleChefConfusions.slice(0, 3)) {
        console.log(`    ${c.from} → ${c.to} (${c.count}次)`);
      }
    }
  }

  // 生成 override 候选
  const overrideCandidates = {};
  for (const block of evidence) {
    const product = block.p;
    if (filterProducts && !filterProducts.some(fp => product.includes(fp))) continue;
    const tax = loadTaxonomy(product);
    if (!tax) continue;
    const myDiscos = allDiscoveries.filter(d => d.product === product);
    if (myDiscos.length === 0) continue;
    const cands = generateOverrideCandidates(myDiscos, tax);
    if (cands[product]) overrideCandidates[product] = cands[product];
  }

  // 写产物
  fs.mkdirSync(DIST, { recursive: true });

  const reportPath = path.join(DIST, 'keyword-discovery-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    meta: {
      runAt: new Date().toISOString(),
      thresholds: { MIN_SUPPORT, MIN_IN_FAM, MAX_OTHER_RATE, FAM_RATIO_MULT, TOP_K },
    },
    discoveries: allDiscoveries,
    confusionAnalysis: allConfusions,
  }, null, 2), 'utf8');
  console.log(`\n  新词报告 → ${path.relative(PROJECT, reportPath)}`);

  const candPath = path.join(DIST, 'taxonomy-override-candidates.json');
  fs.writeFileSync(candPath, JSON.stringify(overrideCandidates, null, 2), 'utf8');
  console.log(`  候选增量 → ${path.relative(PROJECT, candPath)}`);

  // --apply：直接写入 taxonomy-overrides.json
  if (applyFlag) {
    const ovPath = path.join(SCRIPT_DIR, 'taxonomy-overrides.json');
    let existing = {};
    try { existing = JSON.parse(fs.readFileSync(ovPath, 'utf8')); } catch {}
    for (const [product, cand] of Object.entries(overrideCandidates)) {
      if (!existing[product]) existing[product] = { families: [] };
      for (const newFam of (cand.families || [])) {
        let famOv = existing[product].families.find(f => f.key === newFam.key);
        if (!famOv) { famOv = { key: newFam.key, name: newFam.name, addSubs: [] }; existing[product].families.push(famOv); }
        for (const sub of (newFam.addSubs || [])) {
          if (!famOv.addSubs.some(s => s.re === sub.re)) famOv.addSubs.push(sub);
        }
      }
    }
    fs.writeFileSync(ovPath, JSON.stringify(existing, null, 2), 'utf8');
    console.log(`  已应用 → ${path.relative(PROJECT, ovPath)}`);
    console.log('  ⚠️ 请跑 gate-check.cjs 验证门禁通过后再发布');
  } else {
    console.log('\n  提示：加 --apply 可直接写入 taxonomy-overrides.json（需再跑门禁验证）');
  }

  // 总结
  console.log(`\n  合计：${allDiscoveries.length} 个新词候选，${Object.keys(overrideCandidates).length} 个产品有候选`);
  console.log('  下一步：人工审核候选 → 确认后 --apply 或手动写入 taxonomy-overrides.json → 跑门禁');
}

try { main(); }
catch (e) { console.error('[keyword-discovery] 致命错误:', e.message, e.stack); process.exit(3); }
