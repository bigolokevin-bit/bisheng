# METRICS 指标页 — 元素核销表（L4p4 W1/Q2）

页：`/agent/metrics`　路由页组件：`MetricsPage.tsx`（A 区复用 `HermesMetricsSection.tsx`，热力复用 `MetricsHeat.tsx`，C 区 `TrendsCostsSection.tsx`）
口径来源：`services/domain/READ-PORT-MATRIX.md`（域缺数据一律 null/缺键；前端不得把缺值写成 0；G-7 metrics_today 为进程启动至今；G-8 无 worker/队列/DB 探针）

列说明：elementId｜数据源｜七态（加载/空/错误/403/超时/降级/正常）｜权限｜去向｜文案key｜验收腿｜状态

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| met.page.head | 静态 | 常态 | 只读 | — | `agentConsole.v2.met.*` | 截图 + 断言 h1 | 已核销 |
| met.page.desc | 静态 | 常态 | 只读 | — | `met.desc` | 文案断言 | 已核销 |
| met.a0.level | `metrics_today` | 缺键→— / 正常 | 只读 | — | `met.a0Level` | 单测缺键 | 已核销 |
| met.a1.active | `metrics_today` | 缺键→— | 只读 | — | `met.a1Active` | 单测缺键 | 已核销 |
| met.a2.requests | `metrics_today` | 缺键→— | 只读 | — | `met.a2Requests` | 单测 | 已核销 |
| met.a2.messages | `metrics_today` | 缺键→— | 只读 | — | `met.a2Messages` | 单测 | 已核销 |
| met.a2.tokens | `metrics_today` | 缺键→— | 只读 | — | `met.a2Tokens` | 单测 | 已核销 |
| met.a2.p95 | `metrics_today` | 缺键→— | 只读 | — | `met.a2P95` | 单测 | 已核销 |
| met.a2.day | `metrics_today` | 缺键→— | 只读 | — | `met.a2Day` | 单测 | 已核销 |
| met.a3.disk | `metrics_today` | 缺键→— | 只读 | — | `met.a3Disk` | 单测 | 已核销 |
| met.a3.psutil | `metrics_today` | 缺键→— | 只读 | — | `met.a3Psutil` | 单测 | 已核销 |
| met.a0.sources.gateway | `runtime.hermes.summary.v1` | 缺行→降级 / ok→正常 | 只读 | — | `met.srcOk` / `met.srcDegraded` | 单测缺行→降级 | 已核销 |
| met.a0.sources.worker | 同上 | 缺行→降级（不写正常） | 只读 | — | `met.srcDegraded` | 单测缺行 | 已核销 |
| met.a4.heat | `metrics_trends` | 无 total→— | 只读 | — | `met.heat*` | 单测 total=0 | 已核销 |
| met.a4.night | `metrics_trends` | null→—（本轮修） | 只读 | — | `met.heatNight` | 新增单测 null | 已核销 |
| met.a4.peak | `metrics_trends` | 缺键→—（本轮修） | 只读 | — | `met.heatPeak` | 新增单测缺键 | 已核销 |
| met.a4.share | `metrics_trends` | total=0→—；99.6%→99%（本轮修） | 只读 | — | `met.heatShare` | 新增单测 | 已核销 |
| met.a4.legend | 静态 | 常态 | 只读 | — | `met.legend*` | 截图 | 已核销 |
| met.a4.empty | `metrics_trends` | 无源→空态说明 | 只读 | — | `met.a4SourceEmpty` | 单测 | 已核销 |
| met.a5.link | 静态 | 常态 | 只读 | `/agent/runs` | `met.a5Link` | 链接断言 | 已核销 |
| met.state.loading | — | 骨架 | 只读 | — | `common.loading` | 单测 | 已核销 |
| met.state.error | API | 错误 + 请求号 + 重试 | 只读 | — | `met.error*` | 单测 | 已核销 |
| met.state.forbidden | API 403 | 整页替换 | 只读 | — | `met.forbidden*` | 单测 | 已核销 |
| met.write.none | — | 零写入口（死控件 0） | 只读 | — | — | 文案扫描 | 已核销 |

## 本轮（Q2 诚实性）修单

- 假 0：热力摘要 `peakCount` 缺省 `'0'`→`'—'`；`night` 缺省 `'0.0'`→`'—'`；`nightSum` null 不再落 0。
- 伪精度：A4 分段占比改为 `floor` + 上限 99，`n>=total` 才 `100`（99.6% 不再进位）；`MetricsHeat` tooltip 占比与 `peakHourShare` 同口径。
- 正向断言：夜间副行在 `nightAvg === null` 时只显 `—`，不再给「正常」类结论；运行健康 `SourceChip` 仅 `state==='ok'` 显「正常」，缺行/坏体一律「降级」。

## 合计

元素 25 / 已核销 25 / 核销率 100% / 死控件 0。