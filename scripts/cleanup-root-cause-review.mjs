/**
 * 清理历史工单中"被误存为人工复核(rootCauseReview)的导入问题原因"脏数据。
 *
 * 背景：旧版"强制重打标/FORCE"与旧版详情抽屉会把导入列「问题原因」写入 rootCauseReview，
 * 上线新版后这些记录会被「问题原因」列显示为"人工"。本脚本把这类脏数据清空，
 * 让该列回退到"自动生成(rootCause)"或为空。
 *
 * 安全判定（默认模式）：
 *   rootCauseReview 非空 且 manualTagFields 不含 'rootCauseReview'
 *   —— 真人手填 / 导入模板填入的都会被标记，不会被误清；仅旧 FORCE 等未标记的脏数据命中。
 *
 * 精确模式（--exact-import-match）：
 *   额外要求 rootCauseReview 严格等于「导入列问题原因经污染过滤后的值」，
 *   可覆盖"旧版抽屉触碰即存"的情形（其 manualTagFields 含 rootCauseReview 但值实为导入文本）。
 *
 * 重要：
 *   - 默认仅扫描并打印统计，不改动任何数据。
 *   - 真正写入需显式加 --apply；写前请先备份 DB 文件（含 -wal / -shm）。
 *   - 复用仓库的 getDb / storageRepository，自动命中线上配置的 DB 路径
 *     （SERVER_DATA_DIR / AUTH_DATABASE_PATH）。
 *
 * 用法：
 *   node scripts/cleanup-root-cause-review.mjs                       # 只读扫描
 *   node scripts/cleanup-root-cause-review.mjs --exact-import-match  # 只读扫描（精确模式）
 *   node scripts/cleanup-root-cause-review.mjs --apply              # 执行清洗
 *   node scripts/cleanup-root-cause-review.mjs --apply --exact-import-match
 *   # 可选：--dataSourceType=complaint_ticket  仅某数据源
 *   # 可选：--limit=2000                     仅扫描前 N 条（用于先小批量试跑）
 */
import { storageRepository } from '../server/storageRepository.js'
import { getManualTagFields } from '../src/lib/manualTagFields.js'

const ARGS = new Set(process.argv.slice(2))
const APPLY = ARGS.has('--apply')
const EXACT_IMPORT = ARGS.has('--exact-import-match')
const DS_TYPE = process.argv
  .find((a) => a.startsWith('--dataSourceType='))
  ?.split('=')[1]
const LIMIT_ARG = process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1]
const SCAN_LIMIT = LIMIT_ARG ? Number(LIMIT_ARG) : Infinity
const PAGE = 5000

let sanitizeImportProblemCauseForReview = null
if (EXACT_IMPORT) {
  try {
    ({ sanitizeImportProblemCauseForReview } = await import(
      '../src/lib/painPointClustering/clusteringCause.js'
    ))
  } catch (e) {
    console.error('无法加载 sanitizeImportProblemCauseForReview：', e.message)
    process.exit(1)
  }
}

/**
 * @param {Record<string, unknown>} record
 * @returns {boolean}
 */
function shouldClean(record) {
  const rc = String(record?.rootCauseReview ?? '').trim()
  if (!rc) return false

  if (EXACT_IMPORT) {
    if (!sanitizeImportProblemCauseForReview) return false
    const importVal = sanitizeImportProblemCauseForReview(
      record?.sourceColumns?.['问题原因'] ?? '',
    )
    return rc === importVal
  }

  // 默认模式：未显式标记为人工资护维度的才清洗
  const manual = getManualTagFields(record)
  return !manual.includes('rootCauseReview')
}

function summarize(record) {
  const rc = String(record?.rootCauseReview ?? '')
  return {
    id: record.id,
    ticketId: record.ticketId || '',
    dataSourceType: record.dataSourceType || '',
    manualTagFields: getManualTagFields(record),
    rootCauseReview: rc.length > 40 ? `${rc.slice(0, 40)}…(${rc.length})` : rc,
  }
}

async function main() {
  const query = {}
  if (DS_TYPE) query.dataSourceType = DS_TYPE

  console.log(`模式: ${APPLY ? '执行清洗(APPLY)' : '只读扫描(DRY-RUN)'}${EXACT_IMPORT ? ' [精确匹配导入值]' : ''}`)
  if (DS_TYPE) console.log(`数据源过滤: ${DS_TYPE}`)
  if (Number.isFinite(SCAN_LIMIT)) console.log(`扫描上限: ${SCAN_LIMIT} 条`)

  let scanned = 0
  let matched = 0
  /** @type {Record<string, unknown>[]} */
  const toClean = []
  const samples = []

  let offset = 0
  // 分页拉取全部记录（listRecords 单次上限 5000）
  for (;;) {
    const { records, total } = storageRepository.listRecords({
      ...query,
      limit: PAGE,
      offset,
    })
    if (!records.length) break

    for (const record of records) {
      scanned += 1
      if (scanned > SCAN_LIMIT) {
        scanned -= 1
        break
      }
      if (shouldClean(record)) {
        matched += 1
        if (samples.length < 10) samples.push(summarize(record))
        if (APPLY) toClean.push(record)
      }
    }

    if (records.length < PAGE) break
    offset += PAGE
    if (scanned >= SCAN_LIMIT) break
  }

  console.log(`\n扫描记录: ${scanned}`)
  console.log(`命中待清洗: ${matched}`)
  if (samples.length) {
    console.log('\n命中样本(前 10):')
    for (const s of samples) {
      console.log(
        `  id=${s.id} ticket=${s.ticketId} src=${s.dataSourceType} ` +
          `manual=[${s.manualTagFields.join(',')}] rc="${s.rootCauseReview}"`,
      )
    }
  }

  if (!APPLY) {
    console.log('\n★ 当前为只读扫描，未做任何修改。')
    console.log('★ 确认无误并已完成 DB 备份后，加 --apply 执行清洗。')
    return
  }

  if (!toClean.length) {
    console.log('\n无待清洗记录，无需写入。')
    return
  }

  console.log(
    `\n⚠️ 即将清空 ${toClean.length} 条记录的 rootCauseReview（设为空字符串），` +
      `manualTagFields 保持不变。`,
  )
  console.log('⚠️ 请确认已备份 DB 文件（含 -wal / -shm）。继续写入…')

  const cleared = toClean.map((record) => ({ ...record, rootCauseReview: '' }))
  const BATCH = 500
  let written = 0
  for (let i = 0; i < cleared.length; i += BATCH) {
    const chunk = cleared.slice(i, i + BATCH)
    const res = storageRepository.putRecords(chunk)
    written += res.written
  }

  console.log(`\n✅ 已写入 ${written} 条（rootCauseReview 已清空）。`)
  console.log('提示：列表/导出「问题原因」列为实时计算，无需重建快照即可生效。')
}

main().catch((err) => {
  console.error('清理脚本异常:', err)
  process.exit(1)
})
