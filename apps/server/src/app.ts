import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import {
  ANIME_FILTERS,
  ANIME_PROGRESS,
  ANIME_RATINGS,
  ANIME_SORTS,
  animeGroupsPutSchema,
  animePatchSchema,
  bahamutAnimeUpsertSchema,
  bahamutHideSchema,
  bahamutImportSchema,
  bahamutStatusRequestSchema,
  bahamutWatchSchema,
  groupNameSchema,
  isSource,
  markCompletedSchema,
  mergeDismissSchema,
  mergeSchema,
  relationAddSchema,
  reviewPutSchema,
  SOURCES,
  snMapLookupSchema,
  snMapPutSchema,
  type AnimeFilter,
  type AnimeProgress,
  type AnimeRating,
  type AnimeSort,
  type Health,
  type ImportResult,
  type Source,
} from '@agm/shared';
import type { CoverQueue } from './covers.ts';
import { NotFoundError, type Store } from './store.ts';

export interface AppDeps {
  store: Store;
  queueCover: CoverQueue;
  port: number;
  dataDir: string;
  version?: string;
}


async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) throw new HTTPException(400, { message: parsed.error.message });
  return parsed.data;
}

/**
 * 只允許本機管理頁與 Chrome extension 存取。
 * 檢查 Host 可防 DNS rebinding；檢查 Origin 可防其他網站在背景呼叫 localhost。
 */
function isAllowedOrigin(origin: string, port: number) {
  return (
    origin.startsWith('chrome-extension://') ||
    origin === `http://127.0.0.1:${port}` ||
    origin === `http://localhost:${port}` ||
    // Vite 開發伺服器
    origin === 'http://localhost:5173' ||
    origin === 'http://127.0.0.1:5173'
  );
}

export function createApp({ store, queueCover, port, dataDir, version = '0.1.0' }: AppDeps) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    // node-server 以 Host 標頭組出 req.url
    const { hostname } = new URL(c.req.url);
    if (hostname !== '127.0.0.1' && hostname !== 'localhost') throw new HTTPException(403, { message: 'Host 不允許' });
    const origin = c.req.header('origin');
    if (origin && !isAllowedOrigin(origin, port)) throw new HTTPException(403, { message: 'Origin 不允許' });
    await next();
  });
  app.use('/api/*', cors({ origin: (o) => (isAllowedOrigin(o, port) ? o : null) }));

  app.onError((err, c) => {
    if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
    if (err instanceof NotFoundError) return c.json({ error: err.message }, 404);
    console.error(err);
    return c.json({ error: '伺服器錯誤' }, 500);
  });

  const api = new Hono();

  api.get('/health', (c) => c.json<Health>({ ok: true, version, dataDir }));

  // ---- 各來源（extension 使用），路徑為 /api/<source>/... ----

  const site = new Hono<{ Variables: { source: Source } }>();
  site.use('*', async (c, next) => {
    c.set('source', c.req.param('source') as Source);
    await next();
  });

  site.post('/anime', async (c) => {
    const { id, coverUrl } = store.upsertAnime(c.get('source'), await body(c, bahamutAnimeUpsertSchema));
    queueCover(id, coverUrl);
    return c.json(store.getAnime(id));
  });

  site.get('/anime/:animeSn', (c) => {
    const id = store.findAnimeId(c.get('source'), c.req.param('animeSn'));
    if (!id) throw new NotFoundError('尚未建檔');
    return c.json(store.getAnime(id));
  });

  site.post('/status', async (c) =>
    c.json(store.cardStatus(c.get('source'), (await body(c, bahamutStatusRequestSchema)).animeSns)),
  );

  site.post('/hide', async (c) => {
    const { id, coverUrl } = store.setHidden(c.get('source'), await body(c, bahamutHideSchema));
    queueCover(id, coverUrl);
    return c.json({ id });
  });

  site.get('/hidden', (c) => c.json(store.hiddenIds(c.get('source'))));

  site.post('/completed', async (c) => {
    const { id, coverUrl } = store.markCompleted(c.get('source'), await body(c, markCompletedSchema));
    queueCover(id, coverUrl);
    return c.json(store.getAnime(id));
  });

  // 單集 sn 對應只有動畫瘋週期表需要
  site.post('/sn-map/lookup', async (c) => c.json(store.lookupSnMap((await body(c, snMapLookupSchema)).videoSns)));

  site.put('/sn-map', async (c) => {
    store.putSnMap((await body(c, snMapPutSchema)).entries);
    return c.body(null, 204);
  });

  site.post('/watch', async (c) => {
    const { watch, coverUrl } = store.recordWatch(c.get('source'), await body(c, bahamutWatchSchema));
    queueCover(watch.animeId, coverUrl);
    return c.json(watch);
  });

  site.post('/import', async (c) => {
    const { covers, ...result } = store.importWatches(c.get('source'), (await body(c, bahamutImportSchema)).items);
    for (const [id, url] of covers) queueCover(id, url);
    return c.json<ImportResult>(result);
  });

  api.route(`/:source{${SOURCES.join('|')}}`, site);

  // ---- 管理 ----

  api.get('/anime', (c) => {
    const query = (name: string) => c.req.query(name) || undefined;
    const bad = (name: string) => new HTTPException(400, { message: `${name} 不正確` });
    const filter = (query('filter') ?? 'all') as AnimeFilter;
    if (!ANIME_FILTERS.includes(filter)) throw bad('filter');
    const sort = (query('sort') ?? 'default') as AnimeSort;
    if (!ANIME_SORTS.includes(sort)) throw bad('sort');
    // 多個來源以逗號分隔
    const sites = (query('site') ?? '').split(',').filter(Boolean);
    if (!sites.every(isSource)) throw bad('site');
    // 多個評分以逗號分隔，例如 5,3,unrated
    const ratings = (query('rating') ?? '')
      .split(',')
      .filter(Boolean)
      .map((r) => ANIME_RATINGS.find((x) => String(x) === r));
    if (ratings.includes(undefined)) throw bad('rating');
    const progress = query('progress') as AnimeProgress | undefined;
    if (progress !== undefined && !ANIME_PROGRESS.includes(progress)) throw bad('progress');
    return c.json(
      store.listAnime({
        filter,
        sort,
        ratings: ratings as AnimeRating[],
        progress,
        q: query('q'),
        sites: sites as Source[],
        groupId: query('group'),
        includeHidden: query('hidden') === 'include',
      }),
    );
  });

  api.get('/anime/:id', (c) => c.json(store.getAnime(c.req.param('id'))));

  api.patch('/anime/:id', async (c) => c.json(store.patchAnime(c.req.param('id'), await body(c, animePatchSchema))));

  api.get('/watch', (c) => {
    const limit = Math.min(Number(c.req.query('limit') ?? 50) || 50, 200);
    return c.json(store.watchHistory(limit, c.req.query('before')));
  });

  api.delete('/watch/:id', (c) => {
    store.deleteWatch(c.req.param('id'));
    return c.body(null, 204);
  });

  api.put('/reviews/:id', async (c) => c.json(store.putReview(c.req.param('id'), await body(c, reviewPutSchema))));

  api.delete('/reviews/:id', (c) => {
    store.deleteReview(c.req.param('id'));
    return c.body(null, 204);
  });

  api.put('/anime/:id/groups', async (c) =>
    c.json(store.setAnimeGroups(c.req.param('id'), (await body(c, animeGroupsPutSchema)).groupIds)),
  );

  api.post('/anime/:id/relations', async (c) =>
    c.json(store.addRelation(c.req.param('id'), (await body(c, relationAddSchema)).targetId)),
  );

  api.delete('/anime/:id/relations/:source/:externalId', (c) => {
    const source = c.req.param('source');
    if (!isSource(source)) throw new HTTPException(400, { message: 'source 不正確' });
    return c.json(store.removeRelation(c.req.param('id'), source, c.req.param('externalId')));
  });

  api.get('/groups', (c) => c.json(store.listGroups()));

  api.post('/groups', async (c) => c.json(store.createGroup((await body(c, groupNameSchema)).name)));

  api.patch('/groups/:id', async (c) =>
    c.json(store.renameGroup(c.req.param('id'), (await body(c, groupNameSchema)).name)),
  );

  api.delete('/groups/:id', (c) => {
    store.deleteGroup(c.req.param('id'));
    return c.body(null, 204);
  });

  api.get('/merge/candidates', (c) => c.json(store.mergeCandidates()));

  api.post('/merge', async (c) => {
    const { targetId, sourceId } = await body(c, mergeSchema);
    return c.json(store.merge(targetId, sourceId));
  });

  api.post('/merge/dismiss', async (c) => {
    const { aId, bId } = await body(c, mergeDismissSchema);
    store.dismissMerge(aId, bId);
    return c.body(null, 204);
  });

  app.route('/api', api);
  return app;
}
