import { describe, expect, it } from 'vitest';
import {
  findNetflixCards,
  groupRows,
  MOVIE_LABEL,
  parseMetadata,
  parseViewingActivity,
  watchVideoId,
  type MetadataResponse,
} from '../src/netflix/parse.ts';

// 結構取自 Netflix 頁面與 metadata API，內容為虛構值
const doc = (html: string) => new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');

describe('卡片', () => {
  it('從 jbv 取得作品 ID，名稱取 aria-label', () => {
    const cards = findNetflixCards(
      doc(`
        <a href="/browse?jbv=81000001" aria-label="藥師少女的獨語" data-uia="standard-card" class="x-cache-1"><div><img src="https://occ-0-1.1.nflxso.net/a.webp"></div></a>
        <a href="/browse?jbv=81000002" aria-label="排行榜作品" data-uia="ranked-card"><svg></svg></a>
        <a href="/browse/genre/1" data-uia="standard-card">類別</a>
      `),
    );
    expect(cards.map(({ animeSn, title, coverUrl }) => ({ animeSn, title, coverUrl }))).toEqual([
      { animeSn: '81000001', title: '藥師少女的獨語', coverUrl: undefined },
      { animeSn: '81000002', title: '排行榜作品', coverUrl: undefined },
    ]);
  });
});

describe('網址', () => {
  it('播放頁', () => {
    expect(watchVideoId('https://www.netflix.com/watch/81000101?trackId=1')).toBe('81000101');
    expect(watchVideoId('https://www.netflix.com/browse')).toBeUndefined();
  });
});

describe('觀影動態', () => {
  const rows = parseViewingActivity(
    doc(`<ul>
      <li class="retableRow" data-uia="activity-row"><div class="col date nowrap">26/10/24</div><div class="col title"><a href="/title/81000102">藥師少女的獨語：第 2 季：第 2 集</a></div></li>
      <li class="retableRow" data-uia="activity-row"><div class="col date nowrap">26/10/23</div><div class="col title"><a href="/title/81000101">藥師少女的獨語：第 2 季：第 1 集</a></div></li>
      <li class="retableRow" data-uia="activity-row"><div class="col date nowrap">26/9/1</div><div class="col title"><a href="/title/80000001">某部電影</a></div></li>
    </ul>`),
  );

  it('每列取影片 ID、名稱與日期', () => {
    expect(rows[0]).toEqual({ videoId: '81000102', title: '藥師少女的獨語：第 2 季：第 2 集', date: '26/10/24' });
    expect(rows).toHaveLength(3);
  });

  it('依作品名稱分組', () => {
    expect([...groupRows(rows).entries()].map(([k, v]) => [k, v.length])).toEqual([
      ['藥師少女的獨語', 2],
      ['某部電影', 1],
    ]);
  });
});

describe('parseMetadata', () => {
  const seen = Date.parse('2026-10-24T12:24:00.000Z');
  const show: MetadataResponse = {
    video: {
      id: 81000001,
      type: 'show',
      title: '藥師少女的獨語',
      boxart: [
        { w: 166, h: 233, url: 'https://occ-0-1.1.nflxso.net/small.jpg' },
        { w: 426, h: 607, url: 'https://occ-0-1.1.nflxso.net/large.jpg' },
      ],
      seasons: [
        { id: 1, seq: 1, episodes: [{ id: 81000011, seq: 1, runtime: 1440, bookmark: { offset: 0, watchedDate: 0 } }] },
        {
          id: 2,
          seq: 2,
          episodes: [
            { id: 81000101, seq: 25, runtime: 1440, creditsOffset: 1350, bookmark: { offset: 1400, watchedDate: seen } },
            { id: 81000102, seq: 26, runtime: 1440, creditsOffset: 1350, bookmark: { offset: 600, watchedDate: seen } },
          ],
        },
      ],
    },
  };

  it('影集：每季每集都建檔，多季時集數名稱帶季數', () => {
    const t = parseMetadata(show)!;
    expect(t.anime).toMatchObject({ animeSn: '81000001', title: '藥師少女的獨語', coverUrl: 'https://occ-0-1.1.nflxso.net/large.jpg' });
    expect(t.anime.episodes).toEqual([
      { videoSn: '81000011', label: '第 1 季第 1 集', sortOrder: 1001 },
      { videoSn: '81000101', label: '第 2 季第 25 集', sortOrder: 2025 },
      { videoSn: '81000102', label: '第 2 季第 26 集', sortOrder: 2026 },
    ]);
    expect(t.labels.get('81000102')).toBe('第 2 季第 26 集');
  });

  it('只有 bookmark 有時間的集數算看過；開始時間以最後觀看時間減播放位置推算', () => {
    const t = parseMetadata(show)!;
    expect(t.watches.map((w) => w.videoSn)).toEqual(['81000101', '81000102']);
    expect(t.watches[1]).toMatchObject({
      watchedAt: new Date(seen - 600_000).toISOString(),
      lastSeenAt: '2026-10-24T12:24:00.000Z',
      progressSec: 600,
      durationSec: 1440,
      completed: false,
    });
    // 播到片尾字幕就算看完
    expect(t.watches[0]!.completed).toBe(true);
  });

  it('單季影集的集數名稱只有數字', () => {
    const one = parseMetadata({ video: { ...show.video!, seasons: [show.video!.seasons![1]!] } })!;
    expect(one.anime.episodes!.map((e) => e.label)).toEqual(['25', '26']);
  });

  it('電影只有一集', () => {
    const t = parseMetadata({
      video: { id: 80000001, type: 'movie', title: '某部電影', runtime: 7200, bookmark: { offset: 7000, watchedDate: seen } },
    })!;
    expect(t.anime.episodes).toEqual([{ videoSn: '80000001', label: MOVIE_LABEL, sortOrder: 0 }]);
    expect(t.watches).toMatchObject([{ videoSn: '80000001', completed: true, progressSec: 7000 }]);
  });

  it('沒有作品資料時回傳 undefined', () => {
    expect(parseMetadata({})).toBeUndefined();
  });
});
