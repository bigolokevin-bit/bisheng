# TSK-03 任务新建页 · 元素核销表（ELEMENT-TALLY）· 本版＝R2 修单（L4 实现侧 R3 自核销）

- 判据源：`docs/validation/console/task-create/TSK03-TARGET-SPEC.md` §8 验收 ID **E01…E18**（abad6fd 锁定；分母按实读 **18** 计，令面 20 的差 2 仍待参谋补）。口径五项全过才记「已核销」：元素存在 + 数据源正确 + 状态齐 + 去向真跳 + 文案合规。
- **本版为 R2 修单（判据 H）的实现侧摘要：正式核销卡由 QA 出。** 「R2 判定」列照抄 QA R2 tally（核销率 5/18=27.8%），用于对照；「R3 状态」列只声明本轮改动到的部分。
- 取证腿：**A＝vitest 腿**（`src/pages/AgentConsoleV2/__tests__/TaskCreate.test.tsx`，24 tests 全绿，dir 743/743）；**B＝CDP 实测腿**（ego-browser + `vite.e2t3dev.config.mts` dev harness 端口 5418，`/agent-api`→BFF 127.0.0.1:8092，**真 BFF、无 fetch 桩**；脚本 `$T/tsk-r3-geom.sh`/`tsk-r3-fast.sh`/`tsk-r3-shell.sh`/`tsk-r3-dl2.sh`/`tsk-r3-ovf.sh`，输出同名 `.out`，截图 `$T/tsk-r3-after-*.png`、`tsk-r3-fast-v3-375-*.png`；$T=/private/var/folders/2b/bnpsyz450pn98w375q_803yw0000gn/T/opencode）。
- 修单口径声明：**E05 候选按「移除」执行**（`draft` 进 `EXCLUDED_LIFECYCLE`，不标不可用——域侧对 draft 负责人回 400 `task.assignee_invalid`，可选但必败的选项等同死控件）；**E02 恰 4 项 + 1 只读来源行不变**（本轮未加任何写控件，深链只预填既有字段）。

| 验收 ID | R2 判定（对照） | R3 状态 | 一行证据（改动项 → 腿） |
|---|---|---|---|
| E01 直达 + 面包屑 + 全屏唯一实心「建立任务」 | FAIL（1280×720 pri rect 底部 897＞720；crumb=None） | **已核销** | 实测腿 B：1280×720 深浅两态 `.b.pri` rect `[699,659,871,695]`，底部 695≤720，首屏零滚动（sticky `.facts` 生效，`factsPos=sticky`）；1440×900 rect 未变 `[857,861,1031,897]`；面包屑 DOM 实存 `控制台 › 任务 › 新建任务`（`.a2s-crumb-root/.a2s-crumb-current/.a2s-crumb-tail`，`agent-v2-tsk-c…` 同屏 `solidCount=1 headSolid=0`）⇒ R2 的 crumb=None 属探针选择器口径，非产品缺失 |
| E02 恰 4 项 + 1 只读来源行 | 已核销 | 已核销（未动） | A：`fixes the source to 手工创建 as a read-only row`；本轮无新增控件 |
| E03 标题 80 上限 + 计数 + 空值文案 | 已核销 | 已核销（未动） | A：`checks title and assignee before any request…` / `rejects a spaces-only title` |
| E04 优先级恰「低/普通/高」，DOM 不含 low/normal/high | FAIL（radio `value` 为英文原值） | **已核销** | 改动：radio `value={t(priority.<档>)}`、testid 改 `-1/-2/-3`（见「测试面变更」）。A：`offers exactly 低 / 普通 / 高…`（innerHTML 扫 `value="low|normal|high"` 与 `priority-(low|normal|high)` = 0，且 `value="普通"` 在）＋`sends the contract enum…`（提交体仍 `priority:"high"`，线语义未变）。B：实测 `radios=["低=0","普通=1","高=0"]`，引号扫描 `enumHits=[]`（几何腿里的 `"low"` 命中系 `class="flow"` 子串误报，已由 fast 腿引号口径澄清） |
| E05 负责人单选、真实员工、未选拦下 | FAIL（候选含 draft 员工，点了必 400） | **已核销** | 改动：`EXCLUDED_LIFECYCLE={'offboarding','archived','draft'}`。A：`excludes draft employees from the assignee candidates (E05)`。B：真 BFF 现网腿 `tsk-r3-dl2.out` 选项仅剩 `emp_86A8…`/`emp_0166…`，R2 点名的 draft `emp_217A91BA995044DFBB3E2E940B` 不再出现 |
| E06 候选为空整块替换、DOM 无空 select | NOT-MEASURED | 部分（桩测覆盖，现网恒有候选不可测） | A：`replaces the assignee control with an explanation when nobody can be assigned`（items=[] → 无 `agent-v2-tsk-c-assignee`、保存 disabled + `whyBlocked`、已填标题不清空）；现场腿仍待 QA（真实租户无法造空候选） |
| E07 来源固定「手工创建」只读 | 已核销 | 已核销（未动） | A：同上测试断言无 select/input/textarea、屏上无 `manual/通道/消息标识` |
| E08 提交中锁定 + aria-busy + 防连点 | 部分（优先级/来源未进禁用态） | 部分（沿用 R2，本修单未含） | A：`locks the card while submitting and sends one request for five clicks`（`aria-busy=true`、5 连点=1 请求已证）；优先级 radio 的 `disabled` 已在 DOM，但**来源行的视觉锁定态**未修 → 留 QA 复判 |
| E09 成功结果卡 | 已核销 | 已核销（未动） | A：`writes once with a manual source…`（掩码编号 + title 全号 + 复制 + 查看 href） |
| E10 同键同体重放 → 中性提示条 | NOT-MEASURED（QA 探针键未钉住） | 部分（桩测覆盖，现场腿待 QA） | A：`presents a same-key replay as the first task with a neutral band`（断网→失败→重试复用同一 `Idempotency-Key`，出 `replay-band`，正文无「失败」）。现网重放腿需 QA 钉键复跑 |
| E11 同键异体 → 「这次没有建立」两出口 | NOT-MEASURED（同上） | 部分（桩测覆盖，现场腿待 QA） | A：`turns a same-key/different-body answer into the conflict card with two exits`（409→冲突卡 + 返回列表/重开新建页；不作字段校验呈现） |
| E12 写失败：卡顶 alert + 重试、值保留、正文无码 | 部分（503 屏缺技术信息折叠） | 部分（沿用 R2；本修单未含） | A：`keeps the typed content on a 400…`（值保留、正文无 400）；**该屏仍缺「技术信息（报障时提供）」折叠区**，与结果卡/无权限屏不一致，未在本轮改动范围 |
| E13 无权限与地址失效同体、不渲染骨架 | 已核销 | 已核销（口径收紧） | A：`gives 403 and 404 one identical body and renders no form skeleton` → 新增整屏等值断言：`forbidden403.replace('状态 403','状态 404') === forbidden404`（剥码值后逐字相同，差异只在折叠区码值） |
| E14 骨架无可读数字、未就绪禁用、10 秒切错误 | NOT-MEASURED | 待复测（本轮未加腿） | 未改骨架与超时腿；现网 10s 超时与骨架字符扫描仍待 QA |
| E15 1440/375 不横滚、375 单列、优先级竖排、主按钮不折字 | FAIL（375 四字下缘被按钮裁切） | **已核销** | 改动：`createFlow.css` ≤767 带内 `.lk.tsk03 .facts .b{height:auto;min-height:36px;padding:7px 14px;line-height:20px}`（tsk03 限定，emp02 规则未动）。实测腿 B：375×812 深/浅 `btn=[242,1157,346,1212]`、`txt=[268,1185,320,1203]` ⇒ **txt ⊂ btn**（下缘余量 9px、上缘 28px），419×812 同判（`btn=[286,1058,390,1113]`/`txt=[312,1086,364,1104]`）；`scrollWidth==clientWidth`（375/375、419/419）；`barOverlapsNote=false`（备注 rect 底部 1010 ＜ 操作条顶部 1144）。桌面档 `documentElement.scrollWidth` 比 clientWidth 多 15px＝经典滚动条槽（`innerWidth==scrollWidth`，越界元素 0，见 `tsk-r3-ovf.out`） |
| E16 键盘：Tab 序 / Enter / Esc | NOT-MEASURED | 部分（新增 DOM 序 + Esc 双腿；Enter 语义待 QA） | A：`keeps the keyboard order of the write path as written (E16)`（表单内可聚焦序 title→assignee→note→cancel→save，radio 组由方向键承担，无正 tabindex）＋`warns before Esc throws dirty content away…`＋`leaves at once on Esc while nothing has been typed`。**Enter 在标题提交/在备注换行** jsdom 不模拟原生隐式提交 → 待 QA 键盘腿 |
| E17 写控件唯一；正文与 title 无码/id/字段名/自述 | 部分（403/404 屏两句实现口径自述） | 部分（页内已核销；共享件字样上报） | 改动（D2）：`forbiddenDesc` 删尾句「这两种情况我们给同一段说明——这样不会泄露别人有没有这个权限。」；`forbiddenNote`（「整页替换为这段说明：不会先渲染表单骨架再消失…」）**整行移除**（组件不再渲染 `.vn`，键位三语删除）；折叠行 `techStatusForbidden` 去自述、改名 `techStatusCode`，值只留码值「状态 403/404」。A：`keeps the 无权限 screen in user language…`（禁串 逐字相同/不会先渲染/不会泄露/表单骨架/按了才报错/整页替换 = 0）＋`renders no engineering language…`。深链腿：URL 里的 id 不上屏（B：`idLeak=false`，提示句用姓名「AgentOS 产品助理」）。**Shell 侧「搜索暂不可用／本地试点／opsadmin／Pilot」仍在**（只读件，见 ACCEPTANCE 上报） |
| E18 深浅主题 innerHTML 逐字节相等 | NOT-MEASURED | 待复测（本轮未加腿） | 实测腿只能证同元素 rect 两态一致（深浅数值全等，见 E01/E15 行），逐字节 innerHTML 差分与裸 hex 扫描仍待 QA；本轮 CSS 新增未引入裸十六进制（新增规则只用 `hsl(var(--*))` / `var(--accent-border)` / `var(--card)`） |
## 汇总（实现侧口径）

- 元素数（分母）：**18**。
- **已核销 9**：E01 E02 E03 E04 E05 E07 E09 E13 E15 —— 本轮关闭 4 项 FAIL（**E01 E04 E05 E15**），收紧 1 项（E13 逐字口径），其余沿用 R2。
- **部分 7**：E06 E08 E10 E11 E12 E16 E17 —— E06/E10/E11 已有 vitest 桩腿、现场腿待 QA；E16 已有 DOM 序与 Esc 双腿、Enter 语义待键盘腿；E08/E12 沿用 R2 缺口（不在本修单内）；E17 页内口径已修、Shell 字样只读上报。
- **待复测 2**：E14 E18（本轮无腿）。
- **FAIL 0**：R2 四项 FAIL 全部关闭；本轮不改判任何已核销项。
- 核销率 = **9/18 = 50.0%**（部分折半计 → 12.5/18 = **69.4%**）；R2 为 5/18 = 27.8%。
- 死控件数 = **0**：页内可点件都有真实去向（建立/重试/重新读取/取消/返回/复制/查看/再建一条/冲突两出口）；R2 点名的 draft 候选（选了就必 400）已按「移除」口径消掉。新增件：无权限屏「重新读取」＝重跑同一条读取路径（仍回 403 时状态保持，不做假成功）。
- 状态齐性：正常 ✓（实测）、校验失败 ✓（桩）、提交中 部分（E08）、成功 ✓（桩）·重放 ✓（桩）·冲突 ✓（桩）、写失败 ✓（桩 + 现网真 400）、无权限 403≡404 ✓（桩，逐字口径）、空候选 ✓（桩）、骨架与 10 秒超时 待复测。
- 现场腿声明：B 腿全部走 **真 BFF（127.0.0.1:8092）**、零 fetch 桩；状态屏（403/404/503/重放/冲突）一律由 A 腿（vitest fetch 桩）取证，不得据以判服务端行为。

## 测试面变更（QA 探针需同步）

- 优先级三档 testid 由 `agent-v2-tsk-c-priority-{low|normal|high}` 改为 **`agent-v2-tsk-c-priority-{1|2|3}`**（1=低、2=普通、3=高）：E04 禁止 DOM 残留英文原值，旧 testid 本身就是违规串。
- 新增：`agent-v2-tsk-c-deeplink-note`（中性提示条，`role=note`）、`agent-v2-tsk-c-deeplink-assignee`、`agent-v2-tsk-c-deeplink-priority`、`agent-v2-tsk-c-forbidden-retry`。
- DOM 值面：`input[name=priority]` 的 `value` 现在是屏上词（低/普通/高），不再是 `low/normal/high`；提交体仍为契约枚举。
- 文案键面：tsk03 删除 `forbiddenNote`；`techStatusForbidden` 改名 `techStatusCode`（值只留码值）；新增 `forbiddenRetry` 与 5 个 `deep*` 键；三语键位 121/121/121 对齐。
