/**
 * MET-01 C block heat pieces (MET01-TARGET-SPEC.md §1.7):
 * - 7 rows STARTING MONDAY (dow 1=Mon contract, M-AC-35) × 24 columns;
 *   axis labels every 4 hours (00/04/08/12/16/20), never 3-hour/8 labels;
 * - six-level scale ceil(count ÷ max × 5) with the SERVER max; missing
 *   cells are legal true zeroes (heat-0), never a fabricated matrix;
 * - today row label foreground+600, current-hour column inset ring;
 * - tooltip on hover / Tab focus / tap: 周X HH:00–HH+1:00 / N 次 /
 *   占全周 x.x%（北京时间）; zero cells read 「无运行」, no failure count;
 * - non-zero cells drill to /agent/runs?since=<hour start>&from=metrics
 *   (R5 has no until — start point only); zero cells are NOT clickable;
 *   Enter navigates, Space only reads the tooltip;
 * - <1024 the grid is repeat(24,minmax(0,1fr)) + aspect-ratio:1 so 375
 *   never scrolls horizontally (CSS met-hcs).
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FocusEvent, MouseEvent } from 'react';
import type { TFunction } from 'i18next';
import { NavLink } from 'react-router-dom';

import { beijingNow, fmtInt, heatLevel, type HeatModel } from './met01';

export const HEAT_DAY_KEYS = [
  'agentConsole.v2.dayMon',
  'agentConsole.v2.dayTue',
  'agentConsole.v2.dayWed',
  'agentConsole.v2.dayThu',
  'agentConsole.v2.dayFri',
  'agentConsole.v2.daySat',
  'agentConsole.v2.daySun',
] as const;

const AXIS_LABELS = ['00', '04', '08', '12', '16', '20'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export interface HeatGridProps {
  model: HeatModel;
  t: TFunction;
  now: Date;
  /** Drill-down href for a non-zero cell (caller adds since/employeeId). */
  hrefFor: (dow: number, hour: number) => string;
  /** role=img overview — the chart's text equivalent (M-AC-30). */
  ariaLabel: string;
  testid: string;
}

export function HeatGrid({ model, t, now, hrefFor, ariaLabel, testid }: HeatGridProps) {
  const { dow: todayDow, hour: focusHour } = beijingNow(now);
  const [tip, setTip] = useState<{ dow: number; hour: number; count: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(null);

  const show = (el: HTMLElement, dow: number, hour: number, count: number) => {
    anchorRef.current = el;
    setTip({ dow, hour, count });
  };
  const hide = () => {
    anchorRef.current = null;
    setTip(null);
  };

  // Position inside the card, never past its edges (target htip math).
  useLayoutEffect(() => {
    const tipEl = tipRef.current;
    const anchor = anchorRef.current;
    const wrap = wrapRef.current;
    if (!tip || !tipEl || !anchor || !wrap) return;
    const cr = wrap.getBoundingClientRect();
    const er = anchor.getBoundingClientRect();
    const tw = tipEl.offsetWidth;
    const th = tipEl.offsetHeight;
    const x = er.left - cr.left + er.width / 2;
    const y = er.top - cr.top;
    const lx = Math.min(Math.max(8, x - tw / 2), Math.max(8, cr.width - tw - 8));
    let ly = y - th - 8;
    if (ly < 4) ly = y + er.height + 8;
    tipEl.style.left = `${lx}px`;
    tipEl.style.top = `${ly}px`;
  }, [tip]);

  // Scrolling away dismisses the tooltip (target behaviour).
  useEffect(() => {
    const onScroll = () => hide();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className="met-heat-g-wrap" ref={wrapRef}>
      <div className="met-heat-g" role="img" aria-label={ariaLabel} data-testid={testid}>
        <div className="met-hcs ax" aria-hidden="true">
          {AXIS_LABELS.map((label) => (
            <i key={label} style={{ gridColumn: 'span 4' }}>
              {label}
            </i>
          ))}
        </div>
        {HEAT_DAY_KEYS.map((dayKey, idx) => {
          const dow = idx + 1;
          return (
            <div key={dayKey} className={`met-hrow${dow === todayDow ? ' now' : ''}`}>
              <span className="met-hl">{t(dayKey)}</span>
              <div className="met-hcs">
                {Array.from({ length: 24 }, (_, hour) => {
                  const count = model.map.get(`${dow}:${hour}`) ?? 0;
                  const level = heatLevel(count, model.max);
                  const focus = hour === focusHour;
                  const cls = `met-hc${level > 0 ? ` l${level}` : ''}${focus ? ' nw' : ''}`;
                  const aria =
                    count > 0
                      ? t('agentConsole.v2.met.heatCellAria', { day: t(dayKey), hour, count })
                      : t('agentConsole.v2.met.heatCellAriaZero', { day: t(dayKey), hour });
                  const common = {
                    className: cls,
                    'aria-label': aria,
                    'data-testid': `${testid}-cell`,
                    'data-dow': dow,
                    'data-hour': hour,
                    'data-count': count,
                    onMouseEnter: (ev: MouseEvent<HTMLElement>) => show(ev.currentTarget, dow, hour, count),
                    onMouseLeave: hide,
                    onFocus: (ev: FocusEvent<HTMLElement>) => show(ev.currentTarget, dow, hour, count),
                    onBlur: hide,
                  };
                  if (count > 0) {
                    return (
                      <NavLink
                        key={hour}
                        {...common}
                        to={hrefFor(dow, hour)}
                        tabIndex={0}
                        title={t('agentConsole.v2.met.heatCellLinkTitle')}
                        onKeyDown={(ev) => {
                          // Enter = navigate (link default); Space = read only.
                          if (ev.key === ' ' || ev.key === 'Spacebar') {
                            ev.preventDefault();
                            show(ev.currentTarget, dow, hour, count);
                          }
                        }}
                      />
                    );
                  }
                  return (
                    <div
                      key={hour}
                      {...common}
                      aria-disabled="true"
                      tabIndex={-1}
                      onClick={(ev) => {
                        ev.preventDefault();
                        if (tip && tip.dow === dow && tip.hour === hour) hide();
                        else show(ev.currentTarget, dow, hour, count);
                      }}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
                          ev.preventDefault();
                          show(ev.currentTarget, dow, hour, count);
                        }
                      }}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {tip ? (
        <div className="met-htip" ref={tipRef} role="status" data-testid={`${testid}-tip`}>
          <b>
            {t('agentConsole.v2.met.heatTipTitle', {
              day: t(HEAT_DAY_KEYS[tip.dow - 1]),
              start: pad2(tip.hour),
              end: pad2(tip.hour + 1),
            })}
          </b>
          {tip.count > 0 ? (
            <span>
              <span className="n a2-mono">{tip.count}</span>
              {t('agentConsole.v2.met.heatTipCount', {
                pct: model.total > 0 ? ((tip.count / model.total) * 100).toFixed(1) : '0.0',
              })}
            </span>
          ) : (
            <span>{t('agentConsole.v2.met.heatTipZero')}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Right column: peak hour / night average / rolling 28-day total. */
export function HeatSideStats({ model, t, now }: { model: HeatModel; t: TFunction; now: Date }) {
  const { hour: focusHour } = beijingNow(now);
  const peak = model.peak;
  const nightHigh = peak !== null && model.nightAvg !== null && model.nightAvg >= peak.count * 0.5;
  const nightSum = model.nightAvg !== null ? Math.round(model.nightAvg * 56) : 0;
  return (
    <div className="met-heat-side">
      <div className="met-hs" data-testid="agent-v2-met-heat-peak">
        <div className="l">
          <span className="a2-micro">{t('agentConsole.v2.met.heatPeak')}</span>
          <span className="sp" />
          {peak ? (
            <b>
              {fmtInt(peak.count)}
              <span className="u">{t('agentConsole.v2.met.heatPerHour')}</span>
            </b>
          ) : (
            <b>{t('agentConsole.v2.met.heatNoActivity')}</b>
          )}
        </div>
        {peak ? (
          <div className="d">
            {t('agentConsole.v2.met.heatPeakSub', {
              day: t(HEAT_DAY_KEYS[peak.dow - 1]),
              hour: pad2(peak.hour),
              pct: model.peakHourShare !== null ? (model.peakHourShare * 100).toFixed(1) : '0.0',
            })}
          </div>
        ) : null}
      </div>
      <div className="met-hs" data-testid="agent-v2-met-heat-night">
        <div className="l">
          <span className="a2-micro">{t('agentConsole.v2.met.heatNight')}</span>
          <span className="sp" />
          <b className={nightHigh ? 'wr' : ''}>
            {model.nightAvg !== null ? model.nightAvg.toFixed(1) : '—'}
            <span className="u">{t('agentConsole.v2.met.heatPerHour')}</span>
          </b>
        </div>
        <div className="d">
          {t('agentConsole.v2.met.heatNightSub', {
            sum: fmtInt(nightSum),
            status: nightHigh
              ? t('agentConsole.v2.met.heatNightHigh')
              : t('agentConsole.v2.met.heatNightOk'),
          })}
        </div>
      </div>
      <div className="met-hs" data-testid="agent-v2-met-heat-total">
        <div className="l">
          <span className="a2-micro">{t('agentConsole.v2.met.heatTotal')}</span>
          <span className="sp" />
          <b>{fmtInt(model.total)}</b>
        </div>
        <div className="d">{t('agentConsole.v2.met.heatTotalSub', { hour: pad2(focusHour) })}</div>
      </div>
    </div>
  );
}