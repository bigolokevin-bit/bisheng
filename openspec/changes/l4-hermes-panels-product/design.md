# Design: l4-hermes-panels-product

## 1. 产品控制台 BFF 位置与鉴权口径（卡③只读确认结论）

- 产品 React 控制台 = 本仓 `src/frontend/platform` AgentConsoleV2（worktree /Users/kevin_studio/Projects/seakoi-agent-os-console-product 属本仓另一车道 lane/L4-console-wsbind @ a474b3b，他人检出，不写入；本车道用另开 worktree /Users/kevin_studio/Projects/seakoi-agent-os-hermes-panels-fork，分支 lane/L4-hermes-panels-product，基 origin/main b82fd9a）。
- 产品控制台 BFF = 主仓 `apps/console/server.py`（ADR-0005 后果条款 line 36：BFF 作为 S10b 数据层保留不重写；P0-5/P0-6 代理先例）。运行位 `ops/console.sh` 写死 `127.0.0.1:8092`，经 Caddy 以 `/agent-api` 同源供本 UI（console.sh:43）。**存在插入位，不 BLOCKED。**
- 两条只读代理已在主仓车道落地（lane/L4-hermes-panels @ 76c7427，未合入）：`/api/hermes-summary` → runtime `GET /v1/runtime/hermes/summary`；`/api/hermes-usage?days` → `GET /v1/runtime/hermes/usage`。原样透传，不缓存，不直连 Hermes。
- 内部 token：env `CONSOLE_INTERNAL_TOKEN` → `X-Internal-Token` 注入所有代理（server.py:616-617），客户端伪造头丢弃；token 不进浏览器/日志/异常（pytest `test_hermes_responses_and_bff_logs_never_leak_internal_token` + acceptance 十一 已证）。
- 非 admin 403：`_identity_granted`（ADR-0011）`web_menu ∩ {agent,admin,backend}` ∨ `is_child_admin` ∨ `is_global_super`，未授权 403 `console.forbidden` 不触上游（server.py:583-589）。
- 上游 503/degraded：`runtime.metrics_unconfigured`/`runtime.hermes_metrics_unconfigured` 503 与 per-source `{state:"degraded",reason}` 形状**字节级原样透传**；数值 null 绝不改写为 0。

## 2. UI 复用判定

宿主为本仓 platform：React + AgentConsoleV2 既有惯例（`a2-*` CSS 令牌、Box<T> 分块加载/错误/空态、`agentConsoleTrends.ts` 适配器错误语义、testid `agent-v2-*`）。SYNTHESIS.md 判定「用宿主已有组件替换手写壳」成立；不新增第三方依赖；packages/ui 如需改动 → 停报 BLOCKED。

## 3. 三块面板（运行指标 rail 第 4 入口，全部只读）

1. **运行健康**（summary）：sources 三列 gateway_health/dashboard_system/dashboard_sessions_stats——ok 徽标 / 「降级（reason）」/ 取不到块级「暂不可用」；gateway/system/sessions_stats 字段 null 显示「—」绝不 0；`gateway.note`（metrics_today 当日计数重启归零）原文展示。
2. **模型与工具用量**（usage）：days 7/30 切换（默认 7）；tokens 四项 null→「—」；by_model 表；金额只 cost_ledger——`cost_usd:null` 或 `cost_status:"unknown"` 显示「未计价」，`estimated_cost_usd` 绝不冒充金额；per_employee 列表；`attribution.unattributed` 单列「未归属」（sessions+tokens），attribution.state degraded → 徽标；静态声明「本端点口径未含工具/技能分项」。
3. **活动热力（平台对照）**：平台侧复用既有 `getRunActivity({weeks:4,tz:'Asia/Shanghai'})` 真热力（不复制数据、不造假矩阵）；Hermes 侧仅 metrics_today 当日计数并排 + 口径差异注记（进程当日、重启归零 vs R7 平台账本）；任一侧缺数据 → 该侧空态。

纪律：不嵌 Hermes Dashboard iframe/UI；不接 shared_metrics；无任何写操作；三块独立加载/错误/空态。

## 4. 测试（vitest）

mock 形状逐字取自主仓 design §1.1/归档 evidence 真实 schema（runtime.hermes.summary.v1/usage.v1，per-source degraded、null 值、unknown 成本、unattributed）；断言诚实态文案（降级（reason）/暂不可用/未计价/未归属、无 0/0.00 伪造）、请求参数（days、run-activity weeks/tz）、rail 入口进出与零回归。

## 5. 门禁（fork 侧，Node 20.20.2 + corepack pnpm@9.15.9）

lint 0；targeted `test -- src/pages/AgentConsoleV2` 全绿零回归；全量基线 43 failed/18 files 新增 0；`build:platform` exit 0；`git diff --check origin/main..HEAD` 0；staged secret grep 空。openspec --strict / spec:validate 在本仓无工具链（bisheng 用 features/ SDD），以主仓检出运行主仓 change 的门禁为准，结果如实记 evidence。真实登录（8182）：opsadmin 口令轮换、服务未运行且本卡禁重启 → 预期 NOT MEASURED，写清缺什么。

## 6. 写域

仅 `src/frontend/platform/**` + `openspec/changes/l4-hermes-panels-product/**`。不碰 services/**、packages/ui、契约、生成物、ops；不 merge main；不动 wsbind 车道检出。
