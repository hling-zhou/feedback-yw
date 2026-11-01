#!/usr/bin/env bash
# 从部署环境拉取流水线产物到本地 dist/ 目录
#
# 用法：
#   # 方式1：直接传 token
#   bash scripts/pull-deploy-artifacts.sh <deploy-base-url> <jwt-token>
#
#   # 方式2：自动登录拿 token（推荐自动化使用）
#   bash scripts/pull-deploy-artifacts.sh <deploy-base-url> --login <username>:<password>
#
# 示例：
#   bash scripts/pull-deploy-artifacts.sh http://10.64.3.250:81 my-jwt-token
#   bash scripts/pull-deploy-artifacts.sh http://10.64.3.250:81 --login admin:my-password
set -euo pipefail

DEPLOY_URL="${1:?用法: bash scripts/pull-deploy-artifacts.sh <deploy-base-url> [--login <user>:<pass> | <token>}"
AUTH_ARG="${2:-}"

DIST_DIR="$(cd "$(dirname "$0")/.." && pwd)/dist"
mkdir -p "$DIST_DIR"

# ---- 解析认证方式 ----
TOKEN=""
if [[ "$AUTH_ARG" == "--login" ]]; then
  CREDENTIALS="${3:?--login 需要提供 <username>:<password>}"
  USERNAME="${CREDENTIALS%%:*}"
  PASSWORD="${CREDENTIALS#*:}"
  echo "登录 $DEPLOY_URL ($USERNAME)..."
  LOGIN_RESP=$(curl -sS -X POST "$DEPLOY_URL/api/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"username\":\"$USERNAME\",\"password\":\"$PASSWORD\"}" 2>&1 || true)
  TOKEN=$(echo "$LOGIN_RESP" | jq -r '.accessToken // empty' 2>/dev/null || echo "")
  if [[ -z "$TOKEN" ]]; then
    echo "[FAIL] 登录失败，响应: $LOGIN_RESP"
    exit 1
  fi
  echo "  ✓ 登录成功，token 已获取"
elif [[ -n "$AUTH_ARG" ]]; then
  TOKEN="$AUTH_ARG"
fi

FILES=("evidence-rows.json" "gate-report.json" "taxonomy-current.json" "pipeline-summary.json")

echo "从 $DEPLOY_URL 拉取流水线产物..."
FAILED=0
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
    FAILED=$((FAILED + 1))
  fi
done

echo ""
if [[ $FAILED -gt 0 ]]; then
  echo "[FAIL] $FAILED 个文件拉取失败"
  exit 1
fi
echo "拉取完成，产物在 $DIST_DIR/"
echo "下一步：node scripts/gate-check.cjs 或本地分析"
