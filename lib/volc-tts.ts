import { randomUUID } from "crypto";

const TTS_URL = "https://openspeech.bytedance.com/api/v1/tts";
const RESOURCE_ID = "volc.service_type.10029";
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
    const res = await fetch(TTS_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        // /api/v1/tts 使用 Bearer;token，X-Api-* 不能替代此鉴权头。
        Authorization: `Bearer;${accessKey}`,
        "X-Api-App-Key": appKey,
        "X-Api-Access-Key": accessKey,
        "X-Api-Resource-Id": RESOURCE_ID,
      },
      body: JSON.stringify({
        app: { appid: appKey, cluster: "volcano_bigtts" },
        user: { uid: randomUUID() },
        audio: { voice_type: speaker, encoding: "mp3", speed_ratio: 1.0 },
        request: {
          reqid: randomUUID(),
          text,
          operation: "query",
        },
      }),
    });

    const d = await res.json();

    if (d.data) {
      return d.data as string;
    }

    console.error("[volc-tts] API error:", d);
    return "";
  } catch (err) {
    console.error("[volc-tts] request failed:", err);
    return "";
  } finally {
    clearTimeout(timeout);
  }
}
