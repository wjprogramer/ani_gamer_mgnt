import type { DatabaseSync } from 'node:sqlite';
import {
  BAHAMUT,
  COMPLETED_RATIO,
  ulid,
  type AnimeDetail,
  type AnimeGroup,
  type AnimeListQuery,
  type AnimeRating,
  type AnimePatch,
  type AnimeSummary,
  type BahamutAnimeUpsert,
  type BahamutHide,
  type BahamutImportItem,
  type BahamutWatch,
  type CardStatus,
  type Episode,
  type ImportResult,
  type MarkCompleted,
  type MergeCandidate,
  type RelatedAnime,
  type RelatedAnimeInput,
  type Review,
  type ReviewPut,
  type SnMap,
  type Source,
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
  manual_completed: number | null;
  manual_completed_at: string | null;
  favorite: number;
  favorited_at: string | null;
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
  source: 'auto' | 'import' | 'manual';
}

interface RelationRow {
  anime_id: string;
  source: Source;
  external_id: string;
  title: string;
  cover_url: string | null;
  origin: 'site' | 'manual';
  removed: number;
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
 * 匯入時判斷「同一次觀看」：同一集，且觀看時段（開始～最後回報）在容許範圍內重疊。
 * - 與之前匯入的紀錄比對：只容許少量誤差（舊版以頁面匯入時只到分鐘、Netflix 的開始時間為推算值）。
 *   同一集重看會在來源網站被覆蓋成新的時間，這裡要保留成兩筆。
 * - 與本機自動記錄比對：兩邊的時間來源不同，放寬範圍。
 */
const IMPORT_MATCH_MINUTES = 2;
const AUTO_MATCH_MINUTES = 30;
/** 合併頁列出的最低名稱相似度 */
const CANDIDATE_MIN_SCORE = 0.5;
const CANDIDATE_LIMIT = 100;

/** 由集數標籤推算排序；播放頁建檔時會以實際順序覆蓋 */
function labelOrder(label?: string): number | undefined {
  return label && /^\d+$/.test(label) ? Number(label) - 1 : undefined;
}
const SOURCE_URLS: Record<Source, (id: string) => string> = {
  bahamut: (id) => `https://ani.gamer.com.tw/animeRef.php?sn=${id}`,
  netflix: (id) => `https://www.netflix.com/title/${id}`,
};
const placeholderTitle = (source: Source, id: string) => (source === BAHAMUT ? `動畫 ${id}` : `作品 ${id}`);

export class Store {
  constructor(private readonly db: DatabaseSync) {}

  // ---- 作品 ----

  findAnimeId(source: Source, externalId: string): string | undefined {
    const row = this.db
      .prepare('SELECT anime_id FROM anime_source WHERE source = ? AND external_id = ?')
      .get(source, externalId) as { anime_id: string } | undefined;
    return row?.anime_id;
  }

  /** 找出或建立來源的作品；有提供的欄位會覆寫既有資料 */
  private ensureAnime(
    source: Source,
    input: { animeSn: string; title?: string; coverUrl?: string; acgSn?: string; tags?: string[] },
  ): string {
    const existing = this.findAnimeId(source, input.animeSn);
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
          .get(source, input.animeSn) as { raw_meta: string };
        const merged = { ...JSON.parse(row.raw_meta), ...meta };
        this.db
          .prepare('UPDATE anime_source SET raw_meta = ? WHERE source = ? AND external_id = ?')
          .run(JSON.stringify(merged), source, input.animeSn);
      }
      return existing;
    }

    const id = ulid();
    this.db
      .prepare('INSERT INTO anime (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)')
      .run(id, input.title ?? placeholderTitle(source, input.animeSn), t, t);
    this.db
      .prepare(
        'INSERT INTO anime_source (anime_id, source, external_id, url, raw_meta, first_seen_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, source, input.animeSn, SOURCE_URLS[source](input.animeSn), JSON.stringify(meta), t);
    return id;
  }

  private findEpisodeId(source: Source, videoSn: string): string | undefined {
    const row = this.db.prepare('SELECT id FROM episode WHERE source = ? AND external_id = ?').get(source, videoSn) as
      | { id: string }
      | undefined;
    return row?.id;
  }

  private upsertEpisode(source: Source, animeId: string, videoSn: string, label?: string, sortOrder?: number): string {
    const existing = this.findEpisodeId(source, videoSn);
    if (existing) {
      if (label !== undefined) this.db.prepare('UPDATE episode SET label = ? WHERE id = ?').run(label, existing);
      if (sortOrder !== undefined) this.db.prepare('UPDATE episode SET sort_order = ? WHERE id = ?').run(sortOrder, existing);
      return existing;
    }
    const id = ulid();
    this.db
      .prepare('INSERT INTO episode (id, anime_id, source, external_id, label, sort_order) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, animeId, source, videoSn, label ?? videoSn, sortOrder ?? 0);
    return id;
  }

  /** 回傳作品 id，以及是否還需要下載封面 */
  upsertAnime(source: Source, input: BahamutAnimeUpsert): { id: string; coverUrl: string | null } {
    return transaction(this.db, () => {
      const id = this.ensureAnime(source, input);
      for (const ep of input.episodes ?? []) this.upsertEpisode(source, id, ep.videoSn, ep.label, ep.sortOrder);
      if (input.related) this.putSiteRelations(source, input.animeSn, input.related);
      return { id, coverUrl: this.pendingCoverUrl(id) };
    });
  }

  /** 尚未有本機封面時，回傳最早建檔的來源的封面網址 */
  pendingCoverUrl(animeId: string): string | null {
    const rows = this.db
      .prepare(
        `SELECT a.cover_path, s.raw_meta FROM anime a
         JOIN anime_source s ON s.anime_id = a.id
         WHERE a.id = ? ORDER BY s.first_seen_at`,
      )
      .all(animeId) as { cover_path: string | null; raw_meta: string }[];
    if (!rows.length || rows[0]!.cover_path) return null;
    for (const row of rows) {
      const url = JSON.parse(row.raw_meta).coverUrl;
      if (typeof url === 'string') return url;
    }
    return null;
  }

  setCoverPath(animeId: string, coverPath: string) {
    this.db.prepare('UPDATE anime SET cover_path = ? WHERE id = ?').run(coverPath, animeId);
  }

  setHidden(source: Source, input: BahamutHide): { id: string; coverUrl: string | null } {
    return transaction(this.db, () => {
      const id = this.ensureAnime(source, {
        animeSn: input.animeSn,
        // 卡片上的名稱可能不完整，已存在的作品不覆寫名稱
        title: this.findAnimeId(source, input.animeSn) ? undefined : input.title,
        coverUrl: input.coverUrl,
      });
      this.db
        .prepare('UPDATE anime SET hidden = ?, hidden_at = ?, updated_at = ? WHERE id = ?')
        .run(input.hidden ? 1 : 0, input.hidden ? input.at : null, now(), id);
      return { id, coverUrl: this.pendingCoverUrl(id) };
    });
  }

  /** 手動標記看完／沒看完；null 改回自動判斷 */
  private setManualCompleted(animeId: string, completed: boolean | null, at: string) {
    this.db
      .prepare('UPDATE anime SET manual_completed = ?, manual_completed_at = ?, updated_at = ? WHERE id = ?')
      .run(completed === null ? null : completed ? 1 : 0, completed === null ? null : at, now(), animeId);
  }

  markCompleted(source: Source, input: MarkCompleted): { id: string; coverUrl: string | null } {
    return transaction(this.db, () => {
      const id = this.ensureAnime(source, { animeSn: input.animeSn });
      this.setManualCompleted(id, input.completed, input.at);
      return { id, coverUrl: this.pendingCoverUrl(id) };
    });
  }

  hiddenIds(source: Source): string[] {
    const rows = this.db
      .prepare(
        `SELECT s.external_id FROM anime a JOIN anime_source s ON s.anime_id = a.id
         WHERE s.source = ? AND a.hidden = 1`,
      )
      .all(source) as { external_id: string }[];
    return rows.map((r) => r.external_id);
  }

  cardStatus(source: Source, animeSns: string[]): Record<string, CardStatus> {
    const result: Record<string, CardStatus> = {};
    for (const sn of new Set(animeSns)) {
      const id = this.findAnimeId(source, sn);
      if (!id) continue;
      const anime = this.animeRow(id)!;
      result[sn] = { animeId: id, hidden: !!anime.hidden, ...this.progress(anime) };
    }
    return result;
  }

  /** 看到的最後一集，以及是否已看完：有手動標記時以手動為準，否則看目前已知的最新一集有沒有看完 */
  private progress(row: AnimeRow): Pick<CardStatus, 'lastEpisodeLabel' | 'completed' | 'manualCompleted' | 'manualCompletedAt'> {
    const animeId = row.id;
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
    const manual = row.manual_completed === null ? null : !!row.manual_completed;
    return {
      lastEpisodeLabel: last?.label ?? null,
      completed: manual ?? !!latest?.done,
      manualCompleted: manual,
      manualCompletedAt: row.manual_completed_at,
    };
  }

  private animeRow(id: string): AnimeRow | undefined {
    return this.db.prepare('SELECT * FROM anime WHERE id = ?').get(id) as AnimeRow | undefined;
  }

  private summary(row: AnimeRow): AnimeSummary {
    const stats = this.db
      .prepare(
        `SELECT (SELECT MAX(started_at) FROM watch_event WHERE anime_id = ?) AS last_watched_at,
                (SELECT COUNT(*) FROM review WHERE anime_id = ?) AS review_count,
                (SELECT rating FROM review WHERE anime_id = ? AND rating IS NOT NULL
                 ORDER BY updated_at DESC LIMIT 1) AS rating`,
      )
      .get(row.id, row.id, row.id) as { last_watched_at: string | null; review_count: number; rating: number | null };
    const groups = this.db
      .prepare('SELECT group_id FROM anime_group_member WHERE anime_id = ? ORDER BY added_at')
      .all(row.id) as { group_id: string }[];
    const sources = this.db
      .prepare('SELECT DISTINCT source FROM anime_source WHERE anime_id = ? ORDER BY source')
      .all(row.id) as { source: Source }[];
    return {
      id: row.id,
      title: row.title,
      sites: sources.map((s) => s.source),
      coverUrl: row.cover_path ? `/covers/${row.cover_path}` : null,
      hidden: !!row.hidden,
      hiddenAt: row.hidden_at,
      lastWatchedAt: stats.last_watched_at,
      reviewCount: stats.review_count,
      favorite: !!row.favorite,
      rating: stats.rating,
      groupIds: groups.map((g) => g.group_id),
      createdAt: row.created_at,
      ...this.progress(row),
    };
  }

  listAnime({
    filter = 'all',
    q = '',
    sites = [],
    groupId,
    ratings = [],
    progress,
    sort = 'default',
    includeHidden = false,
  }: AnimeListQuery = {}): AnimeSummary[] {
    const where: string[] = [];
    const params: string[] = [];
    if (sites.length) {
      where.push(
        `EXISTS (SELECT 1 FROM anime_source s WHERE s.anime_id = a.id AND s.source IN (${sites.map(() => '?').join(',')}))`,
      );
      params.push(...sites);
    }
    if (filter !== 'hidden' && !includeHidden) where.push('a.hidden = 0');
    if (groupId) {
      where.push('EXISTS (SELECT 1 FROM anime_group_member m WHERE m.anime_id = a.id AND m.group_id = ?)');
      params.push(groupId);
    }
    if (filter === 'favorite') where.push('a.favorite = 1');
    if (filter === 'hidden') where.push('a.hidden = 1');
    if (filter === 'watched') where.push('EXISTS (SELECT 1 FROM watch_event w WHERE w.anime_id = a.id)');
    if (filter === 'reviewed') where.push('EXISTS (SELECT 1 FROM review r WHERE r.anime_id = a.id)');
    if (q) {
      where.push("(a.title LIKE ? ESCAPE '\\' OR a.alt_titles LIKE ? ESCAPE '\\')");
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like);
    }
    const rows = this.db
      .prepare(`SELECT a.* FROM anime a ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.updated_at DESC`)
      .all(...params) as unknown as AnimeRow[];
    const byDefault = (a: AnimeSummary, b: AnimeSummary) =>
      (b.lastWatchedAt ?? b.createdAt).localeCompare(a.lastWatchedAt ?? a.createdAt);
    const compare: Record<NonNullable<AnimeListQuery['sort']>, (a: AnimeSummary, b: AnimeSummary) => number> = {
      default: byDefault,
      title: (a, b) => a.title.localeCompare(b.title, 'zh-Hant'),
      // 未評分的排最後，同分依預設順序
      rating: (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || byDefault(a, b),
      created: (a, b) => b.createdAt.localeCompare(a.createdAt),
    };
    return rows
      .map((r) => this.summary(r))
      .filter((a) => !ratings.length || ratings.includes((a.rating ?? 'unrated') as AnimeRating))
      .filter((a) => {
        if (progress === 'completed') return a.completed;
        if (progress === 'incomplete') return !a.completed;
        if (progress === 'unwatched') return !a.completed && a.lastWatchedAt === null;
        return true;
      })
      .sort(compare[sort]);
  }

  getAnime(id: string): AnimeDetail {
    const row = this.animeRow(id);
    if (!row) throw new NotFoundError(`找不到作品 ${id}`);
    const sources = this.db.prepare('SELECT * FROM anime_source WHERE anime_id = ?').all(id) as unknown as {
      source: string;
      external_id: string;
      url: string | null;
      raw_meta: string;
      first_seen_at: string;
    }[];
    const episodes = this.db
      .prepare('SELECT * FROM episode WHERE anime_id = ? ORDER BY source, sort_order, external_id')
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
      related: this.relations(id),
    };
  }

  patchAnime(id: string, patch: AnimePatch): AnimeDetail {
    const row = this.animeRow(id);
    if (!row) throw new NotFoundError(`找不到作品 ${id}`);
    const t = now();
    if (patch.title !== undefined) this.db.prepare('UPDATE anime SET title = ? WHERE id = ?').run(patch.title, id);
    if (patch.hidden !== undefined)
      this.db
        .prepare('UPDATE anime SET hidden = ?, hidden_at = ? WHERE id = ?')
        .run(patch.hidden ? 1 : 0, patch.hidden ? t : null, id);
    if (patch.manualCompleted !== undefined) this.setManualCompleted(id, patch.manualCompleted, t);
    if (patch.favorite !== undefined)
      this.db
        .prepare('UPDATE anime SET favorite = ?, favorited_at = ? WHERE id = ?')
        .run(patch.favorite ? 1 : 0, patch.favorite ? t : null, id);
    if (patch.hiddenReason !== undefined)
      this.db.prepare('UPDATE anime SET hidden_reason = ? WHERE id = ?').run(patch.hiddenReason, id);
    this.db.prepare('UPDATE anime SET updated_at = ? WHERE id = ?').run(t, id);
    return this.getAnime(id);
  }

  // ---- 集數對應（動畫瘋週期表用） ----

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
  recordWatch(source: Source, input: BahamutWatch): { watch: WatchEvent; coverUrl: string | null } {
    return transaction(this.db, () => {
      const animeId = this.ensureAnime(source, { animeSn: input.animeSn, title: undefined });
      if (this.animeRow(animeId)!.title === placeholderTitle(source, input.animeSn))
        this.db.prepare('UPDATE anime SET title = ? WHERE id = ?').run(input.animeTitle, animeId);
      const episodeId = this.upsertEpisode(source, animeId, input.videoSn, input.episodeLabel);
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
   * 匯入來源網站的觀看紀錄。已匯入過的同一筆只更新進度；與自動記錄重疊的略過；
   * 其餘（包含重看同一集）都新增，所以不會因為來源網站覆蓋紀錄而遺失。
   */
  importWatches(source: Source, items: BahamutImportItem[]): ImportResult & { covers: [string, string][] } {
    return transaction(this.db, () => {
      const result = { imported: 0, updated: 0, skipped: 0, covers: [] as [string, string][] };
      const near = this.db.prepare(
        `SELECT id, progress_sec, duration_sec, completed FROM watch_event
         WHERE episode_id = ? AND source = ?
           AND julianday(?) <= julianday(last_seen_at) + ? / 1440.0
           AND julianday(?) >= julianday(started_at) - ? / 1440.0
         LIMIT 1`,
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
        const isNew = !this.findAnimeId(source, item.animeSn);
        const animeId = this.ensureAnime(source, {
          animeSn: item.animeSn,
          title: isNew ? item.title : undefined,
          coverUrl: item.coverUrl,
        });
        if (!seenAnime.has(animeId)) {
          seenAnime.add(animeId);
          const cover = this.pendingCoverUrl(animeId);
          if (cover) result.covers.push([animeId, cover]);
        }
        // 已建檔的集數保留播放頁取得的名稱與順序
        const episodeId =
          this.findEpisodeId(source, item.videoSn) ??
          this.upsertEpisode(source, animeId, item.videoSn, item.episodeLabel, labelOrder(item.episodeLabel));
        const duration = item.durationSec ?? 0;
        const progress = item.progressSec ?? 0;
        const completed = item.completed || (duration > 0 && progress / duration >= COMPLETED_RATIO);
        const seenAt = item.lastSeenAt ?? item.watchedAt;
        const overlaps = (kind: 'auto' | 'import', minutes: number) =>
          near.get(episodeId, kind, item.watchedAt, minutes, seenAt, minutes) as
            | { id: string; progress_sec: number; duration_sec: number; completed: number }
            | undefined;

        if (overlaps('auto', AUTO_MATCH_MINUTES)) {
          result.skipped++;
          continue;
        }
        const prev = overlaps('import', IMPORT_MATCH_MINUTES);
        if (prev) {
          // 同一次觀看在來源網站上的進度可能還在增加
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

  /** 觀看紀錄與「手動標記看完」依時間由新到舊；手動標記的 id 為 mark:<作品 id> */
  watchHistory(limit = 50, before?: string): WatchHistoryItem[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM (
           SELECT 'watch' AS kind, w.*, a.title AS anime_title, a.cover_path, e.label AS episode_label, e.source AS site
           FROM watch_event w JOIN anime a ON a.id = w.anime_id JOIN episode e ON e.id = w.episode_id
           UNION ALL
           SELECT 'mark', 'mark:' || a.id, '', a.id, a.manual_completed_at, a.manual_completed_at, 0, 0, 1, 'manual',
                  a.title, a.cover_path, '',
                  (SELECT source FROM anime_source WHERE anime_id = a.id ORDER BY first_seen_at LIMIT 1)
           FROM anime a WHERE a.manual_completed = 1
         )
         WHERE (? IS NULL OR started_at < ?)
         ORDER BY started_at DESC LIMIT ?`,
      )
      .all(before ?? null, before ?? null, limit) as unknown as (WatchRow & {
      kind: 'watch' | 'mark';
      anime_title: string;
      cover_path: string | null;
      episode_label: string;
      site: Source;
    })[];
    return rows.map((r) => ({
      ...toWatch(r),
      kind: r.kind,
      animeTitle: r.anime_title,
      episodeLabel: r.episode_label,
      site: r.site,
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
    const animeId = input.animeId ?? (input.animeSn ? this.findAnimeId(input.source ?? BAHAMUT, input.animeSn) : undefined);
    if (!animeId || !this.animeRow(animeId)) throw new NotFoundError('找不到評論對應的作品');
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

  // ---- 分群 ----

  listGroups(): AnimeGroup[] {
    const rows = this.db
      .prepare(
        `SELECT g.id, g.name, g.created_at, (SELECT COUNT(*) FROM anime_group_member m WHERE m.group_id = g.id) AS count
         FROM anime_group g ORDER BY g.created_at`,
      )
      .all() as { id: string; name: string; created_at: string; count: number }[];
    return rows.map((r) => ({ id: r.id, name: r.name, count: r.count, createdAt: r.created_at }));
  }

  private group(id: string): AnimeGroup {
    const g = this.listGroups().find((x) => x.id === id);
    if (!g) throw new NotFoundError('找不到分群');
    return g;
  }

  createGroup(name: string): AnimeGroup {
    const id = ulid();
    this.db.prepare('INSERT INTO anime_group (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now());
    return this.group(id);
  }

  renameGroup(id: string, name: string): AnimeGroup {
    this.group(id);
    this.db.prepare('UPDATE anime_group SET name = ? WHERE id = ?').run(name, id);
    return this.group(id);
  }

  deleteGroup(id: string) {
    this.db.prepare('DELETE FROM anime_group WHERE id = ?').run(id);
  }

  /** 整批設定作品所屬的分群；已在的分群保留原本的加入時間 */
  setAnimeGroups(animeId: string, groupIds: string[]): AnimeDetail {
    if (!this.animeRow(animeId)) throw new NotFoundError(`找不到作品 ${animeId}`);
    const known = new Set(this.listGroups().map((g) => g.id));
    const wanted = [...new Set(groupIds)];
    if (wanted.some((g) => !known.has(g))) throw new NotFoundError('找不到分群');
    transaction(this.db, () => {
      const placeholders = wanted.map(() => '?').join(',');
      this.db
        .prepare(`DELETE FROM anime_group_member WHERE anime_id = ? ${wanted.length ? `AND group_id NOT IN (${placeholders})` : ''}`)
        .run(animeId, ...wanted);
      const insert = this.db.prepare('INSERT OR IGNORE INTO anime_group_member (group_id, anime_id, added_at) VALUES (?, ?, ?)');
      for (const g of wanted) insert.run(g, animeId, now());
    });
    return this.getAnime(animeId);
  }

  // ---- 相關作品 ----

  /** 記錄來源網站列出的相關作品；已手動移除的維持移除 */
  private putSiteRelations(source: Source, externalId: string, related: RelatedAnimeInput[]) {
    const animeId = this.findAnimeId(source, externalId);
    if (!animeId) return;
    const upsert = this.db.prepare(
      `INSERT INTO anime_relation (anime_id, source, external_id, title, cover_url, origin, created_at)
       VALUES (?, ?, ?, ?, ?, 'site', ?)
       ON CONFLICT DO UPDATE SET title = excluded.title, cover_url = COALESCE(excluded.cover_url, cover_url)`,
    );
    for (const r of related) {
      if (r.animeSn !== externalId) upsert.run(animeId, source, r.animeSn, r.title, r.coverUrl ?? null, now());
    }
    this.db
      .prepare('UPDATE anime_source SET relations_fetched_at = ? WHERE source = ? AND external_id = ?')
      .run(now(), source, externalId);
  }

  /** 背景補抓用 */
  setSiteRelations(source: Source, externalId: string, related: RelatedAnimeInput[]) {
    transaction(this.db, () => this.putSiteRelations(source, externalId, related));
  }

  /** 還沒讀過相關作品的來源 ID */
  pendingRelationFetch(source: Source): string[] {
    const rows = this.db
      .prepare('SELECT external_id FROM anime_source WHERE source = ? AND relations_fetched_at IS NULL ORDER BY first_seen_at')
      .all(source) as { external_id: string }[];
    return rows.map((r) => r.external_id);
  }

  private sourcesOf(animeId: string) {
    return this.db
      .prepare('SELECT source, external_id FROM anime_source WHERE anime_id = ? ORDER BY first_seen_at')
      .all(animeId) as { source: Source; external_id: string }[];
  }

  /** 兩個方向的關聯合併列出：這部記錄的對象，以及記錄了這部的作品 */
  relations(animeId: string): RelatedAnime[] {
    const forward = this.db.prepare('SELECT * FROM anime_relation WHERE anime_id = ?').all(animeId) as unknown as RelationRow[];
    const reverse = this.db
      .prepare(
        `SELECT r.* FROM anime_relation r
         JOIN anime_source s ON s.source = r.source AND s.external_id = r.external_id
         WHERE s.anime_id = ?`,
      )
      .all(animeId) as unknown as RelationRow[];

    const found = new Map<string, { row: RelationRow; targetId?: string }>();
    const removed = new Set<string>();
    const add = (row: RelationRow, targetId: string | undefined) => {
      const key = targetId ?? `${row.source}:${row.external_id}`;
      if (targetId === animeId) return;
      if (row.removed) removed.add(key);
      // 手動新增的優先顯示
      else if (!found.has(key) || row.origin === 'manual') found.set(key, { row, targetId });
    };
    for (const r of forward) add(r, this.findAnimeId(r.source, r.external_id));
    for (const r of reverse) add(r, r.anime_id);

    return [...found.entries()]
      .filter(([key]) => !removed.has(key))
      .map(([, { row, targetId }]): RelatedAnime => {
        const target = targetId ? this.animeRow(targetId) : undefined;
        if (!target) {
          return {
            source: row.source,
            externalId: row.external_id,
            title: row.title,
            coverUrl: row.cover_url,
            url: SOURCE_URLS[row.source](row.external_id),
            origin: row.origin,
            anime: null,
          };
        }
        const summary = this.summary(target);
        const first = this.sourcesOf(target.id)[0]!;
        return {
          source: first.source,
          externalId: first.external_id,
          title: summary.title,
          coverUrl: summary.coverUrl,
          url: SOURCE_URLS[first.source](first.external_id),
          origin: row.origin,
          anime: summary,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title, 'zh-Hant'));
  }

  addRelation(animeId: string, targetId: string): AnimeDetail {
    const target = this.animeRow(targetId);
    if (!this.animeRow(animeId) || !target || animeId === targetId) throw new NotFoundError('找不到要關聯的作品');
    transaction(this.db, () => {
      this.setRelationRemoved(animeId, targetId, false);
      const first = this.sourcesOf(targetId)[0]!;
      this.db
        .prepare(
          `INSERT INTO anime_relation (anime_id, source, external_id, title, origin, created_at)
           VALUES (?, ?, ?, ?, 'manual', ?)
           ON CONFLICT DO UPDATE SET origin = 'manual', removed = 0`,
        )
        .run(animeId, first.source, first.external_id, target.title, now());
    });
    return this.getAnime(animeId);
  }

  /** 對象以來源 ID 指定，尚未建檔的作品也能移除 */
  removeRelation(animeId: string, source: Source, externalId: string): AnimeDetail {
    if (!this.animeRow(animeId)) throw new NotFoundError(`找不到作品 ${animeId}`);
    const targetId = this.findAnimeId(source, externalId);
    transaction(this.db, () => {
      if (targetId) this.setRelationRemoved(animeId, targetId, true);
      else {
        this.db
          .prepare('UPDATE anime_relation SET removed = 1 WHERE anime_id = ? AND source = ? AND external_id = ?')
          .run(animeId, source, externalId);
      }
    });
    return this.getAnime(animeId);
  }

  /**
   * 兩部已建檔作品之間的所有關聯（兩個方向、各個來源 ID）一起設定。
   * 移除時也補上紀錄，之後讀到來源網站列出這組關聯也不會再出現。
   */
  private setRelationRemoved(aId: string, bId: string, removed: boolean) {
    const upsert = this.db.prepare(
      `INSERT INTO anime_relation (anime_id, source, external_id, title, origin, removed, created_at)
       VALUES (?, ?, ?, ?, 'manual', 1, ?)
       ON CONFLICT DO UPDATE SET removed = 1`,
    );
    const update = this.db.prepare('UPDATE anime_relation SET removed = 0 WHERE anime_id = ? AND source = ? AND external_id = ?');
    for (const [from, to] of [
      [aId, bId],
      [bId, aId],
    ] as const) {
      const title = this.animeRow(to)!.title;
      for (const s of this.sourcesOf(to)) {
        if (removed) upsert.run(from, s.source, s.external_id, title, now());
        else update.run(from, s.source, s.external_id);
      }
    }
  }

  // ---- 合併 ----

  /** 名稱相似、來源不重疊，且沒有被標記為「不是同一部」的組合 */
  mergeCandidates(): MergeCandidate[] {
    const rows = this.db.prepare('SELECT * FROM anime').all() as unknown as AnimeRow[];
    const sources = new Map<string, Set<string>>();
    for (const r of this.db.prepare('SELECT anime_id, source FROM anime_source').all() as { anime_id: string; source: string }[]) {
      if (!sources.has(r.anime_id)) sources.set(r.anime_id, new Set());
      sources.get(r.anime_id)!.add(r.source);
    }
    const dismissed = new Set(
      (this.db.prepare('SELECT a_id, b_id FROM merge_dismissed').all() as { a_id: string; b_id: string }[]).map(
        (d) => `${d.a_id}|${d.b_id}`,
      ),
    );
    const names = new Map(
      rows.map((r) => [r.id, [r.title, ...(JSON.parse(r.alt_titles) as string[])].map(normalizeTitle).filter(Boolean)]),
    );

    const pairs: { a: AnimeRow; b: AnimeRow; score: number }[] = [];
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const [a, b] = rows[i]!.id < rows[j]!.id ? [rows[i]!, rows[j]!] : [rows[j]!, rows[i]!];
        if (dismissed.has(`${a.id}|${b.id}`)) continue;
        // 同一個來源的不同作品（例如動畫瘋的不同季）不列入
        const sa = sources.get(a.id) ?? new Set<string>();
        if ([...(sources.get(b.id) ?? [])].some((s) => sa.has(s))) continue;
        let score = 0;
        for (const x of names.get(a.id)!) for (const y of names.get(b.id)!) score = Math.max(score, titleSimilarity(x, y));
        if (score >= CANDIDATE_MIN_SCORE) pairs.push({ a, b, score });
      }
    }
    return pairs
      .sort((x, y) => y.score - x.score)
      .slice(0, CANDIDATE_LIMIT)
      .map((p) => ({ a: this.summary(p.a), b: this.summary(p.b), score: Math.round(p.score * 100) / 100 }));
  }

  dismissMerge(aId: string, bId: string) {
    const [a, b] = aId < bId ? [aId, bId] : [bId, aId];
    if (!this.animeRow(a) || !this.animeRow(b)) throw new NotFoundError('找不到作品');
    this.db.prepare('INSERT OR IGNORE INTO merge_dismissed (a_id, b_id, dismissed_at) VALUES (?, ?, ?)').run(a, b, now());
  }

  /** 把 sourceId 的來源、集數、觀看紀錄與評論併入 targetId，並刪除 sourceId */
  merge(targetId: string, sourceId: string): AnimeDetail {
    const target = this.animeRow(targetId);
    const from = this.animeRow(sourceId);
    if (!target || !from || targetId === sourceId) throw new NotFoundError('找不到要合併的作品');
    transaction(this.db, () => {
      for (const table of ['anime_source', 'episode', 'watch_event', 'review']) {
        this.db.prepare(`UPDATE ${table} SET anime_id = ? WHERE anime_id = ?`).run(targetId, sourceId);
      }
      // 兩邊都有的關聯保留目標作品的；剩下的隨刪除一起清掉
      this.db.prepare('UPDATE OR IGNORE anime_relation SET anime_id = ? WHERE anime_id = ?').run(targetId, sourceId);
      this.db
        .prepare(
          `INSERT OR IGNORE INTO anime_group_member (group_id, anime_id, added_at)
           SELECT group_id, ?, added_at FROM anime_group_member WHERE anime_id = ?`,
        )
        .run(targetId, sourceId);
      if (from.favorite && !target.favorite) {
        this.db.prepare('UPDATE anime SET favorite = 1, favorited_at = ? WHERE id = ?').run(from.favorited_at, targetId);
      }
      const altTitles = [...JSON.parse(target.alt_titles), from.title, ...JSON.parse(from.alt_titles)] as string[];
      const unique = altTitles.filter((t, i) => t !== target.title && altTitles.indexOf(t) === i);
      this.db
        .prepare(
          `UPDATE anime SET alt_titles = ?, cover_path = COALESCE(cover_path, ?), hidden = MAX(hidden, ?),
             hidden_at = COALESCE(hidden_at, ?), created_at = MIN(created_at, ?), updated_at = ?,
             manual_completed_at = CASE WHEN manual_completed IS NULL THEN ? ELSE manual_completed_at END,
             manual_completed = COALESCE(manual_completed, ?) WHERE id = ?`,
        )
        .run(
          JSON.stringify(unique),
          from.cover_path,
          from.hidden,
          from.hidden_at,
          from.created_at,
          now(),
          from.manual_completed_at,
          from.manual_completed,
          targetId,
        );
      this.db.prepare('DELETE FROM anime WHERE id = ?').run(sourceId);
    });
    return this.getAnime(targetId);
  }
}

/** 比對用的名稱：全形轉半形、小寫、去掉空白與標點符號 */
export function normalizeTitle(title: string) {
  return title.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

/** 兩個正規化名稱的相似度：一方包含另一方時依長度比例給分，否則用雙字組的 Dice 係數 */
export function titleSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 2 && long.includes(short)) return 0.6 + 0.4 * (short.length / long.length);
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) m.set(s.slice(i, i + 2), (m.get(s.slice(i, i + 2)) ?? 0) + 1);
    return m;
  };
  const gb = grams(b);
  let common = 0;
  for (const [g, n] of grams(a)) common += Math.min(n, gb.get(g) ?? 0);
  const total = a.length - 1 + (b.length - 1);
  return total > 0 ? (2 * common) / total : 0;
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
