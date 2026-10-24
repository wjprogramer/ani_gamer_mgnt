import type { DatabaseSync } from 'node:sqlite';
import {
  BAHAMUT,
  COMPLETED_RATIO,
  ulid,
  type AnimeDetail,
  type AnimeFilter,
  type AnimePatch,
  type AnimeSummary,
  type BahamutAnimeUpsert,
  type BahamutHide,
  type BahamutImportItem,
  type BahamutWatch,
  type CardStatus,
  type Episode,
  type ImportResult,
  type Review,
  type ReviewPut,
  type SnMap,
  type WatchEvent,
  type WatchHistoryItem,
} from '@agm/shared';
import { transaction } from './db.ts';

interface AnimeRow {
  id: string;
  title: string;
  alt_titles: string;
  cover_path: string | null;
  hidden: number;
  hidden_at: string | null;
  hidden_reason: string | null;
  created_at: string;
  updated_at: string;
}

interface WatchRow {
  id: string;
  episode_id: string;
  anime_id: string;
  started_at: string;
  last_seen_at: string;
  progress_sec: number;
  duration_sec: number;
  completed: number;
  source: 'auto' | 'import';
}

interface ReviewRow {
  id: string;
  anime_id: string;
  episode_id: string | null;
  rating: number | null;
  content: string;
  spoiler: number;
  created_at: string;
  updated_at: string;
}

export class NotFoundError extends Error {}

const now = () => new Date().toISOString();
/**
 * 匯入時判斷「同一次觀看」的時間範圍（分鐘）：
 * - 與之前匯入的紀錄比對：動畫瘋的時間精確到秒，只容許舊版以頁面匯入時的分鐘誤差。
 *   同一集重看會在動畫瘋被覆蓋成新的時間，這裡要保留成兩筆。
 * - 與本機自動記錄比對：兩邊的開始時間來源不同，放寬範圍。
 */
const IMPORT_MATCH_MINUTES = 2;
const AUTO_MATCH_MINUTES = 30;

/** 由集數標籤推算排序；播放頁建檔時會以實際順序覆蓋 */
function labelOrder(label?: string): number | undefined {
  return label && /^\d+$/.test(label) ? Number(label) - 1 : undefined;
}
const bahamutAnimeUrl = (animeSn: string) => `https://ani.gamer.com.tw/animeRef.php?sn=${animeSn}`;

export class Store {
  constructor(private readonly db: DatabaseSync) {}

  // ---- 動畫 ----

  findAnimeId(source: string, externalId: string): string | undefined {
    const row = this.db
      .prepare('SELECT anime_id FROM anime_source WHERE source = ? AND external_id = ?')
      .get(source, externalId) as { anime_id: string } | undefined;
    return row?.anime_id;
  }

  /** 找出或建立動畫瘋動畫；有提供的欄位會覆寫既有資料 */
  private ensureBahamutAnime(input: {
    animeSn: string;
    title?: string;
    coverUrl?: string;
    acgSn?: string;
    tags?: string[];
  }): string {
    const existing = this.findAnimeId(BAHAMUT, input.animeSn);
    const meta: Record<string, unknown> = {};
    if (input.coverUrl) meta.coverUrl = input.coverUrl;
    if (input.acgSn) meta.acgSn = input.acgSn;
    if (input.tags) meta.tags = input.tags;
    const t = now();

    if (existing) {
      if (input.title) {
        this.db
          .prepare('UPDATE anime SET title = ?, updated_at = ? WHERE id = ? AND title != ?')
          .run(input.title, t, existing, input.title);
      }
      if (Object.keys(meta).length) {
        const row = this.db
          .prepare('SELECT raw_meta FROM anime_source WHERE source = ? AND external_id = ?')
          .get(BAHAMUT, input.animeSn) as { raw_meta: string };
        const merged = { ...JSON.parse(row.raw_meta), ...meta };
        this.db
          .prepare('UPDATE anime_source SET raw_meta = ? WHERE source = ? AND external_id = ?')
          .run(JSON.stringify(merged), BAHAMUT, input.animeSn);
      }
      return existing;
    }

    const id = ulid();
    this.db
      .prepare('INSERT INTO anime (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, input.title ?? `動畫 ${input.animeSn}`, t, t);
    this.db
      .prepare(
        'INSERT INTO anime_source (anime_id, source, external_id, url, raw_meta, first_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, BAHAMUT, input.animeSn, bahamutAnimeUrl(input.animeSn), JSON.stringify(meta), t);
    return id;
  }

  private upsertEpisode(animeId: string, videoSn: string, label?: string, sortOrder?: number): string {
    const existing = this.db
      .prepare('SELECT id FROM episode WHERE source = ? AND external_id = ?')
      .get(BAHAMUT, videoSn) as { id: string } | undefined;
    if (existing) {
      if (label !== undefined) this.db.prepare('UPDATE episode SET label = ? WHERE id = ?').run(label, existing.id);
      if (sortOrder !== undefined)
        this.db.prepare('UPDATE episode SET sort_order = ? WHERE id = ?').run(sortOrder, existing.id);
      return existing.id;
    }
    const id = ulid();
    this.db
      .prepare('INSERT INTO episode (id, anime_id, source, external_id, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, animeId, BAHAMUT, videoSn, label ?? videoSn, sortOrder ?? 0);
    return id;
  }

  /** 回傳動畫 id，以及是否還需要下載封面 */
  upsertBahamutAnime(input: BahamutAnimeUpsert): { id: string; coverUrl: string | null } {
    return transaction(this.db, () => {
      const id = this.ensureBahamutAnime(input);
      for (const ep of input.episodes ?? []) this.upsertEpisode(id, ep.videoSn, ep.label, ep.sortOrder);
      return { id, coverUrl: this.pendingCoverUrl(id) };
    });
  }

  /** 尚未有本機封面時，回傳來源的封面網址 */
  pendingCoverUrl(animeId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT a.cover_path, s.raw_meta FROM anime a
         JOIN anime_source s ON s.anime_id = a.id AND s.source = ?
         WHERE a.id = ?`,
      )
      .get(BAHAMUT, animeId) as { cover_path: string | null; raw_meta: string } | undefined;
    if (!row || row.cover_path) return null;
    const url = JSON.parse(row.raw_meta).coverUrl;
    return typeof url === 'string' ? url : null;
  }

  setCoverPath(animeId: string, coverPath: string) {
    this.db.prepare('UPDATE anime SET cover_path = ? WHERE id = ?').run(coverPath, animeId);
  }

  setHidden(input: BahamutHide): { id: string; coverUrl: string | null } {
    return transaction(this.db, () => {
      const id = this.ensureBahamutAnime({
        animeSn: input.animeSn,
        // 卡片上的名稱可能不完整，已存在的動畫不覆寫名稱
        title: this.findAnimeId(BAHAMUT, input.animeSn) ? undefined : input.title,
        coverUrl: input.coverUrl,
      });
      this.db
        .prepare('UPDATE anime SET hidden = ?, hidden_at = ?, updated_at = ? WHERE id = ?')
        .run(input.hidden ? 1 : 0, input.hidden ? input.at : null, now(), id);
      return { id, coverUrl: this.pendingCoverUrl(id) };
    });
  }

  hiddenBahamutSns(): string[] {
    const rows = this.db
      .prepare(
        `SELECT s.external_id FROM anime a JOIN anime_source s ON s.anime_id = a.id
         WHERE s.source = ? AND a.hidden = 1`,
      )
      .all(BAHAMUT) as { external_id: string }[];
    return rows.map((r) => r.external_id);
  }

  cardStatus(animeSns: string[]): Record<string, CardStatus> {
    const result: Record<string, CardStatus> = {};
    for (const sn of new Set(animeSns)) {
      const id = this.findAnimeId(BAHAMUT, sn);
      if (!id) continue;
      const anime = this.animeRow(id)!;
      result[sn] = { animeId: id, hidden: !!anime.hidden, ...this.progress(id) };
    }
    return result;
  }

  /** 看到的最後一集，以及是否已看完目前已知的最新一集 */
  private progress(animeId: string): { lastEpisodeLabel: string | null; completed: boolean } {
    const last = this.db
      .prepare(
        `SELECT e.label FROM watch_event w JOIN episode e ON e.id = w.episode_id
         WHERE w.anime_id = ? ORDER BY e.sort_order DESC, w.started_at DESC LIMIT 1`,
      )
      .get(animeId) as { label: string } | undefined;
    const latest = this.db
      .prepare(
        `SELECT EXISTS (SELECT 1 FROM watch_event WHERE episode_id = e.id AND completed = 1) AS done
         FROM episode e WHERE e.anime_id = ? ORDER BY e.sort_order DESC LIMIT 1`,
      )
      .get(animeId) as { done: number } | undefined;
    return { lastEpisodeLabel: last?.label ?? null, completed: !!latest?.done };
  }

  private animeRow(id: string): AnimeRow | undefined {
    return this.db.prepare('SELECT * FROM anime WHERE id = ?').get(id) as AnimeRow | undefined;
  }

  private summary(row: AnimeRow): AnimeSummary {
    const stats = this.db
      .prepare(
        `SELECT (SELECT MAX(started_at) FROM watch_event WHERE anime_id = ?) AS last_watched_at,
                (SELECT COUNT(*) FROM review WHERE anime_id = ?) AS review_count`,
      )
      .get(row.id, row.id) as { last_watched_at: string | null; review_count: number };
    return {
      id: row.id,
      title: row.title,
      coverUrl: row.cover_path ? `/covers/${row.cover_path}` : null,
      hidden: !!row.hidden,
      hiddenAt: row.hidden_at,
      lastWatchedAt: stats.last_watched_at,
      reviewCount: stats.review_count,
      createdAt: row.created_at,
      ...this.progress(row.id),
    };
  }

  listAnime(filter: AnimeFilter = 'all', q = ''): AnimeSummary[] {
    const where: string[] = [];
    if (filter === 'hidden') where.push('a.hidden = 1');
    if (filter === 'watched') where.push('EXISTS (SELECT 1 FROM watch_event w WHERE w.anime_id = a.id)');
    if (filter === 'reviewed') where.push('EXISTS (SELECT 1 FROM review r WHERE r.anime_id = a.id)');
    if (q) where.push("(a.title LIKE ? ESCAPE '\\' OR a.alt_titles LIKE ? ESCAPE '\\')");
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = this.db
      .prepare(`SELECT a.* FROM anime a ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.updated_at DESC`)
      .all(...(q ? [like, like] : [])) as unknown as AnimeRow[];
    return rows
      .map((r) => this.summary(r))
      .sort((a, b) => (b.lastWatchedAt ?? b.createdAt).localeCompare(a.lastWatchedAt ?? a.createdAt));
  }

  getAnime(id: string): AnimeDetail {
    const row = this.animeRow(id);
    if (!row) throw new NotFoundError(`找不到動畫 ${id}`);
    const sources = this.db.prepare('SELECT * FROM anime_source WHERE anime_id = ?').all(id) as unknown as {
      source: string;
      external_id: string;
      url: string | null;
      raw_meta: string;
      first_seen_at: string;
    }[];
    const episodes = this.db
      .prepare('SELECT * FROM episode WHERE anime_id = ? ORDER BY sort_order, external_id')
      .all(id) as unknown as { id: string; anime_id: string; source: string; external_id: string; label: string; sort_order: number }[];
    const watches = (
      this.db.prepare('SELECT * FROM watch_event WHERE anime_id = ? ORDER BY started_at DESC').all(id) as unknown as WatchRow[]
    ).map(toWatch);
    return {
      ...this.summary(row),
      altTitles: JSON.parse(row.alt_titles),
      hiddenReason: row.hidden_reason,
      updatedAt: row.updated_at,
      sources: sources.map((s) => ({
        source: s.source,
        externalId: s.external_id,
        url: s.url,
        rawMeta: JSON.parse(s.raw_meta),
        firstSeenAt: s.first_seen_at,
      })),
      episodes: episodes.map(
        (e): Episode => ({
          id: e.id,
          animeId: e.anime_id,
          source: e.source,
          externalId: e.external_id,
          label: e.label,
          sortOrder: e.sort_order,
          watches: watches.filter((w) => w.episodeId === e.id),
        }),
      ),
      reviews: this.listReviews(id),
    };
  }

  patchAnime(id: string, patch: AnimePatch): AnimeDetail {
    const row = this.animeRow(id);
    if (!row) throw new NotFoundError(`找不到動畫 ${id}`);
    const t = now();
    if (patch.title !== undefined) this.db.prepare('UPDATE anime SET title = ? WHERE id = ?').run(patch.title, id);
    if (patch.hidden !== undefined)
      this.db
        .prepare('UPDATE anime SET hidden = ?, hidden_at = ? WHERE id = ?')
        .run(patch.hidden ? 1 : 0, patch.hidden ? t : null, id);
    if (patch.hiddenReason !== undefined)
      this.db.prepare('UPDATE anime SET hidden_reason = ? WHERE id = ?').run(patch.hiddenReason, id);
    this.db.prepare('UPDATE anime SET updated_at = ? WHERE id = ?').run(t, id);
    return this.getAnime(id);
  }

  // ---- 集數對應 ----

  lookupSnMap(videoSns: string[]): SnMap {
    const result: SnMap = {};
    const fromEpisode = this.db.prepare(
      `SELECT s.external_id FROM episode e JOIN anime_source s ON s.anime_id = e.anime_id AND s.source = e.source
       WHERE e.source = ? AND e.external_id = ?`,
    );
    const fromCache = this.db.prepare('SELECT anime_sn FROM sn_cache WHERE source = ? AND episode_sn = ?');
    for (const v of new Set(videoSns)) {
      const hit =
        (fromEpisode.get(BAHAMUT, v) as { external_id: string } | undefined)?.external_id ??
        (fromCache.get(BAHAMUT, v) as { anime_sn: string } | undefined)?.anime_sn;
      if (hit) result[v] = hit;
    }
    return result;
  }

  putSnMap(entries: SnMap) {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO sn_cache (source, episode_sn, anime_sn, fetched_at) VALUES (?, ?, ?, ?)',
    );
    const t = now();
    transaction(this.db, () => {
      for (const [v, a] of Object.entries(entries)) stmt.run(BAHAMUT, v, a, t);
    });
  }

  // ---- 觀看紀錄 ----

  /** 以 id 冪等寫入；同一個 id 重送時只更新進度 */
  recordWatch(input: BahamutWatch): { watch: WatchEvent; coverUrl: string | null } {
    return transaction(this.db, () => {
      const animeId = this.ensureBahamutAnime({ animeSn: input.animeSn, title: undefined });
      if (this.animeRow(animeId)!.title === `動畫 ${input.animeSn}`)
        this.db.prepare('UPDATE anime SET title = ? WHERE id = ?').run(input.animeTitle, animeId);
      const episodeId = this.upsertEpisode(animeId, input.videoSn, input.episodeLabel);
      const completed = input.durationSec > 0 && input.progressSec / input.durationSec >= COMPLETED_RATIO ? 1 : 0;
      this.db
        .prepare(
          `INSERT INTO watch_event (id, episode_id, anime_id, started_at, last_seen_at, progress_sec, duration_sec, completed, source)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto')
           ON CONFLICT (id) DO UPDATE SET
             last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
             progress_sec = CASE WHEN excluded.last_seen_at >= last_seen_at THEN excluded.progress_sec ELSE progress_sec END,
             duration_sec = MAX(duration_sec, excluded.duration_sec),
             completed = MAX(completed, excluded.completed)`,
        )
        .run(input.id, episodeId, animeId, input.startedAt, input.at, input.progressSec, input.durationSec, completed);
      const row = this.db.prepare('SELECT * FROM watch_event WHERE id = ?').get(input.id) as unknown as WatchRow;
      return { watch: toWatch(row), coverUrl: this.pendingCoverUrl(animeId) };
    });
  }

  /**
   * 匯入動畫瘋觀看紀錄。已匯入過的同一筆只更新進度；與自動記錄重疊的略過；
   * 其餘（包含重看同一集）都新增，所以不會因為動畫瘋覆蓋紀錄而遺失。
   */
  importWatches(items: BahamutImportItem[]): ImportResult & { covers: [string, string][] } {
    return transaction(this.db, () => {
      const result = { imported: 0, updated: 0, skipped: 0, covers: [] as [string, string][] };
      const near = this.db.prepare(
        `SELECT id, progress_sec, duration_sec, completed FROM watch_event
         WHERE episode_id = ? AND source = ? AND ABS(julianday(started_at) - julianday(?)) * 1440 < ? LIMIT 1`,
      );
      const update = this.db.prepare(
        'UPDATE watch_event SET progress_sec = ?, duration_sec = ?, completed = ?, last_seen_at = MAX(last_seen_at, ?) WHERE id = ?',
      );
      const insert = this.db.prepare(
        `INSERT INTO watch_event (id, episode_id, anime_id, started_at, last_seen_at, progress_sec, duration_sec, completed, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import')`,
      );
      const seenAnime = new Set<string>();
      for (const item of items) {
        const isNew = !this.findAnimeId(BAHAMUT, item.animeSn);
        const animeId = this.ensureBahamutAnime({
          animeSn: item.animeSn,
          title: isNew ? item.title : undefined,
          coverUrl: item.coverUrl,
        });
        if (!seenAnime.has(animeId)) {
          seenAnime.add(animeId);
          const cover = this.pendingCoverUrl(animeId);
          if (cover) result.covers.push([animeId, cover]);
        }
        const known = this.db.prepare('SELECT id FROM episode WHERE source = ? AND external_id = ?').get(BAHAMUT, item.videoSn) as
          | { id: string }
          | undefined;
        // 已建檔的集數保留播放頁取得的名稱與順序
        const episodeId = known?.id ?? this.upsertEpisode(animeId, item.videoSn, item.episodeLabel, labelOrder(item.episodeLabel));
        const duration = item.durationSec ?? 0;
        const progress = item.progressSec ?? 0;
        const completed = item.completed || (duration > 0 && progress / duration >= COMPLETED_RATIO);
        const seenAt = item.lastSeenAt ?? item.watchedAt;

        if (near.get(episodeId, 'auto', item.watchedAt, AUTO_MATCH_MINUTES)) {
          result.skipped++;
          continue;
        }
        const prev = near.get(episodeId, 'import', item.watchedAt, IMPORT_MATCH_MINUTES) as
          | { id: string; progress_sec: number; duration_sec: number; completed: number }
          | undefined;
        if (prev) {
          // 同一次觀看在動畫瘋上的進度可能還在增加
          const next = {
            progress: Math.max(prev.progress_sec, progress),
            duration: Math.max(prev.duration_sec, duration),
            completed: prev.completed || completed ? 1 : 0,
          };
          if (next.progress !== prev.progress_sec || next.duration !== prev.duration_sec || next.completed !== prev.completed) {
            update.run(next.progress, next.duration, next.completed, seenAt, prev.id);
            result.updated++;
          } else result.skipped++;
          continue;
        }
        insert.run(ulid(), episodeId, animeId, item.watchedAt, seenAt, progress, duration, completed ? 1 : 0);
        result.imported++;
      }
      return result;
    });
  }

  watchHistory(limit = 50, before?: string): WatchHistoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT w.*, a.title AS anime_title, a.cover_path, e.label AS episode_label
         FROM watch_event w JOIN anime a ON a.id = w.anime_id JOIN episode e ON e.id = w.episode_id
         WHERE (? IS NULL OR w.started_at < ?)
         ORDER BY w.started_at DESC LIMIT ?`,
      )
      .all(before ?? null, before ?? null, limit) as unknown as (WatchRow & {
      anime_title: string;
      cover_path: string | null;
      episode_label: string;
    })[];
    return rows.map((r) => ({
      ...toWatch(r),
      animeTitle: r.anime_title,
      episodeLabel: r.episode_label,
      coverUrl: r.cover_path ? `/covers/${r.cover_path}` : null,
    }));
  }

  deleteWatch(id: string) {
    this.db.prepare('DELETE FROM watch_event WHERE id = ?').run(id);
  }

  // ---- 評論 ----

  listReviews(animeId: string): Review[] {
    const rows = this.db
      .prepare('SELECT * FROM review WHERE anime_id = ? ORDER BY created_at DESC')
      .all(animeId) as unknown as ReviewRow[];
    return rows.map(toReview);
  }

  putReview(id: string, input: ReviewPut): Review {
    const animeId = input.animeId ?? (input.animeSn ? this.findAnimeId(BAHAMUT, input.animeSn) : undefined);
    if (!animeId || !this.animeRow(animeId)) throw new NotFoundError('找不到評論對應的動畫');
    this.db
      .prepare(
        `INSERT INTO review (id, anime_id, episode_id, rating, content, spoiler, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           episode_id = excluded.episode_id, rating = excluded.rating, content = excluded.content,
           spoiler = excluded.spoiler, updated_at = excluded.updated_at
         WHERE excluded.updated_at >= review.updated_at`,
      )
      .run(
        id,
        animeId,
        input.episodeId ?? null,
        input.rating ?? null,
        input.content,
        input.spoiler ? 1 : 0,
        input.createdAt,
        input.updatedAt,
      );
    return toReview(this.db.prepare('SELECT * FROM review WHERE id = ?').get(id) as unknown as ReviewRow);
  }

  deleteReview(id: string) {
    this.db.prepare('DELETE FROM review WHERE id = ?').run(id);
  }
}

function toWatch(r: WatchRow): WatchEvent {
  return {
    id: r.id,
    episodeId: r.episode_id,
    animeId: r.anime_id,
    startedAt: r.started_at,
    lastSeenAt: r.last_seen_at,
    progressSec: r.progress_sec,
    durationSec: r.duration_sec,
    completed: !!r.completed,
    source: r.source,
  };
}

function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    animeId: r.anime_id,
    episodeId: r.episode_id,
    rating: r.rating,
    content: r.content,
    spoiler: !!r.spoiler,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
