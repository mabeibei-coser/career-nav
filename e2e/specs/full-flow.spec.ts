/**
 * 全链路 happy path
 * 覆盖 Desktop Chrome / iPhone 14 (WebKit) / Pixel 7 (Chromium)
 *
 * 流程：/ → /quiz → /interview → /loading → /report
 *
 * E2E_MOCK_MODE=true（playwright.config.ts 自动注入）：所有 LLM API 即时返回 mock，
 * 不消耗 API 额度也不依赖 DEEPSEEK_API_KEY / IFLYTEK_API_KEY 配置。
 */
import { test, expect } from "@playwright/test";
import { FormPage } from "../pages/form.page";
import { QuizPage } from "../pages/quiz.page";
import { InterviewPage } from "../pages/interview.page";
import { LoadingPage } from "../pages/loading.page";
import { ReportPage } from "../pages/report.page";

// 移动端进入题目和访谈题切换稍慢，给宽裕一点
test.describe("完整流程：form → quiz → interview → report", () => {
  test("recent_grad 身份跑通", async ({ page, isMobile }) => {
    test.setTimeout(isMobile ? 240_000 : 180_000);

    const form = new FormPage(page);
    const quiz = new QuizPage(page);
    const interview = new InterviewPage(page);
    const loading = new LoadingPage(page);
    const report = new ReportPage(page);

    await form.goto();
    await form.fill({
      identity: "recent_grad",
      targetPosition: "客户服务专员",
      education: "bachelor",
      workYears: "lt1",
    });
    await form.submit();

    // 8 题量表全部"中立（3 分）"
    await quiz.answerAll([3, 3, 3, 3, 3, 3, 3, 3]);

    // 4 题访谈全文字回答
    await interview.answerAllText([
      "我希望能从基础岗位起步,稳步学习业务知识,把每一件小事做到位。",
      "上学期间在校园活动里负责过对外接待,沟通时尽量把流程讲清楚。",
      "我比较看重团队氛围稳定,大家彼此尊重也愿意互相帮忙。",
      "希望能在岗位上学到通用的服务能力,把客户服务做扎实。",
    ]);

    await loading.waitForReport();

    await expect(page).toHaveURL(/\/report/);
    await report.assertSectionsVisible();
    await report.assertExternalLinkVisible();
    await report.assertRadarsPresent();
  });

  test("general_unemployed 身份跑通", async ({ page, isMobile }) => {
    test.setTimeout(isMobile ? 240_000 : 180_000);

    const form = new FormPage(page);
    const quiz = new QuizPage(page);
    const interview = new InterviewPage(page);
    const loading = new LoadingPage(page);
    const report = new ReportPage(page);

    await form.goto();
    await form.fill({
      identity: "general_unemployed",
      targetPosition: "行政人事助理",
      education: "junior_college",
      workYears: "1to3",
    });
    await form.submit();

    // 8 题量表混合分布（验证分数变化也能跑通）
    await quiz.answerAll([2, 4, 3, 5, 1, 3, 4, 2]);

    await interview.answerAllText([
      "上一份工作做了一年半,主要负责人事合同台账和档案整理。",
      "现在希望换一份更稳定的工作,离家近一点,不需要经常加班。",
      "我比较看重团队的工作氛围,觉得同事之间能互相配合很重要。",
      "希望能学到更系统的人事流程,长远朝 HR 专业方向发展。",
    ]);

    await loading.waitForReport();

    await expect(page).toHaveURL(/\/report/);
    await report.assertSectionsVisible();
    await report.assertExternalLinkVisible();
  });

  test("不上传简历也能完整跑（resumeDiagnosis 走跳过分支）", async ({ page, isMobile }) => {
    test.setTimeout(isMobile ? 240_000 : 180_000);

    const form = new FormPage(page);
    const quiz = new QuizPage(page);
    const interview = new InterviewPage(page);
    const loading = new LoadingPage(page);
    const report = new ReportPage(page);

    await form.goto();
    // 显式不传 resumeFileName
    await form.fill({
      identity: "recent_grad",
      targetPosition: "数据分析师",
      education: "master",
      workYears: "lt1",
    });
    await form.submit();

    await quiz.answerAll([4, 4, 3, 3, 5, 2, 4, 3]);
    await interview.answerAllText([
      "我对数据分析最感兴趣,大学里做过一些课程项目和模型作业。",
      "我希望能把学校里学到的方法在真实业务场景里跑一遍。",
      "我比较看重能学到东西的氛围,希望团队对新人有耐心。",
      "短期想把数据清洗和可视化做扎实,长期想做业务方向的分析师。",
    ]);

    await loading.waitForReport();

    await expect(page).toHaveURL(/\/report/);
    await report.assertSectionsVisible();
    // 报告页头部不应出现"已结合简历"badge（无简历分支）
    await expect(page.getByText("已结合简历")).toHaveCount(0);
    // resume-diagnosis section 应渲染"本模块已跳过"占位
    await expect(
      page.getByText("本模块已跳过").first(),
    ).toBeVisible({ timeout: 10_000 });
  });
});
