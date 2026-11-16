/**
 * P1 batch2 help wiring: the governance terms are explained where a reader
 * meets them, and the three locale bundles stay in step.
 *
 * Two kinds of guard live here:
 * - behaviour: hover opens the tip (the one interaction HelpTip.test.tsx does
 *   not cover), so the mouse path cannot regress silently;
 * - wiring: each page's HelpTip call is asserted by reading the page source.
 *   These are deliberately source-level: rendering a full page only to find one
 *   inline tip would couple this guard to every fetch adapter, while the thing
 *   that actually regresses is "someone deleted the tip from the label".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const t = (key: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
        dict,
      );
    return typeof value === 'string' ? value : String(key);
  };
  return { useTranslation: () => ({ t }) };
});

import { HelpTip, HELPTIP_TESTID } from '../HelpTip';
import { HELP_TERMS } from '../helpTips';

/* vitest root is src/frontend/platform, so resolve from there — `import.meta.url`
 * is rewritten by the test transform and is not a real file path. */
const root = process.cwd();
const page = (file: string) => readFileSync(join(root, 'src/pages/AgentConsoleV2', file), 'utf8');

const locale = (loc: string) =>
  JSON.parse(
    readFileSync(join(root, 'public/locales', loc, 'bs.json'), 'utf8'),
  ) as Record<string, Record<string, Record<string, Record<string, { title: string; body: string }>>>>;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HelpTip — hover path', () => {
  it('hovering the anchor opens the tooltip, leaving closes it', () => {
    render(<HelpTip term="targetHash" />);
    const btn = screen.getByTestId(HELPTIP_TESTID);
    const anchor = btn.parentElement as HTMLElement;
    fireEvent.mouseEnter(anchor);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseLeave(anchor);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('a click after hover stays open (hover and click do not cancel each other)', () => {
    render(<HelpTip term="messageDigest" />);
    const btn = screen.getByTestId(HELPTIP_TESTID);
    fireEvent.mouseEnter(btn.parentElement as HTMLElement);
    fireEvent.click(btn);
    fireEvent.mouseLeave(btn.parentElement as HTMLElement);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
  });
});

describe('help wiring — APR-02 / MET-01 / EMP-01 / TSK-01', () => {
  it('APR-02 explains targetHash and messageDigest on the binding card', () => {
    const src = page('ApprovalDetailPage.tsx');
    expect(src).toMatch(/term="targetHash"/);
    expect(src).toMatch(/term="messageDigest"/);
    // the tips ride on the Field labels, not on a detached footnote
    expect(src).toMatch(/help=\{<HelpTip term="targetHash"/);
    expect(src).toMatch(/help=\{<HelpTip term="messageDigest"/);
  });

  it('MET-01 explains bucketSum and pendingKpi', () => {
    const src = page('MetricsPage.tsx');
    expect(src).toMatch(/term="bucketSum"/);
    expect(src).toMatch(/term="pendingKpi"/);
    // footer caliber keeps its 「口径」 explanation
    expect(src).toMatch(/term="caliber"/);
  });

  it('MET-01 pendingKpi popover can paint over the block below it (stacking guard)', () => {
    const css = page('agentConsoleV2.css');
    // `.met-page > *` pins every MET block to z-index:0 — each becomes its own
    // stacking context, so the fixed popover (z-index 60) inside the fresh row
    // was trapped under the following calib panel/cards: only the popover's top
    // border showed (an empty rounded shell). The fresh row must sit above them.
    const fresh = /\.agent-app \.met-fresh \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(fresh).toMatch(/position:\s*relative/);
    const z = /z-index:\s*([1-9]\d*)/.exec(fresh)?.[1];
    expect(z).toBeTruthy();
    expect(Number(z)).toBeGreaterThan(0);
    // scoped: no other MET block or tip anchor is re-layered by this guard
    expect(css).not.toMatch(/\.agent-app \.met-(?:calib|pfoot|a0) \{[^}]*z-index/);
  });

  it('EMP-01 / TSK-01 explain the human: owner ref and the source column', () => {
    expect(page('EmployeesListPage.tsx')).toMatch(/term="humanPrefix"/);
    expect(page('EmployeeDetailPage.tsx')).toMatch(/term="humanPrefix"/);
    const tsk = page('TasksListPage.tsx');
    expect(tsk).toMatch(/term="humanPrefix"/);
    expect(tsk).toMatch(/term="sourceEnum"/);
    expect(tsk).toMatch(/term="caliber"/);
  });

  it('tips never introduce a write path or an internal error code', () => {
    for (const file of ['ApprovalDetailPage.tsx', 'MetricsPage.tsx', 'TasksListPage.tsx']) {
      const src = page(file);
      // HelpTip is presentation-only: no fetch/mutation call is passed to it
      expect(src).not.toMatch(/<HelpTip[^>]*(onClick|onSave|fetch)/);
    }
  });
});

describe('help copy — three locales', () => {
  it.each(['zh-Hans', 'en-US', 'ja'])('%s has a title and body for every term', (loc) => {
    const help = locale(loc).agentConsole.v2.help;
    expect(Object.keys(help).sort()).toEqual([...HELP_TERMS].sort());
    for (const term of HELP_TERMS) {
      expect(typeof help[term].title).toBe('string');
      expect(typeof help[term].body).toBe('string');
      expect(help[term].title.length).toBeGreaterThan(0);
      expect(help[term].body.length).toBeGreaterThan(0);
      // no key path leaked into copy
      expect(help[term].body).not.toContain('agentConsole.v2');
    }
  });

  it('zh copy stays factual: no invented thresholds or amounts', () => {
    const help = locale('zh-Hans').agentConsole.v2.help;
    for (const term of HELP_TERMS) {
      expect(help[term].body).not.toMatch(/\d+\s*(元|美元|秒|天|次\/|%)/);
    }
  });
});