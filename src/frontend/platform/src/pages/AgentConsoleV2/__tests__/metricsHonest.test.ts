/**
 * Q2 honesty gates for the metrics page.
 *
 * The A4 split legend and the heat tooltip once rounded 99.6% up to a full
 * 100%, which reads as "this slice is everything" when it is not. `honestPct`
 * keeps the display honest: no data is 「—」, a non-zero slice never shows 0%,
 * a partial slice never shows 100%, and exactly-full is the only 100%.
 */
import { describe, expect, it } from 'vitest';

import { honestPct } from '../MetricsPage';

describe('honestPct — no fake 0, no fake 100', () => {
  it('shows 「—」 when there is no denominator', () => {
    expect(honestPct(0, 0)).toBe('—');
    expect(honestPct(5, 0)).toBe('—');
    expect(honestPct(5, -1)).toBe('—');
    expect(honestPct(0, Number.NaN)).toBe('—');
  });

  it('never rounds a partial slice up to 100', () => {
    expect(honestPct(996, 1000)).toBe('99');
    expect(honestPct(999, 1000)).toBe('99');
    expect(honestPct(1, 1)).toBe('100');
    expect(honestPct(1000, 1000)).toBe('100');
  });

  it('never collapses a non-zero slice to 0', () => {
    expect(honestPct(1, 1000)).toBe('1');
    expect(honestPct(0, 10)).toBe('0');
  });

  it('floors rather than rounds for the middle band', () => {
    expect(honestPct(1, 3)).toBe('33');
    expect(honestPct(2, 3)).toBe('66');
  });
});