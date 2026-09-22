# A300 维护经验与问题索引

本文件是维护经验主入口。开始前读取 [Coding 共用规则](../../AGENTS.md) 和命中条目；旧验证不能替代本轮复验。
结束时使用 [共用检查入口](../../.gstack/maintenance/README.md) 实际执行 check / close，只登记已核对的文件版本。

## 按症状检索

<!-- EXPERIENCE_INDEX_START -->
| 编号 | 问题 / 复用场景 | 原因状态 |
|---|---|---|
| [A300-K001](#a300-k001) | 问答题干显示但无声；missing Authorization header / code 3001 | v1/v3 协议与音色资源不匹配已确认；v3 真实合成成功，待切换 |
<!-- EXPERIENCE_INDEX_END -->

## 经验条目

<a id="a300-k001"></a>
### A300-K001｜TTS 接口协议与音色资源不匹配导致题目无声
- 命中/修改触发：欢迎语为预录音频；动态 Q1/Q2 和后台合成 Q3/Q4 缺 audioBase64，页面可答但不朗读。错误词 missing Authorization header / code 3001。
- 原因状态与证据：已确认请求协议错误。2026-09-22 只读核对线上 career-nav 的 err.log：当日 20:03:27、20:04:08、20:56:53、20:57:33 均出现上述错误；线上 v0.10.28、提交 15bf50445ba4380a9918e11544344f50c3b6e7c9 的 runtime 与缓存脚本均调用 /api/v1/tts，却只有 X-Api-* 头。官方文档要求 Authorization: Bearer;token。不能据此断言供应商何日改变了兼容行为。
- 处理与适用边界：lib/volc-tts.ts 和 scripts/generate-tts-cache.mjs 补 v1 Authorization；保留现有音色、端点、页面及失败降级。synthesizeTTS 增加 E2E_MOCK_MODE 短路，修复测试仍可能调用 Q3/Q4 付费语音的隔离缺口。未更改凭证、未重新生成静态音频、未部署。
- 防再犯检查：运行 npm test；鉴权契约测试要求模拟供应商无正确 Bearer;token 就返回 3001。移动端测试走 npm run test:e2e:mobile。不能用“题目可显示”或 HTTP 200 代替音频非空验证；mock 测试也不能证明线上凭证有效。
- 验证范围与日期：2026-09-22，鉴权测试在旧代码失败、补头后通过；48 项单测通过。Android Chromium 实际解码已有非静音 MP3 并完成四题播放/作答切换。Windows WebKit 最小页面无 AudioContext 且 MP3 play 持续 pending，兼容路径仅用媒体事件 mock 验证，真机声音与线上供应商调用待验。最终全流程回归/构建状态见任务 Progress。
- 复用去向：项目已登记；通用候选经 a300_readonly_review 独立核对接口契约/凭证边界，留在本项目机器队列等待共用写入流程；未直接修改共享 skill。
- 来源：[排障与验证记录](../.planning/2026-09-22-interview-audio-debug.md)、[合成实现](../lib/volc-tts.ts)、[鉴权回归](../lib/__tests__/volc-tts.test.ts)、[移动端播放回归](../e2e/specs/interview-audio.spec.ts)、[官方 HTTP 接口文档](https://docs.volcengine.com/docs/DoubaoVoice/HTTPinterfaceone-timecomposition-non-streaming?lang=zh)。

#### 2026-09-22 发布验证修正（保留上方首次结论）
- v0.10.29 补 Authorization 仅解决第一层错误；服务器隔离 canary 仍报 `tts.sync.level1 requested resource not granted`，未切换生产。原 mock 契约不能证明账户资源和音色兼容。
- 官方 V3 文档及字节官方示例确认：现有 `zh_female_vv_uranus_bigtts` 对应 `seed-tts-2.0`；使用 `/api/v3/tts/unidirectional`、`X-Api-App-Id` / `X-Api-Access-Key`，响应为多行 JSON。现有服务器凭证真实探针 HTTP 200、code 0/20000000、7 音频块、21357 字节；未开通新服务或更换音色。
- v0.10.30 修复：runtime 与缓存脚本复用 `lib/volc-tts-provider.mjs`，逐块解码再拼 MP3，只接受有完成标记的完整音频；维持空音频降级与 mock 隔离。修正测试先失败2项，修后53/53单测、tsc、相关lint与语法检查通过。
- 防再犯：必须同时验证接口、鉴权、资源与音色匹配；发布前对准确构建调用真实TTS，检查音频非空且可解码，不能仅凭mock/HTTP200确认修复。
- 原始来源：[官方 V3 接口](https://docs.volcengine.com/docs/DoubaoVoice/HTTPChunkedSSEUnidirectionalStreaming-V3?lang=zh)、[字节官方音色示例](https://github.com/bytedance/agentkit-samples/blob/main/skills/byted-text-to-speech/scripts/text_to_speech.py)、任务 Progress。

## 历史覆盖与待核

- 接入时间：2026-09-22，本轮主动排障首次接入；初始化只建立版本起点，不代表历史已审。
- 历史覆盖：已查本次语音相关 Git 历史及旧 Q3/Q4 记录；未全面回填其他问题。
- 当前未验：生产修复、真机扬声器听感；项目已有 AGENTS/CLAUDE/report-shared 等未提交内容不属于本次业务修复。
- 本轮任务：[题目无声排障计划](../.planning/2026-09-22-interview-audio-debug.md)。

