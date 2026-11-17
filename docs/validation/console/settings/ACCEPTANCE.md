# SET-01 设置页 · 实现侧验收摘要（Q2）

- 日期：2026-11-18
- 页面：`/agent/settings` → `/agent/settings/<section>`（六组：租户与安全 / 模型与渠道 / 策略与预算 / 通知与集成 / 数据与保留 / 危险操作）
- 实现：`SettingsPage.tsx`、`set01.ts`、`set01Kit.tsx`、`set01.css`、`AuditVerifyPanel.tsx`（仅新增 `hideCode` 传参，不影响 AUD-01 默认行为）
- 设计源：`docs/product/design/console-v2/deep/07-settings.md` §4。PRD v0.3 §5 没有 SET-01 元素表；本页不按 PRD 造 ID。

## 核销结论

- 元素数 83；已核销 **76 / 83 = 91.6%**；未核销 6；待实现 1（SET-D13 无端点）；需共享文件 0；死控件 0。
- 逐行证据见 `ELEMENT-TALLY.md`。
- 未核销 6 项：SET-T08 管理员与审批人名单（Bisheng 用户表，无只读复制面）、SET-M03 模型用量表（无 BFF 查询）、SET-M10 工位能力（应在员工详情读，本页不单列）、SET-P14 日切任务状态（无 BFF 端点）、SET-P19 预算变更记录（无专用端点）、SET-I04 运行时列表（无单独探针）。页面不伪造这些读数。

## 本轮实现

- 缺失值：租户名称、会话缓存、构建版本均显示「未知/无端点」；租户 ID 不上屏；密钥只显示未知，不回显值、长度或哈希。
- 工程语言：移除屏上 API 路径、HTTP 码、GAP/CR/ADR 编号、`sanitized/degraded`、`fail-closed/allow`、`raw_ref/append-only`、裸字段名；技术值只保留在代码/契约层，不上屏。
- 三态：写开关与密钥保持「未知」，不落成「关」；上游降级显示 `—` 或降级药丸，不改写成 0。
- 四态/拒绝态：模型与集成组具备加载、正常、错误、403、404；403/404 使用同一段正文整组替换，不先渲染骨架再消失；错误带请求编号与重试。
- 零写入口：页头无主按钮；W01–W05 的写配置在 M1 全部不渲染；危险区只做公示与去处链接，零可点危险控件。
- 深链：六组均走 `/agent/settings/<section>`；刷新由路由参数决定分组，组件重新读取，不依赖内存状态。
- 375：沿用 `set01.css` 的窄屏单列与可换行规则；本轮未新增固定宽度。

## 验证

- `cd src/frontend/platform && ./node_modules/.bin/vitest run src/pages/AgentConsoleV2/__tests__`（全量，见回执尾行）。
- `Settings.test.tsx`：23 条，覆盖四态、403/404 同体、零写入口、脱敏、A7 面板、工程语言泄漏守卫。
- Build：`VITE_AGENT_CONSOLE_V2=1 ./node_modules/.bin/vite build --outDir build-set2`；entry/chunk/sha 与标记命中见回执。

## 未验证 / 边界

- live 200 未取（无可用 token）；本轮为代码、单测与构建证据。
- 未做浏览器像素复验；375 结论来自 CSS 规则与既有窄屏测试，不是截图实测。
- 独立验收仍归 L6；本文件是实现侧自检，不替代独立验收、不自签。
