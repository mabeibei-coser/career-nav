"use client";

import { motion, AnimatePresence } from "framer-motion";

export type OrbState = "idle" | "speaking" | "recording" | "processing";

interface AiOrbProps {
  state: OrbState;
  amplitude?: number;
  size?: number;
}

const STATE_COLORS: Record<
  OrbState,
  { bg: string; c1: string; c2: string; c3: string; glow: string; halo: string }
> = {
  idle: {
    bg: "oklch(95% 0.02 250)",
    c1: "oklch(72% 0.14 250)",
    c2: "oklch(78% 0.11 230)",
    c3: "oklch(68% 0.13 265)",
    glow: "rgba(59,130,246,0.2)",
    halo: "rgba(59,130,246,0.1)",
  },
  speaking: {
    bg: "oklch(93% 0.03 250)",
    c1: "oklch(62% 0.22 250)",
    c2: "oklch(70% 0.18 225)",
    c3: "oklch(58% 0.20 268)",
    glow: "rgba(59,130,246,0.45)",
    halo: "rgba(59,130,246,0.2)",
  },
  recording: {
    bg: "oklch(93% 0.03 248)",
    c1: "oklch(60% 0.24 252)",
    c2: "oklch(68% 0.20 230)",
    c3: "oklch(55% 0.22 270)",
    glow: "rgba(59,130,246,0.5)",
    halo: "rgba(59,130,246,0.25)",
  },
  processing: {
    bg: "oklch(94% 0.02 248)",
    c1: "oklch(68% 0.12 250)",
    c2: "oklch(74% 0.10 230)",
    c3: "oklch(65% 0.11 265)",
    glow: "rgba(59,130,246,0.3)",
    halo: "rgba(59,130,246,0.12)",
  },
};

const STATE_SPEED: Record<OrbState, number> = {
  idle: 24,
  speaking: 10,
  recording: 7,
  processing: 14,
};

export function AiOrb({ state, size = 220 }: AiOrbProps) {
  const colors = STATE_COLORS[state];
  const speed = STATE_SPEED[state];

  const orbSize = Math.round(size * 0.85);

  const blurAmount = Math.max(orbSize * 0.015, 4);
  const contrastAmount = Math.max(orbSize * 0.008, 1.5);
  const dotSize = Math.max(orbSize * 0.008, 0.1);
  const shadowSpread = Math.max(orbSize * 0.008, 2);

  const haloScale: number[] =
    state === "recording" ? [1, 1.1, 1]
    : state === "speaking" ? [1, 1.1, 1]
    : [1, 1.04, 1];

  const haloDuration =
    state === "speaking" ? 2.5 : state === "recording" ? 2.0 : 5;

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* keyframes + pseudo-element styles — outside the orb div */}
      <style>{`
        @property --siri-angle {
          syntax: "<angle>";
          inherits: false;
          initial-value: 0deg;
        }
        @keyframes siri-rotate {
          to { --siri-angle: 360deg; }
        }
        @media (prefers-reduced-motion: reduce) {
          .siri-orb-inner::before { animation: none; }
        }
        .siri-orb-inner {
          position: relative;
        }
        .siri-orb-inner::before,
        .siri-orb-inner::after {
          content: "";
          display: block;
          position: absolute;
          inset: 0;
          border-radius: 50%;
        }
        .siri-orb-inner::before {
          background:
            conic-gradient(from calc(var(--siri-angle) * 2) at 25% 70%, var(--c3), transparent 20% 80%, var(--c3)),
            conic-gradient(from calc(var(--siri-angle) * 2) at 45% 75%, var(--c2), transparent 30% 60%, var(--c2)),
            conic-gradient(from calc(var(--siri-angle) * -3) at 80% 20%, var(--c1), transparent 40% 60%, var(--c1)),
            conic-gradient(from calc(var(--siri-angle) * 2) at 15% 5%, var(--c2), transparent 10% 90%, var(--c2)),
            conic-gradient(from calc(var(--siri-angle) * 1) at 20% 80%, var(--c1), transparent 10% 90%, var(--c1)),
            conic-gradient(from calc(var(--siri-angle) * -2) at 85% 10%, var(--c3), transparent 20% 80%, var(--c3));
          box-shadow: inset var(--bg) 0 0 var(--shadow-spread) calc(var(--shadow-spread) * 0.2);
          filter: blur(var(--blur-amount)) contrast(var(--contrast-amount));
          animation: siri-rotate var(--animation-duration) linear infinite;
        }
        .siri-orb-inner::after {
          background-image: radial-gradient(circle at center, var(--bg) var(--dot-size), transparent var(--dot-size));
          background-size: calc(var(--dot-size) * 2) calc(var(--dot-size) * 2);
          backdrop-filter: blur(calc(var(--blur-amount) * 2)) contrast(calc(var(--contrast-amount) * 2));
          mix-blend-mode: overlay;
          mask-image: radial-gradient(black var(--mask-radius), transparent 75%);
        }
      `}</style>

      {/* halo glow — 用 radial-gradient 代替 filter:blur 避免矩形渲染 artifact */}
      <motion.div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: orbSize + 80,
          height: orbSize + 80,
        }}
        animate={{
          background: [
            `radial-gradient(circle, ${colors.halo} 0%, transparent 70%)`,
          ],
          scale: haloScale,
        }}
        transition={{
          background: { duration: 1.2, ease: "easeInOut" },
          scale: {
            duration: haloDuration,
            repeat: Infinity,
            ease: "easeInOut",
          },
        }}
      />

      {/* siri orb sphere */}
      <motion.div
        className="siri-orb-inner absolute"
        style={
          {
            width: orbSize,
            height: orbSize,
            borderRadius: "50%",
            overflow: "hidden",
            boxShadow: `0 0 ${shadowSpread * 6}px ${colors.glow}, 0 0 ${shadowSpread * 12}px ${colors.halo}`,
            "--bg": colors.bg,
            "--c1": colors.c1,
            "--c2": colors.c2,
            "--c3": colors.c3,
            "--animation-duration": `${speed}s`,
            "--blur-amount": `${blurAmount}px`,
            "--contrast-amount": contrastAmount,
            "--dot-size": `${dotSize}px`,
            "--shadow-spread": `${shadowSpread}px`,
            "--mask-radius": "25%",
          } as React.CSSProperties
        }
        initial={{ opacity: 0, scale: 0.85 }}
        animate={{
          opacity: 1,
          scale:
            state === "recording"
              ? [1, 1.03, 1]
              : state === "speaking"
                ? [1, 1.02, 1]
                : [1, 1.01, 1],
        }}
        transition={{
          opacity: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
          scale: {
            duration: state === "recording" ? 1.8 : state === "speaking" ? 2.5 : 5,
            repeat: Infinity,
            ease: "easeInOut",
          },
        }}
      />

      {/* processing spinner ring */}
      <AnimatePresence>
        {state === "processing" && (
          <motion.div
            key="spin"
            className="absolute rounded-full pointer-events-none"
            style={{
              width: orbSize + 14,
              height: orbSize + 14,
              border: "1.5px solid transparent",
              borderTopColor: "rgba(59,130,246,0.5)",
              borderRightColor: "rgba(59,130,246,0.15)",
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, rotate: 360 }}
            exit={{ opacity: 0 }}
            transition={{
              opacity: { duration: 0.3 },
              rotate: { duration: 1.6, repeat: Infinity, ease: "linear" },
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
