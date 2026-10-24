// 動畫瘋觀看紀錄。頁面 viewList.php 的內容是由 API 載入的，直接讀 API，結構見 docs/bahamut-dom.html 第 5 節。
import type { BahamutImportItem } from '@agm/shared';

export const HISTORY_API = 'https://api.gamer.com.tw/anime/v3/history.php';
/** 翻頁間隔，避免對動畫瘋造成負擔 */
const PAGE_INTERVAL_MS = 1000;

export function isHistoryPage(url: string): boolean {
  return /^https:\/\/ani\.gamer\.com\.tw\/viewList\.php/.test(url);
}

interface ApiEpisode {
  videoSn: number;
  /** 例如「殺手旅店 [16]」 */
  title: string;
  watchTime: string;
}

interface ApiAnime {
  animeSn: number;
  /** 最近看的那一集 */
  videoSn: number;
  title: string;
  cover?: string;
  episode?: string;
  /** 片長（分鐘） */
  duration?: number;
  watchTime: string;
  /** 最近那一集的進度：秒數，-1 表示看完；watchTime 是最後回報進度的時間 */
  breakPoint?: { breakPoint?: number; watchTime?: string } | [];
  /** 各集最近一次的觀看時間，新到舊；重看同一集會覆蓋舊的時間 */
  history?: ApiEpisode[];
}

export interface ApiResponse {
  data?: { history: ApiAnime[]; totalPage: number };
  error?: { code: number; message: string; status?: string };
}

export class HistoryApiError extends Error {
  constructor(
    message: string,
    readonly status?: string,
  ) {
    super(message);
  }
}

/** API 的時間是台灣時間、沒有時區，例如「2026-10-24 10:24:58」 */
export function parseApiTime(text: string): string | undefined {
  const m = text.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/);
  return m ? new Date(`${m[1]}T${m[2]}+08:00`).toISOString() : undefined;
}

export function parseHistoryResponse(json: ApiResponse): {
  items: BahamutImportItem[];
  animeCount: number;
  totalPage: number;
  oldest?: string;
} {
  if (!json.data) {
    const e = json.error;
    throw new HistoryApiError(e?.status === 'NO_LOGIN' ? '尚未登入動畫瘋' : (e?.message ?? '無法讀取觀看紀錄'), e?.status);
  }
  const items: BahamutImportItem[] = [];
  let oldest: string | undefined;
  for (const anime of json.data.history) {
    const animeSn = String(anime.animeSn);
    const coverUrl = anime.cover?.startsWith('https://') ? anime.cover : undefined;
    const latest = parseApiTime(anime.watchTime);
    if (latest && (!oldest || latest < oldest)) oldest = latest;

    const bp = Array.isArray(anime.breakPoint) ? undefined : anime.breakPoint;
    let latestUsed = false;
    for (const ep of anime.history ?? []) {
      const watchedAt = parseApiTime(ep.watchTime);
      if (!watchedAt) continue;
      const item: BahamutImportItem = {
        animeSn,
        title: anime.title,
        coverUrl,
        videoSn: String(ep.videoSn),
        episodeLabel: ep.title.match(/\[([^\]]+)\]$/)?.[1],
        watchedAt,
      };
      // 進度只屬於最近一次觀看的那一集
      if (ep.videoSn === anime.videoSn && !latestUsed && typeof bp?.breakPoint === 'number') {
        latestUsed = true;
        if (bp.breakPoint < 0) item.completed = true;
        else item.progressSec = bp.breakPoint;
        if (anime.duration) item.durationSec = anime.duration * 60;
        const seen = bp.watchTime && parseApiTime(bp.watchTime);
        if (seen && seen > watchedAt) item.lastSeenAt = seen;
      }
      items.push(item);
    }
  }
  return { items, animeCount: json.data.history.length, totalPage: json.data.totalPage, oldest };
}

/**
 * 讀取觀看紀錄。列表依每部動畫最近的觀看時間由新到舊排列，
 * 有 since 時讀到比它更早的那一頁就停止。
 */
export async function fetchHistory(opts: {
  fetch: typeof fetch;
  since?: string;
  onPage?: (page: number, totalPage: number) => void;
}): Promise<BahamutImportItem[]> {
  const items: BahamutImportItem[] = [];
  for (let page = 1; ; page++) {
    if (page > 1) await new Promise((r) => setTimeout(r, PAGE_INTERVAL_MS));
    const res = await opts.fetch(`${HISTORY_API}?page=${page}`, { credentials: 'include' });
    if (!res.ok) throw new HistoryApiError(`動畫瘋回應 ${res.status}`);
    const result = parseHistoryResponse((await res.json()) as ApiResponse);
    items.push(...result.items);
    opts.onPage?.(page, result.totalPage);
    if (page >= result.totalPage || !result.animeCount) break;
    if (opts.since && result.oldest && result.oldest < opts.since) break;
  }
  return items;
}
