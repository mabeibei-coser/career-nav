/**
 * 客户端 TTS 响度归一化
 *
 * 问题：Volcano TTS 每次合成的 MP3 内置 RMS 因文本内容而异 —— 4 道访谈题
 *      逐题播放时听起来"忽大忽小"。
 *
 * 方案：解码 MP3 → 测 peak + RMS → 算出目标 gain → AudioBufferSourceNode + GainNode 播放。
 *      gain 公式：先按 TARGET_RMS / 实际RMS 估算，再用 TARGET_PEAK 限幅避免过驱削波，
 *      上限 MAX_GAIN 防止把噪声放大。
 *
 * iOS：AudioContext 默认 suspended，必须在用户手势里 `resume()`。
 *      入口在 form 提交时的 `blessAudio()`（同一用户手势）。
 */
"use client";

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!sharedCtx) {
    try {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!Ctor) return null;
      sharedCtx = new Ctor();
    } catch {
      return null;
    }
  }
  return sharedCtx;
}

/** 用户手势里调用，解锁 iOS 上的 AudioContext。重复调用安全。 */
export function ensureAudioCtxUnlocked(): void {
  const ctx = getCtx();
  if (!ctx) return;
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
}

export interface NormalizedAudio {
  buffer: AudioBuffer;
  gain: number;
}

/**
 * 解码 base64 MP3 + 计算归一化增益。
 * 失败（不支持 Web Audio / 解码失败 / AudioContext 未解锁）返回 null。
 */
export async function decodeAndNormalize(
  base64: string,
): Promise<NormalizedAudio | null> {
  const ctx = getCtx();
  if (!ctx) return null;
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      /* 用户没在手势里，无法 resume */
    }
  }
  if (ctx.state !== "running") return null;

  try {
    const bin = atob(base64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);

    // decodeAudioData 需要独立的 ArrayBuffer（不能复用，否则会 detach）
    const buffer = await ctx.decodeAudioData(arr.buffer.slice(0));

    let peak = 0;
    let sumSq = 0;
    let count = 0;
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        const abs = v < 0 ? -v : v;
        if (abs > peak) peak = abs;
        sumSq += v * v;
        count++;
      }
    }
    const rms = Math.sqrt(sumSq / Math.max(count, 1));

    // 目标响度：RMS ≈ -15dBFS（典型语音水平），峰值不超过 -0.5dBFS。
    const TARGET_RMS = 0.18;
    const TARGET_PEAK = 0.95;
    const MAX_GAIN = 4.0; // 不超过 +12dB，避免把噪声当语音放大

    let gain = 1.0;
    if (rms > 0.001 && peak > 0.001) {
      gain = TARGET_RMS / rms;
      if (peak * gain > TARGET_PEAK) {
        gain = TARGET_PEAK / peak;
      }
      gain = Math.min(gain, MAX_GAIN);
    }

    return { buffer, gain };
  } catch (e) {
    console.warn("[audio-normalizer] decode failed:", e);
    return null;
  }
}

export interface PlaybackHandle {
  stop: () => void;
}

/** 用 AudioBufferSourceNode 播放归一化后的音频。返回 stop 句柄。 */
export function playNormalized(
  audio: NormalizedAudio,
  onEnded?: () => void,
): PlaybackHandle {
  const ctx = getCtx();
  if (!ctx) {
    onEnded?.();
    return { stop: () => {} };
  }

  const source = ctx.createBufferSource();
  source.buffer = audio.buffer;

  const gainNode = ctx.createGain();
  gainNode.gain.value = audio.gain;

  source.connect(gainNode);
  gainNode.connect(ctx.destination);

  let ended = false;
  const cleanup = () => {
    try {
      source.disconnect();
    } catch {
      /* already disconnected */
    }
    try {
      gainNode.disconnect();
    } catch {
      /* already disconnected */
    }
  };

  source.onended = () => {
    if (ended) return;
    ended = true;
    cleanup();
    onEnded?.();
  };

  try {
    source.start(0);
  } catch (e) {
    console.warn("[audio-normalizer] source.start failed:", e);
    ended = true;
    cleanup();
    onEnded?.();
    return { stop: () => {} };
  }

  return {
    stop: () => {
      if (ended) return;
      ended = true;
      try {
        source.stop(0);
      } catch {
        /* already stopped */
      }
      cleanup();
      onEnded?.();
    },
  };
}
