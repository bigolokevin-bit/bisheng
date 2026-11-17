# COLLAB /agent/collab 元素核销表（S3-W3 W1）

- 分母：23（`docs/product/console-v3/COLLAB-ELEMENTS.md`，治理 main 7f054d2）
- 数据源：`GET /agent-api/api/delegations[?cursor=]`、`GET /agent-api/api/delegations/<id>/chain`
- 口径：裸 id 不上屏（员工→「员工 · 8 位短码」，原值仅 title/复制）；金额 USD、时间北京时间到分、空值 —；零写按钮；零死控件

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| COLLAB-HEAD-01 | 常量 | 常显 | 全部 | — | collab.title | 页标题存在 | 未核销（locale 只读：设计源「协作交接」≠现有「协作视图」） |
| COLLAB-HEAD-02 | 常量 | 常显 | 全部 | — | collab.subtitle + banner | 说明与写边界同屏 | 核销 |
| COLLAB-HEAD-03 | — | 隐藏 | delegation:write | P7 抽屉 | — | 无 grant 不渲染 | 待实现（BFF 写路由未接线 + 本刀零写按钮） |
| COLLAB-FILT-01 | delegations.status | 默认 | 查看 | 页内 | tenant.statusFilter + collab.status.* | 五态筛选生效 | 核销 |
| COLLAB-FILT-02 | updatedAt | 默认 | 查看 | 页内 | runs01.window24h/7d/30d | 24h/7d/30d 过滤 | 核销 |
| COLLAB-FILT-03 | matrix.employees | 空/降级 | 查看 | 页内 | aud01.filterEmployee | 参与人下拉 | 核销 |
| COLLAB-FILT-04 | 筛选状态 | 有筛选才显 | 查看 | action:清除 | tsk.clear | 清除回全量 | 核销 |
| COLLAB-LIST-01 | items[] | 默认/空/加载/错 | 查看 | — | list.title + state.* | 容器四态 | 核销 |
| COLLAB-LIST-02 | requestId/from/to | 缺 → — | 查看 | action:选中 | correlationCode + 员工短码 | 短码 8 位、姓名优先 | 核销 |
| COLLAB-LIST-03 | status/updatedAt | 缺 → — | 查看 | — | collab.status.* + fmtStamp | 五态徽标 + 到分 | 核销 |
| COLLAB-LIST-04 | taskId | 缺 → — | tasks:read | /agent/tasks/:id | collab.audit.task | 真跳 | 核销 |
| COLLAB-LIST-05 | budget | 缺 → — | 查看 | — | list.budgetOwner + fmtUsd | 记在发起方 + USD | 核销 |
| COLLAB-LIST-06 | chain | 加载/空/错/403 | audit:read | /agent/audit/:id | chain.* | 时间线四态 | 未核销（缺 audit eventId，仅能复制 correlation） |
| COLLAB-STATE-01 | items=[] | 空 | 查看 | action:回列表 | state.empty.* | 空态说明 | 核销 |
| COLLAB-STATE-02 | 响应 | 错/超时 | 查看 | action:重试 | state.error.* | 人话+请求号+重试 | 核销 |
| COLLAB-STATE-03 | 403/404 | 整页 | 查看 | 回 /agent | state.denied.* | 403=404 同体 | 核销 |
| COLLAB-STATE-04 | 读取中 | 加载 ≤10s | 查看 | — | state.loading.* | 骨架，超时转错误 | 核销 |
| COLLAB-STATE-05 | 缺字段 | 降级 | 查看 | action:重试 | 空值 — | 缺失不造值 | 核销 |
| COLLAB-DRAW-01 | — | 隐藏 | delegation:write | 抽屉 | — | 打不开则路径不存在 | 待实现（P7 未接） |
| COLLAB-DRAW-02 | — | 隐藏 | delegation:write | 抽屉 | — | 同上 | 待实现（P7 未接） |
| COLLAB-DRAW-03 | — | 隐藏 | delegation:write | 抽屉 | — | 同上 | 待实现（P7 未接） |
| COLLAB-DRAW-04 | — | 隐藏 | delegation:write | 抽屉 | — | 唯一 primary 在抽屉内 | 待实现（P7 未接） |
| COLLAB-FOOT-01 | 常量 | 常显 | 全部 | — | collab.foot.* | 脚注两句 | 未核销（脚注原文需新 locale 键，只读） |

元素数 23 ｜ 已核销 15 ｜ 核销率 65.2% ｜ 死控件 0

- 请求改共享文件（locale，三处）：HEAD-01 标题「协作交接」；LIST-06 需审计事件深链所需文案；FOOT-01 脚注原文「无职权不能互派；拒绝 403 给人话」。
- 待实现 5 项均阻塞于同一前提：BFF 写路由（P7 派活抽屉），且本刀令明确零写按钮。

## 写入口接通后可点亮（Q3 核对，见 `BFF-DELEGATION-WRITE-SPEC.md`）

| elementId | 现状 | 接通后可达 | 依赖 |
|-----------|------|-----------|------|
| COLLAB-HEAD-03 | 待实现 | 仍是待实现 | **D1 建单** + P7 抽屉，非 D2–D5 |
| COLLAB-DRAW-01..04 | 待实现 | 仍是待实现 | 同上；抽屉内 DRAW-04 为唯一 primary |
| COLLAB-LIST-06 | 未核销 | 仍未核销 | audit 查询面需返回 `eventId`，与写入口无关 |
| COLLAB-HEAD-01 / FOOT-01 | 未核销 | 仍未核销 | locale 只读，需集成车道补键 |

- 结论：D2–D5（接受/拒绝/交接/完成）接线**不会**直接提升 23 元素核销率；它们点亮的是既有「派单与交接卡」的动作区（当前为静态说明，不在分母内）。
- 当前上限仍为 15/23 = 65.2%；提升到 23/23 需三件事：D1 + P7 抽屉（5 项）、audit `eventId`（1 项）、locale 三键（3 项中的 2 项，LIST-06 文案另计）。
- 死控件 0（写入口未接通前不渲染任何写控件，符合「未开放入口给原因、不给灰按钮」）。
## 写动作接线（2026-11-17）

四个写动作已接到 L7 的 BFF 写代理（页面按阶段渲染，终态不渲染任何按钮）：

| 动作 | BFF 路由 | body | 可用阶段 | 写后 |
| --- | --- | --- | --- | --- |
| 接受 | POST /agent-api/api/delegations/{id}/accept | 空 | 已请求 | 重取列表与链 |
| 拒绝 | POST /agent-api/api/delegations/{id}/reject | {reason} 必填 | 已请求 | 重取列表与链 |
| 交接 | POST /agent-api/api/delegations/{id}/handoff | 空 | 已接受 | 重取列表与链 |
| 完成 | POST /agent-api/api/delegations/{id}/complete | {progressNote} 必填 | 交接中 | 重取列表与链 |

- 幂等：每次提交生成一个请求号，失败重试复用同一个；成功后换新。写请求带 `X-Request-Id`，读回 `X-Console-Request-Id`。
- 错误：401 顶部会话横幅；403 页内中性句；404「该委托不存在，或不属于当前租户」；409 / 状态冲突「该委托状态已变化，请刷新后重试」；5xx/超时人话+请求号+重试。原始 code 只进 `title`，不上正文。
- 计数不变：元素数 23 ｜ 已核销 15 ｜ 核销率 65.2% ｜ 死控件 0。四动作属于 LIST-02/LIST-06 的交互，不是独立元素；HEAD-03 与 DRAW-01..04 仍待实现（依赖 D1 建单与 P7 抽屉），接通 D2–D5 不改变核销数。
