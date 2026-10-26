import { beforeEach, describe, expect, it } from 'vitest';
import type { AnimeDetail, AnimeSummary, CardStatus, MergeCandidate, WatchEvent, WatchHistoryItem } from '@agm/shared';
import { createApp } from '../src/app.ts';
import { openDb } from '../src/db.ts';
import { normalizeTitle, Store, titleSimilarity } from '../src/store.ts';

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
    expect(await json(call('POST', '/api/bahamut/import', { items }))).toEqual({ imported: 2, updated: 0, skipped: 1 });
    expect(await json(call('POST', '/api/bahamut/import', { items }))).toEqual({ imported: 0, updated: 0, skipped: 3 });
    expect(covers.at(-1)?.[1]).toBe('https://p2.bahamut.com.tw/x.JPG');

    const detail = await json<AnimeDetail>(call('GET', '/api/bahamut/anime/113845'));
    // 已建檔的集數不被匯入資料覆寫
    expect(detail.episodes.map((e) => [e.label, e.sortOrder])).toEqual([['15', 14], ['16', 15]]);
    expect(detail.episodes[0]!.watches[0]).toMatchObject({ source: 'import', completed: true });

    const created = await json<AnimeDetail>(call('GET', '/api/bahamut/anime/9'));
    expect(created).toMatchObject({ title: '新動畫', lastEpisodeLabel: '3' });
    expect(created.episodes[0]!.sortOrder).toBe(2);
  });

  it('匯入觀看紀錄：重看同一集被動畫瘋覆蓋時保留兩筆', async () => {
    const item = (videoSn: string, label: string, watchedAt: string) => ({
      animeSn: '113845',
      title: '殺手旅店',
      videoSn,
      episodeLabel: label,
      watchedAt,
    });
    // 依序看 1、2、3 集，動畫瘋的紀錄是 3、2、1
    await call('POST', '/api/bahamut/import', {
      items: [
        item('3', '3', '2026-10-23T12:50:00.000Z'),
        item('2', '2', '2026-10-23T12:25:00.000Z'),
        item('1', '1', '2026-10-23T12:00:00.000Z'),
      ],
    });
    // 再看第 1 集，動畫瘋只剩 1、3、2
    const res = await json(
      call('POST', '/api/bahamut/import', {
        items: [
          item('1', '1', '2026-10-23T13:15:00.000Z'),
          item('3', '3', '2026-10-23T12:50:00.000Z'),
          item('2', '2', '2026-10-23T12:25:00.000Z'),
        ],
      }),
    );
    expect(res).toEqual({ imported: 1, updated: 0, skipped: 2 });

    const history = await json<WatchEvent[]>(call('GET', '/api/watch'));
    expect(history.map((w) => w.startedAt)).toEqual([
      '2026-10-23T13:15:00.000Z',
      '2026-10-23T12:50:00.000Z',
      '2026-10-23T12:25:00.000Z',
      '2026-10-23T12:00:00.000Z',
    ]);
  });

  it('匯入觀看紀錄：同一筆再次匯入時更新進度；舊版只到分鐘的時間也視為同一筆', async () => {
    const base = { animeSn: '113845', title: '殺手旅店', videoSn: '51805', episodeLabel: '16' };
    await call('POST', '/api/bahamut/import', { items: [{ ...base, watchedAt: '2026-10-23T12:00:00.000Z', progressSec: 300 }] });
    const res = await json(
      call('POST', '/api/bahamut/import', {
        items: [{ ...base, watchedAt: '2026-10-23T12:00:48.000Z', progressSec: 1300, durationSec: 1380 }],
      }),
    );
    expect(res).toEqual({ imported: 0, updated: 1, skipped: 0 });
    const [w] = await json<WatchEvent[]>(call('GET', '/api/watch'));
    expect(w).toMatchObject({ progressSec: 1300, durationSec: 1380, completed: true });
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

describe('Netflix', () => {
  const show = {
    animeSn: '81000001',
    title: '藥師少女的獨語',
    coverUrl: 'https://occ-0-1.1.nflxso.net/dnm/api/v6/x.jpg',
    episodes: [
      { videoSn: '81000101', label: '1', sortOrder: 1001 },
      { videoSn: '81000102', label: '2', sortOrder: 1002 },
    ],
  };
  const item = (over: Record<string, unknown> = {}) => ({
    animeSn: '81000001',
    title: '藥師少女的獨語',
    videoSn: '81000101',
    watchedAt: '2026-10-23T12:00:00.000Z',
    ...over,
  });

  it('與動畫瘋的 ID 分開管理', async () => {
    await call('POST', '/api/bahamut/anime', { animeSn: '81000001', title: '動畫瘋的作品' });
    await call('POST', '/api/netflix/anime', show);
    await call('POST', '/api/netflix/hide', { animeSn: '81000001', hidden: true, at: '2026-10-23T00:00:00.000Z' });

    expect(await json(call('GET', '/api/netflix/hidden'))).toEqual(['81000001']);
    expect(await json(call('GET', '/api/bahamut/hidden'))).toEqual([]);
    const detail = await json<AnimeDetail>(call('GET', '/api/netflix/anime/81000001'));
    expect(detail).toMatchObject({ title: '藥師少女的獨語', sites: ['netflix'] });
    expect(detail.sources[0]!.url).toBe('https://www.netflix.com/title/81000001');
    expect((await call('GET', '/api/youtube/hidden')).status).toBe(404);
  });

  it('同步時開始時間的推算值有誤差也視為同一次；隔天重看另外保留', async () => {
    await call('POST', '/api/netflix/anime', show);
    await call('POST', '/api/netflix/import', {
      items: [item({ lastSeenAt: '2026-10-23T12:10:00.000Z', progressSec: 600, durationSec: 1440 })],
    });
    const again = await json(
      call('POST', '/api/netflix/import', {
        items: [
          item({ watchedAt: '2026-10-23T12:01:30.000Z', lastSeenAt: '2026-10-23T12:24:00.000Z', progressSec: 1400, durationSec: 1440 }),
        ],
      }),
    );
    expect(again).toEqual({ imported: 0, updated: 1, skipped: 0 });

    const nextDay = await json(
      call('POST', '/api/netflix/import', {
        items: [item({ watchedAt: '2026-10-24T20:00:00.000Z', lastSeenAt: '2026-10-24T20:05:00.000Z', progressSec: 300 })],
      }),
    );
    expect(nextDay).toEqual({ imported: 1, updated: 0, skipped: 0 });
    const history = await json<WatchEvent[]>(call('GET', '/api/watch'));
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ progressSec: 1400, completed: true, lastSeenAt: '2026-10-23T12:24:00.000Z' });
  });

  it('與本機播放時的自動記錄重疊時略過', async () => {
    await call('POST', '/api/netflix/anime', show);
    await call(
      'POST',
      '/api/netflix/watch',
      watch({
        animeSn: '81000001',
        videoSn: '81000101',
        startedAt: '2026-10-23T12:00:00.000Z',
        at: '2026-10-23T12:24:00.000Z',
        progressSec: 1400,
      }),
    );
    const res = await json(
      call('POST', '/api/netflix/import', { items: [item({ watchedAt: '2026-10-23T12:03:00.000Z', lastSeenAt: '2026-10-23T12:24:00.000Z' })] }),
    );
    expect(res).toEqual({ imported: 0, updated: 0, skipped: 1 });
  });
});

describe('合併', () => {
  async function seed() {
    const s1 = await json<AnimeDetail>(call('POST', '/api/bahamut/anime', { animeSn: '1', title: '藥師少女的獨語' }));
    const s2 = await json<AnimeDetail>(call('POST', '/api/bahamut/anime', { animeSn: '2', title: '藥師少女的獨語 第二季' }));
    const nf = await json<AnimeDetail>(
      call('POST', '/api/netflix/anime', { animeSn: '81000001', title: '藥師少女的獨語', episodes: [{ videoSn: '81000101', label: '1', sortOrder: 1001 }] }),
    );
    await call('POST', '/api/bahamut/anime', { animeSn: '3', title: '完全不同的動畫' });
    return { s1, s2, nf };
  }
  const candidates = () => json<MergeCandidate[]>(call('GET', '/api/merge/candidates'));
  const pairKey = (c: MergeCandidate) => [c.a.id, c.b.id].sort().join('|');
  const key = (x: string, y: string) => [x, y].sort().join('|');

  it('列出名稱相似、來源不同的作品', async () => {
    const { s1, s2, nf } = await seed();
    const list = await candidates();
    // 同為動畫瘋的第一季與第二季不列入
    expect(list.map(pairKey).sort()).toEqual([key(s1.id, nf.id), key(s2.id, nf.id)].sort());
    expect(list[0]).toMatchObject({ score: 1 });
  });

  it('標記為不是同一部之後不再列出', async () => {
    const { s2, nf } = await seed();
    expect((await call('POST', '/api/merge/dismiss', { aId: nf.id, bId: s2.id })).status).toBe(204);
    expect((await candidates()).map(pairKey)).not.toContain(key(s2.id, nf.id));
  });

  it('合併後來源、集數、觀看紀錄與評論都移到保留的作品', async () => {
    const { s1, nf } = await seed();
    await call(
      'POST',
      '/api/netflix/watch',
      watch({ id: 'NW', animeSn: '81000001', videoSn: '81000101', episodeLabel: '1' }),
    );
    await call('PUT', '/api/reviews/R1', {
      animeId: nf.id,
      content: '好看',
      createdAt: '2026-10-23T00:00:00.000Z',
      updatedAt: '2026-10-23T00:00:00.000Z',
    });

    const merged = await json<AnimeDetail>(call('POST', '/api/merge', { targetId: s1.id, sourceId: nf.id }));
    expect(merged.sites).toEqual(['bahamut', 'netflix']);
    expect(merged.episodes.map((e) => e.source)).toEqual(['netflix']);
    expect(merged.episodes[0]!.watches.map((w) => w.id)).toEqual(['NW']);
    expect(merged.reviews.map((r) => r.id)).toEqual(['R1']);
    expect((await call('GET', `/api/anime/${nf.id}`)).status).toBe(404);
    // Netflix 那邊之後的資料也會寫到合併後的作品
    expect((await json<AnimeDetail>(call('GET', '/api/netflix/anime/81000001'))).id).toBe(s1.id);
    expect((await candidates()).map(pairKey)).not.toContain(key(s1.id, nf.id));
  });
});

describe('titleSimilarity', () => {
  it.each([
    ['藥師少女的獨語', '藥師少女的獨語', 1],
    ['葬送的芙莉蓮', '完全不同的動畫', 0],
  ])('%s / %s', (a, b, expected) => {
    expect(titleSimilarity(normalizeTitle(a), normalizeTitle(b))).toBeCloseTo(expected);
  });
  it('一方包含另一方時分數較高', () => {
    expect(titleSimilarity(normalizeTitle('藥師少女的獨語'), normalizeTitle('藥師少女的獨語 第二季'))).toBeGreaterThan(0.8);
  });
  it('忽略全形與標點', () => {
    expect(normalizeTitle('ＳＰＹ×ＦＡＭＩＬＹ')).toBe(normalizeTitle('SPY FAMILY'));
  });
});

describe('手動標記看完', () => {
  it('在來源網站標記看完；觀看紀錄多一列標記時間', async () => {
    await call('POST', '/api/bahamut/anime', anime);
    await call('POST', '/api/bahamut/watch', watch({ startedAt: '2026-10-23T12:00:00.000Z', progressSec: 60 }));
    const marked = await json<AnimeDetail>(
      call('POST', '/api/bahamut/completed', { animeSn: '113845', completed: true, at: '2026-10-24T09:00:00.000Z' }),
    );
    expect(marked).toMatchObject({ completed: true, manualCompleted: true, manualCompletedAt: '2026-10-24T09:00:00.000Z' });

    const status = await json<Record<string, CardStatus>>(call('POST', '/api/bahamut/status', { animeSns: ['113845'] }));
    expect(status['113845']!.completed).toBe(true);

    const history = await json<WatchHistoryItem[]>(call('GET', '/api/watch'));
    expect(history.map((h) => [h.kind, h.startedAt])).toEqual([
      ['mark', '2026-10-24T09:00:00.000Z'],
      ['watch', '2026-10-23T12:00:00.000Z'],
    ]);
    expect(history[0]).toMatchObject({ id: `mark:${marked.id}`, animeTitle: '殺手旅店', site: 'bahamut', source: 'manual' });
  });

  it('標記沒看完會蓋過自動判斷；改回 null 恢復自動判斷', async () => {
    const { id } = await json<AnimeDetail>(call('POST', '/api/bahamut/anime', anime));
    await call('POST', '/api/bahamut/watch', watch({ progressSec: 1400 }));
    expect((await json<AnimeDetail>(call('PATCH', `/api/anime/${id}`, { manualCompleted: false }))).completed).toBe(false);
    expect((await json<WatchHistoryItem[]>(call('GET', '/api/watch'))).map((h) => h.kind)).toEqual(['watch']);
    const auto = await json<AnimeDetail>(call('PATCH', `/api/anime/${id}`, { manualCompleted: null }));
    expect(auto).toMatchObject({ completed: true, manualCompleted: null, manualCompletedAt: null });
  });

  it('尚未建檔的作品也能標記', async () => {
    const res = await call('POST', '/api/netflix/completed', { animeSn: '81000001', completed: true, at: '2026-10-24T09:00:00.000Z' });
    expect(res.status).toBe(200);
  });
});

describe('列表依來源篩選', () => {
  it('site=netflix 只列出有 Netflix 來源的作品', async () => {
    await call('POST', '/api/bahamut/anime', { animeSn: '1', title: '動畫瘋的' });
    await call('POST', '/api/netflix/anime', { animeSn: '2', title: 'Netflix 的' });
    expect((await json<AnimeSummary[]>(call('GET', '/api/anime?site=netflix'))).map((a) => a.title)).toEqual(['Netflix 的']);
    expect((await json<AnimeSummary[]>(call('GET', '/api/anime?site=bahamut'))).map((a) => a.title)).toEqual(['動畫瘋的']);
    expect((await call('GET', '/api/anime?site=youtube')).status).toBe(400);
  });
});
