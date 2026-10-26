import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BahamutWatch } from '@agm/shared';

const sent: BahamutWatch[] = [];
vi.mock('../src/lib/messages.ts', () => ({
  mutate: vi.fn((_m: string, _p: string, body: BahamutWatch) => {
    sent.push(body);
    return Promise.resolve({ queued: true });
  }),
}));

const { trackWatch } = await import('../src/entrypoints/content/watch.ts');

/** happy-dom 的 <video> 不會播放，手動設定狀態並發出事件 */
function fakeVideo() {
  const video = document.createElement('video');
  const state = { time: 0, paused: true, duration: 1452 };
  Object.defineProperty(video, 'currentTime', { get: () => state.time });
  Object.defineProperty(video, 'paused', { get: () => state.paused });
  Object.defineProperty(video, 'duration', { get: () => state.duration });
  document.body.append(video);
  return {
    video,
    play(time: number) {
      state.paused = false;
      state.time = time;
      video.dispatchEvent(new Event('timeupdate'));
    },
  };
}

const ep = (n: number) => ({ animeSn: '81000001', title: '藥師少女的獨語', videoSn: String(n), episodeLabel: `第 2 季第 ${n} 集` });
const lastOf = (videoSn: string) => sent.filter((b) => b.videoSn === videoSn).at(-1);

beforeEach(() => {
  sent.length = 0;
  document.body.innerHTML = '';
});

describe('trackWatch', () => {
  it('沒有 playing 事件，只有 timeupdate 也會開始記錄', () => {
    const { play } = fakeVideo();
    trackWatch('netflix', ep(43), new AbortController().signal);
    play(5);
    expect(lastOf('43')).toMatchObject({ progressSec: 5, durationSec: 1452 });
  });

  it('同一個 <video> 無縫接續下一集：舊集保留換集前的進度，新集另外記錄', () => {
    let url = '43';
    const { play } = fakeVideo();
    const page43 = new AbortController();
    trackWatch('netflix', ep(43), page43.signal, () => url === '43');
    play(10);
    play(1350);

    // 網址先換到第 44 集，播放器也從頭開始
    url = '44';
    play(3);
    const page44 = new AbortController();
    trackWatch('netflix', ep(44), page44.signal, () => url === '44');
    play(8);
    page43.abort();

    expect(lastOf('43')!.progressSec).toBe(1350);
    expect(lastOf('44')!.progressSec).toBe(8);
    expect(lastOf('43')!.id).not.toBe(lastOf('44')!.id);
  });

  it('播放器比網址先換集時，往回跳就停止更新舊集', () => {
    const { play } = fakeVideo();
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(Date.parse('2026-10-26T13:00:00Z'));
    const page = new AbortController();
    trackWatch('netflix', ep(43), page.signal);
    play(1350);
    now.mockReturnValue(Date.parse('2026-10-26T13:23:00Z'));
    play(2);
    page.abort();
    expect(sent.filter((b) => b.videoSn === '43')).toHaveLength(2);
    expect(lastOf('43')!.progressSec).toBe(1350);
    now.mockRestore();
  });
});
