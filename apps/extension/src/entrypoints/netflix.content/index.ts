import { defineContentScript } from '#imports';
import { mutate, query } from '../../lib/messages.ts';
import {
  fetchMetadata,
  findNetflixCards,
  isViewingActivityPage,
  parseViewingActivity,
  watchVideoId,
} from '../../netflix/parse.ts';
import { syncViewingActivity } from '../../netflix/sync.ts';
import { startCards } from '../content/cards.ts';
import { warnIfOffline } from '../content/notice.ts';
import { injectPageStyle } from '../content/page-style.ts';
import { trackWatch } from '../content/watch.ts';

const URL_POLL_MS = 1000;
/** 觀影動態的列表是頁面 JS 產生的，最多等這麼久 */
const ROWS_WAIT_MS = 10_000;

export default defineContentScript({
  matches: ['https://www.netflix.com/*'],
  runAt: 'document_idle',
  main(ctx) {
    injectPageStyle();
    void warnIfOffline();

    const cards = new AbortController();
    ctx.onInvalidated(() => cards.abort());
    void startCards(cards.signal, 'netflix', findNetflixCards);

    // Netflix 是單頁應用，換頁與自動播下一集都不會重新載入，以網址變化為準
    let page: AbortController | undefined;
    let lastUrl = '';
    const check = () => {
      if (location.href === lastUrl) return;
      const prevVideo = watchVideoId(lastUrl);
      lastUrl = location.href;
      const videoId = watchVideoId(location.href);
      // 同一集的網址參數變化不算換頁
      if (videoId && videoId === prevVideo) return;
      page?.abort();
      page = new AbortController();
      if (videoId) void initWatchPage(videoId, page.signal);
      else if (isViewingActivityPage(location.href)) void initViewingActivity(page.signal);
    };
    check();
    ctx.setInterval(check, URL_POLL_MS);
    ctx.onInvalidated(() => page?.abort());
  },
});

async function initWatchPage(videoId: string, signal: AbortSignal) {
  const title = await fetchMetadata(fetch, videoId).catch(() => undefined);
  if (signal.aborted) return;
  if (!title) {
    console.warn('[動畫瘋管理工具] 無法取得 Netflix 作品資料，可能是網站改版，請檢查 src/netflix/parse.ts');
    return;
  }
  await mutate('POST', '/netflix/anime', title.anime, `anime:netflix:${title.anime.animeSn}`);
  trackWatch(
    'netflix',
    { animeSn: title.anime.animeSn, title: title.anime.title, videoSn: videoId, episodeLabel: title.labels.get(videoId) },
    signal,
    // 自動播下一集時網址會先換，換了之後這一集的紀錄就不再更新
    () => watchVideoId(location.href) === videoId,
  );
}

async function initViewingActivity(signal: AbortSignal) {
  const started = Date.now();
  while (!document.querySelector('li.retableRow') && Date.now() - started < ROWS_WAIT_MS) {
    await new Promise((r) => setTimeout(r, 300));
    if (signal.aborted) return;
  }
  const list = document.querySelector('li.retableRow')?.parentElement;
  if (!list) return;

  const bar = document.createElement('div');
  bar.className = 'agm-import';
  const text = document.createElement('span');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = '再次同步';
  btn.title = '包含按「顯示更多」後載入的紀錄';
  bar.append(text, btn);
  list.before(bar);
  signal.addEventListener('abort', () => bar.remove());

  const run = async () => {
    btn.disabled = true;
    const state = await syncViewingActivity(
      { fetch: (input, init) => fetch(input, init), query, onProgress: (t) => (text.textContent = t) },
      parseViewingActivity(document),
    );
    if (signal.aborted) return;
    text.textContent = `${state.ok ? '已同步到本機' : '同步失敗'}：${state.message ?? ''}`;
    btn.disabled = false;
  };
  btn.addEventListener('click', () => void run());
  void run();
}
