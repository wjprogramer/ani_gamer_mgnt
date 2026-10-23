import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHistoryDate, parseHistoryPage } from '../src/bahamut/history.ts';

// 觀看紀錄頁的結構片段（兩部動畫各 3 集；帳號已移除，觀看時間為虛構值）
const html = fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'history-page.html'), 'utf8');
const now = new Date(2026, 9, 23, 22, 30);

describe('parseHistoryDate', () => {
  it.each([
    ['1 分內', new Date(2026, 9, 23, 22, 29)],
    ['5 分鐘前', new Date(2026, 9, 23, 22, 25)],
    ['2 小時前', new Date(2026, 9, 23, 20, 30)],
    ['昨天 22:13', new Date(2026, 9, 22, 22, 13)],
    ['前天 09:05', new Date(2026, 9, 21, 9, 5)],
    ['2026.06.21 20:35', new Date(2026, 5, 21, 20, 35)],
  ])('%s', (text, expected) => {
    expect(parseHistoryDate(text, now)).toBe(expected.toISOString());
  });

  it('無法辨識時回傳 undefined', () => {
    expect(parseHistoryDate('很久以前', now)).toBeUndefined();
  });
});

describe('parseHistoryPage', () => {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
  const result = parseHistoryPage(doc, now);

  it('解析所有動畫與各集紀錄', () => {
    expect(result.animeCount).toBe(2);
    expect(result.missingDetail).toBe(0);
    expect(result.items).toHaveLength(3 + 3);
  });

  it('最新一集帶有進度', () => {
    expect(result.items[0]).toEqual({
      animeSn: '113281',
      title: '咒術迴戰 第二季',
      coverUrl: 'https://p2.bahamut.com.tw/B/ACG/c/78/0000122778.JPG',
      videoSn: '34716',
      episodeLabel: '31',
      watchedAt: new Date(2026, 9, 23, 22, 29).toISOString(),
      progressSec: 17 * 60 + 58,
      durationSec: Math.round((17 * 60 + 58) / 0.781159420289855),
    });
    expect(result.items[1]).not.toHaveProperty('progressSec');
  });

  it('「觀看結束」視為看完；lazyload 的封面取 data-src', () => {
    const last = result.items.find((i) => i.videoSn === '51351');
    expect(last).toMatchObject({
      animeSn: '114058',
      episodeLabel: '22',
      completed: true,
      coverUrl: 'https://p2.bahamut.com.tw/B/ACG/c/75/0000142675.JPG',
    });
  });
});
