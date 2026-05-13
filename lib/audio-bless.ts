/**
 * iOS Safari 音频解锁 + 跨段响度归一化
 *
 * - `blessAudio()`：在用户手势里调用（form 提交），同时解锁 HTMLAudioElement（兜底用）
 *   和 Web Audio AudioContext（归一化主路径）。
 * - `playWithBlessedAudio()`：优先走 Web Audio API 做响度归一化，失败时降级到 blessed
 *   `<audio>` 元素裸播。
 */
import {
  decodeAndNormalize,
  ensureAudioCtxUnlocked,
  playNormalized,
  startSilenceKeepAlive,
  stopSilenceKeepAlive,
  type PlaybackHandle,
} from "./audio-normalizer";

let blessedAudio: HTMLAudioElement | null = null;
let currentHandle: PlaybackHandle | null = null;
let currentFallbackOnEnded: (() => void) | null = null;

// Call in a user gesture handler (e.g. form submit) to "bless" an Audio instance
// AND unlock the shared AudioContext. iOS Safari allows subsequent play() / Web
// Audio calls without further gestures once unlocked here.
export function blessAudio() {
  if (typeof window === "undefined") return;
  const a = new Audio(
    "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAACcQCA",
  );
  a.volume = 1.0;
  a.play().catch(() => {});
  blessedAudio = a;

  // 同步解锁 Web Audio AudioContext（响度归一化的主播放路径）
  ensureAudioCtxUnlocked();

  // iOS Safari: 用静音 buffer 保持 AudioContext 活跃，
  // 防止 preparing 页 12s 动画期间被系统挂起
  startSilenceKeepAlive();
}

// 用归一化路径播放 TTS base64。失败时降级到 blessed `<audio>` 裸播。
// 返回 true 表示已派发播放任务（可能仍在异步解码中）。
export function playWithBlessedAudio(
  base64: string,
  onEnded?: () => void,
): boolean {
  if (typeof window === "undefined") return false;

  // 停掉上一个播放（无论是哪条路径）
  stopBlessedAudio();

  // 优先走 Web Audio API 归一化路径
  decodeAndNormalize(base64)
    .then((normalized) => {
      if (normalized) {
        currentHandle = playNormalized(normalized, () => {
          currentHandle = null;
          onEnded?.();
        });
      } else {
        playBlessedFallback(base64, onEnded);
      }
    })
    .catch(() => {
      playBlessedFallback(base64, onEnded);
    });

  return true;
}

function playBlessedFallback(base64: string, onEnded?: () => void) {
  // 走 fallback 说明 Web Audio 路径失败，停掉 keep-alive 释放资源
  stopSilenceKeepAlive();

  if (!blessedAudio) {
    onEnded?.();
    return;
  }
  const a = blessedAudio;
  a.pause();
  a.currentTime = 0;
  currentFallbackOnEnded = () => {
    currentFallbackOnEnded = null;
    onEnded?.();
  };
  a.onended = () => currentFallbackOnEnded?.();
  a.onerror = () => currentFallbackOnEnded?.();
  a.src = "data:audio/mp3;base64," + base64;
  a.volume = 1.0;
  a.play().catch(() => currentFallbackOnEnded?.());
}

export function stopBlessedAudio() {
  stopSilenceKeepAlive();
  if (currentHandle) {
    currentHandle.stop();
    currentHandle = null;
  }
  if (blessedAudio) {
    blessedAudio.pause();
    blessedAudio.currentTime = 0;
    blessedAudio.onended = null;
    blessedAudio.onerror = null;
  }
  currentFallbackOnEnded = null;
}
