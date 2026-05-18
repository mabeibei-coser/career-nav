import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIMES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
]);

function sanitizeFilename(raw: string): string {
  return (
    raw
      .replace(/[/\\<>:"|?*\x00-\x1f]/g, "_")
      .replace(/^\.+/, "_")
      .slice(0, 200) || "resume"
  );
}

function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 启发式从简历文件名提取姓名。招聘平台（智联/猎聘/拉勾）下载的简历多数命名为
 * "<姓名>-<其他元数据>.pdf"，第一个分隔符前就是姓名。精度比正文启发式高。
 *
 * 提取失败返回 null。
 */
function extractNameFromFilename(fileName: string): string | null {
  if (!fileName) return null;
  // 剥扩展名 + NFKC 归一化（防文件名也有 CJK Radical 字符）
  const stem = fileName.replace(/\.(pdf|docx?|txt)$/i, "").normalize("NFKC");
  const tokens = stem.split(/[-_\s()（）.·•|]+/).filter(Boolean);
  const blacklist = new Set([
    "简历",
    "个人简历",
    "求职简历",
    "我的简历",
    "应届生",
    "毕业生",
    "求职者",
  ]);
  for (const t of tokens) {
    // 黑名单先看原 token（防"个人简历"剥"简历"后退化为"个人"漏判）
    if (blacklist.has(t)) continue;
    // 剥常见后缀："张三简历" → "张三"
    const candidate = t.replace(/(?:的)?简历$/i, "");
    if (!/^[一-龥·]{2,15}$/.test(candidate)) continue;
    if (blacklist.has(candidate)) continue;
    return candidate;
  }
  return null;
}

/**
 * 启发式从简历文本提取姓名。仅用于 admin 后台咨询师跟进展示，
 * 提取失败返回 null（前端不显示，不报错）。
 *
 * 覆盖模式：
 *   1) "姓名：张三" / "Name: Zhang San" / "姓 名 : 张三"
 *   2) 首行独立的 2-4 字中文（典型简历开头）
 *   3) 首行开头 2-4 字中文 + 分隔符（| / · / 空格 + 性别 / 年龄）
 */
function extractNameFromResume(text: string): string | null {
  if (!text) return null;
  // PDF 解析常出现 CJK 部首字符（⽊ U+2F0A vs 木 U+6728），NFKC 归一化还原
  const head = text.slice(0, 500).normalize("NFKC");

  // 模式 1: 有"姓名"标签的明确字段
  const labeled = head.match(
    /(?:姓\s*名|Name|name|NAME)\s*[:：]\s*([一-龥·]{2,8}|[A-Za-z][A-Za-z\s]{1,30}[A-Za-z])/
  );
  if (labeled?.[1]) {
    const candidate = labeled[1].trim();
    if (candidate.length >= 2) return candidate;
  }

  // 黑名单：常见简历章节标题、通用词，避免被识别成姓名
  const blacklist = new Set([
    "个人简历",
    "求职简历",
    "简历",
    "中文简历",
    "英文简历",
    "个人资料",
    "求职意向",
    "应聘简历",
    "基本信息",
    "个人信息",
    "联系方式",
    "工作经验",
    "工作经历",
    "项目经验",
    "项目经历",
    "教育背景",
    "教育经历",
    "学习经历",
    "技能特长",
    "自我评价",
    "自我介绍",
    "兴趣爱好",
    "荣誉奖项",
    "实习经历",
    "实习经验",
    "校园经历",
    "学校经历",
    "证书技能",
    "专业技能",
    "求职目标",
    "意向岗位",
    "投递职位",
    "投递岗位",
    "应聘职位",
    "应聘岗位",
  ]);

  // 模式 2 & 3: 检查前 5 行
  const lines = head
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 5)) {
    // 2: 整行只有 2-4 字中文 = 姓名
    if (/^[一-龥·]{2,4}$/.test(line) && !blacklist.has(line)) {
      return line;
    }
    // 3: 行开头 2-4 字中文，之后跟分隔符（含 -、—、--、—— / 性别 / 年龄 / 4 位年份）
    //    覆盖如 "宗婷--嘉里大通" / "张三 | 男" / "李四（28岁）" 等
    const m = line.match(
      /^([一-龥·]{2,4})(?:\s*[-–——|·•｜/、_,，:：()（）【】\[\]]+|\s+(?:男|女|Male|Female|\d{2,3}\s*岁|\d{4}))/
    );
    if (m && !blacklist.has(m[1])) return m[1];
  }

  return null;
}

/**
 * 启发式从简历文本提取中国大陆手机号。提取失败返回 null。
 * 规则：连续 11 位以 1[3-9] 开头的数字段（含分隔符），前后必须是非数字边界。
 */
function extractPhoneFromResume(text: string): string | null {
  if (!text) return null;
  const head = text.slice(0, 2000);
  // 1) 紧凑型 11 位（最常见："电话：13812345678"）
  const m = head.match(/(?:^|[^\d])(1[3-9]\d{9})(?:[^\d]|$)/);
  if (m?.[1]) return m[1];
  // 2) 带 - 或空格分隔的 3-4-4 格式（"138-1234-5678" / "138 1234 5678"）
  const m2 = head.match(/(?:^|[^\d])(1[3-9]\d)[\s\-](\d{4})[\s\-](\d{4})(?:[^\d]|$)/);
  if (m2) return `${m2[1]}${m2[2]}${m2[3]}`;
  return null;
}

function truncate(text: string, maxChars = 8000): string {
  if (text.length <= maxChars) return text;
  const headLen = 5000;
  const tailLen = 3000;
  return (
    text.slice(0, headLen) +
    "\n\n...(中间内容已省略)...\n\n" +
    text.slice(-tailLen)
  );
}

async function parsePdf(buffer: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    return result.text ?? "";
  } finally {
    await parser.destroy();
  }
}

async function parseDocx(buffer: Buffer): Promise<string> {
  const mammoth = (await import("mammoth")).default;
  const result = await mammoth.extractRawText({ buffer });
  return result.value ?? "";
}

export async function POST(req: NextRequest) {
  // E2E mock: skip actual file parsing, return fixture resume text
  if (process.env.E2E_MOCK_MODE === "true") {
    return NextResponse.json({
      text: "应届生模拟简历。产品经理方向，曾在某科技公司完成三个月产品运营实习，参与用户调研和需求分析，独立输出 PRD 文档三份。熟悉 Axure 原型设计，有 Python 数据处理基础。在学生会任职期间负责活动策划，组织了三次百人规模的校园活动，具备较强的项目协调能力。",
      fileName: "test-resume.pdf",
      charCount: 128,
      truncated: false,
      resumeRef: "e2e-mock-resume-ref",
      resumeFilename: "test-resume.pdf",
      extractedName: null,
      extractedPhone: null,
    });
  }
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: "未检测到上传文件" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "文件过大，请上传不超过 5MB 的文件" },
        { status: 413 }
      );
    }

    const fileName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || fileName.endsWith(".pdf");
    const isDocx = fileName.endsWith(".docx");
    const isDoc = fileName.endsWith(".doc") && !isDocx;

    if (isDoc) {
      return NextResponse.json(
        { error: "暂不支持老版 .doc 格式，请转换为 .docx 或 PDF 后上传" },
        { status: 415 }
      );
    }

    if (!isPdf && !isDocx && !ALLOWED_MIMES.has(file.type)) {
      return NextResponse.json(
        { error: "仅支持 PDF 和 Word (.docx) 格式" },
        { status: 415 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let rawText = "";

    if (isPdf) {
      rawText = await parsePdf(buffer);
    } else {
      rawText = await parseDocx(buffer);
    }

    const cleaned = cleanText(rawText);

    if (cleaned.length < 50) {
      return NextResponse.json(
        {
          error:
            "无法从文件中提取到足够内容，可能是扫描件 PDF 或空文档；请改用文字版简历",
        },
        { status: 422 }
      );
    }

    const text = truncate(cleaned);
    // 姓名优先用文件名启发式（命中率最高），fallback 到正文启发式
    const extractedName =
      extractNameFromFilename(file.name) ?? extractNameFromResume(cleaned);
    const extractedPhone = extractPhoneFromResume(cleaned);

    const tempId = randomUUID();
    const cleanName = sanitizeFilename(file.name);
    const tempDir = path.join(process.cwd(), "data", "temp", tempId);
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(path.join(tempDir, cleanName), buffer);

    return NextResponse.json({
      text,
      fileName: file.name,
      charCount: cleaned.length,
      truncated: cleaned.length > text.length,
      resumeRef: tempId,
      resumeFilename: cleanName,
      extractedName,
      extractedPhone,
    });
  } catch (error: unknown) {
    console.error("Resume parse error:", error);
    const message =
      error instanceof Error ? error.message : "简历解析失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export function cleanupOldTemp(maxAgeMs = 30 * 60 * 1000): void {
  const tempDir = path.join(process.cwd(), "data", "temp");
  if (!fs.existsSync(tempDir)) return;
  const now = Date.now();
  for (const entry of fs.readdirSync(tempDir)) {
    const entryPath = path.join(tempDir, entry);
    try {
      const stat = fs.statSync(entryPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.rmSync(entryPath, { recursive: true, force: true });
      }
    } catch {
      // ignore
    }
  }
}
