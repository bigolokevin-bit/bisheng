# AUD-01 审计列表 · 实现侧验收摘要（R4 整页重写）

> 实现侧自检，不是 L6 独立验收，不自签 PASS。日期：2026-11-18。

## 范围与结论

- 基线：fork main `598f884`；设计源 `AUD01-TARGET-SPEC.md`（锁 `abad6fd`）。
- 本页按整页重写处理：重排页头/只读边界/常驻链校验/筛选/12 列表/展开/分页/六态，不沿用历史 50% 补丁路径。
- 元素核销：**73/77 = 94.8%**；未核销 4 项见 `ELEMENT-TALLY.md` 汇总（A7 真实 200、375/1280 像素、帮助文案回填）。死控件 0；写入口 0；需共享文件 1（locale 帮助文案）。

## 已落实的硬要求

1. **BFF 路径带 `/api/`**：`aud01.ts` 使用 `/api/audit` 与 `/api/audit-verify`，保留 `/agent-api/api/…` 段；两条路径 curl 实测返回 401（路径存在，非 404），无 token 不能取 200，已在 tally 披露。
2. **逐元素骨架**：tally 从 SPEC §1.1–§1.10 拆 77 行，先按「未核销」建骨架，再按实现/测试逐行核销；未自造设计 token。
3. **四态 + 403/404 同体**：加载 6 行骨架；正常 12 列；空态区分无筛选引导（不发请求）与有筛选无结果；错误态人话+请求编号+重试；403/404 同标题/同正文/同请求号。
4. **去工程语言**：HTTP 码从错误/403/A7 S4 移除；A7 S2/S3 的 `ok/complete/brokenEventIds/prevHash/critical` 可见文案改人话；未收录 action/source/decision/outcome 显 —、原值只进 title；完整事件号不显、只复制；时间显示北京时间到分，ISO 仅在 title。
5. **筛选真生效或移除**：时间窗/自定义/搜索前缀分派/员工 actor|resource/每页条数全部映射 A3 真参数；来源/决定/排序/分布图不渲染；无筛选引导不发 `/api/audit`。
6. **分页**：仅「本页 N 条」+ 显式下一页；末页按 `nextCursor` 键省略；无上一页/页码/共 N。
7. **只读边界**：`role=note` + aria-label；banner 在六态均可见；零导出/修改/删除/补录/回滚入口。
8. **testid**：行级/面板级 `aud01-*`；页级 `agent-v2-page-audit`。

## 证据

- `src/frontend/platform/src/pages/AgentConsoleV2/__tests__/AuditList.test.tsx`：52 例通过（含 R4 新增 6 例：工程词零上屏、403/404 同体、未知枚举降级、S3 上限、错误请求号、375/1280 CSS 规则）。
- 全量 AgentConsoleV2：**42 files / 756 tests passed**（基线 750，+6；R4 新增 6 例）。
- Build：`VITE_AGENT_CONSOLE_V2=1 vite build --outDir build-aud3`；entry/chunk 与标记见回执。

## 未验证 / 偏差

- live 200 未取（无 token；401 为路径存在的证据，不等于数据正确）。
- 375 / 1280×720 未做浏览器像素截图；只做了 CSS 规则与单测。
- 与 SPEC 的有意偏差：S3「查看」与任务跳转在详情页/任务页已上线后改为真实链接；S4/错误/无权限不显 HTTP 码，按本轮任务要求执行，仅保留请求编号。
