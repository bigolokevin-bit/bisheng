/**
 * Shell nav integration (2026-11-17) — the three late-landing pages
 * (/agent/collab, /agent/chat, /agent/skills) must be reachable from the rail
 * and must title themselves in the breadcrumb instead of falling back to
 * 「总览」.
 *
 * Contract guarded here:
 *  ① L1_ENTRIES lists all 11 first-level sections, in order, with settings
 *     still pinned at the bottom;
 *  ② every entry resolves to a real shape in the inline SVG symbol set — the
 *     C1 audit forbids Unicode/emoji glyphs in the rail, and an unknown icon
 *     key would render an empty <svg>;
 *  ③ the three new paths activate their own rail entry and render their own
 *     breadcrumb label (agentConsole.v2.nav*), with no extra state machine.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// The Shell builds its api bundle from these factories; stub them so mount
// never reaches for localStorage tokens or fetch.
vi.mock('@/controllers/API/agent', () => ({
  createHttpAgentConsoleApi: () => ({}),
}));
vi.mock('@/controllers/API/agentConsoleHermes', () => ({
  createHttpAgentConsoleHermesApi: () => ({}),
}));
vi.mock('@/controllers/API/agentConsoleRuns', () => ({
  createHttpAgentConsoleRunsApi: () => ({}),
}));
vi.mock('@/controllers/API/agentConsoleTrends', () => ({
  createHttpAgentConsoleTrendsApi: () => ({}),
}));

import { AgentConsoleShell, L1_ENTRIES } from '../Shell';

const stub = (testid: string) => <div data-testid={testid} />;

function renderShell(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/agent" element={<AgentConsoleShell />}>
          <Route index element={stub('page-overview')} />
          <Route path="employees" element={stub('page-employees')} />
          <Route path="approvals" element={stub('page-approvals')} />
          <Route path="tasks" element={stub('page-tasks')} />
          <Route path="collab" element={stub('page-collab')} />
          <Route path="runs" element={stub('page-runs')} />
          <Route path="chat" element={stub('page-chat')} />
          <Route path="metrics" element={stub('page-metrics')} />
          <Route path="audit" element={stub('page-audit')} />
          <Route path="skills" element={stub('page-skills')} />
          <Route path="settings" element={stub('page-settings')} />
          <Route path="*" element={stub('page-404')} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('rail entries and breadcrumbs for collab / chat / skills', () => {
  it('lists 11 L1 entries in section order with settings pinned last', () => {
    expect(L1_ENTRIES.map((e) => e.path)).toEqual([
      '',
      'employees',
      'approvals',
      'tasks',
      'collab',
      'runs',
      'chat',
      'metrics',
      'audit',
      'skills',
      'settings',
    ]);
    // collab rides next to tasks, chat next to runs, skills next to audit
    const paths = L1_ENTRIES.map((e) => e.path);
    expect(paths.indexOf('collab')).toBe(paths.indexOf('tasks') + 1);
    expect(paths.indexOf('chat')).toBe(paths.indexOf('runs') + 1);
    expect(paths.indexOf('skills')).toBe(paths.indexOf('audit') + 1);
    // the bottom-pinned slot stays a single settings entry, never in the
    // scrollable middle
    const bottom = L1_ENTRIES.filter((e) => e.bottom);
    expect(bottom).toHaveLength(1);
    expect(bottom[0].path).toBe('settings');
  });

  it('every entry names a nav* key and resolves to a drawn SVG shape', () => {
    renderShell('/agent');
    for (const e of L1_ENTRIES) {
      expect(e.key).toMatch(/^nav[A-Z]/);
      const link = screen.getByLabelText(`agentConsole.v2.${e.key}`);
      const shapes = link.querySelectorAll('svg > *');
      // an icon key missing from the symbol set renders an empty <svg>: that
      // is how a Unicode/emoji fallback would sneak back into the rail
      expect(shapes.length).toBeGreaterThan(0);
      // the only text in a rail entry is its localized label (mocked to the
      // key itself) — no glyph characters alongside it
      expect(link.textContent).toBe(`agentConsole.v2.${e.key}`);
    }
  });

  it.each([
    ['collab', 'navCollab', 'page-collab'],
    ['chat', 'navChat', 'page-chat'],
    ['skills', 'navSkills', 'page-skills'],
  ])('/agent/%s activates its own rail entry and crumbs as %s', (path, key, testid) => {
    renderShell(`/agent/${path}`);
    expect(screen.getByTestId(testid)).toBeInTheDocument();
    expect(screen.getByLabelText(`agentConsole.v2.${key}`)).toHaveClass('is-active');
    const crumb = screen.getByLabelText('breadcrumb');
    // two segments only: the shell title + this section — never 「总览」
    expect(crumb.textContent).toBe(`agentConsole.v2.titleagentConsole.v2.${key}`);
    expect(crumb.textContent).not.toContain('navOverview');
  });
});
