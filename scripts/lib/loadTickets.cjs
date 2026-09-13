/* 反馈库工单统一加载器（唯一真源 = 反馈库 records 表）
 * =========================================================================
 * 演进：
 *   ① 最早 5 个脚本都读 /tmp/tg3.json（孤儿中间产物，/tmp 会被清、不在版本控制）→ 已弃。
 *   ② 改为直读 data/反馈库7月–8月.xlsx（人工导出快照）→ 可行但不算系统真源。
 *   ③ 现改为读反馈库 records 表（server/data/auth.db）真源：数据经系统入库路径灌入，
 *      分析不再依赖人工导出文件。xlsx 仅作为"库为空时的开发兜底"。
 *   ④ 2026-09-12：支持全量模式（不按 batch 过滤），适配线上部署环境。
 *      线上每次导入的 batch ID 不同，硬编码 batch 取不到新数据。
 *      全量模式按 tenant_id + data_source_type + import_month 范围过滤，与
 *      storageRepository.listRecords() 的查询模式一致。
 *
 * 反馈库 records 表即"反馈库"模块系统-of-record；本加载器重建分析脚本需要的派生字段：
 * _sheet（原始 sheet 名）、_src（投诉/咨询）、_month（YYYY-MM）。
 *
 * 数据范围控制（优先级从高到低）：
 *   1. FEEDBACK_BATCH=<id>         → 按 import_batch_id 精确过滤（开发模式）
 *   2. FEEDBACK_BATCH=*            → 全量模式，取所有 complaint_ticket + consultation_ticket
 *   3. FEEDBACK_MONTH_FROM=YYYY-MM → 按月份范围过滤（需配合 FEEDBACK_MONTH_TO）
 *   4. 都不设                       → 回退默认 dev batch（本地开发兼容）
 * ========================================================================= */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_XLSX = path.join(ROOT, 'data', '反馈库7月–8月.xlsx');
const DB_PATH = process.env.FEEDBACK_DB || path.join(ROOT, 'server', 'data', 'auth.db');
const DEFAULT_DEV_BATCH = 'taxonomy-dev-4products-2026-07-08';

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

// xlsx 兜底（库为空时，保证开发可跑）
function loadFromXlsx(file) {
  const XLSX = require('xlsx');
  const wb = XLSX.readFile(file);
  const rows = [];
  const meta = [];
  for (const sn of wb.SheetNames) {
    const sheetRows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, blankrows: false });
    if (!sheetRows.length) continue;
    const hdr = sheetRows[0].map(h => String(h == null ? '' : h).trim());
    const { src, month } = parseSheetName(sn);
    let n = 0;
    for (let i = 1; i < sheetRows.length; i++) {
      const r = sheetRows[i];
      if (!r || r.every(c => c == null || String(c).trim() === '')) continue;
      const o = {};
      hdr.forEach((h, j) => { if (h) o[h] = r[j] != null ? String(r[j]).trim() : ''; });
      o._sheet = sn; o._src = src; o._month = month;
      rows.push(o); n++;
    }
    meta.push({ sheet: sn, src, month, rows: n });
  }
  return { rows, meta, file };
}

/**
 * 构建 DB 查询的 WHERE 子句与参数。
 * 数据范围由 FEEDBACK_BATCH 环境变量控制：
 *   - '×' 或 '*'  → 全量模式（不按 batch 过滤，取所有工单类记录）
 *   - 具体值       → 按该 batch ID 精确过滤
 *   - 未设         → 回退默认 dev batch
 * 另支持 FEEDBACK_MONTH_FROM / FEEDBACK_MONTH_TO 做月份范围过滤（可选叠加）。
 */
function buildDbQuery() {
  const batchEnv = process.env.FEEDBACK_BATCH;
  const monthFrom = process.env.FEEDBACK_MONTH_FROM;
  const monthTo = process.env.FEEDBACK_MONTH_TO;

  const parts = [
    "data_source_type IN ('complaint_ticket', 'consultation_ticket')",
  ];
  const params = [];
  let batchLabel;

  if (batchEnv && batchEnv !== '*' && batchEnv !== '×') {
    parts.push('import_batch_id = ?');
    params.push(batchEnv);
    batchLabel = batchEnv;
  } else if (batchEnv === '*' || batchEnv === '×') {
    // 全量模式：不按 batch 过滤
    batchLabel = '(all batches)';
  } else {
    // 回退默认 dev batch（本地开发兼容）
    parts.push('import_batch_id = ?');
    params.push(DEFAULT_DEV_BATCH);
    batchLabel = DEFAULT_DEV_BATCH;
  }

  if (monthFrom) {
    parts.push('import_month >= ?');
    params.push(monthFrom);
  }
  if (monthTo) {
    parts.push('import_month <= ?');
    params.push(monthTo);
  }

  return { where: parts.join(' AND '), params, batchLabel };
}

// 反馈库真源
function loadFromDb() {
  const Database = require('better-sqlite3');
  const db = new Database(DB_PATH);
  try {
    const { where, params, batchLabel } = buildDbQuery();
    const rows = db.prepare(
      `SELECT payload, import_month AS importMonth, data_source_type AS dataSourceType, import_batch_id AS batch, ticket_id AS ticketId
       FROM records WHERE ${where} ORDER BY import_month DESC, id ASC`,
    ).all(...params);
    const out = [];
    const metaMap = new Map();
    for (const r of rows) {
      let p;
      try { p = JSON.parse(r.payload); } catch { continue; }
      const src = r.dataSourceType === 'complaint_ticket' ? '投诉' : r.dataSourceType === 'consultation_ticket' ? '咨询' : '投诉';
      const sheet = p.importSheetName || `${src}工单-${r.importMonth}月`;
      const o = { ...p, _sheet: sheet, _src: src, _month: r.importMonth };
      out.push(o);
      const mk = `${sheet}|${src}|${r.importMonth}`;
      metaMap.set(mk, (metaMap.get(mk) || 0) + 1);
    }
    const meta = [...metaMap.entries()].map(([k, n]) => {
      const [sheet, src, month] = k.split('|');
      return { sheet, src, month, rows: n };
    });
    return { rows: out, meta, file: `feedback-library://records?batch=${batchLabel}` };
  } finally {
    db.close();
  }
}

/**
 * @param {{file?: string, prefer?: 'db'|'xlsx'}} [opts]
 * @returns {{rows: Object[], meta: Object[], file: string}}
 */
function loadTickets(opts = {}) {
  const prefer = opts.prefer || (process.env.LOAD_FROM === 'xlsx' ? 'xlsx' : 'db');
  // 优先反馈库真源
  if (prefer !== 'xlsx') {
    try {
      if (fs.existsSync(DB_PATH)) {
        const d = loadFromDb();
        if (d.rows.length) return d;
        const batchEnv = process.env.FEEDBACK_BATCH || DEFAULT_DEV_BATCH;
        console.warn(`[loadTickets] 反馈库 batch=${batchEnv} 无数据，回退 xlsx`);
      }
    } catch (e) {
      console.warn(`[loadTickets] 读反馈库失败，回退 xlsx：${e.message}`);
    }
  }
  const file = opts.file || process.env.DATA_XLSX || DEFAULT_XLSX;
  if (!fs.existsSync(file)) {
    const batchEnv = process.env.FEEDBACK_BATCH || DEFAULT_DEV_BATCH;
    throw new Error(`反馈库与 xlsx 均无可用数据源（batch=${batchEnv}；xlsx=${file}）`);
  }
  return loadFromXlsx(file);
}

module.exports = { loadTickets, parseSheetName, loadFromDb, loadFromXlsx, buildDbQuery, DEFAULT_XLSX, DEFAULT_DEV_BATCH };
