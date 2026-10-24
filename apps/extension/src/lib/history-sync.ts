// 同步動畫瘋觀看紀錄到本機 server。背景定時執行，開啟觀看紀錄頁時也會執行。
import type { BahamutImportItem, ImportResult } from '@agm/shared';
import { fetchHistory, HistoryApiError } from '../bahamut/history.ts';
import type { QueryResult } from './messages.ts';
import { historySyncItem, type HistorySyncState } from './storage.ts';
import { LOCK_MS } from './sync-due.ts';

const CHUNK = 500;
/** 增量同步往前多讀的範圍：最近一集的進度可能在開始觀看很久之後才更新 */
const SINCE_MARGIN_MS = 24 * 3_600_000;

export interface SyncDeps {
  fetch: typeof fetch;
  query: <T>(method: string, path: string, body?: unknown) => Promise<QueryResult<T>>;
  onProgress?: (text: string) => void;
}

/** full：讀完所有頁；否則只讀上次同步之後的部分 */
export async function syncHistory(deps: SyncDeps, full = false): Promise<HistorySyncState> {
  const state = await historySyncItem.getValue();
  if (state.runningSince && Date.now() - Date.parse(state.runningSince) < LOCK_MS) return state;
  await historySyncItem.setValue({ ...state, runningSince: new Date().toISOString() });

  const finish = async (patch: Partial<HistorySyncState>) => {
    const next: HistorySyncState = { ...state, ...patch, lastRunAt: new Date().toISOString(), runningSince: undefined };
    await historySyncItem.setValue(next);
    return next;
  };

  try {
    const health = await deps.query('GET', '/health');
    if (!health.ok) return await finish({ ok: false, message: '本機 server 未啟動' });

    const since =
      !full && state.latestWatchedAt
        ? new Date(Date.parse(state.latestWatchedAt) - SINCE_MARGIN_MS).toISOString()
        : undefined;
    deps.onProgress?.('讀取動畫瘋觀看紀錄…');
    const items = await fetchHistory({
      fetch: deps.fetch,
      since,
      onPage: (page, total) => deps.onProgress?.(`讀取動畫瘋觀看紀錄… ${page} / ${total} 頁`),
    });

    const total: ImportResult = { imported: 0, updated: 0, skipped: 0 };
    for (let i = 0; i < items.length; i += CHUNK) {
      deps.onProgress?.(`寫入本機… ${i} / ${items.length}`);
      const res = await deps.query<ImportResult>('POST', '/bahamut/import', { items: items.slice(i, i + CHUNK) });
      if (!res.ok) {
        return await finish({
          ok: false,
          message: res.offline ? '本機 server 未啟動' : `寫入失敗：${res.error ?? res.status}`,
        });
      }
      total.imported += res.data.imported;
      total.updated += res.data.updated;
      total.skipped += res.data.skipped;
    }
    return await finish({
      ok: true,
      message: describe(total),
      result: total,
      latestWatchedAt: latestOf(items) ?? state.latestWatchedAt,
    });
  } catch (e) {
    const message = e instanceof HistoryApiError ? e.message : `同步失敗：${String(e)}`;
    return await finish({ ok: false, message });
  }
}

function latestOf(items: BahamutImportItem[]) {
  return items.reduce<string | undefined>((max, i) => (!max || i.watchedAt > max ? i.watchedAt : max), undefined);
}

export function describe(r: ImportResult) {
  return `新增 ${r.imported} 筆、更新進度 ${r.updated} 筆、已存在 ${r.skipped} 筆`;
}
