import type { ImportResult } from '@agm/shared';
import { parseHistoryPage } from '../../bahamut/history.ts';
import { query } from '../../lib/messages.ts';

const CHUNK = 500;

/** 在觀看紀錄頁加上「匯入」按鈕；只有使用者按下才會匯入 */
export function initHistoryImport(signal: AbortSignal) {
  const anchor = document.querySelector('.theme-title-block');
  if (!anchor) return;

  const bar = document.createElement('div');
  bar.className = 'agm-import';
  const text = document.createElement('span');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '匯入到動畫瘋管理工具';
  bar.append(text, btn);
  anchor.after(bar);
  signal.addEventListener('abort', () => bar.remove());

  const describe = () => {
    const { items, animeCount } = parseHistoryPage(document);
    text.textContent = `目前頁面已載入 ${animeCount} 部動畫、${items.length} 筆紀錄。要匯入更早的紀錄，請先按頁面底部的展開按鈕載入。`;
  };
  describe();
  // 只觀察列表本身；觀察 body 會因為更新 bar 的文字而無限觸發
  const list = document.querySelector('.history-wrapper');
  if (list) {
    const observer = new MutationObserver(() => !btn.disabled && describe());
    observer.observe(list, { childList: true, subtree: true });
    signal.addEventListener('abort', () => observer.disconnect());
  }

  btn.addEventListener('click', async () => {
    const { items } = parseHistoryPage(document);
    if (!items.length) return;
    btn.disabled = true;
    const total: ImportResult = { imported: 0, skipped: 0 };
    for (let i = 0; i < items.length; i += CHUNK) {
      text.textContent = `匯入中… ${i} / ${items.length}`;
      const res = await query<ImportResult>('POST', '/bahamut/import', { items: items.slice(i, i + CHUNK) });
      if (!res.ok) {
        text.textContent = res.offline
          ? '本機 server 未啟動，請先執行 npm start 再匯入。'
          : `匯入失敗：${res.error ?? res.status}`;
        btn.disabled = false;
        return;
      }
      total.imported += res.data.imported;
      total.skipped += res.data.skipped;
    }
    text.textContent = `匯入完成：新增 ${total.imported} 筆，略過 ${total.skipped} 筆已存在的紀錄。`;
    btn.disabled = false;
  });
}
