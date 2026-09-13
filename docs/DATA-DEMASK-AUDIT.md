# 数据解密审计结论

日期：2026-08-04

## 结论摘要

- 当前仓库内已确认的系统级脱敏逻辑，仅发现 **IP 地址替换为 `[IP已脱敏]`** 的残留 helper。
- 审计范围内未发现该 helper 仍被主导入、重打标、展示页、导出链路实际调用。
- 未发现客户姓名、手机号、客户编号等字段的程序化脱敏实现；若这些字段在线上仍为脱敏态，更可能来自源文件上游，而不是当前系统写入或展示时再次处理。
- 存储层未发现“原文 + 脱敏文双存”或原始上传文件留存机制，因此历史已入库的脱敏文本本次不做恢复。

## 调用点审计

### 仍在生效

- 未发现 `desensitizeImportRow`、`desensitizeFeedbackTexts`、`maskIpAddresses` 在当前业务主链路中的调用。

### 已废弃未调用

- `src/lib/desensitize.js`
  - `maskIpAddresses`
  - `desensitizeImportRow`
  - `desensitizeFeedbackTexts`

### 仅文档残留

- `docs/API-METHOD-EXCEPTIONS.md`
  - 原描述“工单列表含脱敏后内容”已与当前主链路不符，需要改为“返回库内当前存储内容”。

## 存储与展示审计

- `records` 持久化结构中未发现原文字段镜像，如 `rawTextOriginal`、`sourceColumnsOriginal` 等。
- 展示层未发现统一“展示前脱敏”逻辑；列表、抽屉、导出主要直接读取库内字段。
- 这意味着：
  - 新数据是否明文，取决于导入/写库链路是否保留原文。
  - 历史记录若已经存成 `[IP已脱敏]`，仅改页面无法恢复原文。

## 本次落地

- 删除仓库内未被调用的 IP 脱敏残留 helper，避免未来误接入。
- 保留 `normalizeTicketId`、`normalizeCreatedAt` 等格式规范化逻辑；这些不是脱敏。
- 增补回归测试，覆盖：
  - 主导入 `processRow` 保留明文 IP。
  - 重新打标 `reprocessFeedbackRecord` 不把明文改回 `[IP已脱敏]`。

## 不在本次范围

- 历史已脱敏数据恢复。
- 上游源文件已脱敏字段的还原。
- 明文/脱敏文双存设计。
