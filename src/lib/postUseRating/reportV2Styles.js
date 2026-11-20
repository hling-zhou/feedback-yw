/** Shared by the online V2 report and its standalone HTML export. */
export const REPORT_V2_CSS = `
body { margin:0; }
.post-use-html-report { min-height:100vh; background:#f9fafb; color:#1f2937; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','HarmonyOS Sans SC','Microsoft YaHei',sans-serif; }
.report-v2 { --v2-danger:#dc2626; --v2-danger-bg:#fef2f2; --v2-warning:#d97706; --v2-warning-bg:#fffbeb; --v2-blue:#2563eb; --v2-blue-bg:#eff6ff; --v2-success:#059669; --v2-success-bg:#ecfdf5; --v2-ink:#6b7280; --v2-ink-bg:#f9fafb; --v2-brand:#4f46e5; }
.post-use-html-report * { box-sizing:border-box; }
.post-use-html-report-sheet { display:flex; align-items:flex-start; gap:24px; padding:24px 24px 48px; }
.report-v2 .report-modules { display:flex; flex-direction:column; gap:12px; }
.report-v2 .report-module { background:#fff; border-radius:8px; padding:20px 24px; }
.report-v2 .post-use-html-report-kpis { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:16px 0 20px; }
.report-v2 .post-use-html-report-kpi { border:1px solid #e5e7eb; padding:12px 14px; }
.report-v2 .post-use-html-report-kpi .label { font-size:12px; color:#6b7280; }
.report-v2 .post-use-html-report-kpi .value { margin-top:4px; font-size:22px; font-weight:650; letter-spacing:-.02em; }
.report-v2 .post-use-html-report-kpi-hints { margin-top:6px; font-size:12px; line-height:1.45; color:#6b7280; }
.report-v2 .report-toc { position:sticky; top:56px; flex-shrink:0; width:210px; max-height:calc(100vh - 72px); overflow-y:auto; padding:12px 14px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; box-shadow:0 2px 8px rgba(15,23,42,.06); }
.report-v2 .report-toc__list,.report-v2 .report-toc__sublist { margin:0; padding:0; list-style:none; }
.report-v2 .report-toc__list > li { margin-bottom:4px; }
.report-v2 .report-toc__list a { color:#4b5563; font-size:13px; text-decoration:none; line-height:1.6; cursor:pointer; }
.report-v2 .report-toc__sublist { padding-left:12px; margin-top:2px; }
.report-v2 .report-toc__sublist a { font-size:12px; color:#6b7280; }
.report-v2 { display:flex; flex:1; align-items:flex-start; gap:24px; min-width:0; }
.report-v2 .report-modules { width:min(100%,1240px); flex:1; min-width:0; }
.v2-report-header h1 { font-size:22px; font-weight:650; margin:0 0 5px; }
.v2-section-title { font-size:17px; font-weight:650; margin:0 0 14px; }
.v2-subtle { color:#6b7280; font-size:12px; line-height:1.6; }
.v2-summary { display:flex; flex-wrap:wrap; gap:8px 0; margin-top:14px; padding:12px 14px; background:#f9fafb; border-radius:8px; font-size:13px; }
.v2-summary > span { padding:0 12px; border-right:1px solid #d1d5db; }
.v2-summary > span:first-child { padding-left:0; }.v2-summary > span:last-child { border:0; }
.v2-summary b { font-size:15px; }.v2-danger { color:#b91c1c; font-weight:700; }.v2-ok { color:#047857; font-weight:650; }
.v2-focus { margin-bottom:18px; }.v2-focus h3 { color:#b91c1c; font-size:14px; font-weight:650; margin:0 0 10px; }
.v2-action { border-left:4px solid #9ca3af; border-radius:5px; background:#f9fafb; padding:10px 12px; margin-bottom:8px; font-size:13px; line-height:1.6; }
.v2-action--p0,.v2-action--followup { border-left-color:var(--v2-danger); background:var(--v2-danger-bg); }.v2-action--p1,.v2-action--repair { border-left-color:var(--v2-warning); background:var(--v2-warning-bg); }
.v2-action--closure { border-left-color:var(--v2-blue); background:var(--v2-blue-bg); }.v2-action--observe { border-left-color:var(--v2-ink); background:var(--v2-ink-bg); }
.v2-action-main { display:flex; flex-wrap:wrap; align-items:center; gap:7px; }.v2-inline-gap { margin-left:5px; }
.v2-action-detail { margin:4px 0 5px; line-height:1.65; }.v2-focus-edit { display:grid; gap:8px; margin-top:8px; }.v2-focus-edit label { display:grid; gap:3px; }
.v2-tag { display:inline-block; border-radius:999px; padding:1px 7px; font-size:11px; white-space:nowrap; background:#f3f4f6; color:#4b5563; }
.v2-tag--danger { color:#b91c1c; background:#fee2e2; }.v2-tag--warning { color:#92400e; background:#fef3c7; }
.v2-tag--ok { color:#047857; background:#d1fae5; }.v2-tag--muted { color:#4b5563; background:#e5e7eb; }
.v2-tag--p0,.v2-tag--p1,.v2-tag--p2 { border-radius:3px; font-weight:700; }
.v2-tag--p0 { color:#fff; background:var(--v2-danger); }.v2-tag--p1 { color:#fff; background:var(--v2-warning); }.v2-tag--p2 { color:#374151; background:#e5e7eb; }
.v2-tag--action-followup,.v2-tag--action-repair,.v2-tag--action-closure,.v2-tag--action-observe { color:#fff; font-weight:650; }
.v2-tag--action-followup { background:var(--v2-danger); }.v2-tag--action-repair { background:var(--v2-warning); }.v2-tag--action-closure { background:var(--v2-blue); }.v2-tag--action-observe { background:var(--v2-ink); }
/* 11-18 生命周期徽章四色（对齐季报原型 .lc 体系，部门表/分产品表/行动卡三处共用） */
.v2-tag--lc-through { color:#fff; background:var(--v2-danger); border-radius:999px; font-weight:700; }
.v2-tag--lc-burst { color:#fff; background:var(--v2-warning); border-radius:999px; font-weight:700; }
.v2-tag--lc-single { color:#92400e; background:#fef3c7; border:1px solid #fde68a; border-radius:999px; font-weight:700; }
.v2-tag--lc-fade { color:#047857; background:var(--v2-success-bg); border:1px solid #a7d8bc; border-radius:999px; font-weight:700; }
.v2-warning-text { color:var(--v2-warning); }
.v2-mdist { font-size:11px; color:#4b5563; white-space:nowrap; }
/* 11-18 晚信息密度改造：原因归类/问题主题行内"成员带计数 + 典型原话"两行灰字 */
.v2-reason-detail { font-size:11px; color:#6b7280; margin-top:3px; line-height:1.5; font-weight:400; }
.v2-reason-detail .v2-detail-lead { color:#374151; font-weight:500; }
.v2-metric { border-radius:6px; }.v2-metric--danger { border-color:#f0b4b4; background:#fff7f7; }.v2-metric--ok { border-color:#b7dcc4; background:#f5fbf6; }
.v2-chart-grid { display:grid; grid-template-columns:repeat(2,minmax(426px,1fr)); gap:12px; margin-bottom:14px; overflow-x:auto; }
.v2-panel { border:1px solid #e5e7eb; border-radius:6px; padding:12px; margin:12px 0; min-width:0; }
/* SVG 仅在导出态渲染：固定像素 + max-width 等比缩回（V1 离线先例），文字不随容器拉伸 */
.v2-chart-wrap svg { display:block; max-width:100%; height:auto; margin-inline:auto; }.v2-chart-legend { display:flex; gap:12px; justify-content:center; color:#6b7280; font-size:12px; line-height:18px; }
.v2-chart-legend span { display:inline-flex; align-items:center; gap:4px; }.v2-chart-legend i { width:8px; height:8px; border-radius:50%; }
.v2-svg-label { font-size:11px; font-family:inherit; fill:#6b7280; }.v2-svg-label--missing { fill:#9ca3af; }
.v2-table-scroll { overflow-x:auto; }.v2-table { width:100%; border-collapse:collapse; font-size:13px; line-height:1.5; }
.v2-table th { text-align:left; font-weight:600; color:#4b5563; background:#f9fafb; }.v2-table th,.v2-table td { padding:8px 10px; border-bottom:1px solid #e5e7eb; vertical-align:top; }
.v2-table td:first-child { min-width:130px; }.v2-table tbody tr.v2-row-danger { background:var(--v2-danger-bg); }.v2-table tbody tr.v2-row-warning { background:var(--v2-warning-bg); }.v2-option-text { color:var(--v2-blue); }
.v2-microbar { display:flex; align-items:center; gap:8px; min-width:110px; }.v2-microbar-track { display:block; width:72px; height:12px; background:#eef0f3; border-radius:8px; overflow:hidden; }
.v2-microbar-fill { display:block; height:100%; border-radius:8px; background:#d97706; }.v2-microbar-fill--danger { background:#dc2626; }.v2-microbar-fill--muted { background:#9ca3af; }
.v2-distribution-bar { display:block; min-width:90px; }.v2-distribution-bar .v2-microbar-track { width:100%; }.v2-theme-table td:nth-child(2),.v2-theme-table th:nth-child(2) { width:56px; text-align:center; }.v2-theme-table td:nth-child(3),.v2-theme-table th:nth-child(3) { min-width:110px; }
/* 11-18 部门低分原因汇总表：条数列窄列，月度分布/生命周期列不折行 */
.v2-reason-table td:nth-child(2),.v2-reason-table th:nth-child(2) { width:88px; }.v2-reason-table .v2-mdist { white-space:nowrap; }.v2-reason-table td:last-child { white-space:nowrap; }
.v2-product-layout { display:grid; grid-template-columns:250px minmax(0,1fr); gap:18px; }.v2-product-list { align-self:start; position:sticky; top:78px; display:grid; gap:6px; }
.v2-product-list button { display:flex; align-items:center; flex-wrap:wrap; gap:6px; width:100%; border:1px solid #e5e7eb; border-radius:5px; background:#fff; padding:9px 10px; text-align:left; cursor:pointer; font-size:13px; }
.v2-product-list button span:first-child { flex:1; }.v2-product-list button.is-active { border-color:#4f46e5; background:#eef2ff; }
.v2-product-content { min-width:0; }.v2-product-slot { display:none; }.v2-product-slot.is-active { display:block; }
.v2-product-head { display:flex; align-items:baseline; flex-wrap:wrap; gap:9px; }.v2-product-head h3 { font-size:16px; font-weight:650; margin:0; }.v2-product-head strong { font-size:20px; }
.v2-product-head .v2-tag--danger { border:1px solid #f1a7a7; }.v2-product-head .v2-tag--muted { border:1px solid #d1d5db; }
.v2-month-pill { margin-top:10px; padding:7px 10px; border-radius:999px; background:#f3f4f6; display:inline-block; font-size:12px; }
.v2-quarter-change { padding:9px 12px; border-left:3px solid #d97706; background:#fffbeb; border-radius:4px; font-size:13px; }
.v2-conclusion { margin:14px 0; font-size:13px; line-height:1.65; }.v2-mark-new { background:#fef3c7; padding:0 2px; }.v2-product-kpis { margin:12px 0; }
.v2-state-ok,.v2-positive { padding:10px 12px; background:#ecfdf5; border-radius:6px; color:#047857; font-size:13px; line-height:1.6; margin:12px 0; }
.v2-state-neutral { padding:10px 12px; background:#f9fafb; border-radius:6px; color:#4b5563; font-size:13px; line-height:1.6; margin:12px 0; }
.v2-note { background:#f9fafb; border-radius:6px; padding:10px 12px; font-size:12px; }.v2-note p { margin:0 0 6px; }.v2-note small { color:#6b7280; }
.v2-evidence-details { margin:10px 0; padding:8px 10px; border-radius:5px; background:#f9fafb; }.v2-evidence-details h4 { margin:6px 0; font-size:13px; }.v2-evidence-details p { margin:4px 0; }
.v2-details { border:1px solid #e5e7eb; border-radius:5px; margin:9px 0; padding:9px 12px; font-size:13px; }.v2-details summary { cursor:pointer; font-weight:600; }
.v2-details-content { padding-top:10px; }.v2-quote { border-left:3px solid #dc2626; margin:0 0 8px; padding:6px 10px; background:#f9fafb; }.v2-quote--neutral { border-left-color:#9ca3af; }.v2-quote--option { border-left-color:#2563eb; }.v2-quote small { display:block; color:#6b7280; margin-top:4px; }
.v2-todo-table td:first-child,.v2-todo-table th:first-child { min-width:44px; width:44px; text-align:center; }.v2-todo-table td:nth-child(2) { min-width:360px; }.v2-todo-table td:not(:nth-child(2)) { white-space:nowrap; }
.v2-todo-links { margin-top:6px; line-height:1.8; }.v2-todo-links a { color:var(--v2-blue); text-decoration:underline; }
.v2-edit { margin-top:8px; font-size:12px; }.v2-edit summary { cursor:pointer; color:var(--v2-brand); }.v2-edit-grid { display:grid; grid-template-columns:2fr 1fr 1fr auto; gap:8px; margin-top:8px; }.v2-edit-grid label { display:grid; gap:2px; }.v2-edit input,.v2-edit textarea,.v2-edit select { width:100%; border:1px solid #d1d5db; border-radius:4px; padding:5px 7px; background:#fff; }.v2-edit textarea { min-height:65px; margin-top:6px; }
.v2-edit-grid--todo { grid-template-columns:1.2fr 2fr 1fr 1fr 1fr auto; }
.v2-toc { flex:0 0 210px; }.v2-toc a.is-active { color:#4f46e5; font-weight:650; }
@media(max-width:1000px) { .v2-toc { display:none; }.v2-product-layout { display:block; }.v2-product-list { position:static; display:flex; overflow-x:auto; margin-bottom:14px; }.report-v2 .post-use-html-report-kpis { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media(max-width:600px) { .report-v2 .post-use-html-report-kpis { grid-template-columns:1fr; }.v2-summary > span { width:100%; border:0; padding:0; } }
@media(max-width:800px) { .v2-edit-grid--todo { grid-template-columns:repeat(2,minmax(0,1fr)); } }
@media print { .post-use-html-report-toolbar,.post-use-html-report-status,.v2-toc,.v2-product-list,.no-print { display:none!important; }.report-v2 .report-modules { width:100%; }.v2-product-layout { display:block; }.v2-product-slot { display:block!important; margin-bottom:24px; }.v2-details > * { display:block; }.v2-details-content { display:block!important; }.v2-table thead { display:table-header-group; }.v2-table tr { break-inside:avoid; }.report-module,.v2-panel,.v2-action,.v2-product-panel { print-color-adjust:exact; -webkit-print-color-adjust:exact; }.v2-action { break-inside:avoid; }.post-use-html-report-sheet { display:block; padding:0; }.post-use-html-report { background:#fff; } }
@media print { .v2-chart-grid { grid-template-columns:repeat(2,minmax(0,1fr)); overflow:visible; } }
/* 11-21 用户拍板（覆盖 11-20 方案）：离线导出恢复在线页 tab 交互形态——
   导出态屏幕浏览 = 产品目录按钮切换（内联 JS 注入，见 PostUseHtmlReport.jsx buildOfflineHtml）；
   打印态照旧平铺连续阅读（media print 规则不变）。 */
.report-v2--print .v2-toc { flex-shrink:0; width:210px; max-height:calc(100vh - 72px); overflow-y:auto; position:sticky; top:56px; }
.report-v2--print .v2-product-layout { display:grid; grid-template-columns:250px minmax(0,1fr); gap:18px; }
.report-v2--print .v2-product-list { display:grid; }
.report-v2--print .v2-product-slot { display:none; }
.report-v2--print .v2-product-slot.is-active { display:block; }
.report-v2--print .v2-details > .v2-details-content { display:none; }
.report-v2--print .v2-details[open] > .v2-details-content { display:block; }
/* 11-21 B：图表数据点 hover 强化——title 原生提示 + 视觉反馈（无 JS） */
.v2-chart-wrap svg circle { cursor:help; transition:opacity .15s; }
.v2-chart-wrap svg g:hover circle { opacity:.75; }
/* 11-20 保留下来的图表自适应（height 属性赢过 height:auto 的浏览器冲突形态补齐） */
.report-v2--print .v2-chart-wrap svg { max-width:100%; width:100%; height:auto; }
@media(max-width:1000px) { .report-v2--print .v2-toc { display:none; } }
@media print { .v2-toc { display:none!important; } }
`
