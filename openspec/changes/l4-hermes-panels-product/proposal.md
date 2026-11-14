# Proposal: l4-hermes-panels-product

## Why

P0-14（Hermes 指标接入·薄）二段：runtime 两内部端点（主仓 e38fa82）与 BFF 两条只读白名单代理（主仓 lane/L4-hermes-panels @ 76c7427，`/api/hermes-summary`、`/api/hermes-usage?days`）已就绪。总控裁定（ADR-0005，docs/decisions/0005-console-form.md:21/36）：三块只读面板不得落在 apps/console 调试页，必须落在产品 React 控制台 = 本仓 `src/frontend/platform` AgentConsoleV2；apps/console/server.py 是 S10b 数据层（BFF 代理保留在主仓，经 /agent-api 同源供本 UI 消费）。

## What Changes

- 新增 `src/controllers/API/agentConsoleHermes.ts`：summary/usage 类型与只读适配器（/agent-api/api/hermes-summary、/agent-api/api/hermes-usage?days=N，错误语义沿用 agentConsoleTrends.ts）。
- 新增 `src/pages/AgentConsoleV2/HermesMetricsSection.tsx`：三块独立只读面板——运行健康 / 模型与工具用量（token 用 Hermes 口径、金额只 cost_ledger、缺行「未计价」绝不 0.00、`estimated_cost_usd`/`cost_status=unknown` 不当金额、未映射单列「未归属」）/ 活动热力（平台 R7 真热力 + Hermes metrics_today 并排 + 口径注记，无假矩阵；空/降级写「降级/暂不可用」绝不 0）。
- AgentConsoleV2Page 新增第 4 个 rail 入口「运行指标」；CSS 追加 a2-* 分数栅格（375/1440 无横向溢出）；三语 bs.json 补 key。
- vitest：真实 runtime 形状（per-source degraded、null 绝不 0）+ 请求参数 + 诚实态断言。

## Not Changing

- 不动 services/**、packages/ui、契约、生成物、ops；不嵌 Hermes Dashboard UI；不接 shared_metrics；无任何写操作；不改 v2-1..v2-4 已有行为。
- 不新增第三方依赖：复用本仓既有 React 栈与 AgentConsoleV2 自有组件惯例。

## Impact

- Affected specs: 无（skip_specs，UI 面板层）
- Affected code: `src/frontend/platform/**`（本仓唯一写域）；数据依赖主仓 BFF 路由（未合入前经 worktree BFF 验证，产品 8092 上线随主仓 change 合入）
