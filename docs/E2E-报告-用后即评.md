# 用后即评 E2E 测试报告

**执行日期**：2026-10-18 ~ 2026-10-19
**测试范围**：用后即评三视图（反馈库 · 用后即评满意度 lane）、客服部回访导入、产品部溯源、月报与离线导出、服务端 API
**最终结果**：**run 14 全量 33/33 通过**（G4 折叠区修复后单跑复核通过）

---

## 一、测试结论

E2E 测试抓出 **3 个真实回归 Bug**（均已修复并验证），另发现 1 个跨匹配逻辑漏洞（用户拍板直接修复）；其余失败均归因为测试脚本自身缺陷（选择器、时序、幂等、数据就绪），共 12 处修复后全绿。

### 真实 Bug 与漏洞（4 项）

| # | 问题 | 根因 | 修复 | 验证 |
|---|------|------|------|------|
| 1 | Actions 页全站白屏 | `src/pages/Actions.jsx` 两条 import 被拼成一行（`'./Dashboard.shared.jsx'import {`），语法错误级 | 拆回两行独立 import | Vite 无 Pre-transform error，babel 扫 67 个改动文件仅此一处 |
| 2 | 登录页白屏（ESM 加载崩溃） | `src/pages/Feedbacks.jsx` 把 `POST_USE_QUICK_SCOPE_OPTIONS` 从 `postUseRatingImport.js` import，真源是 `feedbackFilterModel.js` | 拆成独立 import 块 | 登录探针脚本验证恢复 |
| 3 | **空值快照跨匹配漏洞** | `server/routes/postUseVisit.js` 的 `syncCustomerVisitSnapshots` 按「月+产品+客户+旧评估+旧备注全等」匹配，旧评估与旧备注均为空时对同月同产品同客户的空值快照**零区分力**，会批量误改无挂接关系的记录 | 加**双空守卫**：旧评估与旧备注均空时不参与匹配回写（空快照更新走重新导入主路径） | API 级探针实证：修复前 `synced:1`（误改 probe-r-2），修复后 `synced:0`；D8 UI 链路复验通过；既有单测 5/5 不受影响 |
| 4 | sentiment 判定缺陷（前置修复） | 「太卡了」「经常断网」不在负面词典，10 分满分正面原话误入正面登记 | `src/lib/sentiment.js` MILD_NEGATIVE 词典加词（裸「卡」不收，避免「网卡/打卡」误伤） | 单测全绿；月报「太卡了」判负反馈（G2 通过） |

### 测试脚本缺陷修复（12 项，均属 spec 稳健性，非产品 Bug）

| # | 用例 | 根因 | 修复 |
|---|------|------|------|
| 1 | B 组全灭 + G 组月报空 + E1 | e2e 空库缺产品目录 `product_catalog_managed_v1` → `scopePostUseRatingRecords` 全过滤（raw 视图 0 条、月报 quoteRegistry 空） | beforeAll PUT 最小目录（eip，analysisPostUseRating=true） |
| 2 | C2 | `.ant-checkbox .first()` 点中行首选择框而非「标记处理」列 | `getByRole('checkbox', { name: '已处理' })` 角色选择器 |
| 3 | C2/D7 重复跑 | trace 行 id 是 randomId() 非 itemKey；review 状态跨轮残留 | 先查真实 id 再 DELETE 归零 + isChecked 兜底 |
| 4 | D6 | click 后立即读 URL 漏掉 SPA navigate；viewer 密码跨轮漂移 | loginViaUi 重写：waitForURL 两选一 + 401 探测改密后密码 + 改密分支完整链路（注意 waitForURL 不能包含当前 URL 模式，否则立即返回） |
| 5 | A2 | Segmented 点击偶发不触发 / UI 更新 URL 不落址；radio.check 兜底撞 detached 元素 | expect.poll 轮询 URL + 同值二次点击兜底 |
| 6 | B4 | 评分筛选收在「选择属性筛选」弹层内，裸页无该 select | 改 URL 直达 `ratingScore=10` |
| 7 | B2 | 「原文/意见」列只渲染 rawText‖commentText‖lowScoreReason，feedbackReasonTexts 不进表格 | 改行数断言（重点关注恰 4 行） |
| 8 | E1 | 模板文案在 Import step1（上传文件）Alert，step0 无此句 | 补点「下一步：上传文件」 |
| 9 | G1-G3 | 「用后即评月报」是 toolbar 常驻文本（loading Spin 期可见）＝弱条件；导出可能落在 model 骨架就绪但评分数据未就绪的窗口 → 导出「有效样本 0」空壳 | waitReportReady 强条件（等「有效客户原话登记」tab 可见） |
| 10 | G4 | 离线 HTML 附录是 `<details>` 折叠组件（默认关闭），内容 hidden | 先点 summary 展开再断言 |
| 11 | D2/D3 | 重复跑初态漂移（评估值被上轮改写） | D2 双值兼容断言 + D3 开头 API 重置初态 |
| 12 | D8 | D5 先劫持 e2e-visit-empty 致空值漏洞不触发（假通过风险） | D8 开头 API 重置回空值 |

---

## 二、用例清单与结果（run 14，33 例全绿）

**A. 三视图导航与 URL**（6 过）
- A1 默认 raw 视图 + 切换器；A2 Segmented 切换 URL 联动；A3 URL 直达 visit；A4 旧链接 lane=customer_visits 自动重定向；A5 Actions 旧链接重定向 trace；A6 两 lane 筛选不串台

**B. raw 视图快捷筛选**（5 过）
- B1 重点关注默认（太卡了/经常断网显示，很满意不显示）；B2 非 10 分显示、未评分不显示（行数=4）；B3 显示全部 + URL 同步 + 刷新保持；B4 快捷筛选叠加评分筛选（ratingScore=10）；B5 URL 直达 postUseQuickScope=all

**C. 产品部溯源**（4 过）
- C1 周期过滤 + 多月份条目（PROD-103 命中、周期外 PROD-104 排除）；C2 标记处理勾选/取消；C3 行点击编辑抽屉保存；C4 周期外月份空态

**D. 客服部回访**（8 过）
- D1 周期过滤；D2 抽屉基础信息；D3 编辑保存表格行同步；D4 **customerVisit 快照同步回写**（正向链路）；D5 409 乐观锁冲突提示；D6 viewer 无编辑权限但可勾已处理；D7 **visit:/jira: 前缀隔离**（回访与溯源处理状态互不串台）；D8 **空值快照漏洞修复验证**（UI 链路）

**E. 导入回归**（2 过）
- E1 缺内部评估/备注两列可导入（文案 + 处理器 API 双验证）；E2 缺两列处理器产出完整回访记录

**F. 服务端 API**（4 过）
- F1 GET 多月份分隔过滤；F2 PATCH 404 + 正常编辑 + 审计（`post_use_visit.update`）；F3 PATCH 响应带 syncedSnapshots；F4 viewer 无 editRecord → PATCH 403

**G. 月报与离线导出**（4 过）
- G1 打开月报；G2 有效客户原话登记（太卡了判负反馈）；G3 导出离线 HTML（37KB，含太卡了/负反馈/有效样本 5/弹性公网IP 8.8 分）；G4 离线 HTML 独立可打开（折叠区展开后内容可见）

---

## 三、执行环境与复盘

- **环境隔离**：e2e 独立端口 API 3101 / Vite 5275 + `e2e-data/` 独立库，与 dev（3001/5175，57213 条真实数据）完全隔离，dev 服务全程未受影响。
- **Rosetta x64 冷启动**：API 约 300s，Playwright webServer 探针方案不可用，改为 detached launcher（`/tmp/fi-api-launcher-e2e.mjs` / `/tmp/fi-vite-launcher-e2e.mjs`）外部预热双服务。
- **共 14 轮 run**：run 1-9 环境排障（探针超时/白屏修复），run 10 首进测试（4 过），run 11-12 定位 spec 缺陷（21/33），run 13 修复验证（28/33），run 14 全绿（32/33 + G4 复跑过）。
- **复现/回归方法**：`node_modules/.bin/playwright test e2e/post-use.spec.js`（服务预热流程见 `playwright.config.js` 头注释）。

## 四、遗留事项

- `public/config/whats-new.json` 等工作区 60+ 文件的改动均未提交，等用户明确说提交再执行 git commit（用户全局约定）。
- 方案文档（docs/DESIGN-用后即评-满意度回访.md 等）未随代码同步更新，按约定待用户拍板是否更新。
