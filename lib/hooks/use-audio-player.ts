'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseAudioPlayerReturn {
  play: (audioBase64: string) => void;
  stop: () => void;
  isPlaying: boolean;
}

export function useAudioPlayer(onEnded?: () => void): UseAudioPlayerReturn {
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const onEndedRef = useRef(onEnded);

  // keep ref in sync without re-creating play/stop
  useEffect(() => {
    onEndedRef.current = onEnded;
  }, [onEnded]);

  const stop = useCallback(() => {
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
        /^https?:/i.test(audioSrc) ||   // http:// or https://
        /^\/[a-zA-Z0-9]/.test(audioSrc); // /api/... or /audio/... (not // prefix)
      const src = isUrl ? audioSrc : "data:audio/mp3;base64," + audioSrc;
      const audio = new Audio(src);

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
    },
    [stop],
  );

  // cleanup on unmount
  useEffect(() => {
    return () => {
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
