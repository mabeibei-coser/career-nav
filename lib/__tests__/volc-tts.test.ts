import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { synthesizeTTS } from "../volc-tts";

describe("Volcano v3 TTS contract", () => {
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

  it("uses the current voice resource and joins decoded audio chunks", async () => {
    const audio = Buffer.from("fixture-mp3").toString("base64");
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://openspeech.bytedance.com/api/v3/tts/unidirectional");
      const headers = new Headers(init.headers);
      expect(headers.get("X-Api-App-Id")).toBe("test-app");
      expect(headers.get("X-Api-Access-Key")).toBe("test-token");
      expect(headers.get("X-Api-Resource-Id")).toBe("seed-tts-2.0");
      const body = JSON.parse(init.body as string);
      expect(body.req_params.text).toBe("请介绍一段工作经历。");
      expect(body.req_params.speaker).toBe("zh_female_vv_uranus_bigtts");
      expect(body.req_params.audio_params.format).toBe("mp3");
      // Individually padded chunks cannot be joined as base64 strings.
      return new Response([
        JSON.stringify({ code: 0, data: Buffer.from("fixt").toString("base64") }),
        JSON.stringify({ code: 0, data: null, sentence: {} }),
        JSON.stringify({ code: 0, data: Buffer.from("ure-mp3").toString("base64") }),
        JSON.stringify({ code: 20000000, data: null }),
      ].join("\r\n"));
    }));

    expect(await synthesizeTTS("请介绍一段工作经历。")).toBe(audio);
  });

  it.each([
    ["truncated response", '{"code":0,"data":"YQ=="}\n'],
    ["provider error after audio", '{"code":0,"data":"YQ=="}\n{"code":55000000,"message":"denied"}'],
    ["malformed response", "not json"],
    ["no audio", '{"code":20000000,"data":null}'],
  ])("does not return partial or invalid audio: %s", async (_name, response) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(response)));
    expect(await synthesizeTTS("测试")).toBe("");
  });

  it("rejects an HTTP error even if its body contains audio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"code":0,"data":"YQ=="}\n{"code":20000000}', { status: 503 })));
    expect(await synthesizeTTS("测试")).toBe("");
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
