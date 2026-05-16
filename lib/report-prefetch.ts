/**
 * Report 章节预拉取单例（career-nav 5 模块版 · 已精简）
 * ———————————————
 * career-nav 流程：form → quiz（评分）→ interview（Q1Q2）→ loading → report
 *
 * 5 个模块全部依赖 quiz 评分或 Q1Q2 摘要，**form 阶段无任何模块可预拉**。
 * 因此原本的 4 路并行 prefetch 已废弃，本文件仅保留两个 no-op 函数 stub，
 * 以便 form/page.tsx 等历史调用点的 import 不破。
 *
 * 真正的 fetch 调度全部移到 lib/report-bg-runner.ts：
 *   - startAfterQuiz：quiz 提交后启动 strength / positioning / advice
 *   - startAfterQ1Q2：interview Q1Q2 答完后启动 overview / resumeDiagnosis
 */

import type { JobFormData } from "@/lib/types";

/**
 * @deprecated career-nav 不在 form 阶段预拉报告。保留 stub 仅为向下兼容现有
 * import；调用此函数无副作用。
 */
export function startReportPrefetch(_: JobFormData): void {
  // no-op
}

/**
 * @deprecated 与 startReportPrefetch 配套的清理函数，同样为 no-op stub。
 */
export function clearReportPrefetch(): void {
  // no-op
}
