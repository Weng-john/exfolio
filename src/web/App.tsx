import { useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { endPreview, initAuth, lockLocalData, logout, stopViewing, useAuth } from './auth';
import { Badge } from './components/ui';
import { IS_PUBLIC } from './edition';
import { fmtTime } from './format';
import AccountPage from './pages/Account';
import AccountsPage from './pages/Accounts';
import AdminPage from './pages/Admin';
import AuthPage from './pages/auth/AuthPage';
import SetupPage from './pages/auth/SetupPage';
import UnlockPage from './pages/auth/UnlockPage';
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
import { snapshotGeneratedAt } from './staticQuotes';
import { isEncrypted, onExternalChange } from './localVault';
import { initStore, loadDemo, markChangedElsewhere, useStore, type SyncStatus } from './store';
import { THEME_LABELS, useTheme } from './theme';
import { useDailySnapshot } from './useDailySnapshot';

const NAV: Array<{
  group: string;
  items: Array<{
    path: string;
    label: string;
    element: JSX.Element;
    adminOnly?: boolean;
    /** Not offered in the public edition. */
    fullOnly?: boolean;
  }>;
}> = [
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
      { path: '/futures', label: 'Futures & Rollover', element: <FuturesPage />, fullOnly: true },
    ],
  },
  {
    group: '主動策略',
    items: [
      { path: '/strategies', label: 'Strategy Hub', element: <StrategiesPage />, fullOnly: true },
      { path: '/journal', label: 'Trade Journal', element: <JournalPage />, fullOnly: true },
    ],
  },
  {
    group: '分析',
    items: [
      { path: '/performance', label: 'Performance', element: <PerformancePage />, fullOnly: true },
      { path: '/risk', label: 'Risk Lab', element: <RiskLabPage /> },
    ],
  },
  {
    group: '系統',
    items: [
      { path: '/settings', label: 'Settings', element: <SettingsPage /> },
      { path: '/account', label: '我的帳號', element: <AccountPage />, fullOnly: true },
      {
        path: '/admin',
        label: '會員管理',
        element: <AdminPage />,
        adminOnly: true,
        fullOnly: true,
      },
    ],
  },
];

const STATUS: Record<SyncStatus, { tone: 'ok' | 'warn' | 'bad' | 'info'; text: string }> = {
  loading: { tone: 'info', text: '載入中' },
  ready: { tone: 'ok', text: '已同步' },
  saving: { tone: 'info', text: '儲存中' },
  error: { tone: 'bad', text: '同步失敗' },
  conflict: { tone: 'bad', text: '版本衝突' },
};

function TopBar(props: { onSignIn: () => void }) {
  const store = useStore();
  const quotes = useQuoteSync();
  const status = STATUS[store.status];
  const { theme, cycle } = useTheme();
  const auth = useAuth();
  return (
    <div className="topbar">
      <div className="topbar-item">
        {store.demo ? (
          <Badge tone="warn">預覽</Badge>
        ) : (
          <Badge tone={status.tone}>{status.text}</Badge>
        )}
        <span className="muted">{store.backendLabel}</span>
        {store.error && <span className="neg">{store.error}</span>}
        {(store.status === 'error' || store.status === 'conflict') && (
          <button className="ghost" onClick={() => void initStore(auth.viewing?.id)}>
            重新載入
          </button>
        )}
      </div>
      <div className="topbar-item">
        <span className="muted" title={quotes.errors.join('\n')}>
          {!store.backendRemote && snapshotGeneratedAt()
            ? `報價快照：${fmtTime(snapshotGeneratedAt())}`
            : `報價更新：${fmtTime(quotes.lastSuccessAt)}`}
          {quotes.errors.length > 0 && `（${quotes.errors.length} 項失敗）`}
        </span>
        {!store.demo && (
          <button onClick={() => void refreshQuotes()} disabled={quotes.refreshing}>
            {quotes.refreshing ? '更新中…' : '更新報價'}
          </button>
        )}
        <button onClick={cycle} title="切換明亮 / 黑色模式">
          主題：{THEME_LABELS[theme]}
        </button>
        {auth.user && (
          <>
            <span className="muted">{auth.user.displayName}</span>
            <button onClick={() => void logout()}>登出</button>
          </>
        )}
        {auth.phase !== 'ready' && (
          <button className="primary" onClick={props.onSignIn}>
            {IS_PUBLIC ? '開始使用' : '登入 / 註冊'}
          </button>
        )}
      </div>
    </div>
  );
}

const IDLE_LOCK_MS = 20 * 60_000;

/**
 * For data kept in this browser: stop saving when another tab changes it,
 * and lock an encrypted vault after a stretch with no activity.
 */
function useLocalVaultGuards(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const stopWatching = onExternalChange(markChangedElsewhere);
    if (!isEncrypted()) return stopWatching;
    let idle: ReturnType<typeof setTimeout>;
    const restart = () => {
      clearTimeout(idle);
      idle = setTimeout(() => void lockLocalData(), IDLE_LOCK_MS);
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    events.forEach((name) => window.addEventListener(name, restart, { passive: true }));
    restart();
    return () => {
      stopWatching();
      clearTimeout(idle);
      events.forEach((name) => window.removeEventListener(name, restart));
    };
  }, [active]);
}

export default function App() {
  const auth = useAuth();
  const store = useStore();
  const signedIn = auth.phase === 'ready';
  // A visitor who is not signed in explores a fictional portfolio instead
  // of facing a sign-in wall; the sign-in page opens on request.
  const guest = auth.phase === 'signedOut' || auth.phase === 'error' || auth.phase === 'preview';
  const [showAuth, setShowAuth] = useState(false);
  useEffect(() => {
    void initAuth();
  }, []);
  // Load data once someone is signed in, and again when the member changes.
  const userId = auth.user?.id;
  useEffect(() => {
    if (signedIn) {
      setShowAuth(false);
      void initStore();
    } else if (guest) {
      loadDemo();
    }
  }, [signedIn, guest, userId]);
  useAutoRefresh(
    signedIn && !store.demo && store.status !== 'loading' && store.backendLabel !== '',
  );
  useLocalVaultGuards(signedIn && auth.accountless && !store.backendRemote);
  useDailySnapshot();

  if (auth.phase === 'loading') return <div className="empty">連線中…</div>;
  if (auth.phase === 'locked') return <UnlockPage />;
  if (auth.phase === 'setup') return <SetupPage />;
  if (guest && showAuth && !IS_PUBLIC) return <AuthPage onBack={() => setShowAuth(false)} />;

  const isAdmin = auth.user?.role === 'admin';
  const visible = NAV.map((g) => ({
    ...g,
    items: g.items.filter(
      (item) =>
        (!item.adminOnly || isAdmin) &&
        !(IS_PUBLIC && item.fullOnly) &&
        !(auth.accountless && item.path === '/admin') &&
        !(guest && item.path === '/account'),
    ),
  })).filter((g) => g.items.length > 0);

  return (
    <HashRouter>
      <div className="layout">
        <nav className="sidebar">
          <div className="brand">Exfolio</div>
          {visible.map((g) => (
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
          <TopBar onSignIn={IS_PUBLIC ? endPreview : () => setShowAuth(true)} />
          {guest && (
            <div className="notice" style={{ margin: 0, borderRadius: 0 }}>
              預覽模式：以下是<strong>虛構的示範資料</strong>，可以自由操作，但不會儲存。{' '}
              <button
                className="primary"
                onClick={IS_PUBLIC ? endPreview : () => setShowAuth(true)}
              >
                {IS_PUBLIC ? '開始使用自己的資料' : '登入 / 註冊'}
              </button>
              {!IS_PUBLIC && ' 後使用自己的資料。'}
              {auth.phase === 'error' && (
                <span className="warn">（目前無法連線後端：{auth.error}）</span>
              )}
            </div>
          )}
          {auth.viewing && (
            <div className="notice warn" style={{ margin: 0, borderRadius: 0 }}>
              正在唯讀檢視 <strong>{auth.viewing.displayName}</strong>（{auth.viewing.username}
              ）的資料，任何修改都不會儲存。{' '}
              <button onClick={() => void stopViewing()}>回到我的資料</button>
            </div>
          )}
          <main className="content">
            {store.status === 'loading' ? (
              <div className="empty">載入資料中…</div>
            ) : (
              <Routes>
                {visible
                  .flatMap((g) => g.items)
                  .map((item) => (
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
