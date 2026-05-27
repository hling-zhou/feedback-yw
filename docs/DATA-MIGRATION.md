# 数据迁移操作说明

本文说明如何将 **Feedback Insights** 从一台电脑完整迁移到另一台电脑，使 **工单数据、打标结果、洞察快照（含图表与行动建议）** 在新环境中与迁移前一致。

---

## 一、原理说明（数据存在哪里）

本系统当前以 **API + SQLite** 为协作数据主路径（非仅浏览器缓存）：

| 内容 | 存储位置 | 说明 |
|------|----------|------|
| 全部反馈/工单及四维打标 | `server/data/auth.db` | SQLite 数据库文件 |
| 洞察快照（周期图表、结论、行动建议） | 同上 `snapshots` 表 | 点击「生成/刷新洞察」后写入 |
| 洞察周期、用户账号、标签库（managed） | 同上 | 与工单同库 |
| 已发布的打标 Excel/JSON（可选） | `public/config/taxonomy/` | 标签管理「发布」后生成 |
| 已发布的产品规格（可选） | `public/config/product-catalog/` | 设置/产品目录发布相关 |

**重要：**

- 关闭浏览器 **不会** 丢失数据；数据在 `auth.db` 文件中。
- 仅复制项目代码 **不会** 带走业务数据，必须备份 `auth.db`。
- 大模型密钥 `LLM_API_KEY` 在环境变量中，**不在** 数据库内，新电脑需单独配置。

---

## 二、迁移前准备（旧电脑）

### 2.1 停止 API 服务

在运行 `npm run dev:all` 或 `node server/index.js` 的终端中按 `Ctrl+C` 停止服务。  
备份时 API 已停止，可避免数据库写入导致备份不完整。

### 2.2 备份数据库（必做）

进入项目根目录（下文以 `feedback-insights` 为例）：

```bash
cd /path/to/feedback-insights
mkdir -p backup
```

**方式 A（推荐）：SQLite 一致性备份**

需本机已安装 `sqlite3` 命令行：

```bash
sqlite3 server/data/auth.db ".backup 'backup/auth-$(date +%Y-%m-%d).db'"
```

**方式 B：直接复制文件**

在 API 已停止的前提下：

```bash
cp server/data/auth.db "backup/auth-$(date +%Y-%m-%d).db"
```

若存在以下文件，可一并复制（没有则忽略）：

```bash
cp server/data/auth.db-wal backup/ 2>/dev/null
cp server/data/auth.db-shm backup/ 2>/dev/null
```

> 恢复时若只恢复主库 `auth.db`，建议 **不要** 混用旧的 `-wal` / `-shm`，或恢复后删除新环境里的 wal/shm 再启动 API。

### 2.3 备份配置目录（建议）

若在系统中使用过 **标签管理 → 发布打标配置** 或产品目录发布，建议打包：

```bash
tar -czf "backup/config-$(date +%Y-%m-%d).tar.gz" \
  public/config/taxonomy \
  public/config/product-catalog
```

### 2.4 记录环境变量（可选）

以下变量 **不会** 随 `auth.db` 迁移，请自行记录或在新电脑重新设置：

| 变量 | 是否必须 | 说明 |
|------|----------|------|
| `JWT_SECRET` | 启动 API 必填 | 可与旧电脑相同或重新生成；变更后需重新登录 |
| `ADMIN_INITIAL_PASSWORD` | 仅空库首次必填 | **已有数据的库不要依赖此项** |
| `LLM_API_KEY` | 可选 | 需要 LLM 打标/润色时在新电脑配置 |

可将旧电脑终端里 `export` 过的变量保存到本地备忘录（**勿提交到 Git**）。

### 2.5 拷贝到可移动介质

将以下内容拷贝到 U 盘、网盘或新电脑：

1. **必带**：`backup/auth-YYYY-MM-DD.db`
2. **建议**：`backup/config-YYYY-MM-DD.tar.gz`（若有）
3. **必带**：项目源码（Git 克隆、压缩包或整目录复制均可）

---

## 三、在新电脑上恢复

### 3.1 安装运行环境

- Node.js（建议 LTS，与旧电脑相近版本）
- npm
- Git（若从仓库克隆）

### 3.2 获取项目代码

```bash
cd /path/to/your/workspace
git clone <你的仓库地址> feedback-insights
cd feedback-insights
npm install
```

若使用拷贝的整目录，确保 `node_modules` 在新电脑执行过 `npm install`（或删除旧 `node_modules` 后重装）。

### 3.3 恢复数据库

```bash
mkdir -p server/data
cp /path/to/backup/auth-YYYY-MM-DD.db server/data/auth.db
rm -f server/data/auth.db-wal server/data/auth.db-shm
```

**注意：**

- 用备份文件 **覆盖** `server/data/auth.db`，不要在新空库上「导入」后再覆盖。
- 不要在新电脑先启动一次空库再覆盖（若已误操作，仍可用备份再次覆盖）。

### 3.4 恢复配置目录（若已备份）

```bash
cd /path/to/feedback-insights
tar -xzf /path/to/backup/config-YYYY-MM-DD.tar.gz
```

### 3.5 配置环境变量并启动

```bash
export JWT_SECRET="你的密钥（≥16 字符，生产建议 ≥32）"

# 以下仅当 server/data 为空、首次建库时才需要，已有 auth.db 时不要设置：
# export ADMIN_INITIAL_PASSWORD="至少12位强密码"

npm run dev:all
```

- 前端：http://127.0.0.1:5175/
- API：http://127.0.0.1:3001/

使用 **旧电脑相同的管理员账号密码** 登录（账号数据在 `auth.db` 内）。

### 3.6 验证数据是否完整

**命令行检查：**

```bash
curl -s http://127.0.0.1:3001/health
```

关注返回 JSON 中的字段：

- `dbOk` 应为 `true`
- `recordCount` 应与旧电脑工单总数一致（例如 1720）

**界面检查：**

1. 登录后打开 **反馈库**，核对总条数。
2. 打开 **洞察工作台**，选择原洞察周期。
3. 确认图表、周期结论、**行动建议** 与旧环境一致（快照已在库中，一般无需重新生成）。
4. 若提示快照过期且数据未变，可点「生成/刷新洞察」；若仅换电脑、数据未改，通常直接可见原快照。

---

## 四、迁移清单（可打印核对）

### 旧电脑（迁出）

- [ ] 已停止 API / `dev:all`
- [ ] 已备份 `server/data/auth.db` 到 `backup/`
- [ ] 已备份 `public/config/taxonomy` 与 `product-catalog`（如使用过发布）
- [ ] 已记录 `JWT_SECRET`（可选）
- [ ] 已将备份文件与项目代码拷出

### 新电脑（迁入）

- [ ] 已 `npm install`
- [ ] 已将备份恢复为 `server/data/auth.db`
- [ ] 已删除 wal/shm（若存在）
- [ ] 已解压配置目录（若有）
- [ ] 已设置 `JWT_SECRET` 并 `npm run dev:all`
- [ ] `/health` 中 `recordCount` 正确
- [ ] 洞察周期、行动建议显示正常

---

## 五、常见问题

### Q1：新电脑工单数为 0？

- 未正确恢复 `auth.db`，或路径不是 `server/data/auth.db`。
- 启动时用了全新空库。解决：停止服务，用备份再次覆盖 `auth.db`。

### Q2：有工单但没有洞察/行动建议？

- 旧环境若从未对该周期点过「生成/刷新洞察」，库中本就没有快照。
- 若库中有快照但仍空白，确认所选 **洞察周期** 与导入月份一致，再尝试刷新洞察。

### Q3：登录失败？

- `JWT_SECRET` 与旧电脑不同不会丢数据，但需用库内已有账号密码登录。
- 忘记密码需由管理员在「用户管理」重置，或联系原管理员。

### Q4：两台电脑能同时用同一份 `auth.db` 吗？

- 不建议把同一个 `auth.db` 放在网盘双开同时写，易损坏数据库。
- 正确做法：一台为主，迁出时用备份拷贝到另一台；之后各自独立使用或定期再备份同步。

### Q5：需要重新「批量打标」或「刷新洞察」吗？

- **不需要**。迁移只复制数据库，打标与快照已在内。
- 仅当你在迁移后又 **新导入工单、改标签、批量重打标** 时，才需再点「生成/刷新洞察」。

### Q6：浏览器里的数据要管吗？

- 生产/本地开发登录后数据走 API + SQLite，**不依赖** 清浏览器缓存。
- 旧版仅存于浏览器 IndexedDB 的数据，若未迁移到服务端，需按项目内「本地迁 API」流程处理（一般团队环境已统一用服务端）。

---

## 六、生产环境补充

若部署在服务器（见 [DEPLOY.md](./DEPLOY.md)），迁移思路相同：

1. 在旧服务器对 `server/data/auth.db` 做 `.backup` 或停服复制。
2. 将备份传到新服务器相同路径。
3. 同步 `public/config/`（若使用发布配置）。
4. 配置相同的 `JWT_SECRET`、 `CORS_ORIGINS` 等后启动 API。

---

## 七、相关文档

- [README.md](../README.md) — 本地开发与环境变量
- [DEPLOY.md](./DEPLOY.md) — 生产部署与备份恢复
- [USER-GUIDE.md](./USER-GUIDE.md) — 洞察刷新与日常使用

---

*文档版本：与当前代码库「API + SQLite（auth.db）」架构一致。若后续存储方式变更，以仓库内 DEPLOY / README 为准。*
