# MATRIX-01 元素核销表（/agent/matrix）

数据源：`GET /agent-api/api/matrix`（BFF 透传上游 `/v1/matrix/employees`）。只读页，零写入口。
七态口径：正常 / 空 / 加载 / 错误(HTTP) / 超时 / 401 / 无接口占位。

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| mtx-01 | 静态 | 全态 | 只读 | — | `mtx.title` | Matrix.test 渲染断言 | 已核销 |
| mtx-02 | 静态 | 正常/空/错误 | 只读 | — | `mtx.desc` | 同上 | 已核销 |
| mtx-03 | `items.length` | 正常 | 只读 | — | `mtx.loaded` | 计数断言 | 已核销 |
| mtx-04 | `items[]` | 正常/空 | 只读 | — | — | `agent-v2-mtx-rows` | 已核销 |
| mtx-05 | `name` 首字 | 正常 | 只读 | — | — | 头像断言 | 已核销 |
| mtx-06 | `employeeId`+`name` | 正常 | 只读 | `/agent/employees/:id` | `mtx.unnamed` | 详情链断言 | 已核销 |
| mtx-07 | `lifecycleState`｜`lifecycle` | 正常；未知原样 | 只读 | — | `mtx.st*` | 大小写/未知值/别名用例 | 已核销 |
| mtx-08 | `currentVersionId`｜`versionRef` | 正常；缺→「—」 | 只读 | — | `mtx.version` | 上游字段别名用例（本轮新增） | 已核销 |
| mtx-09 | `skillCount` | 正常；缺→「—」 | 只读 | — | `mtx.skills` | 行渲染断言 | 已核销 |
| mtx-10 | `budget.monthlyCostUsd` | 正常；未配置→「未配置」；无 budget→「—」 | 只读 | — | `mtx.budgetMonthly`/`budgetUnset` | 不造 USD 0.00 用例 | 已核销 |
| mtx-11 | `todayRuns{total,succeeded,failed}` | 正常；`total=0`→「今日未运行」；无键→「—」 | 只读 | — | `mtx.runs`/`runsDetail`/`runsNone` | 0 运行用例（本轮新增） | 已核销 |
| mtx-12 | `risk{blockedApprovals,failedRuns,budgetOver}` | 正常；全 0→「无风险」；键缺省→「—」 | 只读 | — | `mtx.noRisk`/`risk*` | 缺键不得写无风险（本轮新增） | 已核销 |
| mtx-13 | 静态 | 空 | 只读 | — | `mtx.emptyTitle`/`emptyHint` | 空态断言 | 已核销 |
| mtx-14 | 静态骨架 | 加载 | 只读 | — | — | 骨架断言 | 已核销 |
| mtx-15 | `status` | 错误 | 只读 | — | `mtx.errHttp` | HTTP 人话断言 | 已核销 |
| mtx-16 | `code=console.timeout` | 超时 | 只读 | — | `mtx.errTimeout` | 超时断言 | 已核销 |
| mtx-17 | `status=401` | 401 | 只读 | — | `agentConsole.auth.expired` | 401 断言 | 已核销 |
| mtx-18 | — | 错误/超时/401 | 只读 | 重取本页 | `v2.retry` | 重试按钮断言 | 已核销 |
| mtx-19 | `x-console-request-id` | 错误/超时/401 | 只读 | — | `ReqId`（缺→未提供） | 请求号断言 | 已核销 |
| mtx-20 | DOM | 全态 | 只读 | — | — | `button/input/form` 计数 0 | 已核销 |

元素数 20 / 已核销 20 / 核销率 100% / 死控件数 0

备注：上游接口未部署时走「错误(HTTP)」人话态，不造假行；本轮补 `lifecycleState`/`currentVersionId` 别名、风险键缺省与 0 运行三处上屏缺陷。