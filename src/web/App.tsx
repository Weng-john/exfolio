import { useEffect } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Badge } from './components/ui';
import { fmtTime } from './format';
import AccountsPage from './pages/Accounts';
import CoreAllocationPage from './pages/CoreAllocation';
import FuturesPage from './pages/Futures';
import JournalPage from './pages/Journal';
import LoansPage from './pages/Loans';
import NewMoneyPage from './pages/NewMoney';
import OverviewPage from './pages/Overview';
import PerformancePage from './pages/Performance';
import RiskLabPage from './pages/RiskLab';
import SettingsPage from './pages/Settings';
import StrategiesPage from './pages/Strategies';
import { refreshQuotes, useAutoRefresh, useQuoteSync } from './quotes';
import { initStore, useStore, type SyncStatus } from './store';
import { useDailySnapshot } from './useDailySnapshot';

const NAV: Array<{ group: string; items: Array<{ path: string; label: string; element: JSX.Element }> }> = [
  {
    group: '總覽',
    items: [{ path: '/', label: 'Overview', element: <OverviewPage /> }],
  },
  {
    group: '被動核心',
    items: [
      { path: '/allocation', label: 'Core Allocation', element: <CoreAllocationPage /> },
      { path: '/new-money', label: 'New Money Allocator', element: <NewMoneyPage /> },
    ],
  },
  {
    group: '帳務',
    items: [
      { path: '/accounts', label: 'Accounts & Positions', element: <AccountsPage /> },
      { path: '/loans', label: 'Loans & Collateral', element: <LoansPage /> },
      { path: '/futures', label: 'Futures & Rollover', element: <FuturesPage /> },
    ],
  },
  {
    group: '主動策略',
    items: [
      { path: '/strategies', label: 'Strategy Hub', element: <StrategiesPage /> },
      { path: '/journal', label: 'Trade Journal', element: <JournalPage /> },
    ],
  },
  {
    group: '分析',
    items: [
      { path: '/performance', label: 'Performance', element: <PerformancePage /> },
      { path: '/risk', label: 'Risk Lab', element: <RiskLabPage /> },
    ],
  },
  {
    group: '系統',
    items: [{ path: '/settings', label: 'Settings', element: <SettingsPage /> }],
  },
];

const STATUS: Record<SyncStatus, { tone: 'ok' | 'warn' | 'bad' | 'info'; text: string }> = {
  loading: { tone: 'info', text: '載入中' },
  ready: { tone: 'ok', text: '已同步' },
  saving: { tone: 'info', text: '儲存中' },
  error: { tone: 'bad', text: '同步失敗' },
  conflict: { tone: 'bad', text: '版本衝突' },
};

function TopBar() {
  const store = useStore();
  const quotes = useQuoteSync();
  const status = STATUS[store.status];
  return (
    <div className="topbar">
      <div className="topbar-item">
        <Badge tone={status.tone}>{status.text}</Badge>
        <span className="muted">{store.backendLabel}</span>
        {store.error && <span className="neg">{store.error}</span>}
        {(store.status === 'error' || store.status === 'conflict') && (
          <button className="ghost" onClick={() => void initStore()}>
            重新載入
          </button>
        )}
      </div>
      <div className="topbar-item">
        <span className="muted" title={quotes.errors.join('\n')}>
          報價更新：{fmtTime(quotes.lastSuccessAt)}
          {quotes.errors.length > 0 && `（${quotes.errors.length} 項失敗）`}
        </span>
        <button onClick={() => void refreshQuotes()} disabled={quotes.refreshing}>
          {quotes.refreshing ? '更新中…' : '更新報價'}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const store = useStore();
  useEffect(() => {
    void initStore();
  }, []);
  useAutoRefresh(store.status !== 'loading' && store.backendLabel !== '');
  useDailySnapshot();

  return (
    <HashRouter>
      <div className="layout">
        <nav className="sidebar">
          <div className="brand">Exfolio</div>
          {NAV.map((g) => (
            <div key={g.group} className="nav-group">
              <div className="nav-title">{g.group}</div>
              {g.items.map((item) => (
                <NavLink key={item.path} to={item.path} end={item.path === '/'}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        <div className="main">
          <TopBar />
          <main className="content">
            {store.status === 'loading' ? (
              <div className="empty">載入資料中…</div>
            ) : (
              <Routes>
                {NAV.flatMap((g) => g.items).map((item) => (
                  <Route key={item.path} path={item.path} element={item.element} />
                ))}
              </Routes>
            )}
          </main>
        </div>
      </div>
    </HashRouter>
  );
}
