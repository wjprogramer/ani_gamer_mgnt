import { storage } from '#imports';
import { DEFAULT_SERVER_URL } from '@agm/shared';

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
/** 已隱藏的 animeSn；server 離線時也能隱藏 */
export const hiddenSnsItem = storage.defineItem<string[]>('local:hiddenSns', { fallback: [] });
export const serverOnlineItem = storage.defineItem<boolean>('local:serverOnline', { fallback: false });
/** server 離線時暫存的寫入請求 */
export const queueItem = storage.defineItem<QueueItem[]>('local:queue', { fallback: [] });
