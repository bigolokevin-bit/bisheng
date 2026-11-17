/**
 * S2 quality surgery — pure unit tests for the identity display helpers.
 * The dictionary is the REAL zh-Hans locale file (same loader idiom as the
 * page tests): a missing key fails here before it ever reaches a screen.
 */
import { describe, expect, it } from 'vitest';

import {
  actorLabel,
  avatarChar,
  bareId,
  duplicateNames,
  employeeDisplayName,
  employeeLabelById,
  humanLabel,
  humanRefLabel,
  idTail,
  identityText,
  isPlaceholderIdentity,
  looksLikeOpaqueUid,
  ownerDisplayLabel,
  resourceTypeLabel,
} from '../identity';

const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
  default: Record<string, unknown>;
};
const dict = mod.default;

const t = (key: string, opts?: Record<string, unknown>): string => {
  const value = key
    .split('.')
    .reduce<unknown>(
      (acc, part) =>
        acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
      dict,
    );
  let text = typeof value === 'string' ? value : key;
  if (text === key) throw new Error(`missing locale key: ${key}`);
  for (const [k, v] of Object.entries(opts ?? {})) text = text.split(`{{${k}}}`).join(String(v));
  return text;
};

describe('S2 — placeholder identities', () => {
  it('catches the seed placeholders case-insensitively', () => {
    expect(isPlaceholderIdentity('owner')).toBe(true);
    expect(isPlaceholderIdentity('owner@example.com')).toBe(true);
    expect(isPlaceholderIdentity('OWNER@EXAMPLE.COM')).toBe(true);
    expect(isPlaceholderIdentity('opsadmin')).toBe(false);
    expect(isPlaceholderIdentity('')).toBe(false);
  });

  it('placeholders never reach the screen — 「未知」 takes over', () => {
    expect(humanLabel('owner', t)).toBe('未知');
    expect(ownerDisplayLabel('owner@example.com', t)).toBe('未知');
    expect(identityText('human:owner', t)).toBe('未知');
    expect(ownerDisplayLabel('', t)).toBe('未知');
  });
});

describe('S2 — human refs', () => {
  it('opaque uids read 「用户 #N」, name-shaped values stay verbatim', () => {
    expect(humanLabel('1', t)).toBe('用户 #1');
    expect(humanLabel('u_10001', t)).toBe('用户 #u_10001');
    expect(humanLabel('opsadmin', t)).toBe('opsadmin');
    expect(looksLikeOpaqueUid('1')).toBe(true);
    expect(looksLikeOpaqueUid('opsadmin')).toBe(false);
  });

  it('a resolved name always wins', () => {
    expect(humanLabel('1', t, '张三')).toBe('张三');
  });

  it('combined refs print without the human: prefix', () => {
    expect(humanRefLabel('human:1', t)).toBe('用户 #1');
    expect(humanRefLabel('human:u_c7f3d2a91b46', t)).toBe('用户 #u_c7f3d2a91b46');
    expect(humanRefLabel('', t)).toBe('—');
    expect(humanRefLabel('human:1', t)).not.toContain('human:');
  });

  it('the operator themself resolves to the session display name', () => {
    expect(ownerDisplayLabel('1', t, { currentUid: '1', currentName: '张三' })).toBe('张三');
    expect(ownerDisplayLabel('human:1', t, { currentUid: '1', currentName: '张三' })).toBe('张三');
    expect(ownerDisplayLabel('2', t, { currentUid: '1', currentName: '张三' })).toBe('用户 #2');
  });
});

describe('S2 — employees', () => {
  const E = 'emp_86A81CE8FF6F42E187BCF2B540';

  it('name when the directory resolved, 「员工 · 短码」 otherwise', () => {
    const names = new Map([[E, '小鲤']]);
    expect(employeeLabelById(E, names, t)).toBe('小鲤');
    expect(employeeLabelById('emp_5B3C7A9D1E2F4068B5C3D7E9', names, t)).toBe('员工 · D7E9');
    expect(employeeLabelById(E, undefined, t)).toBe('员工 · B540');
  });

  it('duplicate names get the id tail; empty names read 「未命名」', () => {
    const rows = [
      { id: E, name: '小鲤' },
      { id: 'emp_00000000000000000000AA11', name: '小鲤' },
      { id: 'emp_00000000000000000000BB22', name: '  ' },
      { id: 'emp_00000000000000000000CC33', name: '阿福' },
    ];
    const dups = duplicateNames(rows);
    expect(dups.has('小鲤')).toBe(true);
    expect(dups.has('阿福')).toBe(false);
    expect(employeeDisplayName(rows[0], dups, t)).toBe('小鲤 · B540');
    expect(employeeDisplayName(rows[1], dups, t)).toBe('小鲤 · AA11');
    expect(employeeDisplayName(rows[2], dups, t)).toBe('未命名');
    expect(employeeDisplayName(rows[3], dups, t)).toBe('阿福');
  });

  it('short helpers: bareId / idTail', () => {
    expect(bareId('human:9')).toBe('9');
    expect(bareId('9')).toBe('9');
    expect(idTail('employee:emp_9F42AAE299CD541FBBB68B0E33671')).toBe('3671');
  });
});

describe('S2 — actors & resources', () => {
  it('system/service actors read as 「系统 · id」/「服务 · id」', () => {
    expect(actorLabel({ type: 'system', id: 'employee-api' }, undefined, t)).toBe(
      '系统 · employee-api',
    );
    expect(actorLabel({ type: 'service', id: 'gateway-sync' }, undefined, t)).toBe(
      '服务 · gateway-sync',
    );
  });

  it('displayName wins; human and employee degrade readably', () => {
    expect(actorLabel({ type: 'human', id: 'u_10001', displayName: '陈诚' }, undefined, t)).toBe(
      '陈诚',
    );
    expect(actorLabel({ type: 'human', id: 'human:1' }, undefined, t)).toBe('用户 #1');
    expect(actorLabel({ type: 'employee', id: 'emp_86A81CE8FF6F42E187BCF2B540' }, undefined, t)).toBe(
      '员工 · B540',
    );
  });

  it('resource types get Chinese words, unlisted enums pass through', () => {
    expect(resourceTypeLabel('employee', t)).toBe('员工');
    expect(resourceTypeLabel('grant', t)).toBe('授权');
    expect(resourceTypeLabel('widget', t)).toBe('widget');
  });
});

describe('S2 — generic refs + avatars', () => {
  it('identityText covers the prefixed / numeric / name shapes', () => {
    expect(identityText('human:1', t)).toBe('用户 #1');
    expect(identityText('human:opsadmin', t)).toBe('opsadmin');
    expect(identityText('emp_5B3C7A9D1E2F4068B5C3D7E9', t)).toBe('员工 · D7E9');
    expect(identityText('employee:小鲤', t)).toBe('小鲤');
    expect(identityText('runtime', t)).toBe('runtime');
    expect(identityText('', t)).toBe('—');
  });

  it('avatars keep a CJK first character, drop stray Latin letters', () => {
    expect(avatarChar('小鲤')).toBe('小');
    expect(avatarChar('我')).toBe('我');
    expect(avatarChar('Alice')).toBeNull();
    expect(avatarChar('opsadmin')).toBeNull();
    expect(avatarChar('')).toBeNull();
    expect(avatarChar(null)).toBeNull();
  });
});
