/* eslint-disable no-restricted-syntax -- assertions intentionally use the localized copy under test */
/**
 * TSK-03 extracted modules (`TskCreateBits` / `TskCreateForm` /
 * `TskCreateResultCard`).
 *
 * The 600-line split is a pure move; these tests pin the behaviour that had to
 * survive it, on the modules themselves rather than through the whole page:
 * - the skeleton renders no readable characters (no 「0」, no 「—」);
 * - 403 and 404 keep one body and differ only under the technical fold;
 * - the priority group is numbered and carries the words, never the enum;
 * - no candidate ⇒ no <select>, a blocked primary button with a reason;
 * - a deep link that applied shows a neutral line, never a raw id;
 * - replay/conflict cards stay distinct.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('react-i18next', async () => {
  const mod = (await import('../../../../public/locales/zh-Hans/bs.json')) as {
    default: Record<string, unknown>;
  };
  const dict = mod.default;
  const t = (key: unknown, defOrOpts?: unknown): string => {
    const value = String(key)
      .split('.')
      .reduce<unknown>(
        (acc, part) =>
          acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined,
        dict
      );
    if (typeof defOrOpts === 'string') {
      return typeof value === 'string' ? value : defOrOpts;
    }
    if (typeof value === 'string') {
      const options = (defOrOpts ?? {}) as Record<string, unknown>;
      return value.replace(/\{\{(\w+)\}\}/g, (m, name: string) =>
        name in options ? String(options[name]) : m
      );
    }
    if (value && typeof value === 'object') return String(key);
    return String(key);
  };
  return { useTranslation: () => ({ t }) };
});

import {
  ForbiddenScreen,
  FormSkeleton,
  PageShell,
  type Candidate,
} from '../TskCreateBits';
import { TskCreateForm, type TskCreateFormProps } from '../TskCreateForm';
import { TskCreateResultCard } from '../TskCreateResultCard';

const EMP: Candidate = {
  id: 'emp_86A81CE8FF6F42E187BCF2B540',
  name: '林可知',
  title: '内容运营',
  lifecycleState: 'active',
};

afterEach(cleanup);

function renderForm(overrides: Partial<TskCreateFormProps> = {}) {
  const props: TskCreateFormProps = {
    values: { title: '', assigneeId: '', priority: 'normal', note: '' },
    errors: {},
    setField: vi.fn(),
    showInvalid: false,
    errorCount: 0,
    submitting: false,
    saveDisabled: false,
    failure: null,
    onSubmit: vi.fn(),
    onCancel: vi.fn(),
    onReload: vi.fn(),
    deepNotices: [],
    deepAssignee: false,
    deepPriority: false,
    candidates: [EMP],
    selected: EMP,
    noCandidates: false,
    currentName: 'Kevin',
    confirmLeave: false,
    onLeave: vi.fn(),
    onKeep: vi.fn(),
    previewTitle: '',
    titleRef: { current: null },
    assigneeRef: { current: null },
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <TskCreateForm {...props} />
    </MemoryRouter>
  );
}

describe('TskCreateBits', () => {
  it('skeleton shows no readable reading — no digit and no dash anywhere', () => {
    const { container } = render(<FormSkeleton />);
    expect(screen.getByTestId('agent-v2-tsk-c-loading')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', '页面加载中');
    expect(container.textContent).toBe('正在读负责人名单，很快就好。');
    expect(container.textContent).not.toMatch(/[0-9]/);
    expect(container.textContent).not.toContain('—');
  });

  it('403 and 404 keep one visible body and differ only under the fold', () => {
    const one = render(
      <MemoryRouter>
        <ForbiddenScreen onRetry={vi.fn()} readRequestId="req_403" readStatus={403} />
      </MemoryRouter>
    );
    const title403 = one.container.querySelector('.card.stage .t')?.textContent;
    const desc403 = one.container.querySelector('.card.stage .s')?.textContent;
    const text403 = one.container.textContent ?? '';
    one.unmount();

    const two = render(
      <MemoryRouter>
        <ForbiddenScreen onRetry={vi.fn()} readRequestId="req_404" readStatus={404} />
      </MemoryRouter>
    );
    const title404 = two.container.querySelector('.card.stage .t')?.textContent;
    const desc404 = two.container.querySelector('.card.stage .s')?.textContent;

    expect(title403).toBe('你暂时不能在这里建任务');
    expect(title404).toBe(title403);
    expect(desc404).toBe(desc403);
    // the difference lives in the collapsed fold only
    expect(text403).toContain('403');
    expect(two.container.textContent).toContain('404');
    expect(two.container.querySelectorAll('.card.stage .acts2 button')).toHaveLength(1);
  });

  it('forbidden retry re-runs the read through the given handler', () => {
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <ForbiddenScreen onRetry={onRetry} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-forbidden-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('page shell states the Esc warning only while escWarn is true', () => {
    render(
      <MemoryRouter>
        <PageShell escWarn={false}>
          <div data-testid="body" />
        </PageShell>
      </MemoryRouter>
    );
    expect(screen.queryByTestId('agent-v2-tsk-c-esc-warn')).toBeNull();
    cleanup();

    render(
      <MemoryRouter>
        <PageShell escWarn>
          <div data-testid="body" />
        </PageShell>
      </MemoryRouter>
    );
    expect(screen.getByTestId('agent-v2-tsk-c-esc-warn')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('agent-v2-tsk-c-esc-warn').textContent).toContain('再按一次');
    expect(screen.getByTestId('agent-v2-tsk-c-back')).toHaveAttribute('href', '/agent/tasks');
  });
});

describe('TskCreateForm (extracted)', () => {
  it('E04: priority options are numbered 1–3, carry the words, and never the enum', () => {
    const { container } = renderForm({
      values: { title: '', assigneeId: '', priority: 'high', note: '' },
    });
    const labels = [1, 2, 3].map((n) => screen.getByTestId(`agent-v2-tsk-c-priority-${n}`));
    expect(labels.map((l) => l.querySelector('input')?.getAttribute('value'))).toEqual([
      '低',
      '普通',
      '高',
    ]);
    expect(labels.map((l) => l.querySelector('input')?.checked)).toEqual([false, false, true]);
    expect(container.innerHTML).not.toMatch(/value="(low|normal|high)"/);
    expect(screen.getByRole('radiogroup')).toHaveAttribute('aria-label', '优先级');
  });

  it('E05: no candidates ⇒ no select, an explanation, and a blocked button with a reason', () => {
    const setField = vi.fn();
    renderForm({
      candidates: [],
      selected: null,
      noCandidates: true,
      saveDisabled: true,
      setField,
    });
    expect(screen.queryByTestId('agent-v2-tsk-c-assignee')).toBeNull();
    expect(screen.getByTestId('agent-v2-tsk-c-assignee-empty')).toHaveAttribute('role', 'note');
    const save = screen.getByTestId('agent-v2-tsk-c-save');
    expect(save).toBeDisabled();
    expect(save).toHaveAttribute('aria-describedby', 'tsk03-why-blocked');
    expect(screen.getByTestId('agent-v2-tsk-c-why-blocked')).toHaveAttribute('id', 'tsk03-why-blocked');
    expect(screen.getByTestId('agent-v2-tsk-c-why-blocked').textContent).toContain('负责人还没有着落');
    // the reload exit stays wired to the page's read
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-empty-reload'));
  });

  it('D3: an applied deep link highlights the field and never shows the raw id', () => {
    const { container } = renderForm({
      values: { title: '', assigneeId: EMP.id, priority: 'normal', note: '' },
      deepAssignee: true,
    });
    const field = screen.getByTestId('agent-v2-tsk-c-assignee').closest('.field');
    expect(field).not.toBeNull();
    expect(field?.className).toContain('is-deeplink');
    const note = screen.getByTestId('agent-v2-tsk-c-deeplink-assignee');
    expect(note.textContent).toContain('林可知');
    expect(note.textContent).not.toContain(EMP.id);
    expect(container.textContent).not.toContain(EMP.id);
  });

  it('D3: an unapplied deep link is one neutral note band, not an error', () => {
    renderForm({ deepNotices: ['deepMissingAssignee'] });
    const band = screen.getByTestId('agent-v2-tsk-c-deeplink-note');
    expect(band).toHaveAttribute('role', 'note');
    expect(band.textContent).toContain('不在这次的名单里');
    expect(screen.queryByTestId('agent-v2-tsk-c-error-summary')).toBeNull();
  });
});

describe('TskCreateResultCard (extracted)', () => {
  it('replay is the success card plus a neutral band, never a failure', () => {
    render(
      <MemoryRouter>
        <TskCreateResultCard
          result={{ kind: 'replay', task: { taskId: 'tk_7K2MQ4X9TB3N', title: '整理工单' }, requestId: 'r1' }}
          copied={false}
          onCopy={vi.fn()}
          onRestart={vi.fn()}
          fallbackAssignee="未命名"
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('agent-v2-tsk-c-result')).toBeInTheDocument();
    expect(screen.getByTestId('agent-v2-tsk-c-replay-band')).toHaveAttribute('role', 'note');
    expect(screen.getByTestId('agent-v2-tsk-c-result-sub').textContent).toBe('整理工单');
    expect(screen.queryByTestId('agent-v2-tsk-c-save-error')).toBeNull();
  });

  it('conflict is its own card with two next steps and no success card', () => {
    const onRestart = vi.fn();
    render(
      <MemoryRouter>
        <TskCreateResultCard
          result={{ kind: 'conflict', requestId: 'r2' }}
          copied={false}
          onCopy={vi.fn()}
          onRestart={onRestart}
          fallbackAssignee="未命名"
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId('agent-v2-tsk-c-conflict')).toBeInTheDocument();
    expect(screen.queryByTestId('agent-v2-tsk-c-result')).toBeNull();
    expect(screen.getByTestId('agent-v2-tsk-c-conflict')).toHaveTextContent('这次没有建立');
    fireEvent.click(screen.getByTestId('agent-v2-tsk-c-conflict-reopen'));
    expect(onRestart).toHaveBeenCalledTimes(1);
  });
});