import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { SOURCES, type AnimeFilter, type AnimeGroup, type AnimeSort, type AnimeSummary, type Source } from '@agm/shared';
import { api, formatTime, progressText, siteLabel } from '../api.ts';
import { FavoriteButton, Stars } from '../components.tsx';

const FILTERS: { value: AnimeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'favorite', label: '收藏' },
  { value: 'watched', label: '看過' },
  { value: 'reviewed', label: '有評論' },
  { value: 'hidden', label: '已隱藏' },
];

const SORTS: { value: AnimeSort; label: string }[] = [
  { value: 'default', label: '最後觀看' },
  { value: 'title', label: '名稱' },
  { value: 'rating', label: '評分高到低' },
  { value: 'created', label: '最新建檔' },
];

const RATINGS = [
  { value: '', label: '所有評分' },
  ...[5, 4, 3, 2, 1].map((n) => ({ value: String(n), label: n === 5 ? '★★★★★' : `${'★'.repeat(n)} 以上` })),
  { value: 'unrated', label: '未評分' },
];

export function AnimeListPage() {
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as AnimeFilter) || 'all';
  const q = params.get('q') ?? '';
  const site = params.get('site') ?? '';
  const group = params.get('group') ?? '';
  const rating = params.get('rating') ?? '';
  const sort = (params.get('sort') as AnimeSort) || 'default';
  const [items, setItems] = useState<AnimeSummary[] | null>(null);
  const [groups, setGroups] = useState<AnimeGroup[]>([]);
  const [error, setError] = useState('');

  useEffect(() => void api.listGroups().then(setGroups), []);

  useEffect(() => {
    const timer = setTimeout(() => {
      api
        .listAnime({
          filter,
          q,
          sort,
          site: (site || undefined) as Source | undefined,
          groupId: group || undefined,
          rating: rating === 'unrated' ? 'unrated' : rating ? Number(rating) : undefined,
        })
        .then(setItems, (e: Error) => setError(e.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [filter, q, site, group, rating, sort]);

  const update = (next: Record<string, string>) => {
    const merged: Record<string, string> = { filter, q, site, group, rating, sort, ...next };
    // 預設值不放進網址
    if (merged.filter === 'all') delete merged.filter;
    if (merged.sort === 'default') delete merged.sort;
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)), { replace: true });
  };

  async function toggleFavorite(a: AnimeSummary) {
    const updated = await api.patchAnime(a.id, { favorite: !a.favorite });
    setItems((list) =>
      filter === 'favorite' && !updated.favorite
        ? (list ?? []).filter((x) => x.id !== a.id)
        : (list ?? []).map((x) => (x.id === a.id ? { ...x, favorite: updated.favorite } : x)),
    );
  }

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
        <input type="search" placeholder="搜尋作品名稱" value={q} onChange={(e) => update({ q: e.target.value })} />
      </div>
      <div className="toolbar">
        <select value={site} onChange={(e) => update({ site: e.target.value })} aria-label="來源">
          <option value="">所有來源</option>
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {siteLabel(s)}
            </option>
          ))}
        </select>
        <select value={group} onChange={(e) => update({ group: e.target.value })} aria-label="分群">
          <option value="">所有分群</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}（{g.count}）
            </option>
          ))}
        </select>
        <select value={rating} onChange={(e) => update({ rating: e.target.value })} aria-label="評分">
          {RATINGS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
        <label className="row small">
          排序
          <select value={sort} onChange={(e) => update({ sort: e.target.value })}>
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {items && <span className="muted small">{items.length} 部</span>}
      </div>

      {error && <p className="error">讀取失敗：{error}</p>}
      {items?.length === 0 && <p className="muted">沒有符合的作品。在動畫瘋或 Netflix 上瀏覽或觀看後，這裡就會出現紀錄。</p>}

      <ul className="grid">
        {items?.map((a) => (
          <li key={a.id} className={a.hidden ? 'card hidden' : 'card'}>
            <Link to={`/anime/${a.id}`}>
              <div className="cover">
                {a.coverUrl ? <img src={a.coverUrl} alt="" loading="lazy" /> : <div className="no-cover">無封面</div>}
                <FavoriteButton active={a.favorite} onToggle={() => void toggleFavorite(a)} />
                {(a.completed || a.lastEpisodeLabel) && (
                  <span className={a.completed ? 'badge done' : 'badge'}>{progressText(a)}</span>
                )}
                {a.hidden && <span className="badge hidden-badge">已隱藏</span>}
              </div>
              <div className="card-body">
                <div className="card-title">{a.title}</div>
                <div className="muted small">
                  {a.sites.map(siteLabel).join('・')} <Stars rating={a.rating} />
                </div>
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
