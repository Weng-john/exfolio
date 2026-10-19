import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { IconClose } from './icons';

export function Breadcrumbs(props: { items: Array<{ label: string; to?: string }> }) {
  return (
    <nav className="breadcrumbs" aria-label="頁面路徑">
      <ol>
        {props.items.map((item, i) => (
          <li key={i}>
            {item.to ? (
              <Link to={item.to}>{item.label}</Link>
            ) : (
              <span aria-current="page">{item.label}</span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** Automatic activation: Arrow keys, Home and End move focus and select a view. */
export function SegmentedControl<T extends string>(props: {
  label: string;
  items: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  children: ReactNode;
}) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  return (
    <>
      <div className="segmented" role="tablist" aria-label={props.label}>
        {props.items.map((item, index) => (
          <button
            type="button"
            key={item.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            role="tab"
            id={`${id}-${item.id}`}
            aria-controls={`${id}-panel`}
            aria-selected={props.value === item.id}
            tabIndex={props.value === item.id ? 0 : -1}
            className={props.value === item.id ? 'active' : ''}
            onClick={() => props.onChange(item.id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === 'ArrowRight') next = (index + 1) % props.items.length;
              else if (event.key === 'ArrowLeft')
                next = (index - 1 + props.items.length) % props.items.length;
              else if (event.key === 'Home') next = 0;
              else if (event.key === 'End') next = props.items.length - 1;
              else return;
              event.preventDefault();
              props.onChange(props.items[next].id);
              refs.current[next]?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div
        className="tab-panel"
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${props.value}`}
        tabIndex={0}
      >
        {props.children}
      </div>
    </>
  );
}

/** A disclosure, not a menu: links retain normal Tab navigation. */
export function Popover(props: { label: string; trigger: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div
      className="user-menu"
      ref={ref}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        type="button"
        ref={trigger}
        className={`avatar-btn ${open ? 'active' : ''}`}
        aria-label={props.label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        {props.trigger}
      </button>
      {open && (
        <div
          id={id}
          className="dropdown-menu"
          onClick={(event) => {
            if ((event.target as Element).closest('a, button')) {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          {props.children}
        </div>
      )}
    </div>
  );
}

export function Tooltip(props: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 16, top: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const tip = useRef<HTMLSpanElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current!.getBoundingClientRect();
      const box = tip.current!.getBoundingClientRect();
      setPosition({
        left: Math.max(16, Math.min(anchor.left, window.innerWidth - box.width - 16)),
        top:
          anchor.bottom + box.height > window.innerHeight - 16
            ? Math.max(16, anchor.top - box.height)
            : anchor.bottom,
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  return (
    <span
      className="term"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        if (document.activeElement !== trigger.current) setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="term-trigger"
        aria-label={`${props.label}：說明`}
        aria-describedby={open ? id : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          if (!trigger.current?.parentElement?.matches(':hover')) setOpen(false);
        }}
        onClick={() => setOpen(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {props.label}
        <span className="term-mark" aria-hidden="true">
          ?
        </span>
      </button>
      {open && (
        <span ref={tip} className="term-tip" role="tooltip" id={id} style={position}>
          {props.children}
        </span>
      )}
    </span>
  );
}

export function Banner(props: {
  title?: string;
  tone?: 'info' | 'warn' | 'bad';
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div
      className={`banner banner-${props.tone ?? 'info'}`}
      role={props.tone === 'bad' ? 'alert' : 'status'}
    >
      <span className="banner-symbol" aria-hidden="true">
        {props.tone === 'bad' || props.tone === 'warn' ? '!' : 'i'}
      </span>
      <div className="banner-copy">
        {props.title && <strong>{props.title}</strong>}
        <div>{props.children}</div>
      </div>
      {props.actions && <div className="actions">{props.actions}</div>}
    </div>
  );
}

/** Native details retains keyboard behavior without an extra focus target. */
export function Accordion(props: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="accordion" open={props.open}>
      <summary>
        {props.title}
        <span aria-hidden="true">＋</span>
      </summary>
      <div className="accordion-body">{props.children}</div>
    </details>
  );
}

export function Toggle(props: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      className="toggle-control"
      role="switch"
      aria-label={props.label}
      aria-checked={props.checked}
      onClick={() => props.onChange(!props.checked)}
    >
      <span>
        <span className="toggle-label">{props.label}</span>
        {props.hint && <span className="field-hint">{props.hint}</span>}
      </span>
      <span className={`theme-switch ${props.checked ? 'dark' : 'light'}`} aria-hidden="true">
        <span className="switch-handle" />
      </span>
    </button>
  );
}

export function EmptyState(props: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <span className="empty-symbol" aria-hidden="true">
        ↗
      </span>
      <h3>{props.title}</h3>
      <p>{props.children}</p>
      {props.action && <div className="actions">{props.action}</div>}
    </div>
  );
}

/** For bounded task completion. Signed allocation weights use WeightBar instead. */
export function ProgressBar(props: { label: string; value: number }) {
  const value = Number.isFinite(props.value) ? Math.max(0, Math.min(1, props.value)) : 0;
  return (
    <div className="progress-group">
      <div>
        <span>{props.label}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <progress aria-label={props.label} value={value} max={1} />
    </div>
  );
}

/** Persistent, dismissible feedback avoids time limits on reading errors. */
export function Toast(props: {
  message: string;
  tone?: 'ok' | 'bad' | 'info';
  onDismiss?: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => setDismissed(false), [props.message]);
  if (dismissed) return null;
  return (
    <div className={`toast toast-${props.tone ?? 'info'}`}>
      <span className="toast-symbol" aria-hidden="true">
        {props.tone === 'bad' ? '!' : props.tone === 'ok' ? '✓' : 'i'}
      </span>
      <span role={props.tone === 'bad' ? 'alert' : 'status'}>{props.message}</span>
      <button
        type="button"
        className="icon-btn"
        aria-label="關閉通知"
        onClick={() => (props.onDismiss ? props.onDismiss() : setDismissed(true))}
      >
        <IconClose />
      </button>
    </div>
  );
}
