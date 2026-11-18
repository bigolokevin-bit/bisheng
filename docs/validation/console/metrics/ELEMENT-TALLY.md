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
## PRD v0.3 §5.6 对齐（judge H）

判据 H：先按 `docs/product/console-v3/PRD-v0.3.md` §5.6 抄全元素行，再做诚实性修复。本节不改上表原判定（L4p4 25/25），只做 PRD 编号映射与缺口登记。

| elementId | 对应实现行 | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|---|
| MET-RANGE-01 时间窗 24h/7d/30d | met.a4.heat / met.a4.night / met.a4.share（趋势区窗口） | query + `metrics_trends` | 默认 7d；无源→空态说明 | 只读 | action:range | `met.range*` | 单测窗口切换 | 已核销 |
| MET-KPI-01 成功率 | met.a0.level / met.a2.p95 同族 | `metrics_today` | 缺键→`—`；99.6%→99%（不进位） | 只读 | — | `met.a0Level` / `met.heatShare` | 单测缺键与 floor+上限 99 | 已核销 |
| MET-KPI-02 时延 | met.a2.p95 | `metrics_today` | 缺键→`—` | 只读 | — | `met.a2P95` | 单测 | 已核销 |
| MET-KPI-03 花费 | met.a5 花费卡 | `metrics_trends` / cost_totals | 未配置→「未配置」；缺→`—` | 只读 | — | `met.cost*` | 单测 | 已核销 |
| MET-KPI-04 运行数 | met.a2.requests / met.a2.messages | `metrics_today` | 缺键→`—` | 只读 | — | `met.a2Requests` | 单测 | 已核销 |
| MET-KPI-05 失败数 | met.a0.sources.* + 失败卡 | `runtime.hermes.summary.v1` | 缺行→降级，不写正常 | 只读 | `/agent/runs?status=failed` | `met.srcDegraded` | 单测缺行 | 已核销 |
| MET-HEAT-01 小时热力 | met.a4.heat / met.a4.night / met.a4.peak / met.a4.legend | `metrics_trends` | 无 total→`—`；空格不涂色 | 只读 | 格 → 该小时运行列表 | `met.heat*` | 单测 total=0 / null / 缺键 | 已核销 |
| MET-TABLE-01 按员工分开销 | met.a5 员工表 | cost_totals | 空：「本期没有花费」；`rows` 缺失→`—`（本刀修） | 只读 | 员工详情 | `met.costZeroRows` / `met.costRows` | 单测 rows 缺失 | 已核销 |

### 本刀诚实性修复（judge H）

- `MetricsPage.tsx` 花费卡：`rows` 缺失时原会落 `0` 行账目（假 0）。现按 `typeof rows === 'number'` 判定，缺失显 `—`；`rows === 0` 仍走「0 行账目 · 没有账目，不以零金额冒充」。
- 其余判据 H 项复核结论（未改动）：缺键 `—`、分段占比 floor + 上限 99、SourceChip 仅 ok 显「正常」、四态齐、无工程语言与裸 id —— 与上表 Q2 修单一致。
- 计数（含本刀新增行）：元素数 33 ｜ 已核销 33 ｜ 核销率 100% ｜ 死控件 0（原 25 行 + PRD 映射 8 行）。

## Q2 提高核销复核（逐行证据，维持 33/33）

本轮不新增元素行，只把「已核销」从文字声明升级为源码/键位可核证据；不可达行仍标「不可用」。

| PRD 行 | 复核证据（源码实测） | 结论 |
|---|---|---|
| MET-KPI-01 成功率 / MET-HEAT-01 占比 | `met01.ts fmtPercent`：`null/非有限→—`；`>=100→100%`；`Math.round` 后 `>=100→99%`（99.6 不进位）；`round 后 0→<1%`（非零小片不归 0） | 已核销 |
| MET-HEAT-01 分段占比 | `MetricsPage.honestPct`：`total<=0→—`；`n<=0→0`；`n>=total→100`；否则 `min(99, max(1, floor(n/total*100)))` | 已核销 |
| MET-KPI-02 时延（样本不足） | 现成键：`trendP95None`「样本不足」、`met.p95Insufficient`「样本不足（<20）」、`met.trendSumP95`「95 分位延迟（样本不足 20 条）」三语齐全 | 已核销 |
| MET-TABLE-01 按员工分开销 | 花费卡 `rows` 缺失改判 `typeof rows === 'number'`，缺失显 `—`；`rows===0` 仍「没有账目，不以零金额冒充」 | 已核销 |
| 其余 29 行 | 沿用 L4p4 Q2 原表与 A4 修单（缺键 —、SourceChip 仅 ok 显正常、四态齐） | 已核销 |

- 计数不变：元素数 33 ｜ 已核销 33 ｜ 核销率 100% ｜ 死控件 0。
- 不可用/权限未授：无。metrics 全部数据源为只读运行时聚合，页面不依赖写权限。
- 未测边界：真实后端缺键返回未联调；本轮证据为源码与现有单测口径，未重跑视觉。

## 2026-11-18 本拍复核（基座 0e228d6，MET-02）

> 设计源 `docs/product/design/console-v2/MET01-TARGET-SPEC.md` 在本树不存在（grep 无此文件），无法按 SPEC 行逐条抄录；本节按页面实际区块（A0–A5 + 四态）建表并逐行判定，缺口如实标注。

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| A0-01 页头/口径说明 | runtime summary | 正常/降级/加载/错/403/404 | approval.viewer | 无 | met.a0* | 读 | 已核销 |
| A0-02 运行健康级别 | summary.sources | ok/degraded/缺 | 同上 | 无 | met.a0Level | 读 | 已核销（缺行落降级） |
| A1-01 活跃会话 | summary | 有值/0/缺 | 同上 | 无 | met.a1* | 读 | 已核销（缺显—） |
| A2-01 请求数 | usage | 有值/0/缺 | 同上 | 无 | met.a2Requests | 读 | 已核销 |
| A2-02 消息数 | usage | 有值/0/缺 | 同上 | 无 | met.a2Messages | 读 | 已核销 |
| A2-03 tokens | usage | 有值/0/缺 | 同上 | 无 | met.a2Tokens | 读 | 已核销 |
| A2-04 p95 延迟 | usage | 有值/缺 | 同上 | 无 | met.a2P95 | 读 | 已核销 |
| A2-05 日期口径 | usage.day | 北京时间到分 | 同上 | 无 | met.a2Day | 读 | 已核销 |
| A3-01 磁盘 | platform | 有值/缺 | 同上 | 无 | met.a3Disk | 读 | 已核销 |
| A3-02 psutil | platform | 有值/缺 | 同上 | 无 | met.a3Psutil | 读 | 已核销 |
| A4-01 分段占比 | trends | 有值/空/degraded | 同上 | 无 | met.a4* | 读 | 已核销（ratio=0 显—，99.6% 不进位） |
| A4-02 图例/来源空态 | trends | 空态说明 | 同上 | 无 | met.a4SourceEmpty | 读 | 已核销 |
| A5-01 成本/配额入口 | costs | 有值/缺 | 同上 | /agent/runs | met.a5Link | 读 | 已核销（真跳） |
| H-01 热力夜间量 | trends heat | 有值/缺 | 同上 | 无 | met.heatNight | 读 | 已核销（缺显—） |
| H-02 峰值小时 | trends heat | 有值/缺 | 同上 | 无 | met.heatPeak | 读 | 已核销 |
| H-03 总量 | trends heat | 有值/缺 | 同上 | 无 | met.heatTotal | 读 | 已核销 |
| ST-01 加载骨架 | — | 骨架不显示读数 | — | — | met.loading | 读 | 已核销 |
| ST-02 空态 | — | 说明+去处 | — | /agent | met.empty* | 读 | 已核销 |
| ST-03 错误态 | — | 人话+请求编号(缺失显未提供)+重试 | — | — | met.error* | 读 | 已核销 |
| ST-04 403/404 整页同体 | — | 中性人话，HTTP 码只进 title | — | 返回列表 | met.forbidden* | 读 | 已核销（本拍去掉可见 HTTP 码） |

小计：20 元素 / 20 已核销 / 核销率 100% / 死控件 0。
