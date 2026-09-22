import { requestSpeech } from "./volc-tts-provider.mjs";
const DEFAULT_SPEAKER = "zh_female_vv_uranus_bigtts";

/**
 * Synthesize text to speech using Volcano BigTTS.
 * @returns base64-encoded MP3 string, or "" if synthesis fails
 */
export async function synthesizeTTS(text: string): Promise<string> {
  // Q3/Q4 也会单独请求 TTS；端到端 mock 测试不得调用付费语音服务。
  if (process.env.E2E_MOCK_MODE === "true") return "";

  const appKey = process.env.VOLC_TTS_APP_KEY;
  const accessKey = process.env.VOLC_TTS_ACCESS_KEY;

  if (!appKey) throw new Error("VOLC_TTS_APP_KEY is not set");
  if (!accessKey) throw new Error("VOLC_TTS_ACCESS_KEY is not set");

  const speaker =
    process.env.VOLC_TTS_SPEAKER ?? DEFAULT_SPEAKER;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const audio = await requestSpeech(text, {
      appKey,
      accessKey,
      speaker,
      signal: controller.signal,
    });
    return audio.toString("base64");
  } catch (err) {
    console.error("[volc-tts] request failed:", err);
    return "";
  } finally {
    clearTimeout(timeout);
  }
}
