// Netflix 頁面與 API 解析。調查結果見 docs/netflix.html，網站改版時優先檢查這個檔案。
import { COMPLETED_RATIO, MOVIE_LABEL, type BahamutAnimeUpsert, type BahamutImportItem } from '@agm/shared';
import type { CardInfo } from '../bahamut/parse.ts';

export const METADATA_API = 'https://www.netflix.com/nq/website/memberapi/release/metadata';
export { MOVIE_LABEL };

// ---- 卡片 ----

/** class 名稱是編譯產生的雜湊值，只能靠 data-uia */
const CARD_SELECTOR = 'a[data-uia="standard-card"][href*="jbv="], a[data-uia="ranked-card"][href*="jbv="]';

export function findNetflixCards(root: ParentNode): CardInfo[] {
  // 卡片圖片是橫式縮圖，封面改用 metadata 的直式 boxart（播放或同步時取得）
  return [...root.querySelectorAll<HTMLAnchorElement>(CARD_SELECTOR)].map((el) => ({
    el,
    animeSn: el.getAttribute('href')?.match(/[?&]jbv=(\d+)/)?.[1],
    title: el.getAttribute('aria-label')?.trim() ?? '',
  }));
}

// ---- 頁面 ----

export function watchVideoId(url: string): string | undefined {
  return url.match(/^https:\/\/www\.netflix\.com\/watch\/(\d+)/)?.[1];
}

export function isViewingActivityPage(url: string): boolean {
  return /^https:\/\/www\.netflix\.com\/viewingactivity/.test(url);
}

export interface ActivityRow {
  videoId: string;
  /** 「作品：第 N 季：集名」，電影只有名稱 */
  title: string;
  /** 頁面上的日期文字，例如「26/10/24」 */
  date: string;
}

export function parseViewingActivity(root: ParentNode): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (const li of root.querySelectorAll('li.retableRow')) {
    const a = li.querySelector('.col.title a');
    const videoId = a?.getAttribute('href')?.match(/\/title\/(\d+)/)?.[1];
    if (!videoId) continue;
    rows.push({ videoId, title: a!.textContent?.trim() ?? '', date: li.querySelector('.col.date')?.textContent?.trim() ?? '' });
  }
  return rows;
}

/** 依名稱的第一段（作品名）分組，每組只需查一次 metadata */
export function groupRows(rows: ActivityRow[]): Map<string, ActivityRow[]> {
  const groups = new Map<string, ActivityRow[]>();
  for (const r of rows) {
    const key = r.title.split('：')[0]!.trim();
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return groups;
}

// ---- metadata API ----

interface Bookmark {
  /** 播放位置（秒） */
  offset?: number;
  /** 最後觀看時間（毫秒） */
  watchedDate?: number;
}

interface MetaEpisode {
  id: number;
  episodeId?: number;
  seq: number;
  title?: string;
  runtime?: number;
  creditsOffset?: number;
  watchedToEndOffset?: number;
  bookmark?: Bookmark;
}

interface MetaVideo {
  id: number;
  type: 'show' | 'movie' | string;
  title: string;
  boxart?: { w: number; h: number; url: string }[];
  seasons?: { id: number; seq: number; episodes: MetaEpisode[] }[];
  runtime?: number;
  creditsOffset?: number;
  watchedToEndOffset?: number;
  bookmark?: Bookmark;
}

export interface MetadataResponse {
  video?: MetaVideo;
}

export interface NetflixTitle {
  anime: BahamutAnimeUpsert;
  /** 依影片 ID 查集數名稱 */
  labels: Map<string, string>;
  /** 有觀看紀錄（bookmark）的集數 */
  watches: BahamutImportItem[];
}

function coverOf(v: MetaVideo) {
  const best = [...(v.boxart ?? [])].sort((a, b) => b.w - a.w)[0];
  return best?.url.startsWith('https://') ? best.url : undefined;
}

function watchOf(
  animeSn: string,
  title: string,
  coverUrl: string | undefined,
  videoSn: string,
  label: string,
  ep: { runtime?: number; creditsOffset?: number; watchedToEndOffset?: number; bookmark?: Bookmark },
): BahamutImportItem | undefined {
  const seen = ep.bookmark?.watchedDate;
  if (!seen) return undefined;
  const offset = Math.max(0, ep.bookmark?.offset ?? 0);
  const runtime = ep.runtime ?? 0;
  const endAt = ep.watchedToEndOffset ?? ep.creditsOffset ?? runtime * COMPLETED_RATIO;
  return {
    animeSn,
    title,
    coverUrl,
    videoSn,
    episodeLabel: label,
    // Netflix 只記最後觀看時間與位置，開始時間以「最後觀看時間 − 播放位置」推算
    watchedAt: new Date(seen - offset * 1000).toISOString(),
    lastSeenAt: new Date(seen).toISOString(),
    progressSec: offset,
    durationSec: runtime,
    completed: endAt > 0 && offset >= endAt,
  };
}

export function parseMetadata(json: MetadataResponse): NetflixTitle | undefined {
  const v = json.video;
  if (!v?.id || !v.title) return undefined;
  const animeSn = String(v.id);
  const coverUrl = coverOf(v);
  const labels = new Map<string, string>();
  const episodes: NonNullable<BahamutAnimeUpsert['episodes']> = [];
  const watches: BahamutImportItem[] = [];

  if (v.type === 'movie' || !v.seasons?.length) {
    labels.set(animeSn, MOVIE_LABEL);
    episodes.push({ videoSn: animeSn, label: MOVIE_LABEL, sortOrder: 0 });
    const w = watchOf(animeSn, v.title, coverUrl, animeSn, MOVIE_LABEL, v);
    if (w) watches.push(w);
  } else {
    const multiSeason = v.seasons.length > 1;
    for (const season of v.seasons) {
      for (const ep of season.episodes) {
        const videoSn = String(ep.id ?? ep.episodeId);
        const label = multiSeason ? `第 ${season.seq} 季第 ${ep.seq} 集` : String(ep.seq);
        labels.set(videoSn, label);
        episodes.push({ videoSn, label, sortOrder: season.seq * 1000 + ep.seq });
        const w = watchOf(animeSn, v.title, coverUrl, videoSn, label, ep);
        if (w) watches.push(w);
      }
    }
  }
  return { anime: { animeSn, title: v.title, coverUrl, episodes }, labels, watches };
}

export async function fetchMetadata(fetchFn: typeof fetch, videoId: string): Promise<NetflixTitle | undefined> {
  const res = await fetchFn(`${METADATA_API}?movieid=${videoId}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`Netflix 回應 ${res.status}`);
  return parseMetadata((await res.json()) as MetadataResponse);
}
