# DESIGN — 详情抽屉信息层级与布局优化（2026-11-01）

> 涉及：投诉/咨询工单详情、用后即评详情（同一组件双形态）、举措详情、会议待办详情、留观问题详情。
> 本文档为终版方案，含全部用户拍板项；信息结构以本文档结构树为落地与验收唯一基准。
> 复核真源 = 代码（FeedbackDrawer.jsx / ActionItemDrawer.jsx / TicketTodoDrawer.jsx / ObservationTab.jsx / 及其内嵌子组件）。

---

## 1. 问题诊断（4 根因）

| # | 根因 | 证据 |
|---|------|------|
| 1 | 两套字号体系打架 | antd 全局 fontSize:13 与 Tailwind 12/14/16 同屏混用；FeedbackDrawer 内 text-xs 22 处，12px 出现在正文/摘录 |
| 2 | "标签"形式 5 种并存 | section-title / page-card-title / sub-section-label / Descriptions bordered label / 自定义灰字堆叠 |
| 3 | 信息四类型不分主次 | 正文（客户原文）、结论、说明、元信息同字号同颜色同位置 |
| 4 | 嵌套过深 | 白卡 → 灰盒 sub-section-box → bordered Descriptions → dashed 虚线盒，四层边框底色叠加 |

工单详情信息量最大、问题最重；留观详情最裸（未接入 section/page-card 体系，宽度 560 不齐）。

## 2. 全局设计规范

### 2.1 字号五档（以 antd fontSize:13 为基准）

| 档 | 用途 | 规格 |
|----|------|------|
| D1 | 抽屉主标题 | 16px / semibold / 全抽屉唯一 |
| D2 | 分区标题 section-title | **15px**（由 16px 降）/ semibold / 蓝底条保留 |
| D3 | 卡片标题 page-card-title | 13px / medium / ink-800（降字号，靠字重+颜色区分） |
| D4 | 正文/字段值（客户原文、分析结论、摘录） | 13px / regular~medium / ink-900；客户原文加 500 字重 |
| D5 | 元信息 + 说明 | 12px / regular / secondary 以下；**12px 只允许出现在本档** |

原则：13 vs 14 肉眼不可分——同字号信息用字重（400/500/600）+ 颜色（ink-900/600/400）+ 位置区分；字号只承担层级职责。
注：section-title 仅 3 个抽屉组件使用，改 15px 无外溢。

### 2.2 信息四分类与固定视觉编码

- **正文**（工单原文/评价原文/回访反馈）：通栏、13px/500、行高 1.7、左侧 3px 品牌色竖条；永不进 Descriptions 表格。
- **结论**（请求内容/痛点/根因/优化建议/恢复·压降结论）：标题 + 正文堆叠，来源 Tag 右置。
- **说明**：三种语义三个固定位置——①字段口径 → 标题旁 ⓘ tooltip；②操作提示 → 内容下方一行 12px；③行为型警示（如留观"判别锚点"）→ 警示色 ⓘ。禁止 3 行以上常驻灰字。
- **元信息**（时间/来源/操作人）：统一收卡片底部 MetaRow（12px secondary，`·` 分隔），禁止散落内容中间。

### 2.3 结构三硬规则

1. 嵌套 ≤ 3 层：卡片(白) → 子区(灰，可选) → 内容；**dashed"导入原文（只读建议）"盒取消**，改为输入框旁「引用原文建议 →」链接式一键填入。
2. 长文本一律"label 上/值下"堆叠；短标签字段才横排；Descriptions 去 bordered（整体替换为堆叠式/标签组卡）。
3. 编辑态与只读态同构：骨架不变，只把"值"换成输入框，保存后不跳位。

### 2.4 Alert 使用规范（2026-11-01 拍板）

**Alert 只用于事件型警示**（刚发生 + 需要行动）；状态型信息一律用状态位（Tag/徽章/meta 行）。
据此：工单/评价/举措抽屉的"已被他人更新"（事件）保留 Alert；举措抽屉"该举措已结束""已选择关联需求工单"两条 info Alert 删除；恢复验证解释 Alert 降级为灰底说明行。

### 2.5 抽屉骨架统一

宽度统一 720px（工单 720 不变；举措/待办 640→720；留观 560→720）。标题区两行式（主标题 16px + meta 行 12px）；滚动只在正文层；底部操作条固定；保存为唯一 primary。

---

## 3. 各抽屉方案与信息结构（终版）

### 3.1 投诉/咨询工单详情（FeedbackDrawer，工单态）

```
标题区：工单详情 16px｜锚点导航（工单内容·工单分析·工单分类）
        meta 行：工单号(可复制icon调用点，功能屏蔽中) · 产品(规格) · 数据源
冲突提示（条件，分级）：
  other → 黄 warning「此工单已被他人更新 · 更新人/时间 · 继续编辑可能覆盖他人修改 [加载最新]」
  own_task → 蓝 info「此工单已被你发起的批量任务更新（任务名·进度）· 列表已同步为较新版本 [加载最新]」
分区一 工单内容
  ├ 工单原文卡：左色条 · 13px/500 · 行高1.7 · ≤10行全文直显
  │   超出固定截断+末行渐隐+「已截断·全文N字」12px（不做就地展开）
  │   右上「放大查看 ↗」（无徽章；弹窗保留分阶段折叠/关键字定位/选中高亮/摘录导出/复制）
  │   ⓘ口径：优先「处理意见」列，占位时展示「受理内容」
  └ 客户信息紧凑条（浅灰底，非白卡）：集团名称 · 登录账号名称（复制icon调用点保留/屏蔽中）
      回访满意度 + 不满意原因汇总（来自回访导入，只读；条件出现）
分区二 工单分析（卡序：留观→待办→举措）
  ① 分析摘要卡（白卡）：客户请求内容 · 需求痛点（口径ⓘ收tooltip · 来源Tag右置 · 正文13px）
     根因排查子区：自动(来源Tag) + 人工复核(提示行 + 「引用原文建议→」一键填入，替代dashed盒)
     优化建议子区：自动(产品/技术+服务/流程) + 人工复核(产品组·设计师两输入)
  ② 留观问题卡：待复核徽章 · 疑似命中建议（黄底：置信度Tag+摘录+理由+确认/新建/不纳入，就地三选一）
     已关联列表（标题·次数·产品·查看/解除）· 纳入观察入口 · 空态半显
  ③ 会议待办卡：incoming（状态Tag+文本13px+来源/负责人meta+取消关联）· 本单待办编辑 · 从其他工单关联 · 添加待办 · 口径ⓘ
  ④ 确立举措卡（压轴，独立成卡）：从举措库选择 · 举措内容 · 详情（折叠）· 排期 · 编辑/只读同构
  ⑤ 备注卡：编辑 TextArea / 只读 Paragraph
分区三 工单分类
  四维标签（编辑2列grid / 只读标签组卡：每维一行=维度名12px灰+值13px+来源Tag）
  请求场景 · 问题类型(打标) · 旅程L1/L2（二级口径ⓘ）· 问题分类自定义(仅投诉) · 用户情绪 · 加急开关(情绪行内,说明ⓘ)
  投诉终判（仅投诉）：Tag链(一/二/三级) + 发起复核（开关+拟复核Cascader+申请原因+已填写提示）· 说明压一行+ⓘ
footer：已处理☐ · 听音☐（工单态）｜删除 · 重新打标(ⓘ) ｜ 保存(primary, detailSaveBlocked 时禁用+tooltip)
弹窗保留：RecordConflictModal · DeleteTicketConfirmModal · HandlingOriginalTextModal（"新"Badge及whatsNew状态清理）
```

### 3.2 用后即评详情（FeedbackDrawer，评价态；同组件差异项加 ⚠）

```
标题区：评价详情 16px｜锚点导航（评价内容·评价分析·评价分类）
        徽章行（原摘要表收编）：渠道(短信/控制台) · 评分 N分 · 产品 · 用后即评
冲突提示（条件，分级）：⚠ 文案用「此评价已被他人更新」（现状写死"工单"，修正 L1794）
分区一 评价内容
  ├ 评价原文卡：同工单原文卡规格；取值链 rawText→commentText→lowScoreReason
  │   超长截断同规则；「放大查看」= 方案新增（现状无入口，复用工单弹窗机制传评价原文）
  └ 客服部回访卡（有 customerVisit 时，8字段改4分组堆叠）：
      ① 谁：客户名称·客户编码·登录账号（短字段横排）
      ② 说了什么：回访反馈信息（→回访结果兜底）
      ③ 内部判断：内部评估 · 相应投诉工单（仅 scoreSource=投诉回访）· 内部结论
      ④ 摘要：反馈摘要
分区二 评价分析（⚠ 卡序：留观→举措→备注；会议待办卡隐藏——2026-11-01 拍板，现状两态都渲染，落地加 isPostUseLibrary 条件）
  ① 分析摘要卡：同工单态；⚠ 无「产品组/设计师优化建议」人工复核输入（isPostUseLibrary 隐藏）
  ② 留观问题卡（recordDataSource=post_use_rating）
  ③ 确立举措卡 ④ 备注卡：同工单态
分区三 评价分类：⚠ 仅用户旅程 L1/L2（无场景/类型/情绪/加急/终判）
footer：⚠ 已处理☐ · 补全用户旅程（canRetag 且产品目录可解析）· 保存(primary)
        ⚠ 无删除/听音/重新打标（均 !isPostUseLibrary 条件，L982/L1716/L1753）
        legacy 关键词旅程时 confirm「按产品模板重打」
```

### 3.3 举措详情（ActionItemDrawer，640→720）

```
标题区：举措详情 16px｜第二行：产品名(未指定兜底) · 状态Tag（关联需求时派生状态；未同步「待同步」Tag）
分区一 举措
  ├ 唯一 Alert：stale 警告（条件出现，「此举措已被他人更新 [加载最新]」，事件型）
  │   （原"该举措已结束""已选择关联需求工单"两条 info Alert 删除——状态由状态位承载）
  ├ 核心表单卡：举措内容* · 举措详情(可选) · 状态* · 排期时间（状态联动必填/免填；仅非关联模式）
  │   锁定态(已结束/异常终止)：标题状态Tag + 表单只读 + footer 只剩关闭（三信号承载；可选卡顶12px灰字）
  └ 关联需求工儿子模块：Radio 不关联/关联 · 工单号 Form.List · 说明行承载原Alert语义
      关联时：排期/状态自动展示（外部集成只读 ·「自动同步」徽章 · 字段灰显）
分区二 洞察（瘦身后，仅立项依据；条件：有主题/洞察/证据/触发指标）
  洞察主题Tag · 洞察N · 证据N · 触发指标（指标·周期·值·目标）
  （恢复验证全部要素移入分区五——2026-11-01 方案A 拍板）
分区三 关联问题（共N类时标注）
  每问题条目：产品名13/500 + 旅程12px + N单Tag + 类型/场景Tag · 痛点摘录灰底引文13px两行省略
  无工单证据 fallback：类型Tag+旅程Tag+来源Tags · 问题（举措快照）子块三行省略
  底部 MetaRow：首次提出 · 最近更新（更新人·时间）
  （签名聚合视图，不显示单据工单号；工单号在分区四）
分区四 关联反馈（N）
  LinkedTicketsInlineList 共用组件：共N条 · >5条折叠 · 复制全部 · 按月分组
  工单号13px链接 · 来源Tag · 未入库警示Tag · 摘要13px两行省略（原12px升）
  点击工单号 = 原地打开 FeedbackDrawer（zIndex 1010 盖在宿主抽屉上，不跳页面；无此单时 warning）
分区五 效果验证（原"压降验证"+"恢复验证"合并——方案A）
  顶部结论行（第一眼答案，无数据显示"—"）：
    工单量（关联N单）：月均 X → Y，↓Z%（Tag 绿降/红升）
    用户评分（N条评价）：X → Y + 恢复Tag（绿恢复/红未恢复/金其他）
  恢复解释：灰底说明行（仅 not_recovered；原 Alert 降级）
  明细折叠区（每问题签名一个面板，默认收起）：
    面板头：产品·旅程·N单·压降%Tag｜面板内：类型/场景Tag · 痛点样本13px · 趋势图(工单数/负向/实施锚线)
    前后对比：锚点前N月(共X单·月均Y)→锚点后N月 · 月均数字500字重
    底部 meta：锚点（实施）日期 · 关联趋势，非因果
  空态：暂无关联工单，无法做效果验证｜数据不足/基线为0 兜底文案保留
footer：可编辑且未锁定？ 取消/保存(primary) ： 关闭
```

### 3.4 会议待办详情（TicketTodoDrawer，640→720）

```
标题区：处理会议待办/查看会议待办（processing 双态）16px｜第二行：产品名 · 状态Tag
分区一 待办信息
  处理态：待办 TextArea*（showCount）· 负责人多选
  查看态：待办/负责人 label上/值下 13px（与全局同构，废弃自定义堆叠样式）
分区二 处理（processing 时）
  三模式 Radio：制定举措/转留观/无举措；模式切换内容块位置固定（选中态底色强关联，无位移）
  ① 制定举措（灰盒）：EstablishedActionFields（库选·内容·详情折叠·排期）——与工单详情确立举措卡同构
  ② 转留观（灰盒）：新建（摘要预填）或搜索已有（label 含 次数·最近）· 提示收一行
  ③ 无举措（灰盒）：直接反馈备注 + 标记为已处理
  查看态（resolution 决定）：converted_to_action=已制定举措（内容13px+详情12px+排期meta）；
  processed_without_action=处理备注13px；否则"—"
分区三 问题上下文（单据级快照，与举措"关联问题"聚合视图语义不同、标题保持区分，视觉规格统一）
  Tag行：问题类型 · 旅程L1/L2 · 来源｜问题正文 13px/500 两行省略(tooltip全文)
  ⚠ 现状 rows:3 → 统一 rows:2（与举措详情对齐，有意规格统一）｜底部 MetaRow：提出时间·最近更新
分区四 关联反馈（N）：LinkedTicketsInlineList 共用（一改两抽屉生效）
footer：processing？ 取消/提交(primary) ： 关闭
```

### 3.5 留观问题详情（ObservationTab 内联 AntDrawer → 接入统一体系，560→720）

```
标题区（两行式替代纯文本拼接）：留观问题 16px｜第二行：问题标题 · 状态Tag · 出现N次（工单x·评价y）
分区一 问题本体（section/page-card 接入）
  问题标题* · 问题描述* + 行为型警示ⓘ（警示色；文案采用「修改后，后续自动识别将按此描述判断」，落地可微调）
  关键词（ⓘ 顿号/逗号分隔；供自动召回）· 建议 chips 合并引导行「建议：+kw」
  备注 · 状态（观察中/已升级/已归档）
  只读态（canEdit=false）：label上/值下堆叠（替代整表单 disabled）
分区二 证据与匹配历史（含已否决）
  每条证据行三行结构：
    行1：状态Tag(已确认/待复核/已否决) · 数据源(投诉/咨询/用后即评) · 工单号13px 可点=原地打开工单详情抽屉
        （2026-11-01 拍板：现状静态文本→可点；用后即评证据无工单号，"评价"链接按 recordId 原地打开评价详情）
    行2：命中摘录 13px 两行省略（替代现状 truncate 单行）
    行3：匹配来源（规则/模型）· 匹配理由 — 12px meta 行
  confirmed 且可编辑：解除按钮（Popconfirm 保留）｜空态/加载中提示保留
footer：canEdit？ 取消/保存(primary) ： null（现状保持，只读靠 X 关闭）
不迁移：列表区"建议升级"徽章逻辑在列表行非抽屉内
```

---

## 4. 交互与逻辑变更清单（行为级，落地逐项对照）

| # | 变更 | 涉及代码 | 类型 |
|---|------|---------|------|
| 1 | 原文 ≤10 行直显；超出截断+渐隐+「已截断·全文N字」；**不做就地展开**；放大弹窗为全文唯一出口（工单态已有，评价态新增入口） | FeedbackDrawer L1892-1918（line-clamp-3→10）；评价态新增放大入口 | 行为 |
| 2 | 放大查看 whatsNew「新」Badge 移除 + Modal 内"功能上新"条 + hasSeen/markSeen 状态清理（功能保留） | FeedbackDrawer L1894-1898、L677-692、whatsNew.js | 清理 |
| 3 | 工单分析卡序：分析摘要 → 留观 → 待办 → 举措 → 备注；确立举措独立成卡 | FeedbackDrawer L2101+（优化建议卡内 EstablishedActionFields 移出） | 结构 |
| 4 | 评价态隐藏会议待办卡（现状无 isPostUseLibrary 条件） | FeedbackDrawer L2274 加条件 | 行为 |
| 5 | remoteStale 分级提示：boolean → false/'own_task'/'other'；他人=黄条不变；自己任务=蓝 info 条（任务名·进度·[加载最新]）；提示时不再静默推进 baseRevision | recordRemoteStale.js + FeedbackDrawer L1175-1200/渲染 + Actions.jsx L726+ + recordRemoteStale.test.js 7 用例重写 | 逻辑 |
| 6 | remoteStale/冲突弹窗评价态文案：两处「此工单」→「此评价」 | FeedbackDrawer L1794、RecordConflictModal L56 | 文案 |
| 7 | 留观抽屉证据行工单号可点（原地打开详情抽屉，复用 onOpenRecord 模式；评价来源按 recordId） | ObservationTab.jsx L553-555 + 宿主接线 | 行为 |
| 8 | 举措抽屉：删"该举措已结束""已选择关联需求工单"两条 info Alert（状态位承载）+ 「自动同步」徽章 | ActionItemDrawer L157-172 | 结构 |
| 9 | 举措分区二瘦身为"洞察"；分区五改名"效果验证"合并恢复验证（方案A）：顶部两行结论 + 恢复解释灰底行 + 明细折叠 | ActionItemDrawer L274-298 拆分 + ActionProblemScopePanel 改造 | 结构 |
| 10 | dashed"导入原文（只读建议）"盒 → 「引用原文建议→」链接一键填入 | FeedbackDrawer L2063-2069 | 交互 |
| 11 | 会议待办问题正文 rows:3→2（规格统一） | TicketTodoDrawer L460 | 规格 |
| 12 | 留观"判别锚点"文案 → 「修改后，后续自动识别将按此描述判断」+ 警示色ⓘ | ObservationTab L503 | 文案 |
| 13 | LinkedTicketsInlineList 摘要 12px→13px | LinkedTicketsInlineList L156 | 规格 |
| 14 | footer 统一：保存唯一 primary；删除降级（文字态/收"…"，落地时定）；detailSaveBlocked 禁用+tooltip 保留 | FeedbackDrawer footer；ActionItemDrawer/TicketTodoDrawer/ObservationTab footer | 规格 |

## 5. 明确不改清单

- 保存冲突三出口（取消/加载最新/覆盖）+ expectedRevision 复检 + "无字段差异"分支 —— 逻辑健壮，仅文案；
- 后台任务锁体系（import/retag/post_use_journey 互斥、心跳/最长时长、detailSaveBlocked）—— 完全不动；
- 放大弹窗的高亮/摘录/定位/分阶段能力集 —— 原样保留；
- 留观匹配器（summary 判别锚点）逻辑、pending_suggest 就地三选一、两入口设计（展开行读证据/侧滑维护本体）；
- ObservationCard 空态半显；冲突弹窗/删除确认弹窗结构；
- ActionCopyIcon 调用点保留（COPY_ICON_ENABLED=false 屏蔽中，HTTPS 后自动恢复，不做 UI 改动）。

## 6. 实施计划

### 阶段 0：全局样式基建（半天）
- index.css：section-title 16→15px（爆炸半径=3 抽屉组件）；核对 sub-section-label（12px/500/灰 = 唯一子模块标题规格）、drawer-space-y/drawer-section-gap 间距（20/10px 保留）；
- 字号清理原则入代码注释：12px 仅限 meta/说明，正文与摘录一律 13px。

### 阶段 1：FeedbackDrawer 全组件（工单态+评价态同文件，1.5~2 天）
- 1a 工单态：原文卡升级（截断规则+左色条）、客户信息紧凑条、分析区卡序重排+确立举措独立、分类区标签组卡化、dashed 盒→引用链接、footer 排序；
- 1b 评价态：徽章行、原文卡+放大入口、回访 4 分组、隐藏会议待办卡、分类仅旅程；
- 1c whatsNew Badge 清理；
- 测试：FeedbackDrawer.layout.test.js / FeedbackDrawer.uat.test.js / PostUseJiraDrawer.layout.test.js 受影响子集（vitest 临时 config 照记忆约定从 backup-before-rebase e51ddce 恢复）。

### 阶段 2：remoteStale 分级提示（半天）
- recordRemoteStale.js 三态返回 + FeedbackDrawer/Actions.jsx 渲染 + recordRemoteStale.test.js 重写 + 评价态文案两处。

### 阶段 3：ActionItemDrawer + Actions.jsx（1 天）
- 标题区两行式、Alert×2 删除、分区二瘦身、分区五效果验证合并（含 ActionProblemScopePanel 顶部结论行改造）、自动同步徽章、LinkedTicketsInlineList 13px。

### 阶段 4：TicketTodoDrawer + ObservationTab 抽屉（1 天）
- 待办：只读态同构、处理区固定位置、rows:2、meta 收底；
- 留观：720 宽、两行标题、两分区、证据行三行结构+可点跳转（宿主接线 onOpenRecord）、只读态堆叠、判别锚点文案。

### 验收口径（每阶段跑完对照）
1. 3 秒定位原文与人工复核结论（原文不折叠不进表格）；
2. 全部抽屉仅 16/15/13/12 四档字号、三种字重；12px 不出现在正文/摘录；
3. 嵌套 ≤3 层、无 dashed 盒；编辑/只读同构不跳位；
4. 信息项零丢失：对照本文档 §3 结构树逐项勾（含条件分支：评价态隐藏项、锁定态、resolution 三态、scoreSource 条件字段）；
5. Alert 仅事件型；说明 ≤ 一行或收 ⓘ。

### 回归测试约定（按项目记忆）
- 只跑受影响 vitest 目标子集，不默认全量 E2E；E2E 需明确指令；
- 三要素：非沙箱 + env -u NODE_OPTIONS + 装包用 npmmirror；JSX 语法快速验证用 node -e + esbuild transform；
- 同文件多处 Edit 分条消息顺序发，落盘后 Grep 复核。

## 7. 本轮拍板记录（决策日志）

| 时间 | 拍板 |
|------|------|
| 13:34 | 工单分析卡序：留观→待办→举措（处理链条从轻到重），备注在末尾 |
| 14:29 | 原文默认展开 8-10 行（后修正：截断不展开）；复制 icon 保持屏蔽；判别锚点=行为型警示 |
| 15:21 | 超长原文固定截断，全文只进放大弹窗，不做就地展开 |
| 15:23 | 判别锚点语义确认（改描述→后续自动识别按新描述判） |
| 15:31 | 放大查看「新」Badge 为 whatsNew 标记，落地移除；字数徽章撤回 |
| 15:52 | 评价态隐藏会议待办卡；remoteStale 文案两处修正；图5 工单号可点=升级项 |
| 16:00 | Alert 规范：事件型专用；举措两条 info Alert 删除 |
| 16:05 | 留观证据行可点（原地抽屉）；自己任务更新改分级提示（蓝 info 条） |
| 16:07 | 方案A：举措分区二瘦身为"洞察"、分区五合并为"效果验证" |
