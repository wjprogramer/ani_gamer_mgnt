// 動畫瘋觀看紀錄頁 viewList.php 的解析。結構見 docs/bahamut-dom.html 第 4 節。
import type { BahamutImportItem } from '@agm/shared';

export interface HistoryPageResult {
  items: BahamutImportItem[];
  animeCount: number;
  /** 有卡片但找不到各集紀錄的動畫數 */
  missingDetail: number;
}

export function isHistoryPage(url: string): boolean {
  return /^https:\/\/ani\.gamer\.com\.tw\/viewList\.php/.test(url);
}

/** 將頁面上的時間（「3 分內」「昨天 22:13」「2026.06.21 20:35」）轉成 ISO 時間；以瀏覽器時區解讀 */
export function parseHistoryDate(text: string, now: Date): string | undefined {
  const t = text.trim();
  let m = t.match(/^(\d+)\s*分(?:鐘)?(?:內|前)$/);
  if (m) return new Date(now.getTime() - Number(m[1]) * 60_000).toISOString();
  m = t.match(/^(\d+)\s*小時(?:內|前)$/);
  if (m) return new Date(now.getTime() - Number(m[1]) * 3_600_000).toISOString();
  m = t.match(/^(今天|昨天|前天)\s*(\d{1,2}):(\d{2})$/);
  if (m) {
    const d = new Date(now);
    d.setDate(d.getDate() - { 今天: 0, 昨天: 1, 前天: 2 }[m[1] as '今天' | '昨天' | '前天']);
    d.setHours(Number(m[2]), Number(m[3]), 0, 0);
    return d.toISOString();
  }
  m = t.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  if (m) return new Date(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!).toISOString();
  return undefined;
}

function videoSnOf(href: string | null | undefined) {
  return href?.match(/animeVideo\.php\?(?:[^#]*&)?sn=(\d+)/)?.[1];
}

/** 卡片上「最後一集」的進度：「觀看至 17 分 58 秒」或「觀看結束」，以及進度條比例 */
function parseProgress(card: Element) {
  const lines = [...card.querySelectorAll('.history-lastwatch')].map((p) => p.textContent?.trim() ?? '');
  const ratio = Number(card.querySelector<HTMLElement>('.progress')?.style.width.replace('%', '')) / 100 || 0;
  if (lines.some((l) => l === '觀看結束')) return { completed: true };
  const m = lines.map((l) => l.match(/觀看至\s*(?:(\d+)\s*時\s*)?(\d+)\s*分\s*(\d+)\s*秒/)).find(Boolean);
  if (!m) return {};
  const progressSec = Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  return { progressSec, durationSec: ratio > 0 ? Math.round(progressSec / ratio) : undefined };
}

export function parseHistoryPage(doc: Document, now = new Date()): HistoryPageResult {
  const items: BahamutImportItem[] = [];
  const cards = [...doc.querySelectorAll('.user-watch-list .anime-card')];
  let missingDetail = 0;

  for (const card of cards) {
    const animeSn = card.querySelector('[data-anime-sn]')?.getAttribute('data-anime-sn');
    if (!animeSn) continue;
    const img = card.querySelector('img.theme-img');
    const cover = img?.getAttribute('data-src') || img?.getAttribute('src');
    const title = card.querySelector('.history-anime-title')?.textContent?.trim() ?? '';
    const latestVideoSn = videoSnOf(card.querySelector('a.click-area')?.getAttribute('href'));
    const progress = parseProgress(card);

    const rows = doc.querySelectorAll(`.user-watchTime-list[data-anime-sn="${animeSn}"] li a`);
    if (!rows.length) missingDetail++;
    let latestUsed = false;
    for (const a of rows) {
      const videoSn = videoSnOf(a.getAttribute('href'));
      const watchedAt = parseHistoryDate(a.querySelector('.date')?.textContent ?? '', now);
      if (!videoSn || !watchedAt) continue;
      const rowTitle = a.querySelector('.history-list-anime-title')?.textContent?.trim() ?? '';
      const item: BahamutImportItem = {
        animeSn,
        title: title || rowTitle.replace(/\s*\[[^\]]*\]$/, ''),
        coverUrl: cover && !cover.startsWith('data:') ? cover : undefined,
        videoSn,
        episodeLabel: rowTitle.match(/\[([^\]]+)\]$/)?.[1],
        watchedAt,
      };
      // 進度只屬於最近一次觀看的那一集
      if (videoSn === latestVideoSn && !latestUsed) {
        Object.assign(item, progress);
        latestUsed = true;
      }
      items.push(item);
    }
  }
  return { items, animeCount: cards.length, missingDetail };
}
