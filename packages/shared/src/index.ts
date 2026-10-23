import { z } from 'zod';

export { ulid } from 'ulid';

export const DEFAULT_PORT = 17890;
export const DEFAULT_SERVER_URL = `http://127.0.0.1:${DEFAULT_PORT}`;
export const BAHAMUT = 'bahamut';
/** 進度達到片長的這個比例即視為看完 */
export const COMPLETED_RATIO = 0.85;

const sn = z.string().regex(/^\d+$/);
const isoTime = z.iso.datetime();

// ---- 請求 ----

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

export const reviewPutSchema = z
  .object({
    animeId: z.string().optional(),
    animeSn: sn.optional(),
    episodeId: z.string().nullable().optional(),
    rating: z.number().int().min(1).max(5).nullable().optional(),
    content: z.string(),
    spoiler: z.boolean().default(false),
    createdAt: isoTime,
    updatedAt: isoTime,
  })
  .refine((r) => r.animeId || r.animeSn, { message: '需要 animeId 或 animeSn' });
export type ReviewPut = z.input<typeof reviewPutSchema>;

export const animePatchSchema = z.object({
  hidden: z.boolean().optional(),
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
  completed: boolean;
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
  source: 'auto' | 'import';
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
  coverUrl: string | null;
  hidden: boolean;
  hiddenAt: string | null;
  lastWatchedAt: string | null;
  lastEpisodeLabel: string | null;
  completed: boolean;
  reviewCount: number;
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
  animeTitle: string;
  episodeLabel: string;
  coverUrl: string | null;
}

export type AnimeFilter = 'all' | 'hidden' | 'watched' | 'reviewed';
