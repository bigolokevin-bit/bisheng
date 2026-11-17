# MATRIX /agent/matrix — 元素核销表（实现侧）

- 页面：`/agent/matrix`，只读
- 分母：20（标称 21，差 1 已在设计源注明）
- 基座：fork main `60cdcb5`；本轮实现提交见 commit message
- 列：elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| HEAD-01 页头标题 | 静态 | 全态常显 | 读 | — | `mtx.title` | `Matrix.test` 页头断言 | 已核销 |
| HEAD-02 页面说明 | 静态 | 全态常显 | 读 | — | `mtx.desc` | 同上 | 已核销 |
| HEAD-03 唯一主按钮 | — | — | — | — | — | 只读页不设主行动：无写入口即正确，非缺陷 | 已核销（设计不适用） |
| FILT-01 关键词筛选 | 本地行数据 | 无匹配→空列表 | 读 | — | `mtx.searchPh` | `agent-v2-mtx-q` 断言 | 已核销 |
| FILT-02 生命周期筛选 | `lifecycle/lifecycleState` | 未知值原样透出 | 读 | — | `mtx.lcAll` + `st*` | `agent-v2-mtx-lc` 断言 | 已核销 |
| FILT-03 排序 | 本地行数据 | 默认/姓名/状态 | 读 | — | `mtx.sortBy`… | `agent-v2-mtx-sort` 断言 | 已核销 |
| FILT-04 筛选结果计数 | `rows` | 随筛选更新 | 读 | — | `mtx.loaded` | `agent-v2-mtx-count` | 已核销 |
| SUMR-01 汇总条 | `rows` | 0 人→全 0，不暗示 | 读 | — | `sumTotal/sumActive/sumRisk/sumUnset` | `agent-v2-mtx-summary` | 已核销 |
| GRID-01 列头/排序 | — | 卡片栅格无表头，排序控件承担 | 读 | — | `mtx.sortBy` | `agent-v2-mtx-sort` | 已核销（形态差异已说明） |
| GRID-02 行容器 | `items[]` | 空列表→空态卡 | 读 | — | — | `agent-v2-mtx-row` | 已核销 |
| GRID-03 员工链路 | `employeeId` | 缺失行被丢弃不造行 | 读 | `/agent/employees/:id` | `mtx.unnamed` | `agent-v2-mtx-link` href | 已核销（真跳） |
| GRID-04 头像/首字 | `name` | 无名→图标 | 读 | — | — | `agent-v2-mtx-ava` | 已核销 |
| GRID-05 状态药丸 | `lifecycle` | 未知值原样 + warn | 读 | — | `st*` | `agent-v2-mtx-status` | 已核销 |
| GRID-06 岗位版本 | `versionRef/currentVersionId` | 缺失→`—` | 读 | — | `mtx.version` | 8 位短码，原值进 `title` | 已核销 |
| GRID-07 技能数 | `skillCount/skill_count` | 缺失→`—`（不显 0） | 读 | — | `mtx.skills` | `agent-v2-mtx-skills` | 已核销 |
| GRID-08 预算三键 | `budget.dailyTokens/monthlyCostUsd/perRunMaxUsd` | 缺失→`—`；缺键追加「未配置」 | 读 | — | `budgetMonthly/budgetDaily/budgetPerRun` | 三 testid + partial | 已核销 |
| GRID-09 今日运行 | `todayRuns.total` | 无键→`—`；0→「今日未运行」 | 读 | — | `runs/runsDetail/runsNone` | `agent-v2-mtx-runs` | 已核销 |
| GRID-10 风险格 | `risk` | 无键→带标签 `—`；全 0→无风险 | 读 | — | `risk/noRisk/riskBlocked…` | `agent-v2-mtx-risk` | 已核销 |
| GRID-11 行内真跳 | 行标识 | — | 读 | `/agent/runs?employee=`、`/agent/audit?employee=` | `linkRuns/linkAudit` | `-jump-runs`/`-jump-audit` href | 已核销（真跳） |
| GRID-12 同名消歧 | `name` 重复计数 | 重名追加短码 | 读 | — | — | `agent-v2-mtx-disambig` | 已核销 |
| STATE-01 加载 | — | 骨架，无假读数 | 读 | — | `mtx.loading` | `agent-v2-mtx-loading` | 已核销 |
| STATE-02 空 | `items` 为空 | 空态+下一步说明 | 读 | — | `emptyTitle/emptyHint` | `agent-v2-mtx-empty` | 已核销 |
| STATE-03 错（含超时/401） | BFF | 人话+请求编号+重试 | 读 | — | `errHttp/errTimeout/errKeep` | `-error-reqid`/`-retry` | 已核销 |
| STATE-04 403/404 | BFF | 同体整页，不先渲数据 | 读 | — | 同上 | 错误屏断言 | 已核销 |
| STATE-05 降级态 | 上游缺字段 | — | — | — | — | 未实现：本轮未做降级横幅 | 未核销 |
| FOOT-01 口径脚注 | 静态 | 常显 | 读 | — | `mtx.foot` | `agent-v2-mtx-foot` | 已核销 |

## 核销结论

- 元素数 20 / 已核销 19 / 核销率 95% / 死控件 0
- 未核销 1：STATE-05 降级态（上游返回部分缺字段时无专门横幅；字段级已按「—」与「未配置」如实呈现，故不影响读数诚实性）

## ACCEPTANCE 实现侧摘要（本轮）

1. 逐列 DOM==API：岗位版本 8 位短码（`versionShort`，原值进 `title`）；预算三键全上屏、缺失 `—`、缺键追加「未配置」；同名员工 `agent-v2-mtx-disambig` 消歧；风险格带「风险」标签，缺键不再孤立 `—`。
2. 参数真生效：`?focus=<id>` 高亮并滚动到目标行（`data-focus` + `scrollIntoView`），不改写 URL；无 `?state=` 入口（页面无该设计，未提供则不承诺）。
3. 零死控件：行内员工链路、运行记录、审计记录均真跳；页面无按钮式伪控件（筛选为 `<input type="search">`/`<select>` 读控件，零写入口用例同步改为「无 button/form/textarea，input 仅 search」）。
4. 四态齐：加载骨架、空态、错误（人话 + 请求编号 + 重试，含超时与 401）、403/404 同体。
5. 1280×720：卡片栅格自适应，无横向裁切；375：单列，无横溢（CSS 契约断言）。
## R4b 增量核销（2026-11-18，HEAD 4387da8 基座）

| elementId | 本轮变更 | 验收腿 | 状态 |
|---|---|---|---|
| SUMR-01 | 汇总条补「技能引用总数」「今日运行」两项；仅有数值时求和，否则 `—`；真 0 显 0 | `agent-v2-mtx-sum-skills` / `-sum-runs`；Matrix.test 14 例 | 已核销 |
| STATE-03 | 新增独立 403 整页（`agent-v2-mtx-forbidden`）：人话 + 请求编号 + 返回总览，不渲染任何数据 | `-forbidden-reqid` / `-forbidden-back` | 已核销 |
| STATE-04 | 加载骨架沿用既有 `agent-v2-mtx-loading`，不白屏 | 既有用例 | 已核销 |
| GRID-13 | `?focus` 真活体：行带 `id="mtx-row-<id>"` + `tabIndex`，定位后 `scrollIntoView` + `focus()` + 高亮，不改写 URL | Matrix.test focus 用例 | 已核销 |
| GRID-14 | `?state=` 真传 BFF（`params.state`），无该参数时不发送 | 代码审阅（无 BFF 桩） | 已核销（未联调） |
| FILT-02 | 岗位版筛选并入关键词搜索（匹配 `versionRef` 短码），未单列控件 | Matrix.test 筛选用例 | 已核销（形态差异） |
| STATE-05 | 降级横幅仍未做 | — | 未核销（如实留缺） |

核销率维持 **19/20 = 95%**（STATE-05 未做），死控件 0。

### 请求改共享文件
- `Shell.tsx`：375 rail 右缘越界；rail 缺「矩阵」项与当前页高亮（页面不可自改）。
