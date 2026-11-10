# DESIGN · API 巡检（产品重点 API 巡检）

状态：设计定稿（2026-11-07 主路径；11-09 Plan B §9 邮件拉取；11-10 Plan C §10 WorkBuddy 数据代理+诊断中继，实施未开始）。Plan A/B 已实现，Plan C 待实施。

需求来源：`data/API 巡检/API 监控问题闭环管理.md`；规则参考：`data/API 巡检/平台规则底稿.md`；MCP 对接：`data/API 巡检/云网工作台通用智能体能力发布说明V1.0.docx`；接口清单：`data/API 巡检/指标清单.xlsx`。

导航与路由已就位：左导航「API巡检」组（总览 `/api-patrol/overview`、异常接口溯源 `/api-patrol/failures`），占位页已上线（2026-11-06 改版）。

---

## 1. 总体架构

```
外部系统 ──定时推送──→ 81 反代 ──→ Fastify /api/patrol/push*（API Key 鉴权）
                                      │
外部系统 ──邮件──→ IMAP 邮箱 ──→ 平台 09:15 定时拉取（Plan B，§9）
                                      │
                        ┌─────────────┴──────────────┐
                  统计表（日粒度）                请求明细（天×池×包 批次）
                        │                                │
                        │         ┌──────────────────────┤
                        │         │ 入库时按注册表归属产品（未登记→启发式+告警）
                        │         ▼
                        │    失败压缩组（1h 链式并组）
                        │         │
                        │         ▼
                        │    诊断任务（异步，服务端 MCP Client → cni.api.mcp）
                        │         │ final_conclusion
                        │         ▼
                        │    根因分类（有序规则表 L1/L2，前端可维护）
                        │         │
                        ▼         ▼
                  前端两页：异常接口溯源（列表+失败请求+处理闭环抽屉）
                           总览（AI 综述/根因分布/趋势）
```

处理链：统计成功率<100% → 下钻明细失败 → 压缩去重 → MCP 诊断 → 根因归类 → 产品侧处理闭环。

---

## 2. 数据库表设计（5 表 + 2 meta）

库：SQLite（server/data/auth.db，与 records/meta 同库）。建表进 `businessDb.js` 初始化序列。

### 2.1 api_patrol_stats（外部推送·异常接口统计）

| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK AUTOINCREMENT | |
| stat_date | TEXT NOT NULL | YYYY-MM-DD，批次参数注入 |
| product_key | TEXT NOT NULL | eip/vpc/slb，批次参数注入（统计表文件夹名映射） |
| pool_name | TEXT NOT NULL | 资源池全名（如 华北-北京3）；展示可去大区前缀（底稿3.4） |
| metric_name | TEXT NOT NULL | 指标名称 |
| api_path | TEXT NOT NULL | 接口名称（EIP/VPC 路径形态；ELB L7POLICY/CREATE 形态） |
| biz_type | TEXT NOT NULL | 业务类型 |
| success_rate | REAL NOT NULL | 百分数 88.89（原 "88.89%"） |
| duration_normal_ratio | REAL | "-"" → NULL，否则 87.5 |
| avg_duration | TEXT | 原文 "29.27s"（当前全 s 单位，仅展示；趋势图需要时再加数值列） |
| created_at / updated_at | TEXT | |

- **UNIQUE(stat_date, product_key, pool_name, api_path, metric_name)**：重推覆盖（幂等）——metric_name 入键防止"同一接口路径多个指标名称"场景（如 绑定云主机/绑定裸金属/绑定虚拟网卡 共享 `/acl/v3/floatingip/bind`）静默丢数据
- 外部推送阈值以外部为准（99.5% 过滤口径由外部决定，我们不做区间补算）

### 2.2 api_patrol_requests（外部推送·请求明细，归一表）

EIP/VPC 13 列与 ELB 14 列两种 CSV 归一；**四字段保留入库**（appId/dailyReport/realtimeReport/endTime，2026-11-06 拍板）。

| 列 | 类型 | EIP/VPC 来源 | ELB 来源 |
|---|---|---|---|
| id | INTEGER PK | | |
| external_row_id | INTEGER | id | id |
| request_date | TEXT NOT NULL | 批次注入 | 批次注入 |
| pool_name | TEXT NOT NULL | 批次注入（文件名） | 批次注入 |
| product_key | TEXT NULL | **平台判定**（注册表/启发式）；空接口名行允许 NULL（空 requestMapping 时归属无从判定，底稿3.1） | 固定 slb |
| request_id | TEXT NOT NULL | requestId | requestId |
| api_path | TEXT NOT NULL | requestMapping | resourceType/resourceOperation |
| user_id / user_name | TEXT NOT NULL | 原值 | 原值 |
| is_success | INTEGER NOT NULL | result 0/1 | resultStatus FAILED→0 SUCCESS→1 |
| duration_ms | INTEGER | executionTimeMillis | 同左 |
| request_time | TEXT NOT NULL | createTime | startTime |
| end_time | TEXT | — | endTime（冗余保留） |
| biz_category / biz_target / biz_no | TEXT | 原值 | NULL |
| error_message | TEXT | NULL | errorMessage |
| pushed_diagnose | TEXT | diagnoseResult 原文 | 同左（外部碰巧推来才存，设计不依赖） |
| app_id | TEXT | appId（样例恒空仍保留） | NULL |
| daily_report / realtime_report | TEXT | NULL | 原值（样例恒空仍保留） |
| created_at | TEXT | | |

- **UNIQUE(request_date, pool_name, request_id)**：重推覆盖（requestId 样例 8398 全局零重复，组合键防御同日重推+跨池异常）
- 索引：`(request_date, product_key, api_path)`（重算成功率/下钻）；`(request_date, api_path, pool_name, user_name, request_time)`（压缩扫描）
- 空接口名行不入统计但入库保留（底稿3.1）；空 requestMapping 时 product_key 允许 NULL

### 2.3 api_patrol_failure_groups（平台生成·失败压缩组 ★页面"失败请求"行）

| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| group_date | TEXT NOT NULL | 压缩窗口归属日（自然日，不跨日） |
| product_key / pool_name / api_path | TEXT NOT NULL | 组维度（压缩键含池） |
| metric_name | TEXT NOT NULL | 组创建时按注册表冻结（与 customer_type 同原则：注册表后续改名不漂移，列表展示不 join） |
| user_name | TEXT NOT NULL | 压缩键（userName↔userId 218↔218 一一对应，取 userName） |
| first_request_id | TEXT NOT NULL | 首条 RequestID（MCP 诊断用） |
| first_request_time | TEXT NOT NULL | |
| pre_compress_count | INTEGER NOT NULL | 压缩前次数（仅1条时仍为1） |
| suppressed_request_ids | TEXT NOT NULL DEFAULT '[]' | 被压缩 requestId JSON 数组；单条时存 "[]" |
| customer_type | TEXT NOT NULL DEFAULT '' | 弱标签制：仿真（cmic_ 或 cmic 前缀，忽略大小写）/ 测试账号（含 test/ceshi/demo）/ **空**（其余无标记）。仅展示与筛选维度，**不影响产品侧处理判定**（待处理/— 由根因规则驱动）；底稿 4.2 其余启发式不实现。创建时冻结（2026-11-07 终版拍板） |
| root_cause_l1 / root_cause_l2 | TEXT | 诊断后回填（初始 NULL = 未诊断，列表不 join diagnoses） |
| product_action_status | TEXT NOT NULL DEFAULT 'pending_diagnosis' | pending_diagnosis→(诊断完成后) 根因映射值；待处理/处理中/已处理/— |
| assignee | TEXT | 默认产品目录 owners.productManager[0]，可改，改后不跟随 |
| root_cause_confirmed | TEXT | 属实/不属实（产品侧反馈） |
| measure_feedback | TEXT | 举措及排期说明（不涉及也需说明） |
| feedback_by / feedback_at | TEXT | |
| created_at / updated_at | TEXT | |

- **UNIQUE(group_date, product_key, pool_name, api_path, user_name, first_request_id)**
- **压缩规则（2026-11-06 拍板）**：键=(日期, 客户userName, 池, 接口)；按时间排序，**相邻间隔 ≤1 小时链式并组**；每组取首条 RequestID 查 MCP，记录压缩前次数
- **重推带回（拍板）**：组重建后按 (日期,池,接口,客户) 匹配旧组且**唯一**时带回人工状态（处理状态/经办人/反馈）；多候选/不匹配不带并**告警**，绝不静默乱挂
- 处理闭环语义：提交→已处理；暂存→处理中（不标已处理）；根因映射判"—"的类**诊断完成后即为**"—"（不需要产品侧处理；诊断完成前的窗口期为 pending_diagnosis）

### 2.4 api_patrol_diagnoses（平台回填·MCP AI 诊断，异步）

| 列 | 类型 | 说明 |
|---|---|---|
| id | INTEGER PK | |
| failure_group_id | INTEGER NOT NULL | FK → groups.id |
| request_id | TEXT NOT NULL | 实际查询的 RequestID |
| status | TEXT NOT NULL | pending/success/failed（可重试状态机） |
| tool_name | TEXT | 默认 log_search（留可配） |
| mcp_raw_response | TEXT | MCP 返回原文 |
| final_conclusion | TEXT | final_conclusion → 无则 conclusion → 解析失败截前800字 |
| root_cause_l1 / root_cause_l2 | TEXT | 规则表归类结果 |
| diagnosed_at | TEXT | |

- 独立表：MCP 调用异步、失败重试与展示层解耦；重跑诊断不动 groups 处理字段

### 2.5 meta：注册表与根因规则（对象与标签模块维护）

- `api_patrol_api_registry_v1`：产品接口注册表（34 项种子，§5）
- `api_patrol_root_cause_rules_v1`：接口失败根因分类有序规则表（17 条种子，§6）
- 种子灌入走 **migration 标记**（`migrate_api_patrol_registry_v1` / `migrate_api_patrol_root_causes_v1`，对齐 migrate_builtin_journeys_v2 惯例：启动检查标记→无则灌入→打标记；幂等，本地/部署环境自动生效）

---

## 3. 推送 API 契约（外部系统 → 平台）

### 3.1 端点与批次

| 端点 | 说明 |
|---|---|
| `POST /api/patrol/push/stats` | 异常接口统计 |
| `POST /api/patrol/push/requests` | 请求明细 |

- 走**现有 81 入口反代**；连通性自检端点 `GET /health`（免鉴权现成）
- **批次粒度 = 日期 × 资源池 × 包类型**（与外部现有文件粒度一致），单批期望 <1MB、硬上限 5000 行/16MB（路由级 bodyLimit 显式声明，不依赖全局 12MB；联调须确认 Nginx client_max_body_size ≥16m）

### 3.2 请求体

```
POST /api/patrol/push/stats
Authorization: Bearer <apikey>
{
  "product": "弹性公网IP",          // eip/vpc/slb 的中文名（外部目录口径）
  "date": "2026-08-10",
  "rows": [
    { "资源池": "华南-广州3", "指标名称": "订购", "接口名称": "/customer/v3/order/create/floatingip",
      "业务类型": "订购", "成功率": "88.89%", "正常比例": "87.5%", "时长均值": "29.27s" }
  ]
}

POST /api/patrol/push/requests
{
  "package": "eip_vpc" | "elb",     // EIP/VPC 混装包 or ELB 包
  "date": "2026-08-10",
  "pool": "华南-广州3",
  "rows": [ /* 原样保留两种 CSV 的全部行字段 */ ]
}
```

- CSV 列名原样作 JSON key（联调零映射成本）；契约附录写明 EIP/VPC 13 列、ELB 14 列字段清单
- **产品归属判定**：package=elb → 固定 slb；eip_vpc → 逐行按注册表（§5），未登记走启发式+告警
- **产品名称映射**：复用现有产品目录 `product_catalog_managed_v1`，不另建映射表（已对照《产品规格配置》导出验证：弹性公网IP→eip、虚拟私有云→vpc、弹性负载均衡→slb 三者 name 一字不差且均启用）。解析顺序：① 按产品目录 `name` 精确匹配取 `key`；② 未命中再按 `key` 匹配（eip/vpc/slb 直接推英文 key 也可，防运营改产品名断链）；③ 双未命中返回 400 显式错误（不静默缺省）。对推送方零影响（映射全在平台侧）
- **入参校验**：payload 顶层字段（product/date/package/pool/rows）缺失返 400；rows 数组为空 = 正常（不报错）；CSV 列名校验：未知列名丢弃并日志告警（不打回整批）

### 3.3 鉴权（2026-11-06 复核定稿）

**复用平台 API Key 体系**（非独立 token——middleware.js 全局 preHandler 对 /api/* 强制鉴权，独立 token 需在安全架构开洞，否决）：

- 给外部系统签发 API Key，新增 scope `patrol:push`，仅放行两个推送端点
- Bearer 头透传，反代联调验证一次 Authorization 透传
- 白送能力：吊销/过期/审计联动（audit_log 自动记录推送方）
- **Scope 执行**：推送路由加 preHandler 校验 `request.apiKey.scopes` 含 `patrol:push`（参照 `mcp.js` 的 `mcp:full/mcp:read` scope 校验先例）

### 3.4 语义

- **幂等**：唯一键 upsert，后到覆盖；重试安全（契约写明）
- 响应：入库摘要 `{ received, inserted, overwritten, ignored }`；不在此同步做诊断（诊断异步）
- 推送成功率字段信任外部，平台不重算校验入库（审计页可后置做 0.05pp 对账提示，非阻塞）

### 3.5 边界行为（避免“文档没写实施就踩”）

| 场景 | 处理 |
|---|---|
| stats 有对应行但 details 当日无数据 | 异常接口列表显示成功/失败次数均为 0（不 crash），页脚提示“暂无对应明细数据” |
| details 有失败行但 stats 无对应接口行 | 明细行入 requests 库但**不参与压缩/诊断/溯源列表**——平台以外部推送的统计表为“关注清单”口径。总览页不全量显示未关注失败，溯源页过滤列表中加一行「未关注失败已入库、不在当前列表」脚注 |
| rows 数组为空 | 正常响应（{ received: 0 }），不报错 |
| 同批次内字段类型错误（如成功率非数字） | 该行跳过并计入响应 `ignored`，不打断整批 |
| 重复 requestId 在同一批次内 | 后者覆盖前者（同批次内去重），响应 `received` 计去重后行数 |

---

## 4. 压缩、诊断与 MCP 对接

### 4.1 压缩（生成 failure_groups）

**触发**：压缩为**显式动作**——同一天所有推送批次落库后，手动或定时触发一次性压缩整个日期的失败行为（非推送即触发，避免重推竞态）。重推后需重新压缩同日数据（覆盖写入）。

**算法**：取当日失败行（明细本身已被外部按 99.5% 口径过滤——样例实测 21 个池×接口组合全部 <99.5%，统计 ⊆ 明细成立；压缩在关注清单范围内自然生效）→ 键=(date, userName, pool, api) 分组 → 组内按时间排序 → **相邻间隔 ≤1h 链式并组** → 组数 = MCP 查询数 → 组记录 pre_compress_count + suppressed_request_ids。组内 metric_name 按注册表冻结写入。

**status 流转**：新组初始 `pending_diagnosis` → 诊断完成 → 根因映射值。单条失败（仅1条）suppressed="[]"、pre_compress_count=1。

**重推重建**：新组覆盖写入（唯一键 upsert），旧 diagnoses 成为孤儿（FK 关联的旧 group 行被覆盖，不影响功能；新组重建后自动触发新诊断任务）。人工状态按 (日期,池,接口,客户) 带回（§2.3）。

### 4.2 MCP 诊断（服务端直连，2026-11-06 定稿；2026-11-09 实测契约校准）

- 平台 API 服务端实现轻量 MCP Client（JSON-RPC over **Streamable HTTP**——请求必须带 `Accept: application/json, text/event-stream` 双协议头，缺头 400）
- **端点（2026-11-09 官方口径，实测已通）**：`http://cni.mcp.server:31788/mcp-server/mcp`（部署机 hosts 需含 `10.234.188.68 cni.mcp.server`）；端点与 token **配置链（2026-11-07 定稿）**：admin/process 显式传参（测试覆盖用）> 库配置（meta `api_patrol_mcp_config_v1`，Settings「产品API日志诊断配置」面板维护，与 llm_config_v1 同构：通用 meta GET 禁明文/PUT 留空保留 token/专属审计动作/脱敏 GET）> 环境变量 `PATROL_MCP_ENDPOINT` / `PATROL_MCP_TOKEN`。token 在云网工作台自助生成（通用智能体 → 设置 → MCP 工具面板）；生产建议申请服务级 token
- 工具：`log_search`（真实 schema：必填 startTime/endTime（yyyy-MM-dd HH:mm:ss）/productName 枚举/poolName 枚举；**无 requestId 参数**——requestId 走 filter 关键字）/ `log_search_full_param`（全参版）
- 调用参数（11-09 实测定稿）：时间窗=组首条 ±30 分钟、productName 映射（eip/vpc→`fip/vpc`、slb→`slb-console`）、poolName、filter=组首条 requestId
- **并发控制**：诊断 worker 最大并发 N=3（默认，可配），队列 + 失败重试退避；超时对齐官方 `tool_timeout_sec=300`；`result.isError=true`（如下游平台 412/500）按失败处理保重试；单个调用失败进 diagnoses.status=failed 可重试
- 诊断仅对压缩组首条 RequestID 执行（需求原文）
- 日志时效：平台保留期有限（实测 3 个月前的 8 月样例查不到、412 下游失败）——**诊断应近实时触发**，隔月补诊断会全落"日志缺失"

### 4.3 诊断文本 → 根因分类

输入构造（底稿硬规则）：`final_conclusion` → 无则 `conclusion` → 解析失败截前 800 字；**ELB 拼 errorMessage**（前 40 字不在诊断中才拼）；值为字符串 `"null"` 视同空。

---

## 5. 产品接口注册表（对象与标签·新Tab「产品接口」）

### 5.1 结构

meta `api_patrol_api_registry_v1`，字段：`product_key`(eip/vpc/slb)、`metric_name`(指标名称)、`api_path`(接口名称)、`biz_type`(业务类型)、`inferred`(bool 推断项标注)、备注。**无"接口时长正常值"字段**（2026-11-06 拍板删除；正常比例由外部算好推送）。

前端：表格 CRUD，`can('manageTags')` 可编辑；「待登记」分区收启发式告警中的未登记接口，核对后一键转正。编辑只影响之后推送，存量不回溯（拍板）。

未登记接口告警持久化：meta `api_patrol_unregistered_apis_v1`（去重数组），每次推送时启发式未匹配的接口追加到此键；运营在「待登记」分区核对后逐条转正时从数组删除。

### 5.2 种子 34 项（2026-11-07 全量核验定稿；实施时发现 C1 实为 10 项非 8）

**A. 样例统计表全集 18 项**（92 行全量机器扫描，文件哈希零重复）：

| 产品 | 指标名称 | 接口 | 业务类型 |
|---|---|---|---|
| eip | 绑定 | /acl/v3/floatingip/bind | 绑定 |
| eip | 解绑 | /acl/v3/floatingip/unbind/{ipId} | 解绑 |
| eip | 订购 | /customer/v3/order/create/floatingip | 订购 |
| eip | 退订 | /customer/v3/order/delete | 退订 |
| eip | 移入共享带宽 | /customer/v3/sharedBandwidth/addExistFip | 更新 |
| vpc | 创建子网 | /customer/v3/network | 新增 |
| vpc | 创建虚拟网卡 | /customer/v3/port | 新增 |
| vpc | HA VIP-绑定 | /acl/v3/havip/bind | 绑定 |
| vpc | HA VIP-解绑 | /acl/v3/havip/unbind | 解绑 |
| slb | 创建7层访问策略 | L7POLICY/CREATE | CREATE |
| slb | 更新7层访问策略 | L7POLICY/UPDATE | UPDATE |
| slb | 创建负载均衡 | LB/CREATE | CREATE |
| slb | 创建后端服务器 | MEMBER/CREATE | CREATE |
| slb | 删除后端服务器 | MEMBER/DELETE | DELETE |
| slb | 创建后端服务器组 | POOL/CREATE | CREATE |
| slb | 更新后端服务器组 | POOL/UPDATE | UPDATE |
| slb | 删除后端服务器组 | POOL/DELETE | DELETE |
| slb | 更新监听器 | LISTENER/UPDATE | UPDATE |

**B. 样例明细独有 3 项**（统计表未出现，<99.5% 未触发；真实数据会遇到）：vpc 删除子网 `/customer/v3/network/preDelete/{networkId}`(删除)；slb 删除负载均衡 LB/DELETE(DELETE)；slb 续订负载均衡 LB/RENEW(RENEW)。

**C1. 指标清单补充 10 项**（清单有、样例无；格式修正：补 `/`、单斜杠）：
- eip：变更带宽 /customer/v3/order/change/floatingip(变更)；续订 /customer/v3/order/renew(续订)；移出共享带宽 /customer/v3/sharedBandwidth/removeFIP/{ipId}(移出)
- vpc：删除虚拟网卡 /customer/v3/port/preDelete/{portId}(删除)；网卡-绑定云主机 /acl/v3/port/attachServer(绑定)；网卡-解绑云主机 /acl/v3/port/{portId}/detachServer(解绑)；网卡-批量配置辅助私网IP /customer/v3/port/secondaryIp/assign/batch(配置)；网卡-删除辅助私网IP /customer/v3/port/secondaryIp/unassign(删除)
- vpc：创建HA VIP /acl/v3/havip(创建)；删除HA VIP /acl/v3/havip/{havipId}(删除)

**C2. ELB 语义映射推断 3 项**（推断项 inferred=true，待真实推送校验）：slb LISTENER/CREATE(创建监听器)；slb LISTENER/DELETE(删除监听器)；slb LB/UNSUBSCRIBE(退订负载均衡，操作码为占位——清单原文 `/acl/v3/order/loadBalancer` 退订，真实推送形态待验后修正)。

**不录**：指标清单 ELB sheet 的 9 条 URL 路径形态条目（/acl/v3/listener 等）——与推送形态（资源类型/操作）不同体系，录了无法命中（拍板：注册表以样例形态为准）。

---

## 6. 接口失败根因分类（对象与标签·新Tab「接口失败根因分类」）

### 6.1 架构

两级：**L1 失败机制大类**（7 个封闭集）× **L2 具体场景**（开放集）。有序关键词规则表，先命中先返回，配置驱动。**产品侧处理映射挂 L2 行**（L1 提供默认值，L2 可覆盖；2026-11-07 拍板）。前端展示与统计按 L1 聚合，失败请求钻取按 L2。

| L1 | 语义 |
|---|---|
| 业务冲突 | 客户业务规则不满足 |
| 配额不足 | 配额/订购限制 |
| 资源锁定/并发冲突 | 并发/锁定 |
| 参数无效/校验失败 | 客户传参错误 |
| 资源状态异常 | 资源处于非正常态 |
| 诊断能力缺口 | 诊断/数据能力问题 |
| 其他/未归类 | 兜底 |

### 6.2 规则表种子（17 条，按匹配顺序；2026-11-07 v3 FINAL 定稿）

| 序 | L1 | L2 | 命中条件 | 产品侧 |
|---|---|---|---|---|
| 1 | 业务冲突 | DNAT规则冲突 | 含 `DNAT` | 待处理 |
| 2 | 诊断能力缺口 | 日志缺失/无数据 | `缺少后续`/`日志不完整`/`日志查询异常`/`无数据` | — |
| 3 | 诊断能力缺口 | 日志无ERROR/WARN | `按 ERROR/WARN 条件过滤后未发现` | — |
| 4 | 配额不足 | HAVIP数量上限 | `配额`+（超限/用完/不足/用尽/耗尽/订购限制/达到上限/QUOTA）且 HAVIP | — |
| 5 | 配额不足 | 通用配额 | `GLOBAL_BANDWIDTH`，或 `配额`+（超限/用完/不足/用尽/耗尽/订购限制/达到上限/QUOTA） | — |
| 6 | 资源锁定/并发冲突 | 并发进行中 | 锁定/冲突/IS_LOCKING 或（正处于+绑定/解绑），且 正在执行/正在进行/并发 | **—** |
| 7 | 资源锁定/并发冲突 | 锁定机制待查 | 锁定/冲突/IS_LOCKING（序6未命中） | **待处理** |
| 8 | 业务冲突 | 资源被他人占用 | `回收站`/`BELONGS_TO_OTHERS` | 待处理 |
| 9 | 参数无效/校验失败 | IP/资源ID/地址类 | （ipId/IP ID/浮动IP/IP地址/IPv4地址/可用区）+（不存在/无效/null/已被占用/不在子网/为空/空字符串/命名规则） | — |
| 10 | 参数无效/校验失败 | 域名与比较类型成对 | `hostNameCompareType`/`PolicyDomainName`/`l7PolicyDomainName`/`要么都为空` | — |
| 11 | 业务冲突 | HAVIP绑定业务校验 | `HA VIP`/`havip`/`HAVIP`（序4未命中） | 待处理 |
| 12 | 业务冲突 | 重复/批量删除异常 | `重复执行`/`deleteNet` | 待处理 |
| 13 | 诊断能力缺口 | 仅WARN结论不明 | `WARN`+（未明确/可能） | — |
| 14 | 资源状态异常 | 负载均衡器本体 | `负载均衡器`+（正在更新/状态不正常/非ACTIVE/更新中） | 待处理 |
| 15 | 资源状态异常 | 监听器 | （监听器/listener）+（不存在/无效/状态） | 待处理 |
| 16 | 资源状态异常 | 后端服务器组 | （pool/后端组/负载均衡池）+（不存在/无效/状态） | 待处理 |
| 17 | 业务冲突 | 绑定关系未解除 | `存在绑定关系`/`UNBIND_THEN_DELETE`/`已绑定其他`/`NO_BOUND_EXCEPT_BANDWIDTH`/`重复绑定` | 待处理 |
| 兜底 | 其他/未归类 | 兜底 | 全未命中（恒末位、不可删、不可停用） | 待处理 |

### 6.3 样例全量回放验证（4097 条失败，2026-11-07）

| L1/L2 | 条数 | % | 产品侧 |
|---|---|---|---|
| 诊断能力缺口/日志缺失 | 1968 | 48.0% | — |
| 参数无效/域名成对 | 1786 | 43.6% | — |
| 资源锁定/锁定机制待查 | 113 | 2.8% | 待处理 |
| 资源锁定/并发进行中 | 96 | 2.3% | — |
| 业务冲突/绑定关系未解除 | 38 | 0.9% | 待处理 |
| 资源状态异常/负载均衡器本体 | 18 | 0.4% | 待处理 |
| 其他/兜底 | 16 | 0.4% | 待处理 |
| 配额不足/通用配额 | 16 | 0.4% | — |
| 业务冲突/HAVIP校验 | 12 | 0.3% | 待处理 |
| 诊断能力缺口/日志无EW | 11 | 0.3% | — |
| 参数无效/地址类 | 6 | 0.1% | — |
| 配额不足/HAVIP上限 | 5 | 0.1% | — |
| 诊断能力缺口/仅WARN | 5 | 0.1% | — |
| 资源状态异常/后端服务器组 | 2 | 0.0% | 待处理 |
| 业务冲突/资源被他人占用 | 4 | 0.1% | 待处理 |
| 业务冲突/DNAT | 1 | 0.0% | 待处理 |

**待处理合计 204 条 = 5.0%**（并发进行中 96 条被正确排除）。

### 6.4 底稿 15 条 → v3 兼容映射（历史报告对照用）

底稿15条行为全部保留（有序匹配/先命中先返回/DNAT先于锁定/ELB拼errorMessage/"null"视空）；类名重贴标签：规则1→(业务冲突,DNAT)；2/3→(诊断缺口,日志缺失)；4→(诊断缺口,日志无EW)；5→(配额不足,通用/HAVIP)；6→(锁定,并发进行中/机制待查 二分)；7→(参数无效,地址类)；8→(参数无效,域名成对)；9→(业务冲突,HAVIP校验)；10→(业务冲突,重复删除)；11→(诊断缺口,仅WARN)；12/13→(资源状态异常,监听器/后端组)；14→(诊断缺口,无诊断结论)；15→(其他,兜底)。

### 6.5 前端维护

Tab「接口失败根因分类」：有序规则表 CRUD + 拖拽排序 + 启用状态 + 结构化关键词编辑（组内 AND/组间 OR）+ 产品侧下拉 + 审计 + **存量不回溯**（与注册表同口径）。硬约束 UI 强制：DNAT 规则在锁定类前、兜底恒末位不可删、新规则插兜底前。第一版不做"保存前试跑"（后续可选增强）。

---

## 7. 前端页面

### 7.1 异常接口溯源 `/api-patrol/failures`（需求页面1）

筛选：时间范围（当天/近7天/30天/全部/自定义）+ 产品（全部/单个）。

**⓪巡检概况（页面顶部 AI 总结，2026-11-07 拍板：检测结果概况——尤其异常情况）**：`GET /api/patrol/failures/summary-facts`（随时间范围刷新）——facts 八项：覆盖概况（产品/资源池/异常接口数）、低于 99.5% 阈值数、失败请求总量（**与①列表同源**——计算抽 computeFailureInterfaces 单源，防文字与表格两张皮）、最差接口 Top3（含仿真标注）、失败最集中点（接口×L2×次数+仿真占比）、根因 Top3（L1 占比）、闭环状态（待处理/已处理/处理中/无需处理/未诊断/仿真组数）、环比上一等长周期（失败次数±/异常接口数±）；LLM 润色走 buildAiSummary 同款（**输出不含数字**、数字由前端 facts 锚点渲染、未配置/失败模板直出 degraded=true）；卡片底部关键数字胶囊（异常接口/失败请求/待处理/已处理）。

**①异常接口列表**：产品名称、资源池、指标名称、接口名称、业务类型、成功率、总次数、失败次数、时长正常比例、时长均值——总/失败次数从明细重算（拍板）；排序（2026-11-07 拍板更新）：**纯仿真/测试接口（该接口×池×窗口内失败组全为仿真/测试账号，前端打"仿真/测试"标签）排列表最后** → 成功率<99.5% 优先在前 → 其余<100% 按序展示；混合真实客户失败的接口有真问题、不后排只计入标签推导不遮挡。**跨日聚合口径（2026-11-07 拍板）**：时间范围为单日时展示推送原值；近7天/30天/自定义时——成功率与总/失败次数按明细 Σ 重算（加权口径），时长均值/正常比例跨日显示"—"（TEXT 原值不可聚合，趋势需求出现时再落数值列）。

**②失败请求列表**（= failure_groups 展示）：复合搜索（指标名称/接口名称/RequestID/压缩前次数/客户名称/根因L1/根因L2/人工处理状态/经办人）；人工处理状态筛选项集=**待处理/处理中/已处理/—/未诊断(pending_diagnosis)**，默认全部；列：RequestID、指标名称、接口名称、客户名称/编码、**根因分类（L1·L2 两级 Tag）**、AI 诊断文本（详情）、压缩前次数、产品侧处理状态、经办人。

**③详情抽屉**：诊断原文（MCP raw + final_conclusion）；产品侧反馈表单——根因是否属实（属实→举措及排期；不属实→反馈真实根因+举措排期；不涉及也需说明）；提交→已处理、暂存→处理中（需求原文语义）。**每次变更写 audit_log**（action=`api_patrol.group_update`，detail 含 groupId/changedFields/before/after——写入复用现有审计模块，读取改造延后：entity_id 列+过滤参数+窗口放开，数据从现在起留痕；拍板 2026-11-06）。

### 7.2 总览 `/api-patrol/overview`（需求页面2）

时间范围（近7天/近30天）+ 产品（全部/单个）。

**① AI 综述卡**（需求 2-(1)；设计细化 2026-11-07）：facts 驱动——服务端先算结构化 facts（总量/压缩率/各产品成功率/根因 L1 分布/待处理组明细/阈值命中/趋势变化），LLM 只做事实润色组句**不改数**；锚点由实体 ID 注入前端渲染为可点 span（四类锚点：根因 L1·L2→溯源页筛选、产品→总览原地切产品、产品×接口→溯源页该接口失败列表、异常信号→该指标趋势模块）；LLM 不可用降级模板直出；阈值常量（日成功率<95% 天数占比 >25%(7天)/>15%(30天)）脚注注明口径。

**② 根因分布**（需求 2-(2)）：堆叠柱状/表格切换——堆叠柱：X=产品、堆叠色块=L1 七类（固定色板）；表格：行=L1、列=产品+占比；点击色块/单元格跳转溯源页带 产品+根因 筛选；"含待处理/全部"口径开关；统计口径=失败压缩组，页脚提示"可能小于原始失败次数（压缩）"。**严重度双维度（2026-11-07 批判性复查补充）**：组数与**压缩前失败次数**（pre_compress_count 聚合）同时展示（表格列/柱高 tooltip）——实测样例中长链场景（8月7日广州3退订 197 笔失败仅压成 2 组），单看组数会掩盖严重度。

**③ 成功率非100%的指标趋势**（需求 2-(3)）：一指标一图（TrendChart 复用）。**缺天处理（2026-11-07 拍板：展示与推送口径一致）**：某指标某天不在统计表=当日未达推送阈值（≥99.5%），默认**缺天断线（connectNulls=false）、不默认100%、不自行补算**，图例注明"无数据=未达推送阈值"。**「含明细补算」开关**：开启后缺天用明细重算真值补点（口径：该接口当日有明细数据则重算 Σ成功/Σ总数；无明细数据仍缺线），补算点与推送点在图上视觉区分（如空心标记），图例注明"○=明细补算"——两口径不混淆。样例实测依据：明细是统计超集，69 个缺行单元明细重算全部=100%。

**④ 根因 L1 趋势**（需求 2-(4)）：多序列折线，X=日期（近7天），**七类全画**（2026-11-07 拍板，不做 Top 截断），图例可勾选显隐。

**⑤ 典型根因跨日轨迹**（需求 2-(5)）：近90天，**双形态可切换**（2026-11-07 拍板）——热力日历（行=L2 Top8 按近30天组数降序，列=日期，格子深浅=组数，点格子跳转溯源页带 L2+日期筛选）／折线形态（同数据源的时序曲线）；空态引导文案。

**数据支撑**：`GET /api/patrol/overview/cause-stats?range=7d|30d&product=all|<key>` 一次聚合返回 byProductCause/dailyTrend/l2Calendar/aiSummaryFacts；groups 表加 `(group_date, product_key, root_cause_l1)` 复合索引。图表组件放 `src/components/apiPatrol/`（CauseDistributionChart/CauseTrendChart/CauseCalendarHeatmap），各带渲染冒烟测试；L1 七类固定色板常量全页统一。

### 7.3 对象与标签新增 Tab

- 「产品接口」：§5 注册表维护（34 项种子已灌）
- 「接口失败根因分类」：§6 规则表维护（17 条种子已灌）

---

## 8. AI 巡检日报自动发送（2026-11-07 拍板定稿）

### 8.1 需求与复用

| 需求 | 方案 |
|---|---|
| 收件人群组前端配置 | 复用 `mail_groups`（Settings 邮件 tab 已有群组 CRUD），日报配置选择群组（多选，发送时合并去重） |
| 发件地址前端配置 | 复用 `mail_channels`：日报配置**选择发信通道（channelId）**——通道（SMTP+发件地址）在邮件 tab「发信通道」维护，发送按 `getMailChannelById(config.channelId)` 取；**不新增全局数据源枚举**（api_patrol 非用户反馈数据源，2026-11-07 实现期定案） |
| SMTP | 复用 `sendSmtpMail(channel, {to, subject, html})`（HTML 正文原生支持；测试走 `setMailTransportFactory` 注入） |
| 每天 10:30 自动发送（2026-11-09 拍板：由 09:00 后移，给 09:15 邮件拉取导入留出处理窗口） | **新建进程内定时器**（无 cron 依赖）：setTimeout 至次日 sendTime → 发送 → 重排；**启动自愈**——进程重启后当日未发且已过 sendTime 立即补发 |

### 8.2 配置与状态（meta）

- `api_patrol_daily_report_v1`：`{ enabled, groupIds[], channelId, sendTime('09:00'), includeQuiet(true), excludeSimTagged(false), maxInterfacesPerProduct(20) }`——前端面板维护，PUT 走 manageTags（与邮件 tab 配置同级）；channelId=日报所用发信通道
- `api_patrol_daily_report_state_v1`：`{ lastSentDate, lastSentAt, lastResult, lastError }`——**同日幂等**（定时触发时 lastSentDate=今日 → skip）；**手动"立即发送"=force 发送**（不受幂等限制，测试/补发用）；发送写审计 `api_patrol.daily_report_send`（收件人数/产品数/组数/结果）

### 8.3 邮件正文（程序生成 HTML，不占用 mail_templates——结构化表格不适合用户模板编辑）

- 主题：`【AI巡检日报】YYYY-MM-DD`（报告日=昨日）
- **报告窗口 = 昨日（T-1）全天**（数据按日落库，天然对齐）
- 按产品分块：
  - 失败请求 N 次（压缩 M 组）· **待产品侧处理 = product_action_status='待处理' 组**（"—"不进列表；**未诊断单列提示、不算待处理**）
  - 根因分布（L1 计数；待处理组内 L2 TopN）
  - 异常接口（N=实展数）表格：指标 | 资源池 | 业务类型 | 成功率 | 总次数 | 失败次数 | 标记——**成功率=stats 推送值**（展示与推送口径一致，不重算）、总/失败次数=单日明细 Σ；**排序：纯仿真/测试接口（该接口失败组全为仿真/测试账号）排最后 → <99.5% 优先 → 升序**（2026-11-07 拍板，与溯源页同源口径）；**行数上限默认 20**/产品（刷屏防护）；纯仿真行标记列显示「仿真/测试」（标题措辞+列序 2026-11-07 用户拍板：去"明细/Top"字样显实数、指标列提前、不含接口路径列）
- **仿真/测试流量默认不排除**，但**标记出来**（组行/汇总行带"仿真"/"测试"标记 + 末尾注明"其中仿真/测试流量 N 组"）；`excludeSimTagged=true` 可改为排除
- 无异常日：`includeQuiet=true` 发平静简报（稳定预期），false 则跳过发送
- 末尾：详情链接（`getPublicAppUrl()` + 溯源页带日期参数）

### 8.4 API 与前端

- `GET/PUT /api/patrol/report/config`（manageTags）；`POST /api/patrol/report/send`（manageTags，body `{force?}`）；`GET /api/patrol/report/status`（view）
- 前端：**Settings → 邮件 tab 新卡片「AI巡检日报」**——开关/群组多选/发信通道选择/时刻/两个开关/明细上限/「立即发送」按钮/上次发送状态；群组与通道维护用邮件 tab 既有面板

---

## 9. Plan B：邮件拉取导入（IMAP，2026-11-09 设计定稿）

### 9.1 定位与触发条件

Plan B 是外部 HTTP 推送不可用时的备用数据入口。外部系统将巡检数据以邮件形式发送到指定邮箱（`service@cmecloud.cn`→`zhouhuiling@cmss.chinamobile.com`），平台通过 IMAP 在每日 **09:15** 拉取当日邮件，解析后走**与 HTTP 推送相同的写入路径**（进程内直调，不走 HTTP+API Key 自签名回路——见 P0-4）。

| 路径 | 触发方 | 时机 | 数据格式 |
|---|---|---|---|
| Plan A（主）| 外部系统 | HTTP POST 推送 | JSON（stats + requests）|
| **Plan B（备）** | 平台主动拉取 | 每日 09:15 定时 | 邮件（HTML 正文 + ZIP 附件）|

- Plan A 和 Plan B 可并存（同一天先推后拉也不会冲突——入库走同一唯一键 upsert，后到覆盖）。
- 定时拉取在日报发送（10:30）之前，确保日报数据完整。

### 9.2 邮件格式（外部系统约定）

| 属性 | 值 | 说明 |
|---|---|---|
| 发件人 | `service@cmecloud.cn` | **发件人白名单——P0-1：非此发件人直接丢弃并审计告警** |
| 收件人 | `zhouhuiling@cmss.chinamobile.com` | |
| 主题格式 | `【API巡检报告】【MM月DD日】发现 N 款产品，共 M 条接口异常记录` | 从主题提取报告日期（月日→YYYY-MM-DD）与产品数 |
| 正文 | HTML 格式 | 按产品分块，每块以 `📦 产品：` 标记开头；内含异常接口统计表格（列：资源池/指标名称/接口名称/业务类型/成功率/正常比例/时长均值） |
| 附件 | 2 个 ZIP 文件 | EIP/VPC 包 1 个 + ELB 包 1 个；每个 ZIP 内含对应产品×池的 CSV 请求明细 |
| 数据日期 | 正文中标注 | 邮件标注"数据日期"优先取；无标注时按邮件发送日期 T-1（与日报窗口对齐） |
| IMAP 服务器 | `imap.cmss.chinamobile.com:993` | Coremail，SSL/TLS；auth code 独立于登录密码 |

### 9.3 拉取与解析流程

```
每日 09:15 定时触发（进程内 setTimeout，与日报调度器复用机制）
  │
  ▼
IMAP 连接（imap.cmss.chinamobile.com:993, SSL, auth code）
  │
  ▼
搜索当日邮件（SINCE 今日 00:00，搜索条件 FROM "service@cmecloud.cn"）
  │
  ├─ 同日多封 → 按 Received 时间降序取最新一封（P0-3）
  ├─ 当日无邮件 → 审计 info："api_patrol.email_ingestion_no_email"
  │                 状态记 no_email，不视为 error（Plan B 是备路径）
  │
  ▼
发件人白名单校验（From 头精确匹配 service@cmecloud.cn）
  │
  ├─ 不匹配 → 丢弃 + 审计告警 action="api_patrol.email_ingestion_sender_rejected"
  │            （P0-1：防伪造邮件注入数据）
  │
  ▼
MIME 解析（mailparser）
  │
  ├─ 主题 → 正则 /【API巡检报告】【(\d+)月(\d+)日】.+?(\d+) 款产品.+?(\d+) 条/
  │         提取报告月日 + 产品数 + 异常接口数（三数均与后续解析交叉校验）
  │
  ├─ HTML 正文 → 按产品分块解析统计表格（等价于 POST /api/patrol/push/stats 的 rows）
  │   ├─ 主力（P1-5a）：按 `📦 产品：` emoji 标记切分产品段 → 解析 <table> 行
  │   │   列映射：资源池/指标名称/接口名称/业务类型/成功率/正常比例/时长均值
  │   ├─ 兜底（P1-5a 正则）：emoji 标记缺失时，正则 `<th[^>]*>资源池</th>` 定位表头 →
  │   │   向前找产品名（取最近一个含"产品"二字的非表格文本或前驱 h2/h3）
  │   └─ 双路均失败 → 单产品告警，跳过该段（不阻断其他产品）
  │
  ├─ ZIP 附件（jszip 解压）→ 每个 ZIP 为 1 个 package（eip_vpc 或 elb）
  │   ├─ 包类型判定：
  │   │   ├─ 文件名含 "eip" 或 "vpc"（忽略大小写）→ package=eip_vpc
  │   │   ├─ 文件名含 "elb" 或 "slb"（忽略大小写）→ package=elb
  │   │   └─ 兜底（P1-6）：解析 CSV 列头——含 requestMapping 列→eip_vpc；
  │   │     含 resourceType 列→elb；均不匹配→跳过+审计告警
  │   ├─ 池名（pool）提取：
  │   │   ├─ 主（P1-6）：CSV 文件名正则 /(.+?)[\-_]?\d{4}-\d{2}-\d{2}/ 截取日期前部分
  │   │   └─ 兜底（P1-6）：取 CSV 正文第一行"资源池"列的值（eip_vpc CSV 有此列；
  │   │     ELB CSV 无此列→取文件名中最后一个大写英文段作为池名）
  │   ├─ CSV 解析（papaparse）→ 行对象数组（等价于 POST /api/patrol/push/requests 的 rows）
  │   └─ 附件名与正文产品交叉验证（P1-5b）：
  │       ZIP 文件对应的产品（eip_vpc→eip+vpc, elb→slb）与 HTML 正文声明的产品清单
  │       比对，有遗漏或多余 → 审计告警（可能正文与附件产品不一致）
  │
  └─ HTML-vs-CSV 交叉校验（P0-2：硬规则——底稿一致）
       ├─ 每产品取 HTML 统计表接口数 × 成功率，与 CSV 明细重算的接口数 × 成功率比对
       ├─ 偏差 > 0.05pp（接口数差 > 0.05% 或成功率绝对差 > 0.05pp）→ 审计告警
       │  action="api_patrol.email_ingestion_cross_validation_mismatch"
       └─ 不阻断写入（数据以 CSV 明细为准，HTML 仅作参考）
  │
  ▼
进程内直调写入（P0-4：走 patrolIngestion.js 共享函数，不经过 HTTP + API Key 自签名回路）
  ├─ ingestPatrolStats(db, { date, productKey, rows })  → api_patrol_stats
  └─ ingestPatrolRequests(db, { date, pool, pkg, rows, registry, getMeta, putMeta }) → api_patrol_requests
  │
  ▼
写审计日志 + 更新拉取状态 meta
  - success：记录产品数/stats 行数/requests 行数
  - no_email：当日无邮件
  - sender_rejected：发件人不匹配
  - parse_error：解析失败（含具体阶段与原因）
  - fetch_error：IMAP 连接/鉴权/网络错误（P2-8：可观测性）
```

### 9.4 缺陷修正清单（实现时必须落，2026-11-09 复盘）

| 编号 | 级别 | 缺陷 | 修正方案 | 实现位置 |
|---|---|---|---|---|
| **P0-1** | 安全 | 发件人白名单缺失——任何人都可伪造巡检邮件注入数据 | 校验 `From: service@cmecloud.cn`（精确匹配），不匹配直接丢弃 + 审计告警 `api_patrol.email_ingestion_sender_rejected` | 解析管线的 MIME 解析后、数据提取前 |
| **P0-2** | 数据完整性 | HTML-vs-CSV 交叉校验缺失——邮件正文表格数据与附件 CSV 可能不一致 | 比对 HTML 统计表接口数 vs CSV 去重接口数 + 成功率，偏差 >0.05pp 审计告警（不阻断，以 CSV 为准）。口径：接口数差百分比、成功率绝对差 | 解析管线末尾、写入前 |
| **P0-3** | 数据完整性 | 同日多封邮件无选取规则——多封时行为未定义 | 按 `Received` 头时间降序取最新一封；当日无邮件记 info 级审计 `no_email`（非 error，Plan B 是备路径） | IMAP 搜索结果处理 |
| **P0-4** | 安全/架构 | API Key 自签名回路——进程给自己发 HTTP 请求，需在本进程内签发一个 API Key 并硬编码 | 抽取 `patrolIngestion.js` 供两路径复用（HTTP 推送 + 邮件导入），邮件导入走**进程内直调**，不经过 HTTP 层。函数签名：`ingestPatrolStats(db, params)` / `ingestPatrolRequests(db, params)` | `server/patrolIngestion.js`（新建共享模块） |
| **P1-5a** | 健壮性 | HTML 产品分块解析仅依赖 `📦 产品：` emoji 标记——标记格式一变解析全崩 | 主力 `📦 产品：` 标记切分；兜底：正则 `<th[^>]*>资源池</th>` 定位表头 → 向前回溯产品名 | HTML 解析器内 |
| **P1-5b** | 健壮性 | 附件名与正文产品对应关系无交叉验证——附件少/多产品静默漏/多数据 | ZIP 文件判定的产品集合与 HTML 正文声明的产品清单比对，有遗漏或多余 → 审计告警 | 交叉校验阶段 |
| **P1-6** | 健壮性 | ZIP 池归属判定仅靠文件名——文件名不含日期格式时池名为空 | 主：文件名正则截取日期前部分；兜底：CSV 首行资源池列值（eip_vpc）或文件名大写英文段（ELB） | ZIP 解析器内 |
| **P2-8** | 可观测性 | 静默拉取失败——IMAP 连接失败/无邮件/解析失败均无人知晓 | 每次拉取写审计日志（成功/失败/跳过/告警）；Settings 面板显示上次拉取状态；总览页顶部横幅（连续失败 ≥2 天时显示警告） | 调度器 + Settings 面板 + 总览页 |

### 9.5 配置与状态（meta）

- `api_patrol_email_ingestion_config_v1`：`{ enabled: bool, imapHost: 'imap.cmss.chinamobile.com', imapPort: 993, imapUser: 'zhouhuiling@cmss.chinamobile.com', imapTls: true, senderWhitelist: ['service@cmecloud.cn'] }`——IMAP 连接配置与发件人白名单（auth code 不进 meta，从环境变量 `PATROL_EMAIL_AUTH_CODE` 读取）
- `api_patrol_email_ingestion_state_v1`：`{ lastFetchAt, lastFetchDate, lastResult('success'|'no_email'|'sender_rejected'|'parse_error'|'fetch_error'), lastStats({ products, statsRows, requestRows }), lastError }`——拉取状态（同日幂等：lastFetchDate=今日 → skip；手动 force 绕过）

### 9.6 API 与前端

- `GET /api/patrol/email-ingestion/status`（view）——返回最近拉取状态（脱敏，不含 auth code）
- `POST /api/patrol/email-ingestion/fetch`（manageTags，body `{force?: boolean}`）——手动触发拉取（测试/补拉用）
- 前端：**Settings → 邮件 tab「API巡检邮件拉取」卡片**——开关/上次拉取时间与状态/产品数/行数/错误信息（脱敏）/「立即拉取」按钮
- 总览页顶部横幅：拉取连续失败 ≥2 天时显示警告（黄色 Alert），含上次成功时间与失败原因摘要

### 9.7 调度集成

在 `patrolReportScheduler.js` 中增加 09:15 定时点：与日报定时器共用同一进程内 setTimeout 机制（`startPatrolEmailIngestionScheduler()`），拉取完成后不阻塞日报（独立 try/catch）。未启用时每 10 分钟轮询配置（同日报模式：前端开关即时生效）。

拉取成功后可选择是否自动触发压缩+诊断（默认开启：`autoProcessOnFetch=true`，拉取完成后调用 `compressPatrolDay` + `runPatrolDiagnose`，失败不阻塞状态更新）。

---

## 10. Plan C：WorkBuddy 数据代理 + 诊断中继（2026-11-10 设计定稿；同日评审修正 10 项）

### 10.1 背景与定位

部署环境出向网络受限：MCP（`cni.mcp.server:31788`）不可达，IMAP 993 大概率同样不通（同方向出向）。而 WorkBuddy 本机网络全通（11-09 MCP 契约实测 + Coremail 真实拉取均在本机验证）。

**Plan C 把整个数据链路搬到本机跑，部署环境退化为「接收 + 展示」**：

```
【WorkBuddy 本机 · 每天 09:15 automation 触发】
  node scripts/plan-c-daily.mjs
    │
    ⓪ 从部署端同步注册表（GET meta 端点，消除本机/部署端运营编辑漂移——评审#5）
    ① IMAP 拉邮件（复用 Plan B 解析：正文 stats 表 + ZIP 明细 CSV）
    ② 本机持久库（server/data/plan-c-local.db）灌当日数据
       → 跑压缩链（1h 链式并组，复用 patrolCompress）
       【持久库非临时库——评审#1：7 天重试窗口需要跨日保留压缩/诊断状态】
    ③ 逐组 MCP 诊断（cni.mcp.server:31788，并发 3、单组 300s）
       诊断队列 = 当日新组 + 库内近 7 天 pending 历史组（§10.5）
       → 根因分类（复用 17 条规则表）
    ④ 组装「日包」：{ stats + requests + groups(含诊断/收敛组) }
    ⑤ POST 部署环境 /api/patrol/push/daily-package
       （走 81 反代，现有 API Key + patrol:push scope）
    │
    ▼
【部署环境 · 唯一新增一个接收端点】
  ⑥ 三段 upsert（全部幂等，后到覆盖）：
     stats    → 唯一键 upsert（复用 ingestPatrolStats）
     requests → 唯一键 upsert（复用 ingestPatrolRequests）
     groups   → 唯一键 upsert + 诊断回填 + 人工状态保护（§10.3）
     （含收敛组：rootCauseL1=诊断能力缺口/L2=日志缺失 表达——评审#4）
  ⑦ 记 lastPackageReceivedAt（断供可观测——评审#2）
  ⑧ 包到达即触发日报（fire-and-forget 不阻塞响应——评审#6）；页面照常消费
```

三条路径关系：Plan A（外部 HTTP 直推）与 Plan C 推包的 stats/requests **同一唯一键**——谁先谁后都幂等不冲突；Plan B 部署端拉取代码保留但默认关（部署机 IMAP 不通时自然失败且可观测，不影响 Plan C）。部署端压缩/诊断链路不再自动触发（组数据唯一来源是 Plan C 推包；admin/process 手动触发是可预期行为——压缩重建组安全、诊断全失败保持 pending 不损坏数据，见 §10.8）。

### 10.2 日包契约（POST /api/patrol/push/daily-package）

鉴权：现有 API Key + `patrol:push` scope（与 Plan A 推送端点同款，无新 scope）。

```jsonc
{
  "date": "2026-11-09",                  // 数据日期（正文标注优先，T-1 兜底）
  "fetchedAt": "2026-11-10T09:15:xx",    // 本机拉取时刻（审计用）
  "stats": [                             // 邮件正文 HTML 统计表解析行（与 /push/stats 的 rows 同构）
    { "productKey": "eip", "rows": [ { "资源池": "...", "指标名称": "...", ... } ] }
  ],
  "requests": [                          // ZIP 附件明细（与 /push/requests 的批次同构）
    { "package": "eip_vpc", "pool": "华南-广州3", "rows": [ ... ] }
  ],
  "groups": [                            // 本机压缩+诊断后的失败组（含诊断结果）
    {
      "groupDate": "2026-11-09", "productKey": "eip", "poolName": "华南-广州3",
      "apiPath": "/acl/v3/floatingip/bind", "userName": "xxx", "metricName": "绑定",
      "firstRequestId": "req-xxx", "firstRequestTime": "2026-11-09 10:00:00",
      "preCompressCount": 5, "suppressedRequestIds": "[\"req-b\",...]",
      "customerType": "仿真",            // 弱标签（cmic 前缀/测试账号判定）
      "rootCauseL1": "业务冲突", "rootCauseL2": "绑定关系未解除",
      "finalConclusion": "诊断结论原文",
      "diagnosisStatus": "success"       // success | failed | converged
    }
  ]
}
```

- `diagnosisStatus` 三态：`success`（结论+分类正常回填）；`failed`（结论空，部署端组保持 pending_diagnosis）；**`converged`（超龄收敛——rootCauseL1=诊断能力缺口/L2=日志缺失，finalConclusion="日志缺失/超出 7 天重试窗口"，部署端 status 更新为「—」**，复用现有分类语义不新增状态机——评审#4）
- 大小预期：明细日千行级 → JSON 数 MB，走现有 16MB bodyLimit（联调确认 Nginx `client_max_body_size ≥16m` 已在 Plan A 清单）
- **行数上限（评审#9）**：requests 每批次 ≤5000（与 /push/requests 同）、stats 每 product ≤5000、groups ≤2000、日包总行 ≤50,000——超限 413 拒收（真实日量 883 行，余量 50 倍）
- 幂等：全字段 upsert（唯一键同 §2.1/§2.2/§2.3），重推/补跑安全

### 10.3 人工状态保护（核心防坑）

groups 段 upsert 到 `api_patrol_failure_groups` 时按字段分两类：

| 字段类 | 更新策略 |
|---|---|
| 事实数据：root_cause_l1/l2、final_conclusion、diagnoses 表 | **照常更新**（诊断是事实，重推覆盖） |
| 人工状态：product_action_status（处理中/已处理）、assignee、root_cause_confirmed、measure_feedback、feedback_by/at | **不碰**；status 仅当现值 ∈ {pending_diagnosis, 待处理, —} 时才重置为诊断映射值（converged 包 → 固定收敛「—」） |

已进入人工流程的组绝不被数据重推打回（重推带回 §2.3 语义的推包版）。diagnoses 表随包附推（组内 groups[].diagnoses[]：requestId/status/finalConclusion/raw——保持部署端诊断原文可追溯），同样 INSERT OR REPLACE 幂等。

### 10.4 日报改为「包到达后触发」

- daily-package 端点处理完三段 upsert 后**立即触发日报发送**（不等 10:30）
- **fire-and-forget（评审#6）**：日报发送不 await——端点立刻返回三段 upsert 摘要，SMTP 慢/超时不拖长响应（防本机脚本 fetch 超时误判推包失败而重推）；日报失败只记 state/审计
- 触发幂等：state meta 新增 `lastPackageReportDate`——同日第二个包（补跑/重推）不重复发日报
- 10:30 定时器**保留作兜底**：当天没收到包（automation 空跑/失败）时照常发送已有数据的日报；包先到则定时器同日幂等跳过
- **包晚于 10:30 到达（评审#3，拍板：接受不齐版）**：兜底日报已发（同日幂等锁住），包到达触发的日报被跳过——当天日报保持不齐版，**次日日报环比自然补齐**（设计选择：简单可预期 > force 双发两封造成的接收方困惑）

### 10.5 诊断重试语义（拍板 2026-11-10；依赖本机持久库——评审#1）

诊断队列 = **当日新压缩组 + 本机持久库内近 7 天仍为 pending_diagnosis 的历史组**（昨天及更早失败的天然重试——T-2 日志仍在 3 个月保留期内）：

1. **包内两轮**：单组失败（超时/瞬时 412/5xx）→ 标记跳过继续（不阻塞整包）；全组跑完后失败组再跑一轮（间隔自然拉大，瞬时故障命中率高）
2. 二轮后仍失败 → 以「结论空 + diagnosisStatus=failed」入包推走，部署端组保持 `pending_diagnosis`
3. **次日兜底**：下次跑批时 pending 历史组入队（7 天窗口内）
4. **超龄收敛**：近 7 天窗口外仍 pending 的组不再入队——本机库将该组标 converged，随**当日日包**推送（rootCauseL1=诊断能力缺口/L2=日志缺失，部署端 status 收敛「—」——评审#4），页面"未诊断"单列提示不再无限堆积

### 10.6 密钥、automation 与运行细则

- **密钥不进 automation prompt**（prompt 会存在自动化配置里，明文密钥不安全）：IMAP 授权码、MCP token、目标 URL、推送 API Key 全部从本机 env 文件读取（`scripts/plan-c-daily.mjs` 启动时加载 `.env-plan-c` 或环境变量）
- WorkBuddy recurring automation：**每天 09:15 一次**（用户拍板，不加二次补拉——邮件晚到当天空跑，次日自然补上），执行 `node scripts/plan-c-daily.mjs`，检查退出码，失败如实报告
- **automation 运行细则（评审#7）**：
  - 工作目录 = 仓库根（automation cwds 配置），脚本内 `import.meta.url` 定位自身，不依赖 cwd
  - 时刻 09:15 按北京时间（Asia/Shanghai）
  - **退出码语义分级**：0=推包成功（诊断部分失败也算——包已推走，stdout 报告 failed 组数）；1=邮件无数据（no_email，明日自然补）；2=拉取/解析失败；3=MCP 全失败（包照推但全部 failed——提示人工看 MCP 服务）；4=推送部署端失败（最严重，数据滞留本机）
  - **本机持久库滚动清理**：每次跑批末尾删除 30 天窗口外的 stats/requests/groups/diagnoses（防无限积累；7 天诊断窗口 < 30 天清理窗口，安全余量）

### 10.7 断供可观测（评审#2）

部署端对 Plan C 断供的感知链：

- `api_patrol_email_ingestion_state_v1` meta 扩展 `lastPackageReceivedAt` 字段（daily-package 端点写入）
- 总览页横幅判据扩展：**「连续 ≥2 天未收到日包（启用 Plan C 时）」或「email_ingestion 连续失败」**任一命中即显示（黄 Alert，提示检查 WorkBuddy automation/本机网络）
- 本机侧：automation 失败如实报告（退出码非 0 时 WorkBuddy 任务面板可见）；脚本 stdout 输出各阶段摘要（拉取行数/组数/诊断成败/推送响应）

### 10.8 操作边界与撤销条件

- **admin/process 手动触发（评审#8）**：Plan C 上线后部署端手动触发压缩+诊断是**可预期行为非故障**——压缩重建组安全（人工状态带回保护），诊断因 MCP 不通全失败保持 pending（不损坏数据但观感为"全部未诊断"）；面板提示文案注明"部署端 MCP 不可达时请走 Plan C 数据代理"
- **与既有拍板衔接**：
  - 「日志时效：诊断应近实时触发」（11-09）→ Plan C 本机 T-1 当天诊断，天然满足
  - 「重推带回唯一匹配」（11-06）→ §10.3 人工状态保护是其推包版（部署端唯一键 upsert 天然"唯一匹配"）
  - 「同日幂等 + force 旁路」（§8.2/§9.5）→ 日报包触发幂等（§10.4）沿用同模式
  - autoProcessOnFetch（§9.7）→ Plan C 上线后保持关：部署端不跑压缩诊断，组数据唯一来源是推包
  - **注册表同步（评审#5）**：每日跑批 ⓪ 步从部署端 GET 注册表 meta 覆盖本机库——消除本机/部署端运营编辑漂移（metric_name 冻结、product_key 归属判定同源）；同步失败不阻塞（用本机现值继续，审计记一条）
- **撤销条件（评审#10）**：部署环境出向策略打通（MCP `cni.mcp.server:31788` 或 IMAP 993 任一可达）时回归 Plan A/B 直连——automation 停用、`plan-c-local.db` 归档删除、daily-package 端点保留兼容（已推历史数据不受影响）。判定方式：部署机 `nc -zv cni.mcp.server 31788` 成功即可启动回归

---

## 11. 拍板记录（防丢失）

| 日期 | 事项 | 决定 |
|---|---|---|
| 11-06 | 总/失败次数 | 从明细重算，不入统计表 |
| 11-06 | 展示口径 | 全部<100%，<99.5% 优先在前 |
| 11-06 | 压缩 | 相邻间隔 ≤1h 链式并组（长尾风险已知悉） |
| 11-06 | 压缩键 | 含池：(日,客户,池,接口)；自然日切分不跨日 |
| 11-06 | ELB 产品 key | slb（elb 是已停用的"负载均衡"） |
| 11-06 | 重推带回 | (日,池,接口,客户) 唯一匹配带回；歧义告警不带回 |
| 11-06 | 处理字段 | 并表（failure_groups 直存）+ audit_log 留痕，读取改造延后 |
| 11-06 | 四个恒空/冗余字段 | **保留入库**（appId/dailyReport/realtimeReport/endTime） |
| 11-06 | 鉴权 | API Key + 新 scope `patrol:push` + 81 反代；独立 token 方案否决 |
| 11-06 | 统计阈值 | 以外部为准（99.5%），平台不补算 |
| 11-06 | 正常比例 | 外部算好推成品；注册表删"接口时长正常值"字段 |
| 11-06 | MCP 对接 | 服务端直连 cni.api.mcp:31788（轻量 MCP Client） |
| 11-06 | 注册表种子 | migration 式灌入（本地+部署自动生效）；34 项（A18+B3+C1(10)+C2(3)，C1 计数 11-07 实施勘误） |
| 11-06 | 注册表编辑影响 | 只影响之后推送，存量不回溯 |
| 11-07 | 产品侧处理（v3 FINAL） | 业务冲突/资源状态异常/其他 → 待处理；配额/参数/诊断缺口 → —；**锁定二分**：并发进行中→—，锁定机制待查→待处理 |
| 11-07 | 根因体系结构 | 两级 L1(7)/L2；底稿 15 条全兼容映射；产品侧映射挂 L2 行可前端维护 |
| 11-07 | Tab 命名 | 「产品接口」「接口失败根因分类」 |
| 11-07 | 根因分类展示 | 失败请求列表加 L1·L2 两级 Tag + 复合搜索筛选 |
| 11-07 | 总览可视化 | 根因分布堆叠柱/表切换；L1 趋势七类全画；跨日轨迹热力日历/折线双形态切换；AI 综述 facts 驱动+四类锚点+模板降级 |
| 11-07 | 一致性修订 A-I | stats 键补 metric_name；groups 加 root_cause_l1/l2 + metric_name 冻结列 + pending_diagnosis 状态；压缩显式触发；MCP 并发=3；scope preHandler；产品映射 name→key→400 两级；未登记告警落 meta；单条组 suppressed="[]"；空接口 product_key 可 NULL |
| 11-07 | 跨日聚合口径 | 成功率/次数=明细 Σ 重算；时长均值/正常比例单日原值、跨日"—" |
| 11-07 | 趋势缺天 | 展示与推送口径一致：缺天断线不补算；**「含明细补算」开关**（补点空心标记区分口径，明细超集实测 69/69=100%） |
| 11-07 | C2 退订LB | 占位 LB/UNSUBSCRIBE（inferred=true 待验后修正） |
| 11-07 | 批判性复查 7 项修正 | ①is_success 分布守卫（4309/4097）；②M13.4 改走真实诊断解析链（mock MCP 返回 JSON，不绕过）；③压缩基准=独立复算法+不变式断言（Σcount=失败总数、requestId 全集无交叠）；④根因分布/AI 综述补 pre_compress_count 严重度维度（长链 197→2 组实测）；⑤conclusion 兜底合成用例；⑥解析失败 5 条归类注释；⑦跨日 avg_duration=null 序列化断言 |
| 11-07 | customer_type 语义 | **弱标签制（终版）**：仿真（cmic 前缀）/ 测试账号（含 test/ceshi/demo）/ 空（其余无标记）——底稿 4.2 前两条独立判据原样保留；仅展示与筛选维度，**不影响产品侧处理判定**；其余启发式（政企/个人/企业）无消费方不实现 |
| 11-07 | MCP 配置维护 | Settings 新增「产品API日志诊断配置」面板（与 LLM 面板并列，admin 专属权限 managePatrolMcpConfig）；存储 meta api_patrol_mcp_config_v1 与 llm_config_v1 四件套同构（GET 禁明文/PUT 留空保留/专属审计/脱敏读）；解析链=显式传参>库>env（PATROL_MCP_ENDPOINT/PATROL_MCP_TOKEN） |
| 11-07 | AI巡检日报 | §8 定稿：窗口=昨日 T-1；待产品侧关注=待处理组（未诊断单列不算）；成功率=stats 推送值不重算；明细上限 20/产品；排序=纯仿真排后→<99.5 优先→升序；**仿真/测试流量默认不排除、打标记**（excludeSimTagged 可选排除）；无异常默认发平静简报（includeQuiet）；进程内定时器+同日幂等+手动 force 补发；复用 mail_groups，通道按 **channelId 选择**（不新增全局数据源枚举） |
| 11-07 | 仿真/测试排后 | 异常接口列表（溯源页①+日报明细表）：**纯仿真/测试接口**（接口×池×窗口内失败组全为仿真/测试账号）打标签并排列表最后；混合真实客户失败的接口不后排（有真问题）；推导口径两处同源（simAgg 按 池×接口） |
| 11-07 | 溯源页巡检概况 | 页面1 顶部 AI 总结方向拍板：**检测结果概况**（非待办摘要——用户纠偏）——覆盖/阈值异常/失败总量/最差 Top3/最集中点(含仿真占比)/根因 Top3/闭环状态/环比；facts 与①列表同源（computeFailureInterfaces 单源）；LLM 输出不含数字、facts 锚点渲染、模板降级 |
| 11-09 | MCP 真实契约 | 官方端点 `cni.mcp.server:31788/mcp-server/mcp`（hosts 前置）实测定稿：Streamable HTTP 双 Accept 头；log_search 必填时间/产品枚举/池枚举、requestId 走 filter；超时 300s 对齐官方；isError 按失败保重试；日志平台保留期有限→诊断应近实时触发 |
| 11-09 | Plan B 邮件拉取设计 | §9 定稿：IMAP 每日 09:15 拉取（Coremail imap.cmss.chinamobile.com:993，auth code 环境变量）；发件人白名单（P0-1）；HTML-vs-CSV 交叉校验 ≤0.05pp（P0-2）；同日多封取最新（P0-3）；进程内直调不入 HTTP 回路（P0-4）；HTML 解析 emoji 主力+正则兜底（P1-5a）；附件名×正文产品交叉验证（P1-5b）；ZIP 池名文件名主+CSV 内容兜底（P1-6）；每次拉取审计+Settings 状态面板+总览连续失败横幅（P2-8）；调度集成 09:15 同日报 setTimeout 模式；拉取后可自动触发压缩诊断 |
| 11-10 | Plan B 授权码入库 | IMAP 授权码改前端配置入 meta（对齐 SMTP 通道 password 口径：留空保留原值、GET 只回 authCodeConfigured 布尔）；环境变量 PATROL_EMAIL_AUTH_CODE 降为兜底 |
| 11-10 | Plan C 数据代理 | §10 定稿：部署环境出向受限→本机 WorkBuddy 跑全链（拉邮件→本机**持久库**压缩→MCP 诊断→组日包推 81 反代）；**stats 随包推**（页面①列表数据源）；**日报改为包到达后触发**（fire-and-forget 不阻塞端点响应；10:30 定时器保留兜底，同日第二包不重发）；**automation 只跑 09:15 一次**（邮件晚到次日自然补）；诊断重试=包内两轮+次日兜底+**7 天 pending 重试窗口**（超龄收敛 diagnosisStatus=converged 随包推、status 收敛「—」）；groups 人工状态保护（处理中/已处理不打回，诊断事实照常覆盖）；密钥走本机 env 文件不进 automation prompt |
| 11-10 | Plan C 评审修正 10 项 | 架构决策评审（dev-expert architecture-decision 框架）：①临时库→**本机持久库** plan-c-local.db（7 天重试窗口前提，30 天滚动清理）②断供可观测（lastPackageReceivedAt+横幅判据扩展）③包晚到接受不齐版（不 force 双发）④收敛组随包推（converged 三态复用分类语义）⑤每日跑批⓪步**同步注册表**消漂移 ⑥日报 fire-and-forget ⑦退出码 0-4 分级 ⑧admin/process 手动触发注明可预期 ⑨日包行数上限（批 5000/总 50000）⑩撤销条件=部署机出向打通即回归 Plan A/B |

## 12. 实施顺序

1. 建表 + 两个 meta 种子 migration
2. 推送 API（鉴权中间件/两个端点/批次校验/幂等 upsert/产品归属判定+未登记告警）
3. 压缩批处理 + 重推带回
4. MCP Client + 诊断任务 + 根因分类
5. 对象与标签两个 Tab
6. 异常接口溯源页（两表+抽屉+处理闭环+审计写入）
7. 总览页（AI 综述+分布+趋势）
8. 样例数据导入脚本（data/API 巡检/原始数据样例 → 真实链路验证）
9. 联调清单：Nginx body 限制/超时/Authorization 透传/外部 81 可达性/API Key 签发
10. Plan B 邮件拉取导入（IMAP 拉取+邮件解析+共享写入模块+调度集成+前端状态面板；§9）——依赖步骤 2（patrolIngestion.js 共享模块必须先于 Plan B 落成；§9 §9.4 P0-4：两路径复用同一写入函数）
11. Plan C 数据代理（部署端 daily-package 接收端点 + 本机 plan-c-daily.mjs 脚本 + WorkBuddy automation 配置；§10）——依赖步骤 1/2/3/4 全量（压缩/诊断模块复用）与 9（81 反代 API Key 已签发）

每步验证纪律：真实链路跑通（node -e 最小脚本拼真实入参）+ 守卫测试红绿证明 + typecheck 零新增。
Plan B 额外验证：(1) 发件人白名单拒绝非 service@cmecloud.cn 邮件；(2) HTML-vs-CSV 交叉校验告警触发；(3) 同日多封取最新；(4) 无邮件不报 error；(5) IMAP 连接失败审计可见。
Plan C 额外验证：(1) 三段 upsert 幂等重推；(2) 人工状态保护（已处理组不被打回）；(3) 包到达触发日报且同日第二包不重发；(4) 10:30 兜底在无包日照常；(5) 诊断 failed 组保持 pending_diagnosis；(6) 7 天窗口外 pending 组收敛为「—」。
