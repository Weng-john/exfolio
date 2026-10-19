import { useEffect, useId, useRef, type ReactNode } from 'react';
import { trapTabFocus } from '../focusTrap';

let openDialogs = 0;
let previousOverflow = '';

/** Native top-layer dialog supplies focus containment and background inertness. */
export function AccessibleDialog(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  alert?: boolean;
  descriptionId?: string;
  focusKey?: unknown;
  initialFocusSelector?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    if (openDialogs++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    dialog.showModal();
    return () => {
      dialog.close();
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  useEffect(() => {
    const dialog = ref.current;
    const initial =
      dialog?.querySelector<HTMLElement>('[data-dialog-initial]') ??
      (props.initialFocusSelector
        ? dialog?.querySelector<HTMLElement>(props.initialFocusSelector)
        : null);
    initial?.focus();
  }, [props.focusKey, props.initialFocusSelector]);
  return (
    <dialog
      ref={ref}
      className={`modal native-dialog ${props.className ?? ''}`}
      aria-labelledby={titleId}
      aria-describedby={props.descriptionId}
      aria-modal="true"
      role={props.alert ? 'alertdialog' : undefined}
      tabIndex={-1}
      onKeyDown={(event) => {
        const dialog = event.currentTarget;
        // A nested native dialog owns its own Tab loop.
        if (
          event.defaultPrevented ||
          event.key !== 'Tab' ||
          (event.target as Element).closest('dialog') !== dialog
        )
          return;
        const items = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]',
          ),
        ).filter(
          (item) =>
            item.tabIndex >= 0 &&
            !item.matches(':disabled') &&
            item.closest('dialog') === dialog &&
            !item.closest('[inert]') &&
            item.getClientRects().length > 0,
        );
        if (!items.length) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        trapTabFocus(event, items, document.activeElement);
      }}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        )
          props.onClose();
      }}
    >
      <span id={titleId} className="sr-only">
        {props.title}
      </span>
      {props.children}
    </dialog>
  );
}
