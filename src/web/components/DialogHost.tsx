import { useId } from 'react';
import { answer, useDialog } from '../dialog';
import { AccessibleDialog } from './AccessibleDialog';

/** Renders the dialog requested through confirmDialog() / notify(). */
export function DialogHost() {
  const dialog = useDialog();
  const descriptionId = useId();

  if (!dialog) return null;
  const tone = dialog.tone ?? 'default';
  const isConfirm = dialog.kind === 'confirm';
  return (
    <AccessibleDialog
      title={dialog.title ?? (isConfirm ? '請確認' : '提示')}
      onClose={() => answer(false)}
      className={`dialog tone-${tone}`}
      alert={isConfirm}
      descriptionId={descriptionId}
      focusKey={dialog}
    >
      <div className="dialog-body">
        <h2>{dialog.title ?? (isConfirm ? '請確認' : '提示')}</h2>
        <p className="dialog-message" id={descriptionId}>
          {dialog.message}
        </p>
      </div>
      <div className="modal-foot">
        {isConfirm && (
          <button data-dialog-initial type="button" onClick={() => answer(false)}>
            {dialog.cancelText ?? '取消'}
          </button>
        )}
        <button
          data-dialog-initial={!isConfirm ? '' : undefined}
          type="button"
          className={tone === 'danger' ? 'primary danger-solid' : 'primary'}
          onClick={() => answer(true)}
        >
          {dialog.confirmText ?? (isConfirm ? '確定' : '知道了')}
        </button>
      </div>
    </AccessibleDialog>
  );
}
