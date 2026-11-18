# RUNS 运行列表 — 元素核销表（L4p4 Q2）

页：`/agent/runs`　组件：`RunsSection.tsx`（行内成本/时长/员工/版本/来源/状态），详情 `RunDetailPage.tsx` 单列核销见文末。
口径：READ-PORT-MATRIX G-2 —— run.costUsd 为 null 时前端不得记 0。

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| runs.page.head | 静态 | 常态 | 只读 | — | `runs.*` | 截图 | 已核销 |
| runs.filters | 查询参数 | 常态 | 只读 | 本页 | `runs.filter*` | 交互断言 | 已核销 |
| runs.row | `GET /agent-api/api/runs` | 加载/空/错误/403 | 只读 | — | — | 单测 | 已核销 |
| runs.cell.status | 域枚举 | 未知→原值 | 只读 | — | `runs.status*` | 单测 | 已核销 |
| runs.cell.employee | 身份模块 | 缺→— | 只读 | 员工详情 | `id.*` | 单测 | 已核销 |
| runs.cell.version | 域 | 缺→— | 只读 | — | `runs.version` | 单测 | 已核销 |
| runs.cell.source | 域 | 未知→原值 | 只读 | — | `runs.source*` | 单测 | 已核销 |
| runs.cell.start | recorded/occurred | 北京时区到分 | 只读 | — | — | 单测时区 | 已核销 |
| runs.cell.end | 域 | 缺→— | 只读 | — | — | 单测 | 已核销 |
| runs.cell.duration | 域 | 缺→— | 只读 | — | `runs.duration` | 单测 | 已核销 |
| runs.cell.cost | `costUsd` | **null→—（不改 0）** | 只读 | — | `runs.costNone` | 本轮复核：`formatCost` 仅 finite number 上屏，逐字不四舍五入 | 已核销（无缺陷） |
| runs.cell.costStatus | `costStatus` | unknown→unknown | 只读 | — | `runs.costNote*` | 单测 | 已核销 |
| runs.row.view | 静态 | 常态 | 只读 | `/agent/runs/:id` | `runs.view` | 链接断言 | 已核销 |
| runs.state.loading | — | 骨架 | 只读 | — | `common.loading` | 单测 | 已核销 |
| runs.state.empty | API | 空 + 下一步 | 只读 | — | `runs.empty*` | 单测 | 已核销 |
| runs.state.error | API | 错误 + 请求号 + 重试 | 只读 | — | `runs.error*` | 单测 | 已核销 |
| runs.state.forbidden | 403 | 整页替换 + 重试 | 只读 | — | `runs.forbidden*` | 单测 | 已核销 |
| runs.write.none | — | 零写入口 | 只读 | — | — | 文案扫描 | 已核销 |
| rd.page.head | 静态 | 常态 | 只读 | 返回列表 | `run02.*` | 截图 | 已核销 |
| rd.f.cost | `costUsd` | null→—；unknown→unknown；est/mixed 药丸 | 只读 | — | `run02.cost*` | 单测 | 已核销 |
| rd.f.cap | `budgetCapUsd` + cost | 缺任一侧→无比率 | 只读 | — | `run02.capNote*` | 本轮复核：`fmtPct` 已 `>=1→100`、四舍五入后 `>=100→99`、`0→<1%`，无 99.6→100 | 已核销（无缺陷） |
| rd.events | `GET .../events` | 加载/空/错误/重试 | 只读 | — | `run02.events*` | 单测 | 已核销 |
| rd.state.forbidden | 403 | 整页替换 + 重试 | 只读 | — | `run02.forbidden*` | 单测 | 已核销 |
| rd.write.none | — | 零写入口 | 只读 | — | — | 文案扫描 | 已核销 |

## 本轮（Q2）结论

扫描 `RunsSection.tsx` / `RunDetailPage.tsx`：无 `costUsd ?? 0`；`formatCost` 缺值上 `—` 并带 tooltip；`fmtPct` 已防进位。**三类缺陷均未发现，记为已核销无缺陷。**
新增/复核的页面文案中无「正常 / 健康 / 无风险 / 成功率」等正向断言。

## 合计

元素 24 / 已核销 24 / 核销率 100% / 死控件 0。
## 2026-11-17 Q2 复核（基座 3c61494）

- 假 0：`?? 0` / `|| 0` 仅出现在时间差与 HTTP 状态码文案（`RunDetailPage` 的 lag/gap 秒数、`TasksListPage` 的 `errHttp` 码），数据值无兜底；成本 `formatCost(0)==='0'`、缺值 `—`，零值与缺失可区分。
- 身份：运行行员工与详情字段走身份模块（`employeeLabelById` / `humanLabel`），无裸 `emp_…` / `human:1`。
- 工程语言：ISO 串只用于查询参数与新鲜度戳，上屏经 `formatMoment`；无裸 JSON 字段名、`undefined`、`NaN`。
- 四态：加载/正常/空/错齐；错误与 403 屏均带 `ReqId`（`agent-v2-runs-error-reqid` / `-forbidden-reqid` / `agent-v2-rd-error-reqid` / `-forbidden-reqid`），403/404 同体仅状态码不同。
- 结论：本轮未发现需改代码的缺陷，如实记为「已核销无缺陷」。

## 2026-11-18 RUNS-01-R2 复核（基座 598f8842d3）

说明：`qa-verify/docs/validation/console/runs-list/ACCEPTANCE.md`（RUNS-01-R2 节）在本树不存在（无 `qa-verify/` 目录），本轮按派工六条逐条核对；本树内无该卡可抄，故判据以派工文本为准并在此如实标注。

| 判据 | 证据（本树代码） | 判定 |
|---|---|---|
| ① 身份不裸露 | `RunsSection.tsx:432-437` `runEmployeeLabel(...)` → 「员工 · 8 位短码」/「未指派」，全量原值仅进单元格 `title`；注释明写 no `emp_…`/`employee:`/`human:` text node | 满足 |
| ② 来源列真值 | `runs01.ts:278-322` `SOURCE_FIELDS=['source','triggerType','trigger','sourceSystem']` + `resolveRunSource(run,t)`；`RunsSection.tsx:522-530` 用解析结果，真缺失才 `—` | 满足 |
| ③ KPI 口径 | `RunsSection.tsx:373` 注释「无数据源的聚合数字逐个点名」；缺源显 `—` 并带脚注 | 满足 |
| ④ 错误信封 `{code,rid}` | 本页代码不含信封解析（`runs01.ts` 无 `rid/requestId/console.forbidden` 处理）；信封由共享适配层/BFF 负责，422 原生体问题在本页写域外 | 移交（BFF/共享件） |
| ⑤ `?window=24h/7d/30d` 真生效 | `runs01.ts:79-96` `SINCE_WINDOWS` + `sinceIso()`；`:105-156` `window` 作为 `since` 别名解析、回写时删除该键；请求始终带 `since` | 满足 |
| ⑥ 四态/断点/文案 | 加载/正常/空/错四态与 403-404 同体沿用既有实现；错误屏人话 + 请求号 + 重试；375/1280×720 沿用既有断点；工程语言零上屏 | 满足 |

结论：本树在 598f8842d3 上已满足 ①②③⑤⑥，本轮无代码改动；④ 属共享适配层/BFF，按写域纪律移交，不计为本页缺陷。
门禁：vitest 809（派工基线 750，不降）；build `build-runs3` entry `assets/js/index-cjmL27YX.js` sha256 `dfdc02d9e7939e6eefa7b5a754b9ebad8324da1ff4300ff731ea60642170a4a7`，标记 `agent-v2-runs-row` entry 内 0、非 entry `assets/js/shellPages-C6U3HL49.js` 命中。

### 更正（2026-11-18，`76a4040` 之后）

上一节把 R2 六条记成「基座 `598f8842d3` 已满足」不准确。①②③⑤⑥ 的实现实际来自本轮 fixer 子代理（会话被 cancelled 时实现已落盘），随本 commit 一并收编：`runs01.ts`（新文件 448 行）、`runs01.css`（新文件 135 行）、`RunsSection.tsx` 改造、三份 locale 各 +25 行、`__tests__/runs01.test.ts`（335 行）与 `agentConsoleV2Runs.test.tsx` 更新。`76a4040` 的 docs-only 记录不完整，以本 commit 为准。

门禁（含以上实现）：vitest 809 tests 全绿；build `build-runs3` entry `assets/js/index-cjmL27YX.js` sha256 `dfdc02d9e7939e6eefa7b5a754b9ebad8324da1ff4300ff731ea60642170a4a7`；标记 `agent-v2-runs-row` entry 内 0、非 entry `shellPages-C6U3HL49.js` ≥1。
