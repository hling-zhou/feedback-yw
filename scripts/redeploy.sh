#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# Feedback Insights · 服务器端一键更新部署
# ===========================================================================
# 在线上服务器项目根目录执行：
#   bash scripts/redeploy.sh
#
# 步骤：
#   1. git pull --ff-only   拉取最新代码（当前分支；非快进/有本地改动会中止）
#   2. npm ci               依赖与 lock 同步（含 better-sqlite3 重编译）
#   3. npm run build        产出 dist/（prebuild 自动生成更新动态）
#   4. pm2 restart          默认重启 feedback-api / feedback-mcp，
#                           可用环境变量覆盖：PM2_APPS="a b" bash scripts/redeploy.sh
#   5. 健康检查             3001 /health 与 3002 /health
#
# 前提：首次部署先用 scripts/deploy-pipeline.sh 完成安装，
#       并按 docs/DEPLOY.md §4.4 将两个进程纳入 PM2 守护。
# ===========================================================================

echo "======================================================"
echo "  Feedback Insights · 一键更新部署"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "======================================================"
echo ""

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

# ---- 1. 拉取代码 ----
echo "[1/5] 拉取最新代码（当前分支，仅快进）..."
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
OLD_HEAD="$(git rev-parse --short HEAD)"
git pull --ff-only
NEW_HEAD="$(git rev-parse --short HEAD)"
if [[ "$OLD_HEAD" == "$NEW_HEAD" ]]; then
  echo "  ✓ $BRANCH 已是最新 ($NEW_HEAD)"
else
  echo "  ✓ $BRANCH: $OLD_HEAD → $NEW_HEAD"
fi

# ---- 2. 依赖 ----
echo ""
echo "[2/5] 安装依赖..."
if [[ -f "package-lock.json" ]]; then
  npm ci 2>&1 | tail -3
else
  npm install 2>&1 | tail -3
fi
echo "  ✓ 依赖就绪"

# ---- 3. 构建 ----
echo ""
echo "[3/5] 构建前端..."
npm run build 2>&1 | tail -5
if [[ -f "dist/index.html" ]]; then
  echo "  ✓ 构建完成 (dist/index.html)"
else
  echo "  ✗ 构建失败：dist/index.html 不存在"
  exit 1
fi

# ---- 4. 重启服务 ----
echo ""
echo "[4/5] 重启服务（PM2）..."
PM2_APPS="${PM2_APPS:-feedback-api feedback-mcp}"
if ! command -v pm2 &>/dev/null; then
  echo "  ⚠ 未检测到 pm2，请手动重启 API 与 MCP 进程"
  echo "    纳管后此步自动完成：见 docs/DEPLOY.md §4.4"
else
  for app in $PM2_APPS; do
    if pm2 restart "$app" &>/dev/null; then
      echo "  ✓ pm2 restart $app"
    else
      echo "  ⚠ pm2 应用「$app」未纳管，跳过（首次纳管见 docs/DEPLOY.md §4.4）"
    fi
  done
fi

# ---- 5. 健康检查 ----
echo ""
echo "[5/5] 健康检查（等待进程就绪）..."
sleep 3
check_health() {
  local url="$1" name="$2"
  if curl -fsS -m 5 "$url" &>/dev/null; then
    echo "  ✓ $name: $url"
  else
    echo "  ⚠ $name 未就绪: $url（刚重启可稍候重试；用 pm2 logs $name 排查）"
  fi
}
check_health "http://127.0.0.1:3001/health" "API (:3001)"
check_health "http://127.0.0.1:3002/health" "MCP (:3002)"

echo ""
echo "======================================================"
echo "  部署更新完成"
echo "======================================================"
