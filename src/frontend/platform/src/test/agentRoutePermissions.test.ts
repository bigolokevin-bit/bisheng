/**
 * S10b-5: the agent console and its approvals inbox are admin-scoped web menus.
 * The route table must strip both routes without an `agent` grant, and an admin
 * whose only menu is `agent` must land on /agent.
 */
import { describe, expect, it } from "vitest"

import { getPrivateRouter, resolveAdminLandingPath, resolveRoutePermissions } from "@/routes"

type RouteNode = { path?: string; children?: RouteNode[] }

const pathsOf = (routes: RouteNode[]): string[] =>
  routes
    .flatMap((route) => [route.path, ...(route.children ? pathsOf(route.children) : [])])
    .filter((path): path is string => typeof path === "string")

describe("agent route permissions (S10b-5)", () => {
  // P0 switch card: flag-off /agent/employees[/:id] route to the upstream v1
  // AgentPage; they share the `agent` grant and must be stripped without it.
  const agentRoutes = ["agent", "agent/employees", "agent/employees/:id", "agent/approvals"] as const

  it("strips both agent routes without the agent grant", () => {
    const router = getPrivateRouter(["admin"])
    const paths = pathsOf(router.routes as RouteNode[])
    agentRoutes.forEach((p) => expect(paths).not.toContain(p))
    router.dispose()
  })

  it("keeps both agent routes with the agent grant", () => {
    const router = getPrivateRouter(["admin", "agent"])
    const paths = pathsOf(router.routes as RouteNode[])
    agentRoutes.forEach((p) => expect(paths).toContain(p))
    router.dispose()
  })

  it("child admins derive the agent permission", () => {
    expect(resolveRoutePermissions({ is_child_admin: true, web_menu: [] })).toContain("agent")
  })

  it("an admin holding only the agent menu lands on /agent", () => {
    expect(resolveAdminLandingPath(["agent"], false)).toBe("/agent")
  })
})
