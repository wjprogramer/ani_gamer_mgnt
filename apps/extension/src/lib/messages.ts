import { browser } from '#imports';
import type { SnMap } from '@agm/shared';

export type Message =
  | { type: 'health' }
  | { type: 'flush' }
  /** 寫入：先排入佇列，server 離線時之後補送 */
  | { type: 'mutate'; key?: string; method: string; path: string; body?: unknown }
  /** 讀取：server 離線時回傳 offline */
  | { type: 'query'; method: string; path: string; body?: unknown }
  | { type: 'resolveSn'; videoSns: string[] };

export interface HealthResult {
  online: boolean;
  queueSize: number;
  serverUrl: string;
}

export type QueryResult<T> = { ok: true; data: T } | { ok: false; offline: boolean; status?: number; error?: string };

interface Responses {
  health: HealthResult;
  flush: HealthResult;
  mutate: { queued: true };
  query: QueryResult<unknown>;
  resolveSn: SnMap;
}

export async function send<M extends Message>(msg: M): Promise<Responses[M['type']]> {
  const res = await browser.runtime.sendMessage(msg);
  if (res && typeof res === 'object' && '__error' in res) throw new Error(String(res.__error));
  return res;
}

export async function query<T>(method: string, path: string, body?: unknown): Promise<QueryResult<T>> {
  return (await send({ type: 'query', method, path, body })) as QueryResult<T>;
}

export function mutate(method: string, path: string, body?: unknown, key?: string) {
  return send({ type: 'mutate', method, path, body, key });
}
