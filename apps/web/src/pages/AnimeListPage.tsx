import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ANIME_RATINGS, SOURCES, type AnimeFilter, type AnimeGroup, type AnimeProgress, type AnimeSort, type AnimeSummary, type Source } from '@agm/shared';
import { api, formatTime, progressText, siteLabel } from '../api.ts';
import { FavoriteButton, MultiSelect, Stars } from '../components.tsx';

const FILTERS: { value: AnimeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'favorite', label: '收藏' },
  { value: 'watched', label: '看過' },
  { value: 'reviewed', label: '有評論' },
];

const SORTS: { value: AnimeSort; label: string }[] = [
  { value: 'default', label: '最後觀看' },
  { value: 'title', label: '名稱' },
  { value: 'rating', label: '評分高到低' },
  { value: 'created', label: '最新建檔' },
];

const PROGRESS: { value: AnimeProgress | ''; label: string }[] = [
  { value: '', label: '所有進度' },
  { value: 'completed', label: '已看完' },
  { value: 'incomplete', label: '沒看完' },
  { value: 'unwatched', label: '還沒看' },
];

const RATING_OPTIONS = ANIME_RATINGS.map((r) => ({ value: r, label: r === 'unrated' ? '未評分' : '★'.repeat(r) }));

export function AnimeListPage() {
  const [params, setParams] = useSearchParams();
  // 舊網址可能帶 filter=hidden，不在分頁裡的值一律當成全部
  const filter = FILTERS.find((f) => f.value === params.get('filter'))?.value ?? 'all';
  const q = params.get('q') ?? '';
  const site = params.get('site') ?? '';
  // 網址中以逗號分隔；沒選任何來源表示全部
  const sites = site.split(',').filter((s): s is Source => (SOURCES as readonly string[]).includes(s));
  const group = params.get('group') ?? '';
  const rating = params.get('rating') ?? '';
  // 網址中以逗號分隔，例如 5,3,unrated
  const ratings = ANIME_RATINGS.filter((r) => rating.split(',').includes(String(r)));
  const sort = (params.get('sort') as AnimeSort) || 'default';
  // 與其他篩選獨立；開啟時已隱藏的作品也一起列出
  const showHidden = params.get('hidden') === '1';
  const progress = PROGRESS.find((p) => p.value === params.get('progress'))?.value ?? '';
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
          sites,
          groupId: group || undefined,
          ratings,
          includeHidden: showHidden,
          progress: progress || undefined,
        })
        .then(setItems, (e: Error) => setError(e.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [filter, q, site, group, rating, sort, showHidden, progress]);

  const toggleSite = (s: Source) =>
    update({ site: (sites.includes(s) ? sites.filter((x) => x !== s) : [...sites, s]).join(',') });

  const update = (next: Record<string, string>) => {
    const merged: Record<string, string> = { filter, q, site, group, rating, progress, sort, hidden: showHidden ? '1' : '', ...next };
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
        <div className="chips" role="group" aria-label="來源">
          {SOURCES.map((s) => (
            <button
              key={s}
              type="button"
              className={sites.includes(s) ? 'chip active' : 'chip'}
              aria-pressed={sites.includes(s)}
              onClick={() => toggleSite(s)}
            >
              {siteLabel(s)}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={showHidden ? 'chip active' : 'chip'}
          aria-pressed={showHidden}
          onClick={() => update({ hidden: showHidden ? '' : '1' })}
        >
          顯示已隱藏
        </button>
        <select value={group} onChange={(e) => update({ group: e.target.value })} aria-label="分群">
          <option value="">所有分群</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}（{g.count}）
            </option>
          ))}
        </select>
        <select value={progress} onChange={(e) => update({ progress: e.target.value })} aria-label="觀看進度">
          {PROGRESS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <MultiSelect
          label="所有評分"
          options={RATING_OPTIONS}
          value={ratings}
          onChange={(v) => update({ rating: v.join(',') })}
        />
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
