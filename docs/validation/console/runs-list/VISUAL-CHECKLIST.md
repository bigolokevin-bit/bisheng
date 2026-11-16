# RUN-01 运行列表 VISUAL-CHECKLIST（参考屏 ↔ 当前实现 逐区块对照）

- 基线：bisheng 仓 `lane/L4-run01-page` @ `ac6d38c`（工作树 `/Users/kevin_studio/Projects/bisheng-run01-page`）。任务书写的 `ea285db` 非现 main 祖先，已按「从 origin/main 新建」执行，此处记录偏差。
- 唯一视觉基准（取自主仓 `seakoi-agent-os` main `63e84cc`）：`docs/validation/console/runs-list/run01-target.html`（59,595B，sha256 `1cbe16337a7aafacf0e6f6e65c32b080af0fa60ef151ca5e2c4c93b908c24981`）+ `RUN01-TARGET-SPEC.md`（31,736B，sha256 `51f943152ed458bdefdfa133b2b81c81f15a598faa8c0ff514cf293f60a49703`）；判定口径 `ACCEPTANCE.md`；L6 复核 `L6-CHECKLIST.md`。
- 实现载体：`src/frontend/platform/src/pages/AgentConsoleV2/RunsSection.tsx`（629 行旧「运行与追踪」卡片流，`AgentConsoleV2Page` 内挂载）。**不追 `RunsListPage.tsx` phantom**（全仓无 tracked 该文件）。
- 仓归属备注：基准文件只存在于主仓 main；bisheng 仓无 `docs/validation/console/runs-list/` 副本，本目录随本笔新建，**不复制基准文件、不修改主仓 docs**。

## 0. 总口径（每区块共用）

- 只读：无重跑/中止/删除/批量/新建入口；「查看」在 RUN-02 未建时禁用 + title 说明；无行点击假跳转；写入口 DOM=0。
- 无 total 口径（SPEC 头部裁决）：R5 只有 `items` + `nextCursor`。页脚「本页 N 条」+「下一页」；筛选计数「已加载 N 条」；**禁止**「共 N 条 / 显示 a–b / 页码器 / 上一页 / chip 计数 / KPI」。出现即 FAIL。
- 筛选仅真实服务端维度：`employeeId / status(单选) / since(24h/7d默认/30d 恒发送) / limit(20默认/50/100) / cursor`；全部写 URL query，刷新恢复；`src` 等杂散参数不消费不报错。
- 无来源筛选（无服务端参数→控件禁用+title 原因）、无 costStatus 筛选（仅行内）、无自由文本搜索、无排序控件。不得客户端假筛/假搜。
- 游标防重放守卫（SPEC §7，本卡第一红线）：记录每页 cursor 与 runId 集合；新页与任一已见页相交→不合并、停止、上屏「游标已失效，请重试」+ 显式「重新加载第一页」；守卫触发后无第三次自动请求；不静默回首页；筛选变化清空已见集合重查。单测硬测等价覆盖（参照 EMP-03 同款但不复用其测试）。
- 诚实数据（G15 系）：上游内部码（`request.missing_filter`、`console.unauthenticated` 等）不上屏，只本地化文案 + HTTP 状态码 + request id；全页禁「待接入」；禁 undefined/NaN/[object Object]。
- 数据全走真实 BFF：`GET /agent-api/api/runs`（R5 主源）+ `GET /agent-api/api/run-detail?id=`（R2 单行懒拉补 costUsd/costStatus/employeeVersionNo/endedAt，失败该格 —/unknown + 行内重试，不整页报错）+ `GET /api/employees?limit=100`（候选名）。禁止 fixture 进 bundle；R3 事件本页不消费（归 RUN-02）。

## 1. 外壳（rail + 顶栏）

| 参考屏区块 | 当前实现 | 如何对齐 | 只读约束 | 375 口径 |
|---|---|---|---|---|
| 72px SVG rail 8 项（总览/员工/审批/任务/运行/指标/审计/设置），运行=当前态 | 复用 V2 壳（`Shell.tsx`/`consoleShell.css`，OV 轮产物） | 直接沿用不改壳；active 态指「运行」 | 壳无写入口 | rail→顶部横滚导航，当前项滚入视野+滑动提示 |
| 顶栏 56px：面包屑「控制台 › 运行」+ 环境 pill + ⌘K 搜索胶囊 + 主题 + 用户区 | 已有 | 沿用；搜索胶囊是**外壳级**，不是本页搜索 | — | 顶栏换行、搜索收图标 |

## 2. 页头

| 参考屏区块 | 当前实现 | 如何对齐 | 只读约束 | 375 口径 |
|---|---|---|---|---|
| h1「运行」32px + 口径句「数字员工每一次执行的记录——谁跑的、跑了多久、花了多少、结果如何；耗时与成本只认上游事实，未结束不编数字」 | 无独立页头（RunsSection 只有 `a2-h2` runsTitle） | 新增页头；文案照抄 SPEC §1.2；键走 locale 三语 | 纯文案 | 自动换行 |
| 元信息行：更新于 · 示例数据声明（仅参考屏；施工页替换为真实数据声明）· 数据源 R5 · 口径句「只读列表，无重跑、中止、删除与批量入口」 | 缺 | 补「数据源：运行契约 R5」+ 只读口径句；参考屏「示例数据」warning 行施工删除（§5 禁示例数据验收） | — | 换行排列 |
| **无 KPI 层**：页头后直接接筛选条，不预留空位、不做骨架 | 无 KPI（合规） | 保持；任何 run-stats 上屏即误导（R6 归 MET-01） | 无全局聚合 | 同左 |

## 3. 筛选条（V2.10 FilterBar 跨页同构；仅真实服务端维度）

| 参考屏区块 | 当前实现 | 如何对齐 | 只读约束 | 375 口径 |
|---|---|---|---|---|
| 员工 描边 Select chip → `employeeId`；候选 `GET /api/employees?limit=100`；解析失败降级 raw id | 有 select（`agent-v2-runs-filter-employee`，limit=200 拉全量） | 改描边 chip 形态+弹层；候选 limit=100 按卡；`aria-haspopup=listbox` | 只读 | 全宽堆叠 |
| 状态 chips ×7（全部+排队中/运行中/已完成/失败/已取消/已中断），软色圆点、**无计数**、单选语义 | 有 seg 按钮组（`agent-v2-runs-status-*`），无圆点 | 改 chip 组+语义色圆点（completed→success、pending/running→warning、failed/cancelled/interrupted→danger）；「全部」neutral 无点；无计数 | 只读 | chip 换行 |
| 时间范围 seg 24h/7d(默认)/30d → `since`，**恒随请求发送** | 无（固定近 7 天文本 `agent-v2-runs-window`） | 新增三档 seg；since=档位换算 ISO 起点；不发无条件请求 | 满足上游「至少一过滤」 | 全宽 |
| 每页条数 Select 20/50/100，默认 20 → `limit` | 无（固定 RUNS_LIMIT=50） | 新增；默认 20；随请求与页脚口径注联动 | — | 全宽 |
| 来源 chip **禁用** + title「来源没有服务端筛选参数，只在行内展示；不做客户端假筛」 | 缺 | 新增 disabled 控件+原因 | 不假筛 | 全宽 |
| 清空 ghost：默认 disabled（title「当前没有可清除的筛选」），有员工/状态筛选后解禁 | 缺 | 新增；重置回默认（since 回 7d） | 只读 | 全宽 |
| 结果计数「已加载 **N** 条」mono 加粗，无分母 | 缺 | 新增；=已加载 items 数；禁「共 N」 | 无 total | 同左 |

## 4. 主表格（一张卡，内边距 0；10 列顺序固定，AC §3）

| 参考屏区块 | 当前实现 | 如何对齐 | 只读约束 | 375 口径 |
|---|---|---|---|---|
| 10 列：运行｜员工｜状态｜耗时｜成本｜来源｜版本｜开始｜结束｜操作；行高 52、水平发丝线、`table-layout:fixed` + `min-width:1100px`、列宽按 SPEC §4.1 | **卡片流**（`a2-run-card` 展开式）→ 形态偏差 SPEC §10.1，按卡**替换**非增量修补 | 重写为 10 列表格；删 R3 时间线展开（`RunTimeline`/`runTrace` 消费在本页移除，trace 模块本体留 RUN-02 用） | 只读 | **卡内横向滚动**（AC §4 点名，非 TSK 行卡式，SPEC §10 偏差 4）；页面零横溢出 |
| 运行列：mono 截断（前缀+ULID 前 4 后 4）+ hover 复制按钮，「已复制」1.2s，键盘可达，title 全值 | 有 `shortRunId`+title，**无复制按钮** | 复用 EMP/TSK 复制习语加复制按钮（clipboard+aria-live「已复制」） | — | 列随卡横滚 |
| 状态药丸六形态：点+文字双编码；未知枚举 loud log+原值降级 | 有 `statusPillClass`+`runStatusLabel`（已含守卫） | 沿用映射；确认双编码（圆点+文字） | 只读 | 同左 |
| 耗时 `endedAt−startedAt` 人话（`Ns`/`NmSSs`/`NhMMm`）；未结束/负值/非法 `—`；title 挂两端 ISO | 有 `formatDuration`（逻辑已合规） | 沿用；title 补两端 ISO | 不编数字 | 右对齐 mono |
| 成本：上行 `costUsd` 原值 mono（`0.009875` 不二次舍入）+ 下行 costStatus 药丸 xs（upstream=「上游实测」/estimated=「估算」）；**unknown=字面 `unknown` 无药丸不顶 0**；双 null `—` | `formatCost` 原值 OK；但 `COST_STATUS_KEYS` 对 unknown/null 渲染 `—` → **偏差 SPEC §10.2，按卡改字面 unknown** | 修正 unknown 分支；R5 空字段走 R2 懒拉补齐（§2.2 两段口径） | 不顶 0 | 右对齐 |
| 来源列=消息图标 + `channelEventId` mono 截断（前 6 后 4），无则 `—`，title 全值；**不是 channel 中文名**（R5 无该字段，不得发明） | 缺列 | 新增；截断仅视觉 | 不发明 | 随横滚 |
| 版本=employeeVersionNo 整数原值 mono（不加 `vN` 自造格式） | 缺列 | 新增 | 不编格式 | 右对齐 |
| 开始/结束 **Asia/Shanghai `MM-DD HH:mm`**（当年不带年份）；结束可空 `—`；title 全 ISO | `formatMoment` 直切 ISO 串（`slice(0,16).replace('T',' ')`）→ UTC 值上屏**非北京时间，偏差** | 改 Intl `Asia/Shanghai` 格式化；R2 补 endedAt | 不编时间 | 右对齐 |
| 操作「查看」描边 xs **disabled** + title「运行详情页（RUN-02）尚未上线，暂不可查看」；无死链 | 无（现为展开时间线按钮→按卡移除） | 新增禁用按钮；`?run=` 参数不在本页承诺（SPEC §10.3，与参谋对齐，不自造高亮） | RUN-02 未建 | 随横滚 |
| 行交互：仅 hover；**不做行点击/选中态** | 卡片可展开（假可点语义） | 删展开；hover `--hover` | 避免假可点 | 同左 |
| 禁止列：摘要（R2 无 summary）、截断徽标（eventsTruncated 不在 R3，BW-09）、reasonCode（归详情） | 无 | 保持不出现；出现即自造列 FAIL | — | — |

## 5. 分页脚（无总数口径）

| 参考屏区块 | 当前实现 | 如何对齐 | 只读约束 | 375 口径 |
|---|---|---|---|---|
| 「本页 N 条」mono + 口径注「游标分页 · 每页 N 条 · 无总数」 | **无分页**（固定首页 limit=50，不消费 nextCursor）→ SPEC §10.1 偏差 | 新增分页脚；消费 `nextCursor`；cursor 写 URL（replaceState） | 无 total | 换行，「下一页」不被遮挡 |
| 「下一页」：仅 `nextCursor` 存在时可点；null→disabled+title「已是最后一页」；显式点击，无自动加载 | 缺 | 新增 | 只进不退 | 同左 |
| 禁止：上一页/页码器/「共 N」/「显示 a–b」 | — | 不实现 | — | — |
| 横滚提示「表格可左右滑动」（<1280 显示，≥1280 隐藏） | 缺 | 新增 | — | 375 必显 |
| 口径脚：「耗时＝结束−开始，未结束显示 —；成本为上游原值不二次舍入，unknown 不顶 0；时间为北京时间（Asia/Shanghai）；来源为渠道消息引用，无则 —；版本为员工版本号」 | 缺 | 文案照抄 SPEC §1.5 | — | 自动换行 |

## 6. 五态屏（评审条施工删除，各态本体保留）

| 态 | 参考屏 | 当前实现 | 如何对齐 | 375 口径 |
|---|---|---|---|---|
| 正常 | 页头+筛选+10 列表+分页脚 | 卡片流 | §2–§5 对齐 | 单列 |
| 加载 | 筛选条与表格**骨架**（`--surface-2` 无闪烁）+「超过约 10 秒未返回将切换到错误屏」 | 纯文本 loading（`agent-v2-runs-loading`） | 改骨架块+说明句；无 KPI 骨架、无假进度 | 同左 |
| 空态 | 保留激活筛选+卡内嵌面板：图标+主句「暂无运行」+指引+清空按钮；两分支（有筛选/无任何运行）文案见 SPEC §3 | `runsEmpty` 一句 | 文案照抄两分支；禁「暂无数据」了事 | 居中换行 |
| 错误 | 单卡居中：图标+「运行列表没能加载出来」+人话辅句+**HTTP 状态码**（mono）+「重新加载」/「先回总览看看」；400 缺过滤变体单独文案（SPEC §3） | 泛化 error+retry，无状态码、无 400 变体、无回总览 | 按状态分支本地化；补 HTTP 码+request id 展示；重试保留当前筛选；内部码不上屏 | 居中卡 |
| 无权限 | 403：锁图标+「您还看不到运行列表」+开通指引+HTTP 403+「已开通，刷新试试」；404 同体仅码不同不泄露存在性；401→跳登录（路由守卫） | 无区分 | 按 status 分支 403/404；401 AuthError→登录跳转；不泄露数据行 | 居中卡 |
| 游标失效 | 「游标已失效，请重试」+辅句+「重新加载第一页」显式按钮 | 无 | §0 守卫实现；此态为分页脚内联文案 | 同左 |

## 7. GAP 与裁决声明（施工纪律）

- `finishedAt` 不存在：R5 字段为 `endedAt`（SPEC §2.5）→ 以 endedAt 为准。
- 状态色 cancelled/interrupted=danger 为 **RUN 契约**（与 TSK cancelled=neutral 不同，SPEC §2.5）；沿用 `statusPillClass`。
- R5 不消费字段清单（SPEC §2.1 末段）：tenantId/policySnapshotRef/upstreamRunId/taskId/previousRunId/attemptNo/reasonCode/budgetCapUsd/lastEventSeq/createdAt/updatedAt——存在但不上屏，不得发明用途。
- 状态多选/搜索/排序/来源筛选/costStatus 筛选：无服务端参数→本期一律不做。
- `?run=` 参数（TSK 行内跳转带入）：RUN-01 卡未定义，参考屏不承诺；施工忽略该参数不报错，处理逻辑待参谋对齐。
- 颜色令牌零自创（SPEC §6）：深浅共用同一 DOM，仅 THEME 块；施工用既有 `agent-v2` / `consoleShell` 令牌体系，不新增色值。
- 示例数据（SPEC §5）只比结构/口径/形态，不比数值；真实数据走真实 BFF。

## 8. 首笔边界

本笔**只含本文件**。UI 施工在后续笔：`RunsSection.tsx` 按本 checklist 重写为 10 列游标表格 + `agentConsoleRuns.ts` 消费 cursor/limit/since 参数 + locale 三语键 + 防重放守卫单测；每笔 push，targeted vitest + 既有 eslint 二进制（`/Users/kevin_studio/Projects/bisheng-ov01-build/src/frontend/node_modules/.bin/eslint`，禁 install）从 `src/frontend/platform` 跑 touched 文件 + diff-check。C1（1440×900/375×812 深色 served 截图与 target 并排）在 UI 笔后本地完成；**C1 未过不部署、不进 L6**；不合并 main；不判 PASS。
