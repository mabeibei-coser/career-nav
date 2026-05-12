'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  decodeAndNormalize,
  playNormalized,
  type PlaybackHandle,
} from '@/lib/audio-normalizer';

interface UseAudioPlayerReturn {
  play: (audioBase64: string) => void;
  stop: () => void;
  isPlaying: boolean;
}

export function useAudioPlayer(onEnded?: () => void): UseAudioPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  // Web Audio API 归一化播放句柄（主路径）
  const handleRef = useRef<PlaybackHandle | null>(null);
  // HTMLAudioElement 降级（URL 输入 / decodeAudioData 失败）
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const stop = useCallback(() => {
    if (handleRef.current) {
      handleRef.current.stop();
      handleRef.current = null;
    }
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audio.onended = null;
      audio.onerror = null;
    }
    audioRef.current = null;
    setIsPlaying(false);
  }, []);

  const play = useCallback(
    (audioSrc: string) => {
      // stop any existing playback first
      stop();

      // Accept either: full URL ("http...", or relative path starting with /api/ etc),
      // or raw base64 from Volcano TTS.
      //
      // ⚠️ Bug guard: Volcano TTS base64 output often starts with "//" (e.g. "//uQxAA...")
      // because MP3 sync bytes 0xFF 0xFB base64-encode to "//". A naive startsWith("/")
      // check would misidentify this as a protocol-relative URL and fail silently.
      // Fix: treat only "/letter-or-digit" paths as URLs; anything else is raw base64.
      const isUrl =
        /^https?:/i.test(audioSrc) || // http:// or https://
        /^\/[a-zA-Z0-9]/.test(audioSrc); // /api/... or /audio/... (not // prefix)

      if (isUrl) {
        playWithFallback(audioSrc);
        return;
      }

      // Base64：先尝试 Web Audio API 归一化播放。失败（不支持 Web Audio /
      // AudioContext 未解锁 / 解码失败）则降级到 <audio> 元素裸播。
      setIsPlaying(true);
      decodeAndNormalize(audioSrc)
        .then((normalized) => {
          if (!normalized) {
            playWithFallback("data:audio/mp3;base64," + audioSrc);
            return;
          }
          handleRef.current = playNormalized(normalized, () => {
            handleRef.current = null;
            setIsPlaying(false);
            onEndedRef.current?.();
          });
        })
        .catch(() => {
          playWithFallback("data:audio/mp3;base64," + audioSrc);
        });

      function playWithFallback(src: string) {
        const audio = new Audio(src);
        audio.volume = 1.0; // 显式 100% 音量；归一化路径走 Web Audio gain，此处只做兜底

        audio.onended = () => {
          setIsPlaying(false);
          audioRef.current = null;
          onEndedRef.current?.();
        };
        audio.onerror = () => {
          setIsPlaying(false);
          audioRef.current = null;
          onEndedRef.current?.();
        };

        audioRef.current = audio;
        setIsPlaying(true);
        audio.play().catch(() => {
          setIsPlaying(false);
          audioRef.current = null;
          onEndedRef.current?.();
        });
      }
    },
    [stop],
  );

  // cleanup on unmount
  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.onended = null;
        audio.onerror = null;
        audioRef.current = null;
      }
    };
  }, []);

  return { play, stop, isPlaying };
}
