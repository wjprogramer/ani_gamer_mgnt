# 文件規範

本專案的文件一律使用 **HTML** 撰寫，不使用 Markdown。

- **位置**：文件放在 `docs/` 目錄下，副檔名為 `.html`。
- **語言**：以繁體中文為主，`<html lang="zh-Hant">`。
- **基本結構**：每份文件都是完整的 HTML 檔，包含 `<!doctype html>`、`<meta charset="utf-8">`、`<meta name="viewport" content="width=device-width, initial-scale=1">` 與 `<title>`。
- **自包含**：樣式寫在 `<style>` 內，不依賴外部 CSS／JS，直接用瀏覽器開檔就能閱讀。
- **語意化標籤**：使用 `<h1>`～`<h3>`、`<section>`、`<table>`、`<pre><code>` 等標籤，不要用 `<div>` 堆版面。
- 新增或更新文件時，commit 使用 📝 gitmoji（見 `commit-message.md`）。
