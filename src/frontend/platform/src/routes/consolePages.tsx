/**
 * Console v2 page registry — the single mapping from `/agent/*` paths to the
 * AgentConsoleV2 page modules. It used to live inline in `routes/index.tsx`.
 *
 * WHY A SEPARATE FILE (ownership, not style):
 * The console ships as parallel page lanes, and the four shared surfaces
 * (route table, Shell.tsx rail, agentConsoleV2.css, the three bs.json files)
 * may only be written by the integration lane. Page-lane diffs that touched
 * `routes/index.tsx` kept colliding with each other and with the integrator,
 * because every new page needed a lazy import *and* a children entry there.
 * This file is that seam: `routes/index.tsx` now only consumes
 * `CONSOLE_V2_CHILDREN` and owns the parent route (path / permission / shell
 * element), so adding a console page touches exactly one registry line here —
 * never `routes/index.tsx`.
 *
 * HOW TO ADD A PAGE (integrator only):
 *   1. the page lane ships `pages/AgentConsoleV2/<Page>.tsx` (or a
 *      `pages/<slug>/index.tsx`) and its own tests;
 *   2. the integration lane adds one lazy const + one children entry below;
 *   3. the rail entry + breadcrumb key go in `Shell.tsx` `L1_ENTRIES` and the
 *      three locales (`agentConsole.v2.nav*`) — see ShellNav.test.tsx.
 * Deliberately NOT done: glob/auto-import of the page directory. It would
 * silently change the lazy boundaries (one chunk per page today, several
 * pages share `shellPages.tsx`) and it would hide the path list from review,
 * which is the one thing this table has to keep visible.
 *
 * The entries below are a verbatim move: same paths, same order, same lazy
 * boundaries, same module specifiers, same `settings` redirect and same
 * splat 404. `src/test/{agentRoutePermissions,routeFilterPurity,dshRoutes,
 * resolveRoutePermissions}.test.ts` and
 * `src/pages/AgentConsoleV2/__tests__/ConsolePageRegistry.test.ts` pin that.
 */
import { lazy } from "react";
import { Navigate } from "react-router-dom";

// P0-15 W1 shell: the L1 routes + 404 live under one rail/topbar shell (parity spec §2).
const ShellOverviewPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.OverviewPage })));
const ShellEmployeesPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.EmployeesPage })));
const ShellMatrixPage = lazy(() =>
  import("@/pages/AgentConsoleV2/shellPages").then((module) => ({ default: module.MatrixPage })),
);
const ShellSkillsPage = lazy(() => import("@/pages/AgentConsoleV2/SkillsPage"));
// EMP-02 / TSK-03: the console's two real write screens.
const ShellEmployeeCreatePage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.EmployeeCreateScreen })));
const ShellTaskCreatePage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.TaskCreateScreen })));
const ShellEmployeeDetailPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.EmployeeDetailScreen })));
const ShellApprovalsPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.ApprovalsPage })));
const ShellApprovalDetailPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.ApprovalDetailScreen })));
const ShellTasksPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.TasksPage })));
const ShellTaskDetailPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.TaskDetailScreen })));
const ShellCollabPage = lazy(() => import("@/pages/AgentConsoleV2/CollabPage").then(module => ({ default: module.CollabPage })));
const ShellRunsPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.RunsPage })));
const ShellRunDetailPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.RunDetailScreen })));
const ShellMetricsPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.MetricsPage })));
const ShellAuditPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.AuditPage })));
const ShellAuditDetailPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.AuditDetailScreen })));
const ShellSettingsPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.SettingsPage })));
const ShellNotFoundPage = lazy(() => import("@/pages/AgentConsoleV2/shellPages").then(module => ({ default: module.NotFoundPage })));
// L4p2: console chat page — own lane file (shellPages.tsx is shared/read-only).
const ShellChatPage = lazy(() => import("@/pages/AgentConsoleV2/ChatPage"));

/** Children of the `/agent` shell route, in the order they were written in
 *  the inline table. `index: true` is the overview; the trailing `*` is the
 *  in-shell 404. `settings` stays a redirect so the section nav keeps one
 *  canonical landing segment. */
export const CONSOLE_V2_CHILDREN = [
  { index: true, element: <ShellOverviewPage /> },
  { path: "employees", element: <ShellEmployeesPage /> },
  { path: "employees/new", element: <ShellEmployeeCreatePage /> },
  { path: "employees/:id", element: <ShellEmployeeDetailPage /> },
  { path: "matrix", element: <ShellMatrixPage /> },
  { path: "skills", element: <ShellSkillsPage /> },
  // SK-01: the ledger row's detail is an inline expansion on the same page —
  // this child route only makes that expansion addressable (`skills/<id>`);
  // it reuses the very same lazy page module, no second detail screen.
  { path: "skills/:skillId", element: <ShellSkillsPage /> },
  { path: "approvals", element: <ShellApprovalsPage /> },
  { path: "approvals/:id", element: <ShellApprovalDetailPage /> },
  { path: "tasks", element: <ShellTasksPage /> },
  { path: "tasks/new", element: <ShellTaskCreatePage /> },
  { path: "tasks/:taskId", element: <ShellTaskDetailPage /> },
  { path: "collab", element: <ShellCollabPage /> },
  { path: "runs", element: <ShellRunsPage /> },
  { path: "runs/:runId", element: <ShellRunDetailPage /> },
  { path: "metrics", element: <ShellMetricsPage /> },
  { path: "audit", element: <ShellAuditPage /> },
  { path: "audit/:eventId", element: <ShellAuditDetailPage /> },
  { path: "settings", element: <Navigate to="/agent/settings/tenant" replace /> },
  { path: "settings/:section", element: <ShellSettingsPage /> },
  { path: "chat", element: <ShellChatPage /> },
  { path: "*", element: <ShellNotFoundPage /> },
];
