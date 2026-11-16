import { useEffect } from 'react';

// On a phone a `table.stack-table` is drawn as one card per row (styles.css),
// which needs each cell to carry its column's name. Rather than repeat every
// header on every cell in every table, this fills them in from the table's
// own header row: `data-label` on value cells and `data-title` on a row's
// first cell. Cells that already carry either attribute are left alone, so a
// table can still choose its own.

function label(table: HTMLTableElement) {
  const head = table.tHead?.rows[table.tHead.rows.length - 1];
  if (!head) return;
  const names: string[] = [];
  for (const th of Array.from(head.cells)) {
    for (let i = 0; i < th.colSpan; i++) names.push(th.textContent?.trim() ?? '');
  }
  const bodies = [...Array.from(table.tBodies), ...(table.tFoot ? [table.tFoot] : [])];
  for (const body of bodies) {
    for (const row of Array.from(body.rows)) {
      let column = 0;
      for (const cell of Array.from(row.cells)) {
        const first = column === 0;
        const name = names[column];
        column += cell.colSpan;
        if (cell.hasAttribute('data-label') || cell.hasAttribute('data-title')) continue;
        if (first) cell.setAttribute('data-title', '');
        else if (name) cell.setAttribute('data-label', name);
        // A column without a name (row actions) shows its content alone.
        else cell.setAttribute('data-label', '');
      }
    }
  }
}

/** Keeps every `table.stack-table` on the page labelled as rows come and go. */
export function useStackTables() {
  useEffect(() => {
    let frame = 0;
    const run = () => {
      frame = 0;
      document.querySelectorAll<HTMLTableElement>('table.stack-table').forEach(label);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(run);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true });
    schedule();
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
}
