# 项目约定目录（docs/conventions/）

> 本目录是这个项目**协作约定的唯一维护真源**，适用对象：**人 + AI 辅助开发会话**。根目录 README 和 AGENTS.md 仅提供发现入口。
> 整理自项目工作记忆（.workbuddy/memory/，2026-09-06 ~ 2026-11-11）与用户全局记忆，
> 由 2026-11-11 约定入库动作建立；此后新约定经用户确认后登记进对应主题文档，再考虑代码化（守卫测试/审计脚本）。

## 为什么有这个目录

工作记忆（MEMORY.md + 每日日志）在 `.gitignore` 里（`.workbuddy/` 不入库），其他协作者看不到。
本项目大量约定是踩坑后拍板的（有先例、有守卫、有出处日期），散落在记忆里对新人不可见、对新 AI 会话不可注入。
本目录把**对协作有持续约束力**的约定固化为入库文档，每条尽量带：出处日期 → 先例 → 守卫（如有）。

## 文档清单（按阅读顺序）

| 文件 | 主题 | 何时必读 |
|---|---|---|
| [01-协作与执行纪律.md](01-协作与执行纪律.md) | 执行前对齐、Edit 锚点、同文件串行编辑、需求词指代澄清 | 每次开工前、改代码前 |
| [02-Git提交约定.md](02-Git提交约定.md) | 结合本项目更新动态机制的 commit hygiene、不自动提交、Changelog: skip 规则 | 提交前 |
| [03-数据真源与口径.md](03-数据真源与口径.md) | 数据真源清单、product/productName 双字段、打标闸门与阈值公式、LLM 契约 | 读/写任何数据相关代码 |
| [04-测试与验证约定.md](04-测试与验证约定.md) | vitest 子集、真实链路验证、typecheck 纪律、本地 E2E 需指令 | 改完代码后、交付声明前 |
| [05-设计拍板与已知坑.md](05-设计拍板与已知坑.md) | 已拍板设计、已知坑与先例（含 **2.5 中继/契约链类**——三列对拍/静默兜底可观测/定向修复过推送链）、**待拍板清单** | 动数据模型/键粒度/UI 结构/中继契约链路前 |
| [06-环境启动与部署.md](06-环境启动与部署.md) | dev:clean、端口、部署缓存三件套、MCP/Mail | 起服务、发版、排障时 |
| [07-权限码语义判据.md](07-权限码语义判据.md) | 16 权限码客体身份判据表、editRecord vs manageTags 分界、同构动作一致性三步选码 | 写任何 can()/requirePermission() 门控前 |
| [防缺陷触发规则.md](防缺陷触发规则.md) | 27 条"做 X 时必答 Y"触发规则 + 排查约定（11-06 起持续补充；15-18 为 11-23 复盘新增：平移核心算法/计数统计对象/API 判别字段透传/定位类 bug 全量扫描；19-23 为 11-23 深夜复盘新增：server 文件模块加载/LLM 解析器单源/API 响应形态前端两层消费方/真实数据形态驱动/修复完成判定；24-25 为 11-25 万投比 tab 复盘新增：组件替换必盘点能力 props/hooks 零消费当被吞信号排查；26-27 为 11-27 需求池反馈闭环复盘新增：自由文本端点必答服务端校验/设计键形态实现 checklist 对照） | 写删除/计数/共享层/来源标注/构造测试前置/组件替换重构前 |
| [页面UI规范.md](页面UI规范.md) | 三级间距/卡片/标题/表单标签体系 + 守卫清单（11-07 复盘产物） | 写任何 UI 前必读 |

## 机器守卫与审计脚本索引

| 守卫 | 文件 | 拦截什么 |
|---|---|---|
| UI 规范守卫 | `src/lib/uiConventionsGuard.test.js` | p-6 自包、antd Card 当页面卡片、Title level={5} 当卡片标题（源码扫描） |
| 表单必填守卫 | `src/lib/formRequiredGuard.test.js` | 必填无标记、手写标签绕过 FieldLabel |
| 共享谓词审计 | `scripts/audit-shared-predicates.mjs` | 直摸数据结构绕过 isArchived/isDispatched/decisionOf（exit 1，可接 CI） |
| sticky chrome 守卫 | `src/pages/PostUseJiraTab.chrome.render.test.jsx` | page-sticky-chrome 误入卡片内 / bg-ink-50 灰底回潮 |
| 分页总数守卫 | `src/lib/paginationTotal.guard.test.js` | 活跃分页缺 showTotal、内联回调回潮、消费方 import 路径断裂（11-11 部署机构建炸后补） |
| LLM 批容器契约守卫 | `src/lib/llmClient.test.js`（批容器用例组） | 解析层剥掉 {results:[...]} 包装；截断态思考草稿冒充正文（11-18）；报告 V2 focus/products/todos 容器（11-18） |
| 同构权限一致性守卫 | `src/lib/gateConsistencyGuard.test.js` | 共享组件宿主门控码漂移、处理反馈写路由权限码回潮 manageTags、未登记新宿主（11-20 复盘产物） |
| 埋点映射守卫 | `src/lib/usageModuleMapGuard.test.js` | 导航/路由表新增页面未登记埋点映射（落入 other 静默丢弃）、前后端镜像映射表回潮（11-20 运营分析迭代产物） |
| 列宽拖拽守卫 | `src/lib/columnWidths.test.js` 等（11-11 新增） | scroll.x 硬编码回潮、直接写 th.style.width |
| 目录缓存守卫 | `catalogCacheCoverageGuard`（reminders/MCP/patrol 线） | 新消费方读目录缓存前漏刷新 |
| rowSpan 合并组链路守卫 | `src/pages/PostUseCallbackListTab.rowSpan.render.test.jsx`（11-23） | 清单 tab 分组循环步进手抄偏差（i+=1 回潮）→ 组内非首行被重标组首、rowSpan:0 吞行失效列错位；红绿自证 |
| 产品计数口径守卫 | `src/pages/PostUseCallbackListTab.productCount.render.test.jsx`（11-23） | 清单 tab 产品下拉计数回潮"从 scopedItems 输入记录计数"（应为 buildPostUseCallbackLists 产出聚合）；源码层锚 allLists 数据源 + 渲染层喂真实输入断言产出计数；红绿自证 |
| 无消费死代码守卫 | `src/lib/deadHookBindingGuard.test.js`（11-25） | hooks 绑定（useState/useMemo/useCallback/useRef）文件内零引用——重构吞掉消费端后"声明仍活"的残骸形态（万投比 tab 丢失 72 天复盘产物）；内嵌 c5e92f3 历史 bug 形态红证 + 豁免清单登记制；红绿自证 |

守卫清单以本 README 为登记表——**新增守卫时在本表登记一行**（名称 / 文件 / 拦截什么）。
Vitest 守卫随 `npm test` 在 CI 运行；审计脚本需按需显式执行，未接入 CI 的脚本不应视为自动拦截。

## 维护约定

1. **新约定落点**：用户确认需要落文档后，登记进本目录对应主题文档（带出处日期 + 先例 + 守卫名），再考虑代码化。
2. **文档更新授权**（2026-09-11 用户约定）：用户在当前任务明确要求修改文档时，直接执行；仅代码修改间接涉及文档同步时，先说明具体需调整的内容并询问用户，获得授权后再改。
3. **复核以代码 + 日志为真源**（2026-09-11 用户约定）：文档可能滞后于代码；验证信息是否准确以实际代码和运行日志为判据，文档仅作参考。
4. 若本地存在 `.workbuddy/memory/`，可作过程追溯；它不入库，不能作为协作者执行约定的必备前提。本目录是**入库版约定**，记忆是过程性的（日志），约定是规范性的（本目录）。

## 相关但不在本目录的内容

- 设计文档（DESIGN-*）、UAT 报告、验证报告：`docs/` 根目录，一事一文。
- 通用工程复盘方法在个人全局技能中维护；本目录仅维护已确认的项目约定与守卫索引。
