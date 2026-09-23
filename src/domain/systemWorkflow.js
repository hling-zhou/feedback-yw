/**
 * 系统使用流程（登录页、帮助文档等共用）
 *
 * @typedef {Object} SystemWorkflowModule
 * @property {string} label - 与侧栏或页面名称一致
 * @property {string} [route] - 登录后对应路由（登录页不渲染链接）
 * @property {string} [badge] - 标签后的状态标注，如 Beta
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
    description: '导入投诉/咨询工单、用后即评，以及满意度回访与客服部回访',
    modules: [{ label: '数据导入', route: '/import' }],
    automatic: false,
  },
  {
    step: 2,
    title: '自动分析与打标',
    description: '工单提取客户请求、痛点与原因并打标；用后即评汇总评分与质量',
    modules: [],
    automatic: true,
  },
  {
    step: 3,
    title: '人工复核与确立举措',
    description: '在反馈库核对工单分析与标签，关联或新建举措',
    modules: [{ label: '反馈库', route: '/feedbacks' }],
    automatic: false,
  },
  {
    step: 4,
    title: '查看周期洞察',
    description: '工作台按月看综合结论与分来源看板；洞察分析按场景、旅程和问题类型下钻',
    modules: [
      { label: '洞察工作台', route: '/workbench' },
      { label: '洞察分析', route: '/workbench/analysis' },
    ],
    automatic: false,
  },
  {
    step: 5,
    title: '沿线索做专题',
    description: '按客户、产品问题或共性问题生成跨周期专题报告',
    modules: [{ label: '专题分析', route: '/topics', badge: 'Beta' }],
    automatic: false,
  },
  {
    step: 6,
    title: '跟踪举措进展',
    description: '按产品与状态统计举措，维护排期、临期预警和需求工单',
    modules: [{ label: '举措与进展', route: '/actions' }],
    automatic: false,
  },
]
