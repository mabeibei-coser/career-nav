import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// 用已有、非静音的本地语音验证真实解码/播放，不调用付费合成服务。
const audioBase64 = readFileSync(path.resolve("public/audio/greeting.mp3")).toString("base64");

test("Q1-Q4 播放链路与播放后的答题切换", async ({ page, browserName }, testInfo) => {
  // Windows WebKit 无 Web Audio，且原生 MP3 play 在最小页面也一直 pending。
  // 此环境只用媒体事件桩验证备用路径；Chromium 保留真实 MP3 解码/播放断言。
  const mockMedia = browserName === "webkit" && process.platform === "win32";
  if (mockMedia) testInfo.annotations.push({ type: "limitation", description: "Windows WebKit 媒体事件 mock；不代表 iOS 真机出声验收" });
  await page.addInitScript(({ fixture, mockMedia }) => {
    sessionStorage.setItem("formData", JSON.stringify({
      identity: "recent_grad", birthDate: "2002-06", education: "bachelor",
      workYears: "lt1", targetPosition: "测试岗位",
    }));
    sessionStorage.setItem("scoring", "{}");
    const plays: Record<string, unknown>[] = [];
    Object.assign(window, { __questionAudioPlays: plays });
    if (typeof AudioBufferSourceNode !== "undefined") {
      const original = AudioBufferSourceNode.prototype.start;
      AudioBufferSourceNode.prototype.start = function (...args) {
        if (this.buffer && !this.loop) {
          const samples = this.buffer.getChannelData(0);
          plays.push({ kind: "web-audio", state: this.context.state, nonSilent: samples.some((v) => Math.abs(v) > 0.001) });
        }
        return original.apply(this, args);
      };
    }
    // Windows WebKit 没有 Web Audio，应用会走真实 HTMLAudioElement 降级路径。
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this.src === "data:audio/mp3;base64," + fixture) {
        this.addEventListener("playing", () => {
          plays.push({ kind: "media", unmuted: !this.muted && this.volume > 0, hasDuration: this.duration > 0, mocked: mockMedia });
        }, { once: true });
        if (mockMedia) {
          Object.defineProperty(this, "duration", { value: 1 });
          this.dispatchEvent(new Event("playing"));
          setTimeout(() => this.dispatchEvent(new Event("ended")), 1000);
          return Promise.resolve();
        }
      }
      return originalPlay.call(this);
    };
    // 本测试聚焦题目输出；拒绝麦克风后仍须能朗读和文字回答。
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      value: async () => { throw new DOMException("Test microphone denied", "NotAllowedError"); },
    });
  }, { fixture: audioBase64, mockMedia });
  await page.route("**/api/interview/question", (route) => route.fulfill({ json: {
    questions: [1, 2].map((n) => ({ id: `Q${n}`, text: `第${n}题，请介绍一段工作经历。`, source: "dynamic", audioBase64 })),
  } }));
  await page.route("**/api/interview/tts", (route) => route.fulfill({ json: { audioBase64 } }));
  // Q2 完成会预热报告；本测试不生成报告、不写档案。
  await page.route("**/api/report/**", (route) => route.fulfill({ json: {} }));
  await page.goto("/interview");
  await page.getByRole("button", { name: /开始访谈/ }).click({ timeout: 30_000 });

  for (let n = 1; n <= 4; n++) {
    await expect.poll(() => page.evaluate(() =>
      (window as unknown as { __questionAudioPlays: unknown[] }).__questionAudioPlays.length,
    )).toBe(n);
    await expect(page.getByText("AI 正在读题，稍后即可回答...")).toBeVisible();
    await expect(page.getByRole("button", { name: "文字输入", exact: true })).toBeVisible({ timeout: 14_000 });
    if (n < 4) {
      await page.getByRole("button", { name: "文字输入", exact: true }).click();
      await page.locator("textarea").fill("这是一段用于回归测试的工作经历回答。");
      await page.getByRole("button", { name: /确认提交/ }).click();
    }
  }
  const plays = await page.evaluate(() =>
    (window as unknown as { __questionAudioPlays: Record<string, unknown>[] }).__questionAudioPlays,
  );
  expect(plays).toHaveLength(4);
  for (const play of plays) {
    expect(play).toEqual(play.kind === "web-audio"
      ? { kind: "web-audio", state: "running", nonSilent: true }
      : { kind: "media", unmuted: true, hasDuration: true, mocked: mockMedia });
  }
});
