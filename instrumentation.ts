/**
 * Next.js 服务器启动钩子（instrumentation API）
 *
 * 仅在 Node.js runtime（VPS/PM2 部署）执行，Edge runtime 跳过。
 * 触发 quiz 缓存预热：并发生成 15 种 identity×education 组合的题目写入内存缓存，
 * 确保用户到来时所有 LLM 题目已就绪（0ms 命中缓存），彻底消除"等待出题"。
 */
export async function register() {
  // 只在 Node.js runtime 预热（Edge/Serverless 不共享内存缓存，无效）
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { warmQuizCache } = await import("./lib/quiz-warmup");
    // fire-and-forget：不 await，不阻塞服务器启动
    void warmQuizCache();
  }
}
