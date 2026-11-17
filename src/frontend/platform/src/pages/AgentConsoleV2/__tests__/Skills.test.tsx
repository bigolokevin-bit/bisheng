/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * SKILL-01 read-only skill governance tests.
 *
 * Harness follows the Matrix suite: stub the global fetch that makeFetcher()
 * uses, route by URL, and mock react-i18next against the REAL zh-Hans
 * resources so a raw-key leak is caught by the DOM guard. The 200 row shape
 * mirrors the domain list_skills contract (BFF c3b64b7): sharedWith carries
 * employee ids, scope is one of the three known values, asOf/nextCursor sit
 * on the envelope. A failed read must never fall back to fabricated rows.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

let urls: string[] = [];
let skillsStatus = 200;
let skillsBody: unknown = { items: [] };

function stubFetch(handler?: (url: string, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    urls.push(url);
    if (handler) return handler(url, init);
    if (url.includes('/api/skills')) {
      return {
        ok: skillsStatus >= 200 && skillsStatus < 300,
        status: skillsStatus,
        json: async () => skillsBody,
        headers: { get: () => null },
      } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      headers: { get: () => null },
    } as unknown as Response;
  }) as never;
}

function renderPage(entry = '/agent/skills') {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <SkillsPage />
    </MemoryRouter>,
  );
}

function guardNoRawKeys() {
  const body = document.body.textContent ?? '';
  expect(body).not.toContain('agentConsole.');
  expect(body).not.toContain('[object Object]');
  expect(body).not.toContain('undefined');
  expect(body).not.toContain('tenant-shared');
  expect(body).not.toContain('employee-exclusive');
}

const FULL_HASH_A = 'sh_9f2c4a1be7d05c6f8a3b2d1e4c5f6071';
const FULL_HASH_B = 'sh_0123456789abcdef0123456789abcdef';
const FULL_HASH_C = 'sh_aaaaaaaabbbbbbbbccccccccdddddddd';

const ROW_SHARED = {
  skillId: 'sk_01HZX9TEST0000000000000001',
  name: '周报生成',
  version: '1.2.0',
  contentHash: FULL_HASH_A,
  ownerUserId: 'user_10086',
  sharedWith: ['emp_aaa111', 'emp_bbb222', 'emp_ccc333', 'emp_ddd444', 'emp_eee555'],
  sharedCount: 5,
  scope: 'tenant-shared',
};
const ROW_EXCLUSIVE = {
  skillId: 'sk_01HZX9TEST0000000000000002',
  name: '发票核对',
  version: '0.9.0',
  contentHash: FULL_HASH_B,
  ownerUserId: 'user_20002',
  sharedWith: ['emp_zzz999'],
  sharedCount: 1,
  scope: 'employee-exclusive',
};
const ROW_UNUSED = {
  skillId: 'sk_01HZX9TEST0000000000000003',
  name: '旧版摘要',
  version: '2.0.0',
  contentHash: FULL_HASH_C,
  ownerUserId: null,
  sharedWith: [],
  sharedCount: 0,
  scope: 'unused',
};

const NORMAL_BODY = {
  items: [ROW_SHARED, ROW_EXCLUSIVE, ROW_UNUSED],
  asOf: '2026-11-17T06:30:00Z',
  nextCursor: 'cursor-2',
};

beforeEach(() => {
  urls = [];
  skillsStatus = 200;
  skillsBody = { items: [] };
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SKILL-01 read-only skill governance', () => {
  it('shows a static skeleton before the first response lands', async () => {
    let release: (v: unknown) => void = () => {};
    globalThis.fetch = vi.fn(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    ) as never;
    renderPage();
    expect(screen.getByTestId('agent-v2-skills-loading')).toBeTruthy();
    release({
      ok: true,
      status: 200,
      json: async () => ({ items: [] }),
      headers: { get: () => null },
    });
    await waitFor(() => expect(screen.queryByTestId('agent-v2-skills-loading')).toBeNull());
  });

  it('renders the ledger, overview numbers, fingerprints and reference overflow', async () => {
    skillsStatus = 200;
    skillsBody = NORMAL_BODY;
    renderPage();

    const rows = await screen.findAllByTestId('agent-v2-skills-row');
    expect(rows).toHaveLength(3);

    // header: read-only note + last-read time converted to Asia/Shanghai
    expect(document.body.textContent).toContain('技能治理');
    expect(document.body.textContent).toContain('不提供新建或修改入口');
    expect(screen.getByTestId('agent-v2-skills-asof').textContent).toBe('11-17 14:30');

    // overview strip: this read only; nextCursor ⇒ honest N+
    expect(screen.getByTestId('agent-v2-skills-kpi-total').textContent).toBe('3+');
    expect(screen.getByTestId('agent-v2-skills-kpi-shared').textContent).toBe('1');
    expect(screen.getByTestId('agent-v2-skills-kpi-exclusive').textContent).toBe('1');
    expect(screen.getByTestId('agent-v2-skills-loaded').textContent).toContain('已加载 3 条');
    expect(screen.getByTestId('agent-v2-skills-more').textContent).toContain('本次读取 3 条');

    const [shared, exclusive, unused] = rows;

    // shared row: human visibility + first three referents + 「另有 2 位」
    expect(shared.textContent).toContain('周报生成');
    expect(shared.textContent).toContain('1.2.0');
    expect(shared.textContent).toContain('共享给 5 位员工');
    expect(shared.textContent).toContain('user_10086');
    expect(shared.textContent).toContain('emp_aaa111');
    expect(shared.textContent).toContain('emp_bbb222');
    expect(shared.textContent).toContain('emp_ccc333');
    expect(shared.textContent).not.toContain('emp_ddd444');
    expect(screen.getByTestId('agent-v2-skills-refs-more').textContent).toBe('另有 2 位');

    // fingerprint: shortened on screen, full value in title
    const hashCell = shared.querySelector('[data-testid="agent-v2-skills-hash"]') as HTMLElement;
    expect(hashCell.textContent).toContain('sh_9f2c4a1…6071');
    expect(hashCell.textContent).not.toContain(FULL_HASH_A);
    expect(hashCell.querySelector('[title]')?.getAttribute('title')).toBe(FULL_HASH_A);

    // exclusive row + unused row
    expect(exclusive.textContent).toContain('仅 1 位员工独有');
    expect(exclusive.textContent).toContain('emp_zzz999');
    expect(unused.textContent).toContain('未被引用');
    expect(unused.textContent).toContain('暂无引用');
    expect(unused.textContent).toContain('—');
    expect(unused.textContent).not.toContain('0 位');

    guardNoRawKeys();
  });

  it('expands a row inline with the full id, full fingerprint and every referent', async () => {
    skillsBody = NORMAL_BODY;
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-skills-row');
    const expand = rows[0].querySelector('[data-testid="agent-v2-skills-expand"]') as HTMLButtonElement;
    expect(expand.getAttribute('aria-expanded')).toBe('false');

    expand.click();
    const detail = await screen.findByTestId('agent-v2-skills-expanded');
    expect(detail.textContent).toContain('sk_01HZX9TEST0000000000000001');
    expect(detail.textContent).toContain(FULL_HASH_A);
    expect(detail.textContent).toContain('emp_aaa111');
    expect(detail.textContent).toContain('emp_ddd444');
    expect(detail.textContent).toContain('emp_eee555');
    expect(screen.getAllByTestId('agent-v2-skills-expand')[0].getAttribute('aria-expanded')).toBe('true');
    // no route change: the detail lives on the same page
    expect(document.querySelectorAll('tr[data-testid="agent-v2-skills-expanded"]')).toHaveLength(1);

    fireEvent.click(screen.getAllByTestId('agent-v2-skills-expand')[0]);
    await waitFor(() => expect(screen.queryByTestId('agent-v2-skills-expanded')).toBeNull());
  });

  it('renders the empty state with a reason and next step, never rows', async () => {
    skillsBody = { items: [], asOf: '2026-11-17T06:30:00Z' };
    renderPage();
    await screen.findByTestId('agent-v2-skills-empty');
    expect(screen.queryAllByTestId('agent-v2-skills-row')).toHaveLength(0);
    expect(screen.getByTestId('agent-v2-skills-empty').textContent).toContain('暂无技能');
    expect(screen.getByTestId('agent-v2-skills-empty').textContent).toContain('不提供新建入口');
    expect(screen.getByTestId('agent-v2-skills-asof').textContent).toBe('11-17 14:30');
    guardNoRawKeys();
  });

  it('renders one identical forbidden body for 403 and 404, with no data at all', async () => {
    skillsBody = { items: [ROW_SHARED] };
    skillsStatus = 403;
    renderPage();
    await screen.findByTestId('agent-v2-skills-forbidden');
    const text403 = screen.getByTestId('agent-v2-skills-forbidden').textContent ?? '';
    expect(text403).toContain('无法查看技能台账');
    expect(text403).toContain('或该页面不存在');
    expect(text403).toContain('未提供');
    expect(screen.queryAllByTestId('agent-v2-skills-row')).toHaveLength(0);
    expect(screen.queryByTestId('agent-v2-skills-kpis')).toBeNull();
    expect(screen.queryByTestId('agent-v2-skills-table-card')).toBeNull();

    cleanup();
    skillsStatus = 404;
    renderPage();
    await screen.findByTestId('agent-v2-skills-forbidden');
    expect(screen.getByTestId('agent-v2-skills-forbidden').textContent).toBe(text403);
    expect(document.body.textContent).not.toContain('周报生成');
    guardNoRawKeys();
  });

  it('flips to the honest timeout screen after the 10s cap and retries on demand', async () => {
    vi.useFakeTimers();
    stubFetch(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    );
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId('agent-v2-skills-error').textContent).toContain('本次未能读取');
    expect(screen.getByTestId('agent-v2-skills-error').textContent).toContain('读取超时');
    expect(screen.getByTestId('agent-v2-skills-error-reqid').textContent).toContain('未提供');
    expect(screen.queryAllByTestId('agent-v2-skills-row')).toHaveLength(0);

    stubFetch();
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    await act(async () => {
      screen.getByTestId('agent-v2-skills-retry').click();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(before);
    vi.useRealTimers();
  });

  it('renders one human error sentence for a server failure, without codes or messages', async () => {
    skillsStatus = 500;
    skillsBody = { code: 'agent.internal', message: 'boom stack' };
    renderPage();
    await screen.findByTestId('agent-v2-skills-error');
    const text = screen.getByTestId('agent-v2-skills-error').textContent ?? '';
    expect(text).toContain('本次未能读取');
    expect(text).toContain('状态 500');
    expect(text).not.toContain('agent.internal');
    expect(text).not.toContain('boom stack');
    expect(text).not.toContain('/api/');
    expect(screen.queryAllByTestId('agent-v2-skills-row')).toHaveLength(0);
    guardNoRawKeys();
  });

  it('never invents a scope or a count when keys are absent', async () => {
    skillsBody = { items: [{ skillId: 'sk_bare' }] };
    renderPage();
    const rows = await screen.findAllByTestId('agent-v2-skills-row');
    const bare = rows[0];
    expect(bare.textContent).toContain('未命名技能');
    expect(screen.getByTestId('agent-v2-skills-kpi-total').textContent).toBe('1');
    expect(screen.getByTestId('agent-v2-skills-kpi-shared').textContent).toBe('—');
    expect(screen.getByTestId('agent-v2-skills-kpi-exclusive').textContent).toBe('—');
    expect(screen.getByTestId('agent-v2-skills-version').textContent).toContain('—');
    expect(screen.getByTestId('agent-v2-skills-owner').textContent).toContain('—');
    expect(screen.getByTestId('agent-v2-skills-hash').textContent).toContain('—');
    expect(screen.getByTestId('agent-v2-skills-scope').textContent).toContain('—');
    const refs = screen.getByTestId('agent-v2-skills-refs');
    expect(refs.textContent).toContain('—');
    expect(refs.textContent).not.toContain('暂无引用');
    expect(bare.textContent).not.toContain('0 位');
    guardNoRawKeys();
  });

  it('keeps zero write entry points; copy is local and never refetches', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    skillsBody = { items: [ROW_SHARED, ROW_EXCLUSIVE] };
    renderPage();
    await screen.findAllByTestId('agent-v2-skills-row');

    expect(document.querySelectorAll('form, input, textarea, select')).toHaveLength(0);
    expect(document.querySelector('[data-testid*="create"]')).toBeNull();
    expect(document.querySelector('[data-testid*="delete"]')).toBeNull();
    expect(document.querySelector('[data-testid*="upload"]')).toBeNull();
    expect(document.querySelector('[data-testid*="save"]')).toBeNull();

    const copy = screen.getAllByTestId('agent-v2-skills-hash-copy')[0];
    const before = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;
    fireEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith(FULL_HASH_A);
    await waitFor(() => expect(copy.textContent).toBe('已复制'));
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(before);
    guardNoRawKeys();
  });

  it('keeps the table inside its card at 375 with a scroll hint and no page-level overflow', async () => {
    Object.defineProperty(window, 'innerWidth', { value: 375, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 812, configurable: true });
    skillsBody = NORMAL_BODY;
    renderPage();
    await screen.findAllByTestId('agent-v2-skills-row');

    // the sideways scroll lives on the table wrapper, not on the page
    expect(document.querySelector('.a2-table-scroll')).toBeTruthy();
    expect(screen.getByTestId('agent-v2-skills-scrollhint')).toBeTruthy();
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(375);
    // no inline fixed width may exceed the viewport
    document.querySelectorAll('[style]').forEach((el) => {
      const style = el.getAttribute('style') ?? '';
      const widths = [...style.matchAll(/width:\s*(\d+)px/g)].map((m) => Number(m[1]));
      widths.forEach((w) => expect(w).toBeLessThanOrEqual(375));
    });

    // the responsive rules that make the card stack actually exist
    const css = readFileSync(path.resolve(process.cwd(), 'src/pages/AgentConsoleV2/skills.css'), 'utf8');
    expect(css).toContain('@media (max-width: 767px)');
    expect(css).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toContain('min-width: 0');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).toContain('.skl-copy');
    expect(css).toMatch(/\.skl-copy\s*\{[^}]*white-space:\s*nowrap/);
    guardNoRawKeys();
  });
});