import { useCallback, useEffect, useState } from 'react';
import { ulid, type AnimeDetail, type Review } from '@agm/shared';
import type { VideoPageInfo } from '../../bahamut/parse.ts';
import { mutate, query, send } from '../../lib/messages.ts';
import { hiddenSnsItem, serverUrlItem } from '../../lib/storage.ts';

type Load = { state: 'loading' } | { state: 'offline' } | { state: 'ready'; anime: AnimeDetail | null };

interface Draft {
  id: string | null;
  content: string;
  rating: number | null;
  spoiler: boolean;
  createdAt?: string;
}

const emptyDraft = (): Draft => ({ id: null, content: '', rating: null, spoiler: false });

export function ReviewPanel({ info }: { info: VideoPageInfo }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [reviews, setReviews] = useState<Review[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [hidden, setHidden] = useState(false);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [serverUrl, setServerUrl] = useState('');
  const [open, setOpen] = useState(true);

  const refresh = useCallback(async () => {
    // 建檔請求可能還在佇列中，先嘗試送出
    await send({ type: 'flush' });
    const res = await query<AnimeDetail>('GET', `/bahamut/anime/${info.animeSn}`);
    if (res.ok) {
      setLoad({ state: 'ready', anime: res.data });
      setReviews(res.data.reviews);
    } else setLoad(res.offline ? { state: 'offline' } : { state: 'ready', anime: null });
  }, [info.animeSn]);

  useEffect(() => {
    void refresh();
    void serverUrlItem.getValue().then(setServerUrl);
    void hiddenSnsItem.getValue().then((v) => setHidden(v.includes(info.animeSn)));
    return hiddenSnsItem.watch((v) => setHidden(v.includes(info.animeSn)));
  }, [refresh, info.animeSn]);

  function save() {
    if (!draft.content.trim()) return;
    const now = new Date().toISOString();
    const review: Review = {
      id: draft.id ?? ulid(),
      animeId: load.state === 'ready' ? (load.anime?.id ?? '') : '',
      episodeId: null,
      rating: draft.rating,
      content: draft.content.trim(),
      spoiler: draft.spoiler,
      createdAt: draft.createdAt ?? now,
      updatedAt: now,
    };
    void mutate(
      'PUT',
      `/reviews/${review.id}`,
      {
        animeSn: info.animeSn,
        rating: review.rating,
        content: review.content,
        spoiler: review.spoiler,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
      },
      `review:${review.id}`,
    );
    setReviews((rs) => [review, ...rs.filter((r) => r.id !== review.id)]);
    setDraft(emptyDraft());
  }

  function remove(id: string) {
    if (!window.confirm('確定刪除這則評論？')) return;
    void mutate('DELETE', `/reviews/${id}`, undefined, `review:${id}`);
    setReviews((rs) => rs.filter((r) => r.id !== id));
  }

  function toggleHidden() {
    void hiddenSnsItem.getValue().then((v) => {
      const next = hidden ? v.filter((s) => s !== info.animeSn) : [...v, info.animeSn];
      return hiddenSnsItem.setValue(next);
    });
    void mutate(
      'POST',
      '/bahamut/hide',
      { animeSn: info.animeSn, hidden: !hidden, title: info.title, coverUrl: info.coverUrl, at: new Date().toISOString() },
      `hide:${info.animeSn}`,
    );
  }

  const animeId = load.state === 'ready' ? load.anime?.id : undefined;

  return (
    <section className="panel">
      <header>
        <button className="title" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? '▾' : '▸'} 我的評論・{info.title}
        </button>
        <div className="actions">
          <button onClick={toggleHidden}>{hidden ? '取消隱藏' : '隱藏此動畫'}</button>
          {animeId && serverUrl && (
            <a href={`${serverUrl}/#/anime/${animeId}`} target="_blank" rel="noreferrer">
              在管理頁開啟
            </a>
          )}
        </div>
      </header>

      {open && (
        <>
          {load.state === 'offline' && <p className="notice">本機 server 未啟動：新的評論會先暫存，啟動後自動補送。</p>}

          <div className="editor">
            <textarea
              placeholder="寫下你對這部動畫的想法…"
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              rows={3}
            />
            <div className="row">
              <label>
                評分
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
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.spoiler}
                  onChange={(e) => setDraft({ ...draft, spoiler: e.target.checked })}
                />
                含劇透
              </label>
              <span className="spacer" />
              {draft.id && <button onClick={() => setDraft(emptyDraft())}>取消編輯</button>}
              <button className="primary" onClick={save} disabled={!draft.content.trim()}>
                {draft.id ? '更新' : '儲存'}
              </button>
            </div>
          </div>

          {load.state === 'loading' && <p className="muted">載入中…</p>}
          <ul className="reviews">
            {reviews.map((r) => {
              const blur = r.spoiler && !revealed.has(r.id);
              return (
                <li key={r.id}>
                  <div className="meta">
                    {r.rating && <span className="stars">{'★'.repeat(r.rating)}</span>}
                    <time>{new Date(r.updatedAt).toLocaleString()}</time>
                    {r.spoiler && <span className="tag">劇透</span>}
                    <span className="spacer" />
                    <button
                      onClick={() =>
                        setDraft({ id: r.id, content: r.content, rating: r.rating, spoiler: r.spoiler, createdAt: r.createdAt })
                      }
                    >
                      編輯
                    </button>
                    <button onClick={() => remove(r.id)}>刪除</button>
                  </div>
                  <p
                    className={blur ? 'content blur' : 'content'}
                    onClick={() => blur && setRevealed(new Set(revealed).add(r.id))}
                    title={blur ? '點擊顯示劇透內容' : undefined}
                  >
                    {r.content}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
