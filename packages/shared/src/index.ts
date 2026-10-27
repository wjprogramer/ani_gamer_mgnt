import { z } from 'zod';

export { ulid } from 'ulid';

export const DEFAULT_PORT = 17890;
export const DEFAULT_SERVER_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
export const BAHAMUT = 'bahamut';
export const NETFLIX = 'netflix';
export const SOURCES = [BAHAMUT, NETFLIX] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABELS: Record<Source, string> = { bahamut: '動畫瘋', netflix: 'Netflix' };
/** 電影只有一集，以此為集數名稱 */
export const MOVIE_LABEL = '電影';
export const isSource = (s: string): s is Source => (SOURCES as readonly string[]).includes(s);
/** 進度達到片長的這個比例即視為看完 */
export const COMPLETED_RATIO = 0.85;

const sn = z.string().regex(/^\d+$/);
const isoTime = z.iso.datetime();

// ---- 請求 ----
// 以下 schema 各來源共用（路徑為 /api/<source>/...）。欄位沿用動畫瘋的命名：
// animeSn 是來源的作品 ID（Netflix 為 title ID），videoSn 是單集 ID（Netflix 為 video ID；電影與作品相同）。

export const bahamutAnimeUpsertSchema = z.object({
  animeSn: sn,
  acgSn: sn.optional(),
  title: z.string().min(1),
  coverUrl: z.url().optional(),
  tags: z.array(z.string()).optional(),
  episodes: z
    .array(z.object({ videoSn: sn, label: z.string(), sortOrder: z.number().int() }))
    .optional(),
});
export type BahamutAnimeUpsert = z.infer<typeof bahamutAnimeUpsertSchema>;

export const bahamutStatusRequestSchema = z.object({ animeSns: z.array(sn).max(500) });
export type BahamutStatusRequest = z.infer<typeof bahamutStatusRequestSchema>;

export const bahamutHideSchema = z.object({
  animeSn: sn,
  hidden: z.boolean(),
  title: z.string().optional(),
  coverUrl: z.url().optional(),
  at: isoTime,
});
export type BahamutHide = z.infer<typeof bahamutHideSchema>;

export const snMapLookupSchema = z.object({ videoSns: z.array(sn).max(500) });
export const snMapPutSchema = z.object({ entries: z.record(sn, sn) });
export type SnMap = Record<string, string>;

export const bahamutWatchSchema = z.object({
  id: z.string().min(1),
  animeSn: sn,
  animeTitle: z.string().min(1),
  videoSn: sn,
  episodeLabel: z.string().optional(),
  startedAt: isoTime,
  at: isoTime,
  progressSec: z.number().nonnegative(),
  durationSec: z.number().nonnegative(),
});
export type BahamutWatch = z.infer<typeof bahamutWatchSchema>;

/** 從來源網站的觀看紀錄匯入 */
export const bahamutImportSchema = z.object({
  items: z
    .array(
      z.object({
        animeSn: sn,
        title: z.string().min(1),
        coverUrl: z.url().optional(),
        videoSn: sn,
        episodeLabel: z.string().optional(),
        /** 開始觀看的時間（Netflix 為推算值） */
        watchedAt: isoTime,
        /** 最後一次回報進度的時間 */
        lastSeenAt: isoTime.optional(),
        progressSec: z.number().nonnegative().optional(),
        durationSec: z.number().nonnegative().optional(),
        completed: z.boolean().optional(),
      }),
    )
    .max(2000),
});
export type BahamutImport = z.infer<typeof bahamutImportSchema>;
export type BahamutImportItem = BahamutImport['items'][number];

export interface ImportResult {
  imported: number;
  /** 之前匯入過、這次進度有增加 */
  updated: number;
  /** 已存在（自動記錄或之前匯入過且沒有變化） */
  skipped: number;
}

export const reviewPutSchema = z
  .object({
    animeId: z.string().optional(),
    animeSn: sn.optional(),
    /** 搭配 animeSn 使用，預設為動畫瘋 */
    source: z.enum(SOURCES).optional(),
    episodeId: z.string().nullable().optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    content: z.string(),
    spoiler: z.boolean().default(false),
    createdAt: isoTime,
    updatedAt: isoTime,
  })
  .refine((r) => r.animeId || r.animeSn, { message: '需要 animeId 或 animeSn' });
export type ReviewPut = z.input<typeof reviewPutSchema>;

export const mergeSchema = z.object({
  /** 保留的作品 */
  targetId: z.string().min(1),
  /** 併入後刪除的作品 */
  sourceId: z.string().min(1),
});
export type MergeRequest = z.infer<typeof mergeSchema>;

export const mergeDismissSchema = z.object({ aId: z.string().min(1), bId: z.string().min(1) });
export type MergeDismiss = z.infer<typeof mergeDismissSchema>;

/** 手動標記看完（true）、沒看完（false），null 表示改回自動判斷 */
const manualCompleted = z.boolean().nullable();

/** 在來源網站上標記（extension 使用，server 離線時會暫存） */
export const markCompletedSchema = z.object({ animeSn: sn, completed: manualCompleted, at: isoTime });
export type MarkCompleted = z.infer<typeof markCompletedSchema>;

export const groupNameSchema = z.object({ name: z.string().trim().min(1).max(50) });
export type GroupName = z.infer<typeof groupNameSchema>;

/** 設定作品所屬的分群（整批取代） */
export const animeGroupsPutSchema = z.object({ groupIds: z.array(z.string().min(1)).max(100) });

export const animePatchSchema = z.object({
  hidden: z.boolean().optional(),
  favorite: z.boolean().optional(),
  manualCompleted: manualCompleted.optional(),
  hiddenReason: z.string().nullable().optional(),
  title: z.string().min(1).optional(),
});
export type AnimePatch = z.infer<typeof animePatchSchema>;

// ---- 回應 ----

export interface Health {
  ok: true;
  version: string;
  dataDir: string;
}

/** 卡片上需要的狀態 */
export interface CardStatus {
  animeId: string;
  hidden: boolean;
  lastEpisodeLabel: string | null;
  /** 有手動標記時以手動為準 */
  completed: boolean;
  /** 手動標記；null 表示自動判斷 */
  manualCompleted: boolean | null;
  manualCompletedAt: string | null;
}

export interface Review {
  id: string;
  animeId: string;
  episodeId: string | null;
  rating: number | null;
  content: string;
  spoiler: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnimeSource {
  source: string;
  externalId: string;
  url: string | null;
  rawMeta: Record<string, unknown>;
  firstSeenAt: string;
}

export interface WatchEvent {
  id: string;
  episodeId: string;
  animeId: string;
  startedAt: string;
  lastSeenAt: string;
  progressSec: number;
  durationSec: number;
  completed: boolean;
  source: 'auto' | 'import' | 'manual';
}

export interface Episode {
  id: string;
  animeId: string;
  source: string;
  externalId: string;
  label: string;
  sortOrder: number;
  watches: WatchEvent[];
}

export interface AnimeSummary {
  id: string;
  title: string;
  /** 這部作品有資料的網站 */
  sites: Source[];
  coverUrl: string | null;
  hidden: boolean;
  hiddenAt: string | null;
  lastWatchedAt: string | null;
  lastEpisodeLabel: string | null;
  /** 有手動標記時以手動為準 */
  completed: boolean;
  manualCompleted: boolean | null;
  manualCompletedAt: string | null;
  reviewCount: number;
  favorite: boolean;
  /** 最新一則有給星的評論的評分 */
  rating: number | null;
  groupIds: string[];
  createdAt: string;
}

export interface AnimeDetail extends AnimeSummary {
  altTitles: string[];
  hiddenReason: string | null;
  updatedAt: string;
  sources: AnimeSource[];
  episodes: Episode[];
  reviews: Review[];
}

export interface WatchHistoryItem extends WatchEvent {
  /** mark：手動標記看完（沒有集數與進度） */
  kind: 'watch' | 'mark';
  animeTitle: string;
  /** 在哪個網站看的 */
  site: Source;
  episodeLabel: string;
  coverUrl: string | null;
}

export type AnimeFilter = 'all' | 'hidden' | 'watched' | 'reviewed' | 'favorite';
export const ANIME_FILTERS: AnimeFilter[] = ['all', 'hidden', 'watched', 'reviewed', 'favorite'];

/** default：最後觀看（沒看過的以建檔時間）由新到舊 */
export type AnimeSort = 'default' | 'title' | 'rating' | 'created';
export const ANIME_SORTS: AnimeSort[] = ['default', 'title', 'rating', 'created'];

export interface AnimeListQuery {
  filter?: AnimeFilter;
  q?: string;
  /** 符合任一來源；空陣列或省略表示全部 */
  sites?: Source[];
  groupId?: string;
  /** 「已隱藏」以外的篩選預設不含已隱藏的作品 */
  includeHidden?: boolean;
  /** 1–5：N 星以上；unrated：未評分 */
  rating?: number | 'unrated';
  sort?: AnimeSort;
}

export interface AnimeGroup {
  id: string;
  name: string;
  count: number;
  createdAt: string;
}

/** 疑似同一部作品 */
export interface MergeCandidate {
  a: AnimeSummary;
  b: AnimeSummary;
  /** 名稱相似度 0–1 */
  score: number;
}
