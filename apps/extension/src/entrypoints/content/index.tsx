import { createShadowRootUi, defineContentScript, type ContentScriptContext } from '#imports';
import { createRoot } from 'react-dom/client';
import { isVideoPage, parseVideoPage } from '../../bahamut/parse.ts';
import { mutate, send } from '../../lib/messages.ts';
import { startCards } from './cards.ts';
import { injectPageStyle } from './page-style.ts';
import { ReviewPanel } from './ReviewPanel.tsx';
import { trackWatch } from './watch.ts';
import './panel.css';

const URL_POLL_MS = 1000;

export default defineContentScript({
  matches: ['https://ani.gamer.com.tw/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    injectPageStyle();
    void warnIfOffline();

    const cards = new AbortController();
    ctx.onInvalidated(() => cards.abort());
    void startCards(cards.signal);

    // 播放頁換集時不一定會重新載入頁面，以網址變化為準
    let page: AbortController | undefined;
    let lastUrl = '';
    const check = () => {
      if (location.href === lastUrl) return;
      lastUrl = location.href;
      page?.abort();
      page = new AbortController();
      if (isVideoPage(location.href)) void initVideoPage(ctx, page.signal);
    };
    check();
    ctx.setInterval(check, URL_POLL_MS);
    ctx.onInvalidated(() => page?.abort());
  },
});

async function initVideoPage(ctx: ContentScriptContext, signal: AbortSignal) {
  const info = parseVideoPage(document, location.href);
  if (!info) {
    console.warn('[動畫瘋管理工具] 無法解析播放頁，可能是網站改版，請檢查 src/bahamut/parse.ts');
    return;
  }

  await mutate(
    'POST',
    '/bahamut/anime',
    {
      animeSn: info.animeSn,
      acgSn: info.acgSn,
      title: info.title,
      coverUrl: info.coverUrl,
      tags: info.tags,
      episodes: info.episodes,
    },
    `anime:${info.animeSn}`,
  );
  trackWatch(info, signal);

  const anchor = document.querySelector('.anime_name');
  if (!anchor) return;
  const ui = await createShadowRootUi(ctx, {
    name: 'agm-review-panel',
    position: 'inline',
    anchor,
    append: 'after',
    onMount(container) {
      const root = createRoot(container);
      root.render(<ReviewPanel key={info.videoSn} info={info} />);
      return root;
    },
    onRemove(root) {
      root?.unmount();
    },
  });
  if (signal.aborted) return;
  ui.mount();
  signal.addEventListener('abort', () => ui.remove());
}

async function warnIfOffline() {
  const { online } = await send({ type: 'health' });
  if (online || sessionStorage.getItem('agm-offline-warned')) return;
  sessionStorage.setItem('agm-offline-warned', '1');
  const toast = document.createElement('div');
  toast.className = 'agm-toast';
  toast.textContent = '動畫瘋管理工具：本機 server 未啟動，資料會先暫存，啟動後自動補送。（點擊關閉）';
  toast.addEventListener('click', () => toast.remove());
  document.body.append(toast);
  setTimeout(() => toast.remove(), 10_000);
}
