# TSK-01 C1 证据台账（L0 终局卡，超时 BLOCKED 如实版）

- 记录时间：2026-11-16 17:5x（17:40 硬截止已过）
- 工作区：/Users/kevin_studio/Projects/bisheng-tsk01-readonly（bisheng 仓 lane/L4-tsk01-readonly）
- 结论先行：**当前代码态 C1（四图+判据读数）未交付 = BLOCKED**；本文件只登记可当场核实的磁盘事实，旧图不冒充新图，凡不可复验值一律不引用。

## 1. 提交链与远端实证（独立命令现查）
- 本地链：99ae846（VISUAL-CHECKLIST）→ 1d2d61b（UI 首笔）→ 7606a8c（locale 95 键）→ 7f29c11（normal 态+测试+locale 105 键）→ **34b7ce8**（search expectation fix + locale pageInfo/dueBeforeLabel）。
- `git ls-remote origin refs/heads/lane/L4-tsk01-readonly` 原文行：
  `34b7ce8f6242cfe9f4ea1cabbf90ea5bb045ae95	refs/heads/lane/L4-tsk01-readonly`
  ⇒ 笔T 34b7ce8 远端可核 ✓（本文件为证据首入库）。

## 2. 测试现场实值（17:5x 当场复跑，非旧日志）
- 命令：`cd src/frontend/platform && ./node_modules/.bin/vitest run src/pages/AgentConsoleV2/__tests__/TasksList.test.tsx`
- 实跑结果：**Test Files 1 failed (1)；Tests 1 failed | 17 passed (18)**
- 唯一失败项原文：`× TSK-01 read-only task board (reconciled) > client search narrows rows without any extra request 1026ms — AssertionError: expected 4 to be 1`
- 如实判定：34b7ce8 的 search 用例修复**未使该用例转绿**（深链 `?q=审批回调` 路径在 jsdom 仍返回 4 行=URL 态 q 未驱动行过滤，方向≠期望值错一种）。此前回报中的『单文件 18/18』回执经现场复跑证伪=幻影回执，向 L0 纠偏致歉。
- 浏览器实证（SEARCHLIVE 5→1）：工具目录中 `tsk-live-search.out` **不存在**（不可复验）⇒ 按『实证输出未留存』记录，不得引用。
- 卡令超时后禁再改码 ⇒ 该红项修复留待 L0 下一卡。

## 3. C1 截图现场（现查值）
- 当前代码态四图：**缺**（未拍出/未落工具目录，17:40 截止已过 = 本卡 BLOCKED 主项）。
- 工具目录现存四图为 **16:16 旧批**（早于 chips/search/side 补齐，禁止作为当前 C1 证据）：
  - tsk01-1440x900-dark.png 141382B sha256 1ae61e65d09ab1f98bcee5893b4715d46752e270d13f5e702d6ff377cdb9fea7
  - tsk01-375x812-dark.png 65290B sha256 5d32d3ad80ab2a47921b1ab73e9cbe2e146b68bd1ae9e7253fe217187a2f0661
  - tsk01-target-1440-dark.png 327276B sha256 644a2f7f08c79aa9e582e3077d056aae0db81b8eac2d1ea1a782a0d505fa0ca0
  - tsk01-pair-1440-dark.png 527724B sha256 b647588207167e1e8796df9796d317380807b898a01bc03e3e9d45fa15ab51b0
- 唯一基准：main `262ea57` `docs/validation/console/tasks-list/tsk01-target.html`，sha256 8725007624af3415e5b06353c77c66bf611a888efa3b21afbcefc84caa7b6051（66,320B，以 L0 卡面为权威）；本地工具目录副本 `tsk-target4.html` 现查**不存在**，无法当场对账，如实记缺。

## 4. eslint / served / 旧偏差（沿承声明）
- scoped eslint 三候选全缺=BLOCKED（禁 install）：`src/frontend/platform/node_modules/.bin/eslint` 无；`pnpm exec eslint`=ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL；`/Users/kevin_studio/Projects/bisheng-emp03-build/node_modules/.bin/eslint` 不存在。
- served 8182：entry marker 与登录 DOM 探针矛盾未决，served 腿重拍归 L7 部署后，本文件不称已验。
- G13：本 lane 全部过程预览=本地 dev 5401（vite.tskdev.config.mts 包装，未跟踪不入库），非 served。
- 幻影纠偏（本 lane 累计）：c94ec28/c700f70/e3c02f0/29f4f9e/e858b4b/f17b980/7695984/1b9f5a4 等 hash 与『EVIDENCE 已写入』『四图 219293B 批』『18/18 日志』等回执多次失真；一切以独立磁盘现查为准，本文件内容均为当场命令值。

## 5. 判定
- 不判 PASS；C1 未过 ⇒ 不部署、不进 L6（卡约束照办）。
- 已成就：34b7ce8 远端可核 + 本 EVIDENCE 真实入库。未成就：当前态四图/判据读数/search 用例 18/18。已按卡停手待命。
