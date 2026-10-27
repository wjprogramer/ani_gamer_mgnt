import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { animeSnFromVideoHtml, findCards, parseToggleGather, parseVideoPage } from '../src/bahamut/parse.ts';

// 從 2026-10-23 的實際頁面擷取的片段
const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8');

function doc(html: string) {
  return new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, 'text/html');
}

describe('parseToggleGather', () => {
  it('取出 acgSn 與 animeSn', () => {
    expect(parseToggleGather('animefun.toggleGather(142294, 113845, $(this), "x")')).toEqual({
      acgSn: '142294',
      animeSn: '113845',
    });
    expect(parseToggleGather(null)).toBeUndefined();
  });
});

describe('findCards', () => {
  it('解析首頁三種卡片', () => {
    const cards = findCards(doc(fixture('home-cards.html')));
    expect(cards.map(({ el: _, ...c }) => c)).toEqual([
      {
        animeSn: '114197',
        videoSn: '51983',
        title: '冰劍的魔術師將要統一世界 2',
        coverUrl: 'https://p2.bahamut.com.tw/B/2KU/48/48f4a95b25e20dedfbd502eafe20tpw5.JPG',
      },
      // 週期表沒有 animeSn，要靠同頁其他卡片或背景解析
      { animeSn: undefined, videoSn: '51805', title: '殺手旅店', coverUrl: undefined },
      {
        animeSn: '21072',
        videoSn: undefined,
        title: '頭文字 D 1st stage',
        coverUrl: 'https://p2.bahamut.com.tw/B/ACG/c/72/0000021072.JPG',
      },
    ]);
  });
});

describe('parseVideoPage', () => {
  it('解析播放頁', () => {
    const info = parseVideoPage(doc(fixture('video-page.html')), 'https://ani.gamer.com.tw/animeVideo.php?sn=51805');
    expect(info).toMatchObject({
      videoSn: '51805',
      animeSn: '113845',
      acgSn: '142294',
      title: '殺手旅店',
      coverUrl: 'https://p2.bahamut.com.tw/B/ACG/c/94/0000142294.JPG',
      tags: ['動作', '職場', '懸疑'],
      episodeLabel: '16',
    });
    expect(info!.episodes).toHaveLength(16);
    expect(info!.episodes[0]).toEqual({ videoSn: '44034', label: '1', sortOrder: 0 });
  });

  it('解析相關動畫，排除自己', () => {
    const info = parseVideoPage(doc(fixture('video-page.html')), 'https://ani.gamer.com.tw/animeVideo.php?sn=51805');
    expect(info!.related).toEqual([
      { animeSn: '113130', title: '轉生就是劍', coverUrl: 'https://p2.bahamut.com.tw/B/ACG/c/27/0000119827.JPG' },
      { animeSn: '114195', title: '轉生就是劍 第二季 & 特別篇' },
    ]);
  });

  it('不是播放頁時回傳 undefined', () => {
    expect(parseVideoPage(doc('<p>x</p>'), 'https://ani.gamer.com.tw/animeVideo.php?sn=1')).toBeUndefined();
  });
});

describe('animeSnFromVideoHtml', () => {
  it('從原始 HTML 取出 animeSn', () => {
    expect(animeSnFromVideoHtml(fixture('video-page.html'))).toBe('113845');
  });
});
