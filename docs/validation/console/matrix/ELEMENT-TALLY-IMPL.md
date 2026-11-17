# MATRIX-01 实现侧元素核销（MATRIX-R3）

- 车道：L4p4 / 分支 `lane/L4-page-aud` / 基座 `1ab08ce`
- 设计源：`docs/product/console-v3/MATRIX-ELEMENTS.md`（分母 20；标称 21，差 1 已注明）
- 数据源：BFF `GET /agent-api/api/matrix` → 上游 `/v1/matrix/employees`（尚未部署，缺数据一律 `—`）
- 本文件是**实现侧**核销；QA 版本为 `ELEMENT-TALLY.md`，未覆盖、未改动（本树内该文件为 30 行实现版，未见 QA 39 行版，已在回执说明）
- 状态口径：`已核销` = 元素在 DOM 可见且有验收腿；`设计源要求但本期不做` = 设计源有、实现未做（blocked，非死控件）；`无缺陷` = 复核后确认口径正确、无需改动

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| HEAD-01 | `mtx.title` | 静态（四态常显） | 读 | — | `agentConsole.v2.mtx.title` | 页头 h1 渲染 | 已核销 |
| HEAD-02 | `mtx.desc` | 静态 | 读 | — | `mtx.desc` | 描述段渲染 | 已核销 |
| HEAD-03 | 设计源「新建员工」唯一 primary | — | 写 | — | — | — | 设计源要求但本期不做（只读页，无写入口；非死控件） |
| FILT-01 | 设计源筛选区 | — | 读 | — | — | — | 设计源要求但本期不做 |
| FILT-02 | 设计源状态筛选 | — | 读 | — | — | — | 设计源要求但本期不做 |
| SUMR-01 | 设计源汇总条 | — | 读 | — | — | — | 设计源要求但本期不做（行数由 `mtx.loaded` 承接） |
| GRID-01 | 设计源列头/排序 | — | 读 | — | — | — | 设计源要求但本期不做（卡片流布局） |
| GRID-02 | `items[]` | 加载/空/错/超时/403=404 | 读 | — | `mtx.loaded` | `agent-v2-mtx-rows` / `agent-v2-mtx-count` | 已核销 |
| GRID-03 | `items[].employeeId` | 同上 | 读 | 员工详情 `/agent/employees/:id` | — | `agent-v2-mtx-link`（姓名链） | 已核销（R3 复核真跳） |
| GRID-04 | `items[].name` | 同上 | 读 | — | `mtx.unnamed` | `agent-v2-mtx-ava`（首字头像） | 已核销 |
| GRID-05 | `items[].employeeId` | 同上 | 读 | 运行记录 `/agent/runs?employee=<id>` | `mtx.linkRuns` | `agent-v2-mtx-jump-runs` | 已核销（R3 新增真跳） |
| GRID-06 | `items[].employeeId` | 同上 | 读 | 审计记录 `/agent/audit?employee=<id>` | `mtx.linkAudit` | `agent-v2-mtx-jump-audit` | 已核销（R3 新增真跳） |
| GRID-07 | `items[].name` + `currentVersionId` | 缺失 → `未命名员工` / 无消歧 | 读 | — | `mtx.unnamed` | `agent-v2-mtx-disambig`（同名追加 8 位短码） | 已核销（R3 新增消歧） |
| GRID-08 | `lifecycleState` | 未知值原样药丸 | 读 | — | `mtx.st*` 六值 | `agent-v2-mtx-status` | 已核销（别名归一；R2 起状态上屏） |
| GRID-09 | `currentVersionId` | 缺失 → `—` | 读 | — | `mtx.version` | `agent-v2-mtx-version`（8 位短码，原串仅 title） | 已核销（R3 去裸串） |
| GRID-10 | `skillCount` | 缺失 → `—` | 读 | — | `mtx.skills` | `agent-v2-mtx-skills` | 已核销 |
| GRID-11 | `budget.dailyTokens` / `monthlyCostUsd` / `perRunMaxUsd` | 缺字段 → `—`；部分配置另标「未配置」；null 预算 `—` | 读 | — | `mtx.budgetMonthly` / `budgetDaily` / `budgetPerRun` / `budgetUnset` | `agent-v2-mtx-budget-monthly` / `-budget-daily` / `-budget-perrun` / `-budget-partial` | 已核销（R3 三键全上屏，绝不 USD 0.00） |
| GRID-12 | `todayRuns.total/succeeded/failed` | 无键/无 total → `—`；`total=0` → 今日未运行 | 读 | — | `mtx.runs` / `mtx.runsNone` / `mtx.runsDetail` | `agent-v2-mtx-runs` | 已核销 |
| STATE-05 | 设计源降级态 | — | 读 | — | — | — | 设计源要求但本期不做（缺值降级已由 `—` 承接） |
| FOOT-01 | 设计源口径脚注 | — | 读 | — | — | — | 设计源要求但本期不做 |

## 汇总

- 元素总数：20（设计源分母 20）
- 已核销：13
- 设计源要求但本期不做（blocked）：7（HEAD-03、FILT-01、FILT-02、SUMR-01、GRID-01、STATE-05、FOOT-01）
- 核销率：65%（13/20；按「已落地且有验收腿」计）
- 死控件：0（blocked 元素为未实现，不以纯文本或不可点控件冒充）

## 本轮（MATRIX-R3）修复对照

| 判据 | 修复 |
|---|---|
| 岗位版本裸 `empv_` 全串 | `versionShort()` 取 8 位短码，原串只进 `title` |
| 预算只 1/3 键上屏 | 三键各自上屏，缺字段 `—`，部分配置另标「未配置」 |
| 同名两卡无消歧 | 同名时姓名后追加 8 位短码（`agent-v2-mtx-disambig`） |
| 风险单元孤立 `—` | 单元加「风险」标签，缺数据不再无标签裸 `—` |
| `?focus` 零反馈 | 已实现：命中行滚动居中 + 高亮描边，URL 不改写（`data-focus="true"`） |
| GRID-03/05/06 纯文本冒充 | 三处均为真实 `NavLink`（员工详情 / 运行记录 / 审计记录） |