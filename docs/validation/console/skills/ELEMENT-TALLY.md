# SKILLS `/agent/skills` 技能治理 — 元素核销表

- 设计源：`docs/product/console-v3/PRD-v0.3.md` §5.8（治理 main `c93cc3f`）
- 实现代次：fork `lane/L4-page-skills` @ `5a0b092`（技能页实现 `54de876` 起，本表随本轮修单提交）
- 写域：`SkillsPage.tsx`、`skills.ts`、`skills.css`、own tests、`agentConsole.v2.skills` 自有命名空间
- 口径：只读页；`sharedCount=0` → 「未被引用」；缺值 `—`；不造 0 行假数据

## 七态口径

加载骨架 / 正常 / 诚实空态 / 错（人话 + 请求号 + 重试）/ 401 会话横幅 / 403 与 404 同体 / 404 深链不静默回落。

## 核销

| elementId | 数据源 | 七态 | 权限 | 去向 | 文案key | 验收腿 | 状态 |
|---|---|---|---|---|---|---|---|
| SK-TABLE-01 技能列表 | `GET /api/skills` | 加载/正常/空/错/401/403/404 齐；空态「还没有技能版本」+ 说明 | 只读 | 行展开 `/agent/skills/:skillId` | `skills.title` / `emptyTitleV2` / `emptyHint` / `scrollHint` | `Skills.test.tsx`（10 例） | 已核销（空态代次） |
| SK-BADGE-01 共享 / 独有 | `sharedCount` / `scope` | 0 人→「未被引用」；共享→「共享 N 人」 | 只读 | 无（状态徽标） | `skills.scopeShared` / `scopeExclusive` / `scopeUnused` | `Skills.test.tsx` | 已核销（空态代次） |
| SK-META-01 版本 / hash / owner | `skill_version` | 缺值 `—`；hash 可复制；owner 短码 | 只读 | hash `action:copy`；owner 短码（`ownerUserId` 非 employeeId，不造假路由） | `skills.colVersion` / `colHash` / `hashCopy` / `colOwner` | `Skills.test.tsx` | 已核销（空态代次；owner 无链接为已知偏差） |
| SK-REF-01 被谁引用 | `skillRefs` 反查 | 空→「暂无员工引用」；有值→前 3 位 +「另有 N 位」 | 只读 | `/agent/employees/:id` | `skills.refsNone` / `refsMore` / `detailRefsEmpty` | `Skills.test.tsx` | 已核销（空态代次） |

## 计数

- 元素总数：**4**
- 已核销：**4**（全部为「空态代次」放行）
- 核销率：**100%**
- 死控件：**0**（行展开与引用链接均有真路由；owner 为文本，不渲染可点元素）

## 「空态代次」放行条件

当前 PASS 只覆盖**空态代次**：`items=[]` 时骨架/空态/错误/权限四类状态可复现，且 375 表格在卡内横滚、不撑破页面。真实数据代次尚未取证。

转正式 PASS 需同时满足：

1. 同代次、已登录会话中 `GET /api/skills` 返回 ≥1 条真实记录（含 `skillId/name/version/contentHash/ownerUserId/sharedWith`）。
2. 四元素按真实值复跑：列表行、共享/独有徽标、版本/hash/owner、引用方链接；有值处不得落 `—`，引用方链接必须打开 `/agent/employees/:id`。
3. 1440×900 与 375×812 截图 + `asOf` + 请求号同笔留档；死控件 0、裸键 0；所有者（owner）链接缺失作为已知偏差记录或先补稳定映射。

## 已知边界

1. BFF 不转发查询参数，分页/搜索不渲染（未渲染，不计死控件）。
2. `/agent/skills` 暂无 rail 入口（`Shell.tsx` 为共享只读文件）；面包屑回退「概览」。需入口时走「请求改共享文件」。
3. 线上 200 未验：本环境探针仅 401；en/ja 文案复用既有 key，本轮未新审。
4. 深链 `/agent/skills/:skillId` 对已删对象显示 `deepMiss` + 返回全部技能，不静默回落。