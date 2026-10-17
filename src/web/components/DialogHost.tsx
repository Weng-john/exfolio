import { useEffect, useRef } from 'react';
import { answer, useDialog } from '../dialog';

/** Renders the dialog requested through confirmDialog() / notify(). */
export function DialogHost() {
  const dialog = useDialog();
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!dialog) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') answer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);

  if (!dialog) return null;
  const tone = dialog.tone ?? 'default';
  const isConfirm = dialog.kind === 'confirm';
  return (
    <div className="modal-backdrop dialog-backdrop" onClick={() => answer(false)}>
      <div
        className={`modal dialog tone-${tone}`}
        role={isConfirm ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby="dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog-body">
          <h2 id="dialog-title">{dialog.title ?? (isConfirm ? '請確認' : '提示')}</h2>
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
