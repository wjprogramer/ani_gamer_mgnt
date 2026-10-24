import { query } from '../../lib/messages.ts';
import { syncHistory, type SyncDeps } from '../../lib/history-sync.ts';

/**
 * 開啟觀看紀錄頁時自動同步，並提供「完整同步」按鈕。
 * 在頁面裡讀 API（與頁面本身相同的來源與登入狀態），不依賴背景能否帶上 cookie。
 */
export function initHistoryImport(signal: AbortSignal) {
  const anchor = document.querySelector('.theme-title-block');
  if (!anchor) return;

  const bar = document.createElement('div');
  bar.className = 'agm-import';
  const text = document.createElement('span');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '完整同步';
  btn.title = '重新讀取全部觀看紀錄（約一年內）';
  bar.append(text, btn);
  anchor.after(bar);
  signal.addEventListener('abort', () => bar.remove());

  const deps: SyncDeps = {
    fetch: (input, init) => fetch(input, init),
    query,
    onProgress: (t) => (text.textContent = t),
  };

  const run = async (full: boolean) => {
    btn.disabled = true;
    const state = await syncHistory(deps, full);
    if (signal.aborted) return;
    text.textContent = state.runningSince
      ? '背景正在同步，請稍後重新整理。'
      : `${state.ok ? '已同步到本機' : '同步失敗'}：${state.message ?? ''}`;
    btn.disabled = false;
  };
  btn.addEventListener('click', () => void run(true));
  void run(false);
}
