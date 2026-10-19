type TabEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>;

/** Keep Tab navigation inside a dialog when focus reaches either boundary. */
export function trapTabFocus(
  event: TabEvent,
  items: readonly HTMLElement[],
  activeElement: Element | null,
): boolean {
  if (event.key !== 'Tab' || items.length === 0) return false;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && activeElement === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && activeElement === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}
