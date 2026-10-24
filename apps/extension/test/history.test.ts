import { describe, expect, it, vi } from 'vitest';
import { fetchHistory, parseApiTime, parseHistoryResponse, type ApiResponse } from '../src/bahamut/history.ts';
import { AUTO_SYNC_INTERVAL_MS, isSyncDue } from '../src/lib/sync-due.ts';

// 觀看紀錄 API 的結構（內容為虛構值）
const anime = (over: Record<string, unknown> = {}) => ({
  animeSn: 113845,
  videoSn: 51805,
  title: '殺手旅店',
  cover: 'https://p2.bahamut.com.tw/B/ACG/c/94/0000142294.JPG',
  episode: '16',
  duration: 23,
  watchTime: '2026-10-23 21:00:00',
  nextVideoSn: 0,
  isTakenDown: 0,
  breakPoint: { breakPoint: 1303, watchTime: '2026-10-23 21:22:00' },
  history: [
    { videoSn: 51805, title: '殺手旅店 [16]', watchTime: '2026-10-23 21:00:00' },
    { videoSn: 51804, title: '殺手旅店 [15]', watchTime: '2026-10-23 20:30:00' },
  ],
  ...over,
});
const page = (history: unknown[], totalPage = 1): ApiResponse => ({ data: { history, totalPage } }) as ApiResponse;

describe('parseApiTime', () => {
  it('以台灣時間解讀', () => {
    expect(parseApiTime('2026-10-24 10:24:58')).toBe('2026-10-24T02:24:58.000Z');
  });
  it('格式不符時回傳 undefined', () => {
    expect(parseApiTime('昨天 22:13')).toBeUndefined();
  });
});

describe('parseHistoryResponse', () => {
  it('每集一筆，進度只屬於最近一集', () => {
    const { items } = parseHistoryResponse(page([anime()]));
    expect(items).toEqual([
      {
        animeSn: '113845',
        title: '殺手旅店',
        coverUrl: 'https://p2.bahamut.com.tw/B/ACG/c/94/0000142294.JPG',
        videoSn: '51805',
        episodeLabel: '16',
        watchedAt: '2026-10-23T13:00:00.000Z',
        lastSeenAt: '2026-10-23T13:22:00.000Z',
        progressSec: 1303,
        durationSec: 23 * 60,
      },
      {
        animeSn: '113845',
        title: '殺手旅店',
        coverUrl: 'https://p2.bahamut.com.tw/B/ACG/c/94/0000142294.JPG',
        videoSn: '51804',
        episodeLabel: '15',
        watchedAt: '2026-10-23T12:30:00.000Z',
      },
    ]);
  });

  it('breakPoint 為 -1 時視為看完；沒有進度時不帶', () => {
    const done = parseHistoryResponse(page([anime({ breakPoint: { breakPoint: -1, watchTime: '2026-10-23 21:22:00' } })]));
    expect(done.items[0]).toMatchObject({ completed: true });
    expect(done.items[0]).not.toHaveProperty('progressSec');
    const none = parseHistoryResponse(page([anime({ breakPoint: [] })]));
    expect(none.items[0]).not.toHaveProperty('progressSec');
  });

  it('未登入時拋出錯誤', () => {
    expect(() =>
      parseHistoryResponse({ error: { code: 401, message: '尚未登入', status: 'NO_LOGIN' } }),
    ).toThrow('尚未登入動畫瘋');
  });
});

describe('fetchHistory', () => {
  const pages = [
    page([anime({ watchTime: '2026-10-23 21:00:00' })], 3),
    page([anime({ animeSn: 2, watchTime: '2026-10-10 21:00:00', history: [] })], 3),
    page([anime({ animeSn: 3, watchTime: '2026-09-01 21:00:00', history: [] })], 3),
  ];
  const fakeFetch = () =>
    vi.fn(async (url: string | URL | Request) => {
      const n = Number(new URL(String(url)).searchParams.get('page'));
      return new Response(JSON.stringify(pages[n - 1]));
    });

  it('沒有 since 時讀完所有頁', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    const f = fakeFetch();
    await fetchHistory({ fetch: f as typeof fetch });
    expect(f).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it('讀到比 since 更早的頁就停止', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    const f = fakeFetch();
    await fetchHistory({ fetch: f as typeof fetch, since: '2026-10-20T00:00:00.000Z' });
    expect(f).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});

describe('isSyncDue', () => {
  const now = Date.parse('2026-10-24T12:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it.each([
    ['從未同步', {}, true],
    ['成功後未滿 6 小時', { lastRunAt: ago(AUTO_SYNC_INTERVAL_MS - 1), ok: true }, false],
    ['成功後滿 6 小時', { lastRunAt: ago(AUTO_SYNC_INTERVAL_MS), ok: true }, true],
    ['失敗後 1 小時重試', { lastRunAt: ago(3_600_000), ok: false }, true],
    ['正在同步', { runningSince: ago(60_000) }, false],
  ])('%s', (_name, state, expected) => {
    expect(isSyncDue(state, now)).toBe(expected);
  });
});
