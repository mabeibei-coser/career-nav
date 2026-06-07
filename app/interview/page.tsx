"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { SkipForward, Keyboard, Mic } from "lucide-react";
import { AiOrb, type OrbState } from "./_components/ai-orb";
import { MicButton } from "./_components/mic-button";
import { TranscriptPreview } from "./_components/transcript-preview";
import { StepIndicator } from "@/components/ui/step-indicator";
import { useAudioRecorder } from "@/lib/hooks/use-audio-recorder";
import { useAudioVisualizer } from "@/lib/hooks/use-audio-visualizer";
import { useAudioPlayer } from "@/lib/hooks/use-audio-player";
import { ensureAudioCtxUnlocked } from "@/lib/audio-normalizer";
import { playBlessedUrl, stopBlessedAudio } from "@/lib/audio-bless";
import {
  INTERVIEW_GREETING_AUDIO_SRC,
  takeHandoffAudio,
  isIOS,
} from "@/lib/intro-audio-handoff";
import { buildQ3Q4 } from "@/lib/interview-questions";
import { startAfterQ2 } from "@/lib/report-bg-runner";
import type {
  InterviewAnswer,
  InterviewQuestion,
  InterviewQ3Q4,
  JobFormData,
  QuizAnswer,
  ScoringResult,
} from "@/lib/types";

// ---------- 状态机 ----------
//
// 4 题流程：Q1 / Q2（API 动态，答案进报告）→ 触发 startAfterQ2（启动全部报告模块）
// → Q3 / Q4（题库自抽，答案不入报告，作为等待缓冲时间）→ /loading

type Phase =
  | "init"
  | "greeting"
  | "idle"
  | "requesting-mic"
  | "mic-granted"
  | "loading-q"
  | "speaking-q"
  | "ready"
  | "recording"
  | "transcribing"
  | "preview"
  | "text-input"
  | "done"
  | "error";

const TOTAL_QUESTIONS = 4;

// ---------- 工具 ----------

function canUseVoiceRecording(): boolean {
  if (typeof MediaRecorder === "undefined") return false;
  // 不再拦截微信：现代微信 WebView 已支持 MediaRecorder；
  // 若 getUserMedia 实际失败（权限/HTTP），handleRecordStart 的 catch 会降级到文字输入
  return true;
}

const GREETING_TEXT =
  "下面进入语音访谈，一共 4 个问题，请按住麦克风作答。";

// 视觉拆分：主标题（动作）+ 副标题（说明）。两行居中，避免长句换行出现孤字。
// 改这里的字面值不影响 TTS（TTS 用上方 GREETING_TEXT；若两者文意分歧，需重跑 npm run tts:cache）
const GREETING_DISPLAY = {
  primary: "下面进入语音访谈",
  secondary: "一共 4 个问题，请按住麦克风作答",
};

// 用 Q1/Q2 答案拼 raw "summary" 文本，作为 /loading 页的兜底
// Q3/Q4 答案不入报告
function buildRawAnswersSummary(answers: InterviewAnswer[]): string {
  return answers
    .filter((a) => a.questionId === "Q1" || a.questionId === "Q2")
    .map((a, i) => `第${i + 1}问（${a.questionId}）：${a.text || "（未作答）"}`)
    .join("\n\n");
}

// ---------- AudioContext 解锁（iOS 需在用户手势里初始化，否则 play() 被静默拦截） ----------

function unlockAudio() {
  try {
    // 播放一段极短静音 MP3，触发 iOS/WebKit 对 HTMLAudioElement 的授权，
    // 同时激活 Android MediaSession（防止首次播放音量偏低）。
    // 不调用 .pause()，让它自然播完（约 0.05s），确保媒体会话充分初始化。
    const a = new Audio(
      "data:audio/mp3;base64,//uQxAAAAAAAAAAAAAAAAAAAAAAAWGluZgAAAA8AAAACAAACcQCA",
    );
    a.volume = 1.0;
    a.play().catch(() => {});
  } catch {
    // 降级：忽略（非 iOS/Android 环境不影响）
  }
  // 同步确保 Web Audio AudioContext 是 running 状态 —— 响度归一化的主播放路径
  // 依赖它。`handleStart` 在用户手势里调用 `unlockAudio`，满足 iOS 的 resume 要求。
  ensureAudioCtxUnlocked();
}

// ---------- 主组件 ----------

export default function InterviewPage() {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>("init");
  const phaseRef = useRef<Phase>("init");
  const setPhaseSync = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const [currentIndex, setCurrentIndex] = useState(0); // 0..3
  const [answers, setAnswers] = useState<InterviewAnswer[]>([]);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [recognizedText, setRecognizedText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [textInput, setTextInput] = useState("");
  const [voiceSupported, setVoiceSupported] = useState(true);
  const [skipConfirm, setSkipConfirm] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  /** 问候语正在播放中（用于 UI 状态） */
  const [greetingPlaying, setGreetingPlaying] = useState(false);
  /** 问候语已播完（或超时），可显示"开始访谈"按钮 */
  const [greetingDone, setGreetingDone] = useState(false);
  /** iOS 直接访问 /interview（无 handoff）→ 显示「点击播放欢迎语」 */
  const [needsTap, setNeedsTap] = useState(false);

  // 持有 form/scoring/quizAnswers，触发 startAfterQ2 时不再读 sessionStorage
  const formDataRef = useRef<JobFormData | null>(null);
  const scoringRef = useRef<ScoringResult | null>(null);
  const quizAnswersRef = useRef<QuizAnswer[]>([]);
  const q2TriggeredRef = useRef(false);
  // questions 的最新值，给 handleStart 的轮询用（state closure 取不到最新）
  const questionsRef = useRef<InterviewQuestion[]>([]);
  // useEffect cleanup（网络监听）
  const cleanupRef = useRef<(() => void) | null>(null);

  // 录音
  const recorder = useAudioRecorder();
  const { amplitude } = useAudioVisualizer(recorder.mediaStream);

  // TTS 播放（AI 读题）
  const speakingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 当前播放的问候语 audio 元素（来自 quiz 页交接 / fallback 自播）
  const greetingAudioElemRef = useRef<HTMLAudioElement | null>(null);
  const isIOSRef = useRef(false);

  const handlePlayerEnded = useCallback(() => {
    if (phaseRef.current === "speaking-q") {
      setPhaseSync("ready");
    }
  }, [setPhaseSync]);
  const player = useAudioPlayer(handlePlayerEnded);

  // ---------- 问候语：接管 / 自播 / 重播 ----------

  // 接管 quiz 页交接来的、已在播放的 audio 元素
  const adoptGreetingAudio = useCallback((audio: HTMLAudioElement) => {
    greetingAudioElemRef.current = audio;
    setNeedsTap(false);
    const onEnd = () => {
      setGreetingPlaying(false);
      setGreetingDone(true);
    };
    audio.onended = onEnd;
    audio.onerror = onEnd;
    if (audio.ended) {
      onEnd();
    } else {
      setGreetingPlaying(true);
      // 手势栈 play() 当时被拒（element 暂停状态）→ 补一次兜底
      if (audio.paused) {
        audio.play().catch(() => {
          setGreetingPlaying(false);
          if (isIOSRef.current) setNeedsTap(true);
          else setGreetingDone(true);
        });
      }
    }
  }, []);

  // 直接 new Audio() 播问候语（fallback 路径：iOS 点击重播 / 直接访问 /interview）
  const playGreetingFresh = useCallback(() => {
    if (greetingAudioElemRef.current) {
      greetingAudioElemRef.current.pause();
      greetingAudioElemRef.current = null;
    }
    const audio = new Audio(INTERVIEW_GREETING_AUDIO_SRC);
    audio.volume = 1.0;
    audio.preload = "auto";
    // @ts-expect-error - playsInline 不在标准 d.ts 里但 iOS 支持
    audio.playsInline = true;
    greetingAudioElemRef.current = audio;
    setNeedsTap(false);
    setGreetingPlaying(true);
    const onEnd = () => {
      setGreetingPlaying(false);
      setGreetingDone(true);
    };
    audio.onended = onEnd;
    audio.onerror = onEnd;
    const p = audio.play();
    if (p && typeof p.catch === "function") {
      p.catch(() => {
        setGreetingPlaying(false);
        if (isIOSRef.current) setNeedsTap(true);
        else setGreetingDone(true);
      });
    }
  }, []);

  // ---------- 初始化：读 sessionStorage + 拉 Q1Q2 + 抽 Q3Q4 ----------

  useEffect(() => {
    let formData: JobFormData;
    let scoring: ScoringResult;
    let quizAnswers: QuizAnswer[];

    try {
      const fd = sessionStorage.getItem("formData");
      const sc = sessionStorage.getItem("scoring");
      const qa = sessionStorage.getItem("quizAnswers");
      if (!fd || !sc) {
        router.replace("/");
        return;
      }
      formData = JSON.parse(fd) as JobFormData;
      scoring = JSON.parse(sc) as ScoringResult;
      quizAnswers = qa ? (JSON.parse(qa) as QuizAnswer[]) : [];
      if (!formData?.identity) {
        router.replace("/");
        return;
      }
    } catch {
      router.replace("/");
      return;
    }

    formDataRef.current = formData;
    scoringRef.current = scoring;
    quizAnswersRef.current = quizAnswers;

    setVoiceSupported(canUseVoiceRecording());
    // 后台预编译 /loading 路由（dev 模式消除首次跳转的 "Compiling..." 等待）
    router.prefetch("/loading");

    // 网络断检测：录音过程中如果断网，能识别失败时给出提示
    if (typeof navigator !== "undefined") {
      setIsOnline(navigator.onLine);
      const onOnline = () => setIsOnline(true);
      const onOffline = () => setIsOnline(false);
      window.addEventListener("online", onOnline);
      window.addEventListener("offline", onOffline);
      // 在 effect cleanup 里移除（下面 return）
      // 把 cleanup 函数放到 fetch 之后统一返回
      // —— 这里直接在主 effect 末尾返回
      // （TS 严格模式下 effect 不允许 async return，所以保持同步流并把异步放进 IIFE）
      // 注意此 cleanup 必须包含网络监听
      cleanupRef.current = () => {
        window.removeEventListener("online", onOnline);
        window.removeEventListener("offline", onOffline);
      };
    }

    setPhaseSync("greeting");
    isIOSRef.current = isIOS();

    // 问候语自动播放：优先接管 quiz 页交接来的、已在播放的 audio 元素
    // （quiz handleSubmit 在用户手势栈里 new Audio().play() 后传过来）。
    // SPA client-side 导航不会中断已在播放的 <audio>，体感等同自动播放。
    const handoff = takeHandoffAudio();
    if (handoff) {
      adoptGreetingAudio(handoff);
    } else if (isIOSRef.current) {
      // iOS fallback：直接访问 /interview（刷新 / 分享链接）→ 显示点击引导
      setNeedsTap(true);
    } else {
      // Android：复用 form 页 bless 过的 <audio> 元素自动播放静态音频
      const played = playBlessedUrl(INTERVIEW_GREETING_AUDIO_SRC, () => {
        setGreetingPlaying(false);
        setGreetingDone(true);
      });
      if (played) {
        setGreetingPlaying(true);
      } else {
        // 没 bless 过（dev 直接访问）→ 裸 Audio 兜底
        playGreetingFresh();
      }
    }

    // 阶段 1：拉 Q1Q2（优先消费 /intro 预热结果；没有再 API 动态生成）
    (async () => {
      let q1q2: InterviewQuestion[] = [];

      // 1a) 优先消费 /intro 页预热的 Q1Q2（一次性，用后即清）
      try {
        const cached = sessionStorage.getItem("interviewQ1Q2");
        if (cached) {
          const parsed = JSON.parse(cached) as InterviewQuestion[];
          if (Array.isArray(parsed) && parsed.length === 2) {
            q1q2 = parsed;
            sessionStorage.removeItem("interviewQ1Q2");
          }
        }
      } catch {
        /* 缓存损坏，落回 fetch */
      }

      // 1b) 无预热缓存 → 现拉
      if (q1q2.length !== 2) {
        try {
          const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/interview/question`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ formData }),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as {
            questions: InterviewQuestion[];
          };
          if (!Array.isArray(data?.questions) || data.questions.length !== 2) {
            throw new Error("Q1Q2 长度不为 2");
          }
          q1q2 = data.questions;
        } catch (e) {
          console.error("[interview] fetch Q1Q2 failed:", e);
          setError("获取问题失败，请刷新重试");
          setPhaseSync("error");
          return;
        }
      }

      // 阶段 2：抽 Q3Q4（题库自抽，结果锁 sessionStorage）
      const q3q4 = buildQ3Q4(); // 已确保返回 length=2，Q3/Q4 id

      const all = [...q1q2, ...q3q4];
      questionsRef.current = all;
      setQuestions(all);

      // 持久化 Q1/Q2 题干（LLM 动态生成，否则只活在内存里），
      // finalize 时随 quizQuestions 一起入库，admin 端可追溯。
      // 不存 audioBase64，避免占爆 sessionStorage 配额。
      try {
        sessionStorage.setItem(
          "interviewQuestions",
          JSON.stringify({
            Q1: q1q2[0]?.text,
            Q2: q1q2[1]?.text,
            Q3: q3q4[0]?.text,
            Q4: q3q4[1]?.text,
          }),
        );
      } catch {
        /* 配额满 / 隐私模式 → 静默降级 */
      }

      // 后台预合成 Q3Q4 语音（Q1Q2 已在服务端合成并随 /question 返回）
      // 失败静默降级，不影响主流程
      const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
      void Promise.allSettled([
        fetch(`${BASE_PATH}/api/interview/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: q3q4[0].text }),
        }).then((r) => r.json() as Promise<{ audioBase64: string }>),
        fetch(`${BASE_PATH}/api/interview/tts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: q3q4[1].text }),
        }).then((r) => r.json() as Promise<{ audioBase64: string }>),
      ]).then((results) => {
        const updated = [...questionsRef.current];
        results.forEach((r, i) => {
          if (r.status === "fulfilled" && r.value?.audioBase64) {
            updated[2 + i] = { ...updated[2 + i], audioBase64: r.value.audioBase64 };
          }
        });
        questionsRef.current = updated;
        setQuestions([...updated]);
      });
    })();

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // ---------- 当前题 ----------

  const currentQ: InterviewQuestion | null =
    questions[currentIndex] ?? null;

  // ---------- 朗读题目（或静默跳过） ----------

  const presentQuestion = useCallback(
    (q: InterviewQuestion | undefined) => {
      if (!q) return;
      // 清理上一轮超时（防止残留）
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = null;
      }
      if (q.audioBase64) {
        setPhaseSync("speaking-q");
        player.play(q.audioBase64);
        // 15s 安全超时：防止音频卡住无法答题
        speakingTimeoutRef.current = setTimeout(() => {
          player.stop();
          if (phaseRef.current === "speaking-q") {
            setPhaseSync("ready");
          }
        }, 15_000);
      } else {
        // 无语音（TTS 失败或未返回）→ 直接进入可作答状态
        setPhaseSync("ready");
      }
    },
    [player, setPhaseSync],
  );

  // ---------- 问候语兜底：音频卡住或 fallback 时强制显示「开始访谈」按钮 ----------
  // - 正在播：15s（典型 ~5s 一句话，留余量）
  // - 未播：5s 兜底（iOS 待点击 / Android 自动播失败 / e2e mock 等场景）
  useEffect(() => {
    if (phase !== "greeting" || greetingDone) return;
    const ms = greetingPlaying ? 15_000 : 5000;
    const timer = setTimeout(() => setGreetingDone(true), ms);
    return () => clearTimeout(timer);
  }, [phase, greetingDone, greetingPlaying]);

  // ---------- 进入下一题 ----------

  const advanceTo = useCallback(
    (nextIndex: number) => {
      if (nextIndex >= TOTAL_QUESTIONS) {
        // Q4 答完 → 跳 loading
        setPhaseSync("done");
        router.push("/loading");
        return;
      }
      setCurrentIndex(nextIndex);
      presentQuestion(questionsRef.current[nextIndex]);
    },
    [router, setPhaseSync, presentQuestion],
  );

  // ---------- 开始访谈：从 greeting 进入 Q1 ----------

  const [debugLog, setDebugLog] = useState<string[]>([]);
  const addDebug = useCallback((msg: string) => {
    setDebugLog((prev) => [...prev.slice(-6), msg]);
  }, []);

  const proceedToQ1 = useCallback(() => {
    if (questionsRef.current.length < TOTAL_QUESTIONS) {
      setPhaseSync("loading-q");
      return;
    }
    setCurrentIndex(0);
    presentQuestion(questionsRef.current[0]);
  }, [setPhaseSync, presentQuestion]);

  const handleStart = useCallback(() => {
    if (phaseRef.current !== "greeting" && phaseRef.current !== "idle") return;
    addDebug("handleStart 触发");
    // 问候语已在 mount 时自动播放（quiz 页交接 / Android 自动 / iOS fallback 点击播）
    // 这里点击 = 用户手势，可以同步停掉问候语 + 解锁 AudioContext 给 player.play 用
    player.stop();
    stopBlessedAudio();
    if (greetingAudioElemRef.current) {
      greetingAudioElemRef.current.pause();
      greetingAudioElemRef.current = null;
    }
    setGreetingPlaying(false);
    unlockAudio();

    if (!navigator.mediaDevices?.getUserMedia) {
      addDebug("mediaDevices 不可用");
      setVoiceSupported(false);
      proceedToQ1();
      return;
    }
    setPhaseSync("requesting-mic");
    addDebug("getUserMedia 调用中...");
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then(
        (stream) => {
          addDebug("getUserMedia 成功 ✓");
          recorder.adoptStream(stream);
          setPhaseSync("mic-granted");
          return new Promise<void>((r) => setTimeout(r, 600));
        },
        (err) => {
          addDebug("getUserMedia 失败: " + (err?.name || "unknown"));
          setVoiceSupported(false);
        },
      )
      .then(() => {
        addDebug("进入题目");
        proceedToQ1();
      });
  }, [recorder, proceedToQ1, setPhaseSync, addDebug, player]);

  // iOS fallback: 用户首次点击 orb / 点击播放欢迎语按钮
  const handleGreetingTap = useCallback(() => {
    if (greetingPlaying) return;
    playGreetingFresh();
  }, [greetingPlaying, playGreetingFresh]);

  // 题目就绪后，如果当前还在 loading-q，自动朗读第一题
  useEffect(() => {
    if (
      phaseRef.current === "loading-q" &&
      questions.length === TOTAL_QUESTIONS
    ) {
      setCurrentIndex(0);
      presentQuestion(questionsRef.current[0]);
    }
  }, [questions.length, presentQuestion]);

  // ---------- 清理（组件卸载时停止语音 + 超时） ----------

  useEffect(() => {
    return () => {
      if (speakingTimeoutRef.current) {
        clearTimeout(speakingTimeoutRef.current);
        speakingTimeoutRef.current = null;
      }
      // 卸载时停掉问候语，避免离开页面后还在播
      stopBlessedAudio();
      if (greetingAudioElemRef.current) {
        greetingAudioElemRef.current.pause();
        greetingAudioElemRef.current = null;
      }
    };
  }, []);

  // ---------- 录音 ----------

  const handleRecordStart = useCallback(async () => {
    addDebug("录音 start(requirePrimed)");
    try {
      await recorder.start(true);
      setPhaseSync("recording");
    } catch (e) {
      addDebug("录音失败: " + (e instanceof Error ? e.message : "unknown"));
      setVoiceSupported(false);
      setPhaseSync("text-input");
    }
  }, [recorder, setPhaseSync, addDebug]);

  const handleRecordStop = useCallback(async () => {
    setPhaseSync("transcribing");
    let recognized = "";
    try {
      const result = await recorder.stop();
      if (result.blob.size < 3000 || result.durationSec < 1) {
        recognized = "";
      } else if (!navigator.onLine) {
        // 录音中断网，给出明确提示，不发请求
        recognized = "";
        setError("网络断开，已保留录音内容，请改用文字输入或检查网络后重试");
      } else {
        const formData = new FormData();
        formData.append("audio", result.blob, "recording");
        formData.append("mimeType", result.mimeType);
        const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_PATH ?? ""}/api/interview/transcribe`, {
          method: "POST",
          body: formData,
        });
        const data = (await res.json()) as { text: string };
        recognized = data.text ?? "";
      }
    } catch (e) {
      console.error("transcribe error:", e);
      recognized = "";
    }
    setRecognizedText(recognized);
    setPhaseSync("preview");
  }, [recorder, setPhaseSync]);

  const handleRecordCancel = useCallback(() => {
    recorder.cancel();
    setPhaseSync("ready");
  }, [recorder, setPhaseSync]);

  // ---------- 切换文字 ----------

  const handleSwitchToText = useCallback(() => {
    recorder.cancel();
    setTextInput("");
    setPhaseSync("text-input");
  }, [recorder, setPhaseSync]);

  // ---------- 跳过整段访谈 ----------

  const handleSkip = useCallback(() => {
    // 兼容 loading 页 sessionStorage.getItem("interviewData") 的 summary 字段
    sessionStorage.setItem(
      "interviewData",
      JSON.stringify({
        summary: "",
        skipped: true,
        generatedAt: new Date().toISOString(),
      }),
    );
    router.push("/loading");
  }, [router]);

  // ---------- 触发后台 startAfterQ2（Q2 答完，携带 Q1+Q2 启动全部报告模块） ----------

  const triggerAfterQ2 = useCallback(
    (q1Text: string, q2Text: string) => {
      if (q2TriggeredRef.current) return;
      const formData = formDataRef.current;
      const scoring = scoringRef.current;
      if (!formData || !scoring) return;

      const interviewQ1Q2 = {
        Q1: q1Text || undefined,
        Q2: q2Text || undefined,
      };
      try {
        // 持久化到 sessionStorage，供 loading 页 consumeAll 现场 fetch 时使用
        sessionStorage.setItem(
          "interviewQ1Q2",
          JSON.stringify(interviewQ1Q2),
        );
      } catch {
        // 隐私模式 / 配额满：忽略
      }

      try {
        startAfterQ2({
          formData,
          quizAnswers: quizAnswersRef.current,
          scoring,
          interviewQ1Q2,
        });
        q2TriggeredRef.current = true;
      } catch (e) {
        console.warn("[interview] startAfterQ2 failed (ignored):", e);
      }
    },
    // 全部依赖都是 ref，不需要在数组里
    [],
  );

  // ---------- 完成 4 题 ----------

  const finishAndGo = useCallback(
    (allAnswers: InterviewAnswer[]) => {
      const fallbackSummary = buildRawAnswersSummary(allAnswers);
      // 兼容 loading 页：保留 interviewData.summary
      sessionStorage.setItem(
        "interviewData",
        JSON.stringify({
          summary: fallbackSummary,
          skipped: false,
          generatedAt: new Date().toISOString(),
        }),
      );
      // 持久化 Q3/Q4 答案（固定题库占位题）——独立 key，绝不并进 interviewQ1Q2。
      // 后者会喂进报告生成；Q3/Q4 仅供后台档案留痕，不入报告。
      try {
        const q3 = allAnswers.find((a) => a.questionId === "Q3")?.text?.trim();
        const q4 = allAnswers.find((a) => a.questionId === "Q4")?.text?.trim();
        const q3q4: InterviewQ3Q4 = {};
        if (q3) q3q4.Q3 = q3;
        if (q4) q3q4.Q4 = q4;
        if (q3q4.Q3 || q3q4.Q4) {
          sessionStorage.setItem("interviewQ3Q4", JSON.stringify(q3q4));
        }
      } catch {
        /* 配额满 / 隐私模式 → 静默降级 */
      }
      setPhaseSync("done");
      router.push("/loading");
    },
    [router, setPhaseSync],
  );

  // ---------- 确认答案 ----------

  const handleConfirm = useCallback(
    async (finalText: string) => {
      if (!currentQ) return;
      const inputMethod: "voice" | "text" =
        phaseRef.current === "text-input" ? "text" : "voice";
      const ans: InterviewAnswer = {
        questionId: currentQ.id,
        text: finalText,
        inputMethod,
        audioDurationSec:
          inputMethod === "voice" ? recorder.durationSec : undefined,
      };
      const newAnswers = [...answers, ans];
      setAnswers(newAnswers);
      setRecognizedText("");
      setTextInput("");

      // Q2 答完（即 currentIndex==1 答完）→ 触发 startAfterQ2，携带 Q1+Q2 启动全部报告模块
      if (currentIndex === 1) {
        const q1Text =
          newAnswers.find((a) => a.questionId === "Q1")?.text ?? "";
        const q2Text = finalText; // 当前确认的 Q2 答案
        triggerAfterQ2(q1Text, q2Text);
      }

      const nextIndex = currentIndex + 1;
      if (nextIndex >= TOTAL_QUESTIONS) {
        // Q4 答完 → 跳 loading
        finishAndGo(newAnswers);
      } else {
        advanceTo(nextIndex);
      }
    },
    [
      currentQ,
      currentIndex,
      answers,
      recorder.durationSec,
      triggerAfterQ2,
      advanceTo,
      finishAndGo,
    ],
  );

  const handleRetryFromPreview = useCallback(() => {
    if (voiceSupported && phaseRef.current !== "text-input") {
      setPhaseSync("ready");
    } else {
      setTextInput("");
    }
  }, [voiceSupported, setPhaseSync]);

  // ---------- Orb 状态 ----------

  const orbState: OrbState = (() => {
    if (phase === "recording") return "recording";
    if (phase === "loading-q" || phase === "transcribing" || phase === "speaking-q")
      return "processing";
    return "idle";
  })();

  const questionText = currentQ?.text ?? "";

  // ---------- render ----------

  return (
    <div className="min-h-screen flex flex-col bg-gradient-to-br from-[var(--blue-50)] via-white to-[var(--blue-100)]">
      {/* 顶部导航 + Stepper */}
      <div className="relative z-10 px-4 sm:px-6 pt-5 pb-3 border-b border-[var(--blue-100)] bg-white/70 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between mb-3">
            <button
              className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--navy-800)] transition-colors"
              onClick={() => setSkipConfirm(true)}
            >
              <SkipForward size={13} />
              跳过访谈
            </button>
            {voiceSupported &&
              (phase === "ready" || phase === "text-input") && (
                <button
                  className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--navy-800)] transition-colors"
                  onClick={
                    phase === "text-input"
                      ? () => setPhaseSync("ready")
                      : handleSwitchToText
                  }
                >
                  {phase === "text-input" ? <Mic size={13} /> : <Keyboard size={13} />}
                  {phase === "text-input" ? "改为语音" : "改为文字"}
                </button>
              )}
          </div>
          <StepIndicator currentStep={1} compact />
          {!isOnline && (
            <div className="mt-2 text-[11px] text-amber-600 text-center">
              当前离线 · 录音需要联网识别，建议改为文字输入
            </div>
          )}
        </div>
      </div>

      {/* 主舞台：Orb 中心 + 题面 + Mic */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-8 gap-6">
        {/* Orb */}
        <motion.div
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 220, damping: 22, delay: 0.05 }}
        >
          <AiOrb state={orbState} amplitude={amplitude} />
        </motion.div>

        {/* 文案区 */}
        <div className="w-full max-w-md min-h-[100px] flex flex-col items-center justify-start">
          <AnimatePresence mode="wait">
            {(phase === "init" || phase === "greeting" || phase === "idle" || phase === "requesting-mic" || phase === "mic-granted") && (
              <motion.div
                key="greeting"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="text-center px-4"
              >
                <p className="text-[17px] font-medium text-[var(--navy-900)] tracking-wide leading-[1.5]">
                  {GREETING_DISPLAY.primary}
                </p>
                <p className="mt-2 text-[13px] text-[var(--navy-600)] leading-[1.5] tracking-[0.02em]">
                  {GREETING_DISPLAY.secondary}
                </p>
              </motion.div>
            )}

            {phase === "loading-q" && (
              <motion.div
                key="loading-q"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-sm text-[var(--muted-foreground)]"
              >
                AI 思考中...
              </motion.div>
            )}

            {(phase === "ready" ||
              phase === "recording" ||
              phase === "transcribing" ||
              phase === "speaking-q") &&
              questionText && (
                <motion.div
                  key={`q-${currentIndex}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="w-full"
                >
                  <div
                    className="glass-card px-5 py-4 rounded-2xl text-[15px] leading-[1.7] text-[var(--navy-900)]"
                  >
                    <div className="text-[10px] tracking-[0.2em] text-blue-500 font-semibold uppercase mb-2">
                      第 {currentIndex + 1} / {TOTAL_QUESTIONS} 题
                    </div>
                    {questionText}
                  </div>
                </motion.div>
              )}

            {(phase === "preview" || phase === "text-input") && (
              <motion.div
                key="preview"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="w-full"
              >
                <TranscriptPreview
                  text={phase === "preview" ? recognizedText : textInput}
                  onConfirm={handleConfirm}
                  onRetry={handleRetryFromPreview}
                  retryLabel={phase === "preview" ? "重新录音" : "清空重写"}
                />
              </motion.div>
            )}

            {phase === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center"
              >
                <p className="text-red-500 text-sm">{error}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 底部行动区 */}
        <div className="w-full flex flex-col items-center gap-2 min-h-[100px]">
          <AnimatePresence mode="wait">
            {(phase === "greeting" || phase === "idle") && (
              greetingPlaying ? (
                <motion.div
                  key="greeting-playing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[13px] text-slate-400 animate-pulse"
                >
                  AI 正在介绍，请稍候…
                </motion.div>
              ) : greetingDone ? (
                <motion.button
                  key="start-btn"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  onClick={handleStart}
                  onTouchStart={(e) => { e.preventDefault(); handleStart(); }}
                  className="w-full max-w-md h-12 text-base font-medium bg-gradient-to-br from-[var(--blue-500)] to-[var(--blue-700)] hover:brightness-110 active:brightness-95 text-white rounded-xl btn-glow transition-all duration-300"
                >
                  开始访谈
                </motion.button>
              ) : needsTap ? (
                <motion.button
                  key="play-greeting-btn"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  onClick={handleGreetingTap}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-white/90 border border-[var(--blue-200)] text-[13px] font-medium text-[var(--blue-700)] shadow-sm"
                  aria-label="点击播放欢迎语"
                >
                  <svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  点击播放欢迎语
                </motion.button>
              ) : (
                <motion.div
                  key="greeting-preparing"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[13px] text-slate-400 animate-pulse"
                >
                  AI 正在准备…
                </motion.div>
              )
            )}

            {phase === "requesting-mic" && (
              <motion.div
                key="requesting-mic"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[13px] text-slate-400 animate-pulse"
              >
                请允许麦克风权限...
              </motion.div>
            )}

            {phase === "mic-granted" && (
              <motion.div
                key="mic-granted"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[13px] text-green-500"
              >
                麦克风已就绪 ✓
              </motion.div>
            )}

            {phase === "loading-q" && (
              <motion.div
                key="hint"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs text-slate-400"
              >
                正在准备问题...
              </motion.div>
            )}

            {phase === "speaking-q" && (
              <motion.div
                key="speaking"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs text-slate-400 animate-pulse"
              >
                AI 正在读题，稍后即可回答...
              </motion.div>
            )}

            {(phase === "ready" || phase === "recording") &&
              voiceSupported && (
                <motion.div
                  key="mic"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center gap-1.5"
                >
                  <MicButton
                    onRecordStart={handleRecordStart}
                    onRecordStop={handleRecordStop}
                    onRecordCancel={handleRecordCancel}
                    isRecording={phase === "recording"}
                    durationSec={recorder.durationSec}
                  />
                  <p className="text-[11px] text-slate-400">
                    {phase === "recording"
                      ? "按住说话 · 松开识别 · 上滑取消"
                      : "按住麦克风开始回答"}
                  </p>
                </motion.div>
              )}

            {phase === "ready" && !voiceSupported && (
              <motion.button
                key="text-only-btn"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="px-7 py-3 bg-blue-600 text-white rounded-full text-sm font-medium shadow-md min-h-[44px]"
                onClick={handleSwitchToText}
              >
                文字输入
              </motion.button>
            )}

            {phase === "transcribing" && (
              <motion.div
                key="trans"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-xs text-slate-400 animate-pulse"
              >
                识别中，请稍候...
              </motion.div>
            )}

            {(phase === "preview" || phase === "text-input") && (
              <motion.div
                key="prev-bottom"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="text-[11px] text-slate-400"
              >
                修改后点「确认提交」进入下一题 · 第 {currentIndex + 1} /{" "}
                {TOTAL_QUESTIONS} 题
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* 跳过弹窗 */}
      <AnimatePresence>
        {skipConfirm && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
            onClick={() => setSkipConfirm(false)}
          >
            <motion.div
              initial={{ scale: 0.92, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.92, opacity: 0 }}
              className="bg-white rounded-2xl p-6 max-w-xs w-full shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-base font-semibold text-slate-800 mb-2">
                跳过 AI 访谈？
              </h3>
              <p className="text-sm text-slate-500 mb-5">
                访谈内容可以让报告更个性化，跳过后将直接生成报告。
              </p>
              <div className="flex gap-3">
                <button
                  className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50"
                  onClick={() => setSkipConfirm(false)}
                >
                  继续访谈
                </button>
                <button
                  className="flex-1 py-2.5 bg-slate-800 text-white rounded-xl text-sm font-medium hover:bg-slate-900"
                  onClick={handleSkip}
                >
                  跳过
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
