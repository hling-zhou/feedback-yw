/**
 * 系统使用流程（登录页、帮助文档等共用）
 *
 * @typedef {Object} SystemWorkflowModule
 * @property {string} label - 与侧栏或页面名称一致
 * @property {string} [route] - 登录后对应路由（登录页不渲染链接）
 *
 * @typedef {Object} SystemWorkflowStep
 * @property {number} step
 * @property {string} title
 * @property {string} description
 * @property {SystemWorkflowModule[]} modules
 * @property {boolean} automatic - 系统自动环节，无独立菜单
 */

export const SYSTEM_USAGE_WORKFLOW_TITLE = '使用流程'

/** @type {SystemWorkflowStep[]} */
export const SYSTEM_USAGE_WORKFLOW = [
  {
    step: 1,
    title: '导入原始数据',
    description: '导入投诉/咨询工单、用后即评等原始反馈',
    modules: [{ label: '数据导入', route: '/import' }],
    automatic: false,
  },
  {
    step: 2,
    title: '自动分析与打标',
    description: '系统提取客户请求、需求痛点、问题原因等，并完成规则或大模型打标',
    modules: [],
    automatic: true,
  },
  {
    step: 3,
    title: '人工复核与确立举措',
    description: '在工单详情中核对标签、关联或新建举措',
    modules: [{ label: '反馈库', route: '/feedbacks' }],
    automatic: false,
  },
  {
    step: 4,
    title: '查看聚类与整体建议',
    description: '洞察工作台查看整体结论；洞察分析按来源与产品下钻聚类详情',
    modules: [
      { label: '洞察工作台', route: '/workbench' },
      { label: '洞察分析', route: '/workbench' },
    ],
    automatic: false,
  },
  {
    step: 5,
    title: '跟踪举措进展',
    description: '统计各产品/状态举措，维护排期与需求工单',
    modules: [{ label: '举措与进展', route: '/actions' }],
    automatic: false,
  },
]
