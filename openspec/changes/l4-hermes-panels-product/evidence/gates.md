# Evidence: gates（l4-hermes-panels-product）

工具链前缀（所有 fork 命令）：`export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && corepack pnpm@9.15.9 ...`（Node 20.20.2 / pnpm 9.15.9）。
日志目录：`/private/var/folders/2b/bnpsyz450pn98w375q_803yw0000gn/T/opencode`。时间均为 UTC。

## 每门禁一条（命令 ｜ exit ｜ UTC）

| # | 门禁 | 命令 | exit | UTC | 数字 | 日志 |
|---|---|---|---|---|---|---|
| 0 | 开工关（四件套 push -u） | `git push -u origin lane/L4-hermes-panels-product`（commit a31c556） | 0 | 2026-11-14T04:33:58Z | ls-remote = a31c556257465358f2932d5497fbbacf8ec0d647（=HEAD 当时） | — |
| 1 | lint | `corepack pnpm@9.15.9 -C src/frontend/platform lint` | 0 | 2026-11-14T04:54:14Z | 0 errors 0 warnings | p14fork-lint.log |
| 2 | targeted（AgentConsoleV2） | `corepack pnpm@9.15.9 -C src/frontend/platform test -- src/pages/AgentConsoleV2` | 0 | 2026-11-14T04:54:06Z（复跑，含组件修复后） | 6 files / 94 passed（含新增 agentConsoleV2Hermes.test.tsx 14 tests；原基线 80 零回归） | p14fork-targeted.log |
| 3 | 全量测试 | `corepack pnpm@9.15.9 -C src/frontend/platform test` | 1（预期） | 2026-11-14T04:54:41Z | 43 failed \| 1711 passed (1754)；18 failed files \| 279 passed (297)；基线 43/18，新增失败 0、新增通过 +14 | p14fork-full.log |
| 3a | FAILSET 一致性 | python3 归一化对比（剥 `× ` 前缀/计时后缀/`→`尾注，排序去重） | 0 | 2026-11-14T04:55:58Z | 43 vs 43，unified diff **0 行** = 基线失败集逐条相同（此前 88 行差为格式差，非内容差） | p14-failset-now.txt vs b.txt（P0-6 基线） |
| 4 | build:platform | `corepack pnpm@9.15.9 -C src/frontend build:platform` | 0 | 2026-11-14T04:54:54Z | ✓ built in 11.73s | p14fork-build.log |
| 5 | diff-check | `git diff --check origin/main..HEAD`（提交前后各一次） | 0 | 2026-11-14T04:56:32Z / 04:57Z | 无空白错误 | — |
| 6 | staged secret grep | `git diff --cached \| grep -nEi 'CONSOLE_INTERNAL_TOKEN\|SEAKOI_RUNTIME_INTERNAL_TOKEN\|X-Internal-Token'` | 1（无命中） | 2026-11-14T04:56:32Z | 0 hits：内部 token 头/环境变量名不出现在任何前端提交文件 | — |

## 修复轮再验证（tasks.md sed 事故后，应总控指令）

事故披露：72ea8da 中 tasks.md 因 sed 替换串误以字面 `^` 开头而整块损坏（行首变 `^- [x]`），且 T5–T8 属预勾（其完成动作当时未发生）。已由 5ec95cd 用 write 工具整文件重写复原（T0–T4 真实完成保持 [x]，T5–T8 回落未验证）。本节为逐项再验证，全部命令重跑于盘上取数：

| # | 门禁再验证 | 命令 | exit | UTC | 结果 |
|---|---|---|---|---|---|
| 7 | 日志实存与数字复核 | `ls` + grep p14fork-{lint,targeted,full,build}.log | 0 | 2026-11-14T05:00Z | lint 干净；targeted 6 files/94 passed；full `43 failed \| 1711 passed (1754)`、`18 failed files \| 279 passed (297)`；build `✓ built in 11.73s`——与 #1–#4 记录一致 |
| 8 | FAILSET 一致性重证 | python3 同法归一化 p14-failset-now.txt vs b.txt | 0 | 2026-11-14T05:00Z | 43 = 43，unified diff 0 行，IDENTICAL，新增失败 0（修正了早期 grep 前导空格导致的 0 行误读） |
| 9 | diff-check 重跑 | `git diff --check origin/main..HEAD` | 0 | 2026-11-14T05:01Z | 无空白错误 |
| 10 | secret grep 分层复核 | `git diff origin/main..HEAD -- src/frontend/platform \| grep -cE '<token 变量名>'`；逐文件 grep agentConsoleHermes.ts / HermesMetricsSection.tsx | 0 命中 | 2026-11-14T05:01Z | 代码零命中；range 级 2 命中均为 change 文档散文（design.md 机制句 1 处、本表 #6 grep 命令自身 1 处），非密钥值 |

再验证结论：T5 恢复勾选（六项门禁均有盘上 exit+UTC 证据）；T7 恢复勾选（NOT MEASURED 裁定与缺项清单已在盘上，符合卡片「做不到写 NOT MEASURED」要求）；T6/T8 按其定义（追加提交 push HEAD=远端、两分支回报）留待各自完成动作之后的追加提交中勾选，不再预勾。

## 真实登录目测（①④⑤）——NOT MEASURED

生产入口真实登录未执行，缺口如实记录（依卡第 7 条，不得猜 opsadmin 口令）：
- 缺可用管理员会话：opsadmin 口令已轮换，本机无共享凭据；
- 控制台入口不可达：8182/Caddy 现未运行，且本卡明令不重启 8092/Caddy/Bisheng/8101/8103；
- 缺项清单：①真实 session token 面板对账、④非 admin 浏览器 403、⑤浏览器不出现 token——均未有头/无头实测截图，**不写成通过**。
- 已有的替代层级证据（非浏览器）：主仓 pytest 对 403 授权门前置于上游、503/422/degraded 字节级透传、响应与 BFF 日志无 token 子串的断言（见主仓 l4-hermes-panels/evidence/gates.md Wave-1）；fork vitest 以真实运行时形状断言诚实态渲染。

## 面板交付清单（fork，commit 172be85，2026-11-14T04:56:39Z）

- 新增 `src/controllers/API/agentConsoleHermes.ts`（真实 schema 类型 + /agent-api/api/hermes-summary|hermes-usage 适配，错误语义与 agentConsoleTrends.ts 逐行同构）
- 新增 `src/pages/AgentConsoleV2/HermesMetricsSection.tsx`（三块独立：运行健康／模型与用量（days 7/30）／活动热力对照；诚实态纪律：降级（reason）、暂不可用、未计价绝不 0.00、未归属单列、静态工具/技能口径缺口行、空 cells 不画假矩阵——空态守卫为本轮修复）
- `AgentConsoleV2Page.tsx` rail 第 4 入口「运行指标」+ hermesApi prop/http fallback；`agentConsoleV2.css` a2-metrics-* 分数轨道（375/1440 无横向溢出为结构性声明，未做像素级目测——归入 NOT MEASURED 面）；三语 bs.json 各 +79 key，零裸 key
- 新增 `__tests__/agentConsoleV2Hermes.test.tsx`（14 tests，fixtures 逐字取自主仓 stub_upstream `_hermes_*` 真实形状）

## 偏差栏（fork 侧）

1. 归属 degraded 时同时渲染「降级（reason）」chip 与「归属暂不可用」值行（双重诚实表达）。
2. 新增诚实 chip「降级替代来源：sqlite-ro-fallback」（sources.dashboard_usage.fallback_source 存在时）。
3. days 切换复用 a2-run-seg 的 aria-pressed 习语，未造新控件。
4. 测试的 i18n mock 扩展了 `{{var}}` 插值以断言带 reason 的降级文案。
5. 375/1440 不溢出为 CSS 结构性主张（分数轨道 + overflow-x clip 兜底），真实浏览器目测随①④⑤一起 NOT MEASURED。
