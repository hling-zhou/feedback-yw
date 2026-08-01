# 首次提交到 Git 远程仓库

本文档供**第一次**将本仓库推送到 GitHub / GitLab 等远程时使用。日常开发见 [README.md](../README.md)。

---

## 1. 推送前自检（本地）

```bash
cd /path/to/feedback-insights

# 确认无敏感文件将被提交
git status
git diff --stat

# 门禁（与 CI 一致）
export JWT_SECRET="$(openssl rand -base64 32)"
npm test && npm run build
```

**切勿提交**：`.env`、`server/data/*.db`、真实 API Key、生产 `JWT_SECRET` / 管理员密码。以上已在 [.gitignore](../.gitignore) 中忽略。

**注意**：`data/` 目录（业务规则 Markdown 等）当前也在 `.gitignore` 中，**不会**进入远程仓库。若团队需要共享 `data/*.md` 规范文档，推送前需从 `.gitignore` 移除 `data/` 并单独 `git add data/`（勿含真实工单样本）。

---

## 2. 确认本地提交已就绪

```bash
git log -5 --oneline
git status   # 应显示 working tree clean
```

若有未提交改动：

```bash
git add -A
git status   # 再次确认无 .env / *.db
git commit
```

**提交说明规范（影响“更新动态”）**：

- 默认约定：没有明确说明不写入更新动态时，用户可见改动请使用 `feat:` 或 `fix:` 提交。
- 推荐使用 Conventional Commit：`feat(scope): 标题`、`fix(scope): 标题`。
- commit `subject` 会显示为更新动态标题；commit `body` 会显示为更新动态摘要。
- 若只写一行标题、不写 body，更新动态里通常只能看到标题，看不到详情。
- 若不希望进入更新动态，在 commit body 末尾加：`Changelog: skip`
- 若是 `docs:` / `chore:` 等非默认类型，但仍希望进入更新动态，在 commit body 末尾加：`Changelog: show`

推荐示例：

```text
feat(workbench): 升级洞察工作台与用后即评月报流程

- 重构工作台故事化展示结构
- 新增用后即评月报预览与导入链路
- 优化分析维度与产品配置相关交互
```

---

## 3. 在远程创建空仓库

在 GitHub / GitLab 新建**空仓库**（不要勾选「Initialize with README」，避免无关首次 merge）。

记下远程 URL，例如：

- HTTPS：`https://github.com/<org>/feedback-insights.git`
- SSH：`git@github.com:<org>/feedback-insights.git`

---

## 4. 关联远程并首次推送

当前默认分支为 `main`：

```bash
git remote add origin https://github.com/<org>/feedback-insights.git
git remote -v

# 首次推送并设置上游
git push -u origin main
```

若远程默认分支为 `master` 且需对齐：

```bash
git branch -M main
git push -u origin main
```

---

## 5. 推送后验证

1. 远程仓库页面可见最新 commit 与文件树。
2. 若已启用 GitHub Actions：在 **Actions** 查看 `ci` workflow 是否通过（`npm test` + `npm run build`）。
3. 克隆到新目录试跑（可选）：

```bash
cd /tmp
git clone https://github.com/<org>/feedback-insights.git fi-check
cd fi-check
npm ci
export JWT_SECRET="$(openssl rand -base64 32)"
export ADMIN_INITIAL_PASSWORD="$(openssl rand -base64 18)"
npm test
```

---

## 6. 常见问题

| 情况 | 处理 |
|------|------|
| `remote origin already exists` | `git remote set-url origin <新 URL>` |
| 推送被拒（non-fast-forward） | 远程已有 commit：勿 `push --force` 到 main；先 `git pull --rebase origin main` 或换空仓库 |
| CI 失败 | 本地 `npm test && npm run build` 复现并修复后再 push |
| 大文件 / 二进制误提交 | `git rm --cached <file>` 后补 `.gitignore` 再 commit |

---

## 7. 后续协作（可选）

```bash
# 新功能分支
git checkout -b feature/your-topic
git push -u origin feature/your-topic
gh pr create --title "..." --body "..."
```

需安装 [GitHub CLI](https://cli.github.com/) 时使用 `gh`；否则在网页创建 Pull Request。
