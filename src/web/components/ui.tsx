import { useId, type ReactNode } from 'react';
import { AccessibleDialog } from './AccessibleDialog';
import { Breadcrumbs, Tooltip } from './Primitives';
import { IconClose } from './icons';

const PAGE_NAMES: Record<string, string> = {
  Overview: '投資組合總覽',
  'Core Allocation': '核心配置',
  'New Money Allocator': '新資金配置',
  'Accounts & Positions': '帳戶與持倉',
  'Loans & Collateral': '借款與質押',
  'Futures & Rollover': '期貨與轉倉',
  'Risk Lab': '風險實驗室',
  'Settings & Integrations': '設定與資料',
  'Strategy Hub': '主動策略',
  'Trade Journal': '交易日誌',
  'Performance Analytics': '績效分析',
};

const TERMS: Record<string, string> = {
  NAV: '淨資產：資產與現金，加計期貨未實現損益，再扣除負債。曝險比例以目前 NAV 為分母。',
  'NAV 淨資產': '資產與現金，加計期貨未實現損益，再扣除負債。外部投入與投資損益分開計算。',
  'Gross 曝險': '各部位曝險絕對值的總和，多空不互相抵銷。Gross 槓桿等於 Gross 曝險除以 NAV。',
  'Net 曝險': '各部位帶符號曝險的總和，多頭為正、空頭為負。Net 槓桿等於 Net 曝險除以 NAV。',
  '負債 / NAV': '負債占淨資產的比例；負債包含借款與負現金餘額。提醒門檻不會限制操作。',
};

export function PageHeader(props: { title: string; subtitle?: string; actions?: ReactNode }) {
  const title = PAGE_NAMES[props.title] ?? props.title;
  return (
    <header className="page-header">
      <div>
        {props.title === 'Overview' ? (
          <span className="eyebrow">Exfolio · 以曝險看見全貌</span>
        ) : (
          <Breadcrumbs items={[{ label: '總覽', to: '/' }, { label: title }]} />
        )}
        <h1>{title}</h1>
        {props.subtitle && <p className="muted">{props.subtitle}</p>}
      </div>
      {props.actions && <div className="actions">{props.actions}</div>}
    </header>
  );
}

export function Card(props: {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section
      className={`card ${props.className ?? ''}`}
      aria-labelledby={props.title ? titleId : undefined}
    >
      {(props.title || props.actions) && (
        <div className="card-head">
          {props.title && <h2 id={titleId}>{props.title}</h2>}
          {props.actions && <div className="actions">{props.actions}</div>}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function Stat(props: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'pos' | 'neg' | 'warn';
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {TERMS[props.label] ? (
          <Tooltip label={props.label}>{TERMS[props.label]}</Tooltip>
        ) : (
          props.label
        )}
      </div>
      <div className={`stat-value ${props.tone ?? ''}`}>{props.value}</div>
      {props.hint && <div className="stat-hint">{props.hint}</div>}
    </div>
  );
}

export function Badge(props: { tone?: 'ok' | 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <span className={`badge ${props.tone ?? 'info'}`}>{props.children}</span>;
}

export function Empty(props: { children: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-symbol" aria-hidden="true">
        ↗
      </span>
      <div>{props.children}</div>
    </div>
  );
}

/** Labelled form control. Pass the input / select as the child. */
export function Field(props: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{props.label}</span>
      {props.children}
      {props.hint && <span className="field-hint">{props.hint}</span>}
    </label>
  );
}

export function Modal(props: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <AccessibleDialog
      title={props.title}
      onClose={props.onClose}
      className={props.wide ? 'wide' : ''}
    >
      <div className="modal-head">
        <h2>{props.title}</h2>
        <button type="button" className="icon-btn" onClick={props.onClose} aria-label="關閉對話框">
          <IconClose />
        </button>
      </div>
      <div className="modal-body">{props.children}</div>
      {props.footer && <div className="modal-foot">{props.footer}</div>}
    </AccessibleDialog>
  );
}

/** Placeholder body for pages scheduled for a later phase. */
export function Planned(props: { phase: string; items: string[] }) {
  return (
    <Card title={`規劃中 · ${props.phase}`}>
      <ul className="planned">
        {props.items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </Card>
  );
}

/** Spinning ring with a short message, for whole-page waits. */
export function Spinner(props: { text?: string }) {
  return (
    <div className="loading" role="status">
      <span className="loading-spinner" />
      {props.text && <span>{props.text}</span>}
    </div>
  );
}
