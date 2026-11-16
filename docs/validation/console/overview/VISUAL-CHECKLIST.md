# VISUAL-CHECKLIST — OV-01 逐元素视觉比对（lane/L4-ov01-c1-build2 @ 基线 3e0da05）

> 施工卡：`seakoi-agent-os-l0-board/docs/validation/console/overview/PAGE-BUILD-CARD-OV01.md`（PRD 对齐版 @ main e134743，76 行=PRD 71+外壳 5）
> 元素权威源：`docs/product/CONSOLE-PRD-OV01.md` @ main 1303437（不一致以 PRD 为准）
> C1 视觉唯一基准：`docs/product/design/console-v2/ov01-target.html` + `OV01-TARGET-SPEC.md`
> 本笔=第一笔提交，**只含本文件**。实现基线=3e0da05（batch A：overflow/趋势缩放/热力诚实/7d 默认）；8de0194（batch B 外壳）已移至本地 `lane/L4-ov01-batchB-hold`，其未提交 WIP 在 stash `batchB-wip-hold`，审阅后作为独立提交进入本分支。
> 卡§7/§8 标题与内容互换（§7 行=活动表 OV-AC*，§8 行=告警 OV-A*）；本表按行 ID 引用，不受影响。

## 参谋三拍板落点

- **GAP-OV-03**：队列/审批只出「待我审批」（assignee=human:uid）；页面在审批源行注记「组织级待办未接入（M2）」（此注记为 PRD 要求的产品缺口说明，非评审字样）；不改 AP8、不加 scope=tenant。
- **GAP-OV-19**：BFF `is_child_admin` 删除与 403 收紧属 BFF 域，本车道**不改 BFF**；页面层不放行（无绕过逻辑）。C4 由 BFF 侧判定。
- **C1 基准**：并排图左图一律取 `ov01-target.html` 渲染，不用 mockup-v2。

## 已知文本/口径差异（卡 §13 明文）

1. H01 标题取 PRD「**控制台总览**」（target 屏为「总览」，仅此文本项豁免 C1 视觉差异）→ 需把 `agentConsole.v2.ov.title` 中文值改为「控制台总览」。
2. H03 期间段默认「**近 28 天**」→ 当前 3e0da05 `DEFAULT_RANGE='7d'` 属偏差，**必须改回 28d**；KPI-3/AL-5/夜间注仍固定滚动近 7 天。
3. K2b 待审批 delta 槽：PRD 标「未实现」→ 页面置 `—` flat，不造假趋势（当前即如此）。
4. H04 刷新按钮：PRD 写「实心」、target 为描边（SPEC：总览主操作配额 0）。按「C1 视觉只认 target」用描边样式、保留 PRD 文案「刷新」与 refresh 图标；差异已在此明文，交 observer 裁定。

## 并排图约定

目录 `docs/validation/console/overview/shots/`，随各区块 push 同笔提交：

- 参考屏：`target-1440.png`（1440×900 fullPage 深色）、`target-375.png`（375×812）
- 实页：`impl-<区块>-1440-dark.png`、`impl-<区块>-375-dark.png`（fullPage，图宽精确 1440/375±1px）
- 同宽并排（左=参考 右=实现）：`pair-<区块>-1440-dark.png`、`pair-<区块>-375-dark.png`
- 全页：`pair-full-1440-dark.png`、`pair-full-375-dark.png`；几何读数（`document.scrollWidth/clientWidth`）写 `readout-build2.txt`

`<区块>` ∈ {shell, header, kpi, queue, trend, heat, cost, anomaly, activity, footer}。没有 pair 图不得 push。

---

## 外壳（S-1…S-5，卡 §3；当前基线=3e0da05 旧外壳，batch B 在 hold 分支）

| ID | 参考屏长什么样 | 当前实现长什么样（3e0da05） | 如何对齐 | 并排图路径 |
|---|---|---|---|---|
| S-1 左 rail | 72px 宽、右缘 1px hairline；Lucide 内联 SVG 1.5px+10px 标签；选中＝surface 底+左缘 3px accent；设置+头像钉底部无黑洞；待办 0 无徽标；375＝顶部粘滞横滚条+「可左右滑动」粘滞提示+active 滚入 | 旧 rail：非 72px、含 Unicode 字形（AgentConsoleV2Page `a2-rail-btn` 用 ▦/▶ 等 glyph idiom），无底部钉位 | 引入 batch B Shell.tsx（72px `a2s-rail`，RailIcon 内联 SVG，375 横滚+scrollIntoView）；复核 rail 宽 72±2、无 Unicode/emoji、徽标 0 不渲染 | shell：`pair-shell-{1440,375}-dark.png` |
| S-2 顶栏面包屑 | 56px；「控制台 › 总览」两级 chevron，当前页 500 权重 | 旧 topbar 无面包屑两级结构（或简版） | batch B `a2s-crumb`；文本精确「控制台 › 总览」；高 56±2 | 同上 |
| S-3 搜索胶囊 | 260×32 surface 底：search 图标+占位「搜索员工、审批、run id」+`⌘K` kbd；375 收 36px 图标 | 无搜索胶囊（3e0da05 顶栏缺） | batch B `a2s-search`；`⌘K` 聚焦；无搜索端点则不发请求并提示「搜索暂未接入」；375 不撑宽 | 同上 |
| S-4 环境药丸 | neutral 药丸+success 6px 点，文案「本地试点」，title「租户 seakoi · 环境 本地试点」；身份缺失→「环境未识别」 | 无 | batch B `a2s-chip`；补「环境未识别」分支 | 同上 |
| S-5 主题+用户菜单 | 太阳/月亮 icon 钮（非实心「深色」按钮）；用户=26px 头像+opsadmin+chevron；菜单默认关、Esc/外点关；localStorage 持久化 | 旧「深色」按钮+裸 opsadmin 文本 | batch B icon-only 主题钮+`a2s-ume` 下拉；深浅 DOM 同构零跳动 | 同上 |

## 区块① 页头（OV-H01…H07，卡 §1）

| ID | 参考屏 | 当前实现（3e0da05） | 如何对齐 | 并排图路径 |
|---|---|---|---|---|
| H01 标题 | h1 32px/600「总览」（PRD 取「控制台总览」） | `a2-h1` + i18n `ov.title`＝「总览」 | 中文 locale 值改「控制台总览」；h1.class=`a2-h1` ✓ | header：`pair-header-{1440,375}-dark.png` |
| H02 副标题 | 「全组织数字员工的在岗、运行、待办、成本与异常 · 只读监控面，处理请下钻对应模块」13.5px muted | `ov-sub` + `ov.ovSubtitle` ✓ | 核对中文值与 target 逐字一致；无写按钮 ✓ | 同上 |
| H03 期间段 | `.seg` 三钮，aria-pressed；只作用趋势+KPI 脚注 | 存在 ✓ 但 `DEFAULT_RANGE='7d'` | **改 28d**；非法值回落；URL `?range=` 五步复原测试；热力独立 weeks ✓ | 同上 |
| H04 刷新钮 | refresh 图标+「刷新」（target 描边；PRD 文案取「刷新」） | `a2-btn ov-refresh` 无图标 | 加 16px refresh SVG 图标；点击→token++ 全量重拉 ✓；无自动轮询 ✓ | 同上 |
| H05 新鲜度行 | clock 图标+「更新于 MM-DD HH:mm（本页最晚成功响应）」+口径句（UTC 日界/北京 08:00 换日/北京时间显示） | `ov-fresh` updatedLine+windowNote ✓（rangeShort/long 随窗口） | 28d 默认后措辞＝「近 7 天与近 28 天」；无「本周/今天」；updatedAt=null→「…」✓ | 同上 |
| H06 会话过期条 | （评审屏无 401 态；authExpired 时红条） | `agent-v2-ov-auth-expired` 条件渲染 ✓ | 保持；错误保留旧值+warn「部分数据较旧」；>5min 顶部细条（当前缺→补 warn 记录或细条，observer 判） | 同上 |
| H07 页脚 | 分块新鲜度+全局口径+`⌘K`/`⌘⇧R` kbd | `ov-pfoot` footerFreshness（审批/运行/热力共用全局 updatedAt）+footerCaliber，无 kbd | 各块记录各自成功时刻；补 kbd 文案；1440/375 不溢出 | footer：`pair-footer-{1440,375}-dark.png` |

## 区块② KPI（OV-K1…K4b 14 行，卡 §2）

| ID | 参考屏 | 当前实现 | 如何对齐 | 并排图路径 |
|---|---|---|---|---|
| K1 标签 | micro 10.5px 大写「在岗员工」 | `ov-kpi-onduty` `a2-micro` ✓ | testid/文本核对 | kpi：`pair-kpi-{1440,375}-dark.png` |
| K1a 主值 | 40px mono `2`；整卡下钻 employees?lifecycle=active&src=ov | `byLifecycle.active` ✓ NavLink ✓ | 截图值=2；active=null→'—' ✓；错误卡级 HTTP 码+retry ✓ | 同上 |
| K1b 点阵 | 118×46 14 等距点（r=1.6，viewBox 0 0 118 46） | `KpiDots` ✓ | DOM 核 viewBox/n/r | 同上 |
| K1c 脚注 | 「— 无趋势源 · 共 2 名在册，无入职中」 | `kpiNoTrend`·`kpiOnDutyFoot(total)` ✓ | 文本逐字核对 | 同上 |
| K2 待审批 | 主值 `0`；dueSoon 副注；no-uid 专用文案 | AP8 pending ✓ dueSoon 分支 ✓ | 与队列计数/rail 徽标三处相等；dueSoon≠pending ✓ | 同上 |
| K2a 点阵 | 同 K1b 无趋势源 | `KpiDots` ✓ | — | 同上 |
| K2b delta | flat「—」（PRD：未实现不造假） | flat — ✓ | 保持 | 同上 |
| K3 运行主值 | 40px `14`；R6 固定滚动 7d bucket=day **无 employeeId** | `run7Sums.runs`（window7 无 employeeId）✓ | 实测=14；脚注「成功 13 · 失败 0 · 1 条运行中/未知」 | 同上 |
| K3a spark | area 真实日桶 (1,0,0,13,0,0,0)，非平线 | `KpiSpark` polyline+area（sparkPoints 7 桶）✓ | 375 迷你图换行占满卡宽不挤压 | 同上 |
| K3b delta | ↗ +14 较上 7 天（上期 0） | deltaRuns 前窗比较 ✓ 绿 up 图标 ✓ | 截图核 +14 | 同上 |
| K3c 脚注 | 成功/失败/unknown `<em>`+vs 前 7 天 | ✓ | `<em>` warning 色 | 同上 |
| K4 成本主值 | `USD 0.13`（USD 19px+0 40px+.13 15px）；锚 #ov-cost | `UsdValue big` ✓ 拆分 ✓ | ΣP9=0.131073→0.13；无账目 —（不显示 0.00）✓ | 同上 |
| K4a spark | 累计 area (0,0,0.01,0.01,0.13,0.13,0.13) | `costSpark` cumulativeSeries ✓ | 与日桶真值一致 | 同上 |
| K4b 脚注 | thin 30 格+「30 格＝30 天 · 占月预算 0.7%（USD 0.13 / 20.00）」 | thin `ov-seg30` ✓ `quotaPctFoot` ✓ | thin 格 title 用与完整版同口径（当前写 `DD · USD/0/—`，改 `quotaCell*` 文案）；limit=null→`noteLedger` ✓ | 同上 |

## 区块③ 待处理队列（OV-Q01…Q07，卡 §3 区块表）

| ID | 参考屏 | 当前实现 | 如何对齐 | 并排图路径 |
|---|---|---|---|---|
| Q01 卡头 | 「待处理队列」+`0 项`+「审批 · 异常运行 · 任务超期 三源合并 · 只读」 | QueueBlock total=Σactionable ✓ | 计数不含终态 ✓；实测 0 项 | queue：`pair-queue-{1440,375}-dark.png` |
| Q02 审批腿 | clip 图标+「审批 `0 单`」+去审批中心 | `/api/approvals?assignee&status=pending&limit=5` ✓ truthCount 一致性 ✓ | **补 GAP-OV-03 注记**「组织级待办未接入（M2）」；错误 queueUnavailable/queueNoUid ✓ | 同上 |
| Q03 审批行 | 有数据行：状态药丸+中文动作名+等待时长人话（>48h 转 danger）+责任人+mono 短单号+动作；无裸「暂无数据」 | QueueRow 完整 ✓；评审「行结构示意」虚线框**不渲染** ✓ | 空态 hint 文案逐字：「这里会出现：待你审批、24 小时内到期、被驳回待修改的单据」 | 同上 |
| Q04 异常运行 | 「异常运行 `0 条`」+「这里会出现：失败、中断、超 24 小时未收敛的运行」 | since=now-24h ✓ | 实测 0；不混 completed | 同上 |
| Q05 任务超期 | 「任务超期 `0 个`」+「这里会出现：过了截止日期仍为 open / in progress 的任务」 | dueBefore+前端 TERMINAL_TASK_STATES 剔除 ✓ | 计数与行一致 | 同上 |
| Q06 药丸色 | pending/open→neutral、approve→ok、reject/failed→dg；未知 raw mono 保留 | `zhStatus` ✓ | STATUS_KEY 覆盖核对 | 同上 |
| Q07 操作者 | 裸名 opsadmin/runtime/system（strip 前缀） | `displayActor` ✓ | null→'—' ✓ | 同上 |

## 区块④ 运行趋势（OV-T01…T09）

| ID | 参考屏 | 当前实现 | 如何对齐 | 并排图路径 |
|---|---|---|---|---|
| T01 卡头图例 | 「运行趋势」+窗口 chip+五图例（成功/未知/失败/P95 灰化「样本不足<20 未绘制」/事件虚线） | `ov-clegend` 五项 ✓ | 28d 默认 chip=「近 28 天」；375 图例换行不溢出 | trend：`pair-trend-{1440,375}-dark.png` |
| T02 摘要行 | 「14 次 13 成功 0 失败 1 条运行中/未知 计入总数 100.0% 成功率（分母只含终态） — P95（样本不足）」 | `ov-tsum` ✓ 结构与 target 逐项对 | 三处一致（KPI-3/摘要/卡脚）；禁 13 当总数 | 同上 |
| T03 堆叠柱 | 28 天三段堆叠；左轴 0–15 网格；缺日留空不补 0；11-10=1、11-13=13（成功 12+未知 1）；SVG=容器宽不撑破 | byDay+rangeDays 断点 ✓ `maxTot=max(5,ceil(max/5)*5)`→15 ✓ useElementWidth 实测宽 ✓ | 28d 窗口下两柱位置正确；bw=min(16,slot-6) | 同上 |
| T04 今日框 | 今日列虚线框+「不完整日」 | `trend-today-frame` ✓ stroke-dasharray 2 3 ✓ | 11-16 无数据仍画框 ✓ | 同上 |
| T05 事件线 | 11-15 accent 虚线+圆点+文字标签，靠右缘翻转；标签不叠字不溢出 | eventsByDay 中文标签 ✓ flip/clamp ✓ | 截屏验证两事件（岗位版本创建/审批已决）标签不叠 | 同上 |
| T06 x 轴 | MM-DD 每 4 天一刻度+末日 | `i%4===0||last` ✓ slice(5) ✓ | 28d 下 7 刻度不撞 | 同上 |
| T07 tooltip | hover 弹层：日期星期+成功/未知/失败+P95(样本不足)+成本；右缘钳制 | ✓ left clamp W-176 ✓ | hover 截图（如需） | 同上 |
| T08 卡脚 | 「按 UTC 日界分桶 · 成功 13 · 失败 0 · 1 条运行中/未知（计入总数 14）」+「虚线＝当天事件；今日尚无运行，虚线框为不完整日」 | `trendFoot`+`utcBucketNote`+`trendTodayFrame` ✓ | 文本与 target 逐字 | 同上 |
| T09 P95 | 样本<20 整条不画；缺键=断点非 0；tooltip「样本不足」 | `p95HasSample`+`p95DurationMs` null 处理 ✓ | 实测<20：无假线 ✓ 图例 off+文字 ✓ | 同上 |

## 区块⑤ 热力（OV-HE01…HE10）

| ID | 参考屏 | 当前实现 | 如何对齐 | 并排图路径 |
|---|---|---|---|---|
| HE01 卡头 | 「活动热力」+「近 4 周」chip+窗口起止口径注+4/8/12 段控件 | weeks 参数真实驱动 R7 ✓ `heatCaliberLine` from/to ✓ | 8/12 可点（PRD 真实逻辑，非 target disabled 标注）；窗口注精确 | heat：`pair-heat-{1440,375}-dark.png` |
| HE02 小时轴 | 00/03/…/21 八刻度，grid span 3 与 24 列严格对齐 | `ov-hax` gridColumn h+1/span 3 ✓ | 轴+格同容器随横滚 | 同上 |
| HE03 星期轴 | 周一–周日标签在左；PRD：周六日按 locale 现值 | `HEAT_DAY_KEYS` v2 keys | 核 locale：五中两英则统一为全中文（与 target 一致）| 同上 |
| HE04 焦点行 | 今天行：标签 foreground+600+左 2×14 accent 短条 | `hrow.now` ✓ beijingNow ✓ | 样式对齐 target | 同上 |
| HE05 网格格 | 真 7×24；格 28×28 缝 2 圆角 3；绝对档位 1→l1、5→l2、8→l3；缺格=0 | `level()` 绝对映射 ✓ cells 168 真格 ✓ | 实测：周二 15:00=1、周五 14:00=8、15:00=5、合计 14；title「周几 时:00 · N 次（近 4 周）」✓ | 同上 |
| HE06 当前格 | 北京时间当前小时格 1.5px 内描边仅一格 | `nw` 单格 ✓ | 补 testid=`agent-v2-ov-current-cell`（PRD 若实现）| 同上 |
| HE07 图例 | 下方「少 ▫▪▪▪▪ 多」+「每格＝1 小时 · 颜色仅表运行次数（仅 count，无失败维度，故不画异常档）」 | `ov-hfoot` ✓ 六档色块 ✓ | 不渲染异常黄档 ✓（GAP-OV-09） | 同上 |
| HE08 周数 chip | 「近 N 周」aria-pressed 联动 | `ov-weeks-*` ✓ | URL 回放 | 同上 |
| HE09 三数+夜间 | 峰值 `8 次/时` 周五14:00–14:59+当日合计；夜间 `0 次/时`+「窗口内没有夜间运行」（禁 0.4 并存）；合计 14+成功/失败/未知+焦点行 | 三数结构 ✓ nightZero 同源自 nightTotal ✓ | 与网格求和闭环（截图核 8/0/14）| 同上 |
| HE10 空态 | 网格仍 7×24 全 0+「窗口内无运行」 | heatEmpty ✓ | 文案含周数 | 同上 |

## 区块⑥ 成本与预算（OV-CB01…CB09）

| ID | 参考屏 | 当前实现 | 如何对齐 | 并排图路径 |
|---|---|---|---|---|
| CB01 卡头 | 「本月成本与预算」+`2026-11` chip+口径注「金额来自成本账本（USD）· 无账目显示 —，不显示 0.00」；id=#ov-cost | `ov-cost` monthLabel(北京时间) ✓ costCaliber ✓ | 锚点与 K4 联动 ✓ | cost：`pair-cost-{1440,375}-dark.png` |
| CB02 总额 | 40px `USD 0.13` + 右 `0.7% / of USD 20.00` | `UsdValue`+`qmeta` ✓ pct<10→toFixed(1) | 0.7% 精确 | 同上 |
| CB03 配额行 | 「USD 0.13 / 20.00 · 剩余 19.87」 | `quotaRemain` ✓ | limit=null→「月预算上限未接入」✓ | 同上 |
| CB04 30 格 | 每格=当日成本/日均额度(20/30≈0.67)；11-10 2% 绿、11-13 18% 绿；未到/未消耗 idle 灰；title 明细；>85% 红（D-5 单格非累计） | `QuotaSegments` ✓ 阈值 60/85 ✓ title 三态 ✓ | 两绿格数值正确 | 同上 |
| CB05 图例 | 三档带文字+「未消耗/未到」 | `ov-qlegend` 四项 ✓ | 只有颜色无文字=不合格 | 同上 |
| CB06 外推 | 「按当前速度月底预计 USD 0.24（线性外推 · 当月已过 16 天）；1 条运行尚无成本账目，实际可能略高」 | projection=(used/today)*days ✓ projectionUnknown ✓ | 截图核 ≈0.24；分母缺失不显示 ✓ | 同上 |
| CB07 员工行 | 两行「AgentOS 产品助理 f2b540/a22649 · 成本账本 上游实测」+墨色细条+1.2%/0.1%+USD 0.12/10.00 剩9.88、0.01/10.00 剩9.99；同名带 ID 短后缀 | `ov-empq` idTail 6 位 ✓ clip ✓ ratio 色档 ✓ | ≤1279 隐条仅文字 ✓ | 同上 |
| CB08 降级 | 分母缺失：不画假条（D-5/GAP-OV-06） | quotaNoDenominator/quotaNoLimit ✓ | — | 同上 |
| CB09 卡脚 | 「同名员工以员工 ID 短后缀区分」+「打开运行指标 · 成本 →」 | `costFootSuffix`+metrics NavLink ✓ | 文本核对 | 同上 |

## 区块⑧ 行=异常/告警（OV-A01…A06）

| ID | 参考屏 | 当前实现 | 如何对齐 | 并排图路径 |
|---|---|---|---|---|
| A01 卡头 | 「异常/告警」+`1 条` chip+「扫描于 11-16 09:25」；无告警中心链接 | hits=(failed>0)+(dueSoon>0)+(unknown>0) ✓ scannedAt ✓ | 实测 hits=1（仅 AL-5） | anomaly：`pair-anomaly-{1440,375}-dark.png` |
| A02 失败条 | failed>0 才出现（本期 0 不显示） | runs7 failed ✓ | 无假告警 ✓ | 同上 |
| A03 dueSoon 条 | dueSoon>0 才出现（本期 0 不显示） | ✓ | 无假告警 ✓ | 同上 |
| A04 AL-5 条 | info 药丸+「1 条运行尚无成本账目（可能仍在运行），成本统计可能偏低」+「规则 AL-5 · 近 7 天无账目运行」mono+「看运行」→/agent/runs | `ov-anomaly-noledger` ✓ unknownRuns=max(direct,residual) ✓ | 规则号+动作可见可用 | 同上 |
| A05 扫描行 | 「已扫描：审批 24h 到期（0）· 审批积压 48h（0）· 近 24h 失败率（0/13）· 员工预算 ≥85%（0/2）· 无账目运行（1）」+固定阈值声明（24h/48h/15% 暂不可配） | `anomalyScanLine` ✓ **backlog 现写死 '—'** | **改：pending==0→(0)；>0 无源保持 — 不编造**；失败率=7d terminal 0/13 ✓；AL-3 无分母→不出现 ✓ | 同上 |
| A06 空态 | hits=0：「暂无需要处理的异常」+扫描范围+刷新；**区块永不省略**（G1） | ✓ | 诚实空态有结构 | 同上 |

## 区块⑦ 行=最近活动（OV-AC01…AC09）

| ID | 参考屏 | 当前实现 | 如何对齐 | 并排图路径 |
|---|---|---|---|---|
| AC01 卡头 | 「最近活动」+`近 24h · 审计事件`+「打开审计中心 →」 | ✓ ACTIVITY_LIMIT=8 | — | activity：`pair-activity-{1440,375}-dark.png` |
| AC02 表头 | 时间112/来源88/动作/操作者120(hide-sm)/结果96，micro 10.5 大写 | 五列 ✓ widths 近似(96 vs 88) | 375 操作者列隐藏 ✓ 表不撑宽 | 同上 |
| AC03 时间列 | `MM-DD HH:mm` mono nowrap 北京时间；跨年加年 | `fmtTime` ✓ | 核格式 | 同上 |
| AC04 来源列 | SVG 图标+中文（员工/审批/授权/预算/运行）；action=null→审计源 | `actionMeta` 前缀映射 ✓ | 无裸英文来源 | 同上 |
| AC05 动作列 | 中文上屏名 13px/500+下行 mono 原值（`approval.consumed`）；未知→「其他活动」+原值；snake_case 永不裸奔 | ✓ | 全文扫描无裸 snake_case 主文案 | 同上 |
| AC06 操作者列 | opsadmin/runtime/system 裸名；null→— | `displayActor` ✓ | 实测非全 — | 同上 |
| AC07 结果列 | 中文药丸（成功/批准/失败/已消费）带点 | `zhStatus`/resultLogged ✓ | 无英文裸值 | 同上 |
| AC08 截断提示 | >8 行时「仅显示最近 8 条」类注记 | `queueTruncated` ✓ | truncated=0 不显示 ✓ | 同上 |
| AC09 口径注 | 「事件按时间倒序，含运行/审批/员工/预算变更；不展示消息全文与凭据；行内动作原值来自审计 action 字段」 | `actCaliber`（lg-only） | 文本逐字对齐 | 同上 |

## 实施顺序（每块 pair 后 push）

1. **shell+header**：cherry-pick/重建 batch B 外壳 + `DEFAULT_RANGE=28d` + 标题「控制台总览」+ 刷新图标 + H06 保留旧值。
2. **kpi**：thin 配额 title 口径统一；数值截图核验 2/0/14/USD0.13/0.7%。
3. **queue**：GAP-OV-03 注记；文案逐字。
4. **trend**：28d 窗口下柱位/事件/今日框/pair 验证。
5. **heat**：HE03 星期轴 locale、HE06 testid、三数闭环。
6. **cost**：数值闭环 0.13/20.00/0.7%/19.87/0.24。
7. **anomaly+activity+footer**：A05 backlog (0)、分块新鲜度、kbd。
8. 全页：1440/375 scrollWidth==clientWidth 读数、undefined/NaN/snake_case/假 0 扫描、深浅 DOM 同构。

> 覆盖核对：外壳 5 + H7 + K14 + Q7 + T9 + HE10 + CB9 + A6 + AC9 = **76 行**，与施工卡 76 行一致；PRD 71/71+外壳 5。C1 由 observer 判，实现人不自评。
