/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * AUD-01 R2 (QA card 621a6dd, four VG blockers) — pure-function pins.
 *
 * ① residual engineering language: the action chip now prints a
 *    plain-language label (raw value only in title); banner/verify notes lost
 *    their `(GET)` / `critical` tokens at the locale layer.
 * ② paging contradiction: the disabled 下一页 disappears together with the
 *    last-page note (CSS-only, :has() — jsdom cannot evaluate it, so the
 *    behavioural half is pinned in AuditList.test.tsx instead).
 * ③ short codes: ONE middle-ellipsis shape 「前6…后4」, never a bare tail.
 * ④ 1280 band: sticky header + visible hint (CSS, reviewed by eye after
 *    deploy; the locale hint copy is pinned here).
 */
import { describe, expect, it } from 'vitest';
import zh from '../../../../public/locales/zh-Hans/bs.json';
import {
  actionDisplay,
  middleEllipsis,
  shortCode,
  typeShortLabel,
} from '../aud01';

type Dict = Record<string, unknown>;
const t = (key: string): string => {
  let node: unknown = zh;
  for (const part of key.split('.')) {
    if (node && typeof node === 'object' && part in (node as Dict)) {
      node = (node as Dict)[part];
    } else {
      return key;
    }
  }
  return typeof node === 'string' ? node : key;
};

const aud01 = (zh as Dict).agentConsole as Dict;
const v2 = (aud01.v2 as Dict);
const sec = v2.aud01 as Dict;

describe('AUD-01 R2 — ③ one middle-ellipsis shape for shortened ids', () => {
  it('keeps short values intact, no ellipsis invented', () => {
    expect(middleEllipsis('tk_ABC123')).toBe('tk_ABC123');
    expect(middleEllipsis(undefined)).toBe('—');
  });

  it('prints 前6…后4 once the value is longer than what fits whole', () => {
    expect(middleEllipsis('tk_E283F0A9A453')).toBe('tk_E28…A453');
    expect(middleEllipsis('ah_9a72051abcdEF1300')).toBe('ah_9a7…1300');
  });

  it('typeShortLabel carries the type word AND a visibly truncated id', () => {
    const label = typeShortLabel('tk_E283F0A9A453', t);
    expect(label).not.toBeNull();
    expect(label).toContain('任务');
    expect(label).toContain('…');
    expect(label).toContain('tk_E28…A453');
    expect(label).toContain('· ');
  });

  it('shortCode never returns a bare 4-char tail anymore', () => {
    const shown = shortCode('ah_9a72051abcdEF1300');
    expect(shown).toContain('…');
    expect(shown).not.toBe('1300');
  });
});

describe('AUD-01 R2 — ① plain-language action, raw value off-screen', () => {
  it('maps the flagged action to 员工信息更新', () => {
    expect(actionDisplay('employee.update', t)).toBe('员工信息更新');
  });

  it('maps the known contract actions, and refuses to invent for unknown ones', () => {
    expect(actionDisplay('approval.approve', t)).toBe('审批批准');
    expect(actionDisplay('grant.revoke', t)).toBe('职权收回');
    expect(actionDisplay('workstation.bind', t)).toBe('工位绑定');
    // unknown verb ⇒ null ⇒ caller prints the raw value (title keeps it too)
    expect(actionDisplay('warehouse.melt', t)).toBeNull();
    expect(actionDisplay('', t)).toBeNull();
  });
});

describe('AUD-01 R2 — ①④ locale copy lost its engineering tokens', () => {
  it('banner no longer prints the raw severity enum', () => {
    const body = String(sec.bannerBody);
    expect(body).not.toContain('critical');
    expect(body).toContain('高风险');
  });

  it('verify note no longer prints the HTTP verb', () => {
    expect(String(sec.verifyReadonlyNote)).not.toContain('GET');
  });

  it('the 1280 hint reads as an instruction, not a statement', () => {
    expect(String(sec.tblHint)).toContain('左右滑动');
  });

  it('every mapped action key resolves in zh (no raw-key leak on screen)', () => {
    for (const k of [
      'actEmployeeUpdate',
      'actEmployeeCreate',
      'actApprovalApprove',
      'actApprovalReject',
      'actApprovalRequire',
      'actGrantGrant',
      'actGrantRevoke',
      'actWorkstationBind',
      'actWorkstationUnbind',
      'actTaskUpdate',
      'actPolicyUpdate',
      'actBudgetUpdate',
    ]) {
      const v = sec[k];
      expect(typeof v, k).toBe('string');
      expect(String(v).length, k).toBeGreaterThan(0);
      expect(String(v), k).not.toContain('agentConsole.');
    }
  });
});
