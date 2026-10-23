import { ulid, type BahamutWatch } from '@agm/shared';
import type { VideoPageInfo } from '../../bahamut/parse.ts';
import { mutate } from '../../lib/messages.ts';

const REPORT_INTERVAL_MS = 15_000;

/**
 * 第一次播放時建立一筆觀看紀錄，之後定期回報進度。
 * TODO: 排除片頭廣告、年齡確認，以及重新整理／續看造成的重複紀錄（見 docs/feasibility.html 第 7 節）。
 */
export function trackWatch(info: VideoPageInfo, signal: AbortSignal) {
  let watchId: string | undefined;
  let startedAt = '';
  let current: HTMLVideoElement | undefined;
  const attached = new WeakSet<HTMLVideoElement>();

  function report() {
    if (!watchId || !current) return;
    const body: BahamutWatch = {
      id: watchId,
      animeSn: info.animeSn,
      animeTitle: info.title,
      videoSn: info.videoSn,
      episodeLabel: info.episodeLabel,
      startedAt,
      at: new Date().toISOString(),
      progressSec: Math.floor(current.currentTime || 0),
      durationSec: Number.isFinite(current.duration) ? Math.floor(current.duration) : 0,
    };
    void mutate('POST', '/bahamut/watch', body, `watch:${watchId}`);
  }

  function attach(video: HTMLVideoElement) {
    if (attached.has(video)) return;
    attached.add(video);
    video.addEventListener('playing', () => {
      current = video;
      if (!watchId) {
        watchId = ulid();
        startedAt = new Date().toISOString();
      }
      report();
    }, { signal });
    for (const type of ['pause', 'ended', 'seeked'] as const) {
      video.addEventListener(type, () => current === video && report(), { signal });
    }
  }

  // 播放器的 <video> 由頁面 JS 動態建立
  const scan = () => document.querySelectorAll('video').forEach(attach);
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  scan();

  const interval = setInterval(() => {
    if (current && !current.paused) report();
  }, REPORT_INTERVAL_MS);
  const onHide = () => document.visibilityState === 'hidden' && report();
  document.addEventListener('visibilitychange', onHide, { signal });
  window.addEventListener('pagehide', report, { signal });

  signal.addEventListener('abort', () => {
    report();
    observer.disconnect();
    clearInterval(interval);
  });
}
