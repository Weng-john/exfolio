import { useEffect, useId, useRef, type ReactNode } from 'react';

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
    ref.current?.querySelector<HTMLElement>('[data-dialog-initial]')?.focus();
  }, [props.focusKey]);
  return (
    <dialog
      ref={ref}
      className={`modal native-dialog ${props.className ?? ''}`}
      aria-labelledby={titleId}
      aria-describedby={props.descriptionId}
      aria-modal="true"
      role={props.alert ? 'alertdialog' : undefined}
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
