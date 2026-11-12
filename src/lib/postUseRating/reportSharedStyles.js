export const REPORT_SHARED_CSS = String.raw`
/* 在线报告与离线快照共用的阅读层级。离线导出会将此文件内联。 */
.post-use-html-report {
  font-size: 13px;
  line-height: 1.6;
}

.post-use-html-report .report-section-title {
  margin: 0 0 12px;
  color: #1f2937;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.35;
}

.post-use-html-report .report-product-title {
  margin: 0 0 12px;
  color: #1f2937;
  font-size: 16px;
  font-weight: 600;
  line-height: 1.4;
}

.post-use-html-report .report-group-title {
  margin: 18px 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid #e5e7eb;
  color: #1f2937;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.5;
}

.post-use-html-report .report-group-title:first-child {
  margin-top: 0;
}

.post-use-html-report .report-group-subtitle {
  margin: 12px 0 6px;
  color: #4b5563;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.5;
}

.post-use-html-report .report-product-group + .report-product-group {
  margin-top: 10px;
}

.post-use-html-report .report-detail-block {
  margin-top: 14px;
}

.post-use-html-report .report-detail-block > .report-group-subtitle {
  margin-top: 0;
}

.post-use-html-report .report-detail-block--evidence {
  padding: 12px 14px;
  border: 1px solid #eef0f3;
  border-radius: 8px;
  background: #f9fafb;
}

.post-use-html-report .report-detail-block--action {
  padding: 12px 14px;
  border-left: 3px solid #4f46e5;
  border-radius: 0 8px 8px 0;
  background: #f8f9ff;
}

.post-use-html-report .report-detail-block--action .report-group-subtitle {
  color: #1f2937;
}

.post-use-html-report .report-detail-block--action .readonly-block {
  min-height: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.post-use-html-report .report-prose {
  margin: 0;
  color: #1f2937;
  font-size: 13px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.post-use-html-report .report-evidence-meta {
  margin: 6px 0 0;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.post-use-html-report .report-evidence-meta--warning {
  color: #92400e;
}

.post-use-html-report .report-change-note {
  margin-top: 8px;
  color: #374151;
  font-size: 13px;
  font-weight: 600;
}

.post-use-html-report .report-evidence-label {
  margin: 12px 0 6px;
  color: #4b5563;
  font-size: 12px;
  font-weight: 600;
}

.post-use-html-report .report-group-empty {
  margin: 8px 0;
  color: #6b7280;
  font-size: 13px;
}

.post-use-html-report .post-use-html-report-evidence {
  margin: 0;
  padding: 10px 12px;
  border: 1px solid #eef0f3;
  border-radius: 8px;
  background: #f9fafb;
  color: #1f2937;
  font-size: 13px;
  line-height: 1.65;
}

.post-use-html-report .post-use-html-report-quote {
  display: block;
  margin: 6px 0 0;
  padding: 8px 10px;
  border: 1px solid #e5e7eb;
  border-left-width: 3px;
  border-radius: 0 6px 6px 0;
  background: #fff;
  color: inherit;
  text-decoration: none;
}

.post-use-html-report .post-use-html-report-quote--negative {
  border-left-color: #c45b5b;
}

.post-use-html-report .post-use-html-report-quote--positive {
  border-left-color: #3d9a5f;
}

.post-use-html-report a.post-use-html-report-quote:hover {
  border-color: #a5b4fc;
  border-left-color: #4f46e5;
}

.post-use-html-report .report-quote-text {
  display: block;
  color: #1f2937;
  font-size: 13px;
  line-height: 1.65;
}

.post-use-html-report .report-quote-meta {
  display: block;
  margin-top: 3px;
  color: #6b7280;
  font-size: 12px;
  line-height: 1.5;
}

.post-use-html-report .report-all-quotes {
  margin-top: 10px;
}

.post-use-html-report .report-all-quotes summary {
  color: #4f46e5;
  cursor: pointer;
  font-size: 12px;
}

@media print {
  .post-use-html-report .report-product-title,
  .post-use-html-report .report-group-title,
  .post-use-html-report .report-group-subtitle {
    break-after: avoid;
  }

  .post-use-html-report .post-use-html-report-quote,
  .post-use-html-report .report-detail-block--action {
    break-inside: avoid;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
}
`
