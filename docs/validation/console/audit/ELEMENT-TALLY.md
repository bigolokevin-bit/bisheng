# AUD-01/AUD-02 元素核销表（/agent/audit）

数据源：`GET /agent-api/api/audit`（A3 列表）、`GET /agent-api/api/audit-verify`（A7 窗口校验）；详情 `GET /agent-api/api/audit-detail?id=`（A4）。只读页，零写入口。
七态口径：正常 / 空(无筛选) / 空(有筛选无结果) / 加载 / 错误(HTTP) / 403=404 同体 / 超时。

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| aud-01 | 静态 | 全态 | 只读 | — | `aud01.title` | AuditList 渲染断言 | 已核销 |
| aud-02 | 静态 | 正常 | 只读 | — | `aud01.sub` | 同上 | 已核销 |
| aud-03 | 客户端时钟 | 正常 | 只读 | — | `aud01.readAt` | 读取于 mono 断言 | 已核销 |
| aud-04 | 静态 | 正常 | 只读 | — | `aud01.sourceLine` | 只读/不轮询断言 | 已核销 |
| aud-05 | 静态 | 全态（4 屏均显示） | 只读 | — | `aud01.bannerBodyHuman` | 横幅全态断言 | 已核销 |
| aud-06 | `window` | 正常 | 只读 | 重取列表 | `aud01.window*` | 默认 24h 请求断言 | 已核销 |
| aud-07 | `from`/`to` | 正常 | 只读 | 重取列表 | `aud01.custom*` | 北京时区往返用例 | 已核销 |
| aud-08 | `action` | 正常 | 只读 | 重取列表 | `aud01.search*` | 搜索派发断言 | 已核销 |
| aud-09 | `employeeId` | 正常 | 只读 | 重取列表 | `aud01.emp*` | emp_ 侧提示断言 | 已核销 |
| aud-10 | 当前筛选 | 正常 | 只读 | 清除 | `aud01.chip*` | chips 断言 | 已核销 |
| aud-11 | `events[]` | 正常 | 只读 | — | — | 12 列顺序断言 | 已核销 |
| aud-12 | `occurredAt` | 正常 | 只读 | — | — | Asia/Shanghai 断言 | 已核销 |
| aud-13 | `sourceSystem` | 正常；未收录原样 | 只读 | — | `aud01.source*` | 大小写/未收录用例 | 已核销 |
| aud-14 | `action` | 正常；未收录原样 | 只读 | — | `aud01.action*` + `title` 原值 | 原值只进 title（本轮） | 已核销 |
| aud-15 | `actor` | 正常 | 只读 | 员工→详情 | `id.employee*`/`id.systemActor` | 姓名/「员工 · 短码」断言 | 已核销 |
| aud-16 | `onBehalfOf` | 正常 | 只读 | — | `id.userRef` | 代操作断言 | 已核销 |
| aud-17 | `decision` | 正常；缺失/NA 同形不同义 | 只读 | — | `aud01.decision*` | 缺省 vs 不适用断言 | 已核销 |
| aud-18 | `outcome` | 正常 | 只读 | — | `aud01.outcome*` | 结果药丸断言 | 已核销 |
| aud-19 | `runId`/`taskId`/`approvalId` | 正常；缺→无链接 | 只读 | RUN/TASK/APR 详情 | `aud01.open*` | 中段短码+仅真值链接 | 已核销 |
| aud-20 | `resource` | 正常 | 只读 | 员工→详情 | `id.res.*` | 资源列断言 | 已核销 |
| aud-21 | `eventId` | 正常 | 只读 | AUD-02 详情 | `aud01.detail` | 行菜单/展开断言 | 已核销 |
| aud-22 | `nextCursor` | 正常 | 只读 | 下一页 | `aud01.cursorNoteHuman`/`nextTitleHuman`/`lastPageNoteHuman` | 分页文案一致性（本轮） | 已核销 |
| aud-23 | 无筛选 | 空(无筛选) | 只读 | 选窗口 | `aud01.nofilter*` | 不发请求断言 | 已核销 |
| aud-24 | 有筛选无行 | 空(有筛选) | 只读 | 清除筛选 | `aud01.empty*` | 空态断言 | 已核销 |
| aud-25 | `status`+`requestId` | 错误/超时 | 只读 | 重试 | `aud01.error*` | HTTP 人话+请求号+重试 | 已核销 |
| aud-26 | `status=403` | 403=404 | 只读 | 回工作台 | `aud01.forbidden*` | 同体断言 | 已核销 |
| aud-27 | 静态骨架 | 加载 | 只读 | — | — | 骨架无数值断言 | 已核销 |
| aud-28 | A7 响应 | S0/S1/S2/S3/S4 | 只读 | — | `aud01.verify*Human` | A7 五态用例 | 已核销 |
| aud-29 | DOM | 全态 | 只读 | — | — | 写入口计数 0（E10） | 已核销 |

元素数 29 / 已核销 29 / 核销率 100% / 死控件数 0

备注：本轮保留并复核已修的 VG 四项——工程语言清零（`critical`→关键事件、`(GET)`→只读校验、`employee.update`→员工信息更新）、分页文案与「下一页」语义一致、短码统一中段省略（完整值进 title/复制）、1280 可见横滑提示 + 表头 sticky。
## 2026-11-18 实现侧摘要 · AUD-01（L4p4，基座 fda248d）

代码已在基座祖先链上（`ea10dfa`），本轮复验；只记实现侧事实，台账状态未改。

- 工程语言：横幅 `critical` → 「关键事件」；校验区 `(GET)`/只读 GET → 「只读校验」；动作表补 `employee.update` → 「员工信息更新」；已知动作原值只进 `title`，未知动作原样（不臆造译名）。
- 分页：删「游标分页 · 无总数」「不足一整页」等自相矛盾/机器话术，改「每页 n 条 · 不显示总数」「读取下一页」「本页 n 条，后面没有了」，与「下一页」按钮一致。
- 短码：`shortId` 统一中段省略（前缀+首4+…+末4，如 `tk_01M7…V1XZ`），无长度例外；完整值在 `title`/复制。
- 1280×720：1280–1399 带 `.tblwrap{overflow:auto; max-height:calc(100vh - 240px)}` + `th{position:sticky;top:0;z-index:3}`（覆盖 listkit 的 static），可见横滑提示「可左右滑动查看全部列」；≥1400 仍 `overflow:visible` + sticky。
- 测试：`__tests__/AuditList.test.tsx` 46 例（含 1280 契约与文案断言）。

## 2026-11-18 实现侧摘要 · AUD-02（L4p4，基座 fda248d）

- 本轮新增：成功态请求编号区——`head` 的 `ready` 变体补 `requestId?`，A4 成功分支写入 `res.requestId`，meta 行在 ready 时渲染 `<ReqId testId="aud02-ok-reqid" />`（缺失显「未提供」，有值可复制），与错误态/403 态的请求编号口径一致。
- 已在基座祖先链（`c788bee`）：删除 idline 可见原值 chip（`message.send`/`employee.update` 不再上屏）；已知判定枚举不再打印「原值 …」可见行，`not_applicable`/缺失各留自身说明，未收录枚举仍原样透出。
- 403/404：同一屏体，仅 `HTTP` 号不同，整页替换不先渲数据；`aud02-forbidden-reqid` 缺失时显「未提供」并有重试。
- `empv_`：`shortId`/`refShort` 走中段省略，裸值在 `title`/复制（随 AUD-01 统一口径）。
- `⋯`：行内 `RowMenu` 保留（复制事件 id / 打开 AUD-02），带 `aria-haspopup="menu"`。
- 测试：`__tests__/AuditDetail.test.tsx` 59 例（含 403/404 同体、请求编号缺失、数字 schemaVersion、身份大小写）。
