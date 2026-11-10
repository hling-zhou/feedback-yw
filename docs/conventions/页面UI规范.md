# CONVENTIONS · 页面 UI 规范

> 适用对象：**人 + AI 共同执行**。新建或修改任何页面、面板、组件前先读本文。
> 样式单源 = `src/index.css`（本文是判定口径，实现以 CSS 为准）；
> 机器强制 = `src/lib/uiConventionsGuard.test.js`（源码扫描守卫，红绿已证）。
> 由来：2026-11-07 apiPatrol 两页间距不一致复盘产物（此前规范散在 CSS 注释里，靠口口相传）。

## 1. 三级间距模型（单源，禁止自包）

```
AppShell 外壳 → .app-shell-content 统一提供页面四周 padding
                 （px-3 → sm:px-4 → lg:px-5 = 12/16/20px 响应式，底部另有留白）
页面组件     → 只排卡片间距：外层容器一律 <div className="space-y-4">
卡片内部     → page-card 自带 p-4，卡内布局自行安排
```

**禁止：页面组件自包四周 padding**（`p-4` / `p-5` / `p-6` 均禁止）——与外壳叠加成双倍留白
（p-6 时四周 44px vs 其他页面 20px），且固定值丢失响应式收缩。

先例（抄这些文件）：`src/pages/Actions.jsx`、`src/pages/TopicAnalysis.jsx`、
`src/pages/TicketTodoTab.jsx`、`src/pages/PostUseJiraTab.jsx`。

## 2. 卡片体系（单源类名，禁止 antd Card 当页面卡片）

| 场景 | 类名 | 说明 |
|---|---|---|
| 页面内容卡片（默认） | `page-card` | rounded-lg · bg-white · **p-4** |
| 紧凑卡片（统计/小表） | `page-card-sm` | 同上 · p-3 |
| 白底嵌套需区分模块 | `page-card-bordered` | 加描边（抽屉、tab 内容区用） |
| 白卡内浅灰指标区块 | `metric-card` | rounded-lg · bg-ink-50/60 · p-3 |
| 灰底多卡纵排间距 | `page-card-stack` | flex 纵排 · gap-3 |

**禁止：`<Card>`（antd）当页面卡片**——body 24px、title 16px，与 page-card 体系（16px/14px）
两套间距字号。历史存量：McpGuide / Operations / Feedbacks 三页（见 §6）。

## 3. 标题体系（字号 2026-11-01 用户拍板终版：14px 足够、15 过大）

| 层级 | 用法 | 字号/字重 |
|---|---|---|
| 页面标题 | `PageHeader` 组件（desc / hint / action props） | 组件内建 |
| **卡片标题** | `page-card-header` + `<span className="page-card-title">` | **14px · 600 · ink-900** |
| 卡片副标题 | 与卡片标题同行 `gap-2` 横排：`<Typography.Text type="secondary" className="text-xs">` | 12px |
| 弹窗（自定义 Modal）标题 | `Typography.Title level={5}` ✅ 豁免 | 16px/600（antd Modal title 默认的合理近似，层级高于卡片标题属正常） |

- `page-card-header` = `mb-2 flex items-center justify-between gap-2`：左侧标题组（可再包一层
  `flex flex-wrap items-center gap-2 min-w-0` 放标题+副标题），右侧放操作/开关/Tag。
- **禁止：`Typography.Title level={5}`（16px）当卡片标题**。历史存量 10 文件（见 §6）。
- 抽屉内字号/间距**另见** `docs/DESIGN-drawer-ux-20261101.md`（D1–D5 规范，本表不覆盖）。

## 4. 表单标签

见组件 `src/components/FieldLabel.jsx`（2026-11-04 全局约束：必填必须有标记；
手写标签一律用 FieldLabel，样式锚定 antd Form.Item 默认 14px）。本表不重复展开。

## 5. 新建组件流程纪律（触发规则，不做随机纪律）

1. **写任何新的页面/面板组件 → 第一行容器 JSX 之前，必先打开 1–2 个同类既有文件**，
   对齐：外层容器类名 → 卡片体系 → 标题体系 → 间距写法。**antd/框架默认心智 ≠ 本项目规范。**
   （反面先例：M5 面板参照了相邻文件全对；M6/M7 两页没参照，三处另做一套——同一人同一天。）
2. **改 UI 后的验证声明**：渲染测试/typecheck 只对功能与数据敏感，对"跨文件视觉一致性"
   **零拦截**——UI 结构改动必须真机目检，并在交付说明里显式声明"已/未真机确认"。
3. **源码扫描一律用 ripgrep（Grep 工具）或单模式多次 grep**——多模式 bash grep
   （`"a\|b\|c"`）在本环境多次哑火误报（先例：M5 面板漏扫）。

## 6. 历史存量与豁免（随改随清，不专项统一）

判据：**异构、无视觉投诉基准、盲改风险大于收益** → 债务化处理；文件因功能改动被打开时
顺手对齐，对齐后更新下表与守卫豁免清单。

| 存量 | 位置 | 处置 |
|---|---|---|
| `p-6` 自包容器 | `src/pages/Operations.jsx` | 守卫豁免（整体异类页：p-6 + Title level={3} + antd Card + 无 page-card——单摘 p-6 会半吊子，该页下次功能改动时整体规范化后移出豁免） |
| `Title level={5}` 卡片标题 | Import / TopicBriefView / JourneyFeedbackSection / PostUseMonthlyReportPreview / ProblemDetailDrawer / ProductDrillDown / InsightFeedbackList / WhatsNewDrawer | 随改随清（其中 ProblemDetailDrawer 属抽屉场景，对齐时以抽屉规范 D2 为准） |
| antd Card 页面卡片 | McpGuide / Operations / Feedbacks | 随改随清 |

## 7. 机器守卫

`src/lib/uiConventionsGuard.test.js`（vitest，源码扫描型，先例 `formRequiredGuard.test.js`）：

- 断言①：**全部 pages + apiPatrol 前端全域**不得自包 `p-6`（豁免清单见 §6）；
- 断言②：apiPatrol 前端全域不得用 antd `<Card>` 当页面卡片；
- 断言③：apiPatrol 前端全域卡片标题不得用 `Title level={5}`（弹窗标题白名单豁免，内容锚）；
- 自检：扫描覆盖非空断言（扫描器失效即红，防恒绿假守卫）；
- 红绿纪律：**新增断言/白名单/豁免时必须注入反向 bug 验证能红**（豁免≠扫描盲区，已证）。

新模块上线时把其目录加进 `collectPatrolFrontendFiles()` 的收集正则，让守卫域随代码生长。

## 8. 相关文档

- `docs/DESIGN-drawer-ux-20261101.md` —— 抽屉字号/间距规范（D1–D5）
- `防缺陷触发规则.md`（同目录）—— 防缺陷触发规则（"做 X 时必答 Y"形态）
- `src/components/FieldLabel.jsx` —— 表单标签组件（11-04 规范载体）
- `src/index.css` —— 以上全部类名的样式实现单源
