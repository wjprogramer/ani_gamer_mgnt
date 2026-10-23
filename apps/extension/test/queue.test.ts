import { describe, expect, it } from 'vitest';
import { WriteQueue } from '../src/lib/queue.ts';
import type { QueueItem } from '../src/lib/storage.ts';

function setup(respond: (path: string) => Response | 'offline') {
  let items: QueueItem[] = [];
  const sent: string[] = [];
  const queue = new WriteQueue({
    load: async () => structuredClone(items),
    save: async (next) => {
      items = next;
    },
    request: async (_m, path) => {
      const r = respond(path);
      if (r === 'offline') throw new TypeError('Failed to fetch');
      sent.push(path);
      return r;
    },
  });
  return { queue, sent, items: () => items };
}

describe('WriteQueue', () => {
  it('依序送出並清空', async () => {
    const { queue, sent, items } = setup(() => new Response(null, { status: 204 }));
    await queue.enqueue({ method: 'POST', path: '/a' });
    await queue.enqueue({ method: 'POST', path: '/b' });
    expect(await queue.flush()).toBe('done');
    expect(sent).toEqual(['/a', '/b']);
    expect(items()).toEqual([]);
  });

  it('相同 key 原地取代', async () => {
    const { queue, items } = setup(() => 'offline');
    await queue.enqueue({ method: 'POST', path: '/anime' });
    await queue.enqueue({ method: 'POST', path: '/watch?1', key: 'w' });
    await queue.enqueue({ method: 'POST', path: '/other' });
    await queue.enqueue({ method: 'POST', path: '/watch?2', key: 'w' });
    expect(items().map((i) => i.path)).toEqual(['/anime', '/watch?2', '/other']);
  });

  it('離線時保留，恢復後補送', async () => {
    let online = false;
    const { queue, sent, items } = setup(() => (online ? new Response('{}') : 'offline'));
    await queue.enqueue({ method: 'POST', path: '/a' });
    expect(await queue.flush()).toBe('offline');
    expect(items()).toHaveLength(1);
    online = true;
    expect(await queue.flush()).toBe('done');
    expect(sent).toEqual(['/a']);
  });

  it('4xx 丟棄，5xx 重試數次後丟棄', async () => {
    const { queue, items } = setup((p) => new Response(null, { status: p === '/bad' ? 400 : 500 }));
    await queue.enqueue({ method: 'POST', path: '/bad' });
    await queue.enqueue({ method: 'POST', path: '/err' });
    expect(await queue.flush()).toBe('error');
    expect(items().map((i) => [i.path, i.tries])).toEqual([['/err', 1]]);
    for (let i = 0; i < 4; i++) await queue.flush();
    expect(items()).toEqual([]);
  });
});
