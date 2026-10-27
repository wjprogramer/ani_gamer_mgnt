// 動畫瘋頁面解析。選擇器的調查結果見 docs/bahamut-dom.html，網站改版時優先檢查這個檔案。

export interface VideoPageInfo {
  videoSn: string;
  animeSn: string;
  acgSn?: string;
  title: string;
  coverUrl?: string;
  tags: string[];
  episodes: { videoSn: string; label: string; sortOrder: number }[];
  episodeLabel?: string;
  /** 「相關動畫」區塊列出的作品 */
  related: { animeSn: string; title: string; coverUrl?: string }[];
}

export interface CardInfo {
  el: HTMLElement;
  animeSn?: string;
  videoSn?: string;
  title: string;
  coverUrl?: string;
}

interface CardRule {
  selector: string;
  title: string;
}

const THEME_CARD: CardRule = { selector: 'a.theme-list-main', title: '.theme-name' };

/** 各頁面的動畫卡片 */
export const CARD_RULES: CardRule[] = [
  // 首頁「本季新番」
  { selector: 'a.anime-card-block', title: '.anime-name' },
  // 首頁「週期表」純文字列表
  { selector: 'a.text-anime-info', title: '.text-anime-name' },
  // 首頁熱播／主題推薦、所有動畫
  THEME_CARD,
];

const TOGGLE_GATHER = /toggleGather\(\s*(\d+)\s*,\s*(\d+)/;

export function parseToggleGather(text: string | null | undefined): { acgSn: string; animeSn: string } | undefined {
  const m = text?.match(TOGGLE_GATHER);
  return m ? { acgSn: m[1]!, animeSn: m[2]! } : undefined;
}

function snFromHref(href: string | null, page: 'animeRef' | 'animeVideo'): string | undefined {
  if (!href) return undefined;
  const m = href.match(new RegExp(`${page}\\.php\\?(?:[^#]*&)?sn=(\\d+)`));
  return m?.[1];
}

function imgSrc(img: Element | null): string | undefined {
  const src = img?.getAttribute('data-src') || img?.getAttribute('src');
  if (!src || src.startsWith('data:')) return undefined;
  return new URL(src, 'https://ani.gamer.com.tw/').href;
}

export function parseCard(el: HTMLElement, rule: CardRule): CardInfo {
  const href = el.getAttribute('href');
  const animeSn =
    snFromHref(href, 'animeRef') ??
    el.closest('[data-animesn]')?.getAttribute('data-animesn') ??
    parseToggleGather(el.querySelector('[onclick*="toggleGather"]')?.getAttribute('onclick'))?.animeSn;
  return {
    el,
    animeSn: animeSn || undefined,
    videoSn: snFromHref(href, 'animeVideo'),
    title: el.querySelector(rule.title)?.textContent?.trim() || el.querySelector('img[alt]')?.getAttribute('alt') || '',
    coverUrl: imgSrc(el.querySelector('img[data-src], img.theme-img')),
  };
}

export function findCards(root: ParentNode): CardInfo[] {
  const cards: CardInfo[] = [];
  for (const rule of CARD_RULES) {
    for (const el of root.querySelectorAll<HTMLElement>(rule.selector)) cards.push(parseCard(el, rule));
  }
  return cards;
}

export function isVideoPage(url: string): boolean {
  return /^https:\/\/ani\.gamer\.com\.tw\/animeVideo\.php/.test(url);
}

export function parseVideoPage(doc: Document, url: string): VideoPageInfo | undefined {
  const videoSn = new URL(url).searchParams.get('sn');
  const gather = parseToggleGather(doc.querySelector('.anime_name [onclick*="toggleGather"]')?.getAttribute('onclick'));
  if (!videoSn || !gather) return undefined;

  const dataImg = doc.querySelector('.data-file img.data-img');
  // h1 會帶「[16]」之類的集數，只在找不到資料區塊時使用
  const title =
    dataImg?.getAttribute('alt')?.trim() ||
    doc.querySelector('.anime_name h1')?.textContent?.replace(/\s*\[[^\]]*\]\s*$/, '').trim() ||
    '';
  const links = [...doc.querySelectorAll<HTMLAnchorElement>('section.season a[data-ani-video-sn]')];
  const episodes = links.map((a, i) => ({
    videoSn: a.getAttribute('data-ani-video-sn')!,
    label: a.textContent?.trim() ?? '',
    sortOrder: i,
  }));
  const current = episodes.find((e) => e.videoSn === videoSn);
  const h1Label = doc.querySelector('.anime_name h1')?.textContent?.match(/\[([^\]]+)\]\s*$/)?.[1];

  return {
    videoSn,
    animeSn: gather.animeSn,
    acgSn: gather.acgSn,
    title,
    coverUrl: imgSrc(dataImg),
    tags: [...doc.querySelectorAll('.data-file .tag-list .tag')].map((t) => t.textContent?.trim() ?? '').filter(Boolean),
    episodes,
    episodeLabel: current?.label ?? h1Label,
    // server 補抓時以 HTML 解析同一個區塊（apps/server/src/relations.ts）
    related: [...doc.querySelectorAll<HTMLElement>(`#relanime ${THEME_CARD.selector}`)].flatMap((el) => {
      const c = parseCard(el, THEME_CARD);
      return c.animeSn && c.title && c.animeSn !== gather.animeSn
        ? [{ animeSn: c.animeSn, title: c.title, ...(c.coverUrl ? { coverUrl: c.coverUrl } : {}) }]
        : [];
    }),
  };
}

/** 從播放頁原始 HTML 取出 animeSn，給背景解析未知集數用 */
export function animeSnFromVideoHtml(html: string): string | undefined {
  const i = html.indexOf('class="anime_name"');
  return parseToggleGather(i >= 0 ? html.slice(i, i + 2000) : html)?.animeSn;
}
