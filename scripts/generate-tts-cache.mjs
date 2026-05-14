/**
 * 预生成静态 MP3 文件（intro 欢迎语 + 访谈开场白 + 10 题题库）
 *
 * 用法：
 *   node scripts/generate-tts-cache.mjs
 *
 * 需要 .env.local 配好 VOLC_TTS_APP_KEY / VOLC_TTS_ACCESS_KEY / VOLC_TTS_SPEAKER
 *
 * 输出到 public/audio/{intro-welcome,greeting,q1,q2,...,q10}.mp3
 *
 * 文案变更后需重跑此脚本：
 *   - intro 欢迎语：本文件 INTRO_WELCOME 常量
 *   - 访谈开场白/题库：本文件 GREETING / BANK（与 lib/interview-questions.ts 同步）
 */

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import path from "path";

// 简易 .env.local 解析（不引第三方包）
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!existsSync(envPath)) {
    console.warn("⚠ .env.local not found, falling back to process.env");
    return;
  }
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const APP_KEY = process.env.VOLC_TTS_APP_KEY;
const ACCESS_KEY = process.env.VOLC_TTS_ACCESS_KEY;
const SPEAKER = process.env.VOLC_TTS_SPEAKER ?? "zh_female_vv_uranus_bigtts";

if (!APP_KEY || !ACCESS_KEY) {
  console.error("✗ 缺少 VOLC_TTS_APP_KEY / VOLC_TTS_ACCESS_KEY，请检查 .env.local");
  process.exit(1);
}

// intro 页欢迎语（与 app/intro/page.tsx 的 INTRO_TEXT 保持一致）
const INTRO_WELCOME =
  "你好，我是你的 AI 职业助理。接下来我们一起完成两个环节：第一，职业导航自测；第二，AI 语音访谈。你准备好了吗？准备好了，我们就开始测评。";

// 题库数据（与 lib/interview-questions.ts 保持一致；变更后两边同步）
const GREETING =
  "你好，我是你的 AI 职业顾问，接下来我会问你两个问题，帮你完善这份定位报告。";

const BANK = [
  { id: "q1", text: "你选择现在这个求职方向，最打动你的是什么？是看好它的前景、觉得自己擅长、还是有别的原因？聊聊你的想法。" },
  { id: "q2", text: "找工作的时候，薪资、发展空间、工作节奏、离家远近……这些里面，你最看重哪个？为什么？" },
  { id: "q3", text: "假设你同时拿到两个 offer，一个各方面都还行但没太大惊喜，另一个有你特别想要的东西但也有明显短板——你会怎么选？" },
  { id: "q4", text: "你有没有看到过别人的求职经历——不管是学长学姐、同学还是网上的分享——让你对自己的求职有了一些新的想法或者触动？" },
  { id: "q5", text: "求职过程中难免碰到不顺利，比如被拒、等不到回复、或者突然对自己产生怀疑。遇到这种情况你一般怎么调整？" },
  { id: "q6", text: "你觉得第一份工作最重要的是什么——是多挣钱、多学东西、认识厉害的人，还是先搞清楚自己适合做什么？" },
  { id: "q7", text: "回想一下你过去的经历——学习、实习、兼职、参加比赛或者自己做的事都算——哪件事让你最有成就感？是什么让你印象这么深？" },
  { id: "q8", text: "对于即将开始的职业生涯，你心里最大的顾虑是什么？比如怕选错方向、担心竞争激烈、还是对自己的能力不太有把握？" },
  { id: "q9", text: "如果入职后发现这份工作跟你预期的不太一样——可能是工作内容、团队氛围或者成长速度——你会怎么应对？" },
  { id: "q10", text: "往后看三年，你希望自己是什么状态？不用很具体，说说你理想中的工作和生活大概是什么样的。" },
];

const OUT_DIR = path.resolve(process.cwd(), "public/audio");
mkdirSync(OUT_DIR, { recursive: true });

async function tts(text) {
  const res = await fetch("https://openspeech.bytedance.com/api/v1/tts", {
    method: "POST",
    headers: {
      "X-Api-App-Key": APP_KEY,
      "X-Api-Access-Key": ACCESS_KEY,
      "X-Api-Resource-Id": "volc.service_type.10029",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      app: { appid: APP_KEY, cluster: "volcano_bigtts" },
      user: { uid: "build-time" },
      audio: { voice_type: SPEAKER, encoding: "mp3", speed_ratio: 1.0 },
      request: { reqid: randomUUID(), text, operation: "query" },
    }),
  });
  const d = await res.json();
  if (!d.data) {
    throw new Error(`TTS 失败 (code=${d.code} msg=${d.message ?? "?"})`);
  }
  return Buffer.from(d.data, "base64");
}

async function generate(name, text) {
  const out = path.join(OUT_DIR, `${name}.mp3`);
  process.stdout.write(`→ ${name}.mp3 ... `);
  const buf = await tts(text);
  writeFileSync(out, buf);
  console.log(`${(buf.length / 1024).toFixed(1)} KB`);
}

async function main() {
  console.log("生成静态 MP3 缓存");
  console.log("speaker:", SPEAKER);
  console.log("输出目录:", OUT_DIR);
  console.log("");

  await generate("intro-welcome", INTRO_WELCOME);
  await generate("greeting", GREETING);
  for (const q of BANK) {
    await generate(q.id, q.text);
  }

  console.log("");
  console.log(`✓ 已生成 ${BANK.length + 2} 个 MP3`);
}

main().catch((e) => {
  console.error("\n✗ 生成失败:", e.message ?? e);
  process.exit(1);
});
