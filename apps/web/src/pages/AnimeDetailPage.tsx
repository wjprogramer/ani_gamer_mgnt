import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ulid, type AnimeDetail, type AnimeGroup, type AnimeSummary, type Review } from '@agm/shared';
import { api, episodeText, formatDuration, formatTime, progressText, siteLabel } from '../api.ts';
import { FavoriteButton, Stars } from '../components.tsx';

interface Draft {
  id: string | null;
  content: string;
  rating: number | null;
  spoiler: boolean;
  createdAt?: string;
}

const emptyDraft = (): Draft => ({ id: null, content: '', rating: null, spoiler: false });
const canSave = (d: Draft) => d.content.trim() !== '' || d.rating !== null;

/** 勾選作品所屬的分群，也可以直接新增分群 */
function GroupPicker({ anime, onChange }: { anime: AnimeDetail; onChange: (a: AnimeDetail) => void }) {
  const [groups, setGroups] = useState<AnimeGroup[]>([]);
  const [name, setName] = useState('');
  useEffect(() => void api.listGroups().then(setGroups), []);

  const save = async (groupIds: string[]) => onChange(await api.setAnimeGroups(anime.id, groupIds));
  const toggle = (id: string, on: boolean) =>
    void save(on ? [...anime.groupIds, id] : anime.groupIds.filter((g) => g !== id));

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const g = await api.createGroup(name.trim());
    setGroups((list) => [...list, g]);
    setName('');
    await save([...anime.groupIds, g.id]);
  }

  return (
    <div>
      <div className="row">
        {groups.map((g) => (
          <label key={g.id} className="row small">
            <input type="checkbox" checked={anime.groupIds.includes(g.id)} onChange={(e) => toggle(g.id, e.target.checked)} />
            {g.name}
          </label>
        ))}
        {groups.length === 0 && <span className="muted small">還沒有分群。</span>}
      </div>
      <form className="row merge-search" onSubmit={(e) => void create(e)}>
        <input placeholder="新增分群並加入" value={name} maxLength={50} onChange={(e) => setName(e.target.value)} />
        <button disabled={!name.trim()}>新增</button>
      </form>
    </div>
  );
}

/** 搜尋其他作品併入目前這部（合併頁沒列出時使用） */
function MergeSearch({ anime, onMerged }: { anime: AnimeDetail; onMerged: () => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<AnimeSummary[]>([]);

  useEffect(() => {
    if (!q.trim()) return setResults([]);
    const timer = setTimeout(() => {
      void api.listAnime({ q: q.trim(), includeHidden: true }).then((list) => setResults(list.filter((a) => a.id !== anime.id).slice(0, 10)));
    }, 200);
    return () => clearTimeout(timer);
  }, [q, anime.id]);

  async function merge(other: AnimeSummary) {
    if (!window.confirm(`把「${other.title}」併入「${anime.title}」？
觀看紀錄與評論會移到這部作品，此操作無法復原。`)) return;
    await api.merge(anime.id, other.id);
    setQ('');
    onMerged();
  }

  return (
    <div className="merge-search">
      <input type="search" placeholder="搜尋要併入這部的作品" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul>
        {results.map((a) => (
          <li key={a.id}>
            <span className="grow">
              {a.title} <span className="muted small">{a.sites.map(siteLabel).join('・')}</span>
            </span>
            <button onClick={() => void merge(a)}>併入這部</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnimeDetailPage() {
  const { id = '' } = useParams();
  const [anime, setAnime] = useState<AnimeDetail | null>(null);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);

  const load = useCallback(() => api.getAnime(id).then(setAnime, (e: Error) => setError(e.message)), [id]);
  useEffect(() => void load(), [load]);

  if (error) return <p className="error">讀取失敗：{error}</p>;
  if (!anime) return <p className="muted">載入中…</p>;

  async function toggleHidden() {
    setAnime(await api.patchAnime(id, { hidden: !anime!.hidden }));
  }

  async function toggleFavorite() {
    setAnime(await api.patchAnime(id, { favorite: !anime!.favorite }));
  }

  async function setManualCompleted(manualCompleted: boolean | null) {
    setAnime(await api.patchAnime(id, { manualCompleted }));
  }

  async function saveReview() {
    // 只有評分、沒有留言也可以儲存
    if (!canSave(draft)) return;
    const now = new Date().toISOString();
    await api.putReview(draft.id ?? ulid(), {
      animeId: id,
      rating: draft.rating,
      content: draft.content.trim(),
      spoiler: draft.spoiler,
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    });
    setDraft(emptyDraft());
    await load();
  }

  async function removeReview(r: Review) {
    if (!window.confirm('確定刪除這則評論？')) return;
    await api.deleteReview(r.id);
    await load();
  }

  const bahamut = anime.sources.find((s) => s.source === 'bahamut');
  const tags = (bahamut?.rawMeta.tags as string[] | undefined) ?? [];
  // 由新到舊；手動標記看完也列成一筆
  const rows = [
    ...anime.episodes.flatMap((e) => e.watches.map((w) => ({ key: w.id, at: w.startedAt, episode: e, watch: w }))),
    ...(anime.manualCompleted && anime.manualCompletedAt
      ? [{ key: 'mark', at: anime.manualCompletedAt, episode: undefined, watch: undefined }]
      : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <article className="detail">
      <Link to="/" className="muted small">
        ← 返回列表
      </Link>
      <div className="detail-head">
        {anime.coverUrl ? <img className="detail-cover" src={anime.coverUrl} alt="" /> : <div className="detail-cover no-cover">無封面</div>}
        <div className="grow">
          <h1 className="row">
            {anime.title}
            <FavoriteButton active={anime.favorite} onToggle={() => void toggleFavorite()} />
          </h1>
          {tags.length > 0 && (
            <div className="tags">
              {tags.map((t) => (
                <span key={t} className="tag">
                  {t}
                </span>
              ))}
            </div>
          )}
          <dl>
            <dt>本機 ID</dt>
            <dd>
              <code>{anime.id}</code>
            </dd>
            {anime.sources.map((s) => (
              <div key={s.source + s.externalId}>
                <dt>{siteLabel(s.source)} ID</dt>
                <dd>
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noreferrer">
                      {s.externalId}
                    </a>
                  ) : (
                    s.externalId
                  )}
                </dd>
              </div>
            ))}
            <dt>評分</dt>
            <dd>{anime.rating ? <Stars rating={anime.rating} /> : <span className="muted">未評分</span>}</dd>
            <dt>進度</dt>
            <dd>
              {progressText(anime)}
              {anime.manualCompleted !== null && (
                <span className="muted small"> （手動標記於 {formatTime(anime.manualCompletedAt)}）</span>
              )}
              <div className="row small">
                {anime.manualCompleted !== true && (
                  <button onClick={() => void setManualCompleted(true)}>標記看完</button>
                )}
                {anime.manualCompleted !== false && (
                  <button onClick={() => void setManualCompleted(false)}>標記沒看完</button>
                )}
                {anime.manualCompleted !== null && (
                  <button onClick={() => void setManualCompleted(null)}>改回自動判斷</button>
                )}
              </div>
            </dd>
            <dt>建檔時間</dt>
            <dd>{formatTime(anime.createdAt)}</dd>
          </dl>
          <button onClick={() => void toggleHidden()}>{anime.hidden ? '取消隱藏' : '隱藏這部動畫'}</button>
          {anime.hidden && <span className="muted small"> 隱藏於 {formatTime(anime.hiddenAt)}</span>}
        </div>
      </div>

      <section>
        <h2>評論</h2>
        <div className="editor">
          <textarea
            rows={3}
            placeholder="寫下你對這部動畫的想法…"
            value={draft.content}
            onChange={(e) => setDraft({ ...draft, content: e.target.value })}
          />
          <div className="row">
            <select
              value={draft.rating ?? ''}
              onChange={(e) => setDraft({ ...draft, rating: e.target.value ? Number(e.target.value) : null })}
            >
              <option value="">不評分</option>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {'★'.repeat(n)}
                </option>
              ))}
            </select>
            <label>
              <input type="checkbox" checked={draft.spoiler} onChange={(e) => setDraft({ ...draft, spoiler: e.target.checked })} />
              含劇透
            </label>
            <span className="grow" />
            {draft.id && <button onClick={() => setDraft(emptyDraft())}>取消編輯</button>}
            <button className="primary" disabled={!canSave(draft)} onClick={() => void saveReview()}>
              {draft.id ? '更新' : '儲存'}
            </button>
          </div>
        </div>
        {anime.reviews.length === 0 && <p className="muted">還沒有評論。</p>}
        <ul className="reviews">
          {anime.reviews.map((r) => (
            <li key={r.id}>
              <div className="row muted small">
                {r.rating && <span className="stars">{'★'.repeat(r.rating)}</span>}
                <span>{formatTime(r.updatedAt)}</span>
                {r.spoiler && <span className="tag danger">劇透</span>}
                <span className="grow" />
                <button
                  className="link"
                  onClick={() => setDraft({ id: r.id, content: r.content, rating: r.rating, spoiler: r.spoiler, createdAt: r.createdAt })}
                >
                  編輯
                </button>
                <button className="link danger" onClick={() => void removeReview(r)}>
                  刪除
                </button>
              </div>
              {r.content && <p className="review-content">{r.content}</p>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>分群</h2>
        <GroupPicker anime={anime} onChange={setAnime} />
      </section>

      <section>
        <h2>合併其他作品</h2>
        {anime.altTitles.length > 0 && <p className="muted small">其他名稱：{anime.altTitles.join('、')}</p>}
        <MergeSearch anime={anime} onMerged={() => void load()} />
      </section>

      <section>
        <h2>觀看紀錄</h2>
        {rows.length === 0 && <p className="muted">還沒有觀看紀錄。</p>}
        <table>
          <tbody>
            {rows.map(({ key, at, episode: e, watch: w }) =>
              e && w ? (
                <tr key={key}>
                  {anime.sites.length > 1 && <td>{siteLabel(e.source)}</td>}
                  <td>{episodeText(e.label)}</td>
                  <td>{formatTime(at)}</td>
                  <td>
                    {formatDuration(w.progressSec)}
                    {w.durationSec > 0 && ` / ${formatDuration(w.durationSec)}`}
                  </td>
                  <td>{w.completed ? '✓ 看完' : ''}</td>
                </tr>
              ) : (
                <tr key={key}>
                  {anime.sites.length > 1 && <td />}
                  <td>手動標記</td>
                  <td>{formatTime(at)}</td>
                  <td />
                  <td>✓ 看完</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </section>
    </article>
  );
}
