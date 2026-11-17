# SHELL `/agent/*` 外壳 — 元素核销表

- 设计源：`docs/product/console-v3/PRD-v0.3.md` §2（IA / rail）/ §5（页头通用件）/ §6（裁定）
- 实现：`src/frontend/platform/src/pages/AgentConsoleV2/Shell.tsx`（共享件，只读）+ `agentConsoleV2.css` / `consoleShell.css`
- 口径：只读外壳；不承载业务写入口；主题深色优先，浅色同 DOM 换令牌；空值 `—`；时间北京时间到分
- 权威证据：`docs/validation/console/shell/EVIDENCE.md`（W1 实机 8 路由）+ `__tests__/agentConsoleV2Shell.test.tsx`、`__tests__/ShellNav.test.tsx`

## 七态口径（外壳仅四种相关）

| 代号 | 含义 |
|---|---|
| 正常 | 外壳 + 页面内容正常渲染 |
| 加载 | 路由级 `<Suspense>` 骨架（`agent-v2-route-skeleton`），无闪烁动画 |
| 错误 | 路由错误边界 `role=alert` + 重试（`agent-v2-page-error`），外壳不消失 |
| 404 | 未知深链落 `agent-v2-404`，rail/顶栏完整，不静默回首页 |

## 核销

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| SHELL-NAV-01 rail 分组与条目 | 静态注册表 `L1_ENTRIES` | 常态；11 条 / 4 组 | 已登录可见 | 各 `route:` | `navOverview`…`navSettings` | `ShellNav.test` 断言 11 条与分组顺序 | 已核销 |
| SHELL-NAV-02 当前项高亮 | 路由 `activeKey` | 常态；未知路径回落总览高亮 | 已登录 | — | 同上 | `agentConsoleV2Shell.test` 渲染 8 条 L1 路由 | 已核销 |
| SHELL-CRUMB-01 面包屑两段 | 静态「控制台」+ 当前页名 | 常态 | 已登录 | 首页段可回 `/agent` | `shellConsole` | `agentConsoleV2Shell.test` 断言默认两段文案 | 已核销 |
| SHELL-CRUMB-02 详情尾段 | 页面 `useConsoleCrumbTail` | 未 opt-in 时无尾段；opt-in 后追加 | 已登录 | — | 页面自供 | 同测试断言 opt-in 前后 | 已核销 |
| SHELL-SEARCH-01 搜索位 | 静态说明（无输入框） | 常态；不渲染假输入 | 已登录 | —（非控件） | `shellSearchOff` | `agentConsoleV2Shell.test`「死控件已清除」 | 已核销 |
| SHELL-ENV-01 环境标识 | 静态「本地试点」 | 常态 | 已登录 | — | `envPilot` | 测试断言 chip 存在 | 已核销 |
| SHELL-THEME-01 主题切换 | localStorage `agentConsole.v2.theme` | 默认深色；切换后持久化 | 已登录 | — | `themeDark` / `themeLight` | 测试断言 dark→light + 存储 | 已核销 |
| SHELL-ACCOUNT-01 账号区 | 当前会话身份 | 缺身份时给中性占位，不挂假菜单 | 已登录 | —（无菜单壳） | `shellAccount*` | 测试断言 fallback 文案 | 已核销 |
| SHELL-404-01 未知深链 | 路由 `*` | 404 页 + 外壳完整 | 已登录 | 回 `/agent` | `shellNotFound*` | 测试断言 `agent-v2-404` | 已核销 |
| SHELL-ERR-01 路由错误边界 | 子路由异常 | 错误卡 + 重试，rail 保留 | 已登录 | action:重试 | `shellError*` | 测试断言 `role=alert` 与恢复 | 已核销 |
| SHELL-SKEL-01 路由骨架 | Suspense fallback | 加载 | 已登录 | — | — | 代码路径 + EVIDENCE 无闪烁 | 已核销 |
| SHELL-RESP-01 响应式 | — | 1440 与 375 `scrollWidth==clientWidth` | 已登录 | — | — | EVIDENCE：1440×900 / 375×812 实机 | 已核销 |

## 计数

元素数 12 ｜ 已核销 12 ｜ 核销率 100% ｜ 死控件 0

## 边界与请求

- 本表只覆盖外壳可见性/导航/账号区/主题与四态外壳，不含业务页元素（各自 tally 负责）。
- 无共享文件改动请求：外壳当前实现已满足本表全部行；rail 条目增删由集成车道维护。
- 已知外部缺口（不影响本表判定）：EVIDENCE 记录的 8 路由实机取证早于 S3 新增页；新页复用同一外壳，导航条目数由 `ShellNav.test` 覆盖。