# TSK-03 任务新建页 · 验收摘要（实现侧）— R2 修单轮

- 车道：L4（branch `lane/L4-console`，接手 HEAD `1dc0c4a734`）。判据 H（QA R2 单页 FAIL 5/18=27.8% → 按修单逐项关闭）。权威设计：`TSK03-TARGET-SPEC.md`（abad6fd 锁定）+ 参考屏 `tsk03-target.html`（sha256 `55f49ed5b646781ecaf31ba884b3432389d5fe9159ed0e2b1f2caebaaa7d82fa`）。
- 本轮为**实现侧摘要**：正式核销卡由 QA 出（见同目录 `ELEMENT-TALLY.md` 表头口径）。

## 1. 改动清单（六项修单 → 文件）

| 项 | 文件 | 改动 |
|---|---|---|
| D1 / E15 | `createFlow.css`（≤767 带，`.lk.tsk03` 限定） | `.facts .b` 改 `height:auto; min-height:36px; padding:7px 14px; line-height:20px`：375 下 CJK 行框高于固定 36px 按钮盒，「主按钮不折字」必须由按钮长高承担；emp02 共用规则一字未动 |
| D2 / E17 / E13 | `TaskCreatePage.tsx` + 三语 `bs.json` | 403/404 屏剥实现口径自述：`forbiddenDesc` 删尾句「这两种情况我们给同一段说明——这样不会泄露别人有没有这个权限。」；`forbiddenNote`（「整页替换为这段说明：不会先渲染表单骨架再消失，也不会留一个按了才报错的按钮。」）整行不再渲染、键位三语删除；折叠行 `techStatusForbidden` 去自述、改名 `techStatusCode`，值只留码值（`状态 {{status}}`）。屏上保留：人话说明 + 返回任务列表 + **新增「重新读取」**（`setReloadToken` 重跑同一条读取路径）+ 折叠区请求编号（缺→「未提供」） |
| D3 | `TaskCreatePage.tsx`（`useLocation` + `parseDeepLink`） | 挂载读一次 `location.search`：`?assignee=employee:<id>` 命中候选才预填、`?priority=low|normal|high` 预填；两者加 `.field.is-deeplink` 高亮 + 字段下一行人话注记（用员工姓名，不回显 id）。未知值**不静默丢弃**：优先级不认识／负责人不在名单／`assignee=` 写法不对 → 卡内中性提示条（`role=note`，无红、无 `console.error`）。深链值仍走既有 `isDirty` 口径（预填即算脏，Esc/取消二次确认与 `beforeunload` 照常生效） |
| D4 / E01 | `createFlow.css`（1181–1280 带，`.lk.tsk03` 限定） | sticky `.facts` 在本代次实测**已生效**（R2 的 897 出自旧 served 代次）；但首屏 sticky 条压住备注框（备注底 726 vs 条顶 648）→ 带内收紧页头/卡头/字段间距（`gap 8`、card-hd 8/16、fset 12/16 gap10、field gap4、fhint 14、pri-opt 5/10），备注底降到 634，留 14px 净空；1440 档不受影响（rect 与 docSH 全等旧值） |
| E04 | `TaskCreatePage.tsx` | radio `value={t(priority.<档>)}`（屏上词），testid 改序号 `-1/-2/-3`，`title` 不带英文；提交体仍 `priority: values.priority`（契约枚举不变） |
| E05 | `TaskCreatePage.tsx` | `EXCLUDED_LIFECYCLE` 加 `'draft'`（L0 口径：**移除**，不标不可用；域侧回 400 `task.assignee_invalid`） |

行数：`TaskCreatePage.tsx` 1286（+152/−11）、`createFlow.css` 987（+77）、`TaskCreate.test.tsx` 591（+219/−8）、三语 `bs.json` 各 +8/−3。

## 2. 实测腿（必做项，数字）

方法：**真 BFF、零 fetch 桩**。`vite.e2t3dev.config.mts` dev harness 以 `VITE_AGENT_CONSOLE_V2=1` 起在 **127.0.0.1:5418**（brief 指的 5416 已被另一会话的陈旧 vite 占住且 `/@vite/client` 404、`src/index.tsx` 500，起不动；未改 harness 文件，只在 CLI 覆盖 `--port`）。登录态：同主机 cookie 天然共享，另把 8182 源的 localStorage（14 键）拷进 5418 源；无 `ws_token` 键，BFF 依 cookie 认证（`/agent-api/api/employees` 200）。CDP `Emulation.setDeviceMetricsOverride`，Range 取文字 rect、getBoundingClientRect 取按钮 rect。脚本与原始输出：`$T/tsk-r3-geom.sh`(`-before/-after.out`)、`tsk-r3-fast.sh`(`-v2/-v3.out`)、`tsk-r3-shell.out`、`tsk-r3-dl2.out`、`tsk-r3-ovf.out`，截图 `$T/tsk-r3-after-*.png`、`tsk-r3-fast-v3-375-{dark,light}.png`。

| 场景 | 修前（before） | 修后（after） | 判定 |
|---|---|---|---|
| 1280×720 dark/light 首屏 `.b.pri` rect | `[697,861,871,897]`（QA R2 旧代次）；本代次实测 `[697,659,871,695]` sticky 已生效但 `noteRect` 底 726 ＜ 备注底缘被条压住（crowd=true） | `[699,659,871,695]`，底部 **695 ≤ 720**；`factsRect=[105,648,891,705]`，`noteRect=[121,545,875,634]` → **备注不被压**（净空 14px）；深浅两态数字全等 | E01/D4 通过 |
| 1440×900 dark/light（回归位） | `priRect=[857,861,1031,897]`、`docSH=1108` | 完全一致（`[857,861,1031,897]`、`docSH=1108`） | 桌面档未动 |
| 375×812 dark/light 主按钮 | `btn=[242,1157,346,1193]`、`txt=[268,1182,320,1200]` → **txt 底越界 7px（裁切）** | `btn=[242,1157,346,1212]`（h 55px）、`txt=[268,1185,320,1203]` → **txt ⊂ btn**（下缘余 9px），深浅全等 | E15/D1 通过 |
| 419×812 dark/light | `btn=[286,1058,390,1094]`、`txt=[312,1083,364,1101]` 越界 7px | `btn=[286,1058,390,1113]`、`txt=[312,1086,364,1104]` 被包含 | 同上 |
| 横滚（scrollWidth vs clientWidth） | 375: 375/375；1280: 1280/1265；1440: 1440/1425 | 数字未变；`tsk-r3-ovf.out`：桌面档差值恒 **15px＝经典滚动条槽**，`.lk.tsk03` 内越界元素 **0**（body scrollWidth==innerWidth） | 无横向溢出 |
| 操作条 vs 备注（375） | `factsRect` 顶 1144，备注底 1010 → 不叠压 | 同 | D1 附带项通过 |
| E04 DOM 值面 | `radios=["low=0","normal=1","high=0"]` | `radios=["低=0","普通=1","高=0"]`；引号口径 `enumHits=[]`（几何腿曾报 `"low"`，系 `class="flow"` 子串误报，fast 腿已按引号/后缀口径澄清并复查为 0） | E04 现场成立 |
| E05 现网候选 | QA R2：选项含 draft `emp_217A91BA995044DFBB3E2E940B` | 选项仅 `emp_86A81CE8FF6F42E187BCF2B540`、`emp_0166858D562149938FBDA22649`（draft 不再出现） | E05 现场成立 |
| D3 深链（真数据） | 参数被静默丢弃（bands=[]、deeplinkFields=0，`?priority=high` 仍是「普通」） | `?assignee=employee:emp_86A8…&priority=low` → select 值命中、注记「链接里指定的负责人已经帮你选好：AgentOS 产品助理。要换人在下面改。」、`marked=2`、`idLeak=false`、`errs=[]`；`?priority=urgent` / `?assignee=abc` / 名单外 id → 各自一句中性提示、不预填、无 console error | D3 现场成立 |
| E01 面包屑 / 实心件唯一 | QA 探针 `crumb=None` | DOM 实存：`控制台 › 任务 › 新建任务`（`.a2s-crumb-root`/`.a2s-crumb-current`/`.a2s-crumb-tail`，`agent-v2-crumb-tail`=「新建任务」）；`solidCount=1`（建立任务）、`headSolid=0` | 属探针选择器口径，非产品缺失 |

## 3. 测试与门禁（本机 2026-11-18 08:0x）

- `vitest run …/TaskCreate.test.tsx`：**24 passed / 24**，exit 0（HEAD 为 14 条 `it`，本轮 +10，零删除）。
- `vitest run …/EmployeeCreate.test.tsx`：**32 passed / 32**，exit 0（EMP-02 共用 `createFlow.css`，未被本轮改动打到）。
- `vitest run src/pages/AgentConsoleV2`：**42 files / 743 passed**，exit 0（≥733 门槛达成）。
- 三语 `bs.json`：`json.load` 全过；`agentConsole.v2.tsk03` 键位 **121 / 121 / 121**，差集为空。
- `scripts/arch-guard.sh <三个改动源文件>`：exit 0，零违规。
- `tsc --noEmit`（platform tsconfig）：TaskCreatePage/TaskCreate.test **0 错**；仓内其余 900+ 行为 HEAD 既有失败（非本轮引入）。
- 未跑：`pnpm lint`/`prettier --check`（prettier 在本树报插件 ESM/TLA 配置错，属环境前置）、`pnpm check-i18n`（同前，跨页 ja drift 属他车道）。D1/D4 的像素级判定 jsdom 无法承载，故以 B 腿实测为准（骨架内布局、文本 autosizing 均不在 vitest 口径内）。

## 4. 决策与假定（可回退优先）

1. **draft 走「移除」**（非禁用项）：按 L0 口径与域侧 400 实证；在岗/入职中保留并继续标状态。
2. **E04 取屏上词做 value**：DOM 与 testid 彻底不含英文原值；线语义仍靠 `values.priority` 提交契约枚举。代价：QA 旧探针的 `-low/-normal/-high` testid 失效（已在核销表「测试面变更」列出）。
3. **深链预填即算脏**（沿用 `isDirty`，不引入「预填不算编辑」特例）：宁可多问一次「放弃这次填写吗」，不冒静默丢失之险。刷新前原生 `beforeunload` 确认框**在 CDP 里不可验**（R2 探针亦未见原生弹窗）——属浏览器行为，页面侧监听已按 §4 实现并有桩腿（Esc 双腿）覆盖，留 QA 手测一条。
4. **403/404 折叠区留码值不留自述**：既满足 E13「正文逐字相同、折叠区码不同」，又不再向用户讲解实现。EMP-02 屏同款键（`techStatusCode`）已对齐命名。
5. **D4 以「sticky 已生效 + 带内压缩消除叠压」结案**，不做整页瘦身：1440×900 档实测数字一字未变，参考屏 §0 的首屏完整性不受影响。
6. **深链参数在地址栏可见不算上屏违规**：如 `?priority=low` 在地址栏显示英文原值；按 L0 裁定③，判据面向屏上正文／控件文案／`title`，地址栏不在其列，页内仍不把枚举或 id 写进 DOM。特此备注。

## 5. 共享件发现（只读，上报未动）

1. **面包屑**由 Shell 渲染（`控制台 › 任务 › 新建任务`）：本轮实测 DOM 完整，QA R2 的 `crumb=None` 是探针选择器口径；建议探针改用 `.a2s-crumb` 或 `agent-v2-crumb-tail`。
2. Shell 顶栏仍上屏 **「搜索暂不可用」「本地试点」「opsadmin」「Pilot」**（1440 实测 `internalWords` 全命中）：文案属 `Shell.tsx`（本车道只读），E17 的共享件字样须由 Shell 车道或参谋定口径。
3. Shell 主题钮**本代次已有标签**：实测 `aria-label="切换主题"`（QA R2 记为 unlabeled，属旧代次）。
4. `HelpTip.tsx` 的 aria-label 模板会带入 term slug（`tsk03Source`/`tsk03Replay`）——EMP-02 轮已上报，本轮未变。
5. `TaskCreatePage.tsx` 现 1286 行，超「单文件 ≤600 行」硬规（HEAD 已 1146 行违规，本轮 +152 使缺口变大）。建议由集成车道按 EMP-02 先例拆 `TskCreateBits.tsx`；本车道写域只允许改这一页，未自行动刀。

## 6. 留给 QA 的复测腿

现场钉键重放/冲突（E10/E11 现网腿）、空候选现场腿（E06，真实租户造不出空名单）、骨架字符扫描 + 10 秒超时（E14）、Enter 语义键盘腿（E16）、深浅 `innerHTML` 逐字节差分（E18）、原生 beforeunload 手测、E08 提交中来源行视觉锁定、E12 写失败屏补折叠区（不在本修单内）。
