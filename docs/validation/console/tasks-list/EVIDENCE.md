# TSK-01 C1 证据台账（L0 窄卡 17:48 / 硬截止 18:08 版）

- 记录时间：2026-11-16 17:5x
- 工作区：`/Users/kevin_studio/Projects/bisheng-tsk01-readonly`（bisheng 仓 `lane/L4-tsk01-readonly`）
- 口径：本文件只登记**当场独立命令可核实**的事实；不判 PASS、不部署、不进 L6。

## 1. 提交链

99ae846（VISUAL-CHECKLIST）→ 1d2d61b（UI 首笔）→ 7606a8c（locale 95 键）→ 7f29c11（normal 态板 + NIT 分页修复）→ 34b7ce8（search 期望修复第一次尝试 + locale pageInfo/dueBeforeLabel）→ 4abff44（EVIDENCE 首入库，超时如实版）→ **57c9352**（search 用例唯一命中词修复，本卡）→ 本笔（C1 正常态图组 + readout）。

远端以本文件提交后的 `git ls-remote origin refs/heads/lane/L4-tsk01-readonly` 原始输出为准（回报内逐字粘贴）。

## 2. 测试现场实值（本卡当场复跑）

- 命令：`cd src/frontend/platform && export PATH="$HOME/.nvm/versions/node/v20.20.2/bin:$PATH" && ./node_modules/.bin/vitest run src/pages/AgentConsoleV2/__tests__/TasksList.test.tsx`
- 原始结果行：
  - `Test Files  1 passed (1)`
  - `Tests  18 passed (18)`
  - 退出码 V=0，日志 `/private/var/folders/2b/bnpsyz450pn98w375q_803yw0000gn/T/opencode/tsk-vitestQ.log`
- 唯一红项的真实根因（与 4abff44 的记述不同，已纠正）：**不是 jsdom 失灵，而是用例查询词与期望值不匹配**。夹具默认标题『整理周报数据』被 5 行中的 4 行共用，因此 `?q=周报` 命中 4 行是**正确行为**；34b7ce8 保留了 `toHaveLength(1)` 的错误期望，故现场复跑仍红（`expected 4 to be 1`）。
- 修法（57c9352）：查询词改为唯一命中『审批回调』（仅 T2『对接审批回调』匹配），保留 URL 态驱动 + 原生 value setter + `input` 事件 + 零额外 `/api/tasks` 请求断言。
- 浏览器实证（真实 Chrome/CDP，非 jsdom）：`SEARCHLIVE={"rowsBefore":5,"rowsAfter":1,"rowsRestored":5,"apiCallsDelta":0,"midUrl":"/agent/tasks?q=%E5%91%A8%E6%8A%A5","clearedUrl":"/agent/tasks"}` ⇒ 输入即过滤、清空即复原、全程零服务端往返。原始转录见 `readout.txt`。

## 3. C1 图组（当前代码，正常态，浏览器层夹具）

数据形态说明：**当前真实后端该租户无任务**（见第 4 节实况批次 rows=0），无法与基准（有数据的正常态）比对。因此正常态图组用 `Page.addScriptToEvaluateOnNewDocument` 在**浏览器层**包装 `fetch`，对 `/api/tasks` 返回 5 行真实契约形状夹具（in_progress / open / blocked+statusReason / open 逾期 / done+closedAt，`nextCursor: cur_p2`）。**未改动任何后端、未写入任何数据、未改页面代码**。夹具注入标识 `INJ={"identifier":"1"}`，拍完后已 `Page.removeScriptToEvaluateOnNewDocument` 撤销。

入库图（相对本文件目录 `docs/validation/console/tasks-list/`；绝对路径前缀 `/Users/kevin_studio/Projects/bisheng-tsk01-readonly/`）：

| 文件 | 字节 | 像素 | sha256 |
|---|---|---|---|
| tsk01n-1440x900-dark.png | 155184 | 1440×900 | e194807fdb6fea532fe56c1d354534539da13d393c242b3aa56ccd21a49bd0f2 |
| tsk01n-1440x900-light.png | 155117 | 1440×900 | b142685d8d7ba643f5687ebef2d52ee766020a67b0ee470cd233a03bf8afaf14 |
| tsk01n-375x812-dark.png | 107437 | 375×1256 | 67839e274e02232e5d2a387eca6d96abd78a5047c39af0bb92fe2ede6e8bed0c |
| tsk01n-375x812-light.png | 107290 | 375×1256 | f929457b32c8d0812a47a3bb8c77a7b02c0b4d2be72e16165461deabb59dd597 |
| tsk01n-target-1440-dark.png | 291176 | 1430×987 | c19f73b78d951f8dbc88246abb4f8967a31a4aaddbd79713651b2b8c106b4300 |
| tsk01n-pair-1440-dark.png | 502275 | 2878×987 | 3e8dbeb49ce777dfbbbbd0173ae55b03554663382639dca04962aae8d6575d57 |

- 375 宽 fullPage 高 1256 > 视口 812 ⇒ fullPage 生效；1440 宽内容高 ≤ 900 视口，fullPage 与视口等高（如实记录，非未截全）。
- 并排图为 1440 实拍（左）对 1440 基准（右），2878×987。

DOM 判据读数（深/浅两套完全一致，原始 JSON 在 `readout.txt`）：

```
rows 5 · pageInfo "本页 5 条" · resultCount "命中 5 / 已加载 5 条"
rawKeyHits [] · tplBraces false · hasTotal false（无 total/分母）
kpi 0 · newTask 0 · pendingNote false（待接入旁注不存在）
side 0（右栏默认折叠） · prevNext 2（分页三键：本页计数 + 上一页 + 下一页）
chips 5 · sw == cw（1440@1440、375@375） · failedRes []
```

## 4. 在线数据实况（未注入，真实后端）

同卡内另拍一批**无夹具**图（`tsk01-*.png`，17:52，工具目录 `/private/var/folders/2b/bnpsyz450pn98w375q_803yw0000gn/T/opencode/`，未入库）：`DOM_DARK_1440` 与 `DOM_LIGHT_1440` 均 `rows:0, pageInfo:null, rawKeyHits:[], kpi:0, newTask:0, failedRes:[]` ⇒ 当前租户任务表为空，页面正确渲染空态而非报错。该批仅作数据实况佐证，不作为与基准比对的 C1。基准图 sha 在两批间一致（`c19f73b7…`），可交叉复验。

## 5. 唯一视觉基准对账（本卡当场核实）

- 权威：主仓 `seakoi-agent-os` main `262ea57` 的 `docs/validation/console/tasks-list/tsk01-target.html`。
- 本卡重取本地副本 `tsk-target5.html`（前批副本已被工具目录清理，先前『已对账』声称不可复验）：
  - `shasum -a 256` = `8725007624af3415e5b06353c77c66bf611a888efa3b21afbcefc84caa7b6051` ✓
  - `wc -c` = `66320` ✓
  - 与卡面完全一致。

## 6. scoped eslint（按卡改用既有二进制，结果=配置链 BLOCKED）

- 二进制**存在且可执行**：`/Users/kevin_studio/Projects/bisheng-ov01-build/src/frontend/node_modules/.bin/eslint` → `v9.39.5`（`-rwxr-xr-x`，1364B）。先前『三候选全缺』的口径对本候选是错的，已纠。
- 命令：`cd src/frontend/platform && <上述 eslint> src/pages/AgentConsoleV2/TasksListPage.tsx src/pages/AgentConsoleV2/__tests__/TasksList.test.tsx`
- 结果 **exit 2**，原始错误（全文见 `readout.txt`）：
  `Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@eslint/js' imported from /Users/kevin_studio/Projects/bisheng-tsk01-readonly/src/frontend/config/eslint.mjs`
- 根因核实：本工作树 `src/frontend/platform/node_modules/@eslint` **不存在**；`bisheng-ov01-build/src/frontend/node_modules/@eslint/js` 存在，但 ESM 解析以**导入方文件所在树**为准，跨树候选无法满足 repo 配置的依赖。
- 处置：按卡**禁 install** ⇒ scoped eslint 该项标 **BLOCKED（配置依赖缺失，非二进制缺失）**，不改配置、不装包。

## 7. 沿承声明

- served 8182：entry marker 与登录 DOM 探针矛盾未决，served 腿重拍归 **L7 部署后**，本文件不称已验 served。
- G13：本 lane 全部过程预览 = 本地 dev 5401（`vite.tskdev.config.mts` 包装，未跟踪、永不入库），非 served。
- 旧 16:16 图批（`tsk01-1440x900-dark.png` 141382B 等）属 chips/search/side 补齐之前，**已声明作废**，本卡未采用。
- 幻影纠偏（本 lane 累计，勿引用）：hash `c94ec28`/`c700f70`/`e3c02f0`/`29f4f9e`/`e858b4b`/`f17b980`/`7695984`/`1b9f5a4`；以及『EVIDENCE 曾在工作树』『四图 219293B 批』『18/18@17:33 日志』『SEARCHLIVE 在盘』『tsk-target4 已对账』『search 红因=jsdom 限制』等回执，均经独立磁盘现查证伪。本文件所有数字为当场命令值。

## 8. 判定

- 三件事状态：1) search **18/18 现场通过** ✓；2) C1 正常态图组（深浅双主题 × 双视口 fullPage + 1440 并排 + 基准图）已入库 ✓，比对结论留给 L0/设计裁决；3) eslint = **BLOCKED**（二进制可用、repo 配置依赖缺失、遵令未 install）。
- **不判 PASS**；C1 未过 ⇒ 不部署、不进 L6。
