import { useEffect, useId, useRef } from 'react';
import { answer, useDialog } from '../dialog';
import { trapTabFocus } from '../focusTrap';

/** Renders the dialog requested through confirmDialog() / notify(). */
export function DialogHost() {
  const dialog = useDialog();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!dialog) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const container = dialogRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false);
      if (e.key !== 'Tab' || !container) return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!items.length) {
        e.preventDefault();
        container.focus();
        return;
      }
      trapTabFocus(e, items, document.activeElement);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
      previousFocus.current = null;
    };
  }, [dialog]);

  if (!dialog) return null;
  const tone = dialog.tone ?? 'default';
  const isConfirm = dialog.kind === 'confirm';
  return (
    <div className="modal-backdrop dialog-backdrop" onClick={() => answer(false)}>
      <div
        ref={dialogRef}
        className={`modal dialog tone-${tone}`}
        role={isConfirm ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-body">
          <h2 id={titleId}>{dialog.title ?? (isConfirm ? '請確認' : '提示')}</h2>
          <p className="dialog-message">{dialog.message}</p>
        </div>
        <div className="modal-foot">
          {isConfirm && (
            <button onClick={() => answer(false)}>{dialog.cancelText ?? '取消'}</button>
          )}
          <button
            ref={confirmRef}
            className={tone === 'danger' ? 'primary danger-solid' : 'primary'}
            onClick={() => answer(true)}
          >
            {dialog.confirmText ?? (isConfirm ? '確定' : '知道了')}
          </button>
        </div>
      </div>
    </div>
  );
}
