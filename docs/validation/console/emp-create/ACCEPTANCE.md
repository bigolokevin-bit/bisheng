# EMP-02 验收摘要（实现侧）— 设计级复写轮

- 车道：L4（branch `lane/L4-console`），判据 I 升级：QA 两轮 FAIL（真写 400 `employee.invalid_initial_version`、核销 8/15）→ 按 SPEC 重排页面结构，非改文案。
- 权威设计：`docs/product/design/console-v2/emp02-target.html` + `EMP02-TARGET-SPEC.md`（abad6fd 锁定；sha256 `688611eef94f69f266fd6b760342e77f96f1cc09e615d285213f42743fc859d7` / `e888aaab97190028c7e87571a14d45de69a25a9e0e8a94cadbd2bbfc0f743f83`）。
- 提交体（硬要求 1）：`{name,title,ownerUserId,note?,initialVersion:{jobDescription,knowledgeScopes:[],skillRefs:[],grantIds:[],effectiveFrom:ISO}}`，无 `budget`（走 policy 默认），scope/ref 不伪造。由 852905d 引入，本轮保留并加测试钉死。

## 结构变更
`EmployeeCreatePage.tsx` 1118 行 → 4 文件（状态机 438 / 表单卡+侧栏 523 / 骨架·整页状态屏·TechInfo 211 / 结果卡·重放·冲突 230），全部 ≤600 行。布局镜像锁定参考卡：表单卡 + 工牌预览/建立之后/谁可以建 + 结果卡 + 整页状态屏（forbidden/auth/loadError 用 StageScreen，骨架不残留表单）。§6 复核栏/设计说明 prose 未实现。

## 本轮关闭的 QA FAIL/缺口
- E06：写体修复后成功腿可达（测试腿 + 待 QA 真写复跑）。
- E08：400 通用文案不点名已填字段、不再借用冲突文案；409 独立冲突卡（首行「上一次提交已经成功」，恰好两出口，不像字段校验）。
- E09：折叠「技术信息（报障时提供）」移到失败横幅本体（状态码+请求号，缺→「未提供」），正文零编号。
- E11：初态保存禁用 + 预览「未命名 / 岗位待填」；骨架零可读字符；10s→错误屏，重试重新起表。
- E04/E05/E13/E14：汇总+首错聚焦；aria-busy+5 击 1 请求+重试复用键；键盘序与 Enter/Esc 语义；违禁串扫描（innerText+title 属性）。
- E15（页级）：light/dark innerHTML 一致；createFlow.css 无新增裸 hex。
- 幂等重放：中性 band + 同编号（客户端 attempts>1 检测，BFF 重放回 200 线上不可辨——留给契约侧的已知限制）。
- 死控件：「谁可以建」「?」保留（锁定参考卡含该控件），tooltip 设计说明 prose 已按 §6 剥离；页内死控件 0。

## 验证证据（2026-11-18 01:3x 本机）
- `vitest run src/pages/AgentConsoleV2`：42 文件 / **727 tests 全绿**（基线 ≥722 不降）；`EmployeeCreate.test.tsx` 21→32。
- 全平台 `vitest run`：20 文件失败（controllers/dsh*、BuildPage、LogPage、SystemPage、publicEntries、test/* 等，均在本车道写域之外）；已用 HEAD(852905d) 干净 worktree 抽样复跑其中 4 个文件，失败同样存在 → **前置失败，非本轮引入**。
- 构建：`VITE_AGENT_CONSOLE_V2=1 vite build --outDir build-emp3` ✓ built 9.75s；entry `assets/js/index-BTHhRxFo.js`，sha256 `59746c518fa724232a6dbd202203a2d5530d56781c3605266f76258f0d8eab41`；标记 `agent-v2-emp-c-` 在 entry **0** 次、在懒载 `shellPages-8NlX0ISB.js` 1 次（预期）。
- `tsc --noEmit`：本轮 4 个源文件 0 错（全仓 692 错与 HEAD 基线持平，前置）。
- `scripts/arch-guard.sh` exit 0。三语 locale emp02 键位对齐 118/118/118。
- 未能跑：`pnpm lint`（本树无 eslint 二进制）；`check-i18n` 失败项均为他页前置 ja drift（emp02 干净，已核 HEAD 证实）。

## 待 QA 复测腿
真写 POST 成功腿（E06）；1280×720/375 CDP 截图与 scrollWidth（E12，本轮表单增高）；整壳主题逐字节 diff（E15 壳层腿）。

## 共享件发现（只读，上报未动）
①面包屑「数字员工」来自共享 Shell 导航 vs SPEC「员工」；②`HelpTip.tsx` aria-label 模板把 term slug 带入可访问名；③Shell 主题钮无标签、搜索框整宽禁用（QA 死控件清单 ②③ 项）。

## 口径声明
E02 按「5 项 · 3 必填」声明口径核销（职责说明为领域写路径硬要求）；详见 ELEMENT-TALLY.md 表头。
