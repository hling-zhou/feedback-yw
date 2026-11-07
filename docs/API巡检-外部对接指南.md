# API 巡检 · 外部系统对接指南

> 本文档面向**外部推送系统开发人员**——只看此文档即可完成对接，无需阅读平台代码。
> 平台侧设计详见 `docs/DESIGN-API巡检.md`。

## 1. 对接总览

```
外部巡检系统 ──①统计批次──→ POST /api/patrol/push/stats     （每日异常接口统计）
            ──②明细批次──→ POST /api/patrol/push/requests  （每日失败/成功请求明细）
            ←──响应摘要──   { received, inserted, overwritten, ignored, unregistered }
```

- **平台入口（生产）**：`http://10.64.3.250:81`（Nginx 反代 → Node API）；本地开发 `http://127.0.0.1:3001`
- **鉴权**：API Key（`Authorization: Bearer <key>`），需平台管理员在「系统设置 → API Key 管理」签发、勾选 **API 巡检数据推送（patrol:push）** 权限
- **自检**：直连 API 端口时 `GET /health` 返回 200 即通；**经 81 反代时 `/health` 返回的是前端页面**（反代未代理该路径），请改用任意 `/api/*` 端点探测——返回 401 JSON（`{"error":"未登录或令牌无效"}`）即为服务在线（2026-11-07 生产实测）

## 2. 批次粒度（重要）

| 端点 | 一批 = | 上限 |
|---|---|---|
| `/api/patrol/push/stats` | 一日 × 一产品 | 5000 行 |
| `/api/patrol/push/requests` | 一日 × 一资源池 | 5000 行（超过请分批，批间顺序无要求） |

请求体上限 16MB/批（Nginx `client_max_body_size` 需 ≥16m，由平台运维确认）。

## 3. 统计批次 push/stats

```json
POST /api/patrol/push/stats
Authorization: Bearer <API Key>
Content-Type: application/json

{
  "product": "弹性公网IP",          // 产品名或英文 key（eip/vpc/slb）均可；两者都不匹配 → 400
  "date": "2026-08-10",             // YYYY-MM-DD
  "rows": [
    {
      "资源池": "华南-广州3",
      "指标名称": "订购",
      "接口名称": "/customer/v3/order/create/floatingip",
      "业务类型": "订购",
      "成功率": "88.89%",            // 百分数文本；解析失败该行忽略并计数
      "正常比例": "87.5%",           // "-" 表示无 → 存 NULL
      "时长均值": "29.27s"           // "-" → NULL
    }
  ]
}
```

**响应**：`{ "received": 1, "inserted": 1, "overwritten": 0, "ignored": 0 }`

- **幂等**：同键（日期+产品+池+接口+指标名）重推 = 覆盖更新（`overwritten` 计数）。可安全重试。
- **同接口多指标**：同一天同一接口若统计出多个指标（如"订购"+"批量订购"），分两行推送，都会入库。

## 4. 明细批次 push/requests

### 4.1 EIP/VPC 混装包（package=eip_vpc）

```json
POST /api/patrol/push/requests
Authorization: Bearer <API Key>

{
  "package": "eip_vpc",
  "date": "2026-08-10",
  "pool": "华南-广州3",
  "rows": [
    {
      "id": "123811889",
      "appId": "",                                  // 保留列，原值透传（含空串）
      "requestId": "reqId-45020bf3…",
      "requestMapping": "/acl/v3/floatingip/bind",  // 接口路径
      "userId": "CIDC-U-…",
      "userName": "YDY15292250571",                  // 客户名（压缩分组键）
      "bizCategory": "解绑", "bizTarget": "IP", "bizNo": "…",
      "result": "0",                                 // "1"成功 / "0"失败；其他值该行忽略
      "executionTimeMillis": "10",
      "createTime": "2026-08-10 19:51:30",
      "diagnoseResult": "{\"final_conclusion\":\"…\"}"  // 平台不依赖；仅存档
    }
  ]
}
```

### 4.2 ELB 包（package=elb）

```json
{
  "package": "elb",
  "date": "2026-08-10",
  "pool": "华南-广州3",
  "rows": [
    {
      "id": "11474802",
      "requestId": "reqId-…",
      "userId": "CIDC-U-…",
      "resourceType": "L7POLICY",                    // 接口名 = resourceType/resourceOperation
      "resourceOperation": "CREATE",
      "startTime": "2026-08-10 23:52:13",
      "endTime": "2026-08-10 23:52:14",              // 保留列
      "resultStatus": "FAILED",                      // SUCCESS / FAILED
      "errorMessage": "七层转发策略…要么都为空",       // 保留列
      "dailyReport": "", "realtimeReport": "",       // 保留列
      "userName": "cmic_sim",
      "executionTimeMillis": "1000",
      "diagnoseResult": "{…}"
    }
  ]
}
```

**响应**：`{ "received": N, "inserted": N, "overwritten": 0, "ignored": 0, "unregistered": [] }`

- **幂等**：键=(日期,池,requestId)，重推覆盖。
- **批内重复**：同批同 requestId 后者覆盖前者（`received` 计去重后行数）。
- **产品归属**：EIP/VPC 混装包按接口路径自动判定（注册表优先，未登记路径启发式判定并列入 `unregistered` 响应字段——平台运营会在界面转正，转正**只影响之后的推送**）；ELB 固定 slb。
- **空接口名**：`requestMapping` 为空的行会入库（product_key=NULL），不参与成功率统计。

## 5. 平台处理时序（推送后数据会怎样）

1. **推送入库**：即时，响应摘要即结果
2. **压缩 + 诊断**：**平台管理员手动触发**（推送不自动触发）。请按日推送完毕后知会平台侧一次即可
   - 压缩：同（日, 客户, 资源池, 接口）内、相邻失败间隔 ≤1 小时的链式合并为一组（人工处理按组进行；跨池/跨日不并组）
   - 诊断：平台 MCP 工具逐组调用（外部无需参与）
3. **未登记接口**：出现在推送响应 `unregistered` 数组与平台「对象与标签 → 产品接口」待登记区

## 6. 错误码

| HTTP | 场景 | 处理 |
|---|---|---|
| 400 | 缺字段 / 日期格式错 / 未知产品名 | 检查请求体；`error` 字段说明原因 |
| 401 | API Key 无效/吊销/过期 | 联系平台管理员重新签发 |
| 403 | Key 无 patrol:push 权限 | 管理员勾选该 scope |
| 413 | 超 5000 行/16MB | 分批推送 |
| 500 | 平台内部错误 | 重试；持续失败联系平台 |

## 7. 联调确认清单（勾选式）

- [ ] `GET /health` 通
- [ ] API Key 已签发且含 `patrol:push`
- [ ] 统计批次试推 1 天数据 → 响应 received/inserted 对上
- [ ] 明细批次试推 1 天 1 池 → received/inserted 对上；`unregistered` 列表与预期一致
- [ ] 重推同批 → 全部 `overwritten`（幂等确认）
- [ ] Nginx `client_max_body_size` ≥ 16m
- [ ] 平台侧已触发压缩（溯源页可见失败组）

## 8. 网络开通清单（部署评审时提给网络/安全组）

生产平台部署于 `10.64.3.250`（81 反代入口），两条策略缺一不可（2026-11-07 定稿）：

**策略①（入向 · 外部推送）**

```
源：   外部巡检系统推送源 IP（向对方获取）
目的： 10.64.3.250 端口 81（TCP/HTTP，Authorization 头透传）
用途： API 巡检统计/明细推送（POST /api/patrol/push/*）
反代要求：client_max_body_size ≥ 16m（明细批最大 16MB，否则被 Nginx 413 掐断）
```

**策略②（出向 · MCP 日志诊断）**

```
源：   10.64.3.250
目的： 云网工作台 MCP 服务，二选一（以平台组确认的正式端点为准）：
       A. cni.api.mcp:31788/mcp（文档口径——需同时开通 .mcp 域名解析）
       B. 10.233.1.22:8080/mcp-server（IP 直连口径——免 DNS）
用途： 失败请求日志诊断（MCP log_search 工具，JSON-RPC over HTTP）
```

> 附注：MCP Token 由云网工作台签发（通用智能体 → 设置 → MCP 工具面板 → 生成 token），与个人账号绑定；
> 生产服务长期自动调用建议向平台组申请**服务级/应用级 token**，避免绑定个人（人员变动即断）。

## 9. 运维速查（平台侧）

- **签发 Key**：设置页 → API Key 管理 → 新建（勾选 API 巡检数据推送）→ 明文 Key 只显示一次
- **样例数据导入**：`node scripts/import-api-patrol-samples.mjs --api <平台地址> --key <key>`；可选 `--from 2026-08-06 --to 2026-08-12`（按日期过滤，含端点）、`--admin-token <JWT> --mcp <MCP端点> --mcp-token <token>`（推送后自动触发压缩+诊断）
- **MCP 诊断地址**：`http://10.233.1.22:8080/mcp-server`（IP 直连口径）或 `http://cni.api.mcp:31788/mcp`（域名口径，需 .mcp 解析）；Bearer token 由云网工作台签发
- **压缩/诊断触发**（推送本身不自动触发）：`POST /api/patrol/admin/process`，body `{"dates":["2026-08-06",…]}`（可带 `mcpEndpoint`/`mcpToken` 覆盖默认 MCP 地址）——需 admin 身份
