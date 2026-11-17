# BFF 委托写入口规格（四动作）— Q3 准备件

> 依据：`docs/contracts/DELEGATION.md` v1.0（冻结）。本件只做核对与规格，**不改页面代码、不新增路由**。
> 落点说明：刀令建议的 `apps/console/BFF-DELEGATION-WRITE-SPEC.md` 在本仓不存在——本仓（bisheng fork）没有 `src/backend/bisheng/apps` 目录，也没有任何 delegation 后端路由（`grep -rl delegation src/backend/bisheng --include=*.py` 仅命中无关的 runtime_material 与 linsight）。控制台 BFF 是独立服务（部署层 `Caddy → /agent-api → BFF`），因此本件落在 `docs/validation/console/collab/`，作为 L7 与集成车道的交付输入。

## 0. 一个前提：浏览器不直连 domain

契约 v1.0 §3 明确「本族端点不进 BFF/控制台直连面」，并要求每个请求带 `X-Tenant-Id` 与 `X-Internal-Token`。所以写路径必然是：

```
浏览器 → BFF（/agent-api/api/...，带会话 Cookie）
      → BFF 校验操作者与职权（DL-2 留给 BFF）
      → 注入 X-Tenant-Id + X-Internal-Token
      → domain /v1/...（服务端直连）
```

页面只认 BFF 的 `/agent-api` 前缀；任何 domain 错误码都在 BFF 映射成人话（`code` + `message` + `requestId`）。

## 1. 四个写动作

| # | 动作 | domain 端点 | BFF 路由 | 请求体 | 幂等 | 成功 | 权限 | 审计 |
|---|------|------------|---------|--------|------|------|------|------|
| D2 | 接受 | `POST /v1/delegations/{id}/accept` | `POST /agent-api/api/delegations/{id}/accept` | 空 | **无**（重复=400） | `200` Delegation（status=accepted, acceptedAt） | 接受人本人；from→to 的 delegate grant | `delegation.accepted` |
| D3 | 拒绝 | `POST /v1/delegations/{id}/reject` | `POST /agent-api/api/delegations/{id}/reject` | `{ reason?: string ≤500 }` | **无** | `200` Delegation（status=rejected, rejectReason） | 接受人本人 | `delegation.rejected` |
| D4 | 交接 | `POST /v1/tasks/{taskId}/handoff` | `POST /agent-api/api/tasks/{taskId}/handoff` | 空 | **无** | `200` Task（assignee=from，状态不变） | 接受人本人（单须 accepted） | `delegation.handed_off` |
| D5 | 完成 | `POST /v1/tasks/{taskId}/complete` | `POST /agent-api/api/tasks/{taskId}/complete` | `{ progressNote: string }` **必填** | **无** | `200` Task（status=done, progress_note, closed_at） | 发起人本人（单须 handed_off） | `delegation.completed`（并 `delegation.charged` 两行） |

D1（建单，`POST /v1/delegations`，幂等键 `requestId`）本期**不做**：页面零写按钮，P7 派活抽屉待写入口接通后再排。

### 1.1 状态机与 404 同体

- 迁移表（§2）：`requested→accepted`（接受）、`requested→rejected`（拒绝，任务→cancelled，`status_reason` 缺省 `delegation rejected`）、`accepted→handed_off`（交接，任务 assignee 改回 from、状态不变）、`handed_off→completed`（完成，任务→done + `progress_note` + `closed_at`）。
- 终态 `rejected/expired/completed` 无出边；表外迁移（含重复调用 D2–D5）一律 `400 delegation.illegal_transition`，**不产生任何写入与审计**。
- `404 delegation.not_found` 覆盖「不存在 / 跨租户 / 非 active」三态，body 逐字节一致、不带 id（BFF 不得补 id 或区分文案）。
- D4/D5 以 `taskId` 寻址，domain 侧按 `(tenant_id, task_id)` 反查单。

### 1.2 错误码（BFF 原样透传 code，文案由前端）

| HTTP | code | 语义 | BFF 处理 |
|------|------|------|----------|
| 400 | `request.missing_tenant` | 缺 `X-Tenant-Id` | 不应发生（BFF 注入）；出现即 500 级配置错，记日志 |
| 400 | `request.invalid_body` | 体不合法（含 `progressNote` 缺失、title 超长、budgetOwner≠from） | 透传 |
| 400 | `delegation.illegal_transition` | 状态机不允许（含重复动作） | 透传；**BFF 不得自动重试** |
| 401 | `delegation.unauthorized` | `X-Internal-Token` 缺失/不符 | 不应发生；出现即配置错，记日志 |
| 403 | `delegation.denied` | 无 from→to 的 delegate grant（零写入） | 透传；message 不暴露 grant 名 |
| 404 | `delegation.not_found` | 不存在/跨租户/非 active（同体） | 透传，不得补细节 |

审计与业务**同事务 fail-closed**：审计写失败则整个动作失败。

## 2. 现有 BFF 缺口（本仓实测）

| 项 | 现状 | L7 需新增 |
|----|------|-----------|
| domain 代理 | 无任何 `/v1/delegations*` 或 `/v1/tasks/*/handoff|complete` 代理 | 4 条写代理 + 2 条读代理（`GET /api/delegations`、`GET /api/delegations/{id}/chain`，已由 L1 只读口提供） |
| 租户/令牌注入 | 无 | 从会话解析 tenant，注入 `X-Tenant-Id`；内部令牌走服务端配置，禁止下发浏览器 |
| 操作者职权（DL-2） | 契约留给 BFF | 校验「当前登录人 = 该单接受人/发起人」且岗位 actions 含 `delegate`；不满足 → `403 delegation.denied` |
| 错误映射 | 无 | 保留 `code`，补 `message` 人话与 `requestId`；403/404 前端同体 |
| 重试 | 无 | **禁止**对 D2–D5 自动重试（非幂等）；只可让用户手动重试 |
| 请求号 | 无 | 生成/透传 `X-Console-Request-Id`，错误响应必须带回 |

## 3. 写入口接通后可点亮的元素

| elementId | 现状 | 接通后 |
|-----------|------|--------|
| COLLAB-HEAD-03 | 待实现（唯一 primary「发起派活」） | 需 D1 建单 + P7 抽屉；本期仍不做 |
| COLLAB-DRAW-01..04 | 待实现（P7 抽屉） | 需 D1（建单）与 D2（接受方视角）；依赖 HEAD-03 |
| COLLAB-LIST-06 | 未核销（审计事件深链需 `eventId`） | 与写入口无关；需 audit 查询面返回 `eventId` |
| COLLAB-HEAD-01 / FOOT-01 | 未核销（locale 只读） | 与写入口无关；需集成车道补 locale 键 |

结论：四个写动作的 BFF 接线本身**不会**直接点亮 23 元素中的任何一条——HEAD-03/DRAW 依赖的是 D1（建单）与抽屉交互，而非 D2–D5。D2–D5 接通后点亮的是「派单与交接卡」的动作区（当前以一句静态说明呈现），它不在 23 元素分母内，属页面既有卡片区。此点须让 L0 知情，避免把核销率与写入口绑定。

## 4. 页面侧口径（不改代码，仅登记）

- 拒绝理由：页面要求必填（比契约 `reason?` 严），属 UI 侧校验；domain 不强制。
- 完成结果：`progressNote` 页面必填，与契约一致。
- 四个动作的失败文案（人话，四条）：已经走过 / 没有权限 / 找不到这件事 / 刚才没生效，刷新重试。
- 金额：只 USD；本页不换算、不显示符号以外的推导值。

## 5. 待决

1. D2–D5 的 BFF 路由是否需要 `If-Match`/版本号避免并发双击——契约未要求，建议以「非法跳转 400」兜底即可。
2. `delegation.charged` 两行（day/month）由 domain 在完成动作内写；BFF 不额外记。
3. `expired` 无 sweeper（DL-1），前端按终态同构展示，不做定时刷新。