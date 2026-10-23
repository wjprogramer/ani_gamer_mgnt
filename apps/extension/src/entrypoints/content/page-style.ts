// 注入動畫瘋頁面的樣式（卡片按鈕、標章、提示）。評論面板在 shadow root 內，樣式另見 panel.css。
const CSS = `
.agm-card { position: relative !important; }
.agm-controls {
  position: absolute; top: 6px; left: 6px; z-index: 20;
  display: flex; gap: 4px; pointer-events: auto;
}
a.text-anime-info .agm-controls { position: static; display: inline-flex; margin-left: 6px; vertical-align: middle; }
.agm-btn {
  all: unset; cursor: pointer; pointer-events: auto;
  font: 12px/1.6 system-ui, "Microsoft JhengHei", sans-serif; color: #fff;
  background: rgba(0, 0, 0, .65); padding: 0 8px; border-radius: 10px;
  opacity: 0; transition: opacity .15s;
}
.agm-card:hover .agm-btn, .agm-btn:focus-visible, .agm-dim .agm-btn { opacity: 1; }
.agm-btn:hover { background: #cf222e; }
.agm-badge {
  position: absolute; top: 6px; right: 6px; z-index: 20; pointer-events: none;
  font: 600 12px/1.6 system-ui, "Microsoft JhengHei", sans-serif; color: #fff;
  background: rgba(9, 105, 218, .9); padding: 0 8px; border-radius: 10px;
}
.agm-badge.agm-done { background: rgba(26, 127, 55, .9); }
a.text-anime-info .agm-badge { position: static; display: inline-block; margin-left: 6px; }
.agm-hidden { display: none !important; }
.agm-dim { opacity: .35; }
.agm-dim:hover { opacity: .8; }
.agm-placeholder {
  display: flex; align-items: center; gap: 8px; box-sizing: border-box;
  margin: 4px 0; padding: 4px 10px; border: 1px dashed #8c959f; border-radius: 6px;
  font: 13px/1.6 system-ui, "Microsoft JhengHei", sans-serif; color: #8c959f;
}
.agm-placeholder span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
.agm-placeholder button {
  all: unset; cursor: pointer; color: #0969da; flex: none;
}
.agm-placeholder button:hover { text-decoration: underline; }
.agm-import {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin: 8px 0 16px; padding: 10px 14px; border: 1px solid #0969da; border-radius: 8px;
  font: 14px/1.6 system-ui, "Microsoft JhengHei", sans-serif;
}
.agm-import span { flex: 1; min-width: 200px; }
.agm-import button {
  cursor: pointer; border: none; border-radius: 6px; padding: 4px 12px;
  background: #0969da; color: #fff; font: inherit;
}
.agm-import button:disabled { opacity: .5; cursor: default; }
.agm-toast {
  position: fixed; top: 16px; right: 16px; z-index: 2147483647; max-width: 360px;
  padding: 10px 14px; border-radius: 8px; background: #cf222e; color: #fff;
  font: 14px/1.6 system-ui, "Microsoft JhengHei", sans-serif; box-shadow: 0 4px 12px rgba(0,0,0,.25);
  cursor: pointer;
}
`;

export function injectPageStyle() {
  if (document.getElementById('agm-style')) return;
  const style = document.createElement('style');
  style.id = 'agm-style';
  style.textContent = CSS;
  document.head.append(style);
}
