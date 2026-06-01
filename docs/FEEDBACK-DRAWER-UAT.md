# 工单详情 Drawer · UAT 记录

> 样例数据：`src/lib/ticketAnalysis/fixtures/detailDrawerUatSamples.js`（投诉/咨询各 5 条，复用 export v2 前 5 条）  
> 自动化：`src/components/FeedbackDrawer.uat.test.js`、`FeedbackDrawer.layout.test.js`  
> 设计线框：[DESIGN-20260601-1.md §3.1](./DESIGN-20260601-1.md)

**版本**：P2-0～P2-6 详情改版  
**执行日期**：2026-06-01  
**执行方式**：自动化 UAT（Vitest）+ 下列手工项可选复核

---

## 1. 样例覆盖（10 条）

| 分组 | 数量 | 样例 ID | 覆盖场景 |
|------|------|---------|----------|
| 投诉 | 5 | `uat-c-01`～`uat-c-05` | B2 终判、确立举措、legacy 举措、空排期、根因 effective、加急 |
| 咨询 | 5 | `uat-z-01`～`uat-z-05` | 无 B2 终判、import 来源、空痛点 fallback、排期待评估 |

运行自动化 UAT：

```bash
npm test -- src/components/FeedbackDrawer.uat.test.js src/components/FeedbackDrawer.layout.test.js
```

---

## 2. 核对清单

### 2.1 自动化（已通过 ✅）

| # | 检查项 | P2 | 结果 |
|---|--------|-----|------|
| A1 | 布局 A→B1→B2→C→D | P2-0 | ✅ layout test |
| A2 | C 区：自动优化→产品组/设计师→确立举措→排期 | P2-1/3/4 | ✅ layout test |
| A3 | D 区：处理意见→根因排查→备注 | P2-0/2 | ✅ layout test |
| A4 | 投诉 5 条 isComplaintTicket；咨询 5 条否 | P2-0 | ✅ uat test |
| A5 | 10 条 save patch → export v2 核心列一致 | P2-1～5 | ✅ uat test |
| A6 | 根因 effective / 确立举措 / legacy 举措 | P2-1/2/6 | ✅ uat test |
| A7 | import 来源 Tag → 人工（uat-z-07 类） | P2-6 | ✅ uat test |
| A8 | canEdit / !canEdit 双路径存在于源码 | P2-7 | ✅ uat test |
| A9 | 编辑客户请求 → manualTagFields + 导出 | P2-5 | ✅ uat test |

### 2.2 手工（真实库 · 投诉/咨询各 5 条）

在 **反馈列表** 打开工单详情，逐项勾选：

#### 布局（P2-0）

- [ ] 投诉单：meta → 工单分类 → **投诉原因（终判）** → C 区 → D 区
- [ ] 咨询单：**无** 投诉原因（终判）Card
- [ ] 处理意见在优化建议 **下方**

#### 编辑与保存（P2-1～P2-5，`canEdit=true`）

- [ ] 客户请求 / 痛点：可编辑，保存后重开一致
- [ ] 产品组 / 设计师建议：可编辑（不参与聚类提示可见）
- [ ] 确立举措 + 排期：可编辑；空排期可保存
- [ ] 根因排查：默认 effective；编辑保存后导出一致
- [ ] 保存后来源 Tag：人工维护项显示「人工」

#### 只读（P2-7 · `canEdit=false`）

- [ ] C 区客户请求/痛点为只读段落，无 TextArea
- [ ] 根因排查只读展示 effective
- [ ] 确立举措/排期：有内容时 Descriptions/文本展示

#### 重新打标（P2-5）

- [ ] 改客户请求并保存 → **默认**批量重打标 → 客户请求保留
- [ ] 强制覆盖重打标 → 人工维度清空（与 P0-3 UAT 一致）

---

## 3. 代表样例速查

| ID | 类型 | 验收要点 |
|----|------|----------|
| `uat-c-01` | 投诉 | 全字段；根因人工；确立举措+排期 |
| `uat-c-02` | 投诉 | legacy manualReviewOptimization → 确立举措；空排期 |
| `uat-c-03` | 投诉 | 根因 fallback「问题原因」 |
| `uat-z-01` | 咨询 | 无终判；problemType 为打标值 |
| `uat-z-05` | 咨询 | import 来源 → Tag「人工」；legacy 举措 |

---

## 4. 里程碑

| 里程碑 | 条件 | 状态 |
|--------|------|------|
| **M2 可编辑** | P2-0～P2-7 UAT 通过 | ✅ 自动化 |

---

## 5. 签字

| 角色 | 姓名 | 日期 | 签名 |
|------|------|------|------|
| 开发 | （自动化 UAT 通过） | 2026-06-01 | ✅ |
| 产品 | | | |
| 测试 | | | |

---

## 6. 相关任务

| 任务 | 状态 |
|------|------|
| P2-0～P2-6 | ✅ |
| P2-7 | ✅ |
| P3 导入分析 | 🔜 下一步 |
