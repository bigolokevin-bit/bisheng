# 员工详情页 验收卡（实现侧摘要）

- 页面/路由：数字员工 · 详情 `/agent/employees/:id`（EMP-03）
- 设计源：PRD v0.3 §5 **无 EMP-03 元素表**；元素行沿用既有 `EMP-DETAIL-01..07`，不造新 ID。设计源补号后再扩。
- 实现：`src/frontend/platform/src/pages/AgentConsoleV2/EmployeeDetailPage.tsx`
- 状态：**实现侧自检，未独立验收、不自签**；独立验收归 L6。
- 更新：2026-11-18（Q2 核销冲刺）

## 元素核销

见 `ELEMENT-TALLY.md`：**7/7 = 100%**（含 1 项「仅公示，零写入口」：EMP-DETAIL-06）。

## 本轮实现口径

- 负责人：`pilot_owner_placeholder` / 空值 → 「未指派」，不显裸 id。
- 预算：配置 / 未配置 / 缺失 — 三态；配置的 0 是真实 0，不写成「未配置」，缺失也不写 0。
- 时间：生效时间与审计时间北京时间到分（`YYYY-MM-DD HH:mm`）。
- 版本：版本链取 E15 真实行，当前版本徽标与生效时间来自同一版本。
- 技能数：E11 详情契约无 `skillCount`；列表列仅在行携带时显示，缺失 —；详情不新造技能行。
- 危险区：只读公示「停用/改预算需写权限并记入审计」，零按钮（`agent-v2-ed-danger-readonly`）。
- 错误：人话 + 可复制请求编号 + 重试；5xx 独立卡，不落 404；403/404 同体。

## 验证与边界

- 证据：`agentConsoleV2BudgetHonest.test.tsx` 覆盖预算三态、负责人、`2026-11-15 08:00`、危险区零控件；全量 42 files / 734 tests。
- 未验证：live 200 未取；未做浏览器像素复验；未做 L6 独立验收。
