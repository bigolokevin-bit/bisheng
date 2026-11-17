/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * SKILL-01 read-only skill governance tests.
 *
 * Same harness as the Matrix suite: stub the global fetch that makeFetcher()
 * uses, route by URL, and mock react-i18next against the REAL zh-Hans
 * resources so raw-key leaks are caught by the DOM guard. Probe 2026-11-17:
 * /api/skills exists behind the identity gate (401 without a cookie) and the
 * 200 row shape is unverified — the 401 branch below is the current real
 * behavior, and the row tests pin the honest degrade for every optional field.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', async () => {
  const mod = await import('../../../../public/locales/zh-Hans/bs.json');
  const dict: Record<string, unknown> = (mod as { default: Record<string, unknown> }).default;
  const lookup = (key: string): unknown => {
    let cur: unknown = dict;
    for (const part of key.split('.')) {
      if (cur == null || typeof cur !== 'object') return undefined;
      cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
  };
  const t = (key: string, defOrOpts?: unknown): string => {
    const val = lookup(key);
    if (typeof val !== 'string') return typeof defOrOpts === 'string' ? defOrOpts : key;
    if (defOrOpts && typeof defOrOpts === 'object') {
      return val.replace(/\{\{(\w+)\}\}/g, (_m, k: string) =>
        String((defOrOpts as Record<string, unknown>)[k] ?? ''),
      );
    }
    return val;
  };
  return { useTranslation: () => ({ t }) };
});

import SkillsPage from '../SkillsPage';
import { userContext } from '@/contexts/userContext';

let urls: string[] = [];
let skillsStatus = 200;
let skillsBody: unknown = { items: [] };

function stubFetch() {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    if (url.includes('/api/skills')) {
      return {
        ok: skillsStatus >= 200 && skillsStatus < 300,
        status: skillsStatus,
        json: async () => skillsBody,
        headers: { get: () => null },
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}), headers: { get: () => null } } as unknown as Response;
  }) as never;
}

function renderPage(entry = '/agent/skills') {
  return render(
    <userContext.Provider value={{ user: { user_id: 1 } as never }}>
      <MemoryRouter initialEntries={[entry]}>
        <SkillsPage />
      </MemoryRouter>
    </userContext.Provider>,
  );
}

function guardNoRawKeys() {
  const body = document.body.textContent ?? '';
  expect(body).not.toContain('agentConsole.');
  expect(body).not.toContain('[object Object]');
  expect(body).not.toContain('undefined');
}

const LONG_HASH = '9f2c4a1be7d05c6f8a3b2d1e4c5f607189abcdef0123456789abcdef01234567';

const ROW_SHARED = {
  skillId: 'sk_001',
  name: '周报生成',
  description: '把当日运行与审批汇总成周报草稿。',
  version: 4,
  owner: '林悦',
  contentHash: LONG_HASH,
  scope: 'tenant-shared',
  sharedWith: ['林悦', '周舟'],
  sharedCount: 12,
  referencedBy: ['小鲤', '客服岗'],
};

const ROW_EXCLUSIVE = {
  skillId: 'sk_002',
  name: '发票核对',
  version: 'v2',
  owner: '陈默',
  scope: 'employee-exclusive',
  sharedWith: [],
  sharedCount: 1,
  referencedBy: [],
};

/* Every display field absent except the id: nothing may be invented. */
const ROW_BARE = { skillId: 'sk_003' };

beforeEach(() => {
  urls = [];
  skillsStatus = 200;
  skillsBody = { items: [] };
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SKILL-01 read-only skill governance', () => {
  it('shows the loading skeleton before the response lands', async () => {
    let release: (v: unknown) => void = () => {};
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ) as never;
    renderPage();
    expect(screen.getByTestId('agent-v2-sk-loading')).toBeTruthy();
    release({ ok: true, status: 200, json: async () => ({ items: [] }), headers: { get: () => null } });
    await waitFor(() => expect(screen.queryByTestId('agent-v2-sk-loading')).toBeNull());
  });

  it('degrades honestly when the read endpoint refuses the session (401, current live state)', async () => {
    skillsStatus = 401;
    skillsBody = { code: 'console.unauthenticated', message: 'identity check failed' };
    renderPage();
    await screen.findByTestId('agent-v2-sk-error');
    const err = screen.getByTestId('agent-v2-sk-error');
    const text = err.textContent ?? '';
    expect(text).toContain('登录已失效');
    expect(text).not.toContain('console.unauthenticated');
    expect(text).not.toContain('identity check failed');
    expect(text).not.toContain('401');
    expect(text).not.toContain('/api/');
    guardNoRawKeys();
    // the request id slot is present and honest about a missing id
    expect(screen.getByTestId('agent-v2-sk-error-reqid').textContent).toContain('未提供');
    // retry re-issues the same read-only request
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    screen.getByTestId('agent-v2-sk-retry').click();
    await waitFor(() =>
      expect(
        (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) => String(c[0]).includes('/api/skills'))
          .length,
      ).toBeGreaterThan(0),
    );
  });

  it('renders a human error card with retry on a server failure, never fake rows', async () => {
    skillsStatus = 500;
    skillsBody = { code: 'agent.internal', message: 'boom' };
    renderPage();
    await screen.findByTestId('agent-v2-sk-error');
    const text = screen.getByTestId('agent-v2-sk-error').textContent ?? '';
    expect(text).toContain('暂时读不到技能台账');
    expect(text).not.toContain('agent.http');
    expect(text).not.toContain('boom');
    expect(screen.queryAllByTestId('agent-v2-sk-row')).toHaveLength(0);
    guardNoRawKeys();
  });

  it('renders the empty state without fabricating rows', async () => {
    skillsStatus = 200;
    skillsBody = { items: [] };
    renderPage();
    await screen.findByTestId('agent-v2-sk-empty');
    expect(screen.queryAllByTestId('agent-v2-sk-row')).toHaveLength(0);
    expect((document.body.textContent ?? '').includes('暂无技能')).toBe(true);
    guardNoRawKeys();
  });

  it('renders the shared / exclusive / bare rows with honest values only', async () => {
    skillsStatus = 200;
    skillsBody = { items: [ROW_SHARED, ROW_EXCLUSIVE, ROW_BARE] };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-sk-row');
    expect(rows).toHaveLength(3);
    expect(screen.getByTestId('agent-v2-sk-count').textContent).toContain('已加载 3 个技能');

    const [shared, exclusive, bare] = rows;

    // tenant-shared: supplied count wins, member names are real
    expect(shared.textContent).toContain('周报生成');
    expect(shared.textContent).toContain('共享给 12 人');
    expect(shared.textContent).toContain('林悦、周舟');
    expect(shared.textContent).toContain('小鲤、客服岗');
    expect(shared.textContent).toContain('版本');
    expect(shared.textContent).toContain('4');
    expect(shared.textContent).toContain('维护人');
    expect(shared.textContent).toContain('林悦');

    // fingerprint is shortened on the card, full value kept on the element
    const hashCell = shared.querySelector('[data-testid="agent-v2-sk-hash"]') as HTMLElement;
    expect(hashCell.textContent).toContain('9f2c4a1be7…4567');
    expect(hashCell.textContent).not.toContain(LONG_HASH);
    expect(hashCell.querySelector('[title]')?.getAttribute('title')).toBe(LONG_HASH);

    // employee-exclusive with an explicitly empty reference list
    expect(exclusive.textContent).toContain('员工独有');
    expect(exclusive.textContent).toContain('v2');
    expect(exclusive.textContent).toContain('暂无引用');

    // bare row: unnamed + every missing field renders '—', never 0 / 未配置 misuse
    expect(bare.textContent).toContain('未命名技能');
    const bareVersion = bare.querySelector('[data-testid="agent-v2-sk-version"]') as HTMLElement;
    expect(bareVersion.textContent).toContain('—');
    const bareScope = bare.querySelector('[data-testid="agent-v2-sk-scope"]') as HTMLElement;
    expect(bareScope.textContent).toContain('—');
    const bareOwner = bare.querySelector('[data-testid="agent-v2-sk-owner"]') as HTMLElement;
    expect(bareOwner.textContent).toContain('—');
    // referencedBy absent ≠ empty list: no 「暂无引用」 claim for a field we never got
    const bareRefs = bare.querySelector('[data-testid="agent-v2-sk-refs"]') as HTMLElement;
    expect(bareRefs.textContent).toContain('—');
    expect(bareRefs.textContent).not.toContain('暂无引用');
    expect(bare.textContent).not.toContain('0 人');

    guardNoRawKeys();
    for (const u of urls) expect(u).toContain('/api/skills');
  });

  it('passes an unknown scope through verbatim with a warn pill', async () => {
    skillsStatus = 200;
    skillsBody = { items: [{ skillId: 'sk_x', name: '神秘技能', scope: 'org-wide' }] };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-sk-row');
    const pill = rows[0].querySelector('[data-testid="agent-v2-sk-scope"]') as HTMLElement;
    expect(pill.textContent).toContain('org-wide');
    expect(pill.className).toContain('is-warn');
    guardNoRawKeys();
  });

  it('says the audience size is unknown instead of inventing 0', async () => {
    skillsStatus = 200;
    skillsBody = { items: [{ skillId: 'sk_y', name: '无人数', scope: 'tenant-shared' }] };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-sk-row');
    const pill = rows[0].querySelector('[data-testid="agent-v2-sk-scope"]') as HTMLElement;
    expect(pill.textContent).toContain('人数未提供');
    expect(pill.textContent).not.toContain('0 人');
    guardNoRawKeys();
  });

  it('derives the audience size from the real member list when no count is sent', async () => {
    skillsStatus = 200;
    skillsBody = { items: [{ skillId: 'sk_z', name: '三人共享', scope: 'tenant-shared', sharedWith: ['甲', '乙', '丙'] }] };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-sk-row');
    const pill = rows[0].querySelector('[data-testid="agent-v2-sk-scope"]') as HTMLElement;
    expect(pill.textContent).toContain('共享给 3 人');
    guardNoRawKeys();
  });

  it('has zero write entry points: no form, input or upload control', async () => {
    skillsStatus = 200;
    skillsBody = { items: [ROW_SHARED, ROW_EXCLUSIVE] };
    renderPage();
    await screen.findAllByTestId('agent-v2-sk-row');
    expect(document.querySelectorAll('form, input, textarea, select')).toHaveLength(0);
    expect(document.querySelector('[data-testid*="upload"]')).toBeNull();
    expect(document.querySelector('[data-testid*="delete"]')).toBeNull();
    expect(document.querySelector('[data-testid*="create"]')).toBeNull();
    // the only control is the fingerprint copy affordance (one row carries a
    // hash; the other has none, so no dead copy button is rendered for it)
    const buttons = Array.from(document.querySelectorAll('button'));
    expect(buttons.map((b) => b.getAttribute('data-testid'))).toEqual(['agent-v2-sk-hash-copy']);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockClear();
    buttons[0].click();
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});