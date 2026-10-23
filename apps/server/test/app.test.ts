import { beforeEach, describe, expect, it } from 'vitest';
import type { AnimeDetail, AnimeSummary, CardStatus, WatchEvent } from '@agm/shared';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { Store } from '../src/store.ts';

const PORT = 17890;
let app: ReturnType<typeof createApp>;
let covers: [string, string | null][];

function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  return app.request(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;

const anime = {
  animeSn: '113845',
  acgSn: '142294',
  title: '殺手旅店',
  coverUrl: 'https://p2.bahamut.com.tw/B/ACG/c/94/0000142294.JPG',
  tags: ['動作'],
  episodes: [
    { videoSn: '51804', label: '15', sortOrder: 14 },
    { videoSn: '51805', label: '16', sortOrder: 15 },
  ],
};

const watch = (over: Record<string, unknown> = {}) => ({
  id: 'W1',
  animeSn: '113845',
  animeTitle: '殺手旅店',
  videoSn: '51805',
  episodeLabel: '16',
  startedAt: '2026-10-23T12:00:00.000Z',
  at: '2026-10-23T12:00:00.000Z',
  progressSec: 0,
  durationSec: 1440,
  ...over,
});

beforeEach(() => {
  covers = [];
  app = createApp({
    store: new Store(openDb(':memory:')),
    queueCover: (id, url) => covers.push([id, url]),
    port: PORT,
    dataDir: '/tmp',
  });
});

describe('安全性', () => {
  it('拒絕其他網站的 Origin', async () => {
    expect((await call('GET', '/api/health', undefined, { origin: 'https://evil.example' })).status).toBe(403);
  });
  it('允許 extension 的 Origin', async () => {
    expect((await call('GET', '/api/health', undefined, { origin: 'chrome-extension://abc' })).status).toBe(200);
  });
  it('拒絕非本機 Host', async () => {
    const res = await app.request('http://evil.example/api/health');
    expect(res.status).toBe(403);
  });
});

describe('動畫瘋', () => {
  it('建檔後會排入封面下載，並可用 animeSn 查詢', async () => {
    const created = await json<AnimeDetail>(call('POST', '/api/bahamut/anime', anime));
    expect(created.title).toBe('殺手旅店');
    expect(created.episodes.map((e) => e.label)).toEqual(['15', '16']);
    expect(covers).toEqual([[created.id, anime.coverUrl]]);

    const again = await json<AnimeDetail>(call('POST', '/api/bahamut/anime', anime));
    expect(again.id).toBe(created.id);
    expect((await call('GET', '/api/bahamut/anime/113845')).status).toBe(200);
    expect((await call('GET', '/api/bahamut/anime/999')).status).toBe(404);
  });

  it('隱藏未建檔的動畫時會自動建檔', async () => {
    await call('POST', '/api/bahamut/hide', { animeSn: '1', hidden: true, title: '卡片名稱', at: '2026-10-23T00:00:00.000Z' });
    expect(await json(call('GET', '/api/bahamut/hidden'))).toEqual(['1']);
    const status = await json<Record<string, CardStatus>>(call('POST', '/api/bahamut/status', { animeSns: ['1', '2'] }));
    expect(Object.keys(status)).toEqual(['1']);
    expect(status['1']!.hidden).toBe(true);

    await call('POST', '/api/bahamut/hide', { animeSn: '1', hidden: false, at: '2026-10-23T00:01:00.000Z' });
    expect(await json(call('GET', '/api/bahamut/hidden'))).toEqual([]);
  });

  it('集數對應：已建檔的集數與快取都查得到', async () => {
    await call('POST', '/api/bahamut/anime', anime);
    await call('PUT', '/api/bahamut/sn-map', { entries: { '777': '555' } });
    expect(await json(call('POST', '/api/bahamut/sn-map/lookup', { videoSns: ['51805', '777', '1'] }))).toEqual({
      '51805': '113845',
      '777': '555',
    });
  });

  it('觀看紀錄以 id 冪等寫入，進度超過門檻視為看完', async () => {
    await call('POST', '/api/bahamut/anime', anime);
    await call('POST', '/api/bahamut/watch', watch());
    const updated = await json<WatchEvent>(
      call('POST', '/api/bahamut/watch', watch({ at: '2026-10-23T12:23:00.000Z', progressSec: 1300 })),
    );
    expect(updated.completed).toBe(true);
    expect(updated.startedAt).toBe('2026-10-23T12:00:00.000Z');

    // 較舊的重送不會覆蓋進度
    const stale = await json<WatchEvent>(call('POST', '/api/bahamut/watch', watch({ progressSec: 10 })));
    expect(stale.progressSec).toBe(1300);

    const history = await json<unknown[]>(call('GET', '/api/watch'));
    expect(history).toHaveLength(1);

    const status = await json<Record<string, CardStatus>>(call('POST', '/api/bahamut/status', { animeSns: ['113845'] }));
    expect(status['113845']).toMatchObject({ lastEpisodeLabel: '16', completed: true });
  });

  it('只看完較早的集數時不算看完', async () => {
    await call('POST', '/api/bahamut/anime', anime);
    await call('POST', '/api/bahamut/watch', watch({ videoSn: '51804', episodeLabel: '15', progressSec: 1400 }));
    const status = await json<Record<string, CardStatus>>(call('POST', '/api/bahamut/status', { animeSns: ['113845'] }));
    expect(status['113845']).toMatchObject({ lastEpisodeLabel: '15', completed: false });
  });

  it('未建檔的動畫也能寫入觀看紀錄', async () => {
    const res = await call('POST', '/api/bahamut/watch', watch({ animeSn: '42' }));
    expect(res.status).toBe(200);
    const list = await json<AnimeSummary[]>(call('GET', '/api/anime'));
    expect(list[0]!.title).toBe('殺手旅店');
  });

  it('匯入觀看紀錄：重複匯入與自動紀錄重疊時略過', async () => {
    await call('POST', '/api/bahamut/anime', anime);
    await call('POST', '/api/bahamut/watch', watch());
    const items = [
      // 與自動紀錄相差 10 分鐘，視為同一次
      { animeSn: '113845', title: '殺手旅店', videoSn: '51805', episodeLabel: '16', watchedAt: '2026-10-23T12:10:00.000Z' },
      { animeSn: '113845', title: '殺手旅店', videoSn: '51804', episodeLabel: '15', watchedAt: '2026-10-20T12:00:00.000Z', completed: true },
      { animeSn: '9', title: '新動畫', coverUrl: 'https://p2.bahamut.com.tw/x.JPG', videoSn: '90', episodeLabel: '3', watchedAt: '2026-10-01T00:00:00.000Z' },
    ];
    expect(await json(call('POST', '/api/bahamut/import', { items }))).toEqual({ imported: 2, skipped: 1 });
    expect(await json(call('POST', '/api/bahamut/import', { items }))).toEqual({ imported: 0, skipped: 3 });
    expect(covers.at(-1)?.[1]).toBe('https://p2.bahamut.com.tw/x.JPG');

    const detail = await json<AnimeDetail>(call('GET', '/api/bahamut/anime/113845'));
    // 已建檔的集數不被匯入資料覆寫
    expect(detail.episodes.map((e) => [e.label, e.sortOrder])).toEqual([['15', 14], ['16', 15]]);
    expect(detail.episodes[0]!.watches[0]).toMatchObject({ source: 'import', completed: true });

    const created = await json<AnimeDetail>(call('GET', '/api/bahamut/anime/9'));
    expect(created).toMatchObject({ title: '新動畫', lastEpisodeLabel: '3' });
    expect(created.episodes[0]!.sortOrder).toBe(2);
  });

  it('格式錯誤回傳 400', async () => {
    expect((await call('POST', '/api/bahamut/watch', { id: 'x' })).status).toBe(400);
  });
});

describe('評論與管理', () => {
  it('評論可用 animeSn 建立、較新的版本才會覆寫', async () => {
    const { id } = await json<AnimeDetail>(call('POST', '/api/bahamut/anime', anime));
    const base = { content: '好看', createdAt: '2026-10-23T00:00:00.000Z', updatedAt: '2026-10-23T00:00:00.000Z' };
    expect((await call('PUT', '/api/reviews/R1', { ...base, animeSn: '113845', rating: 5 })).status).toBe(200);
    await call('PUT', '/api/reviews/R1', { ...base, animeId: id, content: '舊的', updatedAt: '2026-10-22T00:00:00.000Z' });

    const detail = await json<AnimeDetail>(call('GET', `/api/anime/${id}`));
    expect(detail.reviews).toMatchObject([{ id: 'R1', content: '好看', rating: 5, spoiler: false }]);

    await call('DELETE', '/api/reviews/R1');
    expect((await json<AnimeDetail>(call('GET', `/api/anime/${id}`))).reviews).toEqual([]);
  });

  it('評論找不到動畫時回傳 404', async () => {
    const res = await call('PUT', '/api/reviews/R1', {
      animeSn: '1',
      content: 'x',
      createdAt: '2026-10-23T00:00:00.000Z',
      updatedAt: '2026-10-23T00:00:00.000Z',
    });
    expect(res.status).toBe(404);
  });

  it('列表篩選與搜尋', async () => {
    const { id } = await json<AnimeDetail>(call('POST', '/api/bahamut/anime', anime));
    await call('POST', '/api/bahamut/anime', { animeSn: '2', title: '另一部 100%' });
    await call('PATCH', `/api/anime/${id}`, { hidden: true });

    expect((await json<AnimeSummary[]>(call('GET', '/api/anime'))).length).toBe(2);
    expect((await json<AnimeSummary[]>(call('GET', '/api/anime?filter=hidden'))).map((a) => a.id)).toEqual([id]);
    expect((await json<AnimeSummary[]>(call('GET', '/api/anime?q=100%25'))).map((a) => a.title)).toEqual(['另一部 100%']);
    expect((await call('GET', '/api/anime?filter=bad')).status).toBe(400);
  });
});
