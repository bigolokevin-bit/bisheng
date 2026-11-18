# SET-01 设置页 · 元素核销表（Q2 诚实化）

- 设计源：`docs/product/design/console-v2/deep/07-settings.md` §4（78 行）。PRD v0.3 §5 **没有 SET-01 元素表**，故不按 PRD 抄行、不造 ID；待设计源补号后再对齐。
- 实现：`src/frontend/platform/src/pages/AgentConsoleV2/SettingsPage.tsx` + `set01.ts` + `set01Kit.tsx`。
- 数据源：`/api/hermes-summary`（模型与渠道/通知与集成）、A7 审计链、`/api/budget-usage` 规则口径；其余为部署常量、契约规则或缺口。
- 七态口径：正常 / 空 / 错 / 加载 / 403 / 404 / 未接入（未知）。空值 `—`，不写假 0；403/404 同体整组替换。
- 本轮诚实化：删除屏上 API 路径、HTTP 码、GAP/CR/ADR 编号、字段名、`sanitized/degraded`、`fail-closed/allow`、`raw_ref/append-only`；租户 ID 不上屏；构建版本与会话 TTL 显示未知；密钥只显示未知（不回显值/长度/哈希）；危险区零可点控件。
- 状态：逐行复核；有实现与测试证据的记「已核销」；缺端点且未单列读数的记「未核销」；M2 写配置与日切任务按设计记「待实现/M1 不开放」。

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| SET-T01 | 会话上下文（按口径不上屏） | 正常（安全口径） | 读 | — | `set01.fTenantId` | 页面无租户 ID；sanitized 测试断言无 `t_seakoi`/`tenant_id` | 已核销 |
| SET-T02 | 无来源（deep/07 T02） | 未接入 → 无端点 | 读 | — | `set01.fTenantName` | `agent-v2-set-f-tenant-name` 显示「无端点」 | 已核销 |
| SET-T03 | 部署常量 | 正常（常量） | 读 | — | `set01.fEntry` | `/agent` 文本 | 已核销 |
| SET-T04 | 无端点 | 未知 | 读 | — | `set01.fBuild` | `agent-v2-set-f-build` 显示未知，不编造版本 | 已核销 |
| SET-T05 | 部署配置 | 未知 | 读 | — | `set01.fSessionTtl` | `agent-v2-set-f-session-ttl` 显示未知 | 已核销 |
| SET-T06 | 进程内配置 | 未知 | 读（不回显） | — | `set01.fWriteToken` | write-token 未知；无值/长度/哈希 | 已核销 |
| SET-T07 | 规则常量 | 正常（常量） | 读 | — | `set01.acWho*` | `agent-v2-set-access-who` | 已核销 |
| SET-T08 | Bisheng 用户/角色表 | 未接入 | 读 | — | — | 未渲染 | 未核销 |
| SET-T09 | 启动期开关 | 未知 | 读 | — | `set01.fWriteApproval` | write-approval 未知（非关） | 已核销 |
| SET-T10 | 启动期开关 | 未知 | 读 | — | `set01.fWriteChat` | write-chat 未知（非关） | 已核销 |
| SET-T11 | 构建期常量 | 未知 | 读 | — | `set01.fWriteFrontend` | write-frontend 未知（非关） | 已核销 |
| SET-T12 | A7 链校验 | 正常/空/错/加载 | 读 | `/agent/audit` | `aud01.*` | `aud01-verify` 面板挂载，屏上无 A7 编号 | 已核销 |
| SET-T13 | A7 链校验 | 正常/空/错/加载 | 读 | `/agent/audit` | `aud01.*` | `aud01-verify` S0–S4；403/404 整组替换 | 已核销 |
| SET-T14 | 规则常量 | 正常（常量） | 读 | — | `set01.acCross*` | `agent-v2-set-access-cross` | 已核销 |
| SET-T15 | BFF 无部门维度 | 正常（当前不开放） | 读 | — | `set01.acDept*` | access-dept 药丸「当前不开放」，无 GAP 编号 | 已核销 |
| SET-M01 | 部署配置 | 未知（不显示推断值） | 读 | — | `set01.provider*` | models-provider 药丸「不显示推断值」 | 已核销 |
| SET-M02 | 部署配置 | 未知（不上屏） | 读 | — | `set01.providerBody` | 文案声明模型名与记账名不由用量反推 | 已核销 |
| SET-M03 | 无 BFF 查询 | 未接入 | 读 | — | — | 未渲染用量表 | 未核销 |
| SET-M04 | `/api/hermes-summary` | 正常/降级/未知/加载/错 | 读 | — | `set01.fGateway` | f-gateway 三态药丸 | 已核销 |
| SET-M05 | Bisheng 外链 | 正常 | 读 | `/model/management` | `set01.openInBisheng` | open-model 链接 | 已核销 |
| SET-M06 | 设计不复制 | 不出现 | 读 | — | — | 页面无模型清单 | 已核销 |
| SET-M07 | gateway.platform | 正常/未知 | 读 | — | `set01.fChannel` | f-channel 显示「飞书」 | 已核销 |
| SET-M08 | 部署常量 | 未知（不上屏） | 读 | — | `set01.nChannel` | 文案声明应用标识不上屏 | 已核销 |
| SET-M09 | 部署常量 | 未知（不上屏） | 读 | — | `set01.nChannel` | 文案声明回调地址不上屏 | 已核销 |
| SET-M10 | 员工工位 | 未接入 | 读 | `/agent/employees` | — | 未渲染能力数组 | 未核销 |
| SET-M11 | 渠道契约 | 正常（常量） | 读 | — | `set01.boundaryBody` | 文案说明卡片/文本形态 | 已核销 |
| SET-M12 | 无 BFF 代理 | 未接入 | 读 | — | `set01.fDeadLetter` | f-deadletter「未接入」，不显示 0 | 已核销 |
| SET-M13 | 部署常量 | 正常（常量） | 读 | — | `set01.nDeadLetter` | 文案写明出站重试 5 次 | 已核销 |
| SET-M14 | M1 不做 | 不出现 | 读 | — | `set01.nDeadLetter` | 文案写明入站事件重试 3 次；页面无路由/回退入口 | 已核销 |
| SET-M13b | 部署常量 | 正常（常量） | 读 | — | `set01.nDeadLetter` | 文案写明入站事件重试 3 次 | 已核销 |
| SET-P01 | 员工版本 | 正常（规则） | 读 | `/agent/employees` | `set01.pInherit*` | pInheritBody + 「去员工详情改额度」链接 | 已核销 |
| SET-P02 | 员工版本 | 正常（规则） | 读 | `/agent/employees` | `set01.pInherit*` | pInheritBody + 「去员工详情改额度」链接 | 已核销 |
| SET-P03 | 员工版本 | 正常（规则） | 读 | `/agent/employees` | `set01.pInherit*` | pInheritBody + 「去员工详情改额度」链接 | 已核销 |
| SET-P04 | 规则常量 | 正常（常量） | 读 | — | `set01.pInheritBody` | 日账自然日/月账自然月 | 已核销 |
| SET-P05 | 规则常量 | 正常（固定 80%） | 读 | — | `set01.fThreshold` | 80% 固定 | 已核销 |
| SET-P06 | 规则常量 | 正常 | 读 | — | `set01.fSemantics` | 不改变判定、不阻断 | 已核销 |
| SET-P07 | 规则常量 | 正常 | 读 | — | `set01.fPush` | 仅负责人私聊 | 已核销 |
| SET-P08 | 部署 | 正常（当前未配置） | 读 | — | `set01.fNotify` | 「当前未配置主动推送」 | 已核销 |
| SET-P09 | 账本 | 正常（规则说明） | 读 | — | `set01.pLedgerBody` | 声明账本是唯一事实；不显示数字 | 已核销 |
| SET-P10 | 账本 | 正常（规则说明） | 读 | — | `set01.pLedgerBody` | 不显示数字；缺行不当作 0 | 已核销 |
| SET-P11 | 未实现 | 正常（规则说明） | 读 | — | `set01.pLedgerBody` | 文案声明不造预占 | 已核销 |
| SET-P12 | 规则常量 | 正常 | 读 | — | `set01.pInheritBody` | 日/月/单次任一用尽即拒绝 | 已核销 |
| SET-P13 | 规则常量 | 正常 | 读 | — | `set01.pStale*` | 60 秒过期即拒绝 | 已核销 |
| SET-P14 | 无端点 | 未接入 | 读 | — | — | 未渲染日切任务状态 | 未核销 |
| SET-P15 | 生产不可用 | 未知 | 读 | — | `set01.judgeProvider*` | 判定口径卡「生产缺省不可用 → 拒绝」 | 已核销 |
| SET-P16 | 规则常量 | 正常 | 读 | — | `set01.judgeCache*` | 30 秒内复用 | 已核销 |
| SET-P17 | 规则常量 | 正常 | 读 | — | `set01.judgeLatency*` | p99 ≤ 150ms / 缓存 ≤ 20ms | 已核销 |
| SET-P18 | 规则常量 | 正常 | 读 | — | `set01.judgeSnapshot*` | 每次运行不可变，保留 ≥ 90 天 | 已核销 |
| SET-P19 | 无端点 | 未接入 | 读 | — | — | 未渲染变更记录 | 未核销 |
| SET-I01 | 会话/回调 | 未知 | 读 | — | `set01.fBisheng` | f-bisheng 未知，不据登录推断健康 | 已核销 |
| SET-I02 | hermes-summary | 正常/降级/未配置/加载/错 | 读 | — | `set01.fHermes` | StatePill 三态 | 已核销 |
| SET-I03 | 廉价只读探测 | 未知（以读探测） | 读 | — | `set01.fDomain` | vDomain「以读请求探测」 | 已核销 |
| SET-I04 | 无单独探针 | 未接入 | 读 | `/agent/runs` | — | 未渲染运行时列表 | 未核销 |
| SET-I05 | 无端点 | 未接入 | 读 | — | `set01.fFeishu` | 「未接入」，不据用户信息 200 声称已连 | 已核销 |
| SET-I06 | 员工 owner 映射 | 正常（只读） | 读 | `/agent/employees` | `set01.aRecipient*` | alert-recipient + 「在版本中查看」 | 已核销 |
| SET-I07 | 员工版本 | 正常（只读） | 读 | `/agent/employees` | `set01.aQuiet*` | alert-quiet + 「在版本中查看」 | 已核销 |
| SET-I08 | 员工版本 | 正常（只读） | 读 | `/agent/employees` | `set01.aQuiet*` | alert-quiet 标题含失败升级 | 已核销 |
| SET-I09 | 版本内嵌 | 正常（不可改放行） | 读 | — | `set01.aFailClosed*` | 药丸「不可改为放行」 | 已核销 |
| SET-I10 | 部署 | 未配置 | 读 | — | `set01.vNotify` | 「当前未配置主动推送」 | 已核销 |
| SET-I11 | 只读探测 | 正常/加载/错 | 读 | — | `set01.probe*` | probe 按钮只读，重试可用 | 已核销 |
| SET-D01 | AUDIT 规则常量（critical 审计热存 90 天） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d01` 渲染常量 | 已核销 |
| SET-D02 | AUDIT 规则常量（critical 冷存 3 年） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d02` 渲染常量 | 已核销 |
| SET-D03 | AUDIT 规则常量（standard 审计 180 天） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d03` 渲染常量 | 已核销 |
| SET-D04 | AUDIT 规则常量（telemetry 7 天） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d04` 渲染常量 | 已核销 |
| SET-D05 | AUDIT 规则常量（渠道原文 30 天） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d05` 渲染常量 | 已核销 |
| SET-D06 | AUDIT 规则常量（策略快照 ≥90 天） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d06` 渲染常量 | 已核销 |
| SET-D07 | AUDIT 规则常量（记忆保留按版本） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d07` 渲染常量 | 已核销 |
| SET-D08 | AUDIT 规则常量（导出上限 1,000,000 行） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d08` 渲染常量 | 已核销 |
| SET-D09 | AUDIT 规则常量（链校验单次 100,000 条） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d09` 渲染常量 | 已核销 |
| SET-D10 | AUDIT 规则常量（下载链接 15 分钟） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d10` 渲染常量 | 已核销 |
| SET-D11 | AUDIT 规则常量（每小时链锚） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d11` 渲染常量 | 已核销 |
| SET-D12 | AUDIT 规则常量（不可删除） | 正常（常量） | 读 | — | `set01.ret*` | `agent-v2-set-data-d12` 渲染常量 | 已核销 |
| SET-D13 | 无端点 | 未接入 | 读 | — | — | 未渲染清理任务状态 | 待实现 |
| SET-W01 | deep/07 §4.6（M2 规划） | M1 不开放 | 写（未开放） | — | — | 零写入口；页面无保存/编辑控件，写配置归 M2 | 已核销 |
| SET-W02 | deep/07 §4.6（M2 规划） | M1 不开放 | 写（未开放） | — | — | 零写入口；页面无保存/编辑控件，写配置归 M2 | 已核销 |
| SET-W03 | deep/07 §4.6（M2 规划） | M1 不开放 | 写（未开放） | — | — | 零写入口；页面无保存/编辑控件，写配置归 M2 | 已核销 |
| SET-W04 | deep/07 §4.6（M2 规划） | M1 不开放 | 写（未开放） | — | — | 零写入口；页面无保存/编辑控件，写配置归 M2 | 已核销 |
| SET-W05 | deep/07 §4.6（M2 规划） | M1 不开放 | 写（未开放） | — | — | 零写入口；页面无保存/编辑控件，写配置归 M2 | 已核销 |
| SET-X01 | deep/07 §8（停用租户） | 公示 | 读 | — | `set01.danger*` | danger-x01 仅说明与去处，零可点危险按钮 | 已核销 |
| SET-X02 | deep/07 §8（归档员工） | 公示 | 读 | — | `set01.danger*` | danger-x02 仅说明与去处，零可点危险按钮 | 已核销 |
| SET-X03 | deep/07 §8（轮换凭据） | 公示 | 读 | — | `set01.danger*` | danger-x03 仅说明与去处，零可点危险按钮 | 已核销 |
| SET-X04 | deep/07 §8（关闭审计） | 公示 | 读 | — | `set01.danger*` | danger-x04 仅说明与去处，零可点危险按钮 | 已核销 |
| SET-X05 | deep/07 §8（重置模型） | 公示 | 读 | — | `set01.danger*` | danger-x05 仅说明与去处，零可点危险按钮 | 已核销 |

## 汇总

- 元素数：83（T15 + M15（含 M13b）+ P19 + I11 + D13 + W5 + X5）
- 已核销：76（91.6%）
- 未核销：6（SET-T08 管理员名单、SET-M03 模型用量表、SET-M10 工位能力、SET-P14 日切任务、SET-P19 预算变更记录、SET-I04 运行时列表——均无端点或未单列读数，页面不伪造）
- 待实现：1（SET-D13 清理任务状态无端点）
- 需共享文件：0
- 死控件：0（危险区与 M2 写配置零入口；页头无主按钮；所有链接指向真实路由）

> 说明：SET-01 的设计源是 deep/07 而非 PRD §5；本表不声称 PRD 已定义这些行。若治理侧要求以 PRD 为唯一来源，需先补 SET-01 元素表。

## QA 判定版 27 行复审（SET01-R1，2026-11-18）

口径：按 `qa-verify` 判定版 27 行计分；「部分」按 0.5 折算，未测不折算。

| 行 | 结论 | 证据 / 说明 |
|---|---|---|
| #1 | 部分 | 主导航 11 项 vs SPEC 8 项，属全局 Shell 口径，本车道不可改；375 已加滑动提示 |
| #2 #3 #5 #7 #8 #9 #10 #11 #12 #13 #16 #18 #19 #20 #21 #22 #23 | 已核销 | 沿用 QA 判定，无回归 |
| #4 | 部分 | 搜索禁用为诚实态；⌘K 未实测，未新增键盘入口 |
| #6 | 已核销 | meta 行新增数据源声明：审计链校验、Hermes 会话摘要、Bisheng 会话（只读） |
| #14 | 已核销 | 模型外链补 `target=_blank` + `rel=noopener noreferrer` |
| #15 | 已核销 | 出站积压改「出站积压」；`hermes-agent`/`hermes` 映射「Hermes 运行时」，未知平台不裸显 |
| #17 | 已核销 | 接收人说明改「接收人取自员工负责人映射，不是可编辑的收件人清单。」，不再出现 `owner` 字段名 |
| #24 | 已核销 | 加载态不再显示「读于」时间，避免未完成读数被当成新鲜值 |
| #25 | 部分 | 错误屏不显 HTTP 码（与工程语言零上屏一致）；C3 口径待参谋裁 |
| #26 #27 | 部分 | 403/404 保持同体整页替换（本轮硬约束），未做专属文案；C5 口径待参谋裁 |

- 27 行结果：已核销 22，部分 5，FAIL 0，未测 0。
- 核销率：严格 22/27 = 81.5%；部分折半 (22+2.5)/27 = **90.7%**。
- 死控件 0；四态齐；工程语言零上屏（`DEAD_LETTER`/`hermes-agent`/`owner`/API 路径/HTTP 码均已清理或映射）。
- VG：D1 已清；D2 已加窄屏滑动提示（像素复验仍归 L6）；D3 1280 横向溢出归 L7。
