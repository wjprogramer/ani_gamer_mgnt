# 公開 repo 注意事項

本 repo 是 public，所有 commit 的內容都會公開：

- 不可提交個資或機敏資料：帳號名稱、email、密碼、token、cookie、真實的觀看紀錄、本機絕對路徑（例如 `C:\Users\...`）。
- 從使用者登入狀態取得的頁面（例如觀看紀錄頁）只能擷取**結構片段**當 fixture，帳號資訊要移除，時間等內容要換成虛構值。
- 使用者提供的原始頁面檔（例如 `tmp.html`）用完即刪，不可 commit；`tmp*.html` 已加入 `.gitignore`。
- 本機資料 `data/`（資料庫、封面）不可 commit，已加入 `.gitignore`。
- commit 前檢查 `git status` 與 diff，確認沒有上述內容。
