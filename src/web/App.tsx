import { useCallback, useEffect, useState } from 'react';
import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import {
  hasLegacyLocalData,
  initAuth,
  lockLocalData,
  logout,
  logoutAsking,
  stopViewing,
  useAuth,
} from './auth';
import { Badge } from './components/ui';
import { IS_PUBLIC, MEMBERS_ENABLED } from './edition';
import { fmtTime } from './format';
import AccountPage from './pages/Account';
import AccountsPage from './pages/Accounts';
import AdminPage from './pages/Admin';
import AuthPage from './pages/auth/AuthPage';
import GoogleSignIn from './pages/auth/GoogleSignIn';
import LegacyDataPage from './pages/auth/LegacyDataPage';
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
import {
  adoptCarry,
  dropCarry,
  initStore,
  loadDemo,
  loadScratch,
  markChangedElsewhere,
  scratchToCarry,
  useStore,
  type SyncStatus,
} from './store';
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
    /** Only for a signed-in member. */
    membersOnly?: boolean;
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
      { path: '/futures', label: 'Futures & Rollover', element: <FuturesPage /> },
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
      { path: '/account', label: '我的帳號', element: <AccountPage />, membersOnly: true },
      {
        path: '/admin',
        label: '會員管理',
        element: <AdminPage />,
        adminOnly: true,
        membersOnly: true,
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
        {store.scratch ? (
          <Badge tone="warn">試算</Badge>
        ) : store.demo ? (
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
          {(IS_PUBLIC || !store.backendRemote) && snapshotGeneratedAt()
            ? `報價快照：${fmtTime(snapshotGeneratedAt())}`
            : `報價更新：${fmtTime(quotes.lastSuccessAt)}`}
          {quotes.errors.length > 0 && `（${quotes.errors.length} 項失敗）`}
        </span>
        {(!store.demo || store.scratch) && (
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
            <button onClick={() => void logoutAsking()}>登出</button>
          </>
        )}
        {auth.phase !== 'ready' && MEMBERS_ENABLED && (
          <button className="primary" onClick={props.onSignIn}>
            {IS_PUBLIC ? '會員登入' : '登入 / 註冊'}
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

const MEMBER_IDLE_MS = 30 * 60_000;

/**
 * Public edition: after a stretch with no activity, call `onIdle`, which
 * hides the member's data and signs them out.
 */
function useMemberIdleSignOut(active: boolean, onIdle: () => void) {
  useEffect(() => {
    if (!active) return;
    let idle: ReturnType<typeof setTimeout>;
    const restart = () => {
      clearTimeout(idle);
      idle = setTimeout(onIdle, MEMBER_IDLE_MS);
    };
    const events = ['pointerdown', 'keydown', 'scroll'] as const;
    events.forEach((name) => window.addEventListener(name, restart, { passive: true }));
    restart();
    return () => {
      clearTimeout(idle);
      events.forEach((name) => window.removeEventListener(name, restart));
    };
  }, [active, onIdle]);
}

/** Shown instead of a member's data once they have been idle too long. */
function IdleCover(props: {
  state: 'busy' | 'failed';
  onRetry: () => void;
  onDiscard: () => void;
  onBack: () => void;
}) {
  return (
    <div className="empty">
      {props.state === 'busy' ? (
        <p>閒置超過 30 分鐘，正在儲存並登出…</p>
      ) : (
        <>
          <p>閒置超過 30 分鐘。有變更存不進帳號（可能是連線問題），所以還沒登出，資料先遮住。</p>
          <p className="actions">
            <button className="primary" onClick={props.onRetry}>
              重試儲存並登出
            </button>
            <button className="danger" onClick={props.onDiscard}>
              捨棄變更並登出
            </button>
            <button onClick={props.onBack}>我還在，回到網站</button>
          </p>
        </>
      )}
    </div>
  );
}

export default function App() {
  const auth = useAuth();
  const store = useStore();
  const signedIn = auth.phase === 'ready';
  // A visitor who is not signed in is never stopped at a sign-in wall: the
  // full edition shows a fictional portfolio, the public one a calculator
  // that starts empty and keeps nothing.
  const guest = auth.phase === 'signedOut' || auth.phase === 'error' || auth.phase === 'preview';
  const [showAuth, setShowAuth] = useState(false);
  const [showLegacy, setShowLegacy] = useState(false);
  const [legacy, setLegacy] = useState(hasLegacyLocalData);
  useEffect(() => {
    void initAuth();
  }, []);
  // Load data once someone is signed in, and again when the member changes.
  const userId = auth.user?.id;
  useEffect(() => {
    if (signedIn) {
      setShowAuth(false);
      // Figures typed in before signing in go along to the account.
      void initStore(undefined, scratchToCarry());
    } else if (guest) {
      if (IS_PUBLIC) loadScratch();
      else loadDemo();
    }
  }, [signedIn, guest, userId]);
  useAutoRefresh(
    store.status !== 'loading' &&
      store.backendLabel !== '' &&
      ((signedIn && !store.demo) || store.scratch),
  );
  useLocalVaultGuards(signedIn && auth.accountless && !store.backendRemote);
  const [idleState, setIdleState] = useState<'none' | 'busy' | 'failed'>('none');
  const idleSignOut = useCallback((discard = false) => {
    setIdleState('busy');
    void logout(discard).then((done) => setIdleState(done ? 'none' : 'failed'));
  }, []);
  const onIdle = useCallback(() => idleSignOut(), [idleSignOut]);
  useMemberIdleSignOut(IS_PUBLIC && signedIn && idleState === 'none', onIdle);
  useDailySnapshot();

  if (auth.phase === 'loading') return <div className="empty">連線中…</div>;
  if (signedIn && idleState !== 'none') {
    return (
      <IdleCover
        state={idleState}
        onRetry={() => idleSignOut()}
        onDiscard={() => idleSignOut(true)}
        onBack={() => setIdleState('none')}
      />
    );
  }
  if (auth.phase === 'locked') return <UnlockPage />;
  if (auth.phase === 'setup') return <SetupPage />;
  if (guest && showLegacy) {
    return (
      <LegacyDataPage
        onDone={() => {
          setShowLegacy(false);
          setLegacy(hasLegacyLocalData());
        }}
      />
    );
  }
  if (guest && showAuth) {
    return IS_PUBLIC || auth.config?.passwordLogin === false ? (
      <GoogleSignIn onBack={() => setShowAuth(false)} />
    ) : (
      <AuthPage onBack={() => setShowAuth(false)} />
    );
  }

  const isAdmin = auth.user?.role === 'admin';
  const visible = NAV.map((g) => ({
    ...g,
    items: g.items.filter(
      (item) =>
        (!item.adminOnly || isAdmin) &&
        !(IS_PUBLIC && item.fullOnly) &&
        !(item.membersOnly && (!MEMBERS_ENABLED || guest || auth.accountless)),
    ),
  })).filter((g) => g.items.length > 0);
  const signIn = () => setShowAuth(true);

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
          <TopBar onSignIn={signIn} />
          {guest && IS_PUBLIC && (
            <div className="notice" style={{ margin: 0, borderRadius: 0 }}>
              {store.scratch ? (
                <>
                  <strong>試算模式</strong>
                  ：你輸入的資料只留在這個分頁，關閉或重新整理就會消失（可到 Settings 匯出備份檔）。{' '}
                  {MEMBERS_ENABLED && (
                    <button className="primary" onClick={signIn}>
                      會員登入以保存
                    </button>
                  )}{' '}
                  {!store.scratchEdited && <button onClick={loadDemo}>看虛構的示範資料</button>}
                </>
              ) : (
                <>
                  正在看<strong>虛構的示範資料</strong>，不會儲存。{' '}
                  <button className="primary" onClick={() => loadScratch()}>
                    改用自己的數字試算
                  </button>
                </>
              )}
              {legacy && (
                <>
                  {' '}
                  這個瀏覽器有舊版存下的資料：
                  <button onClick={() => setShowLegacy(true)}>開啟舊資料</button>
                </>
              )}
              {auth.phase === 'error' && (
                <span className="warn">（目前無法連線會員後端：{auth.error}）</span>
              )}
            </div>
          )}
          {guest && !IS_PUBLIC && (
            <div className="notice" style={{ margin: 0, borderRadius: 0 }}>
              預覽模式：以下是<strong>虛構的示範資料</strong>，可以自由操作，但不會儲存。{' '}
              <button className="primary" onClick={signIn}>
                登入 / 註冊
              </button>{' '}
              後使用自己的資料。
              {auth.phase === 'error' && (
                <span className="warn">（目前無法連線後端：{auth.error}）</span>
              )}
            </div>
          )}
          {store.pendingCarry && (
            <div className="notice warn" style={{ margin: 0, borderRadius: 0 }}>
              你登入前在試算模式輸入的資料還沒存進帳號，帳號裡已經有資料。{' '}
              <button
                onClick={() =>
                  window.confirm('用試算的資料取代帳號裡的全部資料？帳號原本的資料會被覆蓋。') &&
                  adoptCarry()
                }
              >
                用試算資料取代帳號資料
              </button>{' '}
              <button onClick={dropCarry}>保留帳號資料，捨棄試算</button>
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
