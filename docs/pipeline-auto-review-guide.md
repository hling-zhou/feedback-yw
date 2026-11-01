# 流水线自动化复核指南

> 本文档是 WorkBuddy 自动化每周一拉取部署环境流水线产物后，执行分析、复核、修复的固定流程。
> 自动化 prompt 引用本文档作为方法论参考。

## 时序

| 时间 | 角色 | 动作 |
|------|------|------|
| 周一 11:30 | 部署服务器 cron | 自动运行 `run-pipeline.sh --batch '*' --products '*'` |
| 周一 11:50 | WorkBuddy 自动化 | 拉取产物 → 分析 → 批判性复核 → 精修正则 → 测试 → commit |

## Step 0: 拉取产物

```bash
bash scripts/pull-deploy-artifacts.sh http://10.64.3.250:81 --login admin:<PASSWORD>
```

**失败处理**：
- 网络不通 → 通知用户"部署环境流水线产物拉取失败（网络原因），请检查部署服务器可达性"
- 登录失败 → 通知用户"部署环境登录失败，密码可能已变更"
- 产物 404 → 检查 pipeline-summary.json 的 runDate 是否是今天；如果不是，说明流水线还没跑完，等待 5 分钟重试，最多重试 6 次（30 分钟）

## Step 1: 判断流水线状态

读 `dist/pipeline-summary.json`：

```json
{
  "status": "pass|fail",
  "gate": { "status": "pass|fail", "passCount": N, "failCount": M },
  "evidenceRowsCount": N,
  "newWordCount": N
}
```

- `status === "pass"` → 进入 Step 2 分析准确率
- `status === "fail"` 且 `gate.status === "fail"` → 进入 Step 2，但优先分析 gate 失败项
- `status === "fail"` 且 `gate.status === "pass"` → 脚本崩溃，通知用户

## Step 2: 分析 gate-report.json

读 `dist/gate-report.json`，关注：

1. **失败项列表**：`checks` 数组中 `ok === false` 的项
2. **失败项的 `name`**：对应哪个产品哪个 family
3. **失败项的 `hint`**：门禁给出的修复方向
4. **失败项的 `evidence`**：具体哪些工单被判定为误归属

分析每个失败项的根因：
- 未归类率超标 → 该产品有工单未被任何 family 正则命中 → 需要补词
- 误归属率超标 → 工单被命中到了错误的 family → 可能是泛词误吸或 exclude 缺失
- 共性项超标 → 某个 L2 子项过于笼统 → 需要拆分

## Step 3: 分析 evidence-rows.json

`dist/evidence-rows.json` 是逐工单的归因证据，结构：

```json
{
  "EIP": [
    {
      "ticketId": "...",
      "product": "弹性公网IP",
      "text": "问题原因+需求痛点(80字截断)",
      "family": "forward",
      "subFamily": "forward_fail",
      "status": "classified|unclassified|pending",
      "score": N,
      "hits": ["关键词1", "关键词2"]
    }
  ]
}
```

### 分析维度

**A. 未归类工单（status === "unclassified"）**
- 提取 text 字段，人工判断应归属哪个 family
- 归纳未归类的共性问题模式
- 对照 `dist/taxonomy-current.json` 确认正则是否缺词

**B. 低分归类工单（score ≤ 2）**
- 这些是"勉强归类"的，容易误标
- 检查 family 指派是否正确

**C. 各产品未归类率分布**
- 统计每个产品的 unclassified 占比
- 对比上次运行（如有基线），判断趋势

## Step 4: 批判性复核

对 Step 2-3 发现的问题和拟定的修复方案，执行批判性复核：

### 4.1 复核修复的必要性
- 这个正则补词是否真的解决了问题？还是只是碰巧命中了这几条工单？
- 补的词是否过于宽泛？会不会引入新的误归属？
- 是否应该是 exclude 的问题而不是 re 的问题？

### 4.2 复核修复的完整性
- 同一类问题是否在其他产品的 curated JSON 中也存在？
- 修复后是否会影响已有的正确归类？（用 evidence-rows 中已归类的工单做回归）

### 4.3 复核修复的优先级
- 影响面（多少工单）× 严重程度（误标方向是否误导）
- 高影响高严重的优先修
- 低影响低严重的记录但不一定本次修

## Step 5: 精修正则

修改 `scripts/*-taxonomy-curated.json` 中的 `re` / `exclude` / `subs` 字段。

### 修改原则
1. **最小改动**：只改有问题的 family，不动的 family 保持不变
2. **精确匹配**：补的词尽量是具体短语，避免裸泛词（如单独的"异常"、"故障"）
3. **exclude 保护**：如果补的词可能与别的 family 冲突，在目标 family 加词的同时，在冲突 family 的 exclude 里也加上
4. **L1 和 L2 同步**：如果 L1 的 re 改了，对应 L2 子项的 re 也要同步改

### 修改格式
```json
// 修改前
{ "key": "forward", "re": "无法转发|转发.*失败" }

// 修改后
{ "key": "forward", "re": "无法转发|转发.*失败|拉流.*失败|连接.*重置" }
```

## Step 6: 深度验证

### 6.1 语法验证
```bash
# 验证 JSON 语法正确
node -e "JSON.parse(require('fs').readFileSync('scripts/elb-taxonomy-curated.json','utf8')); console.log('OK')"
node -e "JSON.parse(require('fs').readFileSync('scripts/ct-taxonomy-curated.json','utf8')); console.log('OK')"
# ... 对每个修改过的文件执行
```

### 6.2 正则验证
```bash
# 验证每个正则都能被 RegExp 编译
node -e "
const j = JSON.parse(require('fs').readFileSync('scripts/elb-taxonomy-curated.json','utf8'));
for (const f of j.families) {
  try { new RegExp(f.re, 'i'); } catch(e) { console.log('FAIL:', f.key, e.message); }
  if (f.exclude) { try { new RegExp(f.exclude, 'i'); } catch(e) { console.log('FAIL exclude:', f.key, e.message); } }
  for (const s of f.subs||[]) {
    try { new RegExp(s.re, 'i'); } catch(e) { console.log('FAIL sub:', f.key, s.key, e.message); }
  }
}
console.log('All regex OK');
"
```

### 6.3 受影响的 vitest 测试
```bash
# 只跑受影响的测试文件
env -u NODE_OPTIONS npx vitest run --config vitest.tmp.config.mjs src/lib/problemTypeClassifier.test.js src/lib/ticketTagging.quotaJourney.test.js
```

### 验证不通过的后果
- 语法错误 → 不 commit，报告错误
- 正则编译失败 → 不 commit，报告失败的 key
- 测试失败 → 不 commit，报告失败的测试用例

## Step 7: Commit

**前置条件**：Step 6 全部通过。

```bash
# 暂存修改的文件（具名路径，不用 git add .）
git add scripts/elb-taxonomy-curated.json scripts/ct-taxonomy-curated.json

# 提交（commit message 标注 auto-reviewed）
git commit -m "$(cat <<'EOF'
fix(taxonomy): <产品> curated 正则补词修复未归类/误归属 [auto-reviewed]

<具体补了什么词，修复了什么问题>
EOF
)"
```

### Commit message 规范
- type: `fix(taxonomy)` 或 `fix(classifier)`
- subject: 简述修复内容
- body: 列出具体补词和修复的问题
- 标注 `auto-reviewed` 表示经过自动化批判性复核+深度验证
- 不加 `Changelog: skip` trailer（这类 fix 应进入更新动态）

## 异常处理

### 流水线未跑完
如果 11:50 拉取时 pipeline-summary.json 的 runDate 不是今天：
1. 等待 5 分钟
2. 重新拉取
3. 最多重试 6 次（到 12:20）
4. 仍失败 → 通知用户"部署环境流水线可能未在 11:30 正常启动，请检查 cron"

### 拉取失败
- HTTP 000（网络不通）→ 通知用户"部署环境不可达"
- HTTP 401/403（认证失败）→ 通知用户"登录凭据无效"
- HTTP 500 → 通知用户"部署环境服务端错误"

### 测试失败
- 不 commit
- 报告失败的测试文件、测试用例、错误信息
- 保留修改在工作区，等用户确认

### 批判性复核不通过
- 不 commit
- 报告"修复方案未通过批判性复核"及原因
- 给出修改建议
