/**
 * 页面访问埋点：路由 → 模块映射（前后端共用单源）。
 *
 * 此前 useUsageTracking.js 与 server/routes/usage.js 各持一份手工镜像
 * （仅注释互指，无机器对拍），11 月新增的 /api-patrol/* 与 /mcp-guide
 * 路由两侧均未同步，巡检域访问全部落入 'other' 被静默丢弃
 * （2026-11-20 分析发现，usage.db 无任何巡检记录实证）。
 *
 * 本文件为唯一真源：前端 resolveModule 与服务端 resolveModuleFromPath
 * 均从此 import；守卫测试（usageModuleMapGuard.test.js）对拍
 * AppShell 导航 leaf 路由与 router.jsx 路由表，新增页面未登记映射即红。
 */

/**
 * 模块键 → 展示标签（运营分析页 MODULE_LABELS / MODULE_GROUPS 的数据源）。
 * 键即 usage_stats.module 列的取值域。
 * @type {Record<string, string>}
 */
export const USAGE_MODULE_LABELS = {
  workbench: '洞察工作台',
  themes: '主题分析',
  topics: '专题分析',
  feedbacks: '工单列表',
  feedbacks_detail: '工单详情',
  actions: '问题与举措',
  import: '数据导入',
  tags: '对象与标签',
  users: '用户管理',
  settings: '系统设置',
  operations: '运营分析',
  api_patrol: 'API 巡检',
  mcp_guide: 'MCP 数据服务',
  other: '其他',
}

/**
 * 路径前缀匹配规则（有序：先命中先用）。
 * 数组形态保证前缀重叠时可控制优先级（如 '/workbench/analysis' 先于 '/workbench'）。
 * @type {{ prefix: string, module: string }[]}
 */
export const USAGE_PATH_RULES = [
  { prefix: '/', module: 'workbench' },
  { prefix: '/workbench/post-use-report-v2', module: 'workbench' },
  { prefix: '/workbench/post-use', module: 'workbench' },
  { prefix: '/workbench/analysis', module: 'themes' },
  { prefix: '/workbench', module: 'workbench' },
  { prefix: '/themes', module: 'themes' },
  { prefix: '/topics', module: 'topics' },
  { prefix: '/feedbacks', module: 'feedbacks' },
  { prefix: '/api-patrol', module: 'api_patrol' },
  { prefix: '/actions', module: 'actions' },
  { prefix: '/import', module: 'import' },
  { prefix: '/tags', module: 'tags' },
  { prefix: '/users', module: 'users' },
  { prefix: '/settings', module: 'settings' },
  { prefix: '/operations', module: 'operations' },
  { prefix: '/mcp-guide', module: 'mcp_guide' },
]

/**
 * 页面模块展示序（运营分析页「角色维度」表格列与趋势图取值序）。
 * 'feedbacks_detail' 是抽屉事件模块（trackUsage 手动上报），非页面路由，不进分组清单。
 * @type {string[]}
 */
export const USAGE_MODULE_GROUPS = [
  'workbench',
  'themes',
  'topics',
  'feedbacks',
  'actions',
  'import',
  'tags',
  'users',
  'settings',
  'operations',
  'api_patrol',
  'mcp_guide',
]

/**
 * 路径 → 模块键。未命中任何规则返回 'other'。
 * 前后端共用；埋点侧对 'other' 不上报（保留字，存量展示兜底）。
 * 匹配口径：根路径 '/' 精确匹配；其余规则「精确等于 或 前缀+斜杠」——
 * 禁止裸 startsWith（'/tags' 会误吃 '/tags-foo' 类未来路由）。
 * @param {string} pathname 路由路径（含 query 时仅取 path 部分）
 * @returns {string}
 */
export function resolveUsageModule(pathname) {
  const page = String(pathname || '').split('?')[0]
  if (page === '/') return 'workbench'
  for (const rule of USAGE_PATH_RULES) {
    if (rule.prefix === '/') continue
    if (page === rule.prefix || page.startsWith(rule.prefix + '/')) {
      return rule.module
    }
  }
  return 'other'
}
