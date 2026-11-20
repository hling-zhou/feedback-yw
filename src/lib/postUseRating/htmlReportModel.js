/**
 * 报告区块 SECTION 常量（11-20 V1 下线收敛）：
 * 原本文件承载 V1 legacyModel（buildHtmlMonthlyReportModel + 7 个构建函数 + preview 组装），
 * 旧版下线后外部消费仅剩 SECTION 常量（PostUseHtmlReportV2Document / 页面 ReportSectionToggles）——
 * 按"下线即删死码"收敛为常量模块。V2 文档模型真源 = reportV2Model.js。
 * 11-20 复盘删冗余：buildYunwangScoreContext 转发导出无消费方（StoryView 直连 scoreContext）。
 */
export const MAX_REPORT_ISSUES = 8
export const REPORT_SECTION_JUDGMENT = 'judgment'
export const REPORT_SECTION_PRODUCTS = 'products'
export const REPORT_SECTION_ISSUES = 'issues'
export const REPORT_SECTION_TODO = 'todo'
export const REPORT_SECTION_PREVIOUS_VISITS = 'previousVisits'
export const REPORT_SECTION_APPENDIX = 'appendix'
