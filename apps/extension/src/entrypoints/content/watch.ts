import { ulid, type BahamutWatch, type Source } from '@agm/shared';
import { mutate } from '../../lib/messages.ts';

const REPORT_INTERVAL_MS = 15_000;
/** 沒有 seek 卻往回跳這麼多秒，視為播放器換了一集 */
const SOURCE_CHANGE_JUMP_SEC = 30;
/** 開始記錄後這段時間內往回跳，視為這一集才真正開始（網址比播放器先換到下一集） */
const START_GRACE_MS = 60_000;

export interface WatchTarget {
  animeSn: string;
  title: string;
  videoSn: string;
  episodeLabel?: string;
}

/**
 * 開始播放時建立一筆觀看紀錄，之後定期回報進度。
 * Netflix 換下一集時是同一個 <video> 無縫接續（不會再觸發 playing），所以也用 timeupdate 判斷開始播放；
 * isCurrent 回傳 false（網址已換成別集）或播放位置無故往回跳時，停止更新這一集的進度。
 * TODO: 排除片頭廣告、年齡確認，以及重新整理／續看造成的重複紀錄（見 docs/feasibility.html 第 7 節）。
 */
export function trackWatch(
  source: Source,
  info: WatchTarget,
  signal: AbortSignal,
  isCurrent: () => boolean = () => true,
) {
  let watchId: string | undefined;
  let startedAt = '';
  let startedMs = 0;
  let current: HTMLVideoElement | undefined;
  /** 最後一次屬於這一集的播放位置；回報時用這個，不重新讀播放器 */
  let position = { time: 0, duration: 0 };
  let seeking = false;
  /** 播放器已換到別集，不再更新這一集 */
  let switched = false;
  const attached = new WeakSet<HTMLVideoElement>();

  function report() {
    if (!watchId) return;
    const body: BahamutWatch = {
      id: watchId,
      animeSn: info.animeSn,
      animeTitle: info.title,
      videoSn: info.videoSn,
      episodeLabel: info.episodeLabel,
      startedAt,
      at: new Date().toISOString(),
      progressSec: Math.floor(position.time),
      durationSec: Math.floor(position.duration),
    };
    void mutate('POST', `/${source}/watch`, body, `watch:${watchId}`);
  }

  /** 讀取播放位置；換集後回傳 false */
  function sample(video: HTMLVideoElement) {
    if (switched || !isCurrent()) return false;
    const time = video.currentTime || 0;
    const jumpedBack = !seeking && watchId && current === video && time < position.time - SOURCE_CHANGE_JUMP_SEC;
    if (jumpedBack && Date.now() - startedMs > START_GRACE_MS) {
      switched = true;
      return false;
    }
    position = { time, duration: Number.isFinite(video.duration) ? video.duration : position.duration };
    return true;
  }

  function start(video: HTMLVideoElement) {
    if (!sample(video)) return;
    current = video;
    if (!watchId) {
      watchId = ulid();
      startedMs = Date.now();
      startedAt = new Date(startedMs).toISOString();
      console.info(`[動畫瘋管理工具] 開始記錄觀看：${info.title} ${info.episodeLabel ?? ''}`);
    }
    report();
  }

  function attach(video: HTMLVideoElement) {
    if (attached.has(video)) return;
    attached.add(video);
    video.addEventListener('playing', () => start(video), { signal });
    video.addEventListener(
      'timeupdate',
      () => {
        if (!watchId && !video.paused) start(video);
        else if (current === video) sample(video);
      },
      { signal },
    );
    video.addEventListener('seeking', () => (seeking = true), { signal });
    for (const type of ['pause', 'ended', 'seeked'] as const) {
      video.addEventListener(
        type,
        () => {
          if (current === video && sample(video)) report();
          if (type === 'seeked') seeking = false;
        },
        { signal },
      );
    }
    // Netflix 進入播放頁就自動播放，查完作品資料才開始追蹤時已經錯過 playing 事件
    if (!video.paused && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) start(video);
  }

  // 播放器的 <video> 由頁面 JS 動態建立
  const scan = () => document.querySelectorAll('video').forEach(attach);
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
  scan();

  const interval = setInterval(() => {
    if (current && !current.paused && sample(current)) report();
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
