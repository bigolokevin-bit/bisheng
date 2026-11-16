/* eslint-disable no-restricted-syntax -- assertions pin the frozen AUD-01 rules, some of which are Chinese copy fragments */
/**
 * AUD-01 pure rules (AUD01-TARGET-SPEC §1.5/§1.6/§1.7/§1.8/§2/§7).
 *
 * These are the assertions that must not rot silently:
 * - the A3 filter guard (never an unfiltered query) and the two DIFFERENT
 *   window notions (occurred closed vs recorded half-open);
 * - the green gate: `complete=false` (S2) can never be green, and ok=true with
 *   scanned=0/no anchor (S0) is not a pass either;
 * - prefix dispatch never guesses (`emp_` asks, `ev_` refuses);
 * - the diff is a key-level before/after diff (same value is not rendered);
 * - short ids are display-only.
 */
import { describe, expect, it } from 'vitest';

import {
  BROKEN_IDS_LIMIT,
  CLOCK_SKEW_MS,
  DEFAULT_LIMIT,
  actionLabelKey,
  classifyVerify,
  clockSkewMs,
  diffRows,
  dispatchSearch,
  formatLatency,
  formatSpan,
  formatUtcMinute,
  hasAnyAuditFilter,
  isVerifyGreen,
  listRange,
  onBehalfDisplay,
  readAuditQuery,
  requestParams,
  shortId,
  verifyRange,
  type AuditQuery,
  type AuditVerifyResult,
} from '../aud01';

const NOW = Date.parse('2026-11-17T09:20:00.000Z');

function q(patch: Partial<AuditQuery> = {}): AuditQuery {
  return {
    window: '24h',
    from: '',
    to: '',
    runId: '',
    taskId: '',
    actorId: '',
    resourceId: '',
    action: '',
    limit: DEFAULT_LIMIT,
    cursor: null,
    ...patch,
  };
}

describe('AUD-01 A3 filter guard (§1.5/§7)', () => {
  it('the default 24h window is itself a filter — both bounds are sent', () => {
    const range = listRange(q(), NOW);
    expect(range.from).toBe('2026-11-16T09:20:00.000Z');
    expect(range.to).toBe('2026-11-17T09:20:00.000Z');
    expect(hasAnyAuditFilter(q(), NOW)).toBe(true);
  });

  it('a custom window with no bounds sends nothing (guide state, zero requests)', () => {
    const empty = q({ window: 'custom' });
    expect(hasAnyAuditFilter(empty, NOW)).toBe(false);
    expect(listRange(empty, NOW)).toEqual({ from: undefined, to: undefined });
  });

  it('a custom window with one bound is a real filter', () => {
    expect(hasAnyAuditFilter(q({ window: 'custom', from: '2026-11-16T00:00:00.000Z' }), NOW)).toBe(
      true,
    );
  });

  it('requestParams maps only the seven A3 params plus limit/cursor', () => {
    const params = requestParams(
      q({ action: 'grant.created', actorId: 'emp_1', limit: 100 }),
      NOW,
    );
    expect(params).toMatchObject({
      action: 'grant.created',
      actorId: 'emp_1',
      limit: 100,
      from: '2026-11-16T09:20:00.000Z',
      to: '2026-11-17T09:20:00.000Z',
    });
    expect(params.resourceId).toBeUndefined();
    expect(params.runId).toBeUndefined();
  });

  it('the verify window is recorded-time half-open and independent of the list window', () => {
    const list = listRange(q({ window: '7d' }), NOW);
    const verify = verifyRange('7d', NOW);
    expect(verify.from).toBe(list.from);
    // same bounds, different semantics; the readout is minutes in UTC
    expect(formatUtcMinute(verify.from)).toBe('2026-11-10T09:20Z');
    expect(formatUtcMinute(verify.to)).toBe('2026-11-17T09:20Z');
  });
});

describe('AUD-01 green gate (§1.6, the panel’s core red line)', () => {
  const green: AuditVerifyResult = {
    ok: true,
    complete: true,
    scanned: 1284,
    anchorCheckpointId: 'cpk_20261116_09',
    chainHeadHash: 'ah_9f2c1a77d4e04b86a1c9d3f5e7b02c18',
  };

  it('green needs all four conditions', () => {
    expect(isVerifyGreen(green)).toBe(true);
    expect(classifyVerify(green)).toBe('s1');
  });

  it('NEGATIVE: complete=false with ok=true is S2 — never green', () => {
    const truncated: AuditVerifyResult = { ...green, complete: false, scanned: 100_000 };
    expect(isVerifyGreen(truncated)).toBe(false);
    expect(classifyVerify(truncated)).toBe('s2');
  });

  it('NEGATIVE: scanned=0 without an anchor is S0 — neutral, not a pass', () => {
    const noAnchor: AuditVerifyResult = { ok: true, complete: true, scanned: 0 };
    expect(isVerifyGreen(noAnchor)).toBe(false);
    expect(classifyVerify(noAnchor)).toBe('s0');
  });

  it('a broken chain outranks truncation (ok=false ⇒ S3)', () => {
    const broken: AuditVerifyResult = {
      ok: false,
      complete: false,
      scanned: 1284,
      brokenCount: 3,
      brokenEventIds: ['ev_1', 'ev_2', 'ev_3'],
    };
    expect(classifyVerify(broken)).toBe('s3');
  });

  it('an anchor is required even when everything else holds', () => {
    const noAnchorId: AuditVerifyResult = { ...green, anchorCheckpointId: undefined };
    expect(isVerifyGreen(noAnchorId)).toBe(false);
    expect(classifyVerify(noAnchorId)).toBe('s0');
  });

  it('the broken-id list cap is 20 (the UI must say 「first 20」 beyond it)', () => {
    expect(BROKEN_IDS_LIMIT).toBe(20);
  });
});

describe('AUD-01 search dispatch (§1.5 F2)', () => {
  it('routes known id prefixes to their real parameters', () => {
    expect(dispatchSearch('rn_01M7DEY86XMD8J2SJZES4TGPWJ')).toEqual({
      kind: 'runId',
      value: 'rn_01M7DEY86XMD8J2SJZES4TGPWJ',
    });
    expect(dispatchSearch('tk_1')?.kind).toBe('taskId');
    // approval ids are resource ids on A3 (approvals.py: resource.id == approvalId)
    expect(dispatchSearch('ap_1')?.kind).toBe('resourceId');
  });

  it('never guesses for emp_ and never pretends ev_ is queryable', () => {
    expect(dispatchSearch('emp_86A8')?.kind).toBe('employee');
    expect(dispatchSearch('ev_01M7')?.kind).toBe('event');
  });

  it('anything else is an exact action value (no fuzzy search exists)', () => {
    expect(dispatchSearch(' grant.created ')).toEqual({ kind: 'action', value: 'grant.created' });
    expect(dispatchSearch('   ')).toBeNull();
  });
});

describe('AUD-01 row diff (§1.8)', () => {
  it('classifies add / del / chg and hides equal values', () => {
    const { rows, sameKeys } = diffRows(
      { role: 'owner', expiresAt: 'old', same: 1 },
      { role: 'admin', expiresAt: 'new', same: 1, scopeType: 'channel' },
    );
    expect(rows).toEqual([
      { kind: 'chg', key: 'role', before: 'owner', after: 'admin' },
      { kind: 'chg', key: 'expiresAt', before: 'old', after: 'new' },
      { kind: 'add', key: 'scopeType', after: 'channel' },
    ]);
    expect(sameKeys).toEqual(['same']);
  });

  it('before-only keys are deletions', () => {
    const { rows } = diffRows({ gone: true }, undefined);
    expect(rows).toEqual([{ kind: 'del', key: 'gone', before: true }]);
  });

  it('empty diff is empty (the page shows the honest explanation instead)', () => {
    expect(diffRows(undefined, undefined).rows).toEqual([]);
    expect(diffRows({}, {}).rows).toEqual([]);
  });

  it('flags values beyond the 4KB contract guidance', () => {
    const big = 'x'.repeat(5000);
    expect(diffRows(undefined, { big }).oversized).toBe(true);
    expect(diffRows(undefined, { small: 'x' }).oversized).toBe(false);
  });
});

describe('AUD-01 formatting (display vs truth)', () => {
  it('shows occurred time, never claims it is the sort key', () => {
    expect(formatLatency('2026-11-17T07:12:32.000Z', '2026-11-17T07:12:32.800Z')).toBe('+800ms');
    expect(formatLatency('2026-11-17T06:40:12.000Z', '2026-11-17T07:12:33.000Z')).toBe('+32m21s');
    expect(clockSkewMs('2026-11-17T06:40:12.000Z', '2026-11-17T07:12:33.000Z')).toBeGreaterThan(
      CLOCK_SKEW_MS,
    );
    expect(formatSpan(32 * 60_000 + 21_000)).toBe('32m21s');
  });

  it('truncates ids visually only; the hash keeps its tail', () => {
    expect(shortId('rn_01M7DEY86XMD8J2SJZES4TGPWJ')).toBe('rn_01M7…GPWJ');
    expect(shortId('ah_4d8e2f1a9b391ab7c5d2e0f8a1b63c42')).toBe('ah_4d8e…b63c42');
    expect(shortId('short')).toBe('short');
    expect(shortId(undefined)).toBe('—');
  });

  it('onBehalfOf keeps the raw id rather than inventing a name', () => {
    expect(onBehalfDisplay('human:u_10001')).toBe('u_10001');
    expect(onBehalfDisplay('service:x')).toBe('service:x');
  });

  it('unknown actions get no invented label', () => {
    expect(actionLabelKey('grant.created')).toBe('actionGrantCreated');
    expect(actionLabelKey('grant.revoked')).toBeNull();
  });

  it('reads only its own nine URL params and ignores foreign markers', () => {
    const parsed = readAuditQuery('?src=ov&window=7d&action=kb.read&limit=200&cursor=abc');
    expect(parsed.window).toBe('7d');
    expect(parsed.action).toBe('kb.read');
    expect(parsed.limit).toBe(200);
    expect(parsed.cursor).toBe('abc');
    // out-of-range limit falls back to the default instead of being sent
    expect(readAuditQuery('?limit=9999').limit).toBe(DEFAULT_LIMIT);
  });
});