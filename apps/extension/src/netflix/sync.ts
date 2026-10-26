// 在 Netflix 觀影動態頁同步觀看紀錄。觀影動態只有日期，所以改用每部作品 metadata 的 bookmark（精確到毫秒）。
import type { ImportResult } from '@agm/shared';
import type { SyncDeps } from '../lib/history-sync.ts';
import { describe } from '../lib/history-sync.ts';
import { netflixSyncItem, type HistorySyncState } from '../lib/storage.ts';
import { fetchMetadata, groupRows, type ActivityRow, type NetflixTitle } from './parse.ts';

/** 查 metadata 的間隔，避免對 Netflix 造成負擔 */
const FETCH_INTERVAL_MS = 1000;
const MAX_LOOKUPS = 200;
const CHUNK = 500;

export async function syncViewingActivity(deps: SyncDeps, rows: ActivityRow[]): Promise<HistorySyncState> {
  const state = await netflixSyncItem.getValue();
  const finish = async (patch: Partial<HistorySyncState>) => {
    const next: HistorySyncState = { ...state, ...patch, lastRunAt: new Date().toISOString(), runningSince: undefined };
    await netflixSyncItem.setValue(next);
    return next;
  };

  try {
    if (!(await deps.query('GET', '/health')).ok) return await finish({ ok: false, message: '本機 server 未啟動' });

    // 每組先查第一筆；同組裡不屬於該作品的（名稱剛好相同）再個別查
    const titles = new Map<string, NetflixTitle>();
    const covered = new Set<string>();
    const pending = [...groupRows(rows).values()].map((g) => g.map((r) => r.videoId));
    let lookups = 0;
    let missing = 0;
    for (const group of pending) {
      for (const videoId of group) {
        if (covered.has(videoId)) continue;
        if (lookups >= MAX_LOOKUPS) {
          missing++;
          continue;
        }
        if (lookups > 0) await new Promise((r) => setTimeout(r, FETCH_INTERVAL_MS));
        lookups++;
        deps.onProgress?.(`讀取作品資料… ${titles.size + 1} 部`);
        const title = await fetchMetadata(deps.fetch, videoId);
        if (!title) {
          missing++;
          continue;
        }
        titles.set(title.anime.animeSn, title);
        for (const id of title.labels.keys()) covered.add(id);
        if (!covered.has(videoId)) missing++;
      }
    }

    deps.onProgress?.('寫入本機…');
    for (const t of titles.values()) {
      const res = await deps.query('POST', '/netflix/anime', t.anime);
      if (!res.ok) return await finish({ ok: false, message: res.offline ? '本機 server 未啟動' : `寫入失敗：${res.error ?? res.status}` });
    }
    const items = [...titles.values()].flatMap((t) => t.watches);
    const total: ImportResult = { imported: 0, updated: 0, skipped: 0 };
    for (let i = 0; i < items.length; i += CHUNK) {
      const res = await deps.query<ImportResult>('POST', '/netflix/import', { items: items.slice(i, i + CHUNK) });
      if (!res.ok) return await finish({ ok: false, message: res.offline ? '本機 server 未啟動' : `寫入失敗：${res.error ?? res.status}` });
      total.imported += res.data.imported;
      total.updated += res.data.updated;
      total.skipped += res.data.skipped;
    }
    const note = missing ? `，${missing} 筆找不到作品資料` : '';
    return await finish({ ok: true, message: `${titles.size} 部作品：${describe(total)}${note}`, result: total });
  } catch (e) {
    return await finish({ ok: false, message: `同步失敗：${String(e)}` });
  }
}
