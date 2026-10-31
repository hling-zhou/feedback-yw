#!/usr/bin/env bash
# 从部署环境拉取流水线产物到本地 dist/ 目录
# 用法：
#   bash scripts/pull-deploy-artifacts.sh https://deploy.example.com
#   bash scripts/pull-deploy-artifacts.sh https://deploy.example.com my-token
set -euo pipefail

DEPLOY_URL="${1:?用法: bash scripts/pull-deploy-artifacts.sh <deploy-base-url> [token]}"
TOKEN="${2:-}"

DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist"
mkdir -p "$DIST_DIR"

FILES=("evidence-rows.json" "gate-report.json" "taxonomy-current.json" "pipeline-summary.json")

echo "从 $DEPLOY_URL 拉取流水线产物..."
for f in "${FILES[@]}"; do
  URL="$DEPLOY_URL/api/storage/pipeline/artifacts/$f"
  OUT="$DIST_DIR/$f"
  if [ -n "$TOKEN" ]; then
    HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" -H "Authorization: Bearer $TOKEN" "$URL" || true)
  else
    HTTP_CODE=$(curl -sS -o "$OUT" -w "%{http_code}" "$URL" || true)
  fi
  if [ "$HTTP_CODE" = "200" ]; then
    SIZE=$(wc -c < "$OUT" | tr -d ' ')
    echo "  ✓ $f ($SIZE bytes)"
  elif [ "$HTTP_CODE" = "404" ]; then
    echo "  - $f (不存在，跳过)"
    rm -f "$OUT"
  else
    echo "  ✗ $f (HTTP $HTTP_CODE)"
    rm -f "$OUT"
  fi
done

echo ""
echo "拉取完成，产物在 $DIST_DIR/"
echo "下一步：node scripts/gate-check.cjs 或本地分析"
