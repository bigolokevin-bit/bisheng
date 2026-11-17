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
  ACTOR_TYPES,
  BROKEN_IDS_LIMIT,
  CLOCK_SKEW_MS,
  DEFAULT_LIMIT,
  actionLabelKey,
  actorText,
  classifyVerify,
  clockSkewMs,
  decisionEnum,
  diffRows,
  dispatchSearch,
  formatLatency,
  formatShanghaiMinute,
  formatSpan,
  formatUtcMinute,
  hasAnyAuditFilter,
  isEmployeeResource,
  isVerifyGreen,
  listRange,
  normalizeEnum,
  onBehalfDisplay,
  outcomeEnum,
  readAuditQuery,
  requestParams,
  resourceWord,
  shortId,
  sourceWord,
  verifyRange,
  wireText,
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
    expect(shortId('ah_4d8e2f1a9b391ab7c5d2e0f8a1b63c42')).toBe('ah_4d8e…3c42');
    expect(shortId('tk_01M7DF8J5H7K9M1N3P5R7T9V1XZ')).toBe('tk_01M7…V1XZ');
    expect(shortId('ev_01M7DEY8ZQ4R7T2V8X0Y2A4B6C')).toBe('ev_01M7…4B6C');
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

// ---------------------------- wire-value hygiene (§1.7 C2/C3; the schemaVersion lesson)

describe('AUD-01 wire hygiene — odd upstream shapes never throw', () => {
  const t = (key: string) => key;

  it('wireText coerces numbers and rejects everything else', () => {
    expect(wireText(1)).toBe('1');
    expect(wireText(0)).toBe('0');
    expect(wireText('v1')).toBe('v1');
    expect(wireText(null)).toBe('');
    expect(wireText(undefined)).toBe('');
    expect(wireText(Number.NaN)).toBe('');
    expect(wireText({})).toBe('');
    expect(wireText([])).toBe('');
  });

  it('known enums match case-insensitively; unlisted values stay verbatim', () => {
    expect(normalizeEnum('EMPLOYEE', ACTOR_TYPES)).toBe('employee');
    expect(normalizeEnum(' employee ', ACTOR_TYPES)).toBe('employee');
    expect(normalizeEnum('ROBOT', ACTOR_TYPES)).toBe('ROBOT');
    expect(sourceWord('CHANNEL', t)).toBe('agentConsole.v2.aud01.sourceChannel');
    expect(sourceWord('channel', t)).toBe('agentConsole.v2.aud01.sourceChannel');
    expect(sourceWord('mystery', t)).toBe('mystery');
    expect(decisionEnum('APPROVED')).toBe('approved');
    expect(decisionEnum('NOT_APPLICABLE')).toBe('not_applicable');
    expect(outcomeEnum('SUCCESS')).toBe('success');
    expect(outcomeEnum('weird')).toBe('weird');
  });

  it('resourceWord localizes known types and never invents one', () => {
    expect(resourceWord('EMPLOYEE', t)).toBe('agentConsole.v2.id.res.employee');
    expect(resourceWord('employee', t)).toBe('agentConsole.v2.id.res.employee');
    expect(resourceWord('employee_custom', t)).toBe('employee_custom');
    expect(resourceWord(42, t)).toBe('42');
    expect(isEmployeeResource('EMPLOYEE')).toBe(true);
    expect(isEmployeeResource('employee')).toBe(true);
    expect(isEmployeeResource(' employee_version ')).toBe(false);
    expect(isEmployeeResource(undefined)).toBe(false);
  });

  it('actorText keeps display names, hides system worker ids, localizes the type', () => {
    const names = new Map<string, string>();
    // R1 (VG-B2): the worker id is title-only; screen says 「系统」/「服务」.
    expect(actorText({ type: 'SYSTEM', id: 'employee-api' }, names, t)).toBe(
      'agentConsole.v2.id.typeSystem',
    );
    expect(actorText({ type: 'service', id: 'runtime-worker' }, names, t)).toBe(
      'agentConsole.v2.id.typeService',
    );
    expect(actorText({ type: 'employee', id: 'emp_5B3C7A9D1E2F4068B5C3D7E9' }, names, t)).toBe(
      'agentConsole.v2.id.employeeRef',
    );
    expect(actorText({ type: 'human', id: 'u_10001', displayName: '陈诚' }, names, t)).toBe('陈诚');
    // a numeric displayName/id must never reach .trim()
    expect(() =>
      actorText(
        {
          type: 'human',
          id: 10001 as unknown as string,
          displayName: 7 as unknown as string,
        },
        names,
        t,
      ),
    ).not.toThrow();
    expect(actorText(null, names, t)).toBe('agentConsole.v2.id.unknown');
  });

  it('shortId and the Beijing formatter accept numbers and junk', () => {
    expect(shortId(12345 as unknown as string)).toBe('12345');
    expect(shortId(0 as unknown as string)).toBe('0');
    expect(formatShanghaiMinute('2026-11-17T08:31:07.884Z')).toBe('2026-11-17 16:31');
    expect(formatShanghaiMinute('not-a-date')).toBe('—');
  });
});