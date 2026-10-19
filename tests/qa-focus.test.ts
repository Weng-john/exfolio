import { describe, expect, it, vi } from 'vitest';
import { trapTabFocus } from '../src/web/focusTrap';

describe('QA: dialog focus loop', () => {
  it('wraps forward Tab from the last control to the first', () => {
    const first = { focus: vi.fn() } as unknown as HTMLElement;
    const last = { focus: vi.fn() } as unknown as HTMLElement;
    const event = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };

    expect(trapTabFocus(event, [first, last], last)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(first.focus).toHaveBeenCalledOnce();
    expect(last.focus).not.toHaveBeenCalled();
  });

  it('wraps backward Shift+Tab from the first control to the last', () => {
    const first = { focus: vi.fn() } as unknown as HTMLElement;
    const last = { focus: vi.fn() } as unknown as HTMLElement;
    const event = { key: 'Tab', shiftKey: true, preventDefault: vi.fn() };

    expect(trapTabFocus(event, [first, last], first)).toBe(true);
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(last.focus).toHaveBeenCalledOnce();
    expect(first.focus).not.toHaveBeenCalled();
  });

  it('leaves other keys and interior Tab movement to the browser', () => {
    const first = { focus: vi.fn() } as unknown as HTMLElement;
    const middle = { focus: vi.fn() } as unknown as HTMLElement;
    const last = { focus: vi.fn() } as unknown as HTMLElement;
    const event = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() };

    expect(trapTabFocus(event, [first, middle, last], middle)).toBe(false);
    expect(trapTabFocus({ ...event, key: 'Enter' }, [first, last], last)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(first.focus).not.toHaveBeenCalled();
    expect(last.focus).not.toHaveBeenCalled();
  });
});
