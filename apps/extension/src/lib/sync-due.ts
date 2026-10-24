import type { HistorySyncState } from './storage.ts';

/** 另一個同步還在跑的判斷時間，超過就視為已中斷 */
export const LOCK_MS = 5 * 60_000;
export const AUTO_SYNC_INTERVAL_MS = 6 * 3_600_000;
const RETRY_AFTER_FAIL_MS = 3_600_000;

/** 自動同步是否該執行了 */
export function isSyncDue(state: HistorySyncState, now = Date.now()) {
  if (state.runningSince && now - Date.parse(state.runningSince) < LOCK_MS) return false;
  if (!state.lastRunAt) return true;
  const elapsed = now - Date.parse(state.lastRunAt);
  return elapsed >= (state.ok ? AUTO_SYNC_INTERVAL_MS : RETRY_AFTER_FAIL_MS);
}
