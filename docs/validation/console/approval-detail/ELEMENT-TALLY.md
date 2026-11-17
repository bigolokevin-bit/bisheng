# APR-02 审批详情 · 元素核销表（Q2 诚实化）

- 页面：`/agent/approvals/:id`（`ApprovalDetailPage.tsx`）
- 设计/契约依据：`docs/product/design/console-v2/APR02-TARGET-SPEC.md` §1.2–1.8、§2，`services/domain/READ-PORT-MATRIX.md` §5（AP3 / CR-043 / message_send 缺口）
- 本轮口径：Q2 存量页诚实化（去工程语言 / 枚举中文化 / 人员与版本短码 / 可读 diff / 404 与 403 同体 / 请求号 + 重试）
- 更新：2026-11-17

## 逐元素判定

| elementId | 设计源 | 数据源 | 判定 | 证据 / 说明 |
|---|---|---|---|---|
| APR02-E01 页头标题 | §1.2 | `binding.changeKind` | 已实现 | 四种变更类型中文；未知「其他变更」，原文只进 title |
| APR02-E02 审批单号 | §1.2 | `approvalId` | 已实现 | 截断显示 + 复制完整值；键盘可达 |
| APR02-E03 状态 pill | §1.2 | `status` | 已实现 | 八态中文；未知 —，原文只进 title |
| APR02-E04 风险 pill | §1.2 | `riskLevel` | 已实现 | 高/中/低中文；未知「未评级」，原文只进 title |
| APR02-E05 类型 pill | §1.2 | `type` | 已实现 | 业务动作 / 确认；未知「其他类型」 |
| APR02-E06 到期倒计时 | §1.2/D-4 | `remainingSeconds` | 已实现 | 只认服务端值；终态 0 →「已结束」；title 为北京时间 |
| APR02-E07 更新于 / 数据源 | §1.2 | 前端时间 + 静态 | 已实现 | 北京时间到分；数据源为「审批服务」，无 API 路径 |
| APR02-E08 申请人 / 代谁申请 | §1.3 | `requestedBy` / `onBehalfOf` | 已实现 | 姓名或「用户 #N / 员工 · 短码」；原始 ref 只进 title |
| APR02-E09 审批人 + 角色 | §1.3 | `approvers[]` | 已实现 | 身份可读；角色中文，未知「审批成员」 |
| APR02-E10 所需批准数 / 有效期 / 剩余 | §1.3 | `requiredApprovals` / `ttlSeconds` / `remainingSeconds` | 已实现 | 人数原值 + 「任意一位可决」；时长人话；缺值 — |
| APR02-E11 创建 / 到期时间 | §1.3 | `createdAt` / `expiresAt` | 已实现 | 北京时间 `MM-DD HH:mm`；title 为格式化时间，不是 ISO |
| APR02-E12 策略引用 / 参数摘要 | §1.3 | `policyDecisionId` / `argsDigest` | 已实现 | 短码 + 复制完整值；不再整段长串直出 |
| APR02-E13 申请理由 | §1.3 | `reasonText` | 已实现 | 引用块；缺失 — |
| APR02-E14 绑定对象（present-only） | §1.4/D-1 | `binding` | 已实现 | 对象类型/短码/变更类型/生效时间/运行/摘要；缺失不渲染 |
| APR02-E15 版本变更六键 | §1.5 | `detail.changeDetail` | 已实现 | before→after + 六键；员工与版本用可读短码，不直出原始 ID |
| APR02-E16 版本快照 | §1.5 | `detail.versions` | 已实现 | 只渲染投影已有版本；标记列注明 UI 推导 |
| APR02-E17 message_send 摘要 | §1.5/G-6 | `binding.messageDigest` | 已实现 | 摘要短码 + 复制；说明只提供摘要，不伪造明文 |
| APR02-E18 版本类缺 detail | §1.5 | `detail` 缺失 | 已实现 | 「变更明细不可得」面板；不补算、不 dump JSON |
| APR02-E19 其他 changeKind | §1.5 | 无 canonical diff | 已实现 | 「契约未定义」面板；不猜测差异形状 |
| APR02-E20 决策时间线 | §1.6 | `decisions[]` | 已实现 | 按时间正序；姓名/判定/时间/意见；空态「暂无决策」 |
| APR02-E21 终态字段条 | §1.6 | `verdict/decidedAt/consumedAt/supersededBy` | 已实现 | 终态才出现；`supersededBy` 为短码链接，不直出裸 ID |
| APR02-E22 审批操作区 | §1.7 | AP2 写路径 | 已实现 | 三按钮顺序与门控保持；二次确认；未新增写路由 |
| APR02-E23 空响应 200 | §1.8 | AP3 空体 | 已实现 | 「审批内容为空」+ 重试/返回；无 HTTP 码 |
| APR02-E24 404 / 403 同体 | §1.8/D-2 | AP3 404/403 | 已实现 | 同一标题、同一说明、同一请求号行；404 不提供无意义重试 |
| APR02-E25 错误 + 请求号 + 重试 | §1.8 | AP3 5xx/超时 | 已实现 | 人话错误 + 可复制请求编号 + 重试；无 HTTP 码/机器码 |
| APR02-E26 加载骨架 | §1.8 | — | 已实现 | 无闪烁动画；约 10 秒切错误屏 |
| APR02-E27 页脚口径 | §1.2 | 静态 | 已实现 | 北京时间 / 服务端剩余时间 / 缺失 — / 不补算；无字段名 |
| APR02-E28 未知枚举降级 | D-3 + Q2 | 各枚举 | 已实现 | 中文兜底 + 原值进 title；不再把枚举原值当标题/标签 |
| APR02-E29 历史同类单 | E50 | 无端点 | 未实现（域缺口） | 不提供假筛选入口；保持只读详情 |
| APR02-E30 风险差异四项 | E31 | 无契约字段 | 未实现（契约缺口） | 不渲染 0/假数值；整块不展示 |

**核销率：28 / 30 = 93.3%**（2 项为域/契约缺口，页面不伪造入口或数值）

## 本轮 Q2 修复

1. 清除页面上 AP3 / CR-043 / BFF / `GET /api/approval?id=` / `present-only` / `remainingSeconds=` / `targetHash=` 等工程语言，原值仅进 title。
2. 变更类型、状态、风险、类型、角色、判定全部中文；未知枚举降级为「其他变更 / 未评级 / 其他类型 / 其他成员 / 已处理」。
3. 员工、版本、权限、运行、摘要、绑定指纹、替代单改为短码或姓名；完整值保留复制与 title。
4. 变更明细不再直出 `change.employeeId`、`fromVersionId`、`removedGrantIds` 原文；改为可读短码 + 可读 diff。
5. 404 与 403 使用同一文案与布局；404 移除无意义重试，仅保留返回列表。
6. 错误文案移除 HTTP 码（详情、空体、写入失败共 9 条），保留请求号与重试。
7. HelpTip 的 targetHash / messageDigest / presentOnly 文案改为人话，不再以字段名作标题。
8. 测试：`ApprovalDetail.test.tsx` 37 项全过；全量 AgentConsoleV2 711 项全过。