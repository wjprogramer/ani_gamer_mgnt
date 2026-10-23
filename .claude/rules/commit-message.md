# Commit 訊息規範

本專案所有 git commit 訊息必須遵守以下規則（建立 commit 時請使用 `/commit` skill）：

- **語言**：以繁體中文為主；程式碼識別字、套件名稱、檔名、專有名詞可保留英文。
- **格式**：`<gitmoji> <簡短描述>`，例如 `✨ 新增動畫清單匯出功能`。
- **gitmoji**：每則 commit 開頭必須是一個 gitmoji（使用 Unicode emoji，不使用 `:sparkles:` 形式）。
- **標題**：不超過 50 個字元，句尾不加句號，以動詞開頭描述「做了什麼」。
- **內文（選填）**：標題後空一行，條列說明「為什麼」與重要細節。
- 一個 commit 只做一件事；若變更涵蓋多種類型，應拆成多個 commit。

## 自動 commit 與 push

本專案已授權 Claude **自動 commit 並 push**，不需事先詢問：

- 完成一個段落的變更後，直接依上述規範建立 commit，並 `git push` 到目前分支的遠端。
- 若尚未設定 upstream，使用 `git push -u origin <目前分支>`；若沒有任何 remote，只 commit 並告知使用者。
- 仍不可 force push、不可改寫已 push 的歷史、不可跳過 hook；push 失敗時回報原因而非強制覆蓋。

完整 gitmoji 對照表與範例見 `.claude/skills/commit/SKILL.md`。
