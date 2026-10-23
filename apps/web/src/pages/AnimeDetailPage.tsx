import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ulid, type AnimeDetail, type Review } from '@agm/shared';
import { api, episodeText, formatDuration, formatTime } from '../api.ts';

interface Draft {
  id: string | null;
  content: string;
  rating: number | null;
  spoiler: boolean;
  createdAt?: string;
}

const emptyDraft = (): Draft => ({ id: null, content: '', rating: null, spoiler: false });

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

  async function saveReview() {
    if (!draft.content.trim()) return;
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
  const watchedEpisodes = anime.episodes.filter((e) => e.watches.length);

  return (
    <article className="detail">
      <Link to="/" className="muted small">
        ← 返回列表
      </Link>
      <div className="detail-head">
        {anime.coverUrl ? <img className="detail-cover" src={anime.coverUrl} alt="" /> : <div className="detail-cover no-cover">無封面</div>}
        <div className="grow">
          <h1>{anime.title}</h1>
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
                <dt>{s.source === 'bahamut' ? '動畫瘋 sn' : s.source}</dt>
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
            <dt>進度</dt>
            <dd>
              {anime.completed ? '✓ 看完' : (episodeText(anime.lastEpisodeLabel) ?? '尚未觀看')}
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
            <button className="primary" disabled={!draft.content.trim()} onClick={() => void saveReview()}>
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
              <p className="review-content">{r.content}</p>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>觀看紀錄</h2>
        {watchedEpisodes.length === 0 && <p className="muted">還沒有觀看紀錄。</p>}
        <table>
          <tbody>
            {watchedEpisodes.flatMap((e) =>
              e.watches.map((w) => (
                <tr key={w.id}>
                  <td>{episodeText(e.label)}</td>
                  <td>{formatTime(w.startedAt)}</td>
                  <td>
                    {formatDuration(w.progressSec)}
                    {w.durationSec > 0 && ` / ${formatDuration(w.durationSec)}`}
                  </td>
                  <td>{w.completed ? '✓ 看完' : ''}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </section>
    </article>
  );
}
