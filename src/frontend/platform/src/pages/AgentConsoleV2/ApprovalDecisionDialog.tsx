/* APR-03: one shared two-step confirm dialog for the approval decision write
 * path, used by the detail page (single decision) and the list page (batch).
 *
 * Design rules it encodes:
 *  - the dialog is the ONLY place a write is issued from, so 取消 (and Esc)
 *    closes it and sends nothing;
 *  - it always names the target id, the localized kind and the risk level, and
 *    states that confirming writes to the approval service and the audit trail
 *    and cannot be undone;
 *  - it never renders machine codes: the caller passes an already-localized
 *    error node.
 */
import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { I, ICheck, IShield, IUndo, IX } from './approvalDetailKit';

import type { DecisionVerdict } from './v2Data';

import './approvalDecision.css';

const VERDICT_ICON: Record<DecisionVerdict, ReactNode> = {
  approve: ICheck,
  reject: IX,
  revise: IUndo,
};

export interface ApprovalDecisionDialogProps {
  verdict: DecisionVerdict;
  /** Headline, already localized (single: one approval; batch: N approvals). */
  title: string;
  /** Target line: the approval id, or a count + the ids being decided. */
  target: string;
  /** Localized change-kind (single) or a safe summary (batch). */
  kindLabel?: string;
  /** Localized risk level; omitted when the payload has no readable risk. */
  riskLabel?: string;
  /** Risk statement (localized) rendered under the key/value block. */
  riskNote: string;
  /** Batch mode sends no comment (the contract allows it to be omitted). */
  withComment: boolean;
  comment: string;
  onComment: (value: string) => void;
  busy: boolean;
  busyNote?: string;
  /** Localized failure copy; null/undefined renders no error row. */
  error?: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ApprovalDecisionDialog({
  verdict,
  title,
  target,
  kindLabel,
  riskLabel,
  riskNote,
  withComment,
  comment,
  onComment,
  busy,
  busyNote,
  error,
  onCancel,
  onConfirm,
}: ApprovalDecisionDialogProps) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const d = (key: string) => t(`agentConsole.v2.decide.dialog.${key}`);
  const verb = t(`agentConsole.v2.apd.verdict.${verdict}`);

  // Esc closes without writing; focus starts on 取消 so Enter can never
  // approve by accident.
  useEffect(() => {
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onCancel]);

  return (
    <div className="a2dd-ovl" role="presentation">
      <div
        className="a2dd"
        role="dialog"
        aria-modal="true"
        aria-labelledby="a2dd-title"
        data-testid="agent-v2-decision-dialog"
      >
        <div className="a2dd-hd">
          <span className={`a2dd-ic a2dd-ic-${verdict}`}>
            <I className="a2d-i a2d-i16">{VERDICT_ICON[verdict]}</I>
          </span>
          <h2 className="a2dd-t" id="a2dd-title" data-testid="agent-v2-decision-title">{title}</h2>
        </div>
        <div className="a2dd-bd">
          <dl className="a2dd-kv">
            <dt>{d('target')}</dt>
            <dd className="a2-mono" data-testid="agent-v2-decision-target">{target}</dd>
            {kindLabel ? (
              <>
                <dt>{d('kind')}</dt>
                <dd>{kindLabel}</dd>
              </>
            ) : null}
            {riskLabel ? (
              <>
                <dt>{d('riskLevel')}</dt>
                <dd>
                  <span className="a2dd-risk-pill">
                    <I className="a2d-i a2d-i13">{IShield}</I>
                    {riskLabel}
                  </span>
                </dd>
              </>
            ) : null}
          </dl>
          <p className="a2dd-risk" data-testid="agent-v2-decision-risk">{riskNote}</p>
          {withComment ? (
            <label className="a2dd-field">
              <span className="a2dd-lbl">{d('commentLabel')}</span>
              <textarea
                className="a2dd-ta"
                data-testid="agent-v2-decision-comment"
                value={comment}
                placeholder={d('commentPlaceholder')}
                rows={3}
                disabled={busy}
                onChange={(e) => onComment(e.target.value)}
              />
            </label>
          ) : null}
          {error ? (
            <div className="a2dd-err" role="alert" data-testid="agent-v2-decision-error">
              {error}
            </div>
          ) : null}
        </div>
        <div className="a2dd-ft">
          <button
            type="button"
            ref={cancelRef}
            className="a2d-btn out"
            data-testid="agent-v2-decision-cancel"
            disabled={busy}
            onClick={onCancel}
          >
            {d('cancel')}
          </button>
          <button
            type="button"
            className={`a2d-btn ${verdict === 'approve' ? 'pri' : verdict === 'reject' ? 'dgs' : 'out'}`}
            data-testid="agent-v2-decision-confirm"
            disabled={busy}
            aria-busy={busy}
            onClick={onConfirm}
          >
            <I className="a2d-i a2d-i14">{VERDICT_ICON[verdict]}</I>
            {busy ? (busyNote ?? d('busy')) : t('agentConsole.v2.decide.dialog.confirm', { verb })}
          </button>
        </div>
      </div>
    </div>
  );
}