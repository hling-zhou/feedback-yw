# 02 · Git 提交约定

> 本项目不自动提交：修改文件后只改不提交，等用户明确说"提交"才执行 git commit（2026-09-09 用户约定）。
> 提交时遵守 commit-hygiene 规则（原文如下，源文件在 AI 工具环境 ~/Downloads/commit-hygiene.md，此处为入库版）。

## Commit Hygiene

Gate commits so the staged file set matches the user's intent and the message matches the staged diff. Do not invent a commit style; match the repo's recent log. Do not run reviews or tests unless the user asked.

### 1. Inspect

Run these in parallel before staging or committing. Treat the diffs as the source of truth; do not reread business code to guess what changed.

- `git status`
- `git diff` and `git diff --staged`
- `git log -8 --oneline`

If there is nothing to commit, stop. Do not create an empty commit.

### 2. Classify every path

| Class | Meaning | Action |
|---|---|---|
| intended | Matches the user's request for this commit | Eligible to stage |
| leftover | Unrelated dirty files, old debug output, drafts | Exclude; name them in the reply |
| secret | `.env`, `credentials.json`, tokens, keys, secrets | Exclude; warn by name. If the user asks to commit them, refuse |

Never stage leftover or secret paths.

### 3. Accuracy gates

Stop and ask; do not commit if any gate fails:

- **One intent.** Import-parser work mixed with an unrelated UI refactor is two commits. Ask whether to split.
- **Message ⊆ staged diff.** Every claim in the message must be provable from the staged diff. "Fix password parsing" is invalid if the staged diff has no parsing change.
- **Message does not describe unstaged work.** Unstaged or excluded files stay out of the message.

### 4. Stage and commit

- Stage only named paths. Never `git add .`, `git add -A`, or `git add -i`.
- Message: 1–2 sentences that state **why**. Pass it via HEREDOC.
- Do not push.
- Do not amend unless the user explicitly asked and the existing amend safety conditions are met.
- If a hook rejects the commit, fix the issue and create a **new** commit. Do not amend.
- After the commit, run `git status` and confirm the intended files landed and leftovers remain unstaged.

### Message examples

Good (matches a focused staged diff):

```text
Keep import password handling out of the parsed row payload.

The password is only needed to open the file; storing it on each row
made later merges treat it as a data field.
```

Bad (vague; not provable from any specific diff):

```text
Update files and fix bugs.
```

Bad (message wider than one intent, or names files that should not be in this commit):

```text
Add password support, refactor catalog panel, and update resume draft.
```

## 项目附加提交约定

- **不 push**：push 仅在用户明确指令时执行（11-10 实例：本地领先 origin 多个 commit 常态化存在）。
- **amend 仅限用户明确指令**（如补 trailer），且仅限未 push 的提交。
- **更新动态只收录 feat/fix**（11-11 拍板）：chore/docs/test 等类型代码层天然不收录（`WHATS_NEW_INCLUDED_TYPES = new Set(['feat','fix'])`），**无需加 skip trailer**；`Changelog: skip` 只用于"会被收录但属维护性质"的 feat/fix（如纯改名/重构/构建修复类）。whats-new 由 prebuild 生成，范围 `scripts/whats-new.since..HEAD` 勿前移；`commitToWhatsNewItem` 可 node import 实测验证一条 commit 是否会入选。先例：a6e8403 全局改名 feat 带 `Changelog: skip`。
- **纯改名批的"非改名行"核对方法**（11-10 沉淀）：diff 的 -/+ 行整行含新旧词（替换对），逐文件 `grep -cv` 会产生残留计数错觉；正确做法 = 过滤"含任一词"的行后看剩余是否为空 + 抽查大 diff 文件人工确认。
