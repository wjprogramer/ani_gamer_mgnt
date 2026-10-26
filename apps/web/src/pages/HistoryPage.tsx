import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { WatchHistoryItem } from '@agm/shared';
import { api, episodeText, formatDuration, siteLabel } from '../api.ts';

function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString('zh-TW', { year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' });
}

export function HistoryPage() {
  const [items, setItems] = useState<WatchHistoryItem[]>([]);
  const [more, setMore] = useState(true);
  const [error, setError] = useState('');

  function load(before?: string) {
    api.watchHistory(before).then(
      (page) => {
        setItems((prev) => (before ? [...prev, ...page] : page));
        setMore(page.length === 50);
      },
      (e: Error) => setError(e.message),
    );
  }

  useEffect(() => load(), []);

  async function remove(w: WatchHistoryItem) {
    if (w.kind === 'mark') {
      if (!window.confirm('取消「手動標記看完」？之後改回自動判斷。')) return;
      await api.patchAnime(w.animeId, { manualCompleted: null });
    } else {
      if (!window.confirm('確定刪除這筆觀看紀錄？')) return;
      await api.deleteWatch(w.id);
    }
    setItems((prev) => prev.filter((x) => x.id !== w.id));
  }

  const groups = new Map<string, WatchHistoryItem[]>();
  for (const w of items) {
    const k = dayKey(w.startedAt);
    groups.set(k, [...(groups.get(k) ?? []), w]);
  }

  return (
    <>
      <h1>觀看紀錄</h1>
      {error && <p className="error">讀取失敗：{error}</p>}
      {!error && items.length === 0 && <p className="muted">還沒有觀看紀錄。</p>}
      {[...groups].map(([day, list]) => (
        <section key={day}>
          <h2 className="day">{day}</h2>
          <ul className="history">
            {list.map((w) => (
              <li key={w.id}>
                <time>{new Date(w.startedAt).toLocaleTimeString('zh-TW', { hour12: false, hour: '2-digit', minute: '2-digit' })}</time>
                {w.coverUrl ? <img src={w.coverUrl} alt="" loading="lazy" /> : <span className="thumb" />}
                <div className="grow">
                  <Link to={`/anime/${w.animeId}`}>{w.animeTitle}</Link>
                  <div className="muted small">
                    {w.kind === 'mark' ? (
                      '✓ 手動標記看完'
                    ) : (
                      <>
                        {siteLabel(w.site)}・{episodeText(w.episodeLabel)}・{formatDuration(w.progressSec)}
                        {w.durationSec > 0 && ` / ${formatDuration(w.durationSec)}`}
                        {w.completed && '・✓ 看完'}
                      </>
                    )}
                  </div>
                </div>
                <button className="link danger" onClick={() => void remove(w)}>
                  {w.kind === 'mark' ? '取消標記' : '刪除'}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {more && items.length > 0 && (
        <button onClick={() => load(items[items.length - 1]!.startedAt)}>載入更多</button>
      )}
    </>
  );
}
