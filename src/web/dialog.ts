import { useSyncExternalStore } from 'react';

// Confirmation and notice dialogs drawn by the page itself, in place of the
// browser's confirm() and alert(). One dialog at a time; later requests wait.

export type DialogTone = 'default' | 'warning' | 'danger';

export interface DialogRequest {
  kind: 'confirm' | 'notify';
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: DialogTone;
  resolve: (ok: boolean) => void;
}

let queue: DialogRequest[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function push(request: Omit<DialogRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    queue = [...queue, { ...request, resolve }];
    emit();
  });
}

/** Ask a yes/no question. Resolves true only when the visitor confirms. */
export function confirmDialog(
  message: string,
  options: { title?: string; confirmText?: string; cancelText?: string; tone?: DialogTone } = {},
): Promise<boolean> {
  return push({ kind: 'confirm', message, ...options });
}

/** Tell the visitor something; resolves once they close it. */
export async function notify(message: string, options: { title?: string; tone?: DialogTone } = {}) {
  await push({ kind: 'notify', message, ...options });
}

/** Close the dialog on screen with the visitor's answer. */
export function answer(ok: boolean) {
  const [current, ...rest] = queue;
  if (!current) return;
  queue = rest;
  emit();
  current.resolve(ok);
}

export function useDialog(): DialogRequest | undefined {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => queue[0],
  );
}
