/* APR-01 approvals pending list (lane integration stub).
 * Owned by the APR-01 page lane: /agent/approvals queue, counters (AP8),
 * tabs, batch selection (disabled decide buttons this wave), URL state.
 * Data plane ONLY: /api/approvals?status=pending (AP4) and
 * /api/approval-stats (AP8) via the same /agent-api origin. No AP2 writes,
 * no fabricated detail pages. The shell route (shellPages.ApprovalsPage)
 * already points here; keep the export name stable. */
export function ApprovalsListPage() {
  return (
    <div className="a2s-page" data-testid="agent-v2-approvals-list">
      APR-01 stub
    </div>
  );
}
