# EMP-02 元素核销表（/agent/employees/new）

数据源：`POST /agent-api/api/employees`（Idempotency-Key 头，写页）。设计级复写轮（判据 I：同页两轮 BLOCKED/FAIL 升级为设计缺陷重写），权威设计 = `docs/product/design/console-v2/emp02-target.html` + `EMP02-TARGET-SPEC.md`（abad6fd 锁定，sha256 `688611ee…59d7` / `e888aaab…3f83`），逐字节镜像同目录。
分母口径 = SPEC §8 E01–E15。本轮为 L4 实现侧自核销摘要，正式核销卡由 QA 出。

口径声明（偏离，SPEC §9 + 写路径硬约束）：表单写控件为 4 个输入（姓名/岗位/职责说明（用于首个版本）/备注）+ 只读责任人行；因领域侧 `initialVersion` 硬要求（`employee.invalid_initial_version`），「职责说明（用于首个版本）」设为必填，卡面如实标「5 项 · 3 必填」。E02 的核销按该声明口径执行，不按 SPEC 原「4 项 · 2 必填」文面。

| elementId | 规格锚点 | 状态族 | 验收腿（实现侧） | 状态 |
|---|---|---|---|---|
| E01 | §2 面包屑+唯一实心按钮 | 正常 | `EmployeeCreate.test` 断言 `.facts` 内 `.b.pri` 唯一=保存；页头仅文本链接「返回员工列表」 | 已核销 |
| E02 | §2 字段集（口径声明见上） | 正常/校验 | 4 输入+只读 owner 行断言；无职权限/工位/知识范围/预算/头像/生效时间控件 | 已核销 |
| E03 | §2 所有者只读 | 正常 | `div.locked` 无 select；POST 体 `ownerUserId` 钉死当前登录 uid | 已核销 |
| E04 | §3 invalid | 校验失败 | 一条汇总 `role=alert` + 字段级红边/文案 + `aria-invalid`/`aria-describedby` + 首个错误字段获焦；值不清空 | 已核销 |
| E05 | §3 submitting | 提交中 | 「正在保存…」+spinner+disabled、全字段+取消 disabled、`aria-busy`；5 连击=1 请求；重试复用同一 Idempotency-Key | 已核销 |
| E06 | §3 success | 成功 | 结果卡可达（真实写体修复后可达）；短编号 `emp_xxxx…xxxx` + title 全号 + 复制→「已复制」`aria-live`；停留不跳转 | 已核销 |
| E07 | §3 replay | 幂等重放 | 同键同体重放=同结果卡+同编号+中性 band（`role=note`），不显红/错误码/「失败」；检测为客户端 attempts>1（BFF 重放回 200，线上不可辨） | 已核销 |
| E08 | §3 failed(400)/conflict(409) 分叉 | 400/409 | 400 通用文案不点名已填字段、不借用「这次没有保存」冲突文案；409 独立冲突卡：首行「上一次提交已经成功」+ 恰好两个出口 | 已核销 |
| E09 | §3 failed 技术信息折叠 | 500/超时/断网 | 卡顶 `role=alert` 错误条 + 重试保留值；状态码+请求号仅在折叠「技术信息（报障时提供）」，缺→「未提供」；正文零状态码/请求号 | 已核销 |
| E10 | §3 forbidden | 403/404 | 整页同文替换（StageScreen，表单不渲染在后的骨架）；403/404 剥折叠后正文逐字节相同；不显 SPEC 原文/后端 code/slug | 已核销 |
| E11 | §3 骨架/初态/超时 | 加载/空/超时 | 骨架 textContent=''（零可读字符）；初态（未动表单）保存禁用+预览「未命名 / 岗位待填」；10s 未返回→错误屏，重试重新起表 | 已核销 |
| E12 | §8 1440/375 无横溢 | 视口 | CSS 腿已备（375 单列、1280×720 主 CTA 入首屏 sticky `.facts`）；scrollWidth/截图腿待 QA CDP 复测（本轮职责说明行增高表单） | 待 QA 复测 |
| E13 | §4 键盘/焦点 | 键盘 | DOM 序 name→title→duty→note→取消→保存；owner 行不可聚焦、无正 tabindex；文本框 Enter 提交、textarea Enter 换行；Esc 两段式（脏警示 3s 自清→离开）；进入页聚焦姓名 | 已核销 |
| E14 | §8 禁串+可写控件唯一 | 全态 | 违禁串扫描（innerText + 全部 title 属性）：请求号/状态码/字段名点名/提交键/¥/元/待接入/undefined/NaN/mock/seed/TODO 均 0；可写控件仅保存（+成功态复制/再建/查看） | 已核销 |
| E15 | §8 主题无损 | 主题 | 页级断言 light/dark `innerHTML` 一致；`createFlow.css` 无新增裸 hex（grep 0）；整壳 `data-theme` 逐字节 diff 依赖 Shell（共享件，L6 腿） | 部分（页级已核销） |

元素数 15 / 已核销 13 / 部分 1（E15）/ 待复测 1（E12）/ 核销率 87%（实现侧口径）/ 死控件数 0（页内；Shell 顶栏主题钮与禁用搜索框属共享件，另行上报）

共享件发现（本页无权修，上报不静默）：①面包屑中段「数字员工」来自共享 Shell 导航，SPEC 口径为「员工」；②`HelpTip.tsx` 的 `aria-label` 模板 `${title} · ${term}` 会把 term 键名（如 `emp02Perm`）带进可访问名，建议共享侧去 slug；③「谁可以建」卡的「?」提示保留（锁定参考卡含该控件），按 §6 已剥离其中设计说明 prose。
