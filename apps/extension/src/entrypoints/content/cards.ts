import type { CardStatus, SnMap, Source } from '@agm/shared';
import type { CardInfo } from '../../bahamut/parse.ts';
import { mutate, query, send } from '../../lib/messages.ts';
import { hiddenItems, hideModeItem, showHiddenItem, type HideMode } from '../../lib/storage.ts';
import { MOVIE_LABEL } from '../../netflix/parse.ts';

interface Card extends CardInfo {
  animeSn: string;
  controls: HTMLElement;
  badge?: HTMLElement;
  placeholder?: HTMLElement;
}

const SCAN_DEBOUNCE_MS = 200;

export function episodeText(label: string) {
  if (label === MOVIE_LABEL) return '看過';
  return /^\d+(\.\d+)?$/.test(label) ? `看到第 ${label} 集` : `看到${label}`;
}

/**
 * 在所有作品卡片上加上隱藏按鈕與觀看狀態。
 * 只有單集 ID、沒有作品 ID 的卡片（動畫瘋週期表）會再透過背景查詢。
 */
export async function startCards(signal: AbortSignal, source: Source, findCards: (root: ParentNode) => CardInfo[]) {
  const hiddenItem = hiddenItems[source];
  const cards = new Map<HTMLElement, Card>();
  const statuses = new Map<string, CardStatus | null>();
  const pageSnMap: SnMap = {};
  let hidden = new Set(await hiddenItem.getValue());
  let mode: HideMode = await hideModeItem.getValue();
  let showHidden = await showHiddenItem.getValue();

  function setHidden(card: Card, value: boolean) {
    const next = new Set(hidden);
    if (value) next.add(card.animeSn);
    else next.delete(card.animeSn);
    // 先更新本機清單讓畫面立即反應；server 端由佇列處理
    void hiddenItem.setValue([...next]);
    void mutate(
      'POST',
      `/${source}/hide`,
      { animeSn: card.animeSn, hidden: value, title: card.title || undefined, coverUrl: card.coverUrl, at: new Date().toISOString() },
      `hide:${source}:${card.animeSn}`,
    );
  }

  function render(card: Card) {
    const isHidden = hidden.has(card.animeSn);
    const collapse = isHidden && !showHidden;
    card.el.classList.toggle('agm-hidden', collapse);
    card.el.classList.toggle('agm-dim', isHidden && showHidden);

    const btn = card.controls.querySelector('button')!;
    btn.textContent = isHidden ? '還原' : '隱藏';
    btn.title = isHidden ? '取消隱藏這部作品' : '隱藏這部作品';

    const wantPlaceholder = collapse && mode === 'collapse';
    if (wantPlaceholder && !card.placeholder) {
      const ph = document.createElement('div');
      ph.className = 'agm-placeholder';
      const text = document.createElement('span');
      text.textContent = `已隱藏：${card.title || card.animeSn}`;
      const undo = document.createElement('button');
      undo.textContent = '還原';
      undo.addEventListener('click', () => setHidden(card, false));
      ph.append(text, undo);
      card.el.before(ph);
      card.placeholder = ph;
    } else if (!wantPlaceholder && card.placeholder) {
      card.placeholder.remove();
      card.placeholder = undefined;
    }

    const status = statuses.get(card.animeSn);
    const label = status?.completed ? '✓ 看完' : status?.lastEpisodeLabel ? episodeText(status.lastEpisodeLabel) : null;
    if (label && !card.badge) {
      card.badge = document.createElement('span');
      card.badge.className = 'agm-badge';
      card.el.append(card.badge);
    }
    if (card.badge) {
      card.badge.hidden = !label;
      card.badge.textContent = label ?? '';
      card.badge.classList.toggle('agm-done', !!status?.completed);
    }
  }

  function decorate(info: CardInfo & { animeSn: string }) {
    info.el.dataset.agm = info.animeSn;
    info.el.classList.add('agm-card');
    const controls = document.createElement('span');
    controls.className = 'agm-controls';
    const btn = document.createElement('button');
    btn.className = 'agm-btn';
    btn.type = 'button';
    controls.append(btn);
    // 卡片本身是連結，按鈕不可觸發換頁
    for (const type of ['click', 'mousedown', 'mouseup'] as const) {
      btn.addEventListener(type, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (type === 'click') setHidden(card, !hidden.has(card.animeSn));
      });
    }
    info.el.prepend(controls);
    const card: Card = { ...info, controls };
    cards.set(info.el, card);
    render(card);
  }

  async function loadStatuses(sns: string[]) {
    const unknown = [...new Set(sns)].filter((s) => !statuses.has(s));
    if (!unknown.length) return;
    for (const s of unknown) statuses.set(s, null);
    const res = await query<Record<string, CardStatus>>('POST', `/${source}/status`, { animeSns: unknown });
    if (!res.ok) {
      for (const s of unknown) statuses.delete(s);
      return;
    }
    for (const [sn, st] of Object.entries(res.data)) statuses.set(sn, st);
    for (const card of cards.values()) if (unknown.includes(card.animeSn)) render(card);
  }

  async function scan() {
    const found = findCards(document).filter((c) => !c.el.dataset.agm);
    const unresolved: CardInfo[] = [];
    const newSns: string[] = [];
    for (const c of found) {
      if (c.animeSn && c.videoSn) pageSnMap[c.videoSn] = c.animeSn;
      const animeSn = c.animeSn ?? (c.videoSn ? pageSnMap[c.videoSn] : undefined);
      if (animeSn) {
        decorate({ ...c, animeSn });
        newSns.push(animeSn);
      } else if (c.videoSn) {
        c.el.dataset.agm = 'pending';
        unresolved.push(c);
      }
    }
    void loadStatuses(newSns);
    if (!unresolved.length) return;

    const map = await send({ type: 'resolveSn', videoSns: unresolved.map((c) => c.videoSn!) });
    const resolvedSns: string[] = [];
    for (const c of unresolved) {
      const animeSn = map[c.videoSn!];
      if (animeSn && c.el.isConnected) {
        decorate({ ...c, animeSn });
        resolvedSns.push(animeSn);
      }
    }
    void loadStatuses(resolvedSns);
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => void scan(), SCAN_DEBOUNCE_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  const rerender = () => cards.forEach(render);
  const unwatch = [
    hiddenItem.watch((v) => {
      hidden = new Set(v);
      rerender();
    }),
    hideModeItem.watch((v) => {
      mode = v;
      rerender();
    }),
    showHiddenItem.watch((v) => {
      showHidden = v;
      rerender();
    }),
  ];
  signal.addEventListener('abort', () => {
    observer.disconnect();
    clearTimeout(timer);
    unwatch.forEach((u) => u());
  });

  await scan();
}
