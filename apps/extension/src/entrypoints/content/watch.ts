import { ulid, type BahamutWatch, type Source } from '@agm/shared';
import { mutate } from '../../lib/messages.ts';

const REPORT_INTERVAL_MS = 15_000;

export interface WatchTarget {
  animeSn: string;
  title: string;
  videoSn: string;
  episodeLabel?: string;
}

/**
 * 第一次播放時建立一筆觀看紀錄，之後定期回報進度。
 * TODO: 排除片頭廣告、年齡確認，以及重新整理／續看造成的重複紀錄（見 docs/feasibility.html 第 7 節）。
 */
export function trackWatch(source: Source, info: WatchTarget, signal: AbortSignal) {
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
    void mutate('POST', `/${source}/watch`, body, `watch:${watchId}`);
  }

  function attach(video: HTMLVideoElement) {
    if (attached.has(video)) return;
    attached.add(video);
    const onPlaying = () => {
      current = video;
      if (!watchId) {
        watchId = ulid();
        startedAt = new Date().toISOString();
        console.info(`[動畫瘋管理工具] 開始記錄觀看：${info.title} ${info.episodeLabel ?? ''}`);
      }
      report();
    };
    video.addEventListener('playing', onPlaying, { signal });
    for (const type of ['pause', 'ended', 'seeked'] as const) {
      video.addEventListener(type, () => current === video && report(), { signal });
    }
    // Netflix 進入播放頁就自動播放，查完作品資料才開始追蹤時已經錯過 playing 事件
    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) onPlaying();
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
