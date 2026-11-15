# 员工列表页 验收卡（draft）

- 页面/路由：数字员工 · 列表 `/agent/employees`（EMP-01，波次 W2）
- PRD：`docs/product/CONSOLE-PRD.md` §3.1 L1-2、§3.2 L2-列表、§4.2 列表；C0 候选 v2.0，**待独立评审后方可施工**
- 设计：`docs/product/design/console-v2/mockup-v2-dark.html` / `mockup-v2-light.html`；`CONSOLE-V2-PARITY-SPEC.md` §2/§4（仅视觉底线）
- owner：L4 `ses_e34bb066cffeyhx2aUmiqWtuDQ`
- 独立验收：L6（未指定会话前不得自签）
- 构建：TBD（必须由 L7 从 `forks/bisheng-chat-panel` 单一分支构建；served entry 对账）
- 验收时间：TBD
- 租户/账号：真实登录的管理员（角色，不写密码）

## 覆盖清单（C0–C6）

- [ ] **C0 需求覆盖**：本卡逐条对应 PRD §4.2；每个按钮/空态/错误态有需求；PRD v2 评审通过前该项保持未过
- [ ] **C1 视觉还原**：1440×900 / 1280 / 768 / 375 四档、深/浅各一套，与 mockup 同屏并排；发丝线/圆角/`tabular-nums`/KPI 字阶/单一强调色/状态软药丸/按钮三级；无 `undefined`/`[object Object]`/内部术语/假 0/“待接入”
  - 证据（2026-11-16 L4，L6 第四轮 C1 收口）：`EVIDENCE.md` round-4 节——1280 成本列为截图时序问题已修复重拍（waitCosts 后 ["USD 0.12…","USD 0.01…"]）；375 底栏导航真实缺陷（1023px 带隐藏 .a2s-group 优先级盖过首修）已修，rail h=94 fixed、8 nav 含图标+标签、条内横向滚动首屏约 5 项；新增 w2-c2-pagination.png、w2-c2-searchempty.png；chips `.a2-pill.active` 视觉态补上（此前 url/search 图 blob 相同的根因）；工位/负责人列 nowrap，工位口径=E10 分段或 enrichment 计数。全部 blob/sips/rect 见 EVIDENCE 表。
  - 证据（2026-11-15 rework, card 2260）：light 四档截图已重拍并全部包含表格数据行（scrollIntoView 后 rect 顶部在视口内，sips 实测 1440x900/1280x800/768x1024/375x812），375 dark+light 底部导航 fixed rail 可见；见 EVIDENCE.md『EMP-01 rework』节。
- [ ] **C2 功能闭环**：搜索、状态/部门/负责人/工位/知识筛选、视图切换、URL 保存、排序、分页、行操作（详情/复制 ID/Bisheng 打开/暂停按权限）、创建入口均可达且有结果；返回保留筛选
  - 证据（2026-11-15 rework, card 2260）：列排序已实现（当前页客户端排序+URL ?sort=col:dir+aria-sort，全量排序为已知缺口），搜索/视图切换/URL 持久化/翻页点击各附操作后截图 w2-c2-{url,search,viewchat,sort,nextpage}.png 与 readout。
  - 范围归属（L0 卡 2211）：归本页=keyword+lifecycleState 筛选、URL 保存、keyset 分页、复制 ID、enrichment 四列（岗位版本实测 v3·11-15 11:27 / v2·11-13 14:30）；归 W3=详情路由与行点击进详情、创建入口后端（E1 无 BFF 写代理，按钮 disabled+原因注记）；数据口缺=部门/负责人/工位类型/知识范围筛选无 E11 服务端参数（诚实禁用）、最紧急待办无批量口（enrichment 无 pendingApprovalCount 时显示 —）、排序未做、totals/asOf 未接（B4）。
- [ ] **C3 数据真实**：真实登录/租户/数据；每个数字可追溯到接口；缺失显示 `—` 或明确空态；served entry == 验收分支 build
  - 证据（2026-11-15 L4）：`EVIDENCE.md` API 读回——真实 BFF 五请求全 200（employees expand=version,workstations,knowledge,pending / employee-stats / run-stats / budget-usage / run-activity），每数字有来源，缺失列显 —（8101 domain 旧进程不返 enrichment，根因与修复归属已记）。仍差：served entry == 验收分支 build 的对账归 L7（8182 尚未部署本分支）。
- [ ] **C4 权限负例**：未登录 401；非管理员 403 `console.forbidden`；跨租户 404 同 payload；写开关关闭时创建/暂停不可见或 405；内部 token 不出现在浏览器/Network/HTML
  - 证据（2026-11-15 L4 实测，L0 卡 2211）：viewer01 API 真实登录（口令经本地凭据文件注入，零回显）→ CDP clearBrowserCookies+setCookie 注入浏览器 → 访问 /agent/employees 跳转 /403 页（『您无权访问该页面』，截图 w2-employees-viewer-403.png）；同源 API GET /agent-api/api/employees → 403 {"code":"console.forbidden","message":"console entry not authorized for this account"}（x-console-reason 头未出现，照实）。未登录 401/跨租户 404 同 payload/写开关负例引用主仓 apps/console/tests/test_bff_authz.py 单测。
- [ ] **C5 全链 E2E**：登录→列表→详情→返回→筛选保留；无 console error、无 404 资源、首屏不白屏
  - 证据（2026-11-15 L4，L0 卡 2211）：BLOCKED——详情路由不存在（routes/index.tsx 无 employees/:id，操作列详情按钮 disabled，locale emp.detailPending『详情页施工中』）；登录→列表→详情→返回链待 W3，不临时造页。登录→列表段已由 C1/C3 截图与真实数据读回覆盖。
- [ ] **C6 回归与交付**：目标服务测试（无 DSN + PG）全绿；构建/type/lint exit 0；`git diff --check` 0；分支已 push；上一波页面未破坏

## 字段与数据来源

| 区块/列 | 字段 | 来源 | 缺失时 |
|---|---|---|---|
| KPI·在岗 | active/total、六态计数 | E14 | 指标卡错误态 + request id，不显示 0 |
| KPI·待审批 | pending 数、24h 将过期 | AP8 | `—` + “暂无待办数据” |
| KPI·本月成本 | cost、预算、环比 | P9 | `—`，禁止 `0.00`；口径标注 cost_ledger |
| KPI·异常 | 失败/越权/待审 | R6 / E14 | 明确“口径未接入”空态，不画曲线 |
| 表格·员工 | 姓名/岗位/员工 ID | E11 | 行内骨架；错误整表错误态 |
| 表格·岗位/版本 | 岗位、版本、生效时间 | E15（当前版本） | `—` + 版本不可用说明 |
| 表格·状态 | 生命周期 | E11 | 原样枚举，不造色值 |
| 表格·负责人 | owner | E11 | `—` |
| 表格·工位 | 群/私聊/定时 | E10 | `—` |
| 表格·待办 | 数量、最紧急 | AP8 | `—` |
| 表格·最近运行/7 天成功率 | run 计数、成功率 | R5/R6 | `—`，不得前端聚合分页结果 |
| 批量列数据 | 首屏 stats/cost/owner | `/api/employee-stats`、`/api/run-stats`、`/api/budget-usage` | `missing`/`—`，禁假 0 |
| 表格·本月成本 | cost / 预算 | P9 | `—`，禁止 0.00 |
| 7×24 热力 | 员工/平台、时区 | R7 | 整块空态 + 原因，不画假热力 |

数据规则：跨员工统计只走 E14/AP8/R6/P9；禁止 N+1 伪装全量；分页 keyset；URL 参数保存筛选与视图。

BFF 路由（M1 现有名）：`GET /api/employees?keyword=&lifecycleState=&limit=&cursor=&expand=`、`GET /api/employee-stats`、`GET /api/run-stats`、`GET /api/budget-usage`、`GET /api/run-activity`。`expand` 的 BFF 透传已由 L7 `138d2b1` 接线（无 expand 逐字节兼容）。生产页面只调这些真实 API；fixture 只可单测，不得进 bundle。

## 状态矩阵

| 状态 | 期望 | 证据 |
|---|---|---|
| 加载 | 10 行骨架，不显示假 0 | 截图 |
| 空 | “还没有数字员工”+ 新建入口（有权限） | 截图 |
| 错误 | 卡片/表格错误态 + 重试 + request id | 截图 + 日志 |
| 无权限 | 403 页“没有管理控制台权限”，不空白 | 截图 + Network |
| 无趋势数据 | 明确“趋势数据不可用”，不画折线 | 截图 |

## 证据（待填）

- 截图：`docs/validation/console/employees-list/visual-{dark,light}-{1440,1280,768,375}.png`、并排图
- 功能：Playwright 脚本/命令 + 步骤截图
- 数据：E14/E11/E15/E10/R5/R6/AP8/P9 响应摘要 + served entry sha256 + build commit
- 权限：401/403/404/405 curl 或 Network 截图
- 偏差/未覆盖（2026-11-15 L4 更新，L0 卡 2211）：B3 expand 已透传并实测闭环（BFF 重启 pid 67576 后 enrichment 真实返回，详见 EVIDENCE.md enrichment 两节）；B4 totals/asOf 已合入但页面未接（维持）；C4 在线 403 已用 viewer01 实测（不再缺账号，凭据零回显）；排序未做；1280/768 浅色与本节深色套图分轮采集，mockup 样例数字为示意值非数据承诺。
- 结论：**in-progress**（C0-B 未闭不得 passed；生产页必须调真实 API）
