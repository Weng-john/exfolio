import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessibleDialog } from '../src/web/components/AccessibleDialog';

// Exercise the merged shell's effects and handlers without a browser dependency.
// Native inertness and actual layout still require the browser acceptance check.
const hooks = vi.hoisted(() => ({
  dialog: null as HTMLDialogElement | null,
  effects: [] as Array<() => void | (() => void)>,
}));
vi.mock('react', () => ({
  useId: () => 'dialog-test-title',
  useRef: () => ({ current: hooks.dialog }),
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
}));

let doc: { activeElement: Element | null; body: { style: { overflow: string } } };
const cleanups: Array<() => void> = [];

beforeEach(() => {
  hooks.effects = [];
  doc = { activeElement: null, body: { style: { overflow: 'auto' } } };
  vi.stubGlobal('document', doc);
});
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
  vi.unstubAllGlobals();
});

function shell() {
  const dialog = {
    showModal: vi.fn(),
    close: vi.fn(),
    focus: vi.fn(),
    querySelector: vi.fn<(selector: string) => HTMLElement | null>(() => null),
    querySelectorAll: vi.fn(() => [] as HTMLElement[]),
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
  };
  hooks.dialog = dialog as unknown as HTMLDialogElement;
  return dialog;
}
function control(
  dialog: ReturnType<typeof shell>,
  options: { hidden?: boolean; disabled?: boolean; inert?: boolean } = {},
) {
  return {
    tabIndex: 0,
    focus: vi.fn(),
    matches: () => !!options.disabled,
    closest: (selector: string) => (selector === 'dialog' ? dialog : options.inert ? {} : null),
    getClientRects: () => (options.hidden ? [] : [{}]),
    isConnected: true,
  } as unknown as HTMLElement;
}
function mount() {
  const cleanup = hooks.effects[hooks.effects.length - 2]();
  if (cleanup) cleanups.push(cleanup);
  hooks.effects[hooks.effects.length - 1]();
}
function tabEvent(dialog: ReturnType<typeof shell>, shiftKey = false) {
  return {
    key: 'Tab',
    shiftKey,
    defaultPrevented: false,
    preventDefault: vi.fn(),
    currentTarget: dialog,
    target: { closest: () => dialog },
  };
}

describe('merged native dialog and QA focus behavior', () => {
  it('focuses form controls and restores the original opener after queued content changes', () => {
    const dialog = shell();
    const opener = control(dialog);
    const input = control(dialog);
    doc.activeElement = opener;
    dialog.querySelector.mockImplementation((selector) =>
      selector === '.form-input' ? input : null,
    );
    AccessibleDialog({
      title: '表單',
      children: null,
      onClose: vi.fn(),
      initialFocusSelector: '.form-input',
    });
    mount();
    expect(dialog.showModal).toHaveBeenCalledOnce();
    expect(input.focus).toHaveBeenCalledOnce();
    expect(doc.body.style.overflow).toBe('hidden');

    const cancel = control(dialog);
    dialog.querySelector.mockReturnValue(cancel);
    AccessibleDialog({ title: '下一個確認', children: null, onClose: vi.fn(), focusKey: {} });
    hooks.effects[hooks.effects.length - 1]();
    expect(cancel.focus).toHaveBeenCalledOnce();
    cleanups.pop()!();
    expect(opener.focus).toHaveBeenCalledOnce();
    expect(doc.body.style.overflow).toBe('auto');
  });

  it('prioritizes the explicit cancel target over the form default', () => {
    const dialog = shell();
    const cancel = control(dialog);
    dialog.querySelector.mockReturnValue(cancel);
    AccessibleDialog({
      title: '確認',
      children: null,
      onClose: vi.fn(),
      initialFocusSelector: '.form-input',
    });
    mount();
    expect(dialog.querySelector).toHaveBeenCalledExactlyOnceWith('[data-dialog-initial]');
    expect(cancel.focus).toHaveBeenCalledOnce();
  });

  it('keeps the body locked until the last nested dialog closes', () => {
    shell();
    AccessibleDialog({ title: '外層', children: null, onClose: vi.fn() });
    mount();
    shell();
    AccessibleDialog({ title: '內層', children: null, onClose: vi.fn() });
    mount();
    cleanups.pop()!();
    expect(doc.body.style.overflow).toBe('hidden');
    cleanups.pop()!();
    expect(doc.body.style.overflow).toBe('auto');
  });

  it('wraps Tab in both directions while excluding hidden, disabled and inert controls', () => {
    const dialog = shell();
    const first = control(dialog),
      last = control(dialog);
    dialog.querySelectorAll.mockReturnValue([
      control(dialog, { hidden: true }),
      first,
      last,
      control(dialog, { disabled: true }),
      control(dialog, { inert: true }),
    ]);
    const view = AccessibleDialog({ title: '對話框', children: null, onClose: vi.fn() });
    doc.activeElement = last;
    const forward = tabEvent(dialog);
    view.props.onKeyDown(forward);
    expect(forward.preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();
    doc.activeElement = first;
    const backward = tabEvent(dialog, true);
    view.props.onKeyDown(backward);
    expect(backward.preventDefault).toHaveBeenCalledOnce();
    expect(last.focus).toHaveBeenCalledOnce();
  });

  it('does not intercept a nested dialog or a handled event', () => {
    const dialog = shell();
    const view = AccessibleDialog({ title: '外層', children: null, onClose: vi.fn() });
    view.props.onKeyDown({ ...tabEvent(dialog), target: { closest: () => ({}) } });
    view.props.onKeyDown({ ...tabEvent(dialog), defaultPrevented: true });
    expect(dialog.querySelectorAll).not.toHaveBeenCalled();
  });

  it('contains focus even when all controls are unavailable', () => {
    const dialog = shell();
    const view = AccessibleDialog({ title: '等候中', children: null, onClose: vi.fn() });
    const event = tabEvent(dialog);
    view.props.onKeyDown(event);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(dialog.focus).toHaveBeenCalledOnce();
  });

  it('uses the latest close callback for Escape and only dismisses outside clicks', () => {
    const dialog = shell();
    const oldClose = vi.fn(),
      currentClose = vi.fn();
    AccessibleDialog({ title: '表單', children: null, onClose: oldClose });
    const view = AccessibleDialog({ title: '表單', children: null, onClose: currentClose });
    const cancel = { preventDefault: vi.fn() };
    view.props.onCancel(cancel);
    expect(cancel.preventDefault).toHaveBeenCalledOnce();
    expect(oldClose).not.toHaveBeenCalled();
    expect(currentClose).toHaveBeenCalledOnce();
    view.props.onClick({ currentTarget: dialog, target: dialog, clientX: 50, clientY: 50 });
    expect(currentClose).toHaveBeenCalledOnce();
    view.props.onClick({ currentTarget: dialog, target: dialog, clientX: 150, clientY: 50 });
    expect(currentClose).toHaveBeenCalledTimes(2);
  });
});
