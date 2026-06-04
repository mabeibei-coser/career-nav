import type { Page } from "@playwright/test";

export interface FormData {
  /** 身份选择（2026-06 起：recent_grad / general_job_seeker） */
  identity: "recent_grad" | "general_job_seeker";
  /** 出生年月，"YYYY-MM"，必填 */
  birthDate: string;
  /** 目标岗位（选填） */
  targetPosition?: string;
  /** 学历，使用 EDUCATION_OPTIONS value：junior_high / high_school / junior_college / bachelor / master_plus */
  education: string;
  /** 工作年限，使用 WORK_YEARS_OPTIONS value：lt1 / 1to3 / 3to10 / gt10 */
  workYears: string;
  /** 简历文件名（默认上传 test-resume.pdf；传 null 可跳过上传） */
  resumeFileName?: string | null;
}

const IDENTITY_LABELS: Record<FormData["identity"], string> = {
  recent_grad: "应届毕业生",
  general_job_seeker: "一般社会求职者",
};

const EDUCATION_LABELS: Record<string, string> = {
  junior_high: "初中及以下",
  high_school: "高中/中专/技校",
  junior_college: "高职/大专",
  bachelor: "本科",
  master_plus: "硕士及以上",
};

const WORK_YEARS_LABELS: Record<string, string> = {
  lt1: "0-1年（含）",
  "1to3": "1-3年（含）",
  "3to10": "3-10年（含）",
  gt10: "10年以上",
};

export class FormPage {
  constructor(private page: Page) {}

  async goto() {
    await this.page.goto("/");
  }

  /**
   * 填写表单 4 个必填字段（+ 可选简历）。
   * 注意：identity 是双卡片按钮，targetPosition 是 input，education/workYears 是 @base-ui/react Select。
   */
  async fill(data: FormData) {
    // 1. identity 三卡片按钮：匹配标签文字
    const idLabel = IDENTITY_LABELS[data.identity];
    await this.page
      .locator(`button:has-text("${idLabel}")`)
      .first()
      .click();

    // 2. birthDate month input（必填）
    await this.page.locator("#birthDate").fill(data.birthDate);

    // 3. targetPosition input（选填，可跳过）
    if (data.targetPosition) {
      await this.page.locator("#targetPosition").fill(data.targetPosition);
    }

    // 3. education Select：点 trigger → 等 popup → 点选项
    await this.page.locator("#education").click();
    const educationLabel = EDUCATION_LABELS[data.education] ?? data.education;
    await this.page
      .getByRole("option", { name: educationLabel, exact: true })
      .click();

    // 4. workYears Select
    await this.page.locator("#workYears").click();
    const workYearsLabel =
      WORK_YEARS_LABELS[data.workYears] ?? data.workYears;
    await this.page
      .getByRole("option", { name: workYearsLabel, exact: true })
      .click();

    // 5. 简历（必填；E2E_MOCK_MODE 下 /api/resume/parse 返回 fixture）
    if (data.resumeFileName !== null) {
      await this.uploadResume(data.resumeFileName ?? "test-resume.pdf");
    }
  }

  /**
   * 上传简历（模拟 PDF）。
   * E2E_MOCK_MODE 下 /api/resume/parse 直接返回 fixture 文本，无需真实 PDF 内容。
   */
  async uploadResume(fileName = "test-resume.pdf") {
    const fileInput = this.page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: fileName,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4 E2E test resume placeholder"),
    });
    // 等待上传组件显示「已解析」
    await this.page.getByText("已解析").waitFor({ timeout: 15_000 });
  }

  /** 提交表单，经过 /preparing → /intro 过渡页后到达 /quiz */
  async submit() {
    await this.page.getByRole("button", { name: "下一步" }).click();
    // preparing 页自动播完动画后跳 /intro
    await this.page.waitForURL("**/intro", { timeout: 30_000 });
    // intro 页需要点"开始测评"按钮
    const startBtn = this.page.getByRole("button", { name: /开始测评/ });
    await startBtn.waitFor({ state: "visible", timeout: 15_000 });
    await startBtn.click();
    await this.page.waitForURL("**/quiz", { timeout: 30_000 });
  }
}
