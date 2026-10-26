import {
  MOVIE_LABEL,
  SOURCE_LABELS,
  type AnimeDetail,
  type AnimeFilter,
  type AnimePatch,
  type AnimeSummary,
  type MergeCandidate,
  type Review,
  type ReviewPut,
  type Source,
  type WatchHistoryItem,
} from '@agm/shared';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return (res.status === 204 ? null : await res.json()) as T;
}

export const api = {
  listAnime: (filter: AnimeFilter, q: string) =>
    request<AnimeSummary[]>('GET', `/anime?${new URLSearchParams({ filter, q })}`),
  getAnime: (id: string) => request<AnimeDetail>('GET', `/anime/${id}`),
  patchAnime: (id: string, patch: AnimePatch) => request<AnimeDetail>('PATCH', `/anime/${id}`, patch),
  watchHistory: (before?: string) =>
    request<WatchHistoryItem[]>('GET', `/watch?${new URLSearchParams(before ? { before } : {})}`),
  deleteWatch: (id: string) => request<null>('DELETE', `/watch/${id}`),
  putReview: (id: string, review: ReviewPut) => request<Review>('PUT', `/reviews/${id}`, review),
  deleteReview: (id: string) => request<null>('DELETE', `/reviews/${id}`),
  mergeCandidates: () => request<MergeCandidate[]>('GET', '/merge/candidates'),
  merge: (targetId: string, sourceId: string) => request<AnimeDetail>('POST', '/merge', { targetId, sourceId }),
  dismissMerge: (aId: string, bId: string) => request<null>('POST', '/merge/dismiss', { aId, bId }),
};

export const siteLabel = (s: string) => SOURCE_LABELS[s as Source] ?? s;

/** 列表與合併頁顯示的進度；電影沒有集數 */
export function progressText(a: Pick<AnimeSummary, 'completed' | 'lastEpisodeLabel'>) {
  if (a.completed) return '✓ 看完';
  if (!a.lastEpisodeLabel) return '尚未觀看';
  return a.lastEpisodeLabel === MOVIE_LABEL ? '看過' : `看到${episodeText(a.lastEpisodeLabel)}`;
}

export function formatTime(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('zh-TW', { hour12: false }) : '—';
}

export function formatDuration(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function episodeText(label: string | null) {
  if (!label) return null;
  return /^\d+(\.\d+)?$/.test(label) ? `第 ${label} 集` : label;
}
