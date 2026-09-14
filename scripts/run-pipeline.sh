#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# 行动建议规则补充 · 部署环境运行脚本
# ===========================================================================
# 用法：
#   ./scripts/run-pipeline.sh                     # 全量模式（取所有工单）
#   ./scripts/run-pipeline.sh --batch <batch_id>  # 按 batch 过滤
#   ./scripts/run-pipeline.sh --month 2026-07 2026-08  # 按月份范围
#   ./scripts/run-pipeline.sh --products EIP,云专线      # 指定产品
#   ./scripts/run-pipeline.sh --no-apply          # 只发现新词不自动写入
#   ./scripts/run-pipeline.sh --no-gate           # 跳过门禁
#   ./scripts/run-pipeline.sh --webhook <URL>     # 跑完 POST 摘要到回调地址
#
# 环境变量（优先于命令行参数）：
#   FEEDBACK_DB       — DB 路径（默认 server/data/auth.db）
#   FEEDBACK_BATCH    — batch ID（'*' = 全量，默认回退 dev batch）
#   FEEDBACK_MONTH_FROM / FEEDBACK_MONTH_TO — 月份范围
#   PRODUCTS           — 产品范围（'*' = 全部，默认只 curated 产品）
#   PYTHON_BIN         — Python 路径（keyword-discovery 需要 jieba）
#   NODE_BIN           — Node.js 路径
#
# 产出：
#   dist/pipeline-results.json      — Producer 归因结果
#   dist/evidence-rows.json         — 每条工单的归因证据
#   dist/taxonomy-current.json      — 当前生效的分类法
#   dist/taxonomy-override-candidates.json — 新词候选
#   scripts/taxonomy-overrides.json — 已写入的 overrides
#   dist/pipeline-report.log        — 完整运行日志
#   dist/pipeline-summary.json      — 结构化摘要（供 webhook/告警消费）
# ===========================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DIST_DIR="$PROJECT_ROOT/dist"
LOG_FILE="$DIST_DIR/pipeline-report.log"
SUMMARY_FILE="$DIST_DIR/pipeline-summary.json"

mkdir -p "$DIST_DIR"

# 默认值
NODE_BIN="${NODE_BIN:-$(which node)}"
PYTHON_BIN="${PYTHON_BIN:-$(which python3)}"
PRODUCTS="${PRODUCTS:-}"
FEEDBACK_BATCH="${FEEDBACK_BATCH:-}"
FEEDBACK_DB="${FEEDBACK_DB:-$PROJECT_ROOT/server/data/auth.db}"
APPLY=true
RUN_GATE=true
WEBHOOK_URL=""

# 解析命令行参数
while [[ $# -gt 0 ]]; do
  case "$1" in
    --batch)      FEEDBACK_BATCH="$2"; shift 2 ;;
    --month)      FEEDBACK_MONTH_FROM="$2"; FEEDBACK_MONTH_TO="$3"; shift 3 ;;
    --products)   PRODUCTS="$2"; shift 2 ;;
    --no-apply)   APPLY=false; shift ;;
    --no-gate)    RUN_GATE=false; shift ;;
    --webhook)    WEBHOOK_URL="$2"; shift 2 ;;
    --help)
      echo "用法: $0 [选项]"
      echo "  --batch <id>          按 batch ID 过滤（'*' = 全量）"
      echo "  --month <from> <to>   按月份范围过滤 (YYYY-MM)"
      echo "  --products <list>     产品范围（'*' = 全部，或逗号分隔）"
      echo "  --no-apply            只发现新词不自动写入 taxonomy-overrides"
      echo "  --no-gate             跳过门禁验证"
      echo "  --webhook <URL>       跑完 POST 摘要 JSON 到回调地址"
      exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
done

export NODE_BIN PYTHON_BIN FEEDBACK_DB
[[ -n "$FEEDBACK_BATCH" ]] && export FEEDBACK_BATCH
[[ -n "${FEEDBACK_MONTH_FROM:-}" ]] && export FEEDBACK_MONTH_FROM
[[ -n "${FEEDBACK_MONTH_TO:-}" ]] && export FEEDBACK_MONTH_TO
[[ -n "$PRODUCTS" ]] && export PRODUCTS

# ---- 计时 ----
PIPELINE_START=$(date +%s)
RUN_DATE=$(date '+%Y-%m-%d %H:%M:%S')

# ---- 日志：同时输出到终端和文件 ----
exec > >(tee "$LOG_FILE") 2>&1

echo "======================================================"
echo "  行动建议规则补充 · 部署环境运行"
echo "======================================================"
echo "  时间:       $RUN_DATE"
echo "  Node:       $NODE_BIN"
echo "  Python:     $PYTHON_BIN"
echo "  DB:         $FEEDBACK_DB"
echo "  Batch:      ${FEEDBACK_BATCH:-(default dev)}"
echo "  Products:   ${PRODUCTS:-(curated only)}"
echo "  Auto-apply: $APPLY"
  echo "  Gate:       $RUN_GATE"
  [[ -n "$WEBHOOK_URL" ]] && echo "  Webhook:    $WEBHOOK_URL"
  echo ""

# ---- 变量：用于最终摘要 ----
PRODUCER_STATUS="unknown"
EVIDENCE_ROWS_COUNT=0
NEW_WORD_COUNT=0
GATE_PASS_COUNT=0
GATE_FAIL_COUNT=0
GATE_FAIL_ITEMS=""
GATE_STATUS="skipped"
PIPELINE_STATUS="running"

# ---- 结构化摘要 + 退出函数（提前定义，供任意失败分支调用）----
_write_summary_and_exit() {
  local exit_code=${1:-0}
  PIPELINE_END=$(date +%s)
  DURATION_SEC=$((PIPELINE_END - PIPELINE_START))
  DURATION_MIN=$((DURATION_SEC / 60))
  DURATION_STR="${DURATION_MIN}m$((DURATION_SEC % 60))s"
  cat > "$SUMMARY_FILE" <<ENDJSON
{
  "runDate": "$RUN_DATE",
  "durationSec": $DURATION_SEC,
  "status": "$PIPELINE_STATUS",
  "producer": "$PRODUCER_STATUS",
  "evidenceRowsCount": $EVIDENCE_ROWS_COUNT,
  "newWordCount": $NEW_WORD_COUNT,
  "gate": {
    "status": "$GATE_STATUS",
    "passCount": $GATE_PASS_COUNT,
    "failCount": $GATE_FAIL_COUNT
  },
  "config": {
    "batch": "${FEEDBACK_BATCH:-(default dev)}",
    "products": "${PRODUCTS:-(curated only)}",
    "autoApply": $APPLY,
    "runGate": $RUN_GATE
  }
}
ENDJSON

  echo ""
  echo "======================================================"
  echo "  流水线完成"
  echo "======================================================"
  echo "  状态:      $PIPELINE_STATUS"
  echo "  耗时:      $DURATION_STR"
  echo "  工单数:    $EVIDENCE_ROWS_COUNT"
  echo "  新词数:    $NEW_WORD_COUNT"
  echo "  门禁:      $GATE_STATUS ($GATE_PASS_COUNT PASS / $GATE_FAIL_COUNT FAIL)"
  echo ""
  echo "  日志:      $LOG_FILE"
  echo "  摘要:      $SUMMARY_FILE"
  echo "======================================================"

  # ---- HTTP 回调 ----
  if [[ -n "$WEBHOOK_URL" ]]; then
    echo ""
    echo "[webhook] POST 摘要到 $WEBHOOK_URL ..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
      -X POST "$WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d @"$SUMMARY_FILE" 2>/dev/null || echo "000")
    if [[ "$HTTP_CODE" =~ ^2 ]]; then
      echo "[webhook] 回调成功 (HTTP $HTTP_CODE)"
    else
      echo "[webhook] 回调失败 (HTTP $HTTP_CODE)"
    fi
  fi

  exit $exit_code
}

# ---- Step 1: Producer 生成 evidence-rows ----
echo "[Step 1/4] Producer — 生成 evidence-rows..."
if EMIT_RESULTS=1 "$NODE_BIN" "$SCRIPT_DIR/validate-action-recs.cjs"; then
  PRODUCER_STATUS="pass"
  # 统计 evidence-rows 行数
  if [[ -f "$DIST_DIR/evidence-rows.json" ]]; then
    EVIDENCE_ROWS_COUNT=$("$NODE_BIN" -e "
      const d = require('$DIST_DIR/evidence-rows.json');
      let n = 0;
      if (Array.isArray(d)) {
        for (const item of d) n += (item.rows || []).length;
      } else {
        for (const p of Object.keys(d)) n += (d[p] || []).length;
      }
      console.log(n);
    " 2>/dev/null || echo "0")
  fi
  echo "  → evidence-rows: $EVIDENCE_ROWS_COUNT 条"
else
  PRODUCER_STATUS="fail"
  PIPELINE_STATUS="fail"
  echo "[FAIL] Producer 运行失败"
  _write_summary_and_exit 1
fi
echo ""

# ---- Step 2: keyword-discovery 发现新词候选 ----
echo "[Step 2/4] keyword-discovery — 新词发现（只产出报告）..."
JIEBA_OK=false
if "$PYTHON_BIN" -c "import jieba" 2>/dev/null; then
  JIEBA_OK=true
else
  echo "[WARN] jieba 未安装，跳过 keyword-discovery"
  echo "  安装: pip install jieba"
fi

if [[ "$JIEBA_OK" == true ]]; then
  if "$NODE_BIN" "$SCRIPT_DIR/keyword-discovery.cjs"; then
    # 统计新词数
    CANDIDATES="$DIST_DIR/taxonomy-override-candidates.json"
    if [[ -f "$CANDIDATES" ]]; then
      NEW_WORD_COUNT=$("$NODE_BIN" -e "
        const d = require('$CANDIDATES');
        let n = 0;
        for (const [p, v] of Object.entries(d)) {
          for (const f of (v.families || [])) n += (f.addSubs || []).length;
        }
        console.log(n);
      " 2>/dev/null || echo "0")
    fi
    echo "  → 新词候选: $NEW_WORD_COUNT 个"
  else
    echo "[FAIL] keyword-discovery 运行失败"
    _write_summary_and_exit 1
  fi
else
  echo "[SKIP] keyword-discovery（jieba 不可用）"
fi
echo ""

# ---- Step 3: 如果有新词候选，--apply 写入 ----
CANDIDATES="$DIST_DIR/taxonomy-override-candidates.json"
if [[ "$APPLY" == true ]] && [[ -f "$CANDIDATES" ]] && [[ "$NEW_WORD_COUNT" -gt 0 ]]; then
  echo "[Step 3/4] --apply — 写入 $NEW_WORD_COUNT 个新词候选到 taxonomy-overrides.json..."
  if "$PYTHON_BIN" -c "import jieba" 2>/dev/null && \
     "$NODE_BIN" "$SCRIPT_DIR/keyword-discovery.cjs" --apply; then
    echo "  → 已写入 scripts/taxonomy-overrides.json"
  else
    echo "[FAIL] --apply 运行失败"
    _write_summary_and_exit 1
  fi
else
  if [[ "$NEW_WORD_COUNT" -eq 0 ]]; then
    echo "[Step 3/4] 无新词候选，跳过 --apply"
  else
    echo "[Step 3/4] --apply 被跳过（--no-apply 或无候选文件）"
  fi
fi
echo ""

# ---- Step 4: 门禁验证 ----
if [[ "$RUN_GATE" == true ]]; then
  echo "[Step 4/4] gate-check — 门禁验证..."
  GATE_OUTPUT=$("$NODE_BIN" "$SCRIPT_DIR/gate-check.cjs" 2>&1 || true)
  echo "$GATE_OUTPUT"

  # 从 gate-report.json 解析门禁结果（结构化，不依赖 grep）
  GATE_REPORT="$DIST_DIR/gate-report.json"
  if [[ -f "$GATE_REPORT" ]]; then
    eval "$("$NODE_BIN" -e "
      const j = require('$GATE_REPORT');
      const checks = j.checks || [];
      const pass = checks.filter(c => c.ok === true).length;
      const fail = checks.filter(c => c.ok === false).length;
      const failNames = checks.filter(c => !c.ok).map(c => c.name).join('; ');
      console.log('GATE_PASS_COUNT=' + pass);
      console.log('GATE_FAIL_COUNT=' + fail);
      console.log('GATE_FAIL_ITEMS=\"' + failNames + '\"');
      console.log('GATE_PASSED=' + (j.passed ? 'true' : 'false'));
    " 2>/dev/null)"
  fi

  if [[ "$GATE_FAIL_COUNT" -eq 0 ]]; then
    GATE_STATUS="pass"
    PIPELINE_STATUS="pass"
    echo ""
    echo "[OK] 门禁通过，可发布。"
  else
    GATE_STATUS="fail"
    PIPELINE_STATUS="fail"
    echo ""
    echo "[FAIL] 门禁未通过（$GATE_PASS_COUNT PASS / $GATE_FAIL_COUNT FAIL）"
    [[ -n "$GATE_FAIL_ITEMS" ]] && echo "  失败项: $GATE_FAIL_ITEMS"
    echo "  回滚方案：删除 $SCRIPT_DIR/taxonomy-overrides.json 回到纯基线"
  fi
else
  echo "[Step 4/4] 门禁被跳过（--no-gate）"
  GATE_STATUS="skipped"
  PIPELINE_STATUS="pass"
fi

echo ""

# ---- 正常结束：写摘要并退出 ----
_write_summary_and_exit $([[ "$PIPELINE_STATUS" == "pass" ]] && echo 0 || echo 2)
