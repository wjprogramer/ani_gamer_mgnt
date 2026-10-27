import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ANIME_RATINGS, SOURCES, ulid, type AnimeFilter, type AnimeDetail, type AnimeGroup, type AnimePatch, type AnimeProgress, type AnimeSort, type AnimeSummary, type Source } from '@agm/shared';
import { api, formatTime, progressText, siteLabel } from '../api.ts';
import { FavoriteButton, MultiSelect, Popover, RatingInput, Stars } from '../components.tsx';

const FILTERS: { value: AnimeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'watched', label: '看過' },
  { value: 'reviewed', label: '有評論' },
];

const SORTS: { value: AnimeSort; label: string }[] = [
  { value: 'default', label: '最後觀看' },
  { value: 'title', label: '名稱' },
  { value: 'rating', label: '評分高到低' },
  { value: 'created', label: '最新建檔' },
];

const FAVORITE = [
  { value: '', label: '所有收藏' },
  { value: '1', label: '已收藏' },
  { value: '0', label: '沒收藏' },
];

const PROGRESS: { value: AnimeProgress | ''; label: string }[] = [
  { value: '', label: '所有進度' },
  { value: 'completed', label: '已看完' },
  { value: 'incomplete', label: '沒看完' },
  { value: 'unwatched', label: '還沒看' },
];

const RATING_OPTIONS = ANIME_RATINGS.map((r) => ({ value: r, label: r === 'unrated' ? '未評分' : '★'.repeat(r) }));

/** 卡片右下角「⋯」展開的快速動作：評分、分群、評論、標記看完、隱藏 */
function CardMenu({
  anime,
  groups,
  onChange,
}: {
  anime: AnimeSummary;
  groups: AnimeGroup[];
  onChange: (a: AnimeDetail) => void;
}) {
  const [content, setContent] = useState('');
  const [spoiler, setSpoiler] = useState(false);

  async function saveReview(e: FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    const now = new Date().toISOString();
    await api.putReview(ulid(), { animeId: anime.id, content: content.trim(), spoiler, createdAt: now, updatedAt: now });
    setContent('');
    setSpoiler(false);
    onChange(await api.getAnime(anime.id));
  }

  const toggleGroup = (id: string, on: boolean) =>
    void api
      .setAnimeGroups(anime.id, on ? [...anime.groupIds, id] : anime.groupIds.filter((g) => g !== id))
      .then(onChange);
  const patch = (p: AnimePatch) => void api.patchAnime(anime.id, p).then(onChange);

  return (
    <Popover className="card-menu" title="更多動作" summary="⋯">
      {() => (
        <>
          <div className="menu-section">
            <span className="muted small">評分</span>
            <RatingInput value={anime.rating} onChange={(r) => void api.setRating(anime.id, r).then(onChange)} />
          </div>
          <div className="menu-section">
            <span className="muted small">分群</span>
            {groups.map((g) => (
              <label key={g.id} className="row small">
                <input type="checkbox" checked={anime.groupIds.includes(g.id)} onChange={(e) => toggleGroup(g.id, e.target.checked)} />
                {g.name}
              </label>
            ))}
            {groups.length === 0 && (
              <Link className="small" to="/groups">
                先到分群頁新增分群
              </Link>
            )}
          </div>
          <form className="menu-section" onSubmit={(e) => void saveReview(e)}>
            <span className="muted small">寫評論{anime.reviewCount > 0 && `（已有 ${anime.reviewCount} 則）`}</span>
            <textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} />
            <div className="row small">
              <label className="row small">
                <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />
                含劇透
              </label>
              <span className="grow" />
              <button className="primary" disabled={!content.trim()}>
                儲存
              </button>
            </div>
          </form>
          <div className="menu-section menu-actions">
            {anime.manualCompleted === true ? (
              <button type="button" onClick={() => patch({ manualCompleted: null })}>
                取消標記看完
              </button>
            ) : (
              <button type="button" onClick={() => patch({ manualCompleted: true })}>
                標記看完
              </button>
            )}
            <button type="button" onClick={() => patch({ hidden: !anime.hidden })}>
              {anime.hidden ? '取消隱藏' : '隱藏'}
            </button>
          </div>
        </>
      )}
    </Popover>
  );
}

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
  // 舊網址的 filter=favorite 視同已收藏
  const favorite = params.get('favorite') ?? (params.get('filter') === 'favorite' ? '1' : '');
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
          favorite: favorite === '' ? undefined : favorite === '1',
        })
        .then(setItems, (e: Error) => setError(e.message));
    }, 200);
    return () => clearTimeout(timer);
  }, [filter, q, site, group, rating, sort, showHidden, progress, favorite]);

  const toggleSite = (s: Source) =>
    update({ site: (sites.includes(s) ? sites.filter((x) => x !== s) : [...sites, s]).join(',') });

  const update = (next: Record<string, string>) => {
    const merged: Record<string, string> = { filter, q, site, group, rating, progress, favorite, sort, hidden: showHidden ? '1' : '', ...next };
    // 預設值不放進網址
    if (merged.filter === 'all') delete merged.filter;
    if (merged.sort === 'default') delete merged.sort;
    setParams(Object.fromEntries(Object.entries(merged).filter(([, v]) => v)), { replace: true });
  };

  async function toggleFavorite(a: AnimeSummary) {
    const updated = await api.patchAnime(a.id, { favorite: !a.favorite });
    setItems((list) =>
      favorite !== '' && updated.favorite !== (favorite === '1')
        ? (list ?? []).filter((x) => x.id !== a.id)
        : (list ?? []).map((x) => (x.id === a.id ? { ...x, favorite: updated.favorite } : x)),
    );
  }

  // 快速動作後就地更新，不因為不再符合篩選而消失
  const replace = (d: AnimeDetail) => setItems((list) => (list ?? []).map((x) => (x.id === d.id ? d : x)));

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
        <select value={favorite} onChange={(e) => update({ favorite: e.target.value })} aria-label="收藏">
          {FAVORITE.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
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
            <CardMenu anime={a} groups={groups} onChange={replace} />
          </li>
        ))}
      </ul>
    </>
  );
}
