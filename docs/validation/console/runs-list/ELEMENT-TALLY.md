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