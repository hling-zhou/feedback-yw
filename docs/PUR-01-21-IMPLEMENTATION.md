# 用后即评洞察优化 PUR-01～21 实现说明

> 现行功能与口径见 [DESIGN-用后即评.md](./DESIGN-用后即评.md)。本文是任务对照备忘。

## 执行口径

- 分析范围只取“产品与规格”中开启 `analysisPostUseRating` 的产品；原始导入数据完整保留。
- 小样本阈值为 `n < 10`，投诉回访满意度基线为 `88%`，体验关注线为 `9 分`。
- 客服部回访按导入时选择的数据月份跟随线上当前范围；HTML 月报与报告月使用同一月份，不再前移一个月。
- PUR-08 只使用原始评价场景和现有用户旅程。原始评价场景缺失显示“未提供”，旅程未知显示“未识别环节”；不增加请求场景、问题类型或情绪标签。
- 所有结论保留证据记录 ID 和规则版本；举措沿用“举措与进展”，不新建 JIRA 模块。

## 任务对照

| 编号 | 实现结果 | 主要落点 |
| --- | --- | --- |
| PUR-01 | 按月保存原始、有效、去重、范围内外、缺场景、未归类和回访关联质量快照 | `qualityStore.js` |
| PUR-02 | 数据质量页展示异常计数并支持 CSV 下载异常明细 | `PostUseInsightPanel.jsx` |
| PUR-03 | 选项类记录作为 `web_option` 明细落库；评分与文本保存证据对象 | `buildRecords.js`, `evidence.js` |
| PUR-04 | 工作台支持按当前周期重算并保存洞察包 | `insightStore.js` |
| PUR-05 | 质量快照记录目录、分析规则、原因规则版本 | `modelVersions.js` |
| PUR-06 | 产品体验总览展示样本、均分、非10分和状态 | `insights.js` |
| PUR-07 | 状态规则返回判定依据、规则版本和证据 ID | `buildProductExperienceOverview` |
| PUR-08 | 产品 × 评价触发场景 × 用户旅程拆解 | `buildSceneJourneyAnalysis` |
| PUR-09 | 沿用周期联动趋势，并增加跨月问题变化比较 | `trendStore.js`, `buildIssueChanges` |
| PUR-10 | 清洗控制字符、空白并同时保存原文和规范文本 | `evidence.js` |
| PUR-11 | 一条反馈可命中多个原因标签 | `matchAllReasonTaxonomy` |
| PUR-12 | 从非10分原因和原话聚合用户需求 | `buildNeedInsights` |
| PUR-13 | 按频次、客户数和严重度计算可解释优先级 | `buildNeedInsights` |
| PUR-14 | 识别高频低分客户、涉及产品和最近原话 | `buildCustomerInsights` |
| PUR-15 | 标记新增、持续、增长、缓解、消失问题 | `buildIssueChanges` |
| PUR-16 | 洞察证据包包含主题、指标、原话和去重证据 ID | `buildInsightEvidencePackage` |
| PUR-17 | P0/P1 聚合需求生成可执行举措推荐 | `buildPostUseActionSignals` |
| PUR-18 | 工作台可一键创建举措并关联产品、主题、洞察和证据 | `PostUseRatingDashboardView.jsx`, `actionItem.js` |
| PUR-19 | 完成前触发指标与当前同口径指标比较恢复情况 | `actionRecovery.js` |
| PUR-20 | 工作台单列已完成但未恢复举措并提示复盘 | `PostUseRatingDashboardView.jsx` |
| PUR-21 | 页面预览和 DOCX 均输出洞察→举措→效果映射 | `monthlyReportPreview.js`, `monthlyReportDocx.js` |

## 验收重点

1. 重新导入任一月份的短信+官网双文件，数据质量页应出现该月快照，选项证据数不为零时可追溯到 `web_option` 记录。
2. 切换洞察时间范围后，产品体验、场景旅程、用户需求和客户洞察只使用当前范围；问题变化使用全量月份比较最近两期。
3. 用户需求中同一条包含多个标准原因的原话应分别计入多个标签，但证据 ID 保持相同。
4. 从 P0/P1 推荐创建举措后，举措抽屉应显示洞察主题、证据数和触发指标；再次打开工作台不得重复创建同一洞察举措。
5. 举措完成后，当前产品均分未达到触发指标目标时应进入“已完成但未恢复”；月报预览与 DOCX 同步显示。
