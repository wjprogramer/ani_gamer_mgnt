import { storage } from '#imports';
import { DEFAULT_SERVER_URL, type ImportResult, type Source } from '@agm/shared';

export type HideMode = 'collapse' | 'remove';

export interface QueueItem {
  id: string;
  /** 相同 key 的項目只保留最新一筆（例如同一筆觀看紀錄的進度更新） */
  key?: string;
  method: string;
  path: string;
  body?: unknown;
  tries: number;
}

export const serverUrlItem = storage.defineItem<string>('local:serverUrl', { fallback: DEFAULT_SERVER_URL });
export const hideModeItem = storage.defineItem<HideMode>('local:hideMode', { fallback: 'collapse' });
/** 暫時顯示全部（已隱藏的會淡化顯示） */
export const showHiddenItem = storage.defineItem<boolean>('local:showHidden', { fallback: false });
/** 已隱藏的動畫瘋 animeSn；server 離線時也能隱藏 */
export const hiddenSnsItem = storage.defineItem<string[]>('local:hiddenSns', { fallback: [] });
/** 已隱藏的 Netflix 作品 ID */
export const hiddenNetflixItem = storage.defineItem<string[]>('local:hiddenNetflix', { fallback: [] });
export const hiddenItems = { bahamut: hiddenSnsItem, netflix: hiddenNetflixItem } satisfies Record<Source, unknown>;
export const serverOnlineItem = storage.defineItem<boolean>('local:serverOnline', { fallback: false });
/** server 離線時暫存的寫入請求 */
export const queueItem = storage.defineItem<QueueItem[]>('local:queue', { fallback: [] });

export interface HistorySyncState {
  lastRunAt?: string;
  ok?: boolean;
  message?: string;
  result?: ImportResult;
  /** 已同步到的最新觀看時間，下次只需讀到這裡 */
  latestWatchedAt?: string;
  /** 同步進行中（避免背景與觀看紀錄頁同時執行） */
  runningSince?: string;
}

/** 定時同步動畫瘋觀看紀錄 */
export const autoSyncItem = storage.defineItem<boolean>('local:autoSyncHistory', { fallback: true });
export const historySyncItem = storage.defineItem<HistorySyncState>('local:historySync', { fallback: {} });
/** Netflix 觀影動態頁的同步結果 */
export const netflixSyncItem = storage.defineItem<HistorySyncState>('local:netflixSync', { fallback: {} });
