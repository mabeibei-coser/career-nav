/**
 * Next.js 服务器启动钩子（instrumentation API）
 *
 * quiz-warmup 已停用（2026-05）：
 * - 前端量表走 /api/quiz/stream（流式生成），从不读 quiz-cache
 * - warmup 预热的 15 个 identity×education 组合无人消费（bank 路由前端不调）
 * - 每次部署/重启都在后台串行烧 15+ 次 LLM 调用且全部失败，更糟的是会与
 *   用户实时的 /api/quiz/stream 抢讯飞 API 限流额度，直接拖累主路径出题数
 * - bank 那整套（lib/quiz-warmup、lib/quiz-cache、lib/quiz-generate、
 *   app/api/quiz/bank*）是历史半成品死代码，建议后续整体清理
 */
export async function register() {
  // 当前无启动期任务
}
