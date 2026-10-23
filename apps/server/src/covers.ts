import fs from 'node:fs/promises';
import path from 'node:path';
import type { Store } from './store.ts';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export type CoverQueue = (animeId: string, url: string | null) => void;

/** 依序下載封面並存到 coversDir，避免同時對來源網站發出大量請求 */
export function createCoverQueue(store: Store, coversDir: string, fetchImpl: typeof fetch = fetch): CoverQueue {
  const pending = new Set<string>();
  let chain = Promise.resolve();

  return (animeId, url) => {
    if (!url || pending.has(animeId)) return;
    pending.add(animeId);
    chain = chain
      .then(async () => {
        const res = await fetchImpl(url, { headers: { Referer: 'https://ani.gamer.com.tw/' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const type = res.headers.get('content-type')?.split(';')[0] ?? '';
        const file = `${animeId}.${EXT[type] ?? 'jpg'}`;
        await fs.mkdir(coversDir, { recursive: true });
        await fs.writeFile(path.join(coversDir, file), Buffer.from(await res.arrayBuffer()));
        store.setCoverPath(animeId, file);
      })
      .catch((e) => console.warn(`[cover] 下載失敗 ${animeId} ${url}:`, e))
      .finally(() => pending.delete(animeId));
  };
}
