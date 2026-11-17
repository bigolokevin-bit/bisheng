// 7x24 activity heatmap panel (R7 run-activity), platform-wide or per employee.
import { useTranslation } from 'react-i18next';
import { employeeLabelById } from './identity';
import type { ActivityBody, EmployeeRow } from './v2Data';

export function EmployeesHeatPanel({

  heat,
  body,
  heatEmployeeId,
  onEmployeeChange,
  }: {
  heat: { body?: ActivityBody; failed?: boolean };
  body: EmployeeRow[];
  heatEmployeeId: string;
  onEmployeeChange: (id: string) => void;
}) {
  const { t } = useTranslation();
  const cells = heat.body?.cells ?? [];
  const max = heat.body?.max ?? 0;
  let night = 0;
  let total = 0;
  let peak = 0;
  cells.forEach((c) => {
    total += c.count ?? 0;
    if ((c.hour ?? 0) < 6) night += c.count ?? 0;
    if ((c.count ?? 0) > peak) peak = c.count ?? 0;
  });
  const byPos = new Map<string, number>();
  cells.forEach((c) => byPos.set(`${c.dow}:${c.hour}`, c.count ?? 0));
  const days = ['dayMon', 'dayTue', 'dayWed', 'dayThu', 'dayFri', 'daySat', 'daySun'] as const;
  const todayDow = ((new Date().getUTCDay() + 6) % 7) + 1; // cells dow is 1=Monday

  return (
    <div className="a2-card" data-testid="agent-v2-employees-heat">
      <div className="a2-card-head">
        <h2 className="a2-h2">{t('agentConsole.v2.trendsHeat')}</h2>
        <div className="a2-chips">
          <button
            type="button"
            className={`a2-pill${heatEmployeeId === '' ? ' active' : ''}`}
            onClick={() => onEmployeeChange('')}
          >
            {t('agentConsole.v2.emp.heatPlatform')}
          </button>
          <select
            className="a2-input"
            aria-label={t('agentConsole.v2.emp.heatEmployee')}
            value={heatEmployeeId}
            onChange={(e) => onEmployeeChange(e.target.value)}
            data-testid="agent-v2-heat-employee"
          >
            <option value="">{t('agentConsole.v2.emp.heatEmployee')}</option>
            {body.map((r) => (
              <option key={r.employeeId} value={r.employeeId}>
                {r.name?.trim() || employeeLabelById(r.employeeId, undefined, t)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {heat.failed ? (
        <p className="a2-meta" data-testid="agent-v2-heat-error">
          {t('agentConsole.v2.heatError')}
        </p>
      ) : cells.length === 0 ? (
        <p className="a2-meta" data-testid="agent-v2-heat-empty">
          {t('agentConsole.v2.heatEmpty')}
        </p>
      ) : (
        <div className="a2-heat">
          {days.map((d, di) => (
            <div
              key={d}
              className={`a2-heat-row${di + 1 === todayDow ? ' a2-heat-today' : ''}`}
            >
              <span className="a2-heat-day">{t(`agentConsole.v2.${d}`)}</span>
              <span className="a2-heat-cells">
                {Array.from({ length: 24 }, (_, h) => {
                  const v = byPos.get(`${di + 1}:${h}`) ?? 0;
                  return (
                    <span
                      key={h}
                      className="a2-heat-cell"
                      title={`${t(`agentConsole.v2.${d}`)} ${h}:00 · ${v}`}
                      style={{ opacity: v === 0 ? 0.18 : 0.45 + (v / Math.max(1, max)) * 0.55 }}
                    />
                  );
                })}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="a2-meta" data-testid="agent-v2-heat-foot">
        {/* Interpolate counts via options (same pattern as pageInfo); manual
            appending left raw {{count}} placeholders on screen. */}
        {t('agentConsole.v2.emp.heatPeak', { count: peak })} ·{' '}
        {t('agentConsole.v2.emp.heatNight', { count: night })} ·{' '}
        {t('agentConsole.v2.emp.heatWeekTotal', { count: total })} · {t('agentConsole.v2.emp.heatTzNote')} ·{' '}
        {t('agentConsole.v2.emp.heatCaliber')}
      </p>
    </div>
  );
}
