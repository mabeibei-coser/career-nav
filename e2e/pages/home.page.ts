import type { Page } from "@playwright/test";

export class HomePage {
  constructor(private page: Page) {}

  /** 进入首页（首页已合并为 Form 入口，等表单标题出现即可） */
  async gotoStart() {
    await this.page.goto("/");
    await this.page
      .getByRole("heading", { name: "就业服务-智能职业导航" })
      .waitFor();
  }
}
