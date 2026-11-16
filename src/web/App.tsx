import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import {
  hasLegacyLocalData,
  initAuth,
  lockLocalData,
  logout,
  logoutAsking,
  stopViewing,
  useAuth,
} from './auth';
import { Brand } from './components/Brand';
import {
  IconLogout,
  IconRefresh,
  IconSettings,
  IconUser,
  IconUsers,
  NavIcon,
} from './components/icons';
import { ThemeButton } from './components/ThemeButton';
import { Badge, Spinner } from './components/ui';
import { Banner, EmptyState, PageSkeleton, Popover } from './components/Primitives';
import { confirmDialog } from './dialog';
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
import OptionsLabPage from './pages/OptionsLab';
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
import { useDailySnapshot } from './useDailySnapshot';

interface NavItem {
  path: string;
  label: string;
  element: JSX.Element;
  adminOnly?: boolean;
  /** Not offered in the public edition. */
  fullOnly?: boolean;
  /** Only for a signed-in member. */
  membersOnly?: boolean;
}

interface NavSection {
  /** Label in the top navigation and the phone tab bar. */
  group: string;
  items: NavItem[];
}

// The five sections of the top navigation; a section's pages are its
// sub-navigation. Paths are unchanged from the earlier single-sidebar layout.
const NAV: NavSection[] = [
  {
    group: '總覽',
    items: [{ path: '/', label: '投資總覽', element: <OverviewPage /> }],
  },
  {
    group: '配置',
    items: [
      { path: '/allocation', label: '核心配置', element: <CoreAllocationPage /> },
      { path: '/new-money', label: '新資金配置', element: <NewMoneyPage /> },
    ],
  },
  {
    group: '帳務',
    items: [
      { path: '/accounts', label: '帳戶與持倉', element: <AccountsPage /> },
      { path: '/loans', label: '借款與質押', element: <LoansPage /> },
      { path: '/futures', label: '期貨與轉倉', element: <FuturesPage /> },
    ],
  },
  {
    group: '分析',
    items: [
      { path: '/risk', label: '風險實驗室', element: <RiskLabPage /> },
      { path: '/options', label: '選擇權實驗室', element: <OptionsLabPage /> },
      { path: '/performance', label: '績效分析', element: <PerformancePage />, fullOnly: true },
      { path: '/strategies', label: '主動策略', element: <StrategiesPage />, fullOnly: true },
      { path: '/journal', label: '交易日誌', element: <JournalPage />, fullOnly: true },
    ],
  },
  {
    group: '設定',
    items: [
      { path: '/settings', label: '設定與資料', element: <SettingsPage /> },
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

/** The section the current page belongs to; the first one for an unknown path. */
function useCurrentSection(sections: NavSection[]): NavSection | undefined {
  const { pathname } = useLocation();
  return sections.find((g) => g.items.some((item) => item.path === pathname)) ?? sections[0];
}

/** Section links in the header (wide screens). */
function TopNav({ sections }: { sections: NavSection[] }) {
  const current = useCurrentSection(sections);
  return (
    <nav className="topnav" aria-label="主選單">
      {sections.map((g) => (
        <Link key={g.group} to={g.items[0].path} aria-current={g === current ? 'true' : undefined}>
          {g.group}
        </Link>
      ))}
    </nav>
  );
}

/** Pages of the current section: a side list on wide screens, a pill row on small ones. */
function SubNav({ sections }: { sections: NavSection[] }) {
  const current = useCurrentSection(sections);
  if (!current || current.items.length < 2) return null;
  return (
    <nav className="subnav" aria-label={`${current.group}的頁面`}>
      <div className="subnav-title">{current.group}</div>
      {current.items.map((item) => (
        <NavLink key={item.path} to={item.path} end>
          <NavIcon path={item.path} />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/** Whether the page was last scrolled down, so the tab bar can shrink out of the way. */
function useScrolledDown(): boolean {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const onScroll = () => {
      const y = window.scrollY;
      // Ignore jitter and the rubber-band region at the top.
      if (Math.abs(y - last) < 8) return;
      setDown(y > last && y > 80);
      last = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  return down;
}

/** Floating section bar for phones and tablets. */
function TabBar({ sections }: { sections: NavSection[] }) {
  const current = useCurrentSection(sections);
  const compact = useScrolledDown();
  return (
    <nav className={`tabbar ${compact ? 'compact' : ''}`} aria-label="主選單（行動版）">
      {sections.map((g) => (
        <Link key={g.group} to={g.items[0].path} aria-current={g === current ? 'true' : undefined}>
          <NavIcon path={g.items[0].path} />
          <span>{g.group}</span>
        </Link>
      ))}
    </nav>
  );
}

const STATUS: Record<SyncStatus, { tone: 'ok' | 'warn' | 'bad' | 'info'; text: string }> = {
  loading: { tone: 'info', text: '載入中' },
  ready: { tone: 'ok', text: '已同步' },
  saving: { tone: 'info', text: '儲存中' },
  error: { tone: 'bad', text: '同步失敗' },
  conflict: { tone: 'bad', text: '版本衝突' },
};

/** Avatar button with the member's menu: account, members, sign-out. */
function UserMenu() {
  const auth = useAuth();
  const user = auth.user!;
  return (
    <Popover label="帳號選單" trigger={<IconUser size={22} />}>
      <div className="menu-profile">
        <span className="menu-name">{user.displayName}</span>
        <span className="menu-sub">{user.username}</span>
      </div>
      <div className="menu-divider" />
      <Link to="/account" className="menu-item">
        <IconUser /> 我的帳號
      </Link>
      {user.role === 'admin' && (
        <Link to="/admin" className="menu-item">
          <IconUsers /> 會員管理
        </Link>
      )}
      <Link to="/settings" className="menu-item">
        <IconSettings /> 設定
      </Link>
      <div className="menu-divider" />
      <button type="button" className="menu-item danger" onClick={() => void logoutAsking()}>
        <IconLogout /> 登出
      </button>
    </Popover>
  );
}

function Header(props: { onSignIn: () => void; nav: ReactNode }) {
  const store = useStore();
  const quotes = useQuoteSync();
  const status = STATUS[store.status];
  const auth = useAuth();
  const snapshot = (IS_PUBLIC || !store.backendRemote) && snapshotGeneratedAt();
  return (
    <header className="app-header">
      <Link to="/" className="header-brand" aria-label="Exfolio 投資總覽">
        <Brand />
      </Link>
      {props.nav}
      <div className="header-status">
        {store.scratch ? (
          <Badge tone="warn">試算</Badge>
        ) : store.demo ? (
          <Badge tone="warn">預覽</Badge>
        ) : (
          <Badge tone={status.tone}>{status.text}</Badge>
        )}
        <span className="muted hide-sm">{store.backendLabel}</span>
        {store.error && <span className="error-text">{store.error}</span>}
        {(store.status === 'error' || store.status === 'conflict') && (
          <button className="ghost" onClick={() => void initStore(auth.viewing?.id)}>
            重新載入
          </button>
        )}
      </div>
      <div className="header-actions">
        <span className="muted hide-sm" title={quotes.errors.join('\n')}>
          {snapshot ? `報價快照 ${fmtTime(snapshot)}` : `報價 ${fmtTime(quotes.lastSuccessAt)}`}
          {quotes.errors.length > 0 && `（${quotes.errors.length} 項失敗）`}
        </span>
        {(!store.demo || store.scratch) && (
          <button
            type="button"
            className="icon-btn"
            onClick={() => void refreshQuotes()}
            disabled={quotes.refreshing}
            title="更新報價"
            aria-label="更新報價"
          >
            <span className={quotes.refreshing ? 'spin' : ''}>
              <IconRefresh />
            </span>
          </button>
        )}
        <ThemeButton />
        {auth.user ? (
          <UserMenu />
        ) : (
          auth.phase !== 'ready' &&
          MEMBERS_ENABLED && (
            <button className="primary" onClick={props.onSignIn}>
              {IS_PUBLIC ? '會員登入' : '登入 / 註冊'}
            </button>
          )
        )}
      </div>
    </header>
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

/** Moves focus to the page content whenever the route changes. */
function FocusMainOnNavigate() {
  const location = useLocation();
  const previous = useRef(location.pathname);
  useEffect(() => {
    const changed = previous.current !== location.pathname;
    previous.current = location.pathname;
    if (!changed) return;
    const frame = requestAnimationFrame(() => document.getElementById('main-content')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [location.pathname]);
  return null;
}

/** The page frame under the header: sub-navigation beside the content. */
function Layout(props: { sections: NavSection[]; children: ReactNode }) {
  const current = useCurrentSection(props.sections);
  const hasSubnav = !!current && current.items.length > 1;
  return (
    <div className={hasSubnav ? 'layout' : 'layout no-subnav'}>
      <SubNav sections={props.sections} />
      {props.children}
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
  // The cover belongs to whoever went idle; a new person starts without it.
  useEffect(() => setIdleState('none'), [auth.user?.id]);
  useMemberIdleSignOut(IS_PUBLIC && signedIn && idleState === 'none', onIdle);
  useDailySnapshot();

  if (auth.phase === 'loading') return <Spinner text="連線中…" />;
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
      <FocusMainOnNavigate />
      <a
        className="skip-link"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        跳至主要內容
      </a>
      <Header onSignIn={signIn} nav={<TopNav sections={visible} />} />
      <Layout sections={visible}>
        <div className="main">
          {guest && IS_PUBLIC && (
            <div className="notice" role="note" style={{ margin: 0, borderRadius: 0 }}>
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
            <div className="notice" role="note" style={{ margin: 0, borderRadius: 0 }}>
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
            <div className="notice warn" role="note" style={{ margin: 0, borderRadius: 0 }}>
              你登入前在試算模式輸入的資料還沒存進帳號，帳號裡已經有資料。{' '}
              <button
                onClick={() =>
                  void confirmDialog('用試算的資料取代帳號裡的全部資料？帳號原本的資料會被覆蓋。', {
                    tone: 'danger',
                    confirmText: '取代',
                  }).then((ok) => ok && adoptCarry())
                }
              >
                用試算資料取代帳號資料
              </button>{' '}
              <button onClick={dropCarry}>保留帳號資料，捨棄試算</button>
            </div>
          )}
          {auth.viewing && (
            <div className="notice warn" role="note" style={{ margin: 0, borderRadius: 0 }}>
              正在唯讀檢視 <strong>{auth.viewing.displayName}</strong>（{auth.viewing.username}
              ）的資料，任何修改都不會儲存。{' '}
              <button onClick={() => void stopViewing()}>回到我的資料</button>
            </div>
          )}
          {(store.status === 'error' || store.status === 'conflict') && (
            <Banner tone="bad" title={STATUS[store.status].text}>
              變更尚未成功同步。請保留此分頁，並在離開前確認儲存狀態；可到設定匯出備份。
              {store.error}
            </Banner>
          )}
          <main id="main-content" className="content" tabIndex={-1}>
            {store.status === 'loading' ? (
              <PageSkeleton label="載入資料中…" />
            ) : (
              <Routes>
                {visible
                  .flatMap((g) => g.items)
                  .map((item) => (
                    <Route key={item.path} path={item.path} element={item.element} />
                  ))}
                <Route
                  path="*"
                  element={
                    <EmptyState
                      title="找不到這個頁面"
                      action={
                        <Link className="button primary" to="/">
                          回到投資總覽
                        </Link>
                      }
                    >
                      從主選單選擇要查看的內容。
                    </EmptyState>
                  }
                />
              </Routes>
            )}
          </main>
        </div>
      </Layout>
      <TabBar sections={visible} />
    </HashRouter>
  );
}
