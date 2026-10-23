import { ulid } from '@agm/shared';
import type { QueueItem } from './storage.ts';

const MAX_ITEMS = 5000;
const MAX_TRIES = 5;

export interface QueueDeps {
  load(): Promise<QueueItem[]>;
  save(items: QueueItem[]): Promise<void>;
  /** 網路錯誤（server 沒開）時要 throw */
  request(method: string, path: string, body?: unknown): Promise<Response>;
}

export type FlushResult = 'done' | 'offline' | 'error';

/**
 * 依序送出寫入請求。順序很重要：例如動畫建檔要在觀看紀錄之前。
 * 所有讀寫都經過同一把鎖，避免 service worker 中交錯的 await 弄亂佇列。
 */
export class WriteQueue {
  private lock: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: QueueDeps) {}

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn);
    this.lock = next.catch(() => {});
    return next;
  }

  enqueue(item: Omit<QueueItem, 'id' | 'tries'>): Promise<void> {
    return this.exclusive(async () => {
      const items = await this.deps.load();
      const entry: QueueItem = { ...item, id: ulid(), tries: 0 };
      const i = item.key ? items.findIndex((x) => x.key === item.key) : -1;
      // 原地取代以保留先後順序
      if (i >= 0) items[i] = entry;
      else items.push(entry);
      await this.deps.save(items.slice(-MAX_ITEMS));
    });
  }

  size(): Promise<number> {
    return this.exclusive(async () => (await this.deps.load()).length);
  }

  flush(): Promise<FlushResult> {
    return this.exclusive(async () => {
      for (;;) {
        const items = await this.deps.load();
        const item = items[0];
        if (!item) return 'done';
        let res: Response;
        try {
          res = await this.deps.request(item.method, item.path, item.body);
        } catch {
          return 'offline';
        }
        if (res.ok || (res.status >= 400 && res.status < 500)) {
          // 4xx 重送也不會成功，直接丟棄
          if (!res.ok) console.warn('[queue] 丟棄', res.status, item.method, item.path, await res.text().catch(() => ''));
          await this.deps.save(items.slice(1));
          continue;
        }
        item.tries++;
        await this.deps.save(item.tries >= MAX_TRIES ? items.slice(1) : items);
        return 'error';
      }
    });
  }
}
