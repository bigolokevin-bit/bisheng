/* eslint-disable no-restricted-syntax -- fixtures mirror the A7/hermes payload shapes; assertions pin the real zh-Hans copy */
/**
 * SET-01 `/agent/settings` — read-only system settings on the frozen C1
 * baseline (set01-target.html + SET01-TARGET-SPEC.md).
 *
 * Covers the automatable SET01-E keys: the page-level read-only banner with its
 * third state (未知) and HelpTip, six groups with aria-labelled status dots and
 * no primary action, the write switches all neutral-unknown (E08), the reused
 * A7 panel (E05), the danger group's zero clickable danger controls (E03), the
 * rules-vs-reading source chips (E04), the degraded `—` that never becomes 0
 * (E06), the four group states (loading / HTTP 502 error bar / 403 / 404), and
 * the sanitized projection (no env literal, no token, no tenant id — E09).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const t = (key: unknown, opts?: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
        dict,
      );
    let text = typeof value === 'string' ? value : String(key);
    if (opts && typeof opts === 'object') {
      for (const [k, v] of Object.entries(opts as Record<string, unknown>)) {
        text = text.split(`{{${k}}}`).join(String(v));
      }
    }
    return text;
  };
  return { useTranslation: () => ({ t, i18n: { language: 'zh-Hans' } }) };
});

import type { AgentConsoleHermesApi, HermesSummary } from '@/controllers/API/agentConsoleHermes';
import type { AuditApi } from '../aud01';
import type { SectionId } from '../set01';
import { SettingsPage } from '../SettingsPage';

// ---------------------------------------------------------------- fixtures

const NOW = Date.parse('2026-11-17T10:20:41+08:00');

function okSummary(requests: number | null = 1284): HermesSummary {
  return {
    schema: 'runtime.hermes.summary.v1',
    sources: {
      gateway_health: { state: 'ok' },
      dashboard_system: { state: 'ok' },
    },
    gateway: {
      status: 'running',
      platform: 'feishu',
      version: '1.0.0',
      gateway_state: 'ok',
      active_agents: 2,
      gateway_busy: false,
      gateway_drainable: true,
      updated_at: '2026-11-17T02:20:00Z',
      platforms: {},
      metrics_today: {
        day: '2026-11-17',
        requests,
        messages: 96,
        tokens: 40,
        latency_p95_ms: 820,
      },
      note: '',
    },
    system: {
      hermes_version: null,
      cpu_count: null,
      cpu_percent: null,
      load_avg: null,
      uptime_seconds: null,
      memory: { total: null, available: null, used: null, percent: null },
      disk: { total: null, used: null, free: null, percent: null },
      process: { rss: null, num_threads: null },
      psutil: null,
    },
    sessions_stats: { total: null, active_store: null, archived: null, messages: null, by_source: {} },
  } as HermesSummary;
}

function makeHermes(result: {
  ok: boolean;
  status: number;
  data?: HermesSummary | null;
}): AgentConsoleHermesApi {
  return {
    getSummary: vi.fn().mockResolvedValue({
      ok: result.ok,
      status: result.status,
      data: result.data ?? null,
    }),
    getUsage: vi.fn(),
  } as unknown as AgentConsoleHermesApi;
}

function makeAudit(status = 200, requestId = 'req-7f3a-c1'): AuditApi {
  return {
    listAudit: vi.fn(),
    verifyAudit: vi
      .fn()
      .mockResolvedValue(
        status === 200
          ? {
              ok: true,
              status: 200,
              requestId,
              data: { ok: true, complete: true, scanned: 0 },
            }
          : { ok: false, status, data: null, code: 'agent.http.' + status, requestId },
      ),
  } as unknown as AuditApi;
}

function renderPage(
  section: SectionId,
  opts: { audit?: AuditApi; hermes?: AgentConsoleHermesApi } = {},
) {
  return render(
    <MemoryRouter initialEntries={[`/agent/settings/${section}`]}>
      <Routes>
        <Route
          path="/agent/settings/:section"
          element={
            <SettingsPage
              sectionOverride={section}
              auditApi={opts.audit ?? makeAudit()}
              hermesApi={opts.hermes ?? makeHermes({ ok: true, status: 200, data: okSummary() })}
              nowOverride={NOW}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

const DANGER_VERB =
  /保存|重置|提交|编辑|删除|新建|创建|批准|驳回|应用回|还原|回滚|清空|轮换|停用|归档|执行|确定|确认/;

/** Every element that could be clicked to run something. */
function clickable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button,a[href],[role="button"],input,select,textarea'));
}

// ---------------------------------------------------------------- E01/E02

describe('SET-01 page frame', () => {
  it('renders the meta row, the third-state read-only banner with HelpTip and the footer', async () => {
    renderPage('tenant');
    await screen.findByTestId('agent-v2-set-writes');

    const fresh = screen.getByTestId('agent-v2-set-fresh');
    expect(fresh.textContent).toContain('读于');
    expect(fresh.textContent).toContain('10:20:41');
    expect(fresh.textContent).not.toMatch(/\/api\/|HTTP|数据源/);

    const ro = document.querySelector('.s1roband') as HTMLElement;
    expect(ro.textContent).toContain('写入开关状态未知（本次未能读取）');
    expect(ro.textContent).toContain('未知'); // the third state, not on/off
    expect(ro.textContent).not.toMatch(/sanitized|GAP-|CR-M2/);
    // HelpTip carries the "未知不是关" caliber
    expect(within(ro).getByTestId('agent-v2-set-ro-help')).toBeTruthy();

    expect(screen.getByRole('heading', { level: 1 }).textContent).toContain('设置');
  });

  it('keeps the head free of a primary action and lists six groups with labelled dots', async () => {
    renderPage('tenant');
    await screen.findByTestId('agent-v2-set-writes');

    const head = document.querySelector('.phead') as HTMLElement;
    expect(clickable(head)).toHaveLength(0);

    const nav = screen.getByRole('navigation', { name: '设置分组' });
    const items = within(nav).getAllByRole('link');
    expect(items.map((a) => a.textContent?.replace(/状态：.*$/, '').trim())).toEqual([
      '租户与安全',
      '模型与渠道',
      '策略与预算',
      '通知与集成',
      '数据与保留',
      '危险操作',
    ]);
    // status is never colour-only: each dot names itself
    const dots = nav.querySelectorAll('[role="img"]');
    expect(dots).toHaveLength(6);
    dots.forEach((d) => expect(d.getAttribute('aria-label')).toBeTruthy());
  });
});

// ---------------------------------------------------------------- E08

describe('SET-01 write switches', () => {
  it('renders all four switches as neutral unknown, never as on/off', async () => {
    renderPage('tenant');
    const card = await screen.findByTestId('agent-v2-set-writes');

    const pills = card.querySelectorAll('[data-unknown="true"]');
    expect(pills).toHaveLength(4);
    pills.forEach((pill) => {
      expect(pill.textContent).toBe('未知');
      expect(pill.className).toContain('nt');
      expect(pill.className).not.toContain('ok');
      expect(pill.className).not.toContain('dg');
    });
    // no pill on the card claims an on/off verdict
    expect(card.querySelectorAll('.pill.ok, .pill.dg')).toHaveLength(0);
    // the internal token never shows a value/length/hash
    expect(card.textContent).not.toMatch(/sk-|token=|sha256/);
  });
});

// ---------------------------------------------------------------- E05

describe('SET-01 chain panel', () => {
  it('mounts the AUD-01 A7 component with S0 neutral when scanned=0', async () => {
    renderPage('tenant');
    const panel = await screen.findByTestId('aud01-verify');
    expect(panel.textContent).toContain('完整性链校验');
    expect(panel.textContent).toContain('A7');

    // the window row points at the audit centre instead of running the check
    const goto = within(panel).getByTestId('aud01-verify-goto-audit');
    expect(goto.getAttribute('href')).toBe('/agent/audit');
    expect(goto.textContent).toContain('去审计中心');
    expect(within(panel).queryByTestId('aud01-verify-run')).toBeNull();
    // the window seg stays and still applies itself (no dead control)
    const seg = within(panel).getByTestId('aud01-vw-7d');
    expect(seg.getAttribute('aria-pressed')).toBe('false');
    await userEvent.click(seg);
    expect((await screen.findByTestId('aud01-vw-7d')).getAttribute('aria-pressed')).toBe('true');

    // scanned=0 with no anchor is S0 — neutral, never green
    const s0 = await screen.findByTestId('aud01-verify-s0');
    expect(s0.textContent).toContain('尚无锚点');
    expect(s0.className).toContain('s0');
    // no green verdict anywhere in the panel (scanned=0 is not "passed")
    expect(panel.querySelector('.cv.s1')).toBeNull();
  });
});

// ---------------------------------------------------------------- E03

describe('SET-01 danger group', () => {
  it('discloses the five irreversible actions with zero clickable danger control', async () => {
    renderPage('danger');
    const card = await screen.findByTestId('agent-v2-set-danger');

    expect(card.textContent).toContain('停用租户');
    expect(card.textContent).toContain('归档员工');
    expect(card.textContent).toContain('轮换凭据');
    expect(card.textContent).toContain('关闭审计');
    expect(card.textContent).toContain('重置模型');

    const dangerClickables = clickable(card).filter((el) =>
      DANGER_VERB.test(el.textContent ?? ''),
    );
    expect(dangerClickables).toHaveLength(0);
    expect(card.querySelectorAll('button,input,select,textarea')).toHaveLength(0);
    // the only links are real destinations, not fake actions
    const links = within(card).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/agent/employees',
      '/model/management',
    ]);
    // in-product link stays in-product; the Bisheng surface opens in a new tab
    // and carries the visible ↗ marker (reference i-ext)
    const employeeLink = within(card).getByTestId('agent-v2-set-danger-link-employeeArchive');
    expect(employeeLink.getAttribute('target')).toBeNull();
    expect(employeeLink.querySelector('svg')).toBeNull();
    const modelLink = within(card).getByTestId('agent-v2-set-danger-link-modelReset');
    expect(modelLink.getAttribute('target')).toBe('_blank');
    expect(modelLink.getAttribute('rel')).toBe('noopener');
    expect(modelLink.querySelector('svg')).not.toBeNull();
  });

  it('states the boundary before the list', async () => {
    renderPage('danger');
    await screen.findByTestId('agent-v2-set-danger');
    const banner = screen.getByRole('note', { name: '危险操作边界' });
    expect(banner.textContent).toContain('本页不提供任何危险操作入口');
  });
});

// ---------------------------------------------------------------- E04 / E06

describe('SET-01 rules vs readings', () => {
  it('shows retention constants without contract tags, and nothing invented', async () => {
    renderPage('data');
    const card = await screen.findByTestId('agent-v2-set-data');
    expect(card.textContent).not.toMatch(/来源=|GAP-|AUDIT/);
    expect(card.textContent).toContain('90');
    expect(card.textContent).toContain('不可删除');
    // no build-time aggregate, no fake runtime reading
    expect(card.textContent).not.toMatch(/共\s*\d+\s*条|总计/);
  });

  it('keeps a degraded usage reading as — and never rewrites it to 0', async () => {
    renderPage('models', {
      hermes: makeHermes({ ok: true, status: 200, data: okSummary(null) }),
    });
    const card = await screen.findByTestId('agent-v2-set-runtime');
    const field = within(card).getByTestId('agent-v2-set-f-requests');
    expect(field.textContent).toContain('上游降级');
    const value = field.querySelector('.a2r-fv') as HTMLElement;
    expect(value.textContent).toContain('—');
    expect(value.textContent).not.toMatch(/\d/);
  });

  it('never claims Feishu is connected from a user-info 200', async () => {
    renderPage('integrations');
    const card = await screen.findByTestId('agent-v2-set-upstream');
    const feishu = within(card).getByTestId('agent-v2-set-f-feishu');
    expect(feishu.textContent).toContain('未接入');
    expect(feishu.textContent).not.toContain('正常');
  });
});

// ---------------------------------------------------------------- E10

describe('SET-01 group states', () => {
  it('shows a skeleton with no pills, ids or times while the read is pending', async () => {
    const pending = {
      getSummary: vi.fn().mockReturnValue(new Promise(() => undefined)),
      getUsage: vi.fn(),
    } as unknown as AgentConsoleHermesApi;
    renderPage('models', { hermes: pending });

    const skeleton = await screen.findByTestId('agent-v2-set-models-loading');
    expect(skeleton.getAttribute('aria-label')).toBe('设置分组加载中');
    // a skeleton must never look like a reading
    expect(skeleton.textContent).not.toMatch(/未知|正常|HTTP|\d{2}:\d{2}/);
    // navigation survives while a group is loading
    expect(screen.getByRole('navigation', { name: '设置分组' })).toBeTruthy();
  });

  it('keeps a failed group inside its own card, with a human reason, request id and retry', async () => {
    renderPage('models', { hermes: makeHermes({ ok: false, status: 502 }) });
    const bar = await screen.findByTestId('agent-v2-set-models-error');
    expect(bar.textContent).toContain('查询失败，请重试');
    expect(bar.textContent).toContain('请求编号');
    expect(bar.textContent).not.toContain('HTTP');
    expect(within(bar).getByTestId('agent-v2-set-models-retry')).toBeTruthy();
    // navigation survives a single group failure
    expect(screen.getByRole('navigation', { name: '设置分组' })).toBeTruthy();
  });

  it('replaces the whole group on 403 instead of rendering field skeletons', async () => {
    renderPage('tenant', { audit: makeAudit(403) });
    const stage = await screen.findByTestId('agent-v2-set-tenant-forbidden');
    expect(stage.textContent).toContain('你没有查看此组设置的权限');
    expect(stage.textContent).not.toContain('HTTP');
    expect(stage.textContent).toContain('请求编号');
    expect(screen.queryByTestId('agent-v2-set-writes')).toBeNull();
    expect(screen.queryByTestId('agent-v2-set-identity')).toBeNull();
  });

  it('renders the 404 negative with the same body and only the code differing', async () => {
    renderPage('tenant', { audit: makeAudit(404) });
    const stage = await screen.findByTestId('agent-v2-set-tenant-unsupported');
    expect(stage.textContent).toContain('这项自检能力尚未提供');
    expect(stage.textContent).not.toContain('HTTP');
    expect(stage.textContent).not.toContain('CR-M2-02');
    expect(stage.textContent).toContain('请求编号');
    expect(screen.queryByTestId('agent-v2-set-identity')).toBeNull();
  });
});

// ---------------------------------------------------------------- E03 / E12 (whole page)

describe('SET-01 zero write entry, every group', () => {
  const sections: SectionId[] = ['tenant', 'models', 'policy', 'integrations', 'data', 'danger'];

  it.each(sections)('renders no clickable control whose text is a write verb (%s)', async (section) => {
    renderPage(section);
    const page = await screen.findByTestId('agent-v2-settings');
    // wait for the group body (one stable hook per group)
    const hook: Record<SectionId, string> = {
      tenant: 'agent-v2-set-writes',
      models: 'agent-v2-set-runtime',
      policy: 'agent-v2-set-policy',
      integrations: 'agent-v2-set-upstream',
      data: 'agent-v2-set-data',
      danger: 'agent-v2-set-danger',
    };
    await screen.findByTestId(hook[section]);
    const offenders = clickable(page)
      .filter((el) => DANGER_VERB.test(el.textContent ?? ''))
      .map((el) => `${el.tagName}:${(el.textContent ?? '').trim()}`);
    expect(offenders).toEqual([]);
    // and no form control at all, not even a disabled one
    expect(page.querySelectorAll('input,select,textarea')).toHaveLength(0);
  });
});

// ---------------------------------------------------------------- E09

describe('SET-01 sanitized projection', () => {
  it('puts no tenant id, env literal or token on screen', async () => {
    renderPage('tenant');
    await screen.findByTestId('agent-v2-set-identity');
    const page = screen.getByTestId('agent-v2-settings');
    const text = page.textContent ?? '';
    expect(text).toContain('不在本页上屏');
    expect(text).not.toMatch(/t_seakoi|tenant_id|CONSOLE_[A-Z_]+=|sk-[a-z0-9]{8}/i);
  });
});