# MET-01 运行指标 · VG/LG 证据台账（lane/L4-met01-v2）

> 日期：2026-11-16 ｜ 分支：`lane/L4-met01-v2` ｜ 基点：bisheng main `4c1df65`（TSK-01 合入后）
> WIP 基线：`db05703`（7 文件显式 add：4 新 + 3 改，stash pop 无冲突，TSK 路由未覆盖）
> 最终 commit：`5df3036`（三语 locale 265 键 + 51 例测试 + 类型/文案修复）
> 证据 commit：本文件。截图**不进仓库**（SPEC §8 纪律），路径见下。
> 纪律：不部署、不判 VG PASS；本台账只记实测数字与偏差，判定归 L6/VG。

## 1. 门禁实测

| 项 | 命令 | 结果 |
|---|---|---|
| targeted vitest（新增） | `./node_modules/.bin/vitest run src/pages/AgentConsoleV2/__tests__/met01.test.ts src/pages/AgentConsoleV2/__tests__/MetricsPage.test.tsx` | **51/51 通过**（met01 31 + MetricsPage 20） |
| 回归 vitest（全 AgentConsoleV2） | `./node_modules/.bin/vitest run src/pages/AgentConsoleV2` | **16 文件 235/235 通过** |
| scoped eslint | `../node_modules/.bin/eslint <8 个改动/新增 ts/tsx>` | **0 error 0 warning** |
| 类型（本 lane 范围） | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` 筛 Metrics*/met01/metIcons/shellPages/v2Data | **0 错**（仓库既有它处错误不在本 lane 范围，未动） |
| 空白 | `git diff --check` | 干净 |

测试覆盖（对照 SPEC §9）：正常三块同显＋五铁律上屏＋页脚铁律 3；仅 GET 四端点＋写入口正则 0 命中；
热力 168 格/周一起/4 小时轴 6 标签/0 格不可点/非 0 格 since+from=metrics；成本名解析与未找到注；
加载三骨架无 0/—＋导出禁用带原因；部分降级单细条＋A0 注意＋配置未完成；全降级 A 错误卡 B/C 照常；
502 带 HTTP+request id 不带机器码；sqlite fallback 值保留＋仅 token 注；空态不画网格/未计价/0 行账目；
403 整页无骨架；401 双分流（跳登录带回跳 vs 卡内凭据文案）；404 卡内＋request id；422 重试不改参；
切窗保留旧值＋更新中＋C 不重取；?win=99 回落记页脚；CSV schema 首末注释＋时间戳文件名＋toast。

## 2. Live 环境

- dev：`vite.metdev.config.mts`（**未跟踪、永不入库**，TSK 同款包装）→ 127.0.0.1:5403，`VITE_AGENT_CONSOLE_V2=1`。
- 代理：`/agent-api` → console BFF 127.0.0.1:8092（已运行）；上游 8642/9119 本机在听。
- 登录：ego-browser 会话既有身份（opsadmin），未走 fixture。
- 四端点实测（浏览器 fetch arm，全 GET）：
  `/agent-api/api/hermes-summary` 200 · `/agent-api/api/hermes-usage?days=7` 200 ·
  `/agent-api/api/run-activity?weeks=4&tz=Asia%2FShanghai` 200 · `/agent-api/api/employees?limit=100` 200。
- 真实数据快照（20:39 北京）：A0 正常；活跃 agent 0（真 0）；当日请求/消息/tokens 0（真 0，ok 来源允许）；
  P95 null→—；版本 unknown→未知版本；内存 71.1%（warning 档）/磁盘 45.4%；uptime 5d05h；
  会话 33/活跃 33/消息 109；by_source api_server 31(93.9% 来源集中)/feishu 2(6.1%)；
  tokens 输入 318k/输出 2.2k/缓存 111k/推理 0；模型表 2 行（qwen-plus 100.0%、qwen3.8-max 0.0%）；
  成本 USD 0.13 上游实测 13 行账目（AgentOS 产品助理 …F2B540 USD 0.12 12 行；emp_9F…3671 未在员工表找到 USD 0.01 1 行）；
  归属已映射 14/未归属 19（warning 字色）；热力 Σ14、max 4（周日 00 时）、夜间均值 0.2。

## 3. VG 四图 + 并排（fullPage，live，非 fixture）

目录：`/private/var/folders/2b/bnpsyz450pn98w375q_803yw0000gn/T/opencode/met01-vg/`

| 文件 | 尺寸 | 平均亮度 |
|---|---|---|
| met01-1440x900-dark-normal.png | 1440×2573 | **0.1023**（<0.8 ✓） |
| met01-375x812-dark-normal.png | 375×5437 | **0.1062**（<0.8 ✓） |
| met01-1440x900-light-normal.png | 1440×2573 | 0.9644 |
| met01-375x812-light-normal.png | 375×5437 | 0.9527 |
| met01-target-1440x900-dark.png（参考屏，met01-theme=dark） | 1430×2599 | 0.0983 |
| met01-pair-1440-dark.png（左参考屏｜右 live，gap 24） | 2894×2599 | — |

亮度=sharp resize(1,1) 平均 RGB 的相对亮度 (0.2126R+0.7152G+0.0722B)/255。

## 4. 溢出/泄漏/写入口探针（双主题 × 双视口）

- 1440：scrollWidth=1440=仿真宽；clientWidth=1425（headful 经典竖滚条 15px，见偏差 2）；热力 787/787 不滚；模型表 623/623 不滚。
- 375：scrollWidth=375=clientWidth ✓；热力 **317/317（24 列不横滚）** ✓；模型表 **460>317 仅表体内滚** ✓。
- 泄漏：rawKey/undefined/NaN/[object Object]/{{ }}/0.00/待接入/裸内部码/M-GAP- 全 false（双主题双视口）。
- 写入口：可见 button/a/[role=button] 匹配 /重跑|中止|删除|新建|批量|创建|停 run|调预算|改阈值/ = 0。
- console error + window error：深/浅均 []。
- 主题：localStorage `agentConsole.v2.theme` 注入（VG-CAPTURE 同款 addScriptToEvaluateOnNewDocument），app data-theme 与之一致；参考屏只用其自有 `met01-theme` 键打开。

## 5. 偏差（点名，不隐瞒）

1. **全降级细条来源名**：stripSystem 取「系统资源」（保部分降级细条与 A3 卡身逐字），三源细条遂读「网关、系统资源、会话」，参考屏逐字为「网关、系统、会话」。两态逐字不可兼得，取卡身+部分态优先。
2. **1440 scrollWidth==clientWidth**：headful Chromium 经典滚条使 clientWidth=1425；scrollWidth=1440=视口宽，**无横向溢出**实质成立。375 严格等值。参考屏自检为 headless overlay 滚条环境。
3. **errNotFoundBody** 逐字取 C 卡文案（含「活动热力统计接口未部署」括注），B 族 404 复用同键（hermes-usage 在白名单，边缘情形）。
4. **卡头更新措辞**：共用 updatedAt 键读「更新于」，参考屏卡头为「更新」（页头「更新于」逐字保留）。
5. **375 截图物理宽**：ego screenshot 按 CSS 宽 375 出图（dsf2 未放大物理像素），视口判定不受影响。
6. **live 真 0 与 null**：当日计数 0、推理 0、P95 —、版本未知版本均为上游真实形状（ok 来源真 0 允许、null 不补零），非 fixture、非造 0。
7. 仓库既有 tsc/eslint 它处错误未动（本 lane scoped 全清）。

## 6. 复现命令

```bash
cd src/frontend/platform
export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH"
export VITE_AGENT_CONSOLE_V2=1
nohup ./node_modules/.bin/vite --config vite.metdev.config.mts > /tmp/met01-dev.log 2>&1 &
ego-browser nodejs < /private/var/folders/2b/bnpsyz450pn98w375q_803yw0000gn/T/opencode/met01-vg.mjs
node /private/var/folders/2b/bnpsyz450pn98w375q_803yw0000gn/T/opencode/met01-img.mjs
```