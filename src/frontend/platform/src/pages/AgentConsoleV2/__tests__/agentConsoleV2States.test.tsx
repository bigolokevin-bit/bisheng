/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * A2/A3 guardrail with the real zh-Hans resources resolved through a mocked
 * react-i18next: lifecycle states render localized labels (在岗, not raw
 * `active`/raw keys) and the trend KPI keeps exactly one 待接入 occurrence.
 */
import { describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach } from 'vitest';

vi.mock('@/components/bs-ui/message', () => ({
  default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const t = (key: unknown, def?: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object'
            ? (acc as Record<string, unknown>)[part]
            : undefined,
        dict,
      );
    if (typeof value === 'string') return value;
    if (typeof def === 'string') return def;
    if (def && typeof def === 'object' && 'defaultValue' in def) {
      return String((def as Record<string, unknown>).defaultValue);
    }
    return String(key);
  };
  return { useTranslation: () => ({ t }) };
});

import { AgentConsoleV2Page } from '../AgentConsoleV2Page';
import { userContext } from '@/contexts/userContext';

const EMP = {
  id: 'emp_1',
  tenantId: 't',
  name: 'Koi Claw',
  title: 'assistant',
  lifecycleState: 'active',
  currentVersionId: 'ver_1',
  ownerUserId: 'opsadmin',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-11-13T00:00:00Z',
};

const consoleApi = {
  listEmployees: vi.fn().mockResolvedValue({ items: [EMP] }),
  countPendingApprovals: vi.fn().mockResolvedValue({ ok: true, data: { count: 1 } }),
  getEmployee: vi.fn().mockResolvedValue({ ok: true, data: EMP }),
  getEffectiveConfig: vi.fn().mockResolvedValue({ ok: true, data: { employee: EMP, grants: [] } }),
} as never;

const approvalsApi = {
  listApprovals: vi.fn().mockResolvedValue({ ok: true, data: { items: [] } }),
  getApproval: vi.fn().mockResolvedValue({ ok: false, status: 404, data: null, code: 'x' }),
} as never;

afterEach(() => {
  cleanup();
});

function renderV2() {
  return render(
    <userContext.Provider
      value={{ user: { user_id: 1, web_menu: ['admin', 'agent'] }, setUser: vi.fn(), savedComponents: [], addSavedComponent: vi.fn(), checkComponentsName: vi.fn(), delComponent: vi.fn() } as never}
    >
      <AgentConsoleV2Page consoleApi={consoleApi} approvalsApi={approvalsApi} />
    </userContext.Provider>,
  );
}

describe('console v2 localized states and trend KPI', () => {
  it('renders active as 在岗 instead of the raw English state', async () => {
    renderV2();
    await screen.findByText('Koi Claw');
    expect(screen.getByText('在岗')).toBeTruthy();
    expect(screen.queryByText('active')).toBeNull();
    expect(screen.queryByText(/agentConsole\./)).toBeNull();
  });

  it('trend KPI keeps one label and one pending note, no fake curve', async () => {
    renderV2();
    await screen.findByText('Koi Claw');
    expect(screen.getAllByText('趋势')).toHaveLength(1);
    expect(screen.getByTestId('agent-v2-trend-pending').textContent).toBe(
      '趋势数据待接入',
    );
    await waitFor(() =>
      expect(
        document.querySelectorAll('.a2-kpi-num')[1].textContent,
      ).toBe('1'),
    );
  });
});
