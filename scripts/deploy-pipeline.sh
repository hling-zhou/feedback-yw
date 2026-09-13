#!/usr/bin/env bash
set -euo pipefail

# ===========================================================================
# 行动建议 Copilot（规则生产副驾）· 一键部署脚本（Linux）
# ===========================================================================
# 在线上 Linux 服务器上运行此脚本完成全部安装：
#   bash scripts/deploy-pipeline.sh
#
# 检查内容：
#   1. OS 检测（apt / yum / dnf）
#   2. Node.js >= 18（推荐 22）
#   3. Python 3 + jieba
#   4. 编译工具（make/g++，better-sqlite3 需要）
#   5. npm install（含 better-sqlite3 编译）
#   6. 前端构建（vite build）
#   7. .env 配置
#   8. 健康检查
# ===========================================================================

echo "======================================================"
echo "  行动建议 Copilot · 一键部署"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "======================================================"
echo ""

# 定位项目根目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

ERRORS=0

# ---- 0. OS 检测 ----
echo "[0/7] 检测操作系统..."
PKG_MGR=""
INSTALL_PREFIX=""
if command -v apt-get &>/dev/null; then
  PKG_MGR="apt-get"
  INSTALL_PREFIX="sudo apt-get install -y"
  PKT="apt"
  echo "  ✓ Debian/Ubuntu (apt-get)"
elif command -v dnf &>/dev/null; then
  PKG_MGR="dnf"
  INSTALL_PREFIX="sudo dnf install -y"
  PKT="dnf"
  echo "  ✓ RHEL/CentOS 8+ (dnf)"
elif command -v yum &>/dev/null; then
  PKG_MGR="yum"
  INSTALL_PREFIX="sudo yum install -y"
  PKT="yum"
  echo "  ✓ RHEL/CentOS 7 (yum)"
else
  echo "  ⚠ 未检测到 apt-get/dnf/yum，请手动安装依赖"
  PKT="unknown"
fi

# 辅助函数：打印安装提示
suggest_install() {
  local pkg="$1"
  local apt_pkg="$2"
  local yum_pkg="${3:-$2}"
  if [[ "$PKT" == "apt" ]]; then
    echo "    安装: sudo apt-get install -y $apt_pkg"
  elif [[ "$PKT" == "dnf" || "$PKT" == "yum" ]]; then
    echo "    安装: sudo $PKT install -y $yum_pkg"
  else
    echo "    安装: $pkg (请用你的包管理器)"
  fi
}

# ---- 1. Node.js ----
echo ""
echo "[1/7] 检查 Node.js..."
if command -v node &>/dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [[ "$NODE_MAJOR" -ge 18 ]]; then
    echo "  ✓ Node.js $NODE_VERSION"
  else
    echo "  ✗ Node.js $NODE_VERSION 版本过低，需要 >= 18"
    if [[ "$PKT" == "apt" ]]; then
      echo "    安装: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs"
    elif [[ "$PKT" == "dnf" || "$PKT" == "yum" ]]; then
      echo "    安装: curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo $PKT install -y nodejs"
    else
      echo "    请安装 Node.js >= 18 (https://nodejs.org)"
    fi
    ERRORS=$((ERRORS + 1))
  fi
else
  echo "  ✗ Node.js 未安装"
  if [[ "$PKT" == "apt" ]]; then
    echo "    安装: curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash - && sudo apt-get install -y nodejs"
  elif [[ "$PKT" == "dnf" || "$PKT" == "yum" ]]; then
    echo "    安装: curl -fsSL https://rpm.nodesource.com/setup_22.x | sudo bash - && sudo $PKT install -y nodejs"
  else
    echo "    请安装 Node.js >= 18 (https://nodejs.org)"
  fi
  ERRORS=$((ERRORS + 1))
fi

# ---- 2. Python 3 + jieba ----
echo ""
echo "[2/7] 检查 Python 3 + jieba..."
if command -v python3 &>/dev/null; then
  PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
  echo "  ✓ Python $PYTHON_VERSION"
  if python3 -c "import jieba" 2>/dev/null; then
    echo "  ✓ jieba 已安装"
  else
    echo "  ✗ jieba 未安装，正在安装..."
    pip3 install jieba -q 2>&1 && echo "  ✓ jieba 安装完成" || {
      # 尝试 --break-system-packages（PEP 668，Python 3.11+ on Linux）
      pip3 install jieba -q --break-system-packages 2>&1 && echo "  ✓ jieba 安装完成 (--break-system-packages)" || {
        echo "  ✗ jieba 安装失败，请手动运行: pip3 install jieba"
        echo "    如果是 externally-managed-environment 错误: pip3 install --break-system-packages jieba"
        ERRORS=$((ERRORS + 1))
      }
    }
  fi
else
  echo "  ✗ Python 3 未安装"
  suggest_install "python3" "python3 python3-pip" "python3 python3-pip"
  ERRORS=$((ERRORS + 1))
fi

# ---- 3. 系统编译工具（better-sqlite3 需要）----
echo ""
echo "[3/7] 检查编译工具..."
MISSING_TOOLS=""
for tool in make g++; do
  if ! command -v "$tool" &>/dev/null; then
    MISSING_TOOLS="$MISSING_TOOLS $tool"
  fi
done
if [[ -n "$MISSING_TOOLS" ]]; then
  echo "  ✗ 缺少编译工具:$MISSING_TOOLS"
  if [[ "$PKT" == "apt" ]]; then
    suggest_install "build-essential" "build-essential python3-dev" "gcc-c++ make python3-devel"
  else
    suggest_install "build-essential" "build-essential python3-dev" "gcc-c++ make python3-devel"
  fi
  ERRORS=$((ERRORS + 1))
else
  echo "  ✓ make / g++ 均就绪"
fi

# ---- 如果有前置错误，停止 ----
if [[ $ERRORS -gt 0 ]]; then
  echo ""
  echo "======================================================"
  echo "  ✗ 前置检查失败（$ERRORS 个错误）"
  echo "  请修复上述问题后重新运行本脚本"
  echo "======================================================"
  exit 1
fi

# ---- 4. npm install ----
echo ""
echo "[4/7] 安装 npm 依赖..."
if [[ -f "package-lock.json" ]]; then
  npm ci 2>&1 | tail -3
else
  npm install 2>&1 | tail -3
fi
echo "  ✓ npm 依赖安装完成"

# 验证 better-sqlite3 native 模块
if node -e "require('better-sqlite3'); console.log('  ✓ better-sqlite3 native 模块正常')" 2>/dev/null; then
  true
else
  echo "  ⚠ better-sqlite3 需要重新编译，尝试 rebuild..."
  npm rebuild better-sqlite3 2>&1 | tail -3
  if node -e "require('better-sqlite3')" 2>/dev/null; then
    echo "  ✓ better-sqlite3 rebuild 成功"
  else
    echo "  ✗ better-sqlite3 编译失败"
    if [[ "$PKT" == "apt" ]]; then
      echo "    尝试: sudo apt-get install -y python3-dev build-essential && npm rebuild better-sqlite3"
    else
      echo "    尝试: sudo $PKT install -y python3-devel gcc-c++ make && npm rebuild better-sqlite3"
    fi
    exit 1
  fi
fi

# ---- 5. 前端构建 ----
echo ""
echo "[5/7] 构建前端..."
npm run build 2>&1 | tail -5
if [[ -d "dist" ]] && [[ -f "dist/index.html" ]]; then
  echo "  ✓ 前端构建完成 (dist/index.html)"
else
  echo "  ⚠ 前端构建可能未完成，dist/index.html 不存在"
  echo "    可稍后手动运行: npm run build"
fi

# ---- 6. .env 配置 ----
echo ""
echo "[6/7] 检查配置..."
if [[ ! -f ".env" ]]; then
  if [[ -f ".env.example" ]]; then
    cp .env.example .env
    echo "  ✓ 已从 .env.example 创建 .env"
    echo "  ⚠ 请编辑 .env 配置 JWT_SECRET 等必要项"
  else
    # 生成最小 .env
    cat > .env <<'EOF'
# 行动建议 Copilot 最小配置
API_PORT=3001
API_HOST=127.0.0.1
# 数据库路径（默认在项目目录 server/data/auth.db，无需改）
# FEEDBACK_DB=/path/to/auth.db
# 前端 URL（CORS 白名单）
WEB_ORIGIN=http://localhost:5173
# 必填：JWT 密钥（请改成长随机字符串）
JWT_SECRET=change-me-to-random-secret
EOF
    echo "  ✓ 已生成 .env 最小配置"
    echo "  ⚠ 请编辑 .env 修改 JWT_SECRET"
  fi
else
  echo "  ✓ .env 已存在"
fi

# ---- 7. 健康检查 ----
echo ""
echo "[7/7] 健康检查..."

# 检查 DB
DB_PATH="server/data/auth.db"
if [[ -f "$DB_PATH" ]]; then
  DB_SIZE=$(du -h "$DB_PATH" | cut -f1)
  echo "  DB:    $DB_PATH ($DB_SIZE)"
else
  echo "  DB:    $DB_PATH (不存在 — 服务端首次启动会自动创建)"
fi

# 检查流水线脚本
if [[ -x "scripts/run-pipeline.sh" ]]; then
  echo "  脚本:  run-pipeline.sh ✓"
else
  echo "  脚本:  run-pipeline.sh (正在添加执行权限)"
  chmod +x scripts/run-pipeline.sh
fi

echo ""
echo "======================================================"
echo "  部署完成"
echo "======================================================"
echo ""
echo "  启动服务:  npm run dev:api"
echo "  启动前端:  npm run dev"
echo "  一键启动:  npm run dev:all"
echo ""
echo "  流水线运行（CLI）:"
echo "    全量:    bash scripts/run-pipeline.sh --batch '*' --products '*'"
echo "    本期:    bash scripts/run-pipeline.sh"
echo ""
echo "  或在前端 Settings → 行动建议 Copilot 页面点击「运行流水线」"
echo ""
echo "  生产环境建议用 PM2 或 systemd 守护进程:"
echo "    npm i -g pm2"
echo "    pm2 start npm -- run dev:api --name feedback-api"
echo "    pm2 start npm -- run build --name feedback-build"
echo "    pm2 startup && pm2 save"
echo "======================================================"
