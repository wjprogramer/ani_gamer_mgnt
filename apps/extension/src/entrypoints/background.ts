import { browser, defineBackground } from '#imports';
import type { SnMap } from '@agm/shared';
import { animeSnFromVideoHtml } from '../bahamut/parse.ts';
import type { HealthResult, Message, QueryResult } from '../lib/messages.ts';
import { syncHistory, type SyncDeps } from '../lib/history-sync.ts';
import { isSyncDue } from '../lib/sync-due.ts';
import { WriteQueue } from '../lib/queue.ts';
import { autoSyncItem, hiddenSnsItem, historySyncItem, queueItem, serverOnlineItem, serverUrlItem } from '../lib/storage.ts';

const HEALTH_ALARM = 'health';
/** 每小時檢查一次，實際同步間隔見 AUTO_SYNC_INTERVAL_MS */
const HISTORY_ALARM = 'history';
/** 背景抓播放頁的間隔，避免對動畫瘋造成負擔 */
const RESOLVE_INTERVAL_MS = 1500;
const RESOLVE_MAX_PER_CALL = 20;

async function request(method: string, path: string, body?: unknown): Promise<Response> {
  const base = await serverUrlItem.getValue();
  return fetch(base + '/api' + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const queue = new WriteQueue({
  load: () => queueItem.getValue(),
  save: (items) => queueItem.setValue(items),
  request,
});

async function setOnline(online: boolean) {
  await serverOnlineItem.setValue(online);
  await browser.action.setBadgeBackgroundColor({ color: '#cf222e' });
  await browser.action.setBadgeText({ text: online ? '' : '!' });
  await browser.action.setTitle({ title: online ? '動畫瘋管理工具' : '動畫瘋管理工具：本機 server 未啟動' });
}

/** 檢查 server、補送佇列，並同步隱藏清單 */
async function sync(): Promise<HealthResult> {
  let online = false;
  try {
    online = (await request('GET', '/health')).ok;
  } catch {
    online = false;
  }
  if (online) {
    const result = await queue.flush();
    online = result !== 'offline';
    // 佇列清空後才用 server 的資料覆蓋，以免蓋掉尚未送出的隱藏操作
    if (result === 'done') {
      try {
        const res = await request('GET', '/bahamut/hidden');
        if (res.ok) await hiddenSnsItem.setValue(await res.json());
      } catch {
        online = false;
      }
    }
  }
  await setOnline(online);
  return { online, queueSize: await queue.size(), serverUrl: await serverUrlItem.getValue() };
}

async function query(method: string, path: string, body?: unknown): Promise<QueryResult<unknown>> {
  let res: Response;
  try {
    res = await request(method, path, body);
  } catch {
    await setOnline(false);
    return { ok: false, offline: true };
  }
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, offline: false, status: res.status, error: err.error };
  }
  return { ok: true, data: res.status === 204 ? null : await res.json() };
}

// ---- 未知集數 → animeSn ----

const snMemo = new Map<string, string>();
let lastPageFetch = 0;

async function resolveSn(videoSns: string[]): Promise<SnMap> {
  const result: SnMap = {};
  let missing = [...new Set(videoSns)].filter((v) => {
    const hit = snMemo.get(v);
    if (hit) result[v] = hit;
    return !hit;
  });
  if (!missing.length) return result;

  const fromServer = await query('POST', '/bahamut/sn-map/lookup', { videoSns: missing });
  if (fromServer.ok) {
    for (const [v, a] of Object.entries(fromServer.data as SnMap)) {
      snMemo.set(v, a);
      result[v] = a;
    }
    missing = missing.filter((v) => !result[v]);
  }

  const fetched: SnMap = {};
  for (const v of missing.slice(0, RESOLVE_MAX_PER_CALL)) {
    const wait = lastPageFetch + RESOLVE_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastPageFetch = Date.now();
    try {
      const html = await (await fetch(`https://ani.gamer.com.tw/animeVideo.php?sn=${v}`)).text();
      const animeSn = animeSnFromVideoHtml(html);
      if (animeSn) fetched[v] = animeSn;
    } catch (e) {
      console.warn('[resolveSn] 失敗', v, e);
    }
  }
  if (Object.keys(fetched).length) {
    for (const [v, a] of Object.entries(fetched)) snMemo.set(v, a);
    Object.assign(result, fetched);
    await queue.enqueue({ method: 'PUT', path: '/bahamut/sn-map', body: { entries: fetched } });
    void sync();
  }
  return result;
}

// ---- 觀看紀錄同步 ----

const syncDeps: SyncDeps = { fetch: (input, init) => fetch(input, init), query: query as SyncDeps['query'] };

async function autoSyncHistory() {
  if (!(await autoSyncItem.getValue())) return;
  if (!(await serverOnlineItem.getValue())) return;
  if (isSyncDue(await historySyncItem.getValue())) await syncHistory(syncDeps);
}

async function handle(msg: Message): Promise<unknown> {
  switch (msg.type) {
    case 'health':
    case 'flush':
      return sync();
    case 'mutate':
      await queue.enqueue({ key: msg.key, method: msg.method, path: msg.path, body: msg.body });
      void sync();
      return { queued: true };
    case 'query':
      return query(msg.method, msg.path, msg.body);
    case 'resolveSn':
      return resolveSn(msg.videoSns);
    case 'syncHistory':
      return syncHistory(syncDeps, msg.full);
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handle(msg as Message).then(sendResponse, (e) => sendResponse({ __error: String(e) }));
    return true;
  });

  browser.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
  // service worker 每次喚醒都會執行這裡；重建會重設計時，所以只在不存在時建立
  void browser.alarms.get(HISTORY_ALARM).then(async (a) => {
    if (!a) await browser.alarms.create(HISTORY_ALARM, { periodInMinutes: 60 });
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEALTH_ALARM) void sync();
    if (alarm.name === HISTORY_ALARM) void autoSyncHistory();
  });
  serverUrlItem.watch(() => void sync());
  void sync().then(autoSyncHistory);
});
