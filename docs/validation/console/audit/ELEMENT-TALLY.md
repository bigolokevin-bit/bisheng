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