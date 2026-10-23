import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { AnimeFilter, AnimeSummary } from '@agm/shared';
import { api, episodeText, formatTime } from '../api.ts';

const FILTERS: { value: AnimeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'watched', label: '看過' },
  { value: 'reviewed', label: '有評論' },
  { value: 'hidden', label: '已隱藏' },
];

export function AnimeListPage() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as AnimeFilter) || 'all';
  const q = params.get('q') ?? '';
  const [items, setItems] = useState<AnimeSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => {
      api.listAnime(filter, q).then(setItems, (e: Error) => setError(e.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [filter, q]);

  const update = (next: Record<string, string>) => setParams({ filter, q, ...next }, { replace: true });

  return (
    <>
      <div className="toolbar">
        <div className="tabs" role="tablist">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              role="tab"
              aria-selected={f.value === filter}
              className={f.value === filter ? 'active' : ''}
              onClick={() => update({ filter: f.value })}
            >
              {f.label}
            </button>
          ))}
        </div>
        <input type="search" placeholder="搜尋動畫名稱" value={q} onChange={(e) => update({ q: e.target.value })} />
      </div>

      {error && <p className="error">讀取失敗：{error}</p>}
      {items?.length === 0 && <p className="muted">沒有資料。在動畫瘋上瀏覽或觀看動畫後，這裡就會出現紀錄。</p>}

      <ul className="grid">
        {items?.map((a) => (
          <li key={a.id} className={a.hidden ? 'card hidden' : 'card'}>
            <Link to={`/anime/${a.id}`}>
              <div className="cover">
                {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : <div className="no-cover">無封面</div>}
                {a.completed ? (
                  <span className="badge done">✓ 看完</span>
                ) : (
                  a.lastEpisodeLabel && <span className="badge">看到{episodeText(a.lastEpisodeLabel)}</span>
                )}
                {a.hidden && <span className="badge hidden-badge">已隱藏</span>}
              </div>
              <div className="card-body">
                <div className="card-title">{a.title}</div>
                <div className="muted small">
                  {a.lastWatchedAt ? `最後觀看 ${formatTime(a.lastWatchedAt)}` : '尚未觀看'}
                  {a.reviewCount > 0 && `・${a.reviewCount} 則評論`}
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
