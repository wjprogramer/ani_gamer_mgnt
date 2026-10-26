import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { AnimeSummary, MergeCandidate } from '@agm/shared';
import { api, formatTime, progressText, siteLabel } from '../api.ts';

function Side({ anime }: { anime: AnimeSummary }) {
  return (
    <Link to={`/anime/${anime.id}`} className="merge-side">
      {anime.coverUrl ? <img src={anime.coverUrl} alt="" loading="lazy" /> : <span className="thumb" />}
      <div>
        <div className="card-title">{anime.title}</div>
        <div className="muted small">{anime.sites.map(siteLabel).join('・')}</div>
        <div className="muted small">
          {anime.lastWatchedAt ? `${progressText(anime)}・${formatTime(anime.lastWatchedAt)}` : '尚未觀看'}
        </div>
      </div>
    </Link>
  );
}

/** 列出疑似同一部的作品，讓使用者選擇合併或標記為不同 */
export function MergePage() {
  const [items, setItems] = useState<MergeCandidate[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => api.mergeCandidates().then(setItems, (e: Error) => setError(e.message));
  useEffect(() => void load(), []);

  async function act(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <h1>合併</h1>
      <p className="muted small">
        列出名稱相似、但來自不同網站的作品。合併後觀看紀錄與評論都會集中到保留的那一部；按「不是同一部」之後就不會再列出。
        要合併沒列出的作品，請到作品頁面使用「合併其他作品」。
      </p>
      {error && <p className="error">{error}</p>}
      {items?.length === 0 && <p className="muted">目前沒有疑似重複的作品。</p>}
      <ul className="merge-list">
        {items?.map((c) => {
          const key = `${c.a.id}|${c.b.id}`;
          return (
            <li key={key}>
              <Side anime={c.a} />
              <Side anime={c.b} />
              <div className="merge-actions">
                <span className="muted small">相似度 {Math.round(c.score * 100)}%</span>
                <button disabled={!!busy} onClick={() => void act(key, () => api.merge(c.a.id, c.b.id))}>
                  合併，保留左邊的名稱
                </button>
                <button disabled={!!busy} onClick={() => void act(key, () => api.merge(c.b.id, c.a.id))}>
                  合併，保留右邊的名稱
                </button>
                <button className="danger" disabled={!!busy} onClick={() => void act(key, () => api.dismissMerge(c.a.id, c.b.id))}>
                  不是同一部
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
