# AUD-01 审计列表 · 元素核销表（R4 整页重写）

设计源：`docs/product/design/console-v2/AUD01-TARGET-SPEC.md`（锁 `abad6fd`），§1.1–§1.10 逐区块拆分。SPEC 仅给出 `AUD01-E01` 一个正式元素号；本表 `AUD01-R4-01…76` 是按区块拆分的施工行号，**不是新的设计 token**，不改设计源。
数据源：`GET /agent-api/api/audit`（A3）、`GET /agent-api/api/audit-verify`（A7）；只读，零写入口。
七态口径：正常 / 空（无筛选引导）/ 空（有筛选无结果）/ 加载 / 错误 / 403=404 同体 / 超时。权限列统一「只读」。
验收腿：`AuditList.test.tsx`（52 例）为主；样式腿读 `aud01.css`。

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| AUD01-R4-01 | 静态外壳 | 全态 | 只读 | — | `navAudit` | 页级 testid `agent-v2-page-audit` | 已核销 |
| AUD01-R4-02 | 静态 | 全态 | 只读 | — | `aud01.title` | h1 文本断言 | 已核销 |
| AUD01-R4-03 | 静态 | 正常 | 只读 | — | `aud01.sub` | 副标题含「只读留痕/不提供修改删除补录」 | 已核销 |
| AUD01-R4-04 | 客户端时钟 | 正常 | 只读 | — | `aud01.freshUpdated` | 北京时间分钟断言 | 已核销 |
| AUD01-R4-05 | 静态 | 正常 | 只读 | — | `aud01.freshSource/freshReadonly/freshNoPolling` | 无 API 路径、含「不轮询」 | 已核销 |
| AUD01-R4-06 | 静态 | 全态 | 只读 | — | `aud01.bannerBodyHuman` | `role=note` + aria-label「本页只读边界」；错误/403 态仍在 | 已核销 |
| AUD01-R4-07 | 静态 | 全态 | 只读 | — | `help.readonlyBanner` | HelpTip 解释无导出按钮 | 已核销 |
| AUD01-R4-08 | 静态 | 全态 | 只读 | — | `aud01.bannerMono` | 仅「只读」二字，无端点/代号 | 已核销 |
| AUD01-R4-09 | A7 常驻 | 全态 | 只读 | — | `aud01.verifyTitle` | 面板在筛选条上方，非抽屉/按钮 | 已核销 |
| AUD01-R4-10 | 静态 | 全态 | 只读 | — | `aud01.verifyReadonlyNoteHuman` | 「只读校验，不修改任何事件」 | 已核销 |
| AUD01-R4-11 | 静态 | 正常 | 只读 | — | `aud01.verifyPremise1` | 七类关键事件；判定表在后端 | 已核销 |
| AUD01-R4-12 | 静态 | 正常 | 只读 | — | `aud01.verifyPremise2` + `help.twoWindows` | 落库半开 vs 发生双闭，口径分开 | 已核销 |
| AUD01-R4-13 | 静态 | 正常 | 只读 | — | `aud01.verifyPremise3` | 100,000 上限；超出不得绿 | 已核销 |
| AUD01-R4-14 | 窗口 | 正常 | 只读 | 重取校验 | `aud01.verifyWindow*` | 1h/24h/7d/30d 四档，默认 24h；真实 200 未取（401） | 未核销 |
| AUD01-R4-15 | 窗口 | 正常 | 只读 | — | — | 面板显示北京区间；原始 UTC 仅在 title | 已核销 |
| AUD01-R4-16 | A7 | 正常 | 只读 | 校验本窗口 | `aud01.verifyRun` | 只发只读 GET，无实心按钮 | 已核销 |
| AUD01-R4-17 | A7 响应 | S0 | 只读 | — | `aud01.verifyS0Title/Desc` | 无锚点 + scanned=0 中性，无绿 | 已核销 |
| AUD01-R4-18 | A7 响应 | S1 | 只读 | — | `aud01.verifyS1Title/Desc` | ok+complete+scanned>0+锚才绿 | 已核销 |
| AUD01-R4-19 | A7 响应 | S1 负例 | 只读 | — | `aud01.verifyGreenGateMono` | 缺任一条件不出绿（S2/S0 用例） | 已核销 |
| AUD01-R4-20 | A7 响应 | S1 | 只读 | — | `aud01.verifyAnchorLabel/HeadLabel/PreAnchor` | 锚点/链头短码+复制；锚前计数另列 | 已核销 |
| AUD01-R4-21 | A7 响应 | S2 | 只读 | — | `aud01.verifyS2Title/Desc` | complete=false 警告态，不绿 | 已核销 |
| AUD01-R4-22 | A7 响应 | S2 | 只读 | 缩窗重跑 | `aud01.verifyNarrowCta` | 按钮把窗口缩到 7 天 | 已核销 |
| AUD01-R4-23 | A7 响应 | S3 | 只读 | — | `aud01.verifyS3Title/Desc` | 断链数、已扫描、首个断点 | 已核销 |
| AUD01-R4-24 | A7 响应 | S3 | 只读 | — | — | 最多显示 20 条；超出显「最多列出前 20 条」 | 已核销 |
| AUD01-R4-25 | A7 响应 | S3 | 只读 | 复制/详情 | `aud01.verifyCopyBreak/verifyView` | 短码+复制；详情页已上线，查看可用 | 已核销 |
| AUD01-R4-26 | A7 响应 | S4 | 只读 | 重试 | `aud01.verifyS4Title/Desc` | 人话+请求号+重试；无 HTTP 码 | 已核销 |
| AUD01-R4-27 | 静态 | S3 | 只读 | — | — | 无 out_of_order/百分比/上次校验/趋势 | 已核销 |
| AUD01-R4-28 | 查询 | 正常 | 只读 | 重取列表 | `aud01.window24h` | 默认 24h，首次必发真实 from/to | 已核销 |
| AUD01-R4-29 | 查询 | 正常 | 只读 | 重取列表 | `aud01.custom*` | 自定义北京墙钟往返；from>to 前端先拦 | 已核销 |
| AUD01-R4-30 | 查询 | 正常 | 只读 | 重取列表 | `aud01.searchPlaceholder` | `rn_`→runId 精确定位 | 已核销 |
| AUD01-R4-31 | 查询 | 正常 | 只读 | 重取列表 | `aud01.searchEventNotQueryable` | `tk_`/`ap_`/`ev_` 分派；ev_ 不冒充可查 | 已核销 |
| AUD01-R4-32 | 查询 | 正常 | 只读 | 重取列表 | `aud01.empAsActor/empAsResource` | `emp_` 二选一，不猜 | 已核销 |
| AUD01-R4-33 | 当前筛选 | 正常 | 只读 | 移除 | `aud01.chip*` | 可移除 chip；时间 chip 默认不可移除 | 已核销 |
| AUD01-R4-34 | 当前筛选 | 正常 | 只读 | 清空 | `aud01.clear/clearDisabledTitle` | 默认 disabled；有额外条件才解禁 | 已核销 |
| AUD01-R4-35 | 查询 | 正常 | 只读 | 重取列表 | `aud01.filterLimit` | 20/50/100/200，默认 50，上限 200 | 已核销 |
| AUD01-R4-36 | 查询结果 | 正常/空 | 只读 | — | `aud01.loadedPre/loadedPost` | 「已加载 N 条」，不声称总数 | 已核销 |
| AUD01-R4-37 | 静态 | 正常 | 只读 | — | — | 不渲染来源/决定/排序/列排序/分布图 | 已核销 |
| AUD01-R4-38 | URL | 全态 | 只读 | 刷新保持 | — | `?window/action/actorId/...` 深链读回 | 已核销 |
| AUD01-R4-39 | 查询 | 正常 | 只读 | — | — | 筛选只走 A3 服务端七参；无客户端假筛 | 已核销 |
| AUD01-R4-40 | 无筛选 | 空（无筛选） | 只读 | 选窗口/快捷 | `aud01.nofilter*` | 不发 `/api/audit`；计数「未查询」 | 已核销 |
| AUD01-R4-41 | `events[]` | 正常 | 只读 | — | — | 12 列顺序：时间/来源/动作/主体/代谁/决定/结果/运行/任务/审批/资源/操作 | 已核销 |
| AUD01-R4-42 | `occurredAt`/`recordedAt` | 正常 | 只读 | — | `aud01.timeOccurred/timeRecorded` | 显示北京时间到分；ISO 只在 title；>5min 标钟差 | 已核销 |
| AUD01-R4-43 | `sourceSystem` | 正常/未收录 | 只读 | — | `aud01.source*` | 七枚举中文；未收录显 —，原值进 title | 已核销 |
| AUD01-R4-44 | `action` | 正常/未收录 | 只读 | — | `aud01.action*` | 八类动作中文；未收录显「未知」，原值进 title | 已核销 |
| AUD01-R4-45 | `actor{type,id,displayName}` | 正常 | 只读 | 员工→详情 | `id.employee*`/`id.systemActor` | 姓名/「员工 · 短码」/「用户 #N」；不裸 human:/emp_ | 已核销 |
| AUD01-R4-46 | `onBehalfOf` | 正常 | 只读 | — | `aud01.colBehalf`/`id.userRef` | 显示「→ 姓名」；原始 ref 只在 title | 已核销 |
| AUD01-R4-47 | `decision` | 正常/缺失/NA | 只读 | — | `aud01.decision*` | 六枚举中文；缺失与 not_applicable 都显 — 但 tooltip 区分；未收录 — | 已核销 |
| AUD01-R4-48 | `outcome` | 正常 | 只读 | — | `aud01.outcome*` | 四枚举中文；未收录 —，原值进 title | 已核销 |
| AUD01-R4-49 | `runId` | 正常/缺省 | 只读 | `/agent/runs/:id` | `aud01.viewRun` | 短码+复制；缺省整格 — | 已核销 |
| AUD01-R4-50 | `taskId` | 正常/缺省 | 只读 | `/agent/tasks/:id` | `aud01.viewTask` | 短码+复制+真实跳转；缺省 — | 已核销 |
| AUD01-R4-51 | `approvalId` | 正常/缺省 | 只读 | 详情展开内 | `aud01.viewApproval` | 短码+复制；缺省 — | 已核销 |
| AUD01-R4-52 | `resource{type,id}` | 正常 | 只读 | 员工→详情 | `id.res.*` | 类型中文+短码；仅 employee 可跳；原值进 title | 已核销 |
| AUD01-R4-53 | 行操作 | 正常 | 只读 | 原地展开 | `aud01.expandRow/collapseRow` | chevron 展开，不改路由 | 已核销 |
| AUD01-R4-54 | `eventId` | 正常 | 只读 | 复制 | `aud01.copyEventId` | ⋯ 菜单复制；不显示完整事件号 | 已核销 |
| AUD01-R4-55 | `eventId` | 正常 | 只读 | `/agent/audit/:id` | `aud01.openDetail` | 详情页已上线，链接可用 | 已核销 |
| AUD01-R4-56 | `before/after` | 正常展开 | 只读 | — | `aud01.diffAdded/Removed/Changed` | 键级 diff + 左竖条 + 前缀 | 已核销 |
| AUD01-R4-57 | `before/after` | 正常展开 | 只读 | — | `aud01.diff*` | 对象/数组单行 JSON，点击展开 `<pre>` | 已核销 |
| AUD01-R4-58 | `before/after` | 空差异 | 只读 | — | `aud01.diffEmpty` | 无差异一行人话 | 已核销 |
| AUD01-R4-59 | `before/after` | 超 4KB | 只读 | — | `aud01.diffOversized` | 正常渲染 + 数据质量 warning | 已核销 |
| AUD01-R4-60 | `hash/prevHash` | 正常展开 | 只读 | 复制 | `aud01.copyHash/copyPrevHash` | 短码+复制；缺省 — 与锚前说明 | 已核销 |
| AUD01-R4-61 | 静态 | 正常展开 | 只读 | — | — | 无「验证此条」入口；只有窗口级校验说明 | 已核销 |
| AUD01-R4-62 | `error{code,messageRedacted}` | 正常展开 | 只读 | — | `aud01.errorMessage` | 只显示脱敏文本；原错误码进 title | 已核销 |
| AUD01-R4-63 | 关联引用 | 正常展开 | 只读 | APR-02 | `aud01.relApproval/relCorrelation/relPolicy` | 审批可跳；串联/策略只复制并写明原因 | 已核销 |
| AUD01-R4-64 | 静态 | 加载 | 只读 | — | `aud01.loadingNote` | 6 行骨架、无假动作名、无闪烁 | 已核销 |
| AUD01-R4-65 | 查询结果 | 空（有筛选） | 只读 | 清空筛选 | `aud01.emptyTitle/emptyDesc` | 主句「没有匹配的审计事件」；含 G-03 说明 | 已核销 |
| AUD01-R4-66 | `status/requestId` | 错误 | 只读 | 重试/回总览 | `aud01.errorTitle/errorDesc*` | 人话+请求号+重试；无 HTTP 码/上游码 | 已核销 |
| AUD01-R4-67 | `status=403/404` | 403=404 | 只读 | 刷新 | `aud01.forbidden*` | 同标题同正文同请求号；无半张表 | 已核销 |
| AUD01-R4-68 | `events[]/nextCursor` | 正常 | 只读 | 下一页 | `aud01.cursorNoteHuman` | 「本页 N 条」；仅 nextCursor 键存在可点 | 已核销 |
| AUD01-R4-69 | `nextCursor` 省略 | 末页 | 只读 | — | `aud01.lastPageNoteHuman` | 末页说明；无「上一页」/页码/共 N | 已核销 |
| AUD01-R4-70 | 静态 | 正常 | 只读 | — | — | 口径脚：发生时间 vs 落库排序、无总数、冷存档 | 已核销 |
| AUD01-R4-71 | CSS | 375 | 只读 | — | — | `@media(max-width:767px)` 表格转卡片；未做 375 像素截图 | 未核销 |
| AUD01-R4-72 | CSS | 1280 | 只读 | — | `aud01.tblHintHuman` | 1280–1399 横滚 + sticky；未做 1280×720 像素复验 | 未核销 |
| AUD01-R4-73 | CSS | 1440 | 只读 | — | — | 1262 列宽在 1302 内容区不横溢（CSS 静态口径） | 已核销 |
| AUD01-R4-74 | DOM | 全态 | 只读 | — | — | 写入口/导出/修改/删除/补录/回滚计数 0 | 已核销 |
| AUD01-R4-75 | DOM | 全态 | 只读 | — | — | 工程词零上屏：无 HTTP/A3/A7/API/裸字段名/ISO；原值只进 title | 已核销 |
| AUD01-R4-76 | DOM | 全态 | 只读 | — | — | testid 前缀 `aud01-*`；页级 `agent-v2-page-audit` | 已核销 |
| AUD01-R4-77 | 静态 | 全态 | 只读 | — | 旧 `help.timeColumn/decisionPair/outcomeEnum/empDimension` | 含裸字段名的 HelpTip 已移除；待共享 locale 改人话后回填 | 未核销 |

## 汇总（R4 整页重写）

- 元素数 **77** / 已核销 **73** / 未核销 **4** / 核销率 **94.8%** / 死控件 **0** / 需共享文件 **1**（帮助文案回填）。
- 未核销 4 项（显式披露，不伪造）：
  1. `AUD01-R4-14` 的真实 A7 200 响应未在本地取到：BFF 两条路径用 curl 实测均返回 **401 `console.unauthenticated`**（路径存在，非 404），无可用会话 token；五态由注入式单测覆盖。
  2. `AUD01-R4-71/72` 375 与 1280×720 仅做 CSS 规则与单测断言，未做浏览器像素截图复验。
  3. `AUD01-R4-77` 时间/决定/结果/员工维度的旧 HelpTip 文案含 `occurredAt`/`recordedAt`/`actorId`/`resourceId` 等裸字段名；因三份 locale 本轮只读，已移除这四处 HelpTip（保留原生 title 与可见中文），完整帮助说明需共享 locale 改动后回填。
- 与 SPEC 的有意偏差（非缺口）：SPEC 写 S3「查看」在 AUD-02 未建时 disabled、C9 任务跳转在 TSK-02 未建时 disabled；当前两页均已上线，故渲染真实可用链接。SPEC 的 S4/错误/无权限要求显示 HTTP 码，与本轮任务「HTTP 码不上屏」冲突，按任务执行，只保留请求编号。
- 工程语言：错误/403 正文用既有 key 去掉括号内 HTTP 码；A7 S2/S3 的 `ok/complete/brokenEventIds/prevHash/critical` 可见文案已改为人话；未收录 action/source/decision/outcome 一律显 —，原值只进 title。
