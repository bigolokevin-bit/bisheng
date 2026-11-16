/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * Shared HelpTip (P1 batch2) — interaction + accessibility + 375 clamping.
 *
 * The copy is resolved from the REAL zh-Hans bundle (same idiom as
 * OverviewErrors/ApprovalsList), so a missing key would surface as a dotted
 * path and fail the "no raw key" guard instead of silently rendering nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

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

import { HelpTip } from '../HelpTip';
import { HELP_TERMS } from '../helpTips';

function rect(width: number, height: number, left: number, top: number): DOMRect {
  return {
    width,
    height,
    left,
    top,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 375 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 812 });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('HelpTip — term registry', () => {
  it('every registered term has a zh title and body (no bare key can render)', () => {
    expect(HELP_TERMS.length).toBeGreaterThanOrEqual(7);
    render(
      <div>
        {HELP_TERMS.map((term) => (
          <HelpTip key={term} term={term} testId={`ht-${term}`} />
        ))}
      </div>,
    );
    for (const term of HELP_TERMS) {
      const btn = screen.getByTestId(`ht-${term}`);
      expect(btn.getAttribute('aria-label')).toBeTruthy();
      expect(btn.getAttribute('aria-label')).not.toContain('agentConsole.v2.help');
    }
  });
});

describe('HelpTip — open / close / keyboard', () => {
  it('is a visible ? button with aria-label and no popover until opened', () => {
    render(<HelpTip term="targetHash" testId="ht" />);
    const btn = screen.getByTestId('ht');
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('?');
    expect(btn.getAttribute('aria-label')).toContain('targetHash');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('click opens a real tooltip: role, describedby → id, title + body copy', () => {
    render(<HelpTip term="bucketSum" testId="ht" />);
    const btn = screen.getByTestId('ht');
    fireEvent.click(btn);
    const pop = screen.getByRole('tooltip');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.getAttribute('aria-describedby')).toBe(pop.id);
    expect(pop.textContent).toContain('bucketSum');
    expect(pop.textContent).toContain('服务端已经按日或按小时聚合好的桶相加');
    // no dotted i18n path leaks into the UI
    expect(pop.textContent).not.toContain('agentConsole.v2.help');
    // second click closes
    fireEvent.click(btn);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('keyboard focus opens; Escape closes and keeps focus on the button', () => {
    render(<HelpTip term="humanPrefix" testId="ht" />);
    const btn = screen.getByTestId('ht');
    act(() => btn.focus());
    expect(document.activeElement).toBe(btn);
    expect(screen.getByRole('tooltip').textContent).toContain('human:');
    fireEvent.keyDown(btn, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });

  it('pointer-down outside closes, pointer-down inside does not', () => {
    render(
      <div>
        <HelpTip term="caliber" testId="ht" />
        <button type="button" data-testid="outside">outside</button>
      </div>,
    );
    const btn = screen.getByTestId('ht');
    fireEvent.click(btn);
    fireEvent.mouseDown(screen.getByTestId('ht').firstElementChild as Element);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});

describe('HelpTip — 375 viewport safety', () => {
  it('clamps a right-edge anchor back inside the viewport (never overflows 375)', () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.classList.contains('a2-ht-pop')) return rect(240, 80, 0, 0);
      if (this.classList.contains('a2-ht-btn')) return rect(14, 14, 350, 100);
      return rect(0, 0, 0, 0);
    });
    render(<HelpTip term="presentOnly" testId="ht" />);
    fireEvent.click(screen.getByTestId('ht'));
    const pop = screen.getByRole('tooltip') as HTMLElement;
    const left = Number.parseFloat(pop.style.left);
    const top = Number.parseFloat(pop.style.top);
    // 375 - 8 gutter - 240 width = 127 → the tip sits fully inside the screen
    expect(left).toBe(127);
    expect(left + 240).toBeLessThanOrEqual(375);
    // below the anchor (100 + 14 + 6), not off-screen
    expect(top).toBe(120);
  });

  it('flips above the anchor when the bottom edge is tight', () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 200 });
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      if (this.classList.contains('a2-ht-pop')) return rect(240, 80, 0, 0);
      if (this.classList.contains('a2-ht-btn')) return rect(14, 14, 100, 160);
      return rect(0, 0, 0, 0);
    });
    render(<HelpTip term="sourceEnum" testId="ht" />);
    fireEvent.click(screen.getByTestId('ht'));
    const pop = screen.getByRole('tooltip') as HTMLElement;
    expect(Number.parseFloat(pop.style.top)).toBe(74); // 160 - 80 - 6
  });
});