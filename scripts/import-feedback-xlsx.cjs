/* 反馈库灌库脚本：把手工导出的 xlsx 子集按系统 records 表同构写入反馈库真源。
 * =========================================================================
 * 背景：此前分析只读 data/反馈库7月–8月.xlsx（人工导出），既非系统真源、也不可复现。
 *       反馈库（"反馈库"模块）的唯一真源是 server/data/auth.db 的 records 表
 *       （业务库，尽管文件名带 auth）。本脚本把这份 4 产品·2026-07~08·投诉+咨询 样本
 *       按系统记录同构灌入 records 表，使分析改读反馈库真源（见 scripts/lib/loadTickets.cjs）。
 *
 * 设计要点：
 *   - 走系统 records 表同构：payload 同时保留【原始中文列】（分析脚本直接读）与
 *     【canonical 字段】（反馈库 UI / 其他模块读），两不误。
 *   - 专用 import_batch_id = IMPORT_BATCH_ID，可重入：重跑时按 (dataSourceType, ticketId)
 *     去重，已存在的跳过；绝不覆盖库内现有 197 投诉工单等其它数据。
 *   - 不删除任何现有数据；如发现 ticket_id 与库内冲突，按"跳过冲突"处理（系统本就限制唯一）。
 *   - 运行时：必须用 Node 20（better-sqlite3 原生模块按 Node20 编译）。
 *       /Users/hling/.nvm/versions/node/v20.18.0/bin/node scripts/import-feedback-xlsx.cjs
 * ========================================================================= */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const XLSX = require('xlsx');

const ROOT = path.resolve(__dirname, '..');
const XLSX_FILE = process.env.DATA_XLSX || path.join(ROOT, 'data', '反馈库7月–8月.xlsx');
const DB_PATH = process.env.FEEDBACK_DB || path.join(ROOT, 'server', 'data', 'auth.db');
const IMPORT_BATCH_ID = 'taxonomy-dev-4products-2026-07-08';
// 独立租户：与反馈库现有 'local' 生产数据隔离，避免 (tenant,dataSourceType,ticketId)
// 唯一索引冲突导致本批投诉工单被跳过；同时让本批数据可整体按 batch 清理、可重入。
const TENANT = 'taxonomy-dev';

// 产品名称 → productKey（与反馈库现有约定一致）
const PRODUCT_KEY = {
  '弹性公网IP': 'eip',
  '云专线': 'dc',
  '虚拟私有云': 'vpc',
  '弹性负载均衡': 'elb',
};

// 中文导出列 → canonical 字段（权威对照，取自反馈库现有记录 sourceColumns）
const COL_TO_CANON = {
  '工单号': 'ticketId',
  '产品名称': 'product',
  '客户请求内容': 'customerRequest',
  '需求痛点': 'painPoint',
  '问题原因': 'rootCauseReview',
  '请求场景': 'requestScene',
  '问题类型': 'problemType',
  '用户旅程一级': 'journeyL1',
  '用户旅程二级': 'journeyL2',
  '用户情绪': 'sentiment',
  '是否加急': 'urgencyLevel',
  '回访满意度': 'followUpSatisfaction',
  '不满意原因': 'dissatisfactionReason',
  '产品技术优化': 'optimizationSuggestion',
  '服务流程改进': 'optimizationService',
  '产品组优化建议': 'optimizationProduct',
  '设计师优化建议': 'designerOptimization',
  '确立举措': 'establishedAction',
  '排期': 'actionSchedule',
  '未完成待办': 'todo',
  '受理内容': 'handlingText',
  '处理意见': 'responseText',
  '客户类型名称': 'customerType',
  '集团名称': 'customerGroup',
  '集团客户编码': 'customerGroupCode',
  '集团所属省份': 'customerProvince',
  '集团所属地市': 'customerCity',
  '登录账号名称': 'loginAccount',
  '移动云客户服务等级': 'serviceLevel',
  '受理渠道': 'source',
};

function parseSheetName(name) {
  const s = String(name || '').trim();
  let month = '';
  const m1 = s.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  const m2 = s.match(/(\d{4})[-/](\d{1,2})(?!\d)/);
  if (m1) month = `${m1[1]}-${String(m1[2]).padStart(2, '0')}`;
  else if (m2) month = `${m2[1]}-${String(m2[2]).padStart(2, '0')}`;
  let src = '';
  if (/投诉/.test(s)) src = '投诉';
  else if (/咨询/.test(s)) src = '咨询';
  return { src, month };
}

function main() {
  if (!fs.existsSync(XLSX_FILE)) throw new Error(`xlsx 不存在：${XLSX_FILE}`);
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');

  // 建表（与系统 schema 对齐，缺则补）——保证脚本独立可跑、不依赖先启动 server
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      import_month TEXT NOT NULL DEFAULT '',
      data_source_type TEXT NOT NULL DEFAULT 'complaint_ticket',
      tenant_id TEXT NOT NULL DEFAULT 'local',
      import_batch_id TEXT NOT NULL DEFAULT '',
      ticket_id TEXT
    );
  `);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_records_import_month ON records(import_month);
    CREATE INDEX IF NOT EXISTS idx_records_source ON records(data_source_type);
    CREATE INDEX IF NOT EXISTS idx_records_tenant ON records(tenant_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_records_tenant_src_ticket
      ON records(tenant_id, data_source_type, ticket_id)
      WHERE ticket_id IS NOT NULL;
  `);

  // 可重入：先清空本批上次灌入的数据（仅删本 batch，不动库内其它数据），再整批写入。
  const cleared = db.prepare(`DELETE FROM records WHERE import_batch_id = ?`).run(IMPORT_BATCH_ID);
  if (cleared.changes) console.log(`(清理上次同批数据 ${cleared.changes} 行，准备重灌)`);

  // 现有 (tenant, dataSourceType, ticketId) 集合，用于跳过冲突（隔离租户下基本不会发生）
  const existing = new Set();
  for (const r of db.prepare(
    `SELECT data_source_type, ticket_id FROM records WHERE tenant_id=? AND ticket_id IS NOT NULL`,
  ).all(TENANT)) {
    existing.add(`${r.data_source_type}|${r.ticket_id}`);
  }

  const wb = XLSX.readFile(XLSX_FILE);
  const insert = db.prepare(
    `INSERT INTO records (id, payload, import_month, data_source_type, tenant_id, import_batch_id, ticket_id)
     VALUES (@id, @payload, @import_month, @data_source_type, @tenant_id, @import_batch_id, @ticket_id)`,
  );

  let parsed = 0, inserted = 0, skipped = 0;
  const byKey = {}; // `${src}|${month}|${product}` -> count
  const toInsert = [];

  for (const sn of wb.SheetNames) {
    const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false });
    if (!sheetRows.length) continue;
    const hdr = sheetRows[0].map(h => String(h == null ? '' : h).trim());
    const { src, month } = parseSheetName(sn);
    const dataSourceType = src === '投诉' ? 'complaint_ticket' : src === '咨询' ? 'consultation_ticket' : 'complaint_ticket';
    const now = new Date().toISOString();

    for (let i = 1; i < sheetRows.length; i++) {
      const raw = sheetRows[i];
      if (!raw || raw.every(c => c == null || String(c).trim() === '')) continue;
      const o = {};
      hdr.forEach((h, j) => { if (h) o[h] = raw[j] != null ? String(raw[j]).trim() : ''; });
      const ticketId = String(o['工单号'] || '').trim();
      const product = String(o['产品名称'] || '').trim();
      parsed++;
      const key = `${src}|${month}|${product || '未知'}`;
      byKey[key] = (byKey[key] || 0) + 1;

      if (ticketId && existing.has(`${dataSourceType}|${ticketId}`)) { skipped++; continue; }

      const payload = {
        schemaVersion: 2,
        tenantId: TENANT,
        dataSourceType,
        recordStatus: 'imported',
        id: `taxdev-${dataSourceType}-${ticketId || crypto.randomUUID()}`,
        importedAt: now,
        importMonth: month,
        importBatchId: IMPORT_BATCH_ID,
        importBatchName: `行动建议分类验证·${month} ${src}工单导入`,
        importFileName: path.basename(XLSX_FILE),
        importSheetName: sn,
        createdAt: now,
        product,
        productKey: PRODUCT_KEY[product] || '',
        source: o['受理渠道'] || '',
        rawText: o['客户请求内容'] || '',
        customerRequest: o['客户请求内容'] || '',
        handlingText: o['受理内容'] || '',
        responseText: o['处理意见'] || '',
        problemType: o['问题类型'] || '',
        painPoint: o['需求痛点'] || '',
        rootCauseReview: o['问题原因'] || '',
        optimizationSuggestion: o['产品技术优化'] || '',
        requestScene: o['请求场景'] || '',
        journeyL1: o['用户旅程一级'] || '',
        journeyL2: o['用户旅程二级'] || '',
        sentiment: o['用户情绪'] || '',
        urgencyLevel: o['是否加急'] || '',
        customerType: o['客户类型名称'] || '',
        customerGroup: o['集团名称'] || '',
        sourceColumns: COL_TO_CANON,
        // 原始中文列原样保留（分析脚本直接读这些键）
        ...o,
      };
      toInsert.push({
        id: payload.id,
        payload: JSON.stringify(payload),
        import_month: month,
        data_source_type: dataSourceType,
        tenant_id: TENANT,
        import_batch_id: IMPORT_BATCH_ID,
        ticket_id: ticketId || null,
      });
      if (ticketId) existing.add(`${dataSourceType}|${ticketId}`);
    }
  }

  // 逐行插入（行级容错，冲突跳过）
  for (const row of toInsert) {
    try { insert.run(row); inserted++; }
    catch (e) { skipped++; }
  }
  db.close();

  console.log('=== 灌库完成 ===');
  console.log(`xlsx 解析: ${parsed} 行`);
  console.log(`写入反馈库: ${inserted} 行 (import_batch_id=${IMPORT_BATCH_ID})`);
  console.log(`跳过(冲突/空): ${skipped} 行`);
  console.log('按 来源|月份|产品:');
  for (const k of Object.keys(byKey).sort()) console.log(`  ${k}: ${byKey[k]}`);
}

main();
