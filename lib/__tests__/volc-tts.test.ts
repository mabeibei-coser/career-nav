import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { synthesizeTTS } from "../volc-tts";

describe("Volcano v1 TTS contract", () => {
  beforeEach(() => {
    vi.stubEnv("E2E_MOCK_MODE", "false");
    vi.stubEnv("VOLC_TTS_APP_KEY", "test-app");
    vi.stubEnv("VOLC_TTS_ACCESS_KEY", "test-token");
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("receives audio from a v1 endpoint that requires Bearer-semicolon authorization", async () => {
    const audio = Buffer.from("fixture-mp3").toString("base64");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://openspeech.bytedance.com/api/v1/tts");
      const headers = new Headers(init.headers);
      if (headers.get("Authorization") !== "Bearer;test-token") {
        return Response.json({ code: 3001, message: "missing Authorization header" });
      }
      const body = JSON.parse(init.body as string);
      expect(body.app.appid).toBe("test-app");
      expect(body.request.text).toBe("请介绍一段工作经历。");
      expect(body.audio.encoding).toBe("mp3");
      return Response.json({ code: 3000, data: audio });
    }));

    expect(await synthesizeTTS("请介绍一段工作经历。")).toBe(audio);
  });

  it("preserves the empty-audio fallback on provider failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: 3001, message: "denied" })));
    expect(await synthesizeTTS("测试")).toBe("");
  });

  it("does not call the provider in E2E mock mode, even without credentials", async () => {
    vi.stubEnv("E2E_MOCK_MODE", "true");
    vi.stubEnv("VOLC_TTS_APP_KEY", "");
    vi.stubEnv("VOLC_TTS_ACCESS_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await synthesizeTTS("测试")).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
