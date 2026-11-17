/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * GAP-2 (Wave 1): the employee-detail budget paragraph must never fabricate a
 * numeric limit. An unset `dailyTokens` / `monthlyCostUsd` / `perRunMaxUsd`
 * used to be coerced with `?? 0`, so a version that configures nothing read
 * 「日 token 额度 0 · 月度成本上限 USD 0.00 · 单次上限 USD 0.00」. It now reads
 * 「未配置」 per missing field, and one honest line when the version sets no
 * budget at all.
 *
 * The i18n mock resolves the real zh-Hans resources (so the wording itself is
 * under test) and interpolates `{{value}}` from the options argument.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const t = (key: unknown, opts?: unknown): string => {
    const raw = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        dict
      );
    if (typeof raw !== 'string') {
      const def = opts as { defaultValue?: unknown } | undefined;
      if (def && typeof def.defaultValue === 'string') return def.defaultValue;
      return String(key);
    }
    if (!opts || typeof opts !== 'object') return raw;
    const vars = opts as Record<string, unknown>;
    return raw.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
      name in vars ? String(vars[name]) : whole
    );
  };
  return {
    useTranslation: () => ({
      t,
      i18n: { changeLanguage: vi.fn(), language: 'zh-Hans' },
    }),
  };
});

import { EmployeeDetailPage } from '../EmployeeDetailPage';

const EMP = 'emp_budget_1';
const VER = 'ver_budget_1';

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'X-Console-Request-Id': 'req_test_budget' }),
    json: async () => body,
  };
}

let versionBudget: Record<string, unknown>;

function routeRequest(url: string) {
  if (url.includes('/api/employee-versions')) {
    return jsonResponse(200, {
      items: [
        {
          id: VER,
          employeeId: EMP,
          versionNo: 2,
          budget: versionBudget,
          knowledgeScopes: [],
          changeNote: '',
          effectiveFrom: '2026-11-15T00:00:00Z',
        },
      ],
    });
  }
  if (url.includes('/api/employee?') || url.endsWith('/api/employee')) {
    return jsonResponse(200, {
      id: EMP,
      name: 'Budget Bee',
      title: 'assistant',
      lifecycleState: 'active',
      currentVersionId: VER,
      ownerUserId: 'opsadmin',
      updatedAt: '2026-11-15T00:00:00Z',
    });
  }
  if (url.includes('/api/effective-config')) {
    return jsonResponse(200, { grants: [] });
  }
  if (url.includes('/api/budget-usage')) {
    return jsonResponse(200, { items: [], missingEmployeeIds: [EMP] });
  }
  if (url.includes('/api/run-stats')) {
    return jsonResponse(200, { buckets: [] });
  }
  if (url.includes('/api/workstations')) {
    return jsonResponse(200, { items: [] });
  }
  if (url.includes('/api/approval-stats')) {
    return jsonResponse(200, { pending: 0, dueSoon: 0 });
  }
  if (url.includes('/api/tasks') || url.includes('/api/runs') || url.includes('/api/audit')) {
    return jsonResponse(200, { items: [] });
  }
  return jsonResponse(200, {});
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={[`/agent/employees/${EMP}`]}>
      <Routes>
        <Route path="/agent/employees/:id" element={<EmployeeDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

const budgetRowText = async () =>
  (await screen.findByTestId('agent-v2-ed-budget-row')).textContent ?? '';

beforeEach(() => {
  versionBudget = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => routeRequest(String(input)))
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('EmployeeDetailPage budget limits (GAP-2 honest empty state)', () => {
  it('a version that sets no budget reads one honest line, never 0 / USD 0.00', async () => {
    versionBudget = {};
    renderDetail();
    const text = await budgetRowText();
    expect(text.trim()).toBe('本版本未配置预算');
    expect(text).not.toContain('USD 0.00');
    expect(text).not.toContain('token 额度 0');
  });

  it('only the configured limits print; the unset ones say 未配置', async () => {
    versionBudget = { monthlyCostUsd: 10 };
    renderDetail();
    const text = await budgetRowText();
    expect(text).toContain('日 token 额度 未配置');
    expect(text).toContain('月度成本上限 USD 10.00');
    expect(text).toContain('单次上限 未配置');
    expect(text).not.toContain('USD 0.00');
  });

  it('a fully configured version prints all three limits', async () => {
    versionBudget = { dailyTokens: 100000, monthlyCostUsd: 10, perRunMaxUsd: 0.5 };
    renderDetail();
    const text = await budgetRowText();
    expect(text).toContain('日 token 额度 100000');
    expect(text).toContain('月度成本上限 USD 10.00');
    expect(text).toContain('单次上限 USD 0.50');
    expect(text).not.toContain('未配置');
  });

  it('a configured zero is still a real zero, not 未配置', async () => {
    versionBudget = { dailyTokens: 0, monthlyCostUsd: 0, perRunMaxUsd: 0 };
    renderDetail();
    const text = await budgetRowText();
    expect(text).toContain('日 token 额度 0');
    expect(text).toContain('月度成本上限 USD 0.00');
    expect(text).toContain('单次上限 USD 0.00');
    expect(text).not.toContain('未配置');
  });

  it('no current version keeps the plain dash instead of inventing a budget', async () => {
    versionBudget = { monthlyCostUsd: 10 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/employee-versions')) return jsonResponse(200, { items: [] });
        return routeRequest(url);
      })
    );
    renderDetail();
    expect((await budgetRowText()).trim()).toBe('—');
  });
});