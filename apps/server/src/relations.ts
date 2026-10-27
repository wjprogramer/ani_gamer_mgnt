import { BAHAMUT, type RelatedAnimeInput } from '@agm/shared';
import type { Store } from './store.ts';

/** 每部之間的間隔，避免對動畫瘋發出大量請求 */
const FETCH_INTERVAL_MS = 1500;
/** 定期檢查有沒有新建檔、還沒讀過相關動畫的作品 */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, '&')
    .trim();

/**
 * 從動畫瘋播放頁的 HTML 取出「相關動畫」（#relanime 裡的 a.theme-list-main 卡片）。
 * 結構見 docs/bahamut-dom.html；extension 在頁面上以 DOM 解析同一個區塊。
 */
export function parseRelatedHtml(html: string): RelatedAnimeInput[] {
  const start = html.search(/id=["']relanime["']/);
  if (start < 0) return [];
  const end = html.indexOf('</section>', start);
  const block = html.slice(start, end < 0 ? undefined : end);
  const related: RelatedAnimeInput[] = [];
  for (const card of block.split(/<a\s/).slice(1)) {
    const animeSn = card.match(/href=["'][^"']*animeRef\.php\?(?:[^"'#]*&(?:amp;)?)?sn=(\d+)/)?.[1];
    const title = decode(card.match(/class=["']theme-name["'][^>]*>([^<]*)</)?.[1] ?? '');
    const cover = card.match(/data-src=["'](https?:\/\/[^"']+)["']/)?.[1];
    if (animeSn && title) related.push({ animeSn, title, ...(cover ? { coverUrl: decode(cover) } : {}) });
  }
  return related;
}

/** 讀取動畫瘋作品頁（會轉到第一集的播放頁）並解析相關動畫；讀取失敗時回傳 undefined */
export async function fetchRelated(animeSn: string, fetchImpl: typeof fetch = fetch): Promise<RelatedAnimeInput[] | undefined> {
  const res = await fetchImpl(`https://ani.gamer.com.tw/animeRef.php?sn=${animeSn}`, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) return undefined;
  return parseRelatedHtml(await res.text());
}

/**
 * 背景補抓已建檔的動畫瘋作品的相關動畫。之後打開播放頁時 extension 也會更新，這裡只補還沒讀過的。
 * 讀取失敗的下一輪再試。
 */
export function startRelationBackfill(
  store: Store,
  { fetchImpl = fetch, intervalMs = FETCH_INTERVAL_MS }: { fetchImpl?: typeof fetch; intervalMs?: number } = {},
) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      const pending = store.pendingRelationFetch(BAHAMUT);
      if (pending.length) console.log(`[relations] 補抓 ${pending.length} 部作品的相關動畫`);
      for (const sn of pending) {
        const related = await fetchRelated(sn, fetchImpl).catch((e: unknown) => {
          console.warn(`[relations] 讀取失敗 ${sn}:`, e);
          return undefined;
        });
        if (related) store.setSiteRelations(BAHAMUT, sn, related);
        await new Promise((r) => setTimeout(r, intervalMs));
      }
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), CHECK_INTERVAL_MS);
  timer.unref();
  return run;
}
